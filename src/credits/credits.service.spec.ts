import Database from 'better-sqlite3';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Worker } from 'worker_threads';
import { CreditsService } from './credits.service';

interface LedgerRow {
  owner: string;
  story: string | null;
  game: string | null;
  kind: string;
  llm_cost: number | null;
  amount: number;
}

// Charges `count` times from a separate thread with its own connection,
// claiming an auto top-up after each debit. Resolves with the claims made.
const chargeFromWorker = (path: string, count: number): Promise<number> =>
  new Promise((resolve, reject) => {
    let claims = 0;
    const worker = new Worker(
      `
      const { parentPort, workerData } = require('worker_threads');
      require('ts-node').register({ transpileOnly: true });
      process.env.DATABASE_PATH = workerData.path;
      const { CreditsService } = require(workerData.service);
      const credits = new CreditsService();
      let claims = 0;
      for (let i = 0; i < workerData.count; i++) {
        credits.charge('story', {
          story: 'story',
          game: 'GAME' + i,
          llmCost: 0.01,
          amount: 0.01,
        });
        if (credits.claimAutoTopup('story')) {
          claims++;
        }
      }
      credits.onModuleDestroy();
      parentPort.postMessage(claims);
      `,
      {
        eval: true,
        workerData: {
          path,
          count,
          service: join(__dirname, 'credits.service.ts'),
        },
      },
    );
    worker.on('message', (made: number) => (claims = made));
    worker.on('error', reject);
    worker.on('exit', (code) =>
      code === 0
        ? resolve(claims)
        : reject(new Error(`worker exited with ${code}`)),
    );
  });

describe('CreditsService', () => {
  let path: string;
  let credits: CreditsService;

  const ledger = (owner: string): LedgerRow[] => {
    const db = new Database(path, { readonly: true });
    const rows = db
      .prepare<[string], LedgerRow>(
        'SELECT owner, story, game, kind, llm_cost, amount FROM ledger WHERE owner = ? ORDER BY id',
      )
      .all(owner);
    db.close();
    return rows;
  };

  const ledgerSum = (owner: string): number =>
    ledger(owner).reduce((sum, row) => sum + row.amount, 0) / 1_000_000;

  beforeEach(() => {
    path = join(mkdtempSync(join(tmpdir(), 'avventura-db-')), 'test.db');
    process.env.DATABASE_PATH = path;
    credits = new CreditsService();
    credits.onModuleInit();
  });

  afterEach(() => {
    credits.onModuleDestroy();
    delete process.env.DATABASE_PATH;
  });

  it('has no balance for an unknown owner', () => {
    expect(credits.balance('story')).toBeNull();
  });

  it('opens a balance once, with an adjustment', () => {
    expect(credits.open('story', 10, 'story')).toBe(10);
    expect(credits.open('story', 99, 'story')).toBe(10);
    expect(ledger('story')).toEqual([
      {
        owner: 'story',
        story: 'story',
        game: null,
        kind: 'adjustment',
        llm_cost: null,
        amount: 10_000_000,
      },
    ]);
  });

  it('records a charge and a top-up in the ledger', () => {
    credits.open('story', 10);
    expect(
      credits.charge('story', {
        story: 'story',
        game: 'GAME',
        llmCost: 0.123456,
        amount: 0.123456,
      }),
    ).toBe(9.876544);
    expect(credits.topUp('story', 5, 'story')).toBe(14.876544);
    expect(ledger('story').slice(1)).toEqual([
      {
        owner: 'story',
        story: 'story',
        game: 'GAME',
        kind: 'llm',
        llm_cost: 123_456,
        amount: -123_456,
      },
      {
        owner: 'story',
        story: 'story',
        game: null,
        kind: 'topup',
        llm_cost: null,
        amount: 5_000_000,
      },
    ]);
    expect(ledgerSum('story')).toBe(credits.balance('story'));
  });

  it('refuses to move a balance that does not exist, without a ledger row', () => {
    expect(() => credits.topUp('missing', 5)).toThrow('Balance not found');
    expect(ledger('missing')).toEqual([]);
  });

  it('keeps every debit across connections on the same balance', () => {
    credits.open('story', 10);
    const other = new CreditsService();
    for (let i = 0; i < 100; i++) {
      const service = i % 2 === 0 ? credits : other;
      service.charge('story', {
        story: 'story',
        game: `GAME${i}`,
        llmCost: 0.01,
        amount: 0.01,
      });
    }
    other.onModuleDestroy();

    expect(credits.balance('story')).toBe(9);
    expect(ledgerSum('story')).toBe(9);
  });

  it('keeps every debit from concurrent threads on the same balance', async () => {
    credits.open('story', 10);

    await Promise.all([1, 2, 3, 4].map(() => chargeFromWorker(path, 50)));

    expect(credits.balance('story')).toBe(8);
    expect(ledger('story')).toHaveLength(201);
    expect(ledgerSum('story')).toBe(8);
  }, 30_000);

  it('moves a story balance to its owner once, keeping the total', () => {
    credits.open('story', 10, 'story');
    credits.charge('story', { story: 'story', llmCost: 1, amount: 1 });

    expect(credits.moveStoryBalance('story', '0xabc', 100)).toBe(9);
    expect(credits.moveStoryBalance('story', '0xabc', 100)).toBe(0);
    expect(credits.balance('story')).toBe(0);
    expect(credits.balance('0xabc')).toBe(9);
    expect(ledger('0xabc')).toEqual([
      {
        owner: '0xabc',
        story: 'story',
        game: null,
        kind: 'adjustment',
        llm_cost: null,
        amount: 9_000_000,
      },
    ]);
    expect(ledgerSum('story') + ledgerSum('0xabc')).toBe(9);
  });

  it('opens a story balance at the initial amount before moving it', () => {
    expect(credits.moveStoryBalance('story', '0xabc', 100)).toBe(100);
    expect(credits.balance('story')).toBe(0);
    expect(credits.balance('0xabc')).toBe(100);
    expect(ledger('story').map((row) => row.amount)).toEqual([
      100_000_000, -100_000_000,
    ]);
  });

  it('opens the owner balance even when the story balance is 0', () => {
    credits.open('story', 0, 'story');

    expect(credits.moveStoryBalance('story', '0xabc', 100)).toBe(0);
    expect(credits.balance('0xabc')).toBe(0);
    expect(ledger('0xabc')).toEqual([]);
  });

  it('moves a negative story balance too', () => {
    credits.open('story', 1, 'story');
    credits.charge('story', { story: 'story', llmCost: 3, amount: 3 });
    credits.open('0xabc', 10);

    expect(credits.moveStoryBalance('story', '0xabc', 100)).toBe(-2);
    expect(credits.balance('0xabc')).toBe(8);
  });

  it('sums the LLM debits of each story across owners', () => {
    credits.open('story', 10, 'story');
    credits.charge('story', { story: 'story', llmCost: 1, amount: 1 });
    credits.moveStoryBalance('story', '0xabc', 100);
    credits.charge('0xabc', {
      story: 'story',
      game: 'G',
      llmCost: 0.5,
      amount: 0.5,
    });
    credits.charge('0xabc', { story: 'other', llmCost: 2, amount: 2 });
    credits.topUp('0xabc', 5, 'story');

    expect(credits.spentByStory(['story', 'other', 'unplayed'])).toEqual({
      story: 1.5,
      other: 2,
      unplayed: 0,
    });
  });

  describe('creditPayment', () => {
    const payment = {
      eventId: 'evt_1',
      eventType: 'checkout.session.completed',
      owner: '0xa',
      paymentIntent: 'pi_1',
      gross: 10,
      fee: 0.4,
    };

    const paymentRows = (owner: string) => {
      const db = new Database(path, { readonly: true });
      const rows = db
        .prepare(
          `SELECT kind, amount, gross, fee, stripe_payment_intent FROM ledger
           WHERE owner = ? ORDER BY id`,
        )
        .all(owner);
      db.close();
      return rows;
    };

    it('credits the net and stores the gross and the fee', () => {
      credits.open('0xa', 1);
      expect(credits.creditPayment(payment, 100)).toBe(10.6);
      expect(paymentRows('0xa')).toEqual([
        {
          kind: 'adjustment',
          amount: 1_000_000,
          gross: null,
          fee: null,
          stripe_payment_intent: null,
        },
        {
          kind: 'topup',
          amount: 9_600_000,
          gross: 10_000_000,
          fee: 400_000,
          stripe_payment_intent: 'pi_1',
        },
      ]);
      expect(credits.hasStripeEvent('evt_1')).toBe(true);
    });

    it('opens a missing balance at the opening amount first', () => {
      expect(credits.creditPayment(payment, 100)).toBe(109.6);
      expect(ledgerSum('0xa')).toBe(109.6);
    });

    it('credits nothing for a replayed event', () => {
      credits.creditPayment(payment, 0);
      expect(credits.creditPayment(payment, 0)).toBeNull();
      expect(credits.balance('0xa')).toBe(9.6);
    });

    it('credits a PaymentIntent once across events', () => {
      credits.creditPayment(payment, 0);
      expect(
        credits.creditPayment(
          {
            ...payment,
            eventId: 'evt_2',
            eventType: 'payment_intent.succeeded',
          },
          0,
        ),
      ).toBeNull();
      expect(credits.balance('0xa')).toBe(9.6);
      expect(credits.hasStripeEvent('evt_2')).toBe(true);
    });
  });

  describe('auto top-up', () => {
    const settings = { enabled: true, amount: 20, threshold: 5 };
    const event = { id: 'evt_setup', type: 'checkout.session.completed' };

    const payments = () => {
      const db = new Database(path, { readonly: true });
      const rows = db
        .prepare(
          'SELECT owner, amount, status, payment_intent FROM auto_topup_payments ORDER BY id',
        )
        .all();
      db.close();
      return rows;
    };

    const enable = (owner = '0xa') => {
      credits.setAutoTopup(owner, settings);
      credits.saveAutoTopupCard(owner, 'pm_1', { ...event, id: owner });
    };

    it('has no settings for an unknown owner', () => {
      expect(credits.autoTopup('0xa')).toBeNull();
    });

    it('saves, changes and disables the settings', () => {
      expect(credits.setAutoTopup('0xa', settings)).toEqual({
        ...settings,
        paymentMethod: null,
        pausedReason: null,
      });
      expect(
        credits.setAutoTopup('0xa', {
          enabled: true,
          amount: 50,
          threshold: 0,
        }),
      ).toMatchObject({ enabled: true, amount: 50, threshold: 0 });
      expect(credits.setAutoTopup('0xa', { enabled: false })).toMatchObject({
        enabled: false,
        amount: 50,
        threshold: 0,
      });
    });

    it('opens disabled at the defaults when a card is saved first', () => {
      expect(credits.saveAutoTopupCard('0xa', 'pm_1', event)).toBe(true);
      expect(credits.autoTopup('0xa')).toEqual({
        enabled: false,
        amount: 10,
        threshold: 5,
        paymentMethod: 'pm_1',
        pausedReason: null,
      });
    });

    it('saves a card once per event', () => {
      credits.saveAutoTopupCard('0xa', 'pm_1', event);
      expect(credits.saveAutoTopupCard('0xa', 'pm_2', event)).toBe(false);
      expect(credits.autoTopup('0xa')?.paymentMethod).toBe('pm_1');
      expect(credits.hasStripeEvent('evt_setup')).toBe(true);
    });

    it('claims once the balance is at or below the threshold', () => {
      enable();
      credits.open('0xa', 6);
      expect(credits.claimAutoTopup('0xa')).toBeNull();
      credits.charge('0xa', { llmCost: 1, amount: 1 });
      expect(credits.claimAutoTopup('0xa')).toEqual({
        id: 1,
        owner: '0xa',
        amount: 20,
        paymentMethod: 'pm_1',
      });
      expect(payments()).toEqual([
        {
          owner: '0xa',
          amount: 20_000_000,
          status: 'pending',
          payment_intent: null,
        },
      ]);
    });

    it('claims one pending auto top-up at a time', () => {
      enable();
      enable('0xb');
      credits.open('0xa', 1);
      credits.open('0xb', 1);
      expect(credits.claimAutoTopup('0xa')).not.toBeNull();
      expect(credits.claimAutoTopup('0xa')).toBeNull();
      expect(credits.claimAutoTopup('0xb')).not.toBeNull();
    });

    it('claims a pending auto top-up again once it is stale', () => {
      jest.useFakeTimers({ now: new Date('2026-11-18T10:00:00Z') });
      try {
        enable();
        credits.open('0xa', 1);
        const claim = credits.claimAutoTopup('0xa')!;
        jest.setSystemTime(new Date('2026-11-18T10:09:59Z'));
        expect(credits.claimAutoTopup('0xa')).toBeNull();
        jest.setSystemTime(new Date('2026-11-18T10:10:01Z'));
        expect(credits.claimAutoTopup('0xa')).toEqual(claim);
        expect(credits.claimAutoTopup('0xa')).toBeNull();
        credits.startAutoTopup(claim.id, 'pi_1');
        jest.setSystemTime(new Date('2026-11-18T11:00:00Z'));
        expect(credits.claimAutoTopup('0xa')).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it('claims nothing when disabled', () => {
      enable();
      credits.setAutoTopup('0xa', { enabled: false });
      credits.open('0xa', 1);
      expect(credits.claimAutoTopup('0xa')).toBeNull();
    });

    it('claims nothing without a card', () => {
      credits.setAutoTopup('0xa', settings);
      credits.open('0xa', 1);
      expect(credits.claimAutoTopup('0xa')).toBeNull();
    });

    it('claims nothing while paused', () => {
      enable();
      credits.open('0xa', 1);
      credits.failAutoTopup(credits.claimAutoTopup('0xa')!.id, '0xa', 'x');
      expect(credits.claimAutoTopup('0xa')).toBeNull();
    });

    it('fails a pending auto top-up once and pauses it', () => {
      enable();
      credits.open('0xa', 1);
      const claim = credits.claimAutoTopup('0xa')!;
      credits.startAutoTopup(claim.id, 'pi_1');
      expect(credits.failAutoTopup(claim.id, '0xa', 'card_declined')).toBe(
        true,
      );
      expect(credits.failAutoTopup(claim.id, '0xa', 'other')).toBe(false);
      expect(credits.autoTopup('0xa')?.pausedReason).toBe('card_declined');
      expect(payments()).toEqual([
        {
          owner: '0xa',
          amount: 20_000_000,
          status: 'failed',
          payment_intent: 'pi_1',
        },
      ]);
    });

    it('resumes when a card is saved or the settings change', () => {
      enable();
      credits.open('0xa', 1);
      credits.failAutoTopup(credits.claimAutoTopup('0xa')!.id, '0xa', 'x');
      credits.saveAutoTopupCard('0xa', 'pm_2', { ...event, id: 'evt_2' });
      expect(credits.autoTopup('0xa')?.pausedReason).toBeNull();
      credits.failAutoTopup(credits.claimAutoTopup('0xa')!.id, '0xa', 'x');
      credits.setAutoTopup('0xa', { enabled: true });
      expect(credits.autoTopup('0xa')?.pausedReason).toBeNull();
      expect(credits.claimAutoTopup('0xa')).not.toBeNull();
    });

    it('marks the auto top-up succeeded with its credit', () => {
      enable();
      credits.open('0xa', 1);
      const claim = credits.claimAutoTopup('0xa')!;
      expect(
        credits.creditPayment(
          {
            eventId: 'evt_1',
            eventType: 'payment_intent.succeeded',
            owner: '0xa',
            paymentIntent: 'pi_1',
            gross: 20,
            fee: 0.55,
            autoTopup: claim.id,
          },
          0,
        ),
      ).toBe(20.45);
      expect(payments()).toEqual([
        {
          owner: '0xa',
          amount: 20_000_000,
          status: 'succeeded',
          payment_intent: 'pi_1',
        },
      ]);
      credits.charge('0xa', { llmCost: 20, amount: 20 });
      expect(credits.claimAutoTopup('0xa')).not.toBeNull();
    });

    it('claims once across concurrent threads', async () => {
      enable('story');
      credits.open('story', 6);

      const claims = await Promise.all(
        [1, 2, 3, 4].map(() => chargeFromWorker(path, 50)),
      );

      expect(claims.reduce((sum, made) => sum + made, 0)).toBe(1);
      expect(payments()).toHaveLength(1);
    }, 30_000);
  });
});

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

// Charges `count` times from a separate thread with its own connection
const chargeFromWorker = (path: string, count: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(
      `
      const { workerData } = require('worker_threads');
      require('ts-node').register({ transpileOnly: true });
      process.env.DATABASE_PATH = workerData.path;
      const { CreditsService } = require(workerData.service);
      const credits = new CreditsService();
      for (let i = 0; i < workerData.count; i++) {
        credits.charge('story', {
          story: 'story',
          game: 'GAME' + i,
          llmCost: 0.01,
          amount: 0.01,
        });
      }
      credits.onModuleDestroy();
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
    worker.on('error', reject);
    worker.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`worker exited with ${code}`)),
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
});

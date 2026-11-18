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
});

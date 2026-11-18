import Database from 'better-sqlite3';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { openDatabase } from './schema';

const columns = (db: Database.Database, table: string): string[] =>
  db
    .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => column.name);

describe('openDatabase', () => {
  let path: string;

  beforeEach(() => {
    path = join(mkdtempSync(join(tmpdir(), 'schema-')), 'test.db');
  });

  it('adds the Stripe columns to a ledger created without them', () => {
    const old = new Database(path);
    old.exec(`
      CREATE TABLE balances (owner TEXT PRIMARY KEY, amount INTEGER NOT NULL);
      CREATE TABLE ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner TEXT NOT NULL REFERENCES balances (owner),
        story TEXT,
        game TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('llm', 'topup', 'adjustment')),
        llm_cost INTEGER,
        amount INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO balances VALUES ('0xa', 5000000);
      INSERT INTO ledger (owner, kind, amount, created_at)
        VALUES ('0xa', 'adjustment', 5000000, '2026-01-01');
    `);
    old.close();

    const db = openDatabase(path);
    expect(columns(db, 'ledger')).toEqual(
      expect.arrayContaining(['gross', 'fee', 'stripe_payment_intent']),
    );
    expect(db.prepare('SELECT amount, gross, fee FROM ledger').get()).toEqual({
      amount: 5000000,
      gross: null,
      fee: null,
    });
    db.close();
  });

  it('opens the same database twice without changing it', () => {
    openDatabase(path).close();
    const db = openDatabase(path);
    expect(columns(db, 'stripe_events')).toEqual([
      'id',
      'type',
      'processed_at',
    ]);
    expect(columns(db, 'stripe_customers')).toEqual(['owner', 'customer_id']);
    db.close();
  });

  it('rejects a second ledger row for the same payment intent', () => {
    const db = openDatabase(path);
    db.exec("INSERT INTO balances VALUES ('0xa', 0)");
    const insert = db.prepare(
      `INSERT INTO ledger (owner, kind, amount, created_at, stripe_payment_intent)
       VALUES ('0xa', 'topup', 1, '2026-01-01', ?)`,
    );
    insert.run('pi_1');
    insert.run(null);
    insert.run(null);
    expect(() => insert.run('pi_1')).toThrow(/UNIQUE/);
    db.close();
  });
});

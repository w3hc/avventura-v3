import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type LedgerKind = 'llm' | 'topup' | 'adjustment';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS balances (
  owner TEXT PRIMARY KEY,
  amount INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL REFERENCES balances (owner),
  story TEXT,
  game TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('llm', 'topup', 'adjustment')),
  llm_cost INTEGER,
  amount INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  gross INTEGER,
  fee INTEGER,
  stripe_payment_intent TEXT
);

CREATE INDEX IF NOT EXISTS ledger_owner ON ledger (owner);

CREATE TABLE IF NOT EXISTS siwe_nonces (
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_address ON sessions (address);

CREATE TABLE IF NOT EXISTS stripe_customers (
  owner TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auto_topups (
  owner TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  amount INTEGER NOT NULL,
  threshold INTEGER NOT NULL,
  payment_method TEXT,
  paused_reason TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auto_topup_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  payment_intent TEXT,
  created_at TEXT NOT NULL
);
`;

// Columns added to tables that existing databases created without them
const ADDED_COLUMNS: Record<string, Record<string, string>> = {
  ledger: {
    gross: 'INTEGER',
    fee: 'INTEGER',
    stripe_payment_intent: 'TEXT',
  },
};

const INDEXES = `
CREATE UNIQUE INDEX IF NOT EXISTS ledger_stripe_payment_intent
  ON ledger (stripe_payment_intent) WHERE stripe_payment_intent IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS auto_topup_payments_pending
  ON auto_topup_payments (owner) WHERE status = 'pending';
`;

function migrate(db: Database.Database): void {
  for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
    const existing = new Set(
      db
        .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
        .all()
        .map((column) => column.name),
    );
    for (const [name, type] of Object.entries(columns)) {
      if (!existing.has(name)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
      }
    }
  }
  db.exec(INDEXES);
}

// Amounts are stored as integer micro-euros
const MICRO_PER_EUR = 1_000_000;

export const toMicro = (eur: number): number => Math.round(eur * MICRO_PER_EUR);

export const fromMicro = (micro: number): number => micro / MICRO_PER_EUR;

export const databasePath = (): string =>
  process.env.DATABASE_PATH || join(process.cwd(), 'data', 'avventura.db');

export function openDatabase(path: string = databasePath()): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.transaction(() => {
    db.exec(SCHEMA);
    migrate(db);
  }).immediate();
  return db;
}

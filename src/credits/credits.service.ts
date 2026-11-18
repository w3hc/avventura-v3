import {
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Database from 'better-sqlite3';
import { fromMicro, LedgerKind, openDatabase, toMicro } from './schema';

interface Movement {
  owner: string;
  kind: LedgerKind;
  amount: number;
  story?: string;
  game?: string;
  llmCost?: number;
}

interface Statements {
  db: Database.Database;
  balance: Database.Statement<[string], { amount: number }>;
  apply: (movement: Movement) => number;
  open: (owner: string, amount: number, story?: string) => number;
  moveStoryBalance: (slug: string, owner: string, initial: number) => number;
  spent: Database.Statement<[string], { story: string; amount: number }>;
}

@Injectable()
export class CreditsService implements OnModuleInit, OnModuleDestroy {
  private statements?: Statements;

  onModuleInit() {
    this.prepare();
  }

  onModuleDestroy() {
    this.statements?.db.close();
    this.statements = undefined;
  }

  // Opened lazily so the database path is resolved on first use
  private prepare(): Statements {
    if (this.statements) {
      return this.statements;
    }
    const db = openDatabase();
    const balance = db.prepare<[string], { amount: number }>(
      'SELECT amount FROM balances WHERE owner = ?',
    );
    const createBalance = db.prepare<[string]>(
      'INSERT INTO balances (owner, amount) VALUES (?, 0) ON CONFLICT DO NOTHING',
    );
    const updateBalance = db.prepare<[number, string], { amount: number }>(
      'UPDATE balances SET amount = amount + ? WHERE owner = ? RETURNING amount',
    );
    const insertLedger = db.prepare(
      `INSERT INTO ledger (owner, story, game, kind, llm_cost, amount, created_at)
       VALUES (@owner, @story, @game, @kind, @llmCost, @amount, @createdAt)`,
    );

    const move = (movement: Movement): number => {
      const amount = toMicro(movement.amount);
      const row = updateBalance.get(amount, movement.owner);
      if (!row) {
        throw new HttpException('Balance not found', HttpStatus.NOT_FOUND);
      }
      insertLedger.run({
        owner: movement.owner,
        story: movement.story ?? null,
        game: movement.game ?? null,
        kind: movement.kind,
        llmCost:
          movement.llmCost === undefined ? null : toMicro(movement.llmCost),
        amount,
        createdAt: new Date().toISOString(),
      });
      return fromMicro(row.amount);
    };

    const apply = db.transaction(move);
    const open = db.transaction(
      (owner: string, amount: number, story?: string): number => {
        if (createBalance.run(owner).changes === 0) {
          return fromMicro(balance.get(owner)!.amount);
        }
        return move({ owner, kind: 'adjustment', amount, story });
      },
    );

    const moveStoryBalance = db.transaction(
      (slug: string, owner: string, initial: number): number => {
        if (createBalance.run(slug).changes === 1) {
          move({
            owner: slug,
            kind: 'adjustment',
            amount: initial,
            story: slug,
          });
        }
        const amount = fromMicro(balance.get(slug)!.amount);
        if (amount === 0) {
          return 0;
        }
        createBalance.run(owner);
        move({ owner: slug, kind: 'adjustment', amount: -amount, story: slug });
        move({ owner, kind: 'adjustment', amount, story: slug });
        return amount;
      },
    );
    const spent = db.prepare<[string], { story: string; amount: number }>(
      `SELECT story, -SUM(amount) AS amount FROM ledger
       WHERE kind = 'llm' AND story IN (SELECT value FROM json_each(?))
       GROUP BY story`,
    );

    this.statements = {
      db,
      balance,
      apply: (movement) => apply.immediate(movement),
      open: (owner, amount, story) => open.immediate(owner, amount, story),
      moveStoryBalance: (slug, owner, initial) =>
        moveStoryBalance.immediate(slug, owner, initial),
      spent,
    };
    return this.statements;
  }

  // The owner's balance in EUR, or null if it has none yet
  balance(owner: string): number | null {
    const row = this.prepare().balance.get(owner);
    return row ? fromMicro(row.amount) : null;
  }

  // Opens a balance with an adjustment of `amount` EUR, unless it exists
  open(owner: string, amount: number, story?: string): number {
    return this.prepare().open(owner, amount, story);
  }

  charge(
    owner: string,
    entry: { story?: string; game?: string; llmCost: number; amount: number },
  ): number {
    return this.prepare().apply({
      owner,
      kind: 'llm',
      ...entry,
      amount: -entry.amount,
    });
  }

  topUp(owner: string, amount: number, story?: string): number {
    return this.prepare().apply({ owner, kind: 'topup', amount, story });
  }

  // Moves a story's balance to its owner, opening it at `initial` EUR if the
  // story has none yet. Returns the amount moved, 0 once already moved.
  moveStoryBalance(slug: string, owner: string, initial: number): number {
    return this.prepare().moveStoryBalance(slug, owner, initial);
  }

  // Total LLM debits per story in EUR, across every owner it has had
  spentByStory(slugs: string[]): Record<string, number> {
    const spent = Object.fromEntries(slugs.map((slug) => [slug, 0]));
    for (const row of this.prepare().spent.all(JSON.stringify(slugs))) {
      spent[row.story] = fromMicro(row.amount);
    }
    return spent;
  }
}

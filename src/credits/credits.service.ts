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
  gross?: number;
  fee?: number;
  stripePaymentIntent?: string;
}

// A paid Stripe PaymentIntent, amounts in EUR from its balance transaction
export interface StripePayment {
  eventId: string;
  eventType: string;
  owner: string;
  paymentIntent: string;
  gross: number;
  fee: number;
  // The auto top-up payment row this PaymentIntent pays, if any
  autoTopup?: number;
}

// Automatic top-up settings, amounts in EUR
export interface AutoTopup {
  enabled: boolean;
  amount: number;
  threshold: number;
  paymentMethod: string | null;
  pausedReason: string | null;
}

export interface AutoTopupSettings {
  enabled: boolean;
  amount?: number;
  threshold?: number;
}

// A pending auto top-up to charge to the owner's saved card
export interface AutoTopupClaim {
  id: number;
  owner: string;
  amount: number;
  paymentMethod: string;
}

// What GET /me and PUT /billing/auto-topup report, amounts in EUR
export interface AutoTopupState {
  enabled: boolean;
  amount: number;
  threshold: number;
  hasCard: boolean;
  paused: boolean;
  pausedReason: string | null;
}

export const autoTopupState = (settings: AutoTopup): AutoTopupState => ({
  enabled: settings.enabled,
  amount: settings.amount,
  threshold: settings.threshold,
  hasCard: settings.paymentMethod !== null,
  paused: settings.pausedReason !== null,
  pausedReason: settings.pausedReason,
});

// Used until the creator sets their own: add €10 when credits reach €5
export const DEFAULT_AUTO_TOPUP = { amount: 10, threshold: 5 };

interface AutoTopupRow {
  enabled: number;
  amount: number;
  threshold: number;
  payment_method: string | null;
  paused_reason: string | null;
}

interface Statements {
  db: Database.Database;
  balance: Database.Statement<[string], { amount: number }>;
  apply: (movement: Movement) => number;
  open: (owner: string, amount: number, story?: string) => number;
  moveStoryBalance: (slug: string, owner: string, initial: number) => number;
  spent: Database.Statement<[string], { story: string; amount: number }>;
  stripeEvent: Database.Statement<[string], { id: string }>;
  creditPayment: (payment: StripePayment, opening: number) => number | null;
  autoTopup: Database.Statement<[string], AutoTopupRow>;
  setAutoTopup: (owner: string, settings: AutoTopupSettings) => void;
  saveAutoTopupCard: (
    owner: string,
    paymentMethod: string,
    event: { id: string; type: string },
  ) => boolean;
  claimAutoTopup: (owner: string) => AutoTopupClaim | null;
  startAutoTopup: Database.Statement<[string, number]>;
  failAutoTopup: (id: number, owner: string, reason: string) => boolean;
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
      `INSERT INTO ledger (owner, story, game, kind, llm_cost, amount, created_at,
         gross, fee, stripe_payment_intent)
       VALUES (@owner, @story, @game, @kind, @llmCost, @amount, @createdAt,
         @gross, @fee, @stripePaymentIntent)`,
    );
    const stripeEvent = db.prepare<[string], { id: string }>(
      'SELECT id FROM stripe_events WHERE id = ?',
    );
    const insertStripeEvent = db.prepare<[string, string, string]>(
      `INSERT INTO stripe_events (id, type, processed_at) VALUES (?, ?, ?)
       ON CONFLICT DO NOTHING`,
    );
    const paymentCredited = db.prepare<[string], { id: number }>(
      'SELECT id FROM ledger WHERE stripe_payment_intent = ?',
    );
    const autoTopup = db.prepare<[string], AutoTopupRow>(
      `SELECT enabled, amount, threshold, payment_method, paused_reason
       FROM auto_topups WHERE owner = ?`,
    );
    const upsertAutoTopup = db.prepare(
      `INSERT INTO auto_topups (owner, enabled, amount, threshold, updated_at)
       VALUES (@owner, @enabled, @amount, @threshold, @now)
       ON CONFLICT (owner) DO UPDATE SET enabled = excluded.enabled,
         amount = excluded.amount, threshold = excluded.threshold,
         paused_reason = NULL, updated_at = excluded.updated_at`,
    );
    const upsertAutoTopupCard = db.prepare(
      `INSERT INTO auto_topups
         (owner, enabled, amount, threshold, payment_method, updated_at)
       VALUES (@owner, 0, @amount, @threshold, @paymentMethod, @now)
       ON CONFLICT (owner) DO UPDATE SET
         payment_method = excluded.payment_method, paused_reason = NULL,
         updated_at = excluded.updated_at`,
    );
    const insertAutoTopupPayment = db.prepare<
      [string, number, string],
      { id: number }
    >(
      `INSERT INTO auto_topup_payments (owner, amount, status, created_at)
       VALUES (?, ?, 'pending', ?) ON CONFLICT DO NOTHING RETURNING id`,
    );
    const startAutoTopup = db.prepare<[string, number]>(
      'UPDATE auto_topup_payments SET payment_intent = ? WHERE id = ?',
    );
    const endAutoTopup = db.prepare<[string, number, string]>(
      `UPDATE auto_topup_payments SET status = ?
       WHERE id = ? AND owner = ? AND status = 'pending'`,
    );
    const succeedAutoTopup = db.prepare<[string, number, string]>(
      `UPDATE auto_topup_payments SET status = 'succeeded', payment_intent = ?
       WHERE id = ? AND owner = ?`,
    );
    const pauseAutoTopup = db.prepare<[string, string, string]>(
      'UPDATE auto_topups SET paused_reason = ?, updated_at = ? WHERE owner = ?',
    );
    const optionalMicro = (eur?: number): number | null =>
      eur === undefined ? null : toMicro(eur);

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
        llmCost: optionalMicro(movement.llmCost),
        amount,
        createdAt: new Date().toISOString(),
        gross: optionalMicro(movement.gross),
        fee: optionalMicro(movement.fee),
        stripePaymentIntent: movement.stripePaymentIntent ?? null,
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
        createBalance.run(owner);
        const amount = fromMicro(balance.get(slug)!.amount);
        if (amount === 0) {
          return 0;
        }
        move({ owner: slug, kind: 'adjustment', amount: -amount, story: slug });
        move({ owner, kind: 'adjustment', amount, story: slug });
        return amount;
      },
    );
    const creditPayment = db.transaction(
      (payment: StripePayment, opening: number): number | null => {
        const now = new Date().toISOString();
        if (
          insertStripeEvent.run(payment.eventId, payment.eventType, now)
            .changes === 0 ||
          paymentCredited.get(payment.paymentIntent)
        ) {
          return null;
        }
        if (createBalance.run(payment.owner).changes === 1 && opening !== 0) {
          move({ owner: payment.owner, kind: 'adjustment', amount: opening });
        }
        if (payment.autoTopup !== undefined) {
          succeedAutoTopup.run(
            payment.paymentIntent,
            payment.autoTopup,
            payment.owner,
          );
        }
        return move({
          owner: payment.owner,
          kind: 'topup',
          amount: payment.gross - payment.fee,
          gross: payment.gross,
          fee: payment.fee,
          stripePaymentIntent: payment.paymentIntent,
        });
      },
    );
    const setAutoTopup = db.transaction(
      (owner: string, settings: AutoTopupSettings): void => {
        const existing = autoTopup.get(owner);
        upsertAutoTopup.run({
          owner,
          enabled: settings.enabled ? 1 : 0,
          amount:
            settings.amount === undefined
              ? (existing?.amount ?? toMicro(DEFAULT_AUTO_TOPUP.amount))
              : toMicro(settings.amount),
          threshold:
            settings.threshold === undefined
              ? (existing?.threshold ?? toMicro(DEFAULT_AUTO_TOPUP.threshold))
              : toMicro(settings.threshold),
          now: new Date().toISOString(),
        });
      },
    );
    const saveAutoTopupCard = db.transaction(
      (
        owner: string,
        paymentMethod: string,
        event: { id: string; type: string },
      ): boolean => {
        const now = new Date().toISOString();
        if (insertStripeEvent.run(event.id, event.type, now).changes === 0) {
          return false;
        }
        upsertAutoTopupCard.run({
          owner,
          amount: toMicro(DEFAULT_AUTO_TOPUP.amount),
          threshold: toMicro(DEFAULT_AUTO_TOPUP.threshold),
          paymentMethod,
          now,
        });
        return true;
      },
    );
    const claimAutoTopup = db.transaction(
      (owner: string): AutoTopupClaim | null => {
        const settings = autoTopup.get(owner);
        const current = balance.get(owner);
        if (
          !settings?.enabled ||
          !settings.payment_method ||
          settings.paused_reason !== null ||
          !current ||
          current.amount > settings.threshold
        ) {
          return null;
        }
        const row = insertAutoTopupPayment.get(
          owner,
          settings.amount,
          new Date().toISOString(),
        );
        return row
          ? {
              id: row.id,
              owner,
              amount: fromMicro(settings.amount),
              paymentMethod: settings.payment_method,
            }
          : null;
      },
    );
    const failAutoTopup = db.transaction(
      (id: number, owner: string, reason: string): boolean => {
        if (endAutoTopup.run('failed', id, owner).changes === 0) {
          return false;
        }
        pauseAutoTopup.run(reason, new Date().toISOString(), owner);
        return true;
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
      stripeEvent,
      creditPayment: (payment, opening) =>
        creditPayment.immediate(payment, opening),
      autoTopup,
      setAutoTopup: (owner, settings) =>
        setAutoTopup.immediate(owner, settings),
      saveAutoTopupCard: (owner, paymentMethod, event) =>
        saveAutoTopupCard.immediate(owner, paymentMethod, event),
      claimAutoTopup: (owner) => claimAutoTopup.immediate(owner),
      startAutoTopup,
      failAutoTopup: (id, owner, reason) =>
        failAutoTopup.immediate(id, owner, reason),
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

  hasStripeEvent(eventId: string): boolean {
    return this.prepare().stripeEvent.get(eventId) !== undefined;
  }

  // Records the event and credits the payment's net (gross - fee) as a top-up,
  // opening a missing balance at `opening` EUR first. Returns the new balance,
  // or null when the event or the PaymentIntent was already processed.
  creditPayment(payment: StripePayment, opening: number): number | null {
    return this.prepare().creditPayment(payment, opening);
  }

  // The owner's auto top-up settings, or null if never set
  autoTopup(owner: string): AutoTopup | null {
    const row = this.prepare().autoTopup.get(owner);
    return row
      ? {
          enabled: row.enabled === 1,
          amount: fromMicro(row.amount),
          threshold: fromMicro(row.threshold),
          paymentMethod: row.payment_method,
          pausedReason: row.paused_reason,
        }
      : null;
  }

  // Saves the settings, keeping the stored (or default) amount and threshold
  // when left out, and resumes a paused auto top-up
  setAutoTopup(owner: string, settings: AutoTopupSettings): AutoTopup {
    this.prepare().setAutoTopup(owner, settings);
    return this.autoTopup(owner)!;
  }

  // Stores the card saved by a setup Checkout and resumes a paused auto
  // top-up, once per event. Returns false for a replayed event.
  saveAutoTopupCard(
    owner: string,
    paymentMethod: string,
    event: { id: string; type: string },
  ): boolean {
    return this.prepare().saveAutoTopupCard(owner, paymentMethod, event);
  }

  // Records a pending auto top-up when the owner's settings are active and
  // the balance is at or below the threshold, unless one is pending already
  claimAutoTopup(owner: string): AutoTopupClaim | null {
    return this.prepare().claimAutoTopup(owner);
  }

  startAutoTopup(id: number, paymentIntent: string): void {
    this.prepare().startAutoTopup.run(paymentIntent, id);
  }

  // Marks a pending auto top-up failed and pauses the owner's auto top-up.
  // Returns false when it was no longer pending.
  failAutoTopup(id: number, owner: string, reason: string): boolean {
    return this.prepare().failAutoTopup(id, owner, reason);
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

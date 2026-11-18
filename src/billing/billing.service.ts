import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import Database from 'better-sqlite3';
import Stripe from 'stripe';
import {
  AutoTopupClaim,
  AutoTopupSettings,
  AutoTopupState,
  autoTopupState,
  CreditsService,
} from '../credits/credits.service';
import { openDatabase } from '../credits/schema';
import { STRIPE_CLIENT } from './stripe.client';

export const MIN_TOPUP = 5;
export const MAX_TOPUP = 500;

export const DEFAULT_RETURN_URL = 'https://avventura.fun/dashboard';

export const INVOICE_FOOTER = 'TVA non applicable, art. 293 B du CGI';

export type PaymentKind = 'topup' | 'auto_topup';

interface Statements {
  db: Database.Database;
  customer: Database.Statement<[string], { customer_id: string }>;
  insertCustomer: Database.Statement<[string, string]>;
  replaceCustomer: Database.Statement<[string, string, string]>;
}

const returnUrl = (
  ...[param, value]:
    ['topup', 'success' | 'cancel'] | ['card', 'saved' | 'cancel']
): string => {
  const url = new URL(process.env.BILLING_RETURN_URL || DEFAULT_RETURN_URL);
  url.searchParams.set(param, value);
  return url.toString();
};

// Stripe errors after which the same request may still succeed
const isTransient = (error: Stripe.errors.StripeError): boolean =>
  error instanceof Stripe.errors.StripeConnectionError ||
  error instanceof Stripe.errors.StripeAPIError ||
  error instanceof Stripe.errors.StripeRateLimitError;

const sessionUrl = (session: Stripe.Checkout.Session): string => {
  if (!session.url) {
    throw new BadGatewayException('Stripe returned no checkout URL');
  }
  return session.url;
};

const isMissingCustomer = (error: unknown): boolean =>
  error instanceof Stripe.errors.StripeInvalidRequestError &&
  error.code === 'resource_missing' &&
  error.param === 'customer';

@Injectable()
export class BillingService implements OnModuleDestroy {
  private readonly logger = new Logger(BillingService.name);
  private statements?: Statements;

  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe | null,
    private readonly creditsService: CreditsService,
  ) {}

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
    this.statements = {
      db,
      customer: db.prepare(
        'SELECT customer_id FROM stripe_customers WHERE owner = ?',
      ),
      insertCustomer: db.prepare(
        `INSERT INTO stripe_customers (owner, customer_id) VALUES (?, ?)
         ON CONFLICT DO NOTHING`,
      ),
      replaceCustomer: db.prepare(
        `UPDATE stripe_customers SET customer_id = ?
         WHERE owner = ? AND customer_id = ?`,
      ),
    };
    return this.statements;
  }

  // Both are required, so no payment is taken that the webhook can't credit
  private configured(): { stripe: Stripe; webhookSecret: string } {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!this.stripe || !webhookSecret) {
      throw new ServiceUnavailableException('Billing is not configured');
    }
    return { stripe: this.stripe, webhookSecret };
  }

  // Stripe errors become 502 so the caller sees the upstream failed
  private async call<T>(action: string, request: Promise<T>): Promise<T> {
    try {
      return await request;
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError) {
        this.logger.error(`Stripe failed to ${action}: ${error.message}`);
        throw new BadGatewayException(`Stripe failed to ${action}`);
      }
      throw error;
    }
  }

  // The owner's Stripe Customer id, created on first use, or again when
  // Stripe no longer knows the `stale` one (deleted, or from test mode)
  async customerFor(owner: string, stale?: string): Promise<string> {
    const statements = this.prepare();
    const existing = statements.customer.get(owner)?.customer_id;
    if (existing && existing !== stale) {
      return existing;
    }
    const customer = await this.call(
      'create the customer',
      this.configured().stripe.customers.create(
        { metadata: { owner } },
        stale ? undefined : { idempotencyKey: `customer-${owner}` },
      ),
    );
    if (stale) {
      statements.replaceCustomer.run(customer.id, owner, stale);
    } else {
      statements.insertCustomer.run(owner, customer.id);
    }
    return statements.customer.get(owner)!.customer_id;
  }

  // Runs `request` with the owner's Customer, once more with a new one if
  // Stripe no longer has it
  private async withCustomer<T>(
    owner: string,
    action: string,
    request: (customer: string) => Promise<T>,
  ): Promise<T> {
    const customer = await this.customerFor(owner);
    return this.call(
      action,
      request(customer).catch(async (error: unknown) => {
        if (!isMissingCustomer(error)) {
          throw error;
        }
        this.logger.warn(`Stripe no longer has ${customer}, creating another`);
        return request(await this.customerFor(owner, customer));
      }),
    );
  }

  // A Checkout Session for paying `amount` EUR, credited net of the fee
  async checkout(owner: string, amount: number): Promise<{ url: string }> {
    const { stripe } = this.configured();
    const metadata = { kind: 'topup' satisfies PaymentKind, owner };
    const session = await this.withCustomer(
      owner,
      'create the checkout session',
      (customer) =>
        stripe.checkout.sessions.create({
          mode: 'payment',
          customer,
          allowed_payment_method_types: ['card'],
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: 'eur',
                unit_amount: Math.round(amount * 100),
                product_data: { name: 'Avventura credits' },
              },
            },
          ],
          success_url: returnUrl('topup', 'success'),
          cancel_url: returnUrl('topup', 'cancel'),
          metadata,
          payment_intent_data: { metadata },
          invoice_creation: {
            enabled: true,
            invoice_data: { footer: INVOICE_FOOTER, metadata },
          },
        }),
    );
    const url = sessionUrl(session);
    this.logger.log(`Checkout of €${amount} started for ${owner}`);
    return { url };
  }

  // A setup-mode Checkout Session that saves a card for auto top-ups
  async setupAutoTopup(owner: string): Promise<{ url: string }> {
    const { stripe } = this.configured();
    const metadata = { kind: 'auto_topup_setup', owner };
    const session = await this.withCustomer(
      owner,
      'create the setup session',
      (customer) =>
        stripe.checkout.sessions.create({
          mode: 'setup',
          currency: 'eur',
          customer,
          allowed_payment_method_types: ['card'],
          success_url: returnUrl('card', 'saved'),
          cancel_url: returnUrl('card', 'cancel'),
          metadata,
          setup_intent_data: { metadata },
        }),
    );
    const url = sessionUrl(session);
    this.logger.log(`Card setup started for ${owner}`);
    return { url };
  }

  setAutoTopup(owner: string, settings: AutoTopupSettings): AutoTopupState {
    this.configured();
    const saved = this.creditsService.setAutoTopup(owner, settings);
    this.logger.log(
      `Auto top-up for ${owner} ${saved.enabled ? `on: €${saved.amount} at €${saved.threshold}` : 'off'}`,
    );
    this.checkAutoTopup(owner);
    return autoTopupState(saved);
  }

  // Claims an auto top-up if the balance calls for one and charges it in the
  // background. Called after each debit, on a 402, and when the settings or
  // the card change. Never throws, so the caller doesn't wait or fail.
  checkAutoTopup(owner: string): void {
    if (!this.stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
      return;
    }
    let claim: AutoTopupClaim | null;
    try {
      claim = this.creditsService.claimAutoTopup(owner);
    } catch (error) {
      this.logger.error(
        `Failed to check ${owner}'s auto top-up: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return;
    }
    if (claim) {
      void this.chargeAutoTopup(claim).catch((error: unknown) =>
        this.logger.error(
          `Auto top-up ${claim.id} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ),
      );
    }
  }

  // Charges a claimed auto top-up to the saved card, off-session. The
  // idempotency key comes from the claim, so it is charged at most once.
  // A payment Stripe refuses pauses auto top-up; after a transient error the
  // claim stays pending and is retried (see AUTO_TOPUP_RETRY_MS).
  async chargeAutoTopup(claim: AutoTopupClaim): Promise<void> {
    const { stripe } = this.configured();
    const { id, owner, amount, paymentMethod } = claim;
    let intent: Stripe.PaymentIntent;
    try {
      intent = await stripe.paymentIntents.create(
        {
          amount: Math.round(amount * 100),
          currency: 'eur',
          customer: await this.customerFor(owner),
          payment_method: paymentMethod,
          allowed_payment_method_types: ['card'],
          off_session: true,
          confirm: true,
          description: 'Avventura credits, automatic top-up',
          metadata: {
            kind: 'auto_topup' satisfies PaymentKind,
            owner,
            pending_id: String(id),
          },
        },
        { idempotencyKey: `auto-topup-${id}` },
      );
    } catch (error) {
      if (!(error instanceof Stripe.errors.StripeError) || isTransient(error)) {
        this.logger.warn(
          `Auto top-up ${id} for ${owner} will be retried: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        return;
      }
      if (error.payment_intent) {
        this.creditsService.startAutoTopup(id, error.payment_intent.id);
      }
      this.pauseAutoTopup(id, owner, error.code ?? error.rawType ?? error.type);
      return;
    }
    this.creditsService.startAutoTopup(id, intent.id);
    if (intent.status === 'succeeded' || intent.status === 'processing') {
      this.logger.log(`Auto top-up of €${amount} for ${owner}: ${intent.id}`);
      return;
    }
    this.pauseAutoTopup(
      id,
      owner,
      intent.status === 'requires_action'
        ? 'requires_action'
        : (intent.last_payment_error?.code ?? intent.status),
    );
  }

  private pauseAutoTopup(id: number, owner: string, reason: string): void {
    if (this.creditsService.failAutoTopup(id, owner, reason)) {
      this.logger.warn(`Auto top-up paused for ${owner}: ${reason}`);
    }
  }

  // Verifies the signature of a webhook payload and handles its event
  async handleWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<void> {
    const { stripe, webhookSecret } = this.configured();
    if (!rawBody || !signature) {
      throw new BadRequestException('Missing Stripe signature');
    }
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch {
      throw new BadRequestException('Invalid Stripe signature');
    }
    if (this.creditsService.hasStripeEvent(event.id)) {
      this.logger.log(`Stripe event ${event.id} already processed`);
      return;
    }
    if (event.type === 'checkout.session.completed') {
      await this.onCheckoutCompleted(event);
    } else if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      if (intent.metadata.kind === 'auto_topup') {
        await this.creditPaymentIntent(event, intent.id, 'auto_topup');
      }
    } else if (event.type === 'payment_intent.payment_failed') {
      this.onAutoTopupFailed(event.data.object);
    }
  }

  private onAutoTopupFailed(intent: Stripe.PaymentIntent): void {
    const id = Number(intent.metadata.pending_id);
    const owner = intent.metadata.owner?.toLowerCase();
    if (intent.metadata.kind !== 'auto_topup' || !owner || !id) {
      return;
    }
    this.pauseAutoTopup(
      id,
      owner,
      intent.last_payment_error?.code ?? 'payment_failed',
    );
  }

  private async onCheckoutCompleted(
    event: Stripe.CheckoutSessionCompletedEvent,
  ): Promise<void> {
    const session = event.data.object;
    if (
      session.mode === 'setup' &&
      session.metadata?.kind === 'auto_topup_setup'
    ) {
      return this.onCardSaved(event);
    }
    if (
      session.mode !== 'payment' ||
      session.payment_status !== 'paid' ||
      session.metadata?.kind !== 'topup'
    ) {
      return;
    }
    const intent = session.payment_intent;
    if (!intent) {
      this.logger.error(`Paid session ${session.id} has no PaymentIntent`);
      return;
    }
    await this.creditPaymentIntent(
      event,
      typeof intent === 'string' ? intent : intent.id,
      'topup',
    );
  }

  // Stores the card of a completed setup session as the auto top-up card
  private async onCardSaved(
    event: Stripe.CheckoutSessionCompletedEvent,
  ): Promise<void> {
    const session = event.data.object;
    const owner = session.metadata?.owner?.toLowerCase();
    const setupIntent = session.setup_intent;
    if (!owner || !setupIntent) {
      this.logger.error(`Setup session ${session.id} has no owner or intent`);
      return;
    }
    const intent = await this.call(
      'retrieve the card setup',
      this.configured().stripe.setupIntents.retrieve(
        typeof setupIntent === 'string' ? setupIntent : setupIntent.id,
      ),
    );
    const card = intent.payment_method;
    if (intent.status !== 'succeeded' || !card) {
      this.logger.warn(`Skipped ${intent.id}: ${intent.status}`);
      return;
    }
    const paymentMethod = typeof card === 'string' ? card : card.id;
    if (this.creditsService.saveAutoTopupCard(owner, paymentMethod, event)) {
      this.logger.log(`Saved ${paymentMethod} for ${owner}'s auto top-up`);
      this.checkAutoTopup(owner);
    }
  }

  // Credits the net (amount - Stripe fee) of a succeeded PaymentIntent of
  // `kind` to the owner in its metadata, once per event and PaymentIntent.
  // Returns the new balance, or null when nothing was credited.
  async creditPaymentIntent(
    event: Stripe.Event,
    paymentIntentId: string,
    kind: PaymentKind,
  ): Promise<number | null> {
    const intent = await this.call(
      'retrieve the payment',
      this.configured().stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['latest_charge.balance_transaction'],
      }),
    );
    const owner = intent.metadata.owner?.toLowerCase();
    if (intent.status !== 'succeeded' || intent.metadata.kind !== kind) {
      this.logger.warn(
        `Skipped ${intent.id}: ${intent.status}, kind ${intent.metadata.kind}`,
      );
      return null;
    }
    if (!owner) {
      this.logger.error(`Skipped ${intent.id}: no owner in its metadata`);
      return null;
    }
    const charge = intent.latest_charge;
    const transaction =
      charge && typeof charge !== 'string' ? charge.balance_transaction : null;
    // Thrown as 500 so Stripe retries once the balance transaction exists
    if (!transaction || typeof transaction === 'string') {
      throw new Error(`${intent.id} has no balance transaction yet`);
    }
    // Acknowledged so Stripe doesn't retry what can't change: credit by hand
    if (transaction.currency !== 'eur') {
      this.logger.error(
        `Skipped ${intent.id}: settled in ${transaction.currency}, expected eur`,
      );
      return null;
    }
    const pendingId = Number(intent.metadata.pending_id);
    const balance = this.creditsService.creditPayment({
      eventId: event.id,
      eventType: event.type,
      owner,
      paymentIntent: intent.id,
      gross: transaction.amount / 100,
      fee: transaction.fee / 100,
      autoTopup:
        kind === 'auto_topup' && Number.isInteger(pendingId)
          ? pendingId
          : undefined,
    });
    if (balance === null) {
      this.logger.log(`${intent.id} already credited`);
    } else {
      this.logger.log(
        `Credited €${transaction.net / 100} to ${owner} from ${intent.id}, balance now €${balance}`,
      );
    }
    return balance;
  }
}

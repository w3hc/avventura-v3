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
import { DEFAULT_CREDITS } from '../app.service';
import { CreditsService } from '../credits/credits.service';
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
}

const returnUrl = (topup: 'success' | 'cancel'): string => {
  const url = new URL(process.env.BILLING_RETURN_URL || DEFAULT_RETURN_URL);
  url.searchParams.set('topup', topup);
  return url.toString();
};

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
    };
    return this.statements;
  }

  private client(): Stripe {
    if (!this.stripe) {
      throw new ServiceUnavailableException('Billing is not configured');
    }
    return this.stripe;
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

  // The owner's Stripe Customer id, created on first use
  async customerFor(owner: string): Promise<string> {
    const statements = this.prepare();
    const existing = statements.customer.get(owner);
    if (existing) {
      return existing.customer_id;
    }
    const customer = await this.call(
      'create the customer',
      this.client().customers.create({ metadata: { owner } }),
    );
    statements.insertCustomer.run(owner, customer.id);
    return statements.customer.get(owner)!.customer_id;
  }

  // A Checkout Session for `amount` EUR of credits for `owner`
  async checkout(owner: string, amount: number): Promise<{ url: string }> {
    const stripe = this.client();
    const customer = await this.customerFor(owner);
    const metadata = { kind: 'topup' satisfies PaymentKind, owner };
    const session = await this.call(
      'create the checkout session',
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
        success_url: returnUrl('success'),
        cancel_url: returnUrl('cancel'),
        metadata,
        payment_intent_data: { metadata },
        invoice_creation: {
          enabled: true,
          invoice_data: { footer: INVOICE_FOOTER, metadata },
        },
      }),
    );
    if (!session.url) {
      throw new BadGatewayException('Stripe returned no checkout URL');
    }
    this.logger.log(`Checkout of €${amount} started for ${owner}`);
    return { url: session.url };
  }

  // Verifies the signature of a webhook payload and handles its event
  async handleWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<void> {
    const stripe = this.client();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException('Billing is not configured');
    }
    if (!rawBody || !signature) {
      throw new BadRequestException('Missing Stripe signature');
    }
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new BadRequestException('Invalid Stripe signature');
    }
    if (this.creditsService.hasStripeEvent(event.id)) {
      this.logger.log(`Stripe event ${event.id} already processed`);
      return;
    }
    if (event.type === 'checkout.session.completed') {
      await this.onCheckoutCompleted(event);
    }
  }

  private async onCheckoutCompleted(
    event: Stripe.CheckoutSessionCompletedEvent,
  ): Promise<void> {
    const session = event.data.object;
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
      this.client().paymentIntents.retrieve(paymentIntentId, {
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
    if (transaction.currency !== 'eur') {
      throw new Error(
        `${intent.id} settled in ${transaction.currency}, expected eur`,
      );
    }
    const balance = this.creditsService.creditPayment(
      {
        eventId: event.id,
        eventType: event.type,
        owner,
        paymentIntent: intent.id,
        gross: transaction.amount / 100,
        fee: transaction.fee / 100,
      },
      DEFAULT_CREDITS,
    );
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

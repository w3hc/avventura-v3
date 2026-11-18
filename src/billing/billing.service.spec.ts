import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Stripe from 'stripe';
import { CreditsService } from '../credits/credits.service';
import { BillingService, INVOICE_FOOTER } from './billing.service';

const OWNER = '0x1111111111111111111111111111111111111111';
const SECRET = 'whsec_test';
const signer = new Stripe('sk_test_unused');

const checkoutCompleted = (
  session: Record<string, unknown> = {},
  id = 'evt_1',
) => ({
  id,
  object: 'event',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_1',
      object: 'checkout.session',
      mode: 'payment',
      payment_status: 'paid',
      payment_intent: 'pi_1',
      metadata: { kind: 'topup', owner: OWNER },
      ...session,
    },
  },
});

const signed = (
  event: object,
  secret = SECRET,
): { body: Buffer; signature: string } => {
  const payload = JSON.stringify(event);
  return {
    body: Buffer.from(payload),
    signature: signer.webhooks.generateTestHeaderString({ payload, secret }),
  };
};

const paymentIntent = (
  transaction: Record<string, unknown> | null = {
    amount: 1000,
    fee: 59,
    net: 941,
    currency: 'eur',
  },
) => ({
  id: 'pi_1',
  status: 'succeeded',
  metadata: { kind: 'topup', owner: OWNER },
  latest_charge: { id: 'ch_1', balance_transaction: transaction },
});

describe('BillingService', () => {
  let credits: CreditsService;
  let billing: BillingService;
  let stripe: {
    customers: { create: jest.Mock };
    checkout: { sessions: { create: jest.Mock } };
    paymentIntents: { retrieve: jest.Mock };
    webhooks: Stripe['webhooks'];
  };

  beforeEach(() => {
    process.env.DATABASE_PATH = join(
      mkdtempSync(join(tmpdir(), 'billing-')),
      'test.db',
    );
    delete process.env.BILLING_RETURN_URL;
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    stripe = {
      paymentIntents: {
        retrieve: jest.fn().mockResolvedValue(paymentIntent()),
      },
      webhooks: signer.webhooks,
      customers: { create: jest.fn().mockResolvedValue({ id: 'cus_1' }) },
      checkout: {
        sessions: {
          create: jest
            .fn()
            .mockResolvedValue({ url: 'https://checkout.stripe.com/c/1' }),
        },
      },
    };
    credits = new CreditsService();
    billing = new BillingService(stripe as unknown as Stripe, credits);
  });

  afterEach(() => {
    billing.onModuleDestroy();
    credits.onModuleDestroy();
    delete process.env.DATABASE_PATH;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  describe('checkout', () => {
    it('creates a card payment session for the amount in cents', async () => {
      await expect(billing.checkout(OWNER, 12.5)).resolves.toEqual({
        url: 'https://checkout.stripe.com/c/1',
      });
      const metadata = { kind: 'topup', owner: OWNER };
      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith({
        mode: 'payment',
        customer: 'cus_1',
        allowed_payment_method_types: ['card'],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'eur',
              unit_amount: 1250,
              product_data: { name: 'Avventura credits' },
            },
          },
        ],
        success_url: 'https://avventura.fun/dashboard?topup=success',
        cancel_url: 'https://avventura.fun/dashboard?topup=cancel',
        metadata,
        payment_intent_data: { metadata },
        invoice_creation: {
          enabled: true,
          invoice_data: { footer: INVOICE_FOOTER, metadata },
        },
      });
    });

    it('returns to BILLING_RETURN_URL', async () => {
      process.env.BILLING_RETURN_URL = 'http://localhost:3001/dashboard';
      await billing.checkout(OWNER, 5);
      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          success_url: 'http://localhost:3001/dashboard?topup=success',
          cancel_url: 'http://localhost:3001/dashboard?topup=cancel',
        }),
      );
    });

    it('creates one customer per address', async () => {
      await billing.checkout(OWNER, 5);
      await billing.checkout(OWNER, 6);
      expect(stripe.customers.create).toHaveBeenCalledTimes(1);
      expect(stripe.customers.create).toHaveBeenCalledWith(
        { metadata: { owner: OWNER } },
        { idempotencyKey: `customer-${OWNER}` },
      );
    });

    it('replaces a customer Stripe no longer has', async () => {
      await billing.checkout(OWNER, 5);
      stripe.customers.create.mockResolvedValue({ id: 'cus_2' });
      stripe.checkout.sessions.create.mockRejectedValueOnce(
        new Stripe.errors.StripeInvalidRequestError({
          message: 'No such customer',
          code: 'resource_missing',
          param: 'customer',
        }),
      );
      await expect(billing.checkout(OWNER, 5)).resolves.toEqual({
        url: 'https://checkout.stripe.com/c/1',
      });
      expect(stripe.customers.create).toHaveBeenLastCalledWith(
        { metadata: { owner: OWNER } },
        undefined,
      );
      expect(stripe.checkout.sessions.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ customer: 'cus_2' }),
      );
      await billing.checkout(OWNER, 5);
      expect(stripe.customers.create).toHaveBeenCalledTimes(2);
    });

    it('returns 502 when Stripe fails', async () => {
      stripe.checkout.sessions.create.mockRejectedValue(
        new Stripe.errors.StripeAPIError({ message: 'down' }),
      );
      await expect(billing.checkout(OWNER, 5)).rejects.toThrow(
        BadGatewayException,
      );
    });

    it('returns 503 without STRIPE_WEBHOOK_SECRET', async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      await expect(billing.checkout(OWNER, 5)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('returns 503 without a Stripe client', async () => {
      const unconfigured = new BillingService(null, credits);
      await expect(unconfigured.checkout(OWNER, 5)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('handleWebhook', () => {
    const deliver = ({
      body,
      signature,
    }: {
      body: Buffer;
      signature: string;
    }) => billing.handleWebhook(body, signature);

    it('credits the net of a paid checkout', async () => {
      credits.open(OWNER, 1);
      await deliver(signed(checkoutCompleted()));
      expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_1', {
        expand: ['latest_charge.balance_transaction'],
      });
      expect(credits.balance(OWNER)).toBe(10.41);
    });

    it('opens a missing balance at the default credits', async () => {
      await deliver(signed(checkoutCompleted()));
      expect(credits.balance(OWNER)).toBe(109.41);
    });

    it('credits nothing for a replayed event', async () => {
      const delivery = signed(checkoutCompleted());
      await deliver(delivery);
      await deliver(delivery);
      await deliver(signed(checkoutCompleted()));
      expect(credits.balance(OWNER)).toBe(109.41);
      expect(stripe.paymentIntents.retrieve).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['an unpaid session', { payment_status: 'unpaid' }],
      ['a setup session', { mode: 'setup', payment_intent: null }],
      ['another kind', { metadata: { kind: 'other', owner: OWNER } }],
    ])('ignores %s', async (_name, session) => {
      await deliver(signed(checkoutCompleted(session)));
      expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
      expect(credits.balance(OWNER)).toBeNull();
    });

    it('ignores other event types', async () => {
      await deliver(
        signed({ ...checkoutCompleted(), type: 'checkout.session.expired' }),
      );
      expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    });

    it('skips a PaymentIntent of another kind', async () => {
      stripe.paymentIntents.retrieve.mockResolvedValue({
        ...paymentIntent(),
        metadata: { kind: 'auto_topup', owner: OWNER },
      });
      await deliver(signed(checkoutCompleted()));
      expect(credits.balance(OWNER)).toBeNull();
    });

    it('fails without a balance transaction, then credits on retry', async () => {
      const delivery = signed(checkoutCompleted());
      stripe.paymentIntents.retrieve.mockResolvedValueOnce(paymentIntent(null));
      await expect(deliver(delivery)).rejects.toThrow(
        'pi_1 has no balance transaction yet',
      );
      expect(credits.hasStripeEvent('evt_1')).toBe(false);
      await deliver(delivery);
      expect(credits.balance(OWNER)).toBe(109.41);
    });

    it('acknowledges a payment not settled in euros without crediting', async () => {
      stripe.paymentIntents.retrieve.mockResolvedValue(
        paymentIntent({ amount: 1100, fee: 60, net: 1040, currency: 'usd' }),
      );
      await deliver(signed(checkoutCompleted()));
      expect(credits.balance(OWNER)).toBeNull();
    });

    it('rejects a missing signature with 400', async () => {
      const { body } = signed(checkoutCompleted());
      await expect(billing.handleWebhook(body, undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a signature from another secret with 400', async () => {
      await expect(
        deliver(signed(checkoutCompleted(), 'whsec_other')),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a tampered payload with 400', async () => {
      const { signature } = signed(checkoutCompleted());
      const body = Buffer.from(
        JSON.stringify(checkoutCompleted({}, 'evt_forged')),
      );
      await expect(billing.handleWebhook(body, signature)).rejects.toThrow(
        BadRequestException,
      );
      expect(credits.balance(OWNER)).toBeNull();
    });

    it('returns 503 without STRIPE_WEBHOOK_SECRET', async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      await expect(deliver(signed(checkoutCompleted()))).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});

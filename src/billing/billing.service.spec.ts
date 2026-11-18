import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Stripe from 'stripe';
import { CreditsService } from '../credits/credits.service';
import { BillingService, INVOICE_FOOTER } from './billing.service';

const OWNER = '0x1111111111111111111111111111111111111111';

describe('BillingService', () => {
  let credits: CreditsService;
  let billing: BillingService;
  let stripe: {
    customers: { create: jest.Mock };
    checkout: { sessions: { create: jest.Mock } };
  };

  beforeEach(() => {
    process.env.DATABASE_PATH = join(
      mkdtempSync(join(tmpdir(), 'billing-')),
      'test.db',
    );
    delete process.env.BILLING_RETURN_URL;
    stripe = {
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
      expect(stripe.customers.create).toHaveBeenCalledWith({
        metadata: { owner: OWNER },
      });
    });

    it('returns 502 when Stripe fails', async () => {
      stripe.checkout.sessions.create.mockRejectedValue(
        new Stripe.errors.StripeAPIError({ message: 'down' }),
      );
      await expect(billing.checkout(OWNER, 5)).rejects.toThrow(
        BadGatewayException,
      );
    });

    it('returns 503 without a Stripe client', async () => {
      const unconfigured = new BillingService(null, credits);
      await expect(unconfigured.checkout(OWNER, 5)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});

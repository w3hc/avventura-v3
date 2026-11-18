import { Logger, Provider } from '@nestjs/common';
import Stripe from 'stripe';

export const STRIPE_CLIENT = Symbol('STRIPE_CLIENT');

// The version stripe-node's types are generated for
export const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-10-28.endive';

// Null without STRIPE_SECRET_KEY, so the app boots and billing returns 503
export const stripeClientProvider: Provider = {
  provide: STRIPE_CLIENT,
  useFactory: (): Stripe | null => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      new Logger('Billing').warn(
        'STRIPE_SECRET_KEY is not set: billing routes return 503',
      );
      return null;
    }
    return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  },
};

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Wallet } from 'ethers';
import Stripe from 'stripe';
import request from 'supertest';
import { App } from 'supertest/types';
import { createSiweMessage } from 'w3pk';
import { AppModule } from './../src/app.module';
import { AppService } from './../src/app.service';
import { STRIPE_CLIENT } from './../src/billing/stripe.client';
import { CreditsService } from './../src/credits/credits.service';

process.env.DATABASE_PATH = ':memory:';

const SECRET = 'whsec_e2e';
const wallet = Wallet.createRandom();
const owner = wallet.address.toLowerCase();
const signer = new Stripe('sk_test_unused');

const checkoutCompleted = (id = 'evt_1') =>
  JSON.stringify({
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
        metadata: { kind: 'topup', owner },
      },
    },
  });

const stripeMock = {
  customers: { create: jest.fn() },
  checkout: { sessions: { create: jest.fn() } },
  paymentIntents: { retrieve: jest.fn() },
  webhooks: signer.webhooks,
};

async function createApp(stripe: unknown): Promise<INestApplication<App>> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(AppService)
    .useValue({})
    .overrideProvider(STRIPE_CLIENT)
    .useValue(stripe)
    .compile();
  const app = moduleFixture.createNestApplication<INestApplication<App>>({
    rawBody: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();
  return app;
}

async function bearer(
  app: INestApplication<App>,
): Promise<Record<string, string>> {
  const {
    body: { nonce },
  } = (await request(app.getHttpServer()).get('/auth/nonce').expect(200)) as {
    body: { nonce: string };
  };
  const now = Date.now();
  const message = createSiweMessage({
    domain: 'avventura.fun',
    address: wallet.address,
    statement: 'Sign in to Avventura',
    uri: 'https://avventura.fun',
    version: '1',
    chainId: 1,
    nonce,
    issuedAt: new Date(now).toISOString(),
    expirationTime: new Date(now + 5 * 60 * 1000).toISOString(),
  });
  const res = await request(app.getHttpServer())
    .post('/auth/siwe')
    .send({ message, signature: await wallet.signMessage(message) })
    .expect(200);
  return { Authorization: `Bearer ${(res.body as { token: string }).token}` };
}

describe('Billing (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    stripeMock.customers.create.mockResolvedValue({ id: 'cus_1' });
    stripeMock.checkout.sessions.create.mockResolvedValue({
      url: 'https://checkout.stripe.com/c/1',
    });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_1',
      status: 'succeeded',
      metadata: { kind: 'topup', owner },
      latest_charge: {
        id: 'ch_1',
        balance_transaction: {
          amount: 2000,
          fee: 55,
          net: 1945,
          currency: 'eur',
        },
      },
    });
    app = await createApp(stripeMock);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    delete process.env.STRIPE_WEBHOOK_SECRET;
    await app.close();
  });

  const webhook = (payload: string, signature?: string) => {
    const req = request(app.getHttpServer())
      .post('/billing/webhook')
      .set('Content-Type', 'application/json');
    return (signature ? req.set('stripe-signature', signature) : req).send(
      payload,
    );
  };

  const sign = (payload: string, secret = SECRET) =>
    signer.webhooks.generateTestHeaderString({ payload, secret });

  it('/billing/checkout (POST) - requires a session', async () => {
    await request(app.getHttpServer())
      .post('/billing/checkout')
      .send({ amount: 20 })
      .expect(401);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('/billing/checkout (POST) - returns the Checkout URL', async () => {
    const headers = await bearer(app);
    await request(app.getHttpServer())
      .post('/billing/checkout')
      .set(headers)
      .send({ amount: 20 })
      .expect(201, { url: 'https://checkout.stripe.com/c/1' });
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { kind: 'topup', owner },
        payment_intent_data: { metadata: { kind: 'topup', owner } },
      }),
    );
  });

  it.each([4.99, 500.01, 'abc'])(
    '/billing/checkout (POST) - rejects the amount %p',
    async (amount) => {
      const headers = await bearer(app);
      await request(app.getHttpServer())
        .post('/billing/checkout')
        .set(headers)
        .send({ amount })
        .expect(400);
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    },
  );

  it('/billing/webhook (POST) - credits the net of a paid checkout once', async () => {
    const payload = checkoutCompleted();
    const signature = sign(payload);
    await webhook(payload, signature).expect(200, { received: true });
    await webhook(payload, signature).expect(200, { received: true });
    expect(app.get(CreditsService).balance(owner)).toBe(119.45);
  });

  it('/billing/webhook (POST) - rejects a missing signature', async () => {
    await webhook(checkoutCompleted()).expect(400);
    expect(app.get(CreditsService).balance(owner)).toBeNull();
  });

  it('/billing/webhook (POST) - rejects a bad signature', async () => {
    const payload = checkoutCompleted();
    await webhook(payload, sign(payload, 'whsec_other')).expect(400);
    await webhook(payload, 't=1,v1=00').expect(400);
    expect(app.get(CreditsService).balance(owner)).toBeNull();
  });
});

describe('Billing without Stripe (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    app = await createApp(null);
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 503 on billing routes and serves the others', async () => {
    const headers = await bearer(app);
    await request(app.getHttpServer())
      .post('/billing/checkout')
      .set(headers)
      .send({ amount: 20 })
      .expect(503);
    await request(app.getHttpServer())
      .post('/billing/webhook')
      .send(checkoutCompleted())
      .expect(503);
  });
});

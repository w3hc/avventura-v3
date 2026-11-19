import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Wallet } from 'ethers';
import Stripe from 'stripe';
import request from 'supertest';
import { App } from 'supertest/types';
import { createSiweMessage } from 'w3pk';
import { AppModule } from './../src/app.module';
import { AppService, Me } from './../src/app.service';
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
  paymentIntents: { retrieve: jest.fn(), create: jest.fn() },
  setupIntents: { retrieve: jest.fn() },
  webhooks: signer.webhooks,
};

async function createApp(
  stripe: unknown,
  appService: 'mock' | 'real' = 'mock',
): Promise<INestApplication<App>> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (appService === 'mock') {
    builder.overrideProvider(AppService).useValue({});
  }
  const moduleFixture = await builder
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
    expect(app.get(CreditsService).balance(owner)).toBe(19.45);
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

describe('Auto top-up (e2e)', () => {
  let app: INestApplication<App>;
  let headers: Record<string, string>;

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  const sign = (payload: string) =>
    signer.webhooks.generateTestHeaderString({ payload, secret: SECRET });

  const webhook = (event: object) => {
    const payload = JSON.stringify(event);
    return request(app.getHttpServer())
      .post('/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', sign(payload))
      .send(payload)
      .expect(200);
  };

  const me = async () =>
    (await request(app.getHttpServer()).get('/me').set(headers).expect(200))
      .body as Me;

  const settings = (body: object) =>
    request(app.getHttpServer())
      .put('/billing/auto-topup')
      .set(headers)
      .send(body);

  const saveCard = () =>
    webhook({
      id: 'evt_setup',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_setup',
          object: 'checkout.session',
          mode: 'setup',
          payment_status: 'no_payment_required',
          setup_intent: 'seti_1',
          metadata: { kind: 'auto_topup_setup', owner },
        },
      },
    });

  const paymentEvent = (type: string, extra: object = {}) => ({
    id: `evt_${type}`,
    object: 'event',
    type,
    data: {
      object: {
        id: 'pi_auto',
        object: 'payment_intent',
        amount: 2000,
        metadata: { kind: 'auto_topup', owner, pending_id: '1' },
        ...extra,
      },
    },
  });

  // Debits as POST /move does, without the AI call
  const debit = (price: number) =>
    app
      .get<
        AppService,
        { chargeOwner: (owner: string, cost: number, story?: string) => void }
      >(AppService)
      .chargeOwner(owner, price / 1.3, 'story');

  beforeEach(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    process.env.SERVICE_FEE_RATE = '0.30';
    jest
      .spyOn(AppService.prototype, 'onModuleInit')
      .mockImplementation(() => undefined);
    jest
      .spyOn(
        AppService.prototype as unknown as { readAllStories: () => [] },
        'readAllStories',
      )
      .mockReturnValue([]);
    stripeMock.customers.create.mockResolvedValue({ id: 'cus_1' });
    stripeMock.checkout.sessions.create.mockResolvedValue({
      url: 'https://checkout.stripe.com/c/setup',
    });
    stripeMock.setupIntents.retrieve.mockResolvedValue({
      id: 'seti_1',
      status: 'succeeded',
      payment_method: 'pm_1',
    });
    stripeMock.paymentIntents.create.mockResolvedValue({
      id: 'pi_auto',
      status: 'succeeded',
    });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_auto',
      status: 'succeeded',
      metadata: { kind: 'auto_topup', owner, pending_id: '1' },
      latest_charge: {
        id: 'ch_auto',
        balance_transaction: {
          amount: 2000,
          fee: 55,
          net: 1945,
          currency: 'eur',
        },
      },
    });
    app = await createApp(stripeMock, 'real');
    headers = await bearer(app);
    app.get(CreditsService).open(owner, 6);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.SERVICE_FEE_RATE;
    await app.close();
  });

  it('/billing/auto-topup (PUT) - requires a session', async () => {
    await request(app.getHttpServer())
      .put('/billing/auto-topup')
      .send({ enabled: true })
      .expect(401);
  });

  it.each([
    { enabled: true, amount: 4.99 },
    { enabled: true, amount: 501 },
    { enabled: true, threshold: -1 },
    { amount: 10 },
  ])('/billing/auto-topup (PUT) - rejects %p', async (body) => {
    await settings(body).expect(400);
    expect((await me()).autoTopup).toBeNull();
  });

  it('/billing/auto-topup (PUT) - saves, changes and disables the settings', async () => {
    expect((await me()).autoTopup).toBeNull();
    await settings({ enabled: true, amount: 20, threshold: 5 }).expect(200, {
      enabled: true,
      amount: 20,
      threshold: 5,
      hasCard: false,
      paused: false,
      pausedReason: null,
    });
    await settings({ enabled: true, amount: 50, threshold: 0 }).expect(200);
    await settings({ enabled: false }).expect(200);
    expect((await me()).autoTopup).toEqual({
      enabled: false,
      amount: 50,
      threshold: 0,
      hasCard: false,
      paused: false,
      pausedReason: null,
    });
  });

  it('/billing/auto-topup/setup (POST) - returns a setup Checkout URL', async () => {
    await request(app.getHttpServer())
      .post('/billing/auto-topup/setup')
      .set(headers)
      .expect(201, { url: 'https://checkout.stripe.com/c/setup' });
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'setup',
        currency: 'eur',
        customer: 'cus_1',
        metadata: { kind: 'auto_topup_setup', owner },
        setup_intent_data: { metadata: { kind: 'auto_topup_setup', owner } },
      }),
    );
  });

  it('stores the card of a completed setup session', async () => {
    await saveCard();
    expect((await me()).autoTopup).toMatchObject({
      enabled: false,
      hasCard: true,
    });
  });

  it('charges once for a burst of debits and credits the net', async () => {
    await settings({ enabled: true, amount: 20, threshold: 5 }).expect(200);
    await saveCard();

    debit(0.5);
    await flush();
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    for (let i = 0; i < 5; i++) {
      debit(0.5);
    }
    await flush();
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2000,
        currency: 'eur',
        customer: 'cus_1',
        payment_method: 'pm_1',
        off_session: true,
        confirm: true,
      }),
      { idempotencyKey: 'auto-topup-1' },
    );

    await webhook(paymentEvent('payment_intent.succeeded'));
    expect(app.get(CreditsService).balance(owner)).toBe(22.45);
  });

  it.each([
    [
      'a declined payment',
      () =>
        stripeMock.paymentIntents.create.mockRejectedValue(
          new Stripe.errors.StripeCardError({
            message: 'Your card was declined.',
            code: 'card_declined',
            payment_intent: { id: 'pi_auto' },
          } as unknown as Stripe.StripeRawError),
        ),
      'card_declined',
    ],
    [
      'a payment needing authentication',
      () =>
        stripeMock.paymentIntents.create.mockResolvedValue({
          id: 'pi_auto',
          status: 'requires_action',
        }),
      'requires_action',
    ],
  ])('pauses on %s and reports it in /me', async (_name, arrange, reason) => {
    arrange();
    await settings({ enabled: true, amount: 20, threshold: 5 }).expect(200);
    await saveCard();
    debit(1);
    await flush();
    expect((await me()).autoTopup).toMatchObject({
      enabled: true,
      paused: true,
      pausedReason: reason,
    });
    debit(1);
    await flush();
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
  });

  it('pauses on a failed payment event', async () => {
    stripeMock.paymentIntents.create.mockResolvedValue({
      id: 'pi_auto',
      status: 'processing',
    });
    await settings({ enabled: true, amount: 20, threshold: 5 }).expect(200);
    await saveCard();
    debit(1);
    await flush();
    await webhook(
      paymentEvent('payment_intent.payment_failed', {
        last_payment_error: { code: 'card_declined' },
      }),
    );
    expect((await me()).autoTopup).toMatchObject({
      paused: true,
      pausedReason: 'card_declined',
    });
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
      .put('/billing/auto-topup')
      .set(headers)
      .send({ enabled: true })
      .expect(503);
    await request(app.getHttpServer())
      .post('/billing/auto-topup/setup')
      .set(headers)
      .expect(503);
    await request(app.getHttpServer())
      .post('/billing/webhook')
      .send(checkoutCompleted())
      .expect(503);
  });
});

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AutoTopupDto, CheckoutDto } from './billing.controller';

const errors = async (amount: unknown): Promise<number> =>
  (await validate(plainToInstance(CheckoutDto, { amount }))).length;

describe('CheckoutDto', () => {
  it.each([5, 20, 12.34, 500])('accepts %p', async (amount) => {
    expect(await errors(amount)).toBe(0);
  });

  it.each([4.99, 0, -10, 500.01, 1000, 10.005, NaN, '20', undefined])(
    'rejects %p',
    async (amount) => {
      expect(await errors(amount)).toBeGreaterThan(0);
    },
  );
});

describe('AutoTopupDto', () => {
  const errors = async (body: object): Promise<number> =>
    (
      await validate(
        plainToInstance(AutoTopupDto, body, {
          enableImplicitConversion: true,
        }),
      )
    ).length;

  it.each([
    { enabled: true, amount: 10, threshold: 5 },
    { enabled: true, amount: 500, threshold: 0 },
    { enabled: false },
    { enabled: true },
    { enabled: true, threshold: 1000.5 },
  ])('accepts %p', async (body) => {
    expect(await errors(body)).toBe(0);
  });

  it.each([
    {},
    { enabled: 'yes' },
    { enabled: 'false' },
    { enabled: 0 },
    { enabled: true, amount: 4.99 },
    { enabled: true, amount: 500.01 },
    { enabled: true, amount: 10.005 },
    { enabled: true, threshold: -1 },
    { enabled: true, threshold: 1.001 },
    { enabled: true, amount: null },
  ])('rejects %p', async (body) => {
    expect(await errors(body)).toBeGreaterThan(0);
  });
});

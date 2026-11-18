import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CheckoutDto } from './billing.controller';

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

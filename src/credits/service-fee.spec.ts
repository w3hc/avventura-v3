import {
  DEFAULT_SERVICE_FEE_RATE,
  priceOf,
  serviceFeeRate,
} from './service-fee';

describe('serviceFeeRate', () => {
  it.each([
    ['0.30', 0.3],
    ['0', 0],
    ['1.5', 1.5],
  ])('should read %p as %p', (value, expected) => {
    const onInvalid = jest.fn();
    expect(serviceFeeRate(value, onInvalid)).toBe(expected);
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '  '])(
    'should default %p without a warning',
    (value) => {
      const onInvalid = jest.fn();
      expect(serviceFeeRate(value, onInvalid)).toBe(DEFAULT_SERVICE_FEE_RATE);
      expect(onInvalid).not.toHaveBeenCalled();
    },
  );

  it.each(['-0.1', 'abc', 'Infinity', 'NaN'])(
    'should default %p with a warning',
    (value) => {
      const onInvalid = jest.fn();
      expect(serviceFeeRate(value, onInvalid)).toBe(DEFAULT_SERVICE_FEE_RATE);
      expect(onInvalid).toHaveBeenCalledWith(
        expect.stringContaining('SERVICE_FEE_RATE'),
      );
    },
  );
});

describe('priceOf', () => {
  it('should add the service fee to the LLM cost', () => {
    expect(priceOf(1, 0.3)).toBeCloseTo(1.3);
    expect(priceOf(0.5, 0)).toBe(0.5);
  });
});

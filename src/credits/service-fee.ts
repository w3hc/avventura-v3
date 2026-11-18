export const DEFAULT_SERVICE_FEE_RATE = 0.3;

// Reads a non-negative number from an env value, `fallback` when unset or
// invalid
export function nonNegativeEnv(
  name: string,
  value: string | undefined,
  fallback: number,
  onInvalid: (message: string) => void,
): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    onInvalid(`Invalid ${name} "${value}", using ${fallback}`);
    return fallback;
  }
  return number;
}

export const serviceFeeRate = (
  value: string | undefined,
  onInvalid: (message: string) => void,
): number =>
  nonNegativeEnv(
    'SERVICE_FEE_RATE',
    value,
    DEFAULT_SERVICE_FEE_RATE,
    onInvalid,
  );

export const priceOf = (llmCost: number, rate: number): number =>
  llmCost * (1 + rate);

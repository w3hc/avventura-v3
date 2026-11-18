export const DEFAULT_SERVICE_FEE_RATE = 0.3;

export function serviceFeeRate(
  value: string | undefined,
  onInvalid: (message: string) => void,
): number {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_SERVICE_FEE_RATE;
  }
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0) {
    onInvalid(
      `Invalid SERVICE_FEE_RATE "${value}", using ${DEFAULT_SERVICE_FEE_RATE}`,
    );
    return DEFAULT_SERVICE_FEE_RATE;
  }
  return rate;
}

export const priceOf = (llmCost: number, rate: number): number =>
  llmCost * (1 + rate);

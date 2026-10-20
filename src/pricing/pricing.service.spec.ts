import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PricingFile, PricingService } from './pricing.service';

describe('PricingService', () => {
  const cwd = process.cwd();
  let dir: string;

  const seed: PricingFile = {
    updatedAt: '2026-10-01',
    usdEurRate: 0.5,
    usdEurRateDate: '2026-09-30',
    models: { m: { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 } },
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pricing-'));
    mkdirSync(join(dir, 'pricing'));
    writeFileSync(
      join(dir, 'pricing', 'default-pricing.json'),
      JSON.stringify(seed),
    );
    process.chdir(dir);
  });

  afterEach(() => process.chdir(cwd));

  it('should fall back to the default file', () => {
    expect(new PricingService().pricing.updatedAt).toBe('2026-10-01');
  });

  it('should prefer pricing.json and pick it up on reload', () => {
    const service = new PricingService();
    writeFileSync(
      join(dir, 'pricing', 'pricing.json'),
      JSON.stringify({ ...seed, updatedAt: '2026-10-20' }),
    );
    service.reload();
    expect(service.pricing.updatedAt).toBe('2026-10-20');
  });

  it('should price a call in EUR', () => {
    const cost = new PricingService().costEur('m', {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo((2 + 2.5 + 0.2 + 10) * 0.5);
  });

  it('should throw on an unknown model', () => {
    expect(() => new PricingService().getRates('nope')).toThrow(
      'No pricing rates found for model "nope"',
    );
  });

  it('should ship a default file with the model in use', () => {
    process.chdir(cwd);
    expect(new PricingService().getRates('claude-sonnet-5-5')).toBeDefined();
  });
});

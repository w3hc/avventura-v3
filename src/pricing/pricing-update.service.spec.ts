import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PricingFile, PricingService } from './pricing.service';
import { PricingUpdateService } from './pricing-update.service';

describe('PricingUpdateService', () => {
  const cwd = process.cwd();
  const rates = { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 };
  const seed: PricingFile = {
    updatedAt: '2026-10-01',
    usdEurRate: 0.9,
    usdEurRateDate: '2026-09-30',
    models: { m: rates },
  };
  let dir: string;
  let pricing: PricingService;
  let service: PricingUpdateService;
  let fetchMock: jest.SpyInstance;

  const anthropicReply = (body: unknown, stop_reason = 'end_turn') =>
    new Response(
      JSON.stringify({
        stop_reason,
        content: [
          { type: 'server_tool_use' },
          {
            type: 'text',
            text: typeof body === 'string' ? body : JSON.stringify(body),
          },
        ],
      }),
    );
  const fxReply = (rate: number) =>
    new Response(JSON.stringify({ date: '2026-10-19', rates: { EUR: rate } }));

  const mockFetch = (anthropic: () => Response, fx: () => Response) =>
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url.includes('frankfurter') ? fx() : anthropic()),
    );

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pricing-update-'));
    mkdirSync(join(dir, 'pricing'));
    writeFileSync(
      join(dir, 'pricing', 'default-pricing.json'),
      JSON.stringify(seed),
    );
    process.chdir(dir);
    process.env.ANTHROPIC_API_KEY = 'key';
    pricing = new PricingService();
    service = new PricingUpdateService(pricing);
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    process.chdir(cwd);
    fetchMock.mockRestore();
    delete process.env.ANTHROPIC_API_KEY;
  });

  const written = () =>
    JSON.parse(
      readFileSync(join(dir, 'pricing', 'pricing.json'), 'utf-8'),
    ) as PricingFile;

  it('should write and load the new rates and FX rate', async () => {
    mockFetch(
      () =>
        anthropicReply(
          `Here: {"m": ${JSON.stringify({ ...rates, output: 12 })}}`,
        ),
      () => fxReply(0.88),
    );

    await service.updatePricing();

    expect(written().models.m.output).toBe(12);
    expect(pricing.pricing.usdEurRate).toBe(0.88);
    expect(pricing.pricing.usdEurRateDate).toBe('2026-10-19');
  });

  it('should archive the previous pricing file', async () => {
    writeFileSync(
      join(dir, 'pricing', 'pricing.json'),
      JSON.stringify({ ...seed, updatedAt: '2026-10-19' }),
    );
    mockFetch(
      () => anthropicReply({ m: rates }),
      () => fxReply(0.88),
    );

    await service.updatePricing();

    expect(
      existsSync(join(dir, 'pricing', 'archive', 'pricing-2026-10-19.json')),
    ).toBe(true);
  });

  it('should keep the last FX rate when Frankfurter fails', async () => {
    mockFetch(
      () => anthropicReply({ m: rates }),
      () => new Response('down', { status: 503 }),
    );

    await service.updatePricing();

    expect(written().usdEurRate).toBe(0.9);
    expect(written().usdEurRateDate).toBe('2026-09-30');
  });

  it('should resume a paused turn', async () => {
    let calls = 0;
    mockFetch(
      () =>
        ++calls === 1
          ? anthropicReply('', 'pause_turn')
          : anthropicReply({ m: rates }),
      () => fxReply(0.88),
    );

    await service.updatePricing();

    expect(calls).toBe(2);
  });

  it.each([
    ['a missing model', {}],
    ['an implausible drift', { m: { ...rates, input: 20 } }],
    ['a non-positive rate', { m: { ...rates, cacheRead: 0 } }],
  ])('should reject %s and keep the current rates', async (_, models) => {
    mockFetch(
      () => anthropicReply(models),
      () => fxReply(0.88),
    );

    await expect(service.updatePricing()).rejects.toThrow();
    expect(existsSync(join(dir, 'pricing', 'pricing.json'))).toBe(false);
    expect(pricing.pricing.usdEurRate).toBe(0.9);
  });

  it('should not throw from the scheduled run', async () => {
    mockFetch(
      () => anthropicReply('no json'),
      () => fxReply(0.88),
    );

    await expect(service.handleScheduledUpdate()).resolves.toBeUndefined();
  });
});

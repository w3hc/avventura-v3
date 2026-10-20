import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { ModelRates, PricingFile, PricingService } from './pricing.service';

const PRICING_PAGE = 'https://platform.claude.com/docs/en/about-claude/pricing';

// ECB reference rate via Frankfurter: free, no API key, one rate per business day.
const FX_RATE_URL =
  'https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR';

const RESEARCH_MODEL = 'claude-sonnet-5-5';

const RATE_FIELDS = ['input', 'cacheWrite', 'cacheRead', 'output'] as const;

// USD per million tokens: the dearest model sits around 50, so anything past
// this is a misplaced decimal and would multiply every charged cost.
const MAX_RATE = 1000;

// Providers move prices by tens of percent, not by multiples.
const MAX_DRIFT_FACTOR = 3;

// web_search can pause a long turn; resume it this many times at most.
const MAX_CONTINUATIONS = 3;

interface AnthropicResponse {
  stop_reason: string;
  content: { type: string; text?: string }[];
}

@Injectable()
export class PricingUpdateService {
  private readonly logger = new Logger(PricingUpdateService.name);
  private readonly archiveDir = join(process.cwd(), 'pricing', 'archive');

  constructor(private readonly pricingService: PricingService) {}

  // @nestjs/schedule doesn't catch errors from the tick, and an unhandled
  // rejection would kill the process.
  @Cron(CronExpression.EVERY_DAY_AT_6AM, {
    name: 'pricing-update',
    timeZone: 'UTC',
  })
  async handleScheduledUpdate(): Promise<void> {
    try {
      await this.updatePricing();
    } catch (error) {
      this.logger.error(
        `Scheduled pricing update failed, keeping the current rates: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async updatePricing(): Promise<PricingFile> {
    this.logger.log('Starting pricing update');
    const current = this.pricingService.pricing;
    const [models, fx] = await Promise.all([
      this.fetchModelRates(current.models),
      this.fetchUsdEurRateOrKeepLast(current),
    ]);
    const result: PricingFile = {
      updatedAt: new Date().toISOString().slice(0, 10),
      source: PRICING_PAGE,
      usdEurRate: fx.rate,
      usdEurRateDate: fx.date,
      models,
    };

    await this.archiveCurrentPricing();
    await writeFile(
      this.pricingService.filePath,
      JSON.stringify(result, null, 2) + '\n',
      'utf-8',
    );
    this.pricingService.reload();
    this.logger.log(
      `Pricing update complete: 1 USD = ${result.usdEurRate} EUR (${result.usdEurRateDate})`,
    );
    return result;
  }

  private async fetchUsdEurRate(): Promise<{ rate: number; date: string }> {
    const response = await fetch(FX_RATE_URL);
    if (!response.ok) {
      throw new Error(`Frankfurter API error: HTTP ${response.status}`);
    }
    const data = (await response.json()) as {
      date?: string;
      rates?: { EUR?: number };
    };
    const rate = data.rates?.EUR;
    if (typeof rate !== 'number' || !(rate > 0) || !data.date) {
      throw new Error('Frankfurter API response missing the USD->EUR rate');
    }
    return { rate, date: data.date };
  }

  private async fetchUsdEurRateOrKeepLast(
    current: PricingFile,
  ): Promise<{ rate: number; date: string }> {
    try {
      return await this.fetchUsdEurRate();
    } catch (error) {
      this.logger.error(
        `Failed to fetch the USD->EUR rate, keeping ${current.usdEurRate} from ${current.usdEurRateDate}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { rate: current.usdEurRate, date: current.usdEurRateDate };
    }
  }

  private async archiveCurrentPricing(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.pricingService.filePath, 'utf-8');
    } catch {
      return;
    }
    const date =
      (JSON.parse(raw) as Partial<PricingFile>).updatedAt ??
      new Date().toISOString().slice(0, 10);
    await mkdir(this.archiveDir, { recursive: true });
    await writeFile(join(this.archiveDir, `pricing-${date}.json`), raw);
  }

  private async fetchModelRates(
    current: Record<string, ModelRates>,
  ): Promise<Record<string, ModelRates>> {
    const prompt = `Use web search to check the CURRENT official Claude API pricing on ${PRICING_PAGE} for exactly these models. Rates are USD per million tokens; cacheWrite is the 5-minute cache write rate.
${JSON.stringify(current, null, 2)}

Respond with ONLY a JSON object with the same model IDs and fields, no prose:
{ "<modelId>": { "input": <number>, "cacheWrite": <number>, "cacheRead": <number>, "output": <number> } }

Keep exactly the same model IDs. If a rate is unchanged, keep its current value.`;

    const text = await this.askWithWebSearch(prompt);
    const parsed = this.parseJson(text);
    for (const modelId of Object.keys(current)) {
      const rates = parsed[modelId];
      if (!rates) {
        throw new Error(`Pricing update is missing model "${modelId}"`);
      }
      this.validate(modelId, rates, current[modelId]);
    }
    return Object.fromEntries(
      Object.keys(current).map((modelId) => [
        modelId,
        Object.fromEntries(
          RATE_FIELDS.map((field) => [field, parsed[modelId][field]]),
        ) as unknown as ModelRates,
      ]),
    );
  }

  private async askWithWebSearch(prompt: string): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }

    const messages: { role: string; content: unknown }[] = [
      { role: 'user', content: prompt },
    ];
    for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: RESEARCH_MODEL,
          max_tokens: 16000,
          tools: [{ type: 'web_search_20260209', name: 'web_search' }],
          messages,
        }),
      });
      if (!response.ok) {
        throw new Error(
          `Anthropic API error: ${response.status} ${await response.text()}`,
        );
      }

      const data = (await response.json()) as AnthropicResponse;
      if (data.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: data.content });
        continue;
      }
      if (data.stop_reason === 'refusal') {
        throw new Error('Pricing update request was refused');
      }
      return data.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
    }
    throw new Error('Pricing update did not finish within the turn limit');
  }

  private parseJson(text: string): Record<string, ModelRates> {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end < start) {
      throw new Error('No JSON object found in the pricing update response');
    }
    try {
      return JSON.parse(text.slice(start, end + 1)) as Record<
        string,
        ModelRates
      >;
    } catch {
      throw new Error('Invalid JSON in the pricing update response');
    }
  }

  private validate(modelId: string, rates: ModelRates, previous: ModelRates) {
    for (const field of RATE_FIELDS) {
      const value = rates[field];
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value <= 0 ||
        value > MAX_RATE
      ) {
        throw new Error(
          `Invalid ${field} for "${modelId}": ${String(value)} outside 0-${MAX_RATE} USD per million tokens`,
        );
      }
      const before = previous[field];
      if (
        value > before * MAX_DRIFT_FACTOR ||
        value < before / MAX_DRIFT_FACTOR
      ) {
        throw new Error(
          `Implausible ${field} change for "${modelId}": ${before} -> ${value}`,
        );
      }
    }
  }
}

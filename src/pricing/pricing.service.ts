import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

// USD per million tokens
export interface ModelRates {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

export interface PricingFile {
  updatedAt: string;
  source?: string;
  usdEurRate: number;
  usdEurRateDate: string;
  models: Record<string, ModelRates>;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);
  readonly filePath = join(process.cwd(), 'pricing', 'pricing.json');
  // pricing/pricing.json is gitignored since PricingUpdateService rewrites it
  // daily; this committed seed stands in for it until the first update.
  private readonly defaultFilePath = join(
    process.cwd(),
    'pricing',
    'default-pricing.json',
  );
  private data: PricingFile;

  constructor() {
    this.reload();
  }

  reload(): void {
    let raw: string;
    let source = this.filePath;
    try {
      raw = readFileSync(this.filePath, 'utf-8');
    } catch {
      raw = readFileSync(this.defaultFilePath, 'utf-8');
      source = this.defaultFilePath;
    }
    this.data = JSON.parse(raw) as PricingFile;
    this.logger.log(
      `Loaded pricing from ${source} (updated ${this.data.updatedAt}, 1 USD = ${this.data.usdEurRate} EUR)`,
    );
  }

  get pricing(): PricingFile {
    return this.data;
  }

  getRates(model: string): ModelRates {
    const rates = this.data.models[model];
    if (!rates) {
      throw new Error(`No pricing rates found for model "${model}"`);
    }
    return rates;
  }

  toEur(usdAmount: number): number {
    return usdAmount * this.data.usdEurRate;
  }

  /** Prices one API call in EUR. `input_tokens` already excludes cached tokens. */
  costEur(model: string, usage: TokenUsage): number {
    const rates = this.getRates(model);
    const usd =
      (usage.input_tokens * rates.input +
        (usage.cache_creation_input_tokens ?? 0) * rates.cacheWrite +
        (usage.cache_read_input_tokens ?? 0) * rates.cacheRead +
        usage.output_tokens * rates.output) /
      1_000_000;
    return this.toEur(usd);
  }
}

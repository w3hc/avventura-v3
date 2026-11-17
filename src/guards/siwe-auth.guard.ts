import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { validateSiweMessage, verifySiweSignature } from 'w3pk';

export interface SiweRequest extends Request {
  siweAddress?: string;
}

const CLOCK_SKEW_MS = 60 * 1000;

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Verifies that the request carries a valid, fresh SIWE (EIP-4361) signature
 * scoped to this exact request, whose nonce hasn't been used yet. It only
 * proves who signed: callers still check `request.siweAddress` against what
 * it should own (a story's creatorAddress) before allowing the action.
 */
@Injectable()
export class SiweAuthGuard implements CanActivate {
  private readonly usedNonces = new Map<string, number>();

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SiweRequest>();
    const rawMessage = request.headers['x-siwe-message'];
    const signature = request.headers['x-siwe-signature'];

    if (typeof rawMessage !== 'string' || !rawMessage) {
      throw new UnauthorizedException('x-siwe-message header is required');
    }
    if (typeof signature !== 'string' || !signature) {
      throw new UnauthorizedException('x-siwe-signature header is required');
    }

    // Header values can't carry raw newlines; the client percent-encodes
    // the (multi-line) SIWE message before sending it.
    let message: string;
    try {
      message = decodeURIComponent(rawMessage);
    } catch {
      throw new UnauthorizedException('x-siwe-message header is not valid');
    }

    const validation = validateSiweMessage(message, {
      chainId: numberFromEnv('SIWE_CHAIN_ID', 1),
    });
    if (!validation.valid || !validation.parsed) {
      throw new UnauthorizedException(
        `Invalid SIWE message: ${validation.errors.join(', ')}`,
      );
    }
    const parsed = validation.parsed;

    const allowedDomains = process.env.SIWE_ALLOWED_DOMAINS?.split(',')
      .map((domain) => domain.trim())
      .filter(Boolean);
    if (allowedDomains?.length && !allowedDomains.includes(parsed.domain)) {
      throw new UnauthorizedException('Unrecognized SIWE domain');
    }

    if (!parsed.expirationTime) {
      throw new UnauthorizedException(
        'SIWE message must include an expiration time',
      );
    }

    const issuedAtMs = Date.parse(parsed.issuedAt);
    const expiresAtMs = Date.parse(parsed.expirationTime);
    const nowMs = Date.now();
    const maxAgeMs = numberFromEnv('SIWE_MAX_AGE_SECONDS', 300) * 1000;

    if (Number.isNaN(issuedAtMs) || Number.isNaN(expiresAtMs)) {
      throw new UnauthorizedException(
        'SIWE message has invalid issuedAt or expirationTime',
      );
    }
    if (issuedAtMs > nowMs + CLOCK_SKEW_MS) {
      throw new UnauthorizedException('SIWE message issued in the future');
    }
    if (expiresAtMs - issuedAtMs > maxAgeMs + CLOCK_SKEW_MS) {
      throw new UnauthorizedException('SIWE message validity window too long');
    }

    const expectedStatement = `Authorize ${request.method.toUpperCase()} ${request.path}`;
    if (parsed.statement !== expectedStatement) {
      throw new UnauthorizedException(
        'SIWE message does not authorize this action',
      );
    }

    const result = await verifySiweSignature(message, signature);
    if (!result.valid || !result.address) {
      throw new UnauthorizedException(result.error || 'Invalid SIWE signature');
    }

    this.forgetExpiredNonces(nowMs);
    if (this.usedNonces.has(parsed.nonce)) {
      throw new UnauthorizedException('SIWE nonce already used');
    }
    this.usedNonces.set(parsed.nonce, expiresAtMs + CLOCK_SKEW_MS);

    request.siweAddress = result.address.toLowerCase();
    return true;
  }

  private forgetExpiredNonces(nowMs: number): void {
    for (const [nonce, forgetAtMs] of this.usedNonces) {
      if (forgetAtMs <= nowMs) this.usedNonces.delete(nonce);
    }
  }
}

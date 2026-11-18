import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import { validateSiweMessage, verifySiweSignature } from 'w3pk';
import { openDatabase } from '../credits/schema';

export const SIGN_IN_STATEMENT = 'Sign in to Avventura';

const CLOCK_SKEW_MS = 60 * 1000;

export interface Session {
  token: string;
  address: string;
  expiresAt: string;
}

interface Statements {
  db: Database.Database;
  purge: (now: number) => void;
  insertNonce: Database.Statement<[string, number]>;
  consumeNonce: Database.Statement<[string, number], { nonce: string }>;
  insertSession: Database.Statement<[string, string, string, number]>;
  findSession: Database.Statement<[string, number], { address: string }>;
  deleteSession: Database.Statement<[string]>;
}

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const maxAgeMs = (): number =>
  numberFromEnv('SIWE_MAX_AGE_SECONDS', 300) * 1000;

const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private statements?: Statements;

  onModuleInit() {
    this.prepare();
  }

  onModuleDestroy() {
    this.statements?.db.close();
    this.statements = undefined;
  }

  // Opened lazily so the database path is resolved on first use
  private prepare(): Statements {
    if (this.statements) {
      return this.statements;
    }
    const db = openDatabase();
    const purgeNonces = db.prepare<[number]>(
      'DELETE FROM siwe_nonces WHERE expires_at <= ?',
    );
    const purgeSessions = db.prepare<[number]>(
      'DELETE FROM sessions WHERE expires_at <= ?',
    );
    this.statements = {
      db,
      purge: (now) => {
        purgeNonces.run(now);
        purgeSessions.run(now);
      },
      insertNonce: db.prepare(
        'INSERT INTO siwe_nonces (nonce, expires_at) VALUES (?, ?)',
      ),
      consumeNonce: db.prepare(
        'DELETE FROM siwe_nonces WHERE nonce = ? AND expires_at > ? RETURNING nonce',
      ),
      insertSession: db.prepare(
        'INSERT INTO sessions (token_hash, address, created_at, expires_at) VALUES (?, ?, ?, ?)',
      ),
      findSession: db.prepare(
        'SELECT address FROM sessions WHERE token_hash = ? AND expires_at > ?',
      ),
      deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    };
    return this.statements;
  }

  createNonce(): string {
    const statements = this.prepare();
    const now = Date.now();
    const nonce = randomBytes(16).toString('hex');
    statements.purge(now);
    statements.insertNonce.run(nonce, now + maxAgeMs());
    return nonce;
  }

  async signIn(message: string, signature: string): Promise<Session> {
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
    const now = Date.now();

    if (Number.isNaN(issuedAtMs) || Number.isNaN(expiresAtMs)) {
      throw new UnauthorizedException(
        'SIWE message has invalid issuedAt or expirationTime',
      );
    }
    if (issuedAtMs > now + CLOCK_SKEW_MS) {
      throw new UnauthorizedException('SIWE message issued in the future');
    }
    if (expiresAtMs <= now) {
      throw new UnauthorizedException('SIWE message has expired');
    }
    if (expiresAtMs - issuedAtMs > maxAgeMs() + CLOCK_SKEW_MS) {
      throw new UnauthorizedException('SIWE message validity window too long');
    }

    if (parsed.statement !== SIGN_IN_STATEMENT) {
      throw new UnauthorizedException(
        `SIWE statement must be "${SIGN_IN_STATEMENT}"`,
      );
    }

    const result = await verifySiweSignature(message, signature);
    if (!result.valid || !result.address) {
      throw new UnauthorizedException(result.error || 'Invalid SIWE signature');
    }

    const statements = this.prepare();
    if (!statements.consumeNonce.get(parsed.nonce, now)) {
      throw new UnauthorizedException('Unknown, expired or used SIWE nonce');
    }

    const token = randomBytes(32).toString('base64url');
    const address = result.address.toLowerCase();
    const sessionExpiresAt =
      now + numberFromEnv('SESSION_TTL_SECONDS', 86400) * 1000;
    statements.purge(now);
    statements.insertSession.run(
      hashToken(token),
      address,
      new Date(now).toISOString(),
      sessionExpiresAt,
    );
    return {
      token,
      address,
      expiresAt: new Date(sessionExpiresAt).toISOString(),
    };
  }

  // The session's lowercased address, or null if unknown or expired
  findSession(token: string): string | null {
    const row = this.prepare().findSession.get(hashToken(token), Date.now());
    return row?.address ?? null;
  }

  logout(token: string): void {
    this.prepare().deleteSession.run(hashToken(token));
  }
}

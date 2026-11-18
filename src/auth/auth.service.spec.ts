import { UnauthorizedException } from '@nestjs/common';
import { Wallet } from 'ethers';
import { createSiweMessage } from 'w3pk';
import { AuthService, SIGN_IN_STATEMENT } from './auth.service';

describe('AuthService', () => {
  const wallet = Wallet.createRandom();
  const env = { ...process.env };
  let service: AuthService;

  beforeEach(() => {
    process.env.DATABASE_PATH = ':memory:';
    process.env.SIWE_ALLOWED_DOMAINS = 'avventura.fun, localhost:3001';
    delete process.env.SIWE_CHAIN_ID;
    delete process.env.SIWE_MAX_AGE_SECONDS;
    delete process.env.SESSION_TTL_SECONDS;
    service = new AuthService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  afterAll(() => {
    process.env = env;
  });

  function messageFor(
    overrides: Partial<Parameters<typeof createSiweMessage>[0]> = {},
  ): string {
    const now = Date.now();
    return createSiweMessage({
      domain: 'avventura.fun',
      address: wallet.address,
      statement: SIGN_IN_STATEMENT,
      uri: 'https://avventura.fun',
      version: '1',
      chainId: 1,
      nonce: service.createNonce(),
      issuedAt: new Date(now).toISOString(),
      expirationTime: new Date(now + 5 * 60 * 1000).toISOString(),
      ...overrides,
    });
  }

  async function signIn(
    message: string,
    signer: Pick<Wallet, 'signMessage'> = wallet,
  ) {
    return service.signIn(message, await signer.signMessage(message));
  }

  async function expectRejected(
    message: string,
    signer?: Pick<Wallet, 'signMessage'>,
  ): Promise<void> {
    await expect(signIn(message, signer)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  }

  it('creates distinct alphanumeric nonces', () => {
    const first = service.createNonce();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(service.createNonce()).not.toBe(first);
  });

  it('signs in and returns a session for the lowercased address', async () => {
    const session = await signIn(messageFor());
    expect(session.address).toBe(wallet.address.toLowerCase());
    expect(session.token).toMatch(/^[\w-]{43}$/);
    expect(Date.parse(session.expiresAt) - Date.now()).toBeGreaterThan(
      86_000 * 1000,
    );
    expect(service.findSession(session.token)).toBe(session.address);
  });

  it('stores only the token hash', async () => {
    const session = await signIn(messageFor());
    const db = (
      service as unknown as {
        statements: {
          db: { prepare: (sql: string) => { all: () => unknown[] } };
        };
      }
    ).statements.db;
    const rows = db.prepare('SELECT token_hash FROM sessions').all() as {
      token_hash: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(session.token);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a signature from another wallet', async () => {
    await expectRejected(messageFor(), Wallet.createRandom());
  });

  it('rejects a domain that is not allowed', async () => {
    await expectRejected(messageFor({ domain: 'evil.com' }));
  });

  it('accepts any domain when SIWE_ALLOWED_DOMAINS is unset', async () => {
    delete process.env.SIWE_ALLOWED_DOMAINS;
    await expect(signIn(messageFor({ domain: 'evil.com' }))).resolves.toEqual(
      expect.objectContaining({ address: wallet.address.toLowerCase() }),
    );
  });

  it('rejects another chain', async () => {
    await expectRejected(messageFor({ chainId: 10 }));
  });

  it('rejects another statement', async () => {
    await expectRejected(messageFor({ statement: 'Authorize POST /stories' }));
  });

  it('rejects a message without an expiration time', async () => {
    await expectRejected(messageFor({ expirationTime: undefined }));
  });

  it('rejects an expired message', async () => {
    const now = Date.now();
    await expectRejected(
      messageFor({
        issuedAt: new Date(now - 120 * 1000).toISOString(),
        expirationTime: new Date(now - 60 * 1000).toISOString(),
      }),
    );
  });

  it('rejects a message issued in the future', async () => {
    const now = Date.now();
    await expectRejected(
      messageFor({
        issuedAt: new Date(now + 2 * 60 * 1000).toISOString(),
        expirationTime: new Date(now + 4 * 60 * 1000).toISOString(),
      }),
    );
  });

  it('rejects a validity window longer than SIWE_MAX_AGE_SECONDS', async () => {
    await expectRejected(
      messageFor({
        expirationTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    );
  });

  it('rejects a nonce it did not issue', async () => {
    await expectRejected(messageFor({ nonce: 'abcdef0123456789abcdef' }));
  });

  it('rejects a reused nonce', async () => {
    const message = messageFor();
    await expect(signIn(message)).resolves.toBeDefined();
    await expectRejected(message);
  });

  it('keeps the nonce when the signature is wrong', async () => {
    const message = messageFor();
    await expectRejected(message, Wallet.createRandom());
    await expect(signIn(message)).resolves.toBeDefined();
  });

  it('rejects an expired nonce', async () => {
    process.env.SIWE_MAX_AGE_SECONDS = '1';
    const now = Date.now();
    const message = messageFor({
      expirationTime: new Date(now + 2000).toISOString(),
    });
    jest.useFakeTimers({ now: now + 1500, doNotFake: ['nextTick'] });
    await expectRejected(message);
  });

  it('expires sessions after SESSION_TTL_SECONDS', async () => {
    process.env.SESSION_TTL_SECONDS = '60';
    const session = await signIn(messageFor());
    expect(service.findSession(session.token)).toBe(session.address);
    jest.useFakeTimers({ now: Date.now() + 61 * 1000 });
    expect(service.findSession(session.token)).toBeNull();
  });

  it('ends a session on logout', async () => {
    const session = await signIn(messageFor());
    service.logout(session.token);
    expect(service.findSession(session.token)).toBeNull();
  });

  it('does not find an unknown token', () => {
    expect(service.findSession('nope')).toBeNull();
  });
});

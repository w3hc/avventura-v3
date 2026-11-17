import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Wallet } from 'ethers';
import { createSiweMessage, generateSiweNonce } from 'w3pk';
import { SiweAuthGuard, SiweRequest } from './siwe-auth.guard';

describe('SiweAuthGuard', () => {
  const wallet = Wallet.createRandom();
  const env = { ...process.env };
  let guard: SiweAuthGuard;

  beforeEach(() => {
    process.env.SIWE_ALLOWED_DOMAINS = 'avventura.fun, localhost:3001';
    delete process.env.SIWE_CHAIN_ID;
    delete process.env.SIWE_MAX_AGE_SECONDS;
    guard = new SiweAuthGuard();
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
      statement: 'Authorize POST /stories',
      uri: 'https://avventura.fun/edit',
      version: '1',
      chainId: 1,
      nonce: generateSiweNonce(),
      issuedAt: new Date(now).toISOString(),
      expirationTime: new Date(now + 5 * 60 * 1000).toISOString(),
      ...overrides,
    });
  }

  async function headersFor(
    message: string,
    signer: Wallet | ReturnType<typeof Wallet.createRandom> = wallet,
  ): Promise<Record<string, string>> {
    return {
      'x-siwe-message': encodeURIComponent(message),
      'x-siwe-signature': await signer.signMessage(message),
    };
  }

  function contextFor(
    headers: Record<string, string>,
    path = '/stories',
  ): { context: ExecutionContext; request: SiweRequest } {
    const request = { headers, method: 'POST', path } as SiweRequest;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  }

  async function expectRejected(
    headers: Record<string, string>,
    path?: string,
  ): Promise<void> {
    await expect(
      guard.canActivate(contextFor(headers, path).context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  }

  it('accepts a valid signature and exposes the lowercased address', async () => {
    const { context, request } = contextFor(await headersFor(messageFor()));
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.siweAddress).toBe(wallet.address.toLowerCase());
  });

  it('rejects missing headers', async () => {
    await expectRejected({});
    await expectRejected({ 'x-siwe-message': encodeURIComponent('x') });
  });

  it('rejects a signature from another wallet', async () => {
    await expectRejected(await headersFor(messageFor(), Wallet.createRandom()));
  });

  it('rejects a domain that is not allowed', async () => {
    await expectRejected(await headersFor(messageFor({ domain: 'evil.com' })));
  });

  it('accepts any domain when SIWE_ALLOWED_DOMAINS is unset', async () => {
    delete process.env.SIWE_ALLOWED_DOMAINS;
    const headers = await headersFor(messageFor({ domain: 'evil.com' }));
    await expect(guard.canActivate(contextFor(headers).context)).resolves.toBe(
      true,
    );
  });

  it('rejects a statement for another route', async () => {
    await expectRejected(await headersFor(messageFor()), '/stories/edit');
  });

  it('rejects another chain', async () => {
    await expectRejected(await headersFor(messageFor({ chainId: 10 })));
  });

  it('rejects a message without an expiration time', async () => {
    await expectRejected(
      await headersFor(messageFor({ expirationTime: undefined })),
    );
  });

  it('rejects an expired message', async () => {
    const now = Date.now();
    await expectRejected(
      await headersFor(
        messageFor({
          issuedAt: new Date(now - 120 * 1000).toISOString(),
          expirationTime: new Date(now - 60 * 1000).toISOString(),
        }),
      ),
    );
  });

  it('rejects a validity window longer than SIWE_MAX_AGE_SECONDS', async () => {
    const now = Date.now();
    await expectRejected(
      await headersFor(
        messageFor({
          expirationTime: new Date(now + 60 * 60 * 1000).toISOString(),
        }),
      ),
    );
  });

  it('rejects a reused nonce', async () => {
    const headers = await headersFor(messageFor());
    await expect(guard.canActivate(contextFor(headers).context)).resolves.toBe(
      true,
    );
    await expectRejected(headers);
  });
});

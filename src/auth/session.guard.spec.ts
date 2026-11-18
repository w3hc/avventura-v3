import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SessionGuard, SessionRequest } from './session.guard';

describe('SessionGuard', () => {
  const ADDRESS = '0x1111111111111111111111111111111111111111';
  const findSession = jest.fn((token: string) =>
    token === 'valid' ? ADDRESS : null,
  );
  const guard = new SessionGuard({ findSession } as unknown as AuthService);

  function contextFor(authorization?: string): {
    context: ExecutionContext;
    request: SessionRequest;
  } {
    const request = {
      headers: authorization ? { authorization } : {},
    } as SessionRequest;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  }

  it('sets the session address and token on the request', () => {
    const { context, request } = contextFor('Bearer valid');
    expect(guard.canActivate(context)).toBe(true);
    expect(request.auth).toEqual({ address: ADDRESS, token: 'valid' });
  });

  it.each([undefined, 'valid', 'Basic valid', 'Bearer '])(
    'rejects the header %p',
    (authorization) => {
      expect(() =>
        guard.canActivate(contextFor(authorization).context),
      ).toThrow(UnauthorizedException);
    },
  );

  it('rejects an unknown or expired session', () => {
    expect(() => guard.canActivate(contextFor('Bearer nope').context)).toThrow(
      UnauthorizedException,
    );
  });
});

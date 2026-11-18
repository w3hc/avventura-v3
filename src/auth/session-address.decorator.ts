import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SessionRequest } from './session.guard';

/**
 * The lowercased address of the request's session. Only usable on routes
 * guarded by SessionGuard.
 */
export const SessionAddress = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<SessionRequest>();
    return request.auth!.address;
  },
);

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';

export interface SessionRequest extends Request {
  auth?: { address: string; token: string };
}

/**
 * Requires `Authorization: Bearer <token>` from `POST /auth/siwe` for a
 * session that hasn't expired. It only proves who signed in: callers still
 * check the address against what it should own before allowing the action.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Bearer token is required');
    }
    const address = this.authService.findSession(token);
    if (!address) {
      throw new UnauthorizedException('Invalid or expired session');
    }
    request.auth = { address, token };
    return true;
  }
}

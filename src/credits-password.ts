import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

const logger = new Logger('CreditsPassword');

export function assertCreditsPassword(password: string, action: string): void {
  const expected = process.env.CREDITS_PASSWORD;
  if (!expected) {
    logger.error('CREDITS_PASSWORD is not configured');
    throw new HttpException(
      'CREDITS_PASSWORD is not configured',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  const given = Buffer.from(password);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    logger.warn(`Rejected ${action}`);
    throw new HttpException('Invalid password', HttpStatus.UNAUTHORIZED);
  }
}

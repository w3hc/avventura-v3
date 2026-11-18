import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { AuthService, Session, SIGN_IN_STATEMENT } from './auth.service';
import { SessionGuard, SessionRequest } from './session.guard';

export class SiweSignInDto {
  @ApiProperty({
    description: `EIP-4361 SIWE message, sent raw, with a nonce from GET /auth/nonce and the statement "${SIGN_IN_STATEMENT}"`,
  })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiProperty({ description: 'Signature over the message' })
  @IsString()
  @IsNotEmpty()
  signature: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Get('nonce')
  @ApiOperation({ summary: 'A single-use nonce for a SIWE sign-in' })
  @ApiResponse({
    status: 200,
    description: 'The nonce, valid for SIWE_MAX_AGE_SECONDS',
  })
  nonce(): { nonce: string } {
    this.logger.log('GET /auth/nonce endpoint called');
    return { nonce: this.authService.createNonce() };
  }

  @Post('siwe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with Ethereum and get a session token' })
  @ApiBody({ type: SiweSignInDto })
  @ApiResponse({
    status: 200,
    description: 'Bearer token, lowercased address and session expiry',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid SIWE message or signature, or unknown nonce',
  })
  signIn(@Body() body: SiweSignInDto): Promise<Session> {
    this.logger.log('POST /auth/siwe endpoint called');
    return this.authService.signIn(body.message, body.signature);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'End the current session' })
  @ApiResponse({ status: 204, description: 'Session ended' })
  @ApiResponse({ status: 401, description: 'Invalid or missing session' })
  logout(@Req() request: SessionRequest): void {
    this.logger.log('POST /auth/logout endpoint called');
    this.authService.logout(request.auth!.token);
  }
}

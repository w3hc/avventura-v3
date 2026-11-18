import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Put,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsBoolean, IsNumber, Max, Min, ValidateIf } from 'class-validator';
import { Request } from 'express';
import { SessionAddress } from '../auth/session-address.decorator';
import { SessionGuard } from '../auth/session.guard';
import { AutoTopupState, DEFAULT_AUTO_TOPUP } from '../credits/credits.service';
import { BillingService, MAX_TOPUP, MIN_TOPUP } from './billing.service';

export class CheckoutDto {
  @ApiProperty({
    description: `Amount to pay in EUR, from ${MIN_TOPUP} to ${MAX_TOPUP} with at most 2 decimals. The balance is credited this amount minus the Stripe fee`,
    example: 20,
  })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(MIN_TOPUP)
  @Max(MAX_TOPUP)
  amount: number;
}

export class AutoTopupDto {
  @ApiProperty({
    description: 'Whether to top up automatically',
    example: true,
  })
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({
    description: `Amount to charge in EUR, from ${MIN_TOPUP} to ${MAX_TOPUP} with at most 2 decimals. Kept when left out, ${DEFAULT_AUTO_TOPUP.amount} at first`,
    example: 10,
  })
  @ValidateIf((_dto, value) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(MIN_TOPUP)
  @Max(MAX_TOPUP)
  amount?: number;

  @ApiPropertyOptional({
    description: `Balance in EUR at or below which a debit triggers the top-up, 0 or more with at most 2 decimals. Kept when left out, ${DEFAULT_AUTO_TOPUP.threshold} at first`,
    example: 5,
  })
  @ValidateIf((_dto, value) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  threshold?: number;
}

export class AutoTopupStateDto implements AutoTopupState {
  @ApiProperty({ example: true })
  enabled: boolean;

  @ApiProperty({ description: 'Amount charged in EUR', example: 10 })
  amount: number;

  @ApiProperty({ description: 'Trigger balance in EUR', example: 5 })
  threshold: number;

  @ApiProperty({ description: 'Whether a card is saved', example: true })
  hasCard: boolean;

  @ApiProperty({
    description:
      'Whether a failed payment paused it until a new card is saved or the settings are saved again',
    example: false,
  })
  paused: boolean;

  @ApiProperty({
    description:
      'Why it was paused: a Stripe error or decline code, or requires_action',
    example: null,
    nullable: true,
    type: String,
  })
  pausedReason: string | null;
}

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(private readonly billingService: BillingService) {}

  @Post('checkout')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Start a Stripe Checkout to top up the signed-in balance',
  })
  @ApiBody({ type: CheckoutDto })
  @ApiResponse({ status: 201, description: 'The Checkout page URL' })
  @ApiResponse({ status: 400, description: 'Amount out of bounds' })
  @ApiResponse({
    status: 401,
    description: 'Invalid, expired or missing session token',
  })
  @ApiResponse({ status: 502, description: 'Stripe request failed' })
  @ApiResponse({
    status: 503,
    description: 'STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET is not set',
  })
  checkout(
    @Body() body: CheckoutDto,
    @SessionAddress() owner: string,
  ): Promise<{ url: string }> {
    this.logger.log('POST /billing/checkout endpoint called');
    return this.billingService.checkout(owner, body.amount);
  }

  @Put('auto-topup')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Set or disable the automatic top-up of the signed-in balance',
  })
  @ApiBody({ type: AutoTopupDto })
  @ApiResponse({
    status: 200,
    description: 'The saved settings',
    type: AutoTopupStateDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid settings' })
  @ApiResponse({
    status: 401,
    description: 'Invalid, expired or missing session token',
  })
  @ApiResponse({
    status: 503,
    description: 'STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET is not set',
  })
  setAutoTopup(
    @Body() body: AutoTopupDto,
    @SessionAddress() owner: string,
  ): AutoTopupState {
    this.logger.log('PUT /billing/auto-topup endpoint called');
    return this.billingService.setAutoTopup(owner, body);
  }

  @Post('auto-topup/setup')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Start a Stripe Checkout that saves a card for auto top-ups',
  })
  @ApiResponse({ status: 201, description: 'The Checkout page URL' })
  @ApiResponse({
    status: 401,
    description: 'Invalid, expired or missing session token',
  })
  @ApiResponse({ status: 502, description: 'Stripe request failed' })
  @ApiResponse({
    status: 503,
    description: 'STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET is not set',
  })
  setupAutoTopup(@SessionAddress() owner: string): Promise<{ url: string }> {
    this.logger.log('POST /billing/auto-topup/setup endpoint called');
    return this.billingService.setupAutoTopup(owner);
  }

  // Called by Stripe only, so kept out of the Swagger documentation
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async webhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ): Promise<{ received: true }> {
    await this.billingService.handleWebhook(request.rawBody, signature);
    return { received: true };
  }
}

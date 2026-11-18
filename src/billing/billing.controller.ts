import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';
import { Request } from 'express';
import { SessionAddress } from '../auth/session-address.decorator';
import { SessionGuard } from '../auth/session.guard';
import { BillingService, MAX_TOPUP, MIN_TOPUP } from './billing.service';

export class CheckoutDto {
  @ApiProperty({
    description: `Amount of credits to buy in EUR, from ${MIN_TOPUP} to ${MAX_TOPUP}, in cents at most`,
    example: 20,
  })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(MIN_TOPUP)
  @Max(MAX_TOPUP)
  amount: number;
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
  @ApiResponse({ status: 503, description: 'Billing is not configured' })
  checkout(
    @Body() body: CheckoutDto,
    @SessionAddress() owner: string,
  ): Promise<{ url: string }> {
    this.logger.log('POST /billing/checkout endpoint called');
    return this.billingService.checkout(owner, body.amount);
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

import { Body, Controller, Logger, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiProperty,
  ApiResponse,
} from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { assertCreditsPassword } from '../credits-password';
import { PricingUpdateService } from './pricing-update.service';
import { PricingFile } from './pricing.service';

export class PricingUpdateDto {
  @ApiProperty({
    description: 'The credits password (CREDITS_PASSWORD)',
  })
  @IsString()
  @IsNotEmpty()
  password: string;
}

@Controller('pricing')
export class PricingController {
  private readonly logger = new Logger(PricingController.name);

  constructor(private readonly pricingUpdateService: PricingUpdateService) {}

  @Post('update')
  @ApiOperation({
    summary: 'Run the daily pricing update now',
    description:
      'Checks the current Claude rates and the USD to EUR rate, then returns the new pricing.',
  })
  @ApiBody({ type: PricingUpdateDto })
  @ApiResponse({ status: 201, description: 'The new pricing' })
  @ApiResponse({ status: 401, description: 'Invalid password' })
  updatePricing(@Body() body: PricingUpdateDto): Promise<PricingFile> {
    this.logger.log('POST /pricing/update endpoint called');
    assertCreditsPassword(body.password, 'pricing update');
    return this.pricingUpdateService.updatePricing();
  }
}

import { Global, Module } from '@nestjs/common';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';
import { PricingUpdateService } from './pricing-update.service';

@Global()
@Module({
  controllers: [PricingController],
  providers: [PricingService, PricingUpdateService],
  exports: [PricingService],
})
export class PricingModule {}

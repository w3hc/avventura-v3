import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { stripeClientProvider } from './stripe.client';

@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [BillingService, stripeClientProvider],
})
export class BillingModule {}

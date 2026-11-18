import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { CreditsModule } from './credits/credits.module';
import { PricingModule } from './pricing/pricing.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PricingModule,
    CreditsModule,
    AuthModule,
    BillingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CreditsModule } from './credits/credits.module';
import { PricingModule } from './pricing/pricing.module';

@Module({
  imports: [ScheduleModule.forRoot(), PricingModule, CreditsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

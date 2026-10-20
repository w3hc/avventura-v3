import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PricingModule } from './pricing/pricing.module';

@Module({
  imports: [ScheduleModule.forRoot(), PricingModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

import { Global, Module } from '@nestjs/common';
import { CreditsService } from './credits.service';

@Global()
@Module({
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}

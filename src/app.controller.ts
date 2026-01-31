import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiProperty,
  ApiResponse,
} from '@nestjs/swagger';
import { AppService } from './app.service';

class MoveDto {
  @ApiProperty({ description: 'The message to send to the assistant' })
  message: string;
}

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('models')
  @ApiOperation({ summary: 'List available AI models from Infomaniak' })
  @ApiResponse({ status: 200, description: 'List of available models' })
  async getModels() {
    return this.appService.getModels();
  }

  @Post('move')
  @ApiOperation({
    summary: 'Send a message to the assistant and get a response',
  })
  @ApiBody({ type: MoveDto })
  @ApiResponse({ status: 200, description: 'The AI response' })
  async move(@Body() body: MoveDto): Promise<string> {
    return this.appService.move(body.message);
  }
}

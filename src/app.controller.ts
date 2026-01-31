import {
  Body,
  Controller,
  Get,
  Post,
  Logger,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiProperty,
  ApiResponse,
} from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber } from 'class-validator';
import { AppService, Game, Step } from './app.service';

class MoveDto {
  @ApiProperty({ description: 'The game ID' })
  @IsString()
  @IsNotEmpty()
  gameId: string;

  @ApiProperty({ description: 'The index of the chosen option (0-2)' })
  @IsNumber()
  choiceIndex: number;
}

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(private readonly appService: AppService) {}

  @Get('models')
  @ApiOperation({ summary: 'List available AI models from Infomaniak' })
  @ApiResponse({ status: 200, description: 'List of available models' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @ApiResponse({ status: 502, description: 'Bad gateway - upstream API error' })
  async getModels() {
    this.logger.log('GET /models endpoint called');
    return this.appService.getModels();
  }

  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Start a new game',
  })
  @ApiResponse({
    status: 201,
    description: 'New game created successfully',
  })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async start(): Promise<Game> {
    this.logger.log('POST /start endpoint called');
    return this.appService.start();
  }

  @Post('move')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Make a choice and progress the story',
  })
  @ApiBody({ type: MoveDto })
  @ApiResponse({
    status: 200,
    description: 'Updated game state with new story progression',
  })
  @ApiResponse({ status: 400, description: 'Bad request - invalid input' })
  @ApiResponse({ status: 404, description: 'Game not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @ApiResponse({ status: 502, description: 'Bad gateway - upstream API error' })
  async move(
    @Body() body: MoveDto,
  ): Promise<{ previously: string; currentStep: Step; nextSteps: Step[] }> {
    this.logger.log('POST /move endpoint called');
    return this.appService.move(body.gameId, body.choiceIndex);
  }
}

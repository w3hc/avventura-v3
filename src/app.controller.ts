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
import { AppService, Game, Step, StoryData } from './app.service';

class StartDto {
  @ApiProperty({
    description: 'The story slug (e.g., "montpellier", "forest", "sailing")',
    required: false,
    default: 'montpellier',
  })
  @IsString()
  @IsNotEmpty()
  story?: string;

  @ApiProperty({
    description:
      'ISO 639-1 language code (e.g., "en", "es", "fr", "zh", "hi", "ar", "bn", "ru", "pt", "ur")',
    required: false,
    default: 'fr',
  })
  @IsString()
  language?: string;
}

class MoveDto {
  @ApiProperty({ description: 'The game ID', default: 'GFUELENQ' })
  @IsString()
  @IsNotEmpty()
  gameId: string;

  @ApiProperty({
    description: 'The index of the chosen option (1-3)',
    default: 1,
  })
  @IsNumber()
  choiceIndex: number;
}

class GetStateDto {
  @ApiProperty({ description: 'The game ID', default: 'GFUELENQ' })
  @IsString()
  @IsNotEmpty()
  gameId: string;
}

class CreateStoryDto {
  @ApiProperty({
    description: 'The prompt describing the story to create',
    example:
      'Create an adventure story set in ancient Rome where the player is a gladiator',
  })
  @IsString()
  @IsNotEmpty()
  prompt: string;
}

class EditStoryDto {
  @ApiProperty({
    description: 'The slug of the story to edit',
    example: 'montpellier',
  })
  @IsString()
  @IsNotEmpty()
  slug: string;

  @ApiProperty({
    description: 'The fields to update (partial story data)',
    required: false,
    example: {
      title: 'Updated Title',
      is_active: false,
    },
  })
  updates: Partial<Omit<StoryData, 'created_at'>>;
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

  @Get('stories')
  @ApiOperation({
    summary: 'Get all stories with slug, title, and homepage_display',
  })
  @ApiResponse({
    status: 200,
    description: 'List of all stories with their basic information',
  })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  getStories() {
    this.logger.log('GET /stories endpoint called');
    return this.appService.getStories();
  }

  @Post('stories')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new story using AI',
  })
  @ApiBody({ type: CreateStoryDto })
  @ApiResponse({
    status: 201,
    description: 'New story created successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request - invalid input' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @ApiResponse({ status: 502, description: 'Bad gateway - upstream API error' })
  async createStory(@Body() body: CreateStoryDto): Promise<StoryData> {
    this.logger.log('POST /stories endpoint called');
    return this.appService.createStory(body.prompt);
  }

  @Post('stories/edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Edit an existing story',
  })
  @ApiBody({ type: EditStoryDto })
  @ApiResponse({
    status: 200,
    description: 'Story updated successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request - invalid input' })
  @ApiResponse({ status: 404, description: 'Story not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async editStory(@Body() body: EditStoryDto): Promise<StoryData> {
    this.logger.log('POST /stories/edit endpoint called');
    return this.appService.editStory(body.slug, body.updates);
  }

  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Start a new game',
  })
  @ApiBody({ type: StartDto, required: false })
  @ApiResponse({
    status: 201,
    description: 'New game created successfully',
  })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async start(@Body() body?: StartDto): Promise<Game> {
    this.logger.log('POST /start endpoint called');
    const storySlug = body?.story?.trim() || 'montpellier';
    const language = body?.language?.trim() || 'fr';
    return this.appService.start(storySlug, language);
  }

  @Post('state')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get the full state of a game',
  })
  @ApiBody({ type: GetStateDto })
  @ApiResponse({
    status: 200,
    description: 'Full game state returned successfully',
  })
  @ApiResponse({ status: 404, description: 'Game not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  getState(@Body() body: GetStateDto): Game {
    this.logger.log('POST /state endpoint called');
    return this.appService.getState(body.gameId);
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
    return this.appService.move(body.gameId, body.choiceIndex - 1);
  }
}

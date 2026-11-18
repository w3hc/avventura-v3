import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Logger,
  HttpStatus,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiProperty,
  ApiResponse,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsArray,
  IsIn,
  IsPositive,
  IsEthereumAddress,
  ValidateNested,
} from 'class-validator';
import {
  AppService,
  DIFFICULTIES,
  Difficulty,
  Game,
  Me,
  Player,
  Step,
  StoryData,
  TEXT_LENGTHS,
  TextLength,
} from './app.service';
import { SiweAuthGuard } from './guards/siwe-auth.guard';
import { SiweAddress } from './guards/siwe-address.decorator';

const SIWE_HEADERS = [
  {
    name: 'x-siwe-message',
    description:
      'Percent-encoded EIP-4361 SIWE message whose statement is "Authorize <METHOD> <path>" for this exact request',
    required: true,
  },
  {
    name: 'x-siwe-signature',
    description: 'Signature over the x-siwe-message value',
    required: true,
  },
];

class PlayerDto implements Partial<Player> {
  @ApiProperty({
    description: "The player's name",
    example: 'Julien',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiProperty({
    description: 'Optional additional info about the player/character',
    required: false,
    example: 'Left-handed, afraid of heights',
  })
  @IsOptional()
  @IsString()
  info?: string;
}

export class StartDto {
  @ApiProperty({
    description: 'The story slug (e.g., "montpellier", "forest", "sailing")',
    required: false,
    default: 'montpellier',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  story?: string;

  @ApiProperty({
    description:
      'ISO 639-1 language code (e.g., "en", "es", "fr", "zh", "hi", "ar", "bn", "ru", "pt", "ur")',
    required: false,
    default: 'fr',
  })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiProperty({
    description: 'The players taking part in the adventure',
    required: false,
    type: [PlayerDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlayerDto)
  players?: PlayerDto[];

  @ApiProperty({
    description: 'How hard the adventure is to survive',
    required: false,
    enum: DIFFICULTIES,
    default: 'easy',
  })
  @IsOptional()
  @IsIn(DIFFICULTIES)
  difficulty?: Difficulty;

  @ApiProperty({
    description: 'How long step descriptions are (short: at most 980 chars)',
    required: false,
    enum: TEXT_LENGTHS,
    default: 'normal',
  })
  @IsOptional()
  @IsIn(TEXT_LENGTHS)
  textLength?: TextLength;
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
    description:
      'The fields to update (partial story data); ownerAddress, credits, sessions, requests and created_at are ignored',
    required: false,
    example: {
      title: 'Updated Title',
      is_active: false,
    },
  })
  @IsOptional()
  updates: Partial<Omit<StoryData, 'created_at'>>;
}

export class AddCreditsDto {
  @ApiProperty({
    description: 'The owner address to top up',
    example: '0x1111111111111111111111111111111111111111',
  })
  @IsEthereumAddress()
  address: string;

  @ApiProperty({
    description: 'The amount to add, in EUR',
    example: 20,
  })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({
    description: 'The credits password (CREDITS_PASSWORD)',
  })
  @IsString()
  @IsNotEmpty()
  password: string;
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

  @Get('stories/:slug')
  @ApiOperation({
    summary: 'Get the full data for a single story by slug',
  })
  @ApiResponse({
    status: 200,
    description: 'Full story data',
  })
  @ApiResponse({ status: 404, description: 'Story not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  getStory(@Param('slug') slug: string): StoryData {
    this.logger.log(`GET /stories/${slug} endpoint called`);
    return this.appService.getStory(slug);
  }

  @Post('stories')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SiweAuthGuard)
  @ApiOperation({
    summary: 'Create a new story using AI, owned by the SIWE signer',
  })
  @ApiHeader(SIWE_HEADERS[0])
  @ApiHeader(SIWE_HEADERS[1])
  @ApiBody({ type: CreateStoryDto })
  @ApiResponse({
    status: 201,
    description: 'New story created successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request - invalid input' })
  @ApiResponse({
    status: 401,
    description: 'Invalid or missing SIWE signature',
  })
  @ApiResponse({ status: 402, description: 'The owner is out of credits' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @ApiResponse({ status: 502, description: 'Bad gateway - upstream API error' })
  async createStory(
    @Body() body: CreateStoryDto,
    @SiweAddress() ownerAddress: string,
  ): Promise<StoryData> {
    this.logger.log('POST /stories endpoint called');
    return this.appService.createStory(body.prompt, ownerAddress);
  }

  @Get('me')
  @UseGuards(SiweAuthGuard)
  @ApiOperation({
    summary: "The signer's address, balance (EUR) and stories with their spend",
  })
  @ApiHeader(SIWE_HEADERS[0])
  @ApiHeader(SIWE_HEADERS[1])
  @ApiResponse({
    status: 200,
    description:
      'Address, balance and owned stories, each with its LLM spend in EUR',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or missing SIWE signature',
  })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  getMe(@SiweAddress() address: string): Me {
    this.logger.log('GET /me endpoint called');
    return this.appService.getMe(address);
  }

  @Post('stories/edit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SiweAuthGuard)
  @ApiOperation({
    summary: "Edit an existing story, signed by the story's owner",
  })
  @ApiHeader(SIWE_HEADERS[0])
  @ApiHeader(SIWE_HEADERS[1])
  @ApiBody({ type: EditStoryDto })
  @ApiResponse({
    status: 200,
    description: 'Story updated successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request - invalid input' })
  @ApiResponse({
    status: 401,
    description: 'Invalid or missing SIWE signature',
  })
  @ApiResponse({
    status: 403,
    description: "Signer is not the story's ownerAddress",
  })
  @ApiResponse({ status: 404, description: 'Story not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  editStory(
    @Body() body: EditStoryDto,
    @SiweAddress() signerAddress: string,
  ): Promise<StoryData> {
    this.logger.log('POST /stories/edit endpoint called');
    return Promise.resolve(
      this.appService.editStory(body.slug, body.updates, signerAddress),
    );
  }

  @Post('credits')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Add credits (EUR) to an owner's balance",
  })
  @ApiBody({ type: AddCreditsDto })
  @ApiResponse({
    status: 200,
    description: 'Amount added and the new credits balance',
  })
  @ApiResponse({ status: 400, description: 'Bad request - invalid input' })
  @ApiResponse({ status: 401, description: 'Invalid password' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  addCredits(@Body() body: AddCreditsDto): { added: number; credits: number } {
    this.logger.log('POST /credits endpoint called');
    return this.appService.addCredits(body.address, body.amount, body.password);
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
  @ApiResponse({
    status: 402,
    description: "The story's owner is out of credits",
  })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async start(@Body() body?: StartDto): Promise<Game> {
    this.logger.log('POST /start endpoint called');
    const storySlug = body?.story?.trim() || 'montpellier';
    const language = body?.language?.trim() || 'fr';
    return this.appService.start(
      storySlug,
      language,
      body?.players,
      body?.difficulty,
      body?.textLength,
    );
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
  @ApiResponse({
    status: 402,
    description: "The story's owner is out of credits",
  })
  @ApiResponse({ status: 404, description: 'Game not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @ApiResponse({ status: 502, description: 'Bad gateway - upstream API error' })
  async move(@Body() body: MoveDto): Promise<{
    previously: string;
    currentStep: Step;
    nextSteps: Step[];
    spent: number;
  }> {
    this.logger.log('POST /move endpoint called');
    return this.appService.move(body.gameId, body.choiceIndex - 1);
  }
}

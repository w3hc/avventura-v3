import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  OnModuleInit,
} from '@nestjs/common';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
} from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

interface ChatCompletionResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Step {
  desc: string;
  options: string[];
  action: string;
}

export interface Game {
  id: string;
  story: string;
  language: string;
  previously: string;
  currentStep: Step;
  nextSteps: Step[];
}

export interface ModelsResponse {
  result: string;
  data: unknown[];
}

interface CostEntry {
  gameId: string;
  timestamp: string;
  costEuro: number;
}

interface CostsData {
  requests: CostEntry[];
  total: number;
}

export interface StoryData {
  slug: string;
  title: string;
  content: string;
  homepage_display: unknown;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  sessions?: number;
  requests?: number;
}

@Injectable()
export class AppService implements OnModuleInit {
  private readonly logger = new Logger(AppService.name);
  private readonly baseUrl = `https://api.infomaniak.com/1/ai/${process.env.INFOMANIAK_PRODUCT_ID}/openai/chat/completions`;
  private readonly gamesDir = join(process.cwd(), 'games');
  private readonly costsFilePath = join(process.cwd(), 'costs.json');

  onModuleInit() {
    if (!existsSync(this.gamesDir)) {
      this.logger.log('games directory not found, creating it');
      mkdirSync(this.gamesDir, { recursive: true });
    }
  }

  private generateGameId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let id = '';
    const bytes = randomBytes(8);
    for (let i = 0; i < 8; i++) {
      id += chars[bytes[i] % chars.length];
    }
    return id;
  }

  private getFirstStepText(language: string): string {
    const translations: Record<string, string> = {
      en: 'First step.',
      zh: '第一步。',
      hi: 'पहला कदम।',
      es: 'Primer paso.',
      fr: 'Première étape.',
      ar: 'الخطوة الأولى.',
      bn: 'প্রথম ধাপ।',
      ru: 'Первый шаг.',
      pt: 'Primeiro passo.',
      ur: 'پہلا قدم۔',
    };
    return translations[language] || 'Première étape.';
  }

  private readCosts(): CostsData {
    try {
      if (!existsSync(this.costsFilePath)) {
        return { requests: [], total: 0 };
      }
      const data = readFileSync(this.costsFilePath, 'utf-8');
      return JSON.parse(data) as CostsData;
    } catch (error) {
      this.logger.error(
        `Failed to read costs file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return { requests: [], total: 0 };
    }
  }

  // based on https://www.infomaniak.com/en/hosting/ai-services/prices
  private writeCost(gameId: string, costEuro: number): void {
    try {
      const costsData = this.readCosts();
      const roundedCost = parseFloat(costEuro.toFixed(5));
      const newEntry: CostEntry = {
        gameId,
        timestamp: new Date().toISOString(),
        costEuro: roundedCost,
      };
      costsData.requests.push(newEntry);
      costsData.total = parseFloat(
        costsData.requests
          .reduce((sum, entry) => sum + entry.costEuro, 0)
          .toFixed(5),
      );
      writeFileSync(
        this.costsFilePath,
        JSON.stringify(costsData, null, 2),
        'utf-8',
      );
      this.logger.debug(
        `Cost entry written: ${gameId} - €${roundedCost.toFixed(5)}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to write cost entry: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private readGame(gameId: string): Game | null {
    try {
      const gamePath = join(this.gamesDir, `${gameId}.json`);
      if (!existsSync(gamePath)) {
        return null;
      }
      const data = readFileSync(gamePath, 'utf-8');
      return JSON.parse(data) as Game;
    } catch (error) {
      this.logger.error(
        `Failed to read game ${gameId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return null;
    }
  }

  private getAllGameIds(): string[] {
    try {
      if (!existsSync(this.gamesDir)) {
        return [];
      }
      const files = readdirSync(this.gamesDir);
      return files
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.replace('.json', ''));
    } catch (error) {
      this.logger.error(
        `Failed to read games directory: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return [];
    }
  }

  private writeGame(game: Game): void {
    try {
      const gamePath = join(this.gamesDir, `${game.id}.json`);
      writeFileSync(gamePath, JSON.stringify(game, null, 4), 'utf-8');
    } catch (error) {
      this.logger.error(
        `Failed to write game ${game.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new HttpException(
        'Failed to save game data',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async start(
    story: string = 'montpellier',
    language: string = 'fr',
  ): Promise<Game> {
    this.logger.log(`Starting new game with story: ${story}`);

    // Load story content from stories.json
    let storyContent = '';
    try {
      const storiesPath = join(process.cwd(), 'stories', 'stories.json');
      const storiesData = JSON.parse(
        readFileSync(storiesPath, 'utf-8'),
      ) as StoryData[];
      const storyObj = storiesData.find((s) => s.slug === story);

      if (!storyObj) {
        throw new Error(`Story with slug "${story}" not found`);
      }

      storyContent = storyObj.content;
      this.logger.log(`Story content loaded from ${story}`);
    } catch (error) {
      this.logger.error(
        `Failed to load story content: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new HttpException(
        'Story file not found',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const systemPrompt = `# INSTRUCTIONS FOR THE MULTILINGUAL ADVENTURE

${storyContent}

## Your Task
Generate the initial state of the adventure as a JSON response with:
1. A "currentStep" field: The starting situation with description, 3 initial options, and action
2. A "nextSteps" field: An array of 3 possible future steps (one for each option in currentStep)

**Response Format (ONLY JSON, no markdown):**
{
  "currentStep": {
    "desc": "Description of the starting situation",
    "options": ["Option 1", "Option 2", "Option 3"],
    "action": "start"
  },
  "nextSteps": [
    {
      "desc": "What happens if Option 1 is chosen",
      "options": ["Next Option 1", "Next Option 2", "Next Option 3"],
      "action": "continue"
    },
    {
      "desc": "What happens if Option 2 is chosen",
      "options": ["Next Option 1", "Next Option 2", "Next Option 3"],
      "action": "continue"
    },
    {
      "desc": "What happens if Option 3 is chosen",
      "options": ["Next Option 1", "Next Option 2", "Next Option 3"],
      "action": "continue"
    }
  ]
}

**CRITICAL LANGUAGE INSTRUCTION:**
- Respond ENTIRELY in the language with ISO 639-1 code: ${language}
- ALL text in the JSON (descriptions, options, dialogue) must be in this language
- Maintain cultural authenticity while making it accessible to speakers of this language

**PATH DIVERGENCE REQUIREMENTS:**
- Each of the 3 paths MUST be EXTREMELY DIFFERENT from each other
- Different settings/locations: Each path should take place in different locations or environments
- Different characters: Each path should introduce unique NPCs that don't appear in other paths
- Different themes/tones: Each path should have a distinct emotional tone (adventure vs. danger vs. mystery vs. diplomacy, etc.)
- Mutually exclusive events: Choosing one path should lock out the events/opportunities from other paths
- Different consequences: Each path leads to fundamentally different outcomes, not just variations
- Different skills/resources: Each path should involve different abilities, tools, or knowledge

**IMPORTANT:**
- Return ONLY the JSON object, no markdown code blocks
- Each nextStep should meaningfully correspond to its option in currentStep
- Set action to "start" for the initial step`;

    const messages: Message[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: 'Initialize the adventure',
      },
    ];

    try {
      const totalPromptChars = messages.reduce(
        (sum, msg) => sum + msg.content.length,
        0,
      );
      this.logger.debug(`Calling Anthropic API`);
      this.logger.debug(`Total prompt characters: ${totalPromptChars}`);

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY || '',
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: messages[0].content,
          messages: messages.slice(1).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `Anthropic API error: ${response.status} ${response.statusText} - ${errorBody}`,
          'start',
        );
        throw new HttpException(
          {
            statusCode: response.status,
            message: 'Failed to get AI response',
            error: errorBody,
          },
          response.status >= 500 ? HttpStatus.BAD_GATEWAY : response.status,
        );
      }

      const data = (await response.json()) as { content: { type: string; text: string }[]; usage?: { input_tokens: number; output_tokens: number } };

      let totalCost = 0;
      if (data.usage) {
        const inputCost = (data.usage.input_tokens / 1_000_000) * 3.0;
        const outputCost = (data.usage.output_tokens / 1_000_000) * 15.0;
        totalCost = inputCost + outputCost;

        this.logger.log(
          `API Usage - Input tokens: ${data.usage.input_tokens}, ` +
            `Output tokens: ${data.usage.output_tokens} | ` +
            `Cost: $${totalCost.toFixed(6)} (Input: $${inputCost.toFixed(6)}, Output: $${outputCost.toFixed(6)})`,
        );
      }

      if (!data.content || data.content.length === 0) {
        this.logger.error('Invalid API response: no content returned', 'start');
        throw new HttpException(
          'Invalid response from AI service',
          HttpStatus.BAD_GATEWAY,
        );
      }

      const assistantMessage = data.content[0]?.text ?? '';

      if (!assistantMessage) {
        this.logger.warn('Empty assistant message in API response');
        throw new HttpException(
          'Empty response from AI service',
          HttpStatus.BAD_GATEWAY,
        );
      }

      this.logger.log(
        `Successfully received AI response (${assistantMessage.length} chars)`,
      );

      // Strip markdown code blocks if present
      let jsonString = assistantMessage.trim();
      if (jsonString.startsWith('```')) {
        jsonString = jsonString
          .replace(/^```(?:json)?\n/, '')
          .replace(/\n```$/, '');
      }

      // Parse the AI response
      let aiResponse: {
        currentStep: Step;
        nextSteps: Step[];
      };
      try {
        aiResponse = JSON.parse(jsonString) as {
          currentStep: Step;
          nextSteps: Step[];
        };
      } catch (parseError) {
        this.logger.error(
          `Failed to parse AI response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
        );
        this.logger.debug(`AI response was: ${assistantMessage}`);
        throw new HttpException(
          'Invalid JSON response from AI service',
          HttpStatus.BAD_GATEWAY,
        );
      }

      const newGame: Game = {
        id: this.generateGameId(),
        story,
        language,
        previously:
          language === 'en' ? 'First step.' : this.getFirstStepText(language),
        currentStep: aiResponse.currentStep,
        nextSteps: aiResponse.nextSteps,
      };

      this.writeGame(newGame);
      this.writeCost(newGame.id, totalCost);

      this.logger.log(`Created new game with ID: ${newGame.id}`);
      return newGame;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Unexpected error in start: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new HttpException(
        'Internal server error while initializing game',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private getGame(gameId: string): Game {
    const game = this.readGame(gameId);

    if (!game) {
      this.logger.warn(`Game not found: ${gameId}`);
      throw new HttpException('Game not found', HttpStatus.NOT_FOUND);
    }

    return game;
  }

  private updateGame(
    gameId: string,
    previously: string,
    currentStep: Step,
    nextSteps: Step[],
  ): void {
    const game = this.readGame(gameId);

    if (!game) {
      throw new HttpException('Game not found', HttpStatus.NOT_FOUND);
    }

    game.previously = previously;
    game.currentStep = currentStep;
    game.nextSteps = nextSteps;
    this.writeGame(game);
    this.logger.log(`Updated game state for ID: ${gameId}`);
  }

  async getModels(): Promise<ModelsResponse> {
    this.logger.log('Fetching available AI models from Infomaniak');

    try {
      const response = await fetch('https://api.infomaniak.com/1/ai/models', {
        headers: {
          Authorization: `Bearer ${process.env.INFOMANIAK_API_KEY}`,
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `Failed to fetch models: ${response.status} - ${errorBody}`,
          'getModels',
        );
        throw new HttpException(
          {
            statusCode: response.status,
            message: 'Failed to fetch AI models',
            error: errorBody,
          },
          response.status,
        );
      }

      const data = (await response.json()) as ModelsResponse;
      this.logger.log(`Successfully fetched ${data.data?.length || 0} models`);
      return data;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Unexpected error fetching models: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new HttpException(
        'Internal server error while fetching models',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  getState(gameId: string): Game {
    this.logger.log(`Fetching state for game ${gameId}`);
    return this.getGame(gameId);
  }

  getStories(): { slug: string; title: string; homepage_display: unknown }[] {
    this.logger.log('Fetching all stories');
    try {
      const storiesPath = join(process.cwd(), 'stories', 'stories.json');
      const storiesData = JSON.parse(
        readFileSync(storiesPath, 'utf-8'),
      ) as StoryData[];
      return storiesData
        .filter((story) => story.is_active === true)
        .map((story) => ({
          slug: story.slug,
          title: story.title,
          homepage_display: story.homepage_display,
        }));
    } catch (error) {
      this.logger.error(
        `Failed to load stories: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new HttpException(
        'Failed to load stories',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async createStory(prompt: string): Promise<StoryData> {
    this.logger.log(`Creating new story from prompt: ${prompt}`);

    // Read the instruction file
    let instructions = '';
    try {
      const instructionPath = process.env.AVVENTURA_INSTRUCTION_FILE_PATH ||
        join(process.cwd(), 'avventura-edit-instruction-file.md');
      instructions = readFileSync(instructionPath, 'utf-8');
      this.logger.log('Loaded story creation instructions');
    } catch (error) {
      this.logger.error(
        `Failed to load instruction file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new HttpException(
        'Instruction file not found',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      {
        role: 'user',
        content: prompt,
      },
    ];

    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;

      if (!apiKey) {
        this.logger.error('ANTHROPIC_API_KEY is not configured');
        throw new HttpException(
          'ANTHROPIC_API_KEY is not configured',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      this.logger.debug(`Calling Claude API to create story`);

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 8192,
          system: instructions,
          messages,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `Claude API error: ${response.status} ${response.statusText} - ${errorBody}`,
          'createStory',
        );
        throw new HttpException(
          {
            statusCode: response.status,
            message: 'Failed to get AI response',
            error: errorBody,
          },
          response.status >= 500 ? HttpStatus.BAD_GATEWAY : response.status,
        );
      }

      const data = (await response.json()) as {
        content: { type: string; text: string }[];
      };

      if (!data.content || data.content.length === 0) {
        this.logger.error('Invalid API response: no content returned');
        throw new HttpException(
          'Invalid response from AI service',
          HttpStatus.BAD_GATEWAY,
        );
      }

      const assistantMessage = data.content[0]?.text ?? '';

      if (!assistantMessage) {
        this.logger.warn('Empty assistant message in API response');
        throw new HttpException(
          'Empty response from AI service',
          HttpStatus.BAD_GATEWAY,
        );
      }

      this.logger.log(
        `Successfully received AI response (${assistantMessage.length} chars)`,
      );

      // Strip markdown code blocks if present
      let jsonString = assistantMessage.trim();
      if (jsonString.startsWith('```')) {
        jsonString = jsonString
          .replace(/^```(?:json)?\n/, '')
          .replace(/\n```$/, '');
      }

      // Parse the AI response
      let newStory: Omit<StoryData, 'created_at' | 'updated_at' | 'is_active'>;
      try {
        newStory = JSON.parse(jsonString) as Omit<
          StoryData,
          'created_at' | 'updated_at' | 'is_active'
        >;
      } catch (parseError) {
        this.logger.error(
          `Failed to parse AI response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
        );
        this.logger.debug(`AI response was: ${assistantMessage}`);
        throw new HttpException(
          'Invalid JSON response from AI service',
          HttpStatus.BAD_GATEWAY,
        );
      }

      // Read existing stories
      const storiesPath = join(process.cwd(), 'stories', 'stories.json');
      let stories: StoryData[] = [];
      try {
        const storiesData = readFileSync(storiesPath, 'utf-8');
        stories = JSON.parse(storiesData) as StoryData[];
      } catch (error) {
        this.logger.error(
          `Failed to read stories file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        throw new HttpException(
          'Failed to read stories file',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Create complete story entry with metadata
      const completeStory: StoryData = {
        ...newStory,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_active: true,
        sessions: 0,
        requests: 0,
      };

      // Add the new story to the array
      stories.push(completeStory);

      // Write back to the file
      try {
        writeFileSync(storiesPath, JSON.stringify(stories, null, 4), 'utf-8');
        this.logger.log(
          `Successfully added story with slug: ${completeStory.slug}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to write stories file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        throw new HttpException(
          'Failed to save story',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      return completeStory;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Unexpected error in createStory: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new HttpException(
        'Internal server error while creating story',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async editStory(
    slug: string,
    updates: Partial<Omit<StoryData, 'created_at'>>,
  ): Promise<StoryData> {
    this.logger.log(`Editing story with slug: ${slug}`);

    // Read existing stories
    const storiesPath = join(process.cwd(), 'stories', 'stories.json');
    let stories: StoryData[] = [];
    try {
      const storiesData = readFileSync(storiesPath, 'utf-8');
      stories = JSON.parse(storiesData) as StoryData[];
    } catch (error) {
      this.logger.error(
        `Failed to read stories file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new HttpException(
        'Failed to read stories file',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Find the story to edit
    const storyIndex = stories.findIndex((s) => s.slug === slug);
    if (storyIndex === -1) {
      this.logger.warn(`Story not found: ${slug}`);
      throw new HttpException('Story not found', HttpStatus.NOT_FOUND);
    }

    // Update the story with new values
    const updatedStory: StoryData = {
      ...stories[storyIndex],
      ...updates,
      updated_at: new Date().toISOString(),
    };

    // Replace the story in the array
    stories[storyIndex] = updatedStory;

    // Write back to the file
    try {
      writeFileSync(storiesPath, JSON.stringify(stories, null, 4), 'utf-8');
      this.logger.log(`Successfully updated story with slug: ${slug}`);
    } catch (error) {
      this.logger.error(
        `Failed to write stories file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new HttpException(
        'Failed to save story',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return updatedStory;
  }

  async move(
    gameId: string,
    choiceIndex: number,
  ): Promise<{ previously: string; currentStep: Step; nextSteps: Step[] }> {
    this.logger.log(
      `Processing move request for game ${gameId} with choice index: ${choiceIndex}`,
    );

    // Get the game
    const game = this.getGame(gameId);
    const language = game.language;

    // Validate choice index
    if (
      choiceIndex < 0 ||
      choiceIndex >= game.currentStep.options.length ||
      (game.nextSteps.length > 0 && choiceIndex >= game.nextSteps.length)
    ) {
      throw new HttpException('Invalid choice index', HttpStatus.BAD_REQUEST);
    }

    // Determine the new current step from nextSteps
    const newCurrentStep =
      game.nextSteps.length > 0
        ? game.nextSteps[choiceIndex]
        : game.currentStep;

    // Load story content from stories.json
    let storyContent = '';
    try {
      const storiesPath = join(process.cwd(), 'stories', 'stories.json');
      const storiesData = JSON.parse(
        readFileSync(storiesPath, 'utf-8'),
      ) as StoryData[];
      const storyObj = storiesData.find((s) => s.slug === game.story);

      if (!storyObj) {
        throw new Error(`Story with slug "${game.story}" not found`);
      }

      storyContent = storyObj.content;
      this.logger.log(`Story content loaded from ${game.story}`);
    } catch (error) {
      this.logger.error(
        `Failed to load story content: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new HttpException(
        'Story file not found',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const systemPrompt = `# STORY INSTRUCTIONS
${storyContent}

## Story Recap
${game.previously}

## Player's Choice
The player chose option ${choiceIndex + 1}: "${game.currentStep.options[choiceIndex]}"

## Current Situation
The player is now in this situation:
${newCurrentStep.desc}

Available options for the player:
${newCurrentStep.options.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}

## Your Task
Generate ONLY two fields:
1. A "previously" field: Update the story recap by combining the previous recap ("${game.previously}") with what just happened (the player chose "${game.currentStep.options[choiceIndex]}" and the outcome was: "${newCurrentStep.desc}"). It must summarize the journey so far. The "previously" field MUST contain a maximum of 3000 characters (including spaces and punctuation).
2. A "nextSteps" field: An array of 3 possible future scenarios, one for each of the current options (${newCurrentStep.options.join(', ')}). Each scenario describes what will happen if that option is chosen.

**Response Format (ONLY JSON, no markdown):**
{
  "previously": "Updated recap combining the old recap with the chosen option and what happened",
  "nextSteps": [
    {
      "desc": "What happens if '${newCurrentStep.options[0]}' is chosen",
      "options": ["Next Option 1", "Next Option 2", "Next Option 3"],
      "action": "continue"
    },
    {
      "desc": "What happens if '${newCurrentStep.options[1]}' is chosen",
      "options": ["Next Option 1", "Next Option 2", "Next Option 3"],
      "action": "continue"
    },
    {
      "desc": "What happens if '${newCurrentStep.options[2]}' is chosen",
      "options": ["Next Option 1", "Next Option 2", "Next Option 3"],
      "action": "continue"
    }
  ]
}

**CRITICAL LANGUAGE INSTRUCTION:**
- Respond ENTIRELY in the language with ISO 639-1 code: ${language}
- ALL text in the JSON (descriptions, options, dialogue) must be in this language
- Maintain cultural authenticity while making it accessible to speakers of this language

**PATH DIVERGENCE REQUIREMENTS:**
- Each of the 3 paths MUST be EXTREMELY DIFFERENT from each other
- Different settings/locations: Each path should take place in different locations or environments
- Different characters: Each path should introduce unique NPCs that don't appear in other paths
- Different themes/tones: Each path should have a distinct emotional tone (adventure vs. danger vs. mystery vs. diplomacy, etc.)
- Mutually exclusive events: Choosing one path should lock out the events/opportunities from other paths
- Different consequences: Each path leads to fundamentally different outcomes, not just variations
- Different skills/resources: Each path should involve different abilities, tools, or knowledge
- Ensure paths remain distinct throughout the story, not converging back together

**IMPORTANT:**
- Return ONLY the JSON object with "previously" and "nextSteps" fields - DO NOT include "currentStep"
- No markdown code blocks
- The "previously" field MUST incorporate both the old recap AND the new events
- Keep the story progressive and NEVER repeat situations or scenarios from the previously recap
- Each new scenario must introduce NEW elements, locations, characters, or events
- Review the previously recap carefully and ensure all new content is fresh and different
- Each nextStep must meaningfully correspond to the option it represents
- Set action to "milestone" for significant story points, "continue" otherwise`;

    const messages: Message[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: `The player chose: ${game.currentStep.options[choiceIndex]}`,
      },
    ];

    try {
      const totalPromptChars = messages.reduce(
        (sum, msg) => sum + msg.content.length,
        0,
      );
      this.logger.debug(`Calling Anthropic API`);
      this.logger.debug(`Total prompt characters: ${totalPromptChars}`);

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY || '',
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: messages[0].content,
          messages: messages.slice(1).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `Anthropic API error: ${response.status} ${response.statusText} - ${errorBody}`,
          'move',
        );
        throw new HttpException(
          {
            statusCode: response.status,
            message: 'Failed to get AI response',
            error: errorBody,
          },
          response.status >= 500 ? HttpStatus.BAD_GATEWAY : response.status,
        );
      }

      const data = (await response.json()) as { content: { type: string; text: string }[]; usage?: { input_tokens: number; output_tokens: number } };

      let totalCost = 0;
      if (data.usage) {
        const inputCost = (data.usage.input_tokens / 1_000_000) * 3.0;
        const outputCost = (data.usage.output_tokens / 1_000_000) * 15.0;
        totalCost = inputCost + outputCost;

        this.logger.log(
          `API Usage - Input tokens: ${data.usage.input_tokens}, ` +
            `Output tokens: ${data.usage.output_tokens} | ` +
            `Cost: $${totalCost.toFixed(6)} (Input: $${inputCost.toFixed(6)}, Output: $${outputCost.toFixed(6)})`,
        );
      }

      if (!data.content || data.content.length === 0) {
        this.logger.error('Invalid API response: no content returned', 'move');
        throw new HttpException(
          'Invalid response from AI service',
          HttpStatus.BAD_GATEWAY,
        );
      }

      const assistantMessage = data.content[0]?.text ?? '';

      if (!assistantMessage) {
        this.logger.warn('Empty assistant message in API response');
        throw new HttpException(
          'Empty response from AI service',
          HttpStatus.BAD_GATEWAY,
        );
      }

      this.logger.log(
        `Successfully received AI response (${assistantMessage.length} chars)`,
      );

      // Strip markdown code blocks if present
      let jsonString = assistantMessage.trim();
      if (jsonString.startsWith('```')) {
        jsonString = jsonString
          .replace(/^```(?:json)?\n/, '')
          .replace(/\n```$/, '');
      }

      // Parse the AI response
      let aiResponse: {
        previously: string;
        nextSteps: Step[];
      };
      try {
        aiResponse = JSON.parse(jsonString) as {
          previously: string;
          nextSteps: Step[];
        };
      } catch (parseError) {
        this.logger.error(
          `Failed to parse AI response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
        );
        this.logger.debug(`AI response was: ${assistantMessage}`);
        throw new HttpException(
          'Invalid JSON response from AI service',
          HttpStatus.BAD_GATEWAY,
        );
      }

      // Use the exact Step from the previous nextSteps as the new currentStep
      // The AI only generates the new 'previously' recap and new 'nextSteps'

      // Update the game with new state
      this.updateGame(
        gameId,
        aiResponse.previously,
        newCurrentStep,
        aiResponse.nextSteps,
      );
      this.writeCost(gameId, totalCost);

      return {
        previously: aiResponse.previously,
        currentStep: newCurrentStep,
        nextSteps: aiResponse.nextSteps,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Unexpected error in move: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new HttpException(
        'Internal server error while processing AI request',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

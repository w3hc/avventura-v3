import { Injectable, Logger, HttpException, HttpStatus, OnModuleInit } from '@nestjs/common';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

interface ChatCompletionResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
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
  previously: string;
  currentStep: Step;
  nextSteps: Step[];
}

export interface ModelsResponse {
  result: string;
  data: unknown[];
}

@Injectable()
export class AppService implements OnModuleInit {
  private readonly logger = new Logger(AppService.name);
  private readonly baseUrl = `https://api.infomaniak.com/1/ai/${process.env.INFOMANIAK_PRODUCT_ID}/openai/chat/completions`;
  private readonly gamesPath = join(process.cwd(), 'games.json');

  onModuleInit() {
    if (!existsSync(this.gamesPath)) {
      this.logger.log('games.json not found, creating empty file');
      writeFileSync(this.gamesPath, '[]', 'utf-8');
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

  private readGames(): Game[] {
    try {
      const data = readFileSync(this.gamesPath, 'utf-8');
      return JSON.parse(data) as Game[];
    } catch (error) {
      this.logger.error(
        `Failed to read games.json: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return [];
    }
  }

  private writeGames(games: Game[]): void {
    try {
      writeFileSync(this.gamesPath, JSON.stringify(games, null, 2), 'utf-8');
    } catch (error) {
      this.logger.error(
        `Failed to write games.json: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new HttpException(
        'Failed to save game data',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async start(story: string = 'in-the-forest.md'): Promise<Game> {
    this.logger.log(`Starting new game with story: ${story}`);

    // Load story content
    let storyContent = '';
    try {
      const storyPath = join(process.cwd(), 'stories', story);
      storyContent = readFileSync(storyPath, 'utf-8');
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
- Respond ENTIRELY in: French
- ALL text (descriptions, options, dialogue) must be in French
- Maintain cultural authenticity while making it accessible to French speakers

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
      this.logger.debug(`Calling Infomaniak API: ${this.baseUrl}`);

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.INFOMANIAK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'mistral3',
          messages,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `Infomaniak API error: ${response.status} ${response.statusText} - ${errorBody}`,
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

      const data = (await response.json()) as ChatCompletionResponse;

      if (!data.choices || data.choices.length === 0) {
        this.logger.error('Invalid API response: no choices returned', 'start');
        throw new HttpException(
          'Invalid response from AI service',
          HttpStatus.BAD_GATEWAY,
        );
      }

      const assistantMessage = data.choices[0]?.message?.content ?? '';

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
        previously: 'First step.',
        currentStep: aiResponse.currentStep,
        nextSteps: aiResponse.nextSteps,
      };

      const games = this.readGames();
      games.push(newGame);
      this.writeGames(games);

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
    const games = this.readGames();
    const game = games.find((g) => g.id === gameId);

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
    const games = this.readGames();
    const gameIndex = games.findIndex((g) => g.id === gameId);

    if (gameIndex === -1) {
      throw new HttpException('Game not found', HttpStatus.NOT_FOUND);
    }

    games[gameIndex].previously = previously;
    games[gameIndex].currentStep = currentStep;
    games[gameIndex].nextSteps = nextSteps;
    this.writeGames(games);
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

  async move(
    gameId: string,
    choiceIndex: number,
  ): Promise<{ previously: string; currentStep: Step; nextSteps: Step[] }> {
    this.logger.log(
      `Processing move request for game ${gameId} with choice index: ${choiceIndex}`,
    );

    // Get the game
    const game = this.getGame(gameId);

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

    // Load story content
    let storyContent = '';
    try {
      const storyPath = join(process.cwd(), 'stories', game.story);
      storyContent = readFileSync(storyPath, 'utf-8');
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

    const systemPrompt = `# INSTRUCTIONS FOR THE MULTILINGUAL ADVENTURE

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
1. A "previously" field: Update the story recap by combining the previous recap ("${game.previously}") with what just happened (the player chose "${game.currentStep.options[choiceIndex]}" and the outcome was: "${newCurrentStep.desc}"). Keep it to 2-3 sentences summarizing the journey so far.
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
- Respond ENTIRELY in: French
- ALL text (descriptions, options, dialogue) must be in French
- Maintain cultural authenticity while making it accessible to French speakers

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
      this.logger.debug(`Calling Infomaniak API: ${this.baseUrl}`);

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.INFOMANIAK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'mistral3',
          messages,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `Infomaniak API error: ${response.status} ${response.statusText} - ${errorBody}`,
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

      const data = (await response.json()) as ChatCompletionResponse;

      if (!data.choices || data.choices.length === 0) {
        this.logger.error('Invalid API response: no choices returned', 'move');
        throw new HttpException(
          'Invalid response from AI service',
          HttpStatus.BAD_GATEWAY,
        );
      }

      const assistantMessage = data.choices[0]?.message?.content ?? '';

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

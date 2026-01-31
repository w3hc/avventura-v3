import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import * as modelsData from '../models-infomaniak.json';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('getModels', () => {
    it('should return models', async () => {
      const mockResponse = modelsData as {
        result: string;
        data: unknown[];
      };

      jest
        .spyOn(appController['appService'], 'getModels')
        .mockResolvedValue(mockResponse);

      const result = await appController.getModels();
      expect(result).toEqual(modelsData);
      expect(result.data).toHaveLength(15);
      expect(
        result.data.some((m) => (m as { name: string }).name === 'mistral3'),
      ).toBe(true);
    });
  });

  describe('start', () => {
    it('should create a new game with default story', async () => {
      const mockGame = {
        id: 'ABCDEFGH',
        story: 'in-the-forest.md',
        previously: 'First step.',
        currentStep: {
          desc: 'You are in the forest...',
          options: ['Go left', 'Go right', 'Go back'],
          action: 'start',
        },
        nextSteps: [
          {
            desc: 'You go left...',
            options: ['Continue', 'Stop', 'Turn back'],
            action: 'continue',
          },
          {
            desc: 'You go right...',
            options: ['Continue', 'Stop', 'Turn back'],
            action: 'continue',
          },
          {
            desc: 'You go back...',
            options: ['Continue', 'Stop', 'Turn back'],
            action: 'continue',
          },
        ],
      };

      const startSpy = jest
        .spyOn(appController['appService'], 'start')
        .mockResolvedValue(mockGame);

      const result = await appController.start();
      expect(result).toEqual(mockGame);
      expect(startSpy).toHaveBeenCalledWith('in-the-forest.md');
    });

    it('should create a new game with custom story', async () => {
      const mockGame = {
        id: 'TESTGAME',
        story: 'montpellier-medieval.md',
        previously: 'First step.',
        currentStep: {
          desc: 'You are in medieval Montpellier...',
          options: ['Visit market', 'Go to castle', 'Explore'],
          action: 'start',
        },
        nextSteps: [
          {
            desc: 'You visit the market...',
            options: ['Buy food', 'Talk to merchant', 'Leave'],
            action: 'continue',
          },
          {
            desc: 'You go to the castle...',
            options: ['Enter', 'Look around', 'Leave'],
            action: 'continue',
          },
          {
            desc: 'You explore...',
            options: ['Continue', 'Stop', 'Rest'],
            action: 'continue',
          },
        ],
      };

      const startSpy = jest
        .spyOn(appController['appService'], 'start')
        .mockResolvedValue(mockGame);

      const result = await appController.start({
        story: 'montpellier-medieval',
      });
      expect(result).toEqual(mockGame);
      expect(startSpy).toHaveBeenCalledWith('montpellier-medieval.md');
    });
  });

  describe('move', () => {
    it('should return updated game state for a valid move', async () => {
      const mockGameId = 'ABCDEFGH';
      const mockChoiceIndex = 1;
      const mockResponse = {
        previously: 'You started in the forest. You chose to go left.',
        currentStep: {
          desc: 'You walk deeper into the forest...',
          options: ['Go left', 'Go right', 'Go back'],
          action: 'continue',
        },
        nextSteps: [
          {
            desc: 'You continue left and find a cave...',
            options: ['Enter cave', 'Keep walking', 'Go back'],
            action: 'continue',
          },
          {
            desc: 'You turn right and see a river...',
            options: ['Cross river', 'Follow river', 'Go back'],
            action: 'continue',
          },
          {
            desc: 'You go back to the start...',
            options: ['Try again', 'Rest', 'Leave'],
            action: 'continue',
          },
        ],
      };

      const moveSpy = jest
        .spyOn(appController['appService'], 'move')
        .mockResolvedValue(mockResponse);

      const result = await appController.move({
        gameId: mockGameId,
        choiceIndex: mockChoiceIndex,
      });
      expect(result).toEqual(mockResponse);
      expect(moveSpy).toHaveBeenCalledWith(mockGameId, mockChoiceIndex - 1);
    });
  });
});

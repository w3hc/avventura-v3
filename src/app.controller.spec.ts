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
    it('should create a new game', () => {
      const mockGame = {
        id: 'ABCDEFGH',
        story: 'in-the-forest.md',
        state: 'The story just began.',
      };

      const startSpy = jest
        .spyOn(appController['appService'], 'start')
        .mockReturnValue(mockGame);

      const result = appController.start();
      expect(result).toEqual(mockGame);
      expect(startSpy).toHaveBeenCalled();
    });
  });

  describe('move', () => {
    it('should return AI response for a game', async () => {
      const mockGameId = 'ABCDEFGH';
      const mockMessage = 'Choice 1';
      const mockResponse = {
        response:
          '{"desc": "You walk deeper into the forest...", "options": ["Go left", "Go right", "Go back"]}',
      };

      const moveSpy = jest
        .spyOn(appController['appService'], 'move')
        .mockResolvedValue(mockResponse);

      const result = await appController.move({
        gameId: mockGameId,
        message: mockMessage,
      });
      expect(result).toEqual(mockResponse);
      expect(moveSpy).toHaveBeenCalledWith(mockGameId, mockMessage);
    });
  });
});

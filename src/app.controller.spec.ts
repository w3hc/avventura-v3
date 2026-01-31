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

  describe('move', () => {
    it('should return AI response', async () => {
      const mockMessage = 'What is the capital of France?';
      const mockResponse = 'The capital of France is Paris.';

      const moveSpy = jest
        .spyOn(appController['appService'], 'move')
        .mockResolvedValue(mockResponse);

      const result = await appController.move({ message: mockMessage });
      expect(result).toBe(mockResponse);
      expect(moveSpy).toHaveBeenCalledWith(mockMessage);
    });
  });
});

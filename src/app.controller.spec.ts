import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AppController, StartDto } from './app.controller';
import {
  AppService,
  Difficulty,
  Game,
  SHORT_DESC_MAX,
  Step,
  TextLength,
} from './app.service';
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
        language: 'fr',
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
      expect(startSpy).toHaveBeenCalledWith(
        'montpellier',
        'fr',
        undefined,
        undefined,
        undefined,
      );
    });

    it('should create a new game with custom story', async () => {
      const mockGame = {
        id: 'TESTGAME',
        story: 'montpellier-medieval.md',
        language: 'fr',
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
      expect(startSpy).toHaveBeenCalledWith(
        'montpellier-medieval',
        'fr',
        undefined,
        undefined,
        undefined,
      );
    });

    it('should create a new game with custom language', async () => {
      const mockGame = {
        id: 'TESTGAME',
        story: 'in-the-forest.md',
        language: 'es',
        previously: 'Primer paso.',
        currentStep: {
          desc: 'Estás en el bosque...',
          options: ['Ir a la izquierda', 'Ir a la derecha', 'Volver'],
          action: 'start',
        },
        nextSteps: [
          {
            desc: 'Vas a la izquierda...',
            options: ['Continuar', 'Parar', 'Volver'],
            action: 'continue',
          },
          {
            desc: 'Vas a la derecha...',
            options: ['Continuar', 'Parar', 'Volver'],
            action: 'continue',
          },
          {
            desc: 'Vuelves...',
            options: ['Continuar', 'Parar', 'Volver'],
            action: 'continue',
          },
        ],
      };

      const startSpy = jest
        .spyOn(appController['appService'], 'start')
        .mockResolvedValue(mockGame);

      const result = await appController.start({
        language: 'es',
      });
      expect(result).toEqual(mockGame);
      expect(startSpy).toHaveBeenCalledWith(
        'montpellier',
        'es',
        undefined,
        undefined,
        undefined,
      );
    });

    it('should create a new game with custom story and language', async () => {
      const mockGame = {
        id: 'TESTGAME',
        story: 'montpellier-medieval.md',
        language: 'en',
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
        language: 'en',
      });
      expect(result).toEqual(mockGame);
      expect(startSpy).toHaveBeenCalledWith(
        'montpellier-medieval',
        'en',
        undefined,
        undefined,
        undefined,
      );
    });
  });

  describe('getState', () => {
    it('should return full game state for existing game', () => {
      const mockGame = {
        id: 'ABCDEFGH',
        story: 'in-the-forest.md',
        language: 'fr',
        previously: 'You started in the forest.',
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

      const getStateSpy = jest
        .spyOn(appController['appService'], 'getState')
        .mockReturnValue(mockGame);

      const result = appController.getState({ gameId: 'ABCDEFGH' });
      expect(result).toEqual(mockGame);
      expect(getStateSpy).toHaveBeenCalledWith('ABCDEFGH');
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

  describe('createStory', () => {
    it('should create a new story successfully', async () => {
      const mockPrompt =
        'Create an adventure story set in ancient Rome where the player is a gladiator';
      const mockStory = {
        slug: 'ancient-rome-gladiator',
        title: 'Ancient Rome - Gladiator Adventure',
        content:
          '# Ancient Rome - Gladiator Adventure\n\n## Setting\n\nYou are a gladiator in ancient Rome...',
        homepage_display: {
          en: {
            title: 'Ancient Rome Gladiator',
            description: 'Experience life as a gladiator in ancient Rome',
          },
          fr: {
            title: 'Gladiateur de la Rome Antique',
            description: "Vivez la vie d'un gladiateur dans la Rome antique",
          },
          es: {
            title: 'Gladiador de la Roma Antigua',
            description:
              'Experimenta la vida como gladiador en la antigua Roma',
          },
          zh: { title: '古罗马角斗士', description: '体验古罗马角斗士的生活' },
          hi: {
            title: 'प्राचीन रोम ग्लेडिएटर',
            description:
              'प्राचीन रोम में एक ग्लेडिएटर के रूप में जीवन का अनुभव करें',
          },
          ar: {
            title: 'مصارع روما القديمة',
            description: 'عش حياة المصارع في روما القديمة',
          },
          bn: {
            title: 'প্রাচীন রোম গ্ল্যাডিয়েটর',
            description:
              'প্রাচীন রোমে একজন গ্ল্যাডিয়েটর হিসাবে জীবন অনুভব করুন',
          },
          ru: {
            title: 'Гладиатор Древнего Рима',
            description: 'Испытайте жизнь гладиатора в Древнем Риме',
          },
          pt: {
            title: 'Gladiador da Roma Antiga',
            description: 'Experimente a vida como gladiador na Roma Antiga',
          },
          ur: {
            title: 'قدیم روم گلیڈی ایٹر',
            description: 'قدیم روم میں ایک گلیڈی ایٹر کی زندگی کا تجربہ کریں',
          },
        },
        is_active: true,
        created_at: '2026-05-27T10:00:00.000Z',
        updated_at: '2026-05-27T10:00:00.000Z',
        sessions: 0,
        requests: 0,
      };

      const createStorySpy = jest
        .spyOn(appController['appService'], 'createStory')
        .mockResolvedValue(mockStory);

      const result = await appController.createStory({ prompt: mockPrompt });
      expect(result).toEqual(mockStory);
      expect(createStorySpy).toHaveBeenCalledWith(mockPrompt);
    });

    it('should handle API errors gracefully', async () => {
      const mockPrompt = 'Invalid prompt that causes error';
      const createStorySpy = jest
        .spyOn(appController['appService'], 'createStory')
        .mockRejectedValue(new Error('Failed to get AI response'));

      await expect(
        appController.createStory({ prompt: mockPrompt }),
      ).rejects.toThrow('Failed to get AI response');
      expect(createStorySpy).toHaveBeenCalledWith(mockPrompt);
    });
  });

  describe('editStory', () => {
    it('should update story title successfully', async () => {
      const mockSlug = 'montpellier';
      const mockUpdates = {
        title: 'Medieval Montpellier - Updated Edition',
      };
      const mockUpdatedStory = {
        slug: 'montpellier',
        title: 'Medieval Montpellier - Updated Edition',
        content: '# Montpellier Médiéval\n\n## Setting\n...',
        homepage_display: {
          en: {
            title: 'Medieval Montpellier',
            description: 'Explore medieval life',
          },
          fr: {
            title: 'Montpellier Médiéval',
            description: 'Explorez la vie médiévale',
          },
          es: {
            title: 'Montpellier Medieval',
            description: 'Explora la vida medieval',
          },
          zh: { title: '中世纪蒙彼利埃', description: '探索中世纪生活' },
          hi: {
            title: 'मध्यकालीन मोंपेलियर',
            description: 'मध्यकालीन जीवन का अन्वेषण करें',
          },
          ar: {
            title: 'مونبلييه القروسطية',
            description: 'استكشف الحياة في القرون الوسطى',
          },
          bn: {
            title: 'মধ্যযুগীয় মঁপেলিয়ে',
            description: 'মধ্যযুগীয় জীবন অন্বেষণ করুন',
          },
          ru: {
            title: 'Средневековый Монпелье',
            description: 'Исследуйте средневековую жизнь',
          },
          pt: {
            title: 'Montpellier Medieval',
            description: 'Explore a vida medieval',
          },
          ur: {
            title: 'قرون وسطیٰ کا مونپیلیے',
            description: 'قرون وسطیٰ کی زندگی دریافت کریں',
          },
        },
        is_active: true,
        created_at: '2025-06-02T17:55:18.314305',
        updated_at: '2026-05-27T12:00:00.000Z',
        sessions: 0,
        requests: 0,
      };

      const editStorySpy = jest
        .spyOn(appController['appService'], 'editStory')
        .mockReturnValue(mockUpdatedStory);

      const result = await appController.editStory({
        slug: mockSlug,
        updates: mockUpdates,
      });
      expect(result).toEqual(mockUpdatedStory);
      expect(editStorySpy).toHaveBeenCalledWith(mockSlug, mockUpdates);
    });

    it('should update story slug successfully', async () => {
      const mockSlug = 'montpellier';
      const mockUpdates = {
        slug: 'medieval-montpellier',
      };
      const mockUpdatedStory = {
        slug: 'medieval-montpellier',
        title: 'Medieval Montpellier',
        content: '# Montpellier Médiéval\n\n## Setting\n...',
        homepage_display: {
          en: {
            title: 'Medieval Montpellier',
            description: 'Explore medieval life',
          },
          fr: {
            title: 'Montpellier Médiéval',
            description: 'Explorez la vie médiévale',
          },
          es: {
            title: 'Montpellier Medieval',
            description: 'Explora la vida medieval',
          },
          zh: { title: '中世纪蒙彼利埃', description: '探索中世纪生活' },
          hi: {
            title: 'मध्यकालीन मोंपेलियर',
            description: 'मध्यकालीन जीवन का अन्वेषण करें',
          },
          ar: {
            title: 'مونبلييه القروسطية',
            description: 'استكشف الحياة في القرون الوسطى',
          },
          bn: {
            title: 'মধ্যযুগীয় মঁপেলিয়ে',
            description: 'মধ্যযুগীয় জীবন অন্বেষণ করুন',
          },
          ru: {
            title: 'Средневековый Монпелье',
            description: 'Исследуйте средневековую жизнь',
          },
          pt: {
            title: 'Montpellier Medieval',
            description: 'Explore a vida medieval',
          },
          ur: {
            title: 'قرون وسطیٰ کا مونپیلیے',
            description: 'قرون وسطیٰ کی زندگی دریافت کریں',
          },
        },
        is_active: true,
        created_at: '2025-06-02T17:55:18.314305',
        updated_at: '2026-05-27T12:00:00.000Z',
        sessions: 0,
        requests: 0,
      };

      const editStorySpy = jest
        .spyOn(appController['appService'], 'editStory')
        .mockReturnValue(mockUpdatedStory);

      const result = await appController.editStory({
        slug: mockSlug,
        updates: mockUpdates,
      });
      expect(result).toEqual(mockUpdatedStory);
      expect(result.slug).toBe('medieval-montpellier');
      expect(editStorySpy).toHaveBeenCalledWith(mockSlug, mockUpdates);
    });

    it('should update multiple fields successfully', async () => {
      const mockSlug = 'montpellier';
      const mockUpdates = {
        title: 'Updated Title',
        is_active: false,
        sessions: 150,
      };
      const mockUpdatedStory = {
        slug: 'montpellier',
        title: 'Updated Title',
        content: '# Montpellier Médiéval\n\n## Setting\n...',
        homepage_display: {
          en: {
            title: 'Medieval Montpellier',
            description: 'Explore medieval life',
          },
          fr: {
            title: 'Montpellier Médiéval',
            description: 'Explorez la vie médiévale',
          },
          es: {
            title: 'Montpellier Medieval',
            description: 'Explora la vida medieval',
          },
          zh: { title: '中世纪蒙彼利埃', description: '探索中世纪生活' },
          hi: {
            title: 'मध्यकालीन मोंपेलियर',
            description: 'मध्यकालीन जीवन का अन्वेषण करें',
          },
          ar: {
            title: 'مونبلييه القروسطية',
            description: 'استكشف الحياة في القرون الوسطى',
          },
          bn: {
            title: 'মধ্যযুগীয় মঁপেলিয়ে',
            description: 'মধ্যযুগীয় জীবন অন্বেষণ করুন',
          },
          ru: {
            title: 'Средневековый Монпелье',
            description: 'Исследуйте средневековую жизнь',
          },
          pt: {
            title: 'Montpellier Medieval',
            description: 'Explore a vida medieval',
          },
          ur: {
            title: 'قرون وسطیٰ کا مونپیلیے',
            description: 'قرون وسطیٰ کی زندگی دریافت کریں',
          },
        },
        is_active: false,
        created_at: '2025-06-02T17:55:18.314305',
        updated_at: '2026-05-27T12:00:00.000Z',
        sessions: 150,
        requests: 0,
      };

      const editStorySpy = jest
        .spyOn(appController['appService'], 'editStory')
        .mockReturnValue(mockUpdatedStory);

      const result = await appController.editStory({
        slug: mockSlug,
        updates: mockUpdates,
      });
      expect(result).toEqual(mockUpdatedStory);
      expect(result.title).toBe('Updated Title');
      expect(result.is_active).toBe(false);
      expect(result.sessions).toBe(150);
      expect(editStorySpy).toHaveBeenCalledWith(mockSlug, mockUpdates);
    });

    it('should handle story not found error', () => {
      const mockSlug = 'non-existent-story';
      const mockUpdates = { title: 'New Title' };
      const editStorySpy = jest
        .spyOn(appController['appService'], 'editStory')
        .mockImplementation(() => {
          throw new Error('Story not found');
        });

      expect(() =>
        appController.editStory({ slug: mockSlug, updates: mockUpdates }),
      ).toThrow('Story not found');
      expect(editStorySpy).toHaveBeenCalledWith(mockSlug, mockUpdates);
    });
  });

  describe('difficulty', () => {
    const step = (action: string): Step => ({
      desc: action,
      options: action === 'death' ? [] : ['A', 'B', 'C'],
      action,
    });

    const internals = (service: AppService) =>
      service as unknown as {
        readGame: (id: string) => Game | null;
        writeGame: (game: Game) => void;
        generate: (...args: unknown[]) => Promise<unknown>;
        generateSteps: (
          cached: string,
          system: string,
          user: string,
          context: string,
          difficulty: Difficulty,
          textLength?: TextLength,
        ) => Promise<{
          aiResponse: { currentStep?: Step; nextSteps: Step[] };
          cost: number;
        }>;
      };

    const game = (currentStep: Step, nextSteps: Step[]): Game => ({
      id: 'ABCDEFGH',
      story: 'montpellier',
      language: 'en',
      previously: 'First step.',
      currentStep,
      nextSteps,
      difficulty: 'hard',
    });

    it('should accept a known difficulty', async () => {
      const dto = plainToInstance(StartDto, { difficulty: 'super-hard' });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('should reject an unknown difficulty', async () => {
      const dto = plainToInstance(StartDto, { difficulty: 'medium' });
      const errors = await validate(dto);
      expect(errors[0].property).toBe('difficulty');
    });

    it('should pass the difficulty to the service', async () => {
      const startSpy = jest
        .spyOn(appController['appService'], 'start')
        .mockResolvedValue({} as Game);

      await appController.start({ difficulty: 'hard' });
      expect(startSpy).toHaveBeenCalledWith(
        'montpellier',
        'fr',
        undefined,
        'hard',
        undefined,
      );
    });

    it('should refuse a move on a finished game', async () => {
      const service = internals(appController['appService']);
      jest.spyOn(service, 'readGame').mockReturnValue(game(step('death'), []));

      await expect(
        appController.move({ gameId: 'ABCDEFGH', choiceIndex: 1 }),
      ).rejects.toThrow('Game is over');
    });

    it('should end the game without calling the AI', async () => {
      const service = internals(appController['appService']);
      jest
        .spyOn(service, 'readGame')
        .mockReturnValue(
          game(step('start'), [
            step('death'),
            step('continue'),
            step('continue'),
          ]),
        );
      jest.spyOn(service, 'writeGame').mockImplementation(() => undefined);
      const generateSpy = jest.spyOn(service, 'generate');

      const result = await appController.move({
        gameId: 'ABCDEFGH',
        choiceIndex: 1,
      });
      expect(result.currentStep.action).toBe('death');
      expect(result.nextSteps).toEqual([]);
      expect(generateSpy).not.toHaveBeenCalled();
    });

    it.each<[Difficulty, number, number]>([
      ['easy', 0, 1],
      ['easy', 1, 2],
      ['hard', 1, 1],
      ['hard', 2, 2],
      ['super-hard', 2, 1],
      ['super-hard', 3, 2],
    ])(
      'on %s with %i deaths should call the model %i time(s)',
      async (difficulty, deaths, calls) => {
        const service = internals(appController['appService']);
        const nextSteps = [0, 1, 2].map((i) =>
          step(i < deaths ? 'death' : 'continue'),
        );
        const generateSpy = jest
          .spyOn(service, 'generate')
          .mockResolvedValue({ aiResponse: { nextSteps }, cost: 1 });

        const { cost } = await service.generateSteps(
          'cached',
          'system',
          'user',
          'move',
          difficulty,
        );
        expect(generateSpy).toHaveBeenCalledTimes(calls);
        expect(cost).toBe(calls);
      },
    );

    it('should keep the retry when it respects the limits', async () => {
      const service = internals(appController['appService']);
      const safe = [step('continue'), step('continue'), step('continue')];
      jest
        .spyOn(service, 'generate')
        .mockResolvedValueOnce({
          aiResponse: { nextSteps: [step('death'), ...safe.slice(1)] },
          cost: 1,
        })
        .mockResolvedValueOnce({ aiResponse: { nextSteps: safe }, cost: 1 });

      const { aiResponse } = await service.generateSteps(
        'cached',
        'system',
        'user',
        'move',
        'easy',
      );
      expect(aiResponse.nextSteps).toEqual(safe);
    });
  });

  describe('text length', () => {
    const step = (desc: string): Step => ({
      desc,
      options: ['A', 'B', 'C'],
      action: 'continue',
    });

    const sentence = 'The wind howls through the old stones. ';
    const long = sentence.repeat(30).trimEnd();
    const short = sentence.repeat(5).trimEnd();

    const internals = (service: AppService) =>
      service as unknown as {
        generate: (...args: unknown[]) => Promise<unknown>;
        generateSteps: (
          cached: string,
          system: string,
          user: string,
          context: string,
          difficulty: Difficulty,
          textLength: TextLength,
        ) => Promise<{
          aiResponse: { currentStep?: Step; nextSteps: Step[] };
          cost: number;
        }>;
      };

    it('should accept a known text length', async () => {
      const dto = plainToInstance(StartDto, { textLength: 'short' });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('should reject an unknown text length', async () => {
      const dto = plainToInstance(StartDto, { textLength: 'long' });
      const errors = await validate(dto);
      expect(errors[0].property).toBe('textLength');
    });

    it('should pass the text length to the service', async () => {
      const startSpy = jest
        .spyOn(appController['appService'], 'start')
        .mockResolvedValue({} as Game);

      await appController.start({ textLength: 'short' });
      expect(startSpy).toHaveBeenCalledWith(
        'montpellier',
        'fr',
        undefined,
        undefined,
        'short',
      );
    });

    it.each<[TextLength, string, number]>([
      ['normal', long, 1],
      ['short', short, 1],
      ['short', long, 2],
    ])(
      'on %s should call the model the expected number of times',
      async (textLength, desc, calls) => {
        const service = internals(appController['appService']);
        const generateSpy = jest.spyOn(service, 'generate').mockResolvedValue({
          aiResponse: { nextSteps: [step(desc), step(desc), step(desc)] },
          cost: 1,
        });

        await service.generateSteps(
          'cached',
          'system',
          'user',
          'move',
          'easy',
          textLength,
        );
        expect(generateSpy).toHaveBeenCalledTimes(calls);
      },
    );

    it('should check the current step on start', async () => {
      const service = internals(appController['appService']);
      const generateSpy = jest.spyOn(service, 'generate').mockResolvedValue({
        aiResponse: {
          currentStep: step(long),
          nextSteps: [step(short), step(short), step(short)],
        },
        cost: 1,
      });

      await service.generateSteps(
        'cached',
        'system',
        'user',
        'start',
        'easy',
        'short',
      );
      expect(generateSpy).toHaveBeenCalledTimes(2);
    });

    it('should truncate at a sentence end when the retry is still too long', async () => {
      const service = internals(appController['appService']);
      jest.spyOn(service, 'generate').mockResolvedValue({
        aiResponse: {
          currentStep: step(long),
          nextSteps: [step(long), step(short), step(long)],
        },
        cost: 1,
      });

      const { aiResponse } = await service.generateSteps(
        'cached',
        'system',
        'user',
        'start',
        'easy',
        'short',
      );
      const descs = [
        aiResponse.currentStep!.desc,
        ...aiResponse.nextSteps.map((s) => s.desc),
      ];
      descs.forEach((desc) => {
        expect(desc.length).toBeLessThanOrEqual(SHORT_DESC_MAX);
        expect(desc.endsWith('.')).toBe(true);
      });
      expect(aiResponse.nextSteps[1].desc).toBe(short);
    });
  });
});

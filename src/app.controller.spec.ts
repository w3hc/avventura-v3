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
      expect(startSpy).toHaveBeenCalledWith('montpellier', 'fr', undefined);
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
      expect(startSpy).toHaveBeenCalledWith('montpellier', 'es', undefined);
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
});

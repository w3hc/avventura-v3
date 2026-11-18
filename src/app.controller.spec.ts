import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AddCreditsDto, AppController, StartDto } from './app.controller';
import {
  AppService,
  Difficulty,
  Game,
  SHORT_DESC_MAX,
  Step,
  StoryData,
  TextLength,
} from './app.service';
import { AuthService } from './auth/auth.service';
import { BillingService } from './billing/billing.service';
import { STRIPE_CLIENT } from './billing/stripe.client';
import { CreditsService } from './credits/credits.service';
import { PricingFile, PricingService } from './pricing/pricing.service';
import * as modelsData from '../models-infomaniak.json';

const OWNER = '0x1111111111111111111111111111111111111111';
const STRANGER = '0x2222222222222222222222222222222222222222';

describe('AppController', () => {
  let app: TestingModule;
  let appController: AppController;

  beforeEach(async () => {
    process.env.SERVICE_FEE_RATE = '0.30';
    app = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        PricingService,
        CreditsService,
        AuthService,
        BillingService,
        { provide: STRIPE_CLIENT, useValue: null },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  afterEach(async () => {
    delete process.env.SERVICE_FEE_RATE;
    await app.close();
  });

  const llmRows = (story: string) =>
    app
      .get(CreditsService)
      ['statements']!.db.prepare(
        `SELECT llm_cost AS llmCost, amount FROM ledger
         WHERE kind = 'llm' AND story = ? ORDER BY id`,
      )
      .all(story);

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
        spent: 0.012,
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

      const result = await appController.createStory(
        { prompt: mockPrompt },
        OWNER,
      );
      expect(result).toEqual(mockStory);
      expect(createStorySpy).toHaveBeenCalledWith(mockPrompt, OWNER);
    });

    it('should handle API errors gracefully', async () => {
      const mockPrompt = 'Invalid prompt that causes error';
      const createStorySpy = jest
        .spyOn(appController['appService'], 'createStory')
        .mockRejectedValue(new Error('Failed to get AI response'));

      await expect(
        appController.createStory({ prompt: mockPrompt }, OWNER),
      ).rejects.toThrow('Failed to get AI response');
      expect(createStorySpy).toHaveBeenCalledWith(mockPrompt, OWNER);
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

      const result = await appController.editStory(
        {
          slug: mockSlug,
          updates: mockUpdates,
        },
        OWNER,
      );
      expect(result).toEqual(mockUpdatedStory);
      expect(editStorySpy).toHaveBeenCalledWith(mockSlug, mockUpdates, OWNER);
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

      const result = await appController.editStory(
        {
          slug: mockSlug,
          updates: mockUpdates,
        },
        OWNER,
      );
      expect(result).toEqual(mockUpdatedStory);
      expect(result.slug).toBe('medieval-montpellier');
      expect(editStorySpy).toHaveBeenCalledWith(mockSlug, mockUpdates, OWNER);
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

      const result = await appController.editStory(
        {
          slug: mockSlug,
          updates: mockUpdates,
        },
        OWNER,
      );
      expect(result).toEqual(mockUpdatedStory);
      expect(result.title).toBe('Updated Title');
      expect(result.is_active).toBe(false);
      expect(result.sessions).toBe(150);
      expect(editStorySpy).toHaveBeenCalledWith(mockSlug, mockUpdates, OWNER);
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
        appController.editStory(
          { slug: mockSlug, updates: mockUpdates },
          OWNER,
        ),
      ).toThrow('Story not found');
      expect(editStorySpy).toHaveBeenCalledWith(mockSlug, mockUpdates, OWNER);
    });
  });

  describe('story ownership', () => {
    let dir: string;
    let storiesPath: string;

    const readStories = () =>
      JSON.parse(readFileSync(storiesPath, 'utf-8')) as StoryData[];

    // costs.json is resolved before process.cwd() is mocked
    const mockWriteCost = () =>
      jest
        .spyOn(
          appController['appService'] as unknown as {
            writeCost: (id: string, cost: number) => void;
          },
          'writeCost',
        )
        .mockImplementation(() => undefined);

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'avventura-'));
      mkdirSync(join(dir, 'stories'));
      storiesPath = join(dir, 'stories', 'stories.json');
      writeFileSync(
        storiesPath,
        JSON.stringify([
          {
            slug: 'owned',
            title: 'Owned',
            ownerAddress: OWNER,
            credits: 10,
            sessions: 3,
            requests: 7,
            created_at: '2026-01-01T00:00:00.000Z',
          },
          { slug: 'legacy', title: 'Legacy' },
        ]),
      );
      jest.spyOn(process, 'cwd').mockReturnValue(dir);
    });

    afterEach(() => {
      jest.restoreAllMocks();
      delete process.env.ANTHROPIC_API_KEY;
    });

    it('lets the owner edit their story', () => {
      const result = appController['appService'].editStory(
        'owned',
        { title: 'Renamed' },
        OWNER.toUpperCase().replace('0X', '0x'),
      );
      expect(result.title).toBe('Renamed');
      expect(readStories()[0].title).toBe('Renamed');
    });

    it('ignores updates to protected fields', () => {
      appController['appService'].editStory(
        'owned',
        {
          title: 'Renamed',
          ownerAddress: STRANGER,
          credits: 1000,
          sessions: 0,
          requests: 0,
        },
        OWNER,
      );
      expect(readStories()[0]).toMatchObject({
        title: 'Renamed',
        ownerAddress: OWNER,
        credits: 10,
        sessions: 3,
        requests: 7,
        created_at: '2026-01-01T00:00:00.000Z',
      });
    });

    it('returns 403 to anyone else', () => {
      expect(() =>
        appController['appService'].editStory(
          'owned',
          { title: 'Hijacked' },
          STRANGER,
        ),
      ).toThrow('Only the story owner can edit it');
      expect(readStories()[0].title).toBe('Owned');
    });

    it('returns 403 for a story without an owner', () => {
      expect(() =>
        appController['appService'].editStory(
          'legacy',
          { title: 'Claimed' },
          OWNER,
        ),
      ).toThrow('Only the story owner can edit it');
    });

    it('returns 404 before checking ownership', () => {
      expect(() =>
        appController['appService'].editStory('missing', { title: 'x' }, OWNER),
      ).toThrow('Story not found');
    });

    it('stores the owner address on a new story', async () => {
      writeFileSync(join(dir, 'avventura-edit-instruction-file.md'), 'Rules');
      process.env.ANTHROPIC_API_KEY = 'test';
      const generated = {
        slug: 'new-story',
        title: 'New story',
        content: '# New story',
        homepage_display: {},
        ownerAddress: STRANGER,
      };
      jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: JSON.stringify(generated) }],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        ),
      );

      jest
        .spyOn(appController['appService']['pricingService'], 'costEur')
        .mockReturnValue(0.1);
      const writeCost = mockWriteCost();

      const story = await appController['appService'].createStory(
        'A prompt',
        OWNER,
      );
      expect(story.ownerAddress).toBe(OWNER);
      expect(readStories()[2]).toMatchObject({
        slug: 'new-story',
        ownerAddress: OWNER,
      });
      expect(readStories()[2]).not.toHaveProperty('credits');

      const credits = app.get(CreditsService);
      expect(credits.spentByStory(['new-story'])).toEqual({
        'new-story': 0.13,
      });
      expect(credits.balance('new-story')).toBeNull();
      expect(credits.balance(OWNER)).toBe(99.87);
      expect(llmRows('new-story')).toEqual([
        { llmCost: 100_000, amount: -130_000 },
      ]);
      expect(writeCost).toHaveBeenCalledWith('story:new-story', 0.1);
    });

    it('refuses to create a story with 402 when the owner is out of credits', async () => {
      process.env.ANTHROPIC_API_KEY = 'test';
      app.get(CreditsService).open(OWNER, 0);
      const fetchSpy = jest.spyOn(global, 'fetch');

      await expect(
        appController['appService'].createStory('A prompt', OWNER),
      ).rejects.toMatchObject({ status: 402, message: 'Not enough credits' });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('charges the owner for a response that is not a story', async () => {
      writeFileSync(join(dir, 'avventura-edit-instruction-file.md'), 'Rules');
      process.env.ANTHROPIC_API_KEY = 'test';
      jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'not json' }],
            usage: { input_tokens: 1000, output_tokens: 1000 },
          }),
        ),
      );
      const writeCost = mockWriteCost();

      await expect(
        appController['appService'].createStory('A prompt', OWNER),
      ).rejects.toMatchObject({ status: 502 });
      expect(app.get(CreditsService).balance(OWNER)).toBeLessThan(100);
      expect(writeCost).toHaveBeenCalledWith(
        'story:unparsed',
        expect.any(Number),
      );
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

  describe('credits', () => {
    const password = 'secret';
    let storiesPath: string;

    const internals = (service: AppService) =>
      service as unknown as {
        chargeOwner: (
          owner: string,
          cost: number,
          story?: string,
          gameId?: string,
        ) => void;
        generateSteps: (...args: unknown[]) => Promise<unknown>;
        readGame: (gameId: string) => Game | null;
        writeGame: (game: Game) => void;
        writeCost: (gameId: string, cost: number) => void;
        updateGame: (
          gameId: string,
          previously: string,
          currentStep: Step,
          nextSteps: Step[],
          cost?: number,
        ) => Game;
      };

    const readStories = () =>
      JSON.parse(readFileSync(storiesPath, 'utf-8')) as StoryData[];

    const balance = (owner: string) => app.get(CreditsService).balance(owner);

    const DEFAULT_OWNER = '0xAbC0000000000000000000000000000000000001';
    const BROKE = '0x3333333333333333333333333333333333333333';
    const OVERDRAWN = '0x4444444444444444444444444444444444444444';

    const step: Step = { desc: 'A step', options: ['A'], action: 'continue' };

    beforeEach(() => {
      const dir = mkdtempSync(join(tmpdir(), 'avventura-'));
      mkdirSync(join(dir, 'stories'));
      storiesPath = join(dir, 'stories', 'stories.json');
      writeFileSync(
        storiesPath,
        JSON.stringify([
          { slug: 'funded', credits: 10, ownerAddress: OWNER },
          { slug: 'second', credits: 5, ownerAddress: OWNER },
          { slug: 'legacy' },
          { slug: 'broke', credits: 0, ownerAddress: BROKE },
          { slug: 'overdrawn', credits: -1, ownerAddress: OVERDRAWN },
        ]),
      );
      jest.spyOn(process, 'cwd').mockReturnValue(dir);
      process.env.CREDITS_PASSWORD = password;
      process.env.DEFAULT_OWNER_ADDRESS = DEFAULT_OWNER;
      appController['appService'].onModuleInit();
    });

    afterEach(() => {
      jest.restoreAllMocks();
      delete process.env.CREDITS_PASSWORD;
      delete process.env.DEFAULT_OWNER_ADDRESS;
    });

    it('should move each story balance to its owner at startup', () => {
      expect(balance(OWNER)).toBe(15);
      expect(balance(DEFAULT_OWNER.toLowerCase())).toBe(100);
      expect(balance(BROKE)).toBe(0);
      expect(balance(OVERDRAWN)).toBe(-1);
      for (const slug of ['funded', 'second', 'legacy', 'broke', 'overdrawn']) {
        expect(balance(slug)).toBe(0);
      }
    });

    it('should not credit stories created after balances moved to owners', () => {
      writeFileSync(
        storiesPath,
        JSON.stringify([{ slug: 'new', ownerAddress: STRANGER }]),
      );
      appController['appService'].onModuleInit();

      expect(balance(STRANGER)).toBeNull();
      expect(balance('new')).toBeNull();
    });

    it('should rename creatorAddress to ownerAddress at startup', () => {
      writeFileSync(
        storiesPath,
        JSON.stringify([
          { slug: 'renamed', credits: 3, creatorAddress: STRANGER },
          { slug: 'kept', ownerAddress: OWNER },
        ]),
      );
      appController['appService'].onModuleInit();

      expect(readStories()).toEqual([
        { slug: 'renamed', credits: 3, ownerAddress: STRANGER },
        { slug: 'kept', ownerAddress: OWNER },
      ]);
      expect(balance(STRANGER)).toBe(3);
    });

    it('should not move anything on a second startup', () => {
      appController['appService'].onModuleInit();
      expect(balance(OWNER)).toBe(15);
      expect(balance(DEFAULT_OWNER.toLowerCase())).toBe(100);
    });

    it('should leave stories without an owner unplayable without DEFAULT_OWNER_ADDRESS', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'avventura-'));
      mkdirSync(join(dir, 'stories'));
      writeFileSync(
        join(dir, 'stories', 'stories.json'),
        JSON.stringify([{ slug: 'orphan', credits: 10 }]),
      );
      jest.spyOn(process, 'cwd').mockReturnValue(dir);
      delete process.env.DEFAULT_OWNER_ADDRESS;
      appController['appService'].onModuleInit();

      expect(balance('orphan')).toBeNull();
      await expect(
        appController['appService'].start('orphan', 'en'),
      ).rejects.toMatchObject({ status: 402 });
    });

    it("should return the signer's balance and stories with their spend", () => {
      const service = internals(appController['appService']);
      service.chargeOwner(OWNER, 0.25, 'funded', 'GAME');
      service.chargeOwner(OWNER, 0.5, 'funded', 'GAME');

      expect(
        appController.getMe(OWNER.toUpperCase().replace('0X', '0x')),
      ).toEqual({
        address: OWNER,
        balance: 14.025,
        stories: [
          { slug: 'funded', title: undefined, spent: 0.975 },
          { slug: 'second', title: undefined, spent: 0 },
        ],
        autoTopup: null,
      });
    });

    it('should report the auto top-up settings', () => {
      const credits = app.get(CreditsService);
      credits.setAutoTopup(OWNER, { enabled: true, amount: 20, threshold: 50 });
      credits.saveAutoTopupCard(OWNER, 'pm_1', { id: 'evt_1', type: 't' });
      credits.failAutoTopup(
        credits.claimAutoTopup(OWNER)!.id,
        OWNER,
        'card_declined',
      );
      expect(appController.getMe(OWNER).autoTopup).toEqual({
        enabled: true,
        amount: 20,
        threshold: 50,
        hasCard: true,
        paused: true,
        pausedReason: 'card_declined',
      });
    });

    it('should check the auto top-up when refusing with 402', async () => {
      const checkAutoTopup = jest.spyOn(
        app.get(BillingService),
        'checkAutoTopup',
      );
      app.get(CreditsService).open(STRANGER, 0);
      await expect(
        appController['appService'].createStory('A prompt', STRANGER),
      ).rejects.toMatchObject({ status: 402 });
      expect(checkAutoTopup).toHaveBeenCalledWith(STRANGER);
    });

    it('should check the auto top-up after each charge', () => {
      const checkAutoTopup = jest.spyOn(
        app.get(BillingService),
        'checkAutoTopup',
      );
      internals(appController['appService']).chargeOwner(OWNER, 0.1, 'funded');
      expect(checkAutoTopup).toHaveBeenCalledWith(OWNER);
    });

    it('should list stories without an owner under DEFAULT_OWNER_ADDRESS', () => {
      expect(appController.getMe(DEFAULT_OWNER).stories).toEqual([
        { slug: 'legacy', title: undefined, spent: 0 },
      ]);
    });

    it('should return the default balance for a new address', () => {
      expect(appController.getMe(STRANGER)).toEqual({
        address: STRANGER,
        balance: 100,
        stories: [],
        autoTopup: null,
      });
      expect(balance(STRANGER)).toBeNull();
    });

    it('should add credits to an address and return the new balance', () => {
      const result = appController.addCredits({
        address: OWNER,
        amount: 5,
        password,
      });
      expect(result).toEqual({ added: 5, credits: 20 });
      expect(balance(OWNER)).toBe(20);
      expect(readStories()[0].credits).toBe(10);
    });

    it('should open a new address at the default before adding credits', () => {
      const result = appController.addCredits({
        address: STRANGER.toUpperCase().replace('0X', '0x'),
        amount: 5,
        password,
      });
      expect(result).toEqual({ added: 5, credits: 105 });
      expect(balance(STRANGER)).toBe(105);
    });

    it('should reject a wrong password', () => {
      expect(() =>
        appController.addCredits({
          address: STRANGER,
          amount: 5,
          password: 'x',
        }),
      ).toThrow('Invalid password');
      expect(balance(STRANGER)).toBeNull();
    });

    it('should refuse top-ups when no password is configured', () => {
      delete process.env.CREDITS_PASSWORD;
      expect(() =>
        appController.addCredits({ address: OWNER, amount: 5, password }),
      ).toThrow('CREDITS_PASSWORD is not configured');
    });

    it.each([0, -5, 'five'])('should reject amount %p', async (amount) => {
      const dto = plainToInstance(AddCreditsDto, {
        address: OWNER,
        amount,
        password,
      });
      expect(await validate(dto)).not.toHaveLength(0);
    });

    it.each(['funded', '0x123', ''])(
      'should reject address %p',
      async (address) => {
        const dto = plainToInstance(AddCreditsDto, {
          address,
          amount: 5,
          password,
        });
        expect(await validate(dto)).not.toHaveLength(0);
      },
    );

    it.each(['broke', 'overdrawn'])(
      'should refuse to start %s with 402',
      async (slug) => {
        const service = internals(appController['appService']);
        const generateSpy = jest.spyOn(service, 'generateSteps');

        await expect(
          appController['appService'].start(slug, 'en'),
        ).rejects.toMatchObject({ status: 402, message: 'Not enough credits' });
        expect(generateSpy).not.toHaveBeenCalled();
      },
    );

    it('should refuse to move with 402 when the story is out of credits', async () => {
      const service = internals(appController['appService']);
      jest.spyOn(service, 'readGame').mockReturnValue({
        id: 'GAME',
        story: 'broke',
        language: 'en',
        previously: '',
        currentStep: { ...step, options: ['A', 'B', 'C'] },
        nextSteps: [step, step, step],
      });
      const generateSpy = jest.spyOn(service, 'generateSteps');

      await expect(
        appController['appService'].move('GAME', 0),
      ).rejects.toMatchObject({ status: 402 });
      expect(generateSpy).not.toHaveBeenCalled();
    });

    it('should still reach an ending when the story is out of credits', async () => {
      const service = internals(appController['appService']);
      const ending: Step = { desc: 'The end', options: [], action: 'death' };
      jest.spyOn(service, 'readGame').mockReturnValue({
        id: 'GAME',
        story: 'broke',
        language: 'en',
        previously: '',
        currentStep: { ...step, options: ['A', 'B', 'C'] },
        nextSteps: [ending, step, step],
      });
      jest.spyOn(service, 'writeGame').mockImplementation(() => undefined);

      const result = await appController['appService'].move('GAME', 0);
      expect(result.currentStep).toEqual(ending);
    });

    it('should price an AI call in EUR from the current rates', async () => {
      const pricing = appController['appService']['pricingService'];
      (pricing as unknown as { data: PricingFile }).data = {
        updatedAt: '2026-10-20',
        usdEurRate: 0.5,
        usdEurRateDate: '2026-10-19',
        models: {
          'claude-sonnet-5-5': {
            input: 2,
            cacheWrite: 2.5,
            cacheRead: 0.2,
            output: 10,
          },
        },
      };
      jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: '{"nextSteps":[]}' }],
            usage: {
              input_tokens: 1_000_000,
              output_tokens: 1_000_000,
              cache_creation_input_tokens: 1_000_000,
              cache_read_input_tokens: 1_000_000,
            },
          }),
        ),
      );

      const { cost } = await (
        appController['appService'] as unknown as {
          generate: (...args: string[]) => Promise<{ cost: number }>;
        }
      ).generate('cached', 'cached system', 'user', 'test');
      expect(cost).toBeCloseTo((2 + 2.5 + 0.2 + 10) * 0.5);
    });

    it('should deduct the request price from the owner and keep the story', () => {
      const service = internals(appController['appService']);
      service.chargeOwner(OWNER, 0.0123456, 'funded', 'GAME');
      service.chargeOwner(OWNER, 0.5, 'second', 'GAME');
      expect(balance(OWNER)).toBe(14.333951);
      expect(
        app.get(CreditsService).spentByStory(['funded', 'second']),
      ).toEqual({ funded: 0.016049, second: 0.65 });
      expect(llmRows('funded')).toEqual([{ llmCost: 12_346, amount: -16_049 }]);
    });

    it('should charge the price of a /start request', async () => {
      const service = internals(appController['appService']);
      jest.spyOn(service, 'generateSteps').mockResolvedValue({
        aiResponse: { currentStep: step, nextSteps: [step, step, step] },
        cost: 0.1,
      });
      jest.spyOn(service, 'writeGame').mockImplementation(() => undefined);
      const writeCost = jest
        .spyOn(service, 'writeCost')
        .mockImplementation(() => undefined);

      const game = await appController['appService'].start('funded', 'en');

      expect(game.spent).toBe(0.13);
      expect(balance(OWNER)).toBe(14.87);
      expect(llmRows('funded')).toEqual([
        { llmCost: 100_000, amount: -130_000 },
      ]);
      expect(writeCost).toHaveBeenCalledWith(game.id, 0.1);
    });

    it('should charge the price of a /move request', async () => {
      const service = internals(appController['appService']);
      jest.spyOn(service, 'readGame').mockReturnValue({
        id: 'GAME',
        story: 'funded',
        language: 'en',
        previously: '',
        currentStep: { ...step, options: ['A', 'B', 'C'] },
        nextSteps: [step, step, step],
        spent: 0.13,
      });
      jest.spyOn(service, 'generateSteps').mockResolvedValue({
        aiResponse: { previously: 'recap', nextSteps: [step, step, step] },
        cost: 0.1,
      });
      jest.spyOn(service, 'writeGame').mockImplementation(() => undefined);
      const writeCost = jest
        .spyOn(service, 'writeCost')
        .mockImplementation(() => undefined);

      const result = await appController['appService'].move('GAME', 0);

      expect(result.spent).toBe(0.26);
      expect(balance(OWNER)).toBe(14.87);
      expect(llmRows('funded')).toEqual([
        { llmCost: 100_000, amount: -130_000 },
      ]);
      expect(writeCost).toHaveBeenCalledWith('GAME', 0.1);
    });

    it('should charge the LLM cost alone with a zero SERVICE_FEE_RATE', () => {
      process.env.SERVICE_FEE_RATE = '0';
      const zeroFee = new AppService(
        app.get(PricingService),
        app.get(CreditsService),
        app.get(BillingService),
      );
      internals(zeroFee).chargeOwner(OWNER, 0.1, 'funded');
      expect(balance(OWNER)).toBe(14.9);
      expect(llmRows('funded')).toEqual([
        { llmCost: 100_000, amount: -100_000 },
      ]);
    });

    it.each([
      [0.5, 0.75],
      [undefined, 0.25],
    ])('should add the price to a game spent of %p', (spent, expected) => {
      const service = internals(appController['appService']);
      const game = {
        id: 'GAME',
        story: 'funded',
        previously: '',
        currentStep: step,
        nextSteps: [],
        spent,
      } as unknown as Game;
      jest.spyOn(service, 'readGame').mockReturnValue(game);
      const writeSpy = jest
        .spyOn(service, 'writeGame')
        .mockImplementation(() => undefined);

      const updated = service.updateGame('GAME', 'recap', step, [], 0.25);
      expect(updated.spent).toBe(expected);
      expect(writeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ spent: expected }),
      );
    });
  });
});

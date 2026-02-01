import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AppService } from './../src/app.service';
import * as modelsData from './../models-infomaniak.json';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  const mockAppService = {
    getModels: jest.fn().mockResolvedValue(modelsData),
    start: jest.fn().mockResolvedValue({
      id: 'TESTGAME',
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
    }),
    getState: jest.fn().mockReturnValue({
      id: 'TESTGAME',
      story: 'in-the-forest.md',
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
    }),
    move: jest.fn().mockResolvedValue({
      previously: 'You started in the forest. You chose to go left.',
      currentStep: {
        desc: 'You go left and find a path...',
        options: ['Follow path', 'Go back', 'Rest'],
        action: 'continue',
      },
      nextSteps: [
        {
          desc: 'You follow the path...',
          options: ['Continue', 'Stop', 'Turn back'],
          action: 'continue',
        },
        {
          desc: 'You go back...',
          options: ['Try again', 'Rest', 'Leave'],
          action: 'continue',
        },
        {
          desc: 'You rest...',
          options: ['Continue', 'Sleep', 'Go back'],
          action: 'continue',
        },
      ],
    }),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AppService)
      .useValue(mockAppService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/models (GET)', () => {
    return request(app.getHttpServer())
      .get('/models')
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('result');
        expect(res.body).toHaveProperty('data');
        expect(Array.isArray((res.body as { data: unknown }).data)).toBe(true);
      });
  });

  it('/start (POST) - with default story', () => {
    return request(app.getHttpServer())
      .post('/start')
      .expect(201)
      .expect((res) => {
        expect(res.body).toHaveProperty('id');
        expect(res.body).toHaveProperty('story');
        expect(res.body).toHaveProperty('previously');
        expect(res.body).toHaveProperty('currentStep');
        expect(res.body).toHaveProperty('nextSteps');
        expect((res.body as { story: string }).story).toBe('in-the-forest.md');
        expect(
          (res.body as { currentStep: { options: string[] } }).currentStep
            .options,
        ).toHaveLength(3);
        expect((res.body as { nextSteps: unknown[] }).nextSteps).toHaveLength(
          3,
        );
      });
  });

  it('/start (POST) - with custom story', () => {
    return request(app.getHttpServer())
      .post('/start')
      .send({ story: 'montpellier-medieval' })
      .expect(201)
      .expect((res) => {
        expect(res.body).toHaveProperty('id');
        expect(res.body).toHaveProperty('story');
        expect(res.body).toHaveProperty('previously');
        expect(res.body).toHaveProperty('currentStep');
        expect(res.body).toHaveProperty('nextSteps');
      });
  });

  it('/state (POST)', () => {
    return request(app.getHttpServer())
      .post('/state')
      .send({ gameId: 'TESTGAME' })
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('id');
        expect(res.body).toHaveProperty('story');
        expect(res.body).toHaveProperty('previously');
        expect(res.body).toHaveProperty('currentStep');
        expect(res.body).toHaveProperty('nextSteps');
        expect((res.body as { id: string }).id).toBe('TESTGAME');
        expect((res.body as { story: string }).story).toBe('in-the-forest.md');
        expect(
          (res.body as { currentStep: { options: string[] } }).currentStep
            .options,
        ).toHaveLength(3);
        expect((res.body as { nextSteps: unknown[] }).nextSteps).toHaveLength(
          3,
        );
      });
  });

  it('/move (POST)', () => {
    return request(app.getHttpServer())
      .post('/move')
      .send({ gameId: 'TESTGAME', choiceIndex: 1 })
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('previously');
        expect(res.body).toHaveProperty('currentStep');
        expect(res.body).toHaveProperty('nextSteps');
        expect(typeof (res.body as { previously: string }).previously).toBe(
          'string',
        );
        expect(
          (res.body as { currentStep: { desc: string } }).currentStep,
        ).toHaveProperty('desc');
        expect(
          (res.body as { currentStep: { options: string[] } }).currentStep,
        ).toHaveProperty('options');
        expect((res.body as { nextSteps: unknown[] }).nextSteps).toHaveLength(
          3,
        );
      });
  });
});

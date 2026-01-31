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
    start: jest.fn().mockReturnValue({
      id: 'TESTGAME',
      story: 'in-the-forest.md',
      state: 'The story just began.',
    }),
    move: jest.fn().mockResolvedValue({
      response:
        '{"desc": "Mocked AI response", "options": ["Option 1", "Option 2", "Option 3"]}',
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

  it('/start (POST)', () => {
    return request(app.getHttpServer())
      .post('/start')
      .expect(201)
      .expect((res) => {
        expect(res.body).toHaveProperty('id');
        expect(res.body).toHaveProperty('story');
        expect(res.body).toHaveProperty('state');
        expect((res.body as { state: string }).state).toBe(
          'The story just began.',
        );
      });
  });

  it('/move (POST)', () => {
    return request(app.getHttpServer())
      .post('/move')
      .send({ gameId: 'TESTGAME', message: 'Choice 1' })
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('response');
        expect(typeof (res.body as { response: string }).response).toBe(
          'string',
        );
      });
  });
});

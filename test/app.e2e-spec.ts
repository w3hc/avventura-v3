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
    move: jest.fn().mockResolvedValue('Mocked AI response'),
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

  it('/move (POST)', () => {
    return request(app.getHttpServer())
      .post('/move')
      .send({ message: 'Hello' })
      .expect(201)
      .expect((res) => {
        expect(res.text).toBe('Mocked AI response');
      });
  });
});

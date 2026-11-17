import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AppService } from './../src/app.service';
import * as modelsData from './../models-infomaniak.json';
import { Wallet } from 'ethers';
import { createSiweMessage, generateSiweNonce } from 'w3pk';

const wallet = Wallet.createRandom();

async function siweHeaders(statement: string): Promise<Record<string, string>> {
  const now = Date.now();
  const message = createSiweMessage({
    domain: 'avventura.fun',
    address: wallet.address,
    statement,
    uri: 'https://avventura.fun/edit',
    version: '1',
    chainId: 1,
    nonce: generateSiweNonce(),
    issuedAt: new Date(now).toISOString(),
    expirationTime: new Date(now + 5 * 60 * 1000).toISOString(),
  });
  return {
    'x-siwe-message': encodeURIComponent(message),
    'x-siwe-signature': await wallet.signMessage(message),
  };
}

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  const mockAppService = {
    getModels: jest.fn().mockResolvedValue(modelsData),
    start: jest.fn().mockResolvedValue({
      id: 'TESTGAME',
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
    }),
    getState: jest.fn().mockReturnValue({
      id: 'TESTGAME',
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

  const createStory = jest.fn().mockResolvedValue({ slug: 'new-story' });
  const editStory = jest.fn().mockReturnValue({ slug: 'new-story' });

  beforeEach(async () => {
    createStory.mockClear();
    editStory.mockClear();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AppService)
      .useValue({ ...mockAppService, createStory, editStory })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
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

  it('/start (POST) - with custom language', () => {
    return request(app.getHttpServer())
      .post('/start')
      .send({ language: 'es' })
      .expect(201)
      .expect((res) => {
        expect(res.body).toHaveProperty('id');
        expect(res.body).toHaveProperty('story');
        expect(res.body).toHaveProperty('previously');
        expect(res.body).toHaveProperty('currentStep');
        expect(res.body).toHaveProperty('nextSteps');
        expect((res.body as { story: string }).story).toBe('in-the-forest.md');
      });
  });

  it('/start (POST) - with custom story and language', () => {
    return request(app.getHttpServer())
      .post('/start')
      .send({ story: 'montpellier-medieval', language: 'en' })
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

  it('/stories (POST) - rejects a request without SIWE headers', async () => {
    await request(app.getHttpServer())
      .post('/stories')
      .send({ prompt: 'A story' })
      .expect(401);
    expect(createStory).not.toHaveBeenCalled();
  });

  it('/stories (POST) - creates the story for the signer', async () => {
    await request(app.getHttpServer())
      .post('/stories')
      .set(await siweHeaders('Authorize POST /stories'))
      .send({ prompt: 'A story' })
      .expect(201);
    expect(createStory).toHaveBeenCalledWith(
      'A story',
      wallet.address.toLowerCase(),
    );
  });

  it('/stories/edit (POST) - rejects a signature for another route', async () => {
    await request(app.getHttpServer())
      .post('/stories/edit')
      .set(await siweHeaders('Authorize POST /stories'))
      .send({ slug: 'new-story', updates: { title: 'x' } })
      .expect(401);
    expect(editStory).not.toHaveBeenCalled();
  });

  it('/stories/edit (POST) - passes the signer to the service', async () => {
    await request(app.getHttpServer())
      .post('/stories/edit')
      .set(await siweHeaders('Authorize POST /stories/edit'))
      .send({ slug: 'new-story', updates: { title: 'x' } })
      .expect(200);
    expect(editStory).toHaveBeenCalledWith(
      'new-story',
      { title: 'x' },
      wallet.address.toLowerCase(),
    );
  });
});

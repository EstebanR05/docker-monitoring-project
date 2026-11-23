import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Incident API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /', () => {
    it('returns service metadata with default instanceId', async () => {
      const response = await request(app.getHttpServer()).get('/').expect(200);

      expect(response.body).toEqual(
        expect.objectContaining({
          service: 'incident-api',
          instanceId: process.env.INSTANCE_ID || 'backend-local',
          status: 'ok',
          timestamp: expect.any(String),
        }),
      );
    });
  });

  describe('GET /health', () => {
    it('returns health status, instanceId, uptime, and timestamp', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body).toEqual(
        expect.objectContaining({
          status: 'ok',
          instanceId: process.env.INSTANCE_ID || 'backend-local',
          uptime: expect.any(Number),
          timestamp: expect.any(String),
        }),
      );
    });
  });

  describe('/incidents', () => {
    let createdIncidentId: string;

    it('POST /incidents creates a new incident and returns 201', async () => {
      const payload = {
        title: 'Power outage',
        description: 'Transformer failure in sector 4',
        type: 'infrastructure',
        zone: 'north',
      };

      const response = await request(app.getHttpServer())
        .post('/incidents')
        .send(payload)
        .expect(201);

      expect(response.body).toEqual(
        expect.objectContaining({
          id: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          ),
          ...payload,
          createdAt: expect.any(String),
        }),
      );
      expect(Number.isNaN(Date.parse(response.body.createdAt))).toBe(false);

      createdIncidentId = response.body.id;
    });

    it('GET /incidents returns all created incidents', async () => {
      const response = await request(app.getHttpServer())
        .get('/incidents')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: createdIncidentId }),
        ]),
      );
    });

    it('GET /incidents/:id returns the matching incident', async () => {
      const response = await request(app.getHttpServer())
        .get(`/incidents/${createdIncidentId}`)
        .expect(200);

      expect(response.body).toEqual(
        expect.objectContaining({
          id: createdIncidentId,
          title: 'Power outage',
        }),
      );
    });

    it('GET /incidents/:id returns 404 for unknown id', async () => {
      await request(app.getHttpServer())
        .get('/incidents/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });

    it('POST /incidents returns 400 on invalid payload', async () => {
      await request(app.getHttpServer())
        .post('/incidents')
        .send({ title: '' })
        .expect(400);

      await request(app.getHttpServer())
        .post('/incidents')
        .send({
          title: 'Valid',
          description: 'Valid',
          type: 'Valid',
          zone: 'Valid',
          unexpected: 'field',
        })
        .expect(400);
    });
  });

  describe('GET /metrics', () => {
    it('returns Prometheus text metrics with normalized route labels', async () => {
      const created = await request(app.getHttpServer())
        .post('/incidents')
        .send({
          title: 'Water leak',
          description: 'Main pipe burst',
          type: 'utility',
          zone: 'west',
        })
        .expect(201);

      const incidentId: string = created.body.id;

      await request(app.getHttpServer())
        .get(`/incidents/${incidentId}`)
        .expect(200);

      const response = await request(app.getHttpServer())
        .get('/metrics')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/text\/plain/);
      expect(response.text).toContain('http_requests_total');
      expect(response.text).toContain('http_request_duration_seconds');
      expect(response.text).toContain('http_requests_in_flight');
      expect(response.text).toContain('route="/incidents/:id"');
      expect(response.text).not.toContain(incidentId);
    });
  });
});

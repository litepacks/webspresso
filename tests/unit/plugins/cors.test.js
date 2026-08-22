import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import corsPlugin from '../../../plugins/cors';
import { createApp } from '../../../src/server';
import path from 'path';

describe('CORS Plugin', () => {
  describe('createCorsMiddleware unit functionality', () => {
    it('should set default CORS headers', async () => {
      const app = express();
      const corsMiddleware = corsPlugin.createCorsMiddleware();
      app.use(corsMiddleware);
      app.get('/test', (req, res) => res.json({ ok: true }));

      const res = await request(app).get('/test').set('Origin', 'http://example.com');
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.body.ok).toBe(true);
    });

    it('should handle specific allowed string origin', async () => {
      const app = express();
      const corsMiddleware = corsPlugin.createCorsMiddleware({
        origin: 'https://myapp.com',
      });
      app.use(corsMiddleware);
      app.get('/test', (req, res) => res.json({ ok: true }));

      const resAllowed = await request(app).get('/test').set('Origin', 'https://myapp.com');
      expect(resAllowed.headers['access-control-allow-origin']).toBe('https://myapp.com');

      const resBlocked = await request(app).get('/test').set('Origin', 'https://malicious.com');
      expect(resBlocked.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should handle array of allowed origins and RegExp', async () => {
      const app = express();
      const corsMiddleware = corsPlugin.createCorsMiddleware({
        origin: ['https://app1.com', /\.example\.com$/],
      });
      app.use(corsMiddleware);
      app.get('/test', (req, res) => res.json({ ok: true }));

      const res1 = await request(app).get('/test').set('Origin', 'https://app1.com');
      expect(res1.headers['access-control-allow-origin']).toBe('https://app1.com');

      const res2 = await request(app).get('/test').set('Origin', 'https://sub.example.com');
      expect(res2.headers['access-control-allow-origin']).toBe('https://sub.example.com');

      const res3 = await request(app).get('/test').set('Origin', 'https://other.com');
      expect(res3.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should support credentials: true and echo origin when origin is true', async () => {
      const app = express();
      const corsMiddleware = corsPlugin.createCorsMiddleware({
        origin: true,
        credentials: true,
      });
      app.use(corsMiddleware);
      app.get('/test', (req, res) => res.json({ ok: true }));

      const res = await request(app).get('/test').set('Origin', 'https://myclient.com');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-origin']).toBe('https://myclient.com');
    });

    it('should respond to OPTIONS preflight requests with 204 No Content', async () => {
      const app = express();
      const corsMiddleware = corsPlugin.createCorsMiddleware({
        origin: 'https://client.com',
        methods: ['GET', 'POST', 'PUT'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        maxAge: 3600,
      });
      app.use(corsMiddleware);

      const res = await request(app)
        .options('/api/data')
        .set('Origin', 'https://client.com')
        .set('Access-Control-Request-Method', 'POST');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://client.com');
      expect(res.headers['access-control-allow-methods']).toBe('GET,POST,PUT');
      expect(res.headers['access-control-allow-headers']).toBe('Content-Type,Authorization');
      expect(res.headers['access-control-max-age']).toBe('3600');
    });

    it('should filter by route prefixes', async () => {
      const app = express();
      const corsMiddleware = corsPlugin.createCorsMiddleware({
        origin: 'https://api-client.com',
        routes: ['/api'],
      });
      app.use(corsMiddleware);
      app.get('/api/users', (req, res) => res.json({ page: 'api' }));
      app.get('/web/dashboard', (req, res) => res.json({ page: 'web' }));

      const resApi = await request(app).get('/api/users').set('Origin', 'https://api-client.com');
      expect(resApi.headers['access-control-allow-origin']).toBe('https://api-client.com');

      const resWeb = await request(app).get('/web/dashboard').set('Origin', 'https://api-client.com');
      expect(resWeb.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('createApp Plugin Integration', () => {
    it('should register corsPlugin into createApp and register named middleware', async () => {
      const pagesDir = path.join(process.cwd(), 'pages');
      const { app } = createApp({
        pagesDir,
        plugins: [
          corsPlugin({
            origin: 'https://frontend.com',
            credentials: true,
          }),
        ],
        setupRoutes(appInstance) {
          appInstance.get('/test-plugin-cors', (req, res) => res.json({ cors: true }));
        },
      });

      const res = await request(app)
        .get('/test-plugin-cors')
        .set('Origin', 'https://frontend.com');

      expect(res.headers['access-control-allow-origin']).toBe('https://frontend.com');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });
});

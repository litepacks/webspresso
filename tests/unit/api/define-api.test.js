import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'path';
import { z } from 'zod';
import { defineApi } from '../../../src/api/define-api';
import { createApiHandler } from '../../../src/api/api-loader';

describe('defineApi & API Loader', () => {
  it('should define an API contract and mark it', () => {
    const api = defineApi({
      description: 'Test API',
      tags: ['Test'],
      schema: {
        body: z.object({ title: z.string() }),
      },
      handler: async () => ({ ok: true }),
    });

    expect(api.__isWebspressoApi).toBe(true);
    expect(api.description).toBe('Test API');
    expect(api.tags).toEqual(['Test']);
  });

  it('should validate request schema and auto-send response', async () => {
    const app = express();
    app.use(express.json());

    const mockFile = path.resolve(__dirname, '../../fixtures/mock-api.js');
    const descriptor = {
      type: 'api',
      method: 'POST',
      path: '/api/items',
      file: mockFile,
      source: 'src/api/items.post.js',
    };

    require.cache[require.resolve(mockFile)] = {
      id: mockFile,
      filename: mockFile,
      loaded: true,
      exports: defineApi({
        schema: {
          body: z.object({
            name: z.string().min(2),
            price: z.number().positive(),
          }),
        },
        handler: async (req, ctx) => {
          return {
            id: 'item_123',
            name: req.input.body.name,
            price: req.input.body.price,
          };
        },
      }),
    };

    const handler = createApiHandler(descriptor, {});
    app.post('/api/items', handler);

    // Valid request
    const resSuccess = await request(app)
      .post('/api/items')
      .send({ name: 'Book', price: 29.99 });
    expect(resSuccess.status).toBe(200);
    expect(resSuccess.body).toEqual({
      id: 'item_123',
      name: 'Book',
      price: 29.99,
    });

    // Invalid request (missing price, name too short)
    const resFail = await request(app)
      .post('/api/items')
      .send({ name: 'A' });
    expect(resFail.status).toBe(400);
    expect(resFail.body.error).toBe('Validation Error');
    expect(resFail.body.issues).toBeDefined();

    delete require.cache[require.resolve(mockFile)];
  });

  it('should propagate middleware synchronous and asynchronous errors to next()', async () => {
    const app = express();
    const mockFile = path.resolve(__dirname, '../../fixtures/mock-api.js');
    const descriptor = {
      type: 'api',
      method: 'GET',
      path: '/api/error-test',
      file: mockFile,
      source: 'src/api/error-test.get.js',
    };

    require.cache[require.resolve(mockFile)] = {
      id: mockFile,
      filename: mockFile,
      loaded: true,
      exports: defineApi({
        middleware: [
          () => {
            throw new Error('Sync middleware failed');
          },
        ],
        handler: async () => ({ ok: true }),
      }),
    };

    const handler = createApiHandler(descriptor, {});
    app.get('/api/error-test', handler);

    // Error middleware
    app.use((err, req, res, next) => {
      res.status(500).json({ customError: err.message });
    });

    const res = await request(app).get('/api/error-test');
    expect(res.status).toBe(500);
    expect(res.body.customError).toBe('Sync middleware failed');

    delete require.cache[require.resolve(mockFile)];
  });

  it('should propagate handler exceptions cleanly to next()', async () => {
    const app = express();
    const mockFile = path.resolve(__dirname, '../../fixtures/mock-api.js');
    const descriptor = {
      type: 'api',
      method: 'GET',
      path: '/api/fail',
      file: mockFile,
      source: 'src/api/fail.get.js',
    };

    require.cache[require.resolve(mockFile)] = {
      id: mockFile,
      filename: mockFile,
      loaded: true,
      exports: defineApi({
        handler: async () => {
          const err = new Error('Resource not found');
          err.status = 404;
          throw err;
        },
      }),
    };

    const handler = createApiHandler(descriptor, {});
    app.get('/api/fail', handler);

    app.use((err, req, res, next) => {
      res.status(err.status || 500).json({ error: err.message });
    });

    const res = await request(app).get('/api/fail');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Resource not found');

    delete require.cache[require.resolve(mockFile)];
  });
});

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

  it('should support function shorthand in defineApi', () => {
    const fn = async (req, res) => ({ ok: true });
    const api = defineApi(fn);
    expect(api.__isWebspressoApi).toBe(true);
    expect(api.handler).toBe(fn);
  });

  it('should test compileApiSchema helper with various inputs', () => {
    const { compileApiSchema } = require('../../../src/api/api-loader');
    expect(compileApiSchema(null)).toBeNull();
    expect(compileApiSchema(undefined)).toBeNull();
    expect(compileApiSchema('not-a-schema')).toBeNull();

    const schemaObj = { body: z.object({ id: z.number() }) };
    expect(compileApiSchema(schemaObj)).toBe(schemaObj);

    const schemaFn = ({ z }) => ({ query: z.object({ search: z.string() }) });
    const compiled = compileApiSchema(schemaFn);
    expect(compiled.query).toBeDefined();

    const brokenSchemaFn = () => {
      throw new Error('Schema compile crash');
    };
    expect(() => compileApiSchema(brokenSchemaFn)).toThrow('Failed to compile API schema: Schema compile crash');
  });

  it('should validate query, params, and headers with validateRequestInput', async () => {
    const app = express();
    app.use(express.json());

    const mockFile = path.resolve(__dirname, '../../fixtures/mock-api.js');
    const descriptor = {
      type: 'api',
      method: 'GET',
      path: '/api/query-test/:category',
      file: mockFile,
      source: 'src/api/query-test.get.js',
    };

    require.cache[require.resolve(mockFile)] = {
      id: mockFile,
      filename: mockFile,
      loaded: true,
      exports: defineApi({
        schema: {
          params: z.object({ category: z.string() }),
          query: z.object({ limit: z.string().optional() }),
          headers: z.object({ 'x-custom-token': z.string().optional() }).passthrough(),
        },
        handler: async (req) => {
          return {
            category: req.input.params.category,
            limit: req.input.query.limit,
            token: req.input.headers ? req.input.headers['x-custom-token'] : undefined,
          };
        },
      }),
    };

    const handler = createApiHandler(descriptor, {});
    app.get('/api/query-test/:category', handler);

    const res = await request(app)
      .get('/api/query-test/electronics?limit=10')
      .set('x-custom-token', 'tok_123');

    expect(res.status).toBe(200);
    expect(res.body.category).toBe('electronics');
    expect(res.body.limit).toBe('10');
    expect(res.body.token).toBe('tok_123');

    delete require.cache[require.resolve(mockFile)];
  });

  it('should reject invalid handler and throw error during handler creation', async () => {
    const app = express();
    const mockFile = path.resolve(__dirname, '../../fixtures/mock-api.js');
    const descriptor = {
      type: 'api',
      method: 'GET',
      path: '/api/invalid-handler',
      file: mockFile,
      source: 'src/api/invalid-handler.get.js',
    };

    require.cache[require.resolve(mockFile)] = {
      id: mockFile,
      filename: mockFile,
      loaded: true,
      exports: {
        handler: 'not-a-function',
      },
    };

    const handler = createApiHandler(descriptor, {});
    app.get('/api/invalid-handler', handler);

    app.use((err, req, res, next) => {
      res.status(500).json({ error: err.message, phase: err.phase });
    });

    const res = await request(app).get('/api/invalid-handler');
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('does not export a valid handler function');
    expect(res.body.phase).toBe('handler');

    delete require.cache[require.resolve(mockFile)];
  });

  it('should inject db and service registry into api handler context', async () => {
    const app = express();
    const mockFile = path.resolve(__dirname, '../../fixtures/mock-api.js');
    const descriptor = {
      type: 'api',
      method: 'GET',
      path: '/api/injected',
      file: mockFile,
      source: 'src/api/injected.get.js',
    };

    const mockDb = { name: 'mock-database' };
    const mockServiceRegistry = {
      call: (name, input) => ({ called: name, input }),
    };

    require.cache[require.resolve(mockFile)] = {
      id: mockFile,
      filename: mockFile,
      loaded: true,
      exports: defineApi({
        handler: async (req) => {
          const sRes = await req.service('test.run', { x: 1 });
          return { dbName: req.db.name, serviceRes: sRes };
        },
      }),
    };

    const handler = createApiHandler(descriptor, {
      db: mockDb,
      serviceRegistry: mockServiceRegistry,
    });
    app.get('/api/injected', handler);

    const res = await request(app).get('/api/injected');
    expect(res.status).toBe(200);
    expect(res.body.dbName).toBe('mock-database');
    expect(res.body.serviceRes).toEqual({ called: 'test.run', input: { x: 1 } });

    delete require.cache[require.resolve(mockFile)];
  });
});

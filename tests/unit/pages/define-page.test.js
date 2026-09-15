import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'path';
import { definePage } from '../../../src/pages/define-page';
import { createPageHandler } from '../../../src/pages/page-loader';

describe('definePage & Page Loader', () => {
  it('should define a page contract and mark it', () => {
    const page = definePage({
      load: async () => ({ title: 'Home' }),
      head: (data) => ({ title: data.title }),
      render: (data) => `<h1>${data.title}</h1>`,
    });

    expect(page.__isWebspressoPage).toBe(true);
    expect(typeof page.load).toBe('function');
    expect(typeof page.head).toBe('function');
    expect(typeof page.render).toBe('function');
  });

  it('should execute definePage lifecycle with load -> head -> render', async () => {
    const app = express();

    // Create a mock page descriptor
    const mockFile = path.resolve(__dirname, '../../fixtures/mock-page.js');
    const descriptor = {
      type: 'page',
      method: 'GET',
      path: '/welcome',
      file: mockFile,
      source: 'src/pages/welcome.js',
    };

    // Define temporary mock module in require cache
    require.cache[require.resolve(mockFile)] = {
      id: mockFile,
      filename: mockFile,
      loaded: true,
      exports: definePage({
        load: async (ctx) => {
          return { name: ctx.query.name || 'Stranger' };
        },
        head: (data) => ({ title: `Hello ${data.name}` }),
        render: (data) => `<main><h1>Hello ${data.name}</h1></main>`,
      }),
    };

    const handler = createPageHandler(descriptor, {});
    app.get('/welcome', handler);

    const res = await request(app).get('/welcome?name=Ahmet');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toBe('<main><h1>Hello Ahmet</h1></main>');

    delete require.cache[require.resolve(mockFile)];
  });

  it('should handle ctx.redirect() inside load', async () => {
    const app = express();
    const mockFile = path.resolve(__dirname, '../../fixtures/mock-redirect-page.js');
    const descriptor = {
      type: 'page',
      method: 'GET',
      path: '/old-path',
      file: mockFile,
      source: 'src/pages/old-path.js',
    };

    require.cache[require.resolve(mockFile)] = {
      id: mockFile,
      filename: mockFile,
      loaded: true,
      exports: definePage({
        load: async (ctx) => {
          return ctx.redirect('/new-path', 301);
        },
      }),
    };

    const handler = createPageHandler(descriptor, {});
    app.get('/old-path', handler);

    const res = await request(app).get('/old-path');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/new-path');

    delete require.cache[require.resolve(mockFile)];
  });

  it('should propagate ctx.error() and load exceptions to next()', async () => {
    const app = express();
    const mockFile = path.resolve(__dirname, '../../fixtures/mock-page.js');
    const descriptor = {
      type: 'page',
      method: 'GET',
      path: '/error-page',
      file: mockFile,
      source: 'src/pages/error-page.js',
    };

    require.cache[require.resolve(mockFile)] = {
      id: mockFile,
      filename: mockFile,
      loaded: true,
      exports: definePage({
        load: async (ctx) => {
          ctx.error(403, 'Forbidden Access');
        },
      }),
    };

    const handler = createPageHandler(descriptor, {});
    app.get('/error-page', handler);

    app.use((err, req, res, next) => {
      res.status(err.status || 500).json({ error: err.message, status: err.status });
    });

    const res = await request(app).get('/error-page');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden Access');

    delete require.cache[require.resolve(mockFile)];
  });

  it('should propagate middleware errors in definePage to next()', async () => {
    const app = express();
    const mockFile = path.resolve(__dirname, '../../fixtures/mock-page.js');
    const descriptor = {
      type: 'page',
      method: 'GET',
      path: '/mw-fail',
      file: mockFile,
      source: 'src/pages/mw-fail.js',
    };

    require.cache[require.resolve(mockFile)] = {
      id: mockFile,
      filename: mockFile,
      loaded: true,
      exports: definePage({
        middleware: [
          () => {
            throw new Error('Page guard failure');
          },
        ],
        load: async () => ({ ok: true }),
      }),
    };

    const handler = createPageHandler(descriptor, {});
    app.get('/mw-fail', handler);

    app.use((err, req, res, next) => {
      res.status(500).json({ customError: err.message });
    });

    const res = await request(app).get('/mw-fail');
    expect(res.status).toBe(500);
    expect(res.body.customError).toBe('Page guard failure');

    delete require.cache[require.resolve(mockFile)];
  });
});

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

  it('should support function shorthand in definePage', () => {
    const fn = async (ctx) => ({ message: 'ok' });
    const page = definePage(fn);
    expect(page.__isWebspressoPage).toBe(true);
    expect(page.load).toBe(fn);
  });

  it('should support resolveMiddlewaresWithModule helper', () => {
    const { resolveMiddlewaresWithModule } = require('../../../src/pages/page-loader');
    const globalMw = { auth: (req, res, next) => next() };
    const moduleMw = { guard: (req, res, next) => next() };
    const list = ['auth', 'guard'];
    const resolved = resolveMiddlewaresWithModule(list, globalMw, moduleMw);
    expect(resolved.length).toBe(2);
  });

  it('should render with companion Nunjucks template when available', async () => {
    const app = express();
    const existingNjk = path.resolve(__dirname, '../../fixtures/pages/index.njk');
    const descriptor = {
      type: 'page',
      method: 'GET',
      path: '/njk-test',
      file: existingNjk,
      source: 'src/pages/index.njk',
    };

    const mockNunjucks = {
      render: (templatePath, data, cb) => {
        cb(null, '<html>Rendered NJK with success</html>');
      },
    };

    const handler = createPageHandler(descriptor, { nunjucks: mockNunjucks });
    app.get('/njk-test', handler);

    const res = await request(app).get('/njk-test');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Rendered NJK with success');
  });

  it('should handle Nunjucks render errors by forwarding to next()', async () => {
    const app = express();
    const existingNjk = path.resolve(__dirname, '../../fixtures/pages/index.njk');
    const descriptor = {
      type: 'page',
      method: 'GET',
      path: '/njk-err',
      file: existingNjk,
      source: 'src/pages/index.njk',
    };

    const mockNunjucks = {
      render: (templatePath, data, cb) => {
        cb(new Error('Nunjucks template syntax error'));
      },
    };

    const handler = createPageHandler(descriptor, { nunjucks: mockNunjucks });
    app.get('/njk-err', handler);

    app.use((err, req, res, next) => {
      res.status(500).json({ error: err.message, phase: err.phase });
    });

    const res = await request(app).get('/njk-err');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Nunjucks template syntax error');
  });

  it('should fallback to returning json or string when no template and no render function exist', async () => {
    const app = express();
    const mockFile = path.resolve(__dirname, '../../fixtures/mock-page.js');
    const descriptor = {
      type: 'page',
      method: 'GET',
      path: '/json-page',
      file: mockFile,
      source: 'src/pages/json-page.js',
    };

    require.cache[require.resolve(mockFile)] = {
      id: mockFile,
      filename: mockFile,
      loaded: true,
      exports: definePage({
        load: async () => ({ items: [1, 2, 3] }),
      }),
    };

    const handler = createPageHandler(descriptor, {});
    app.get('/json-page', handler);

    const res = await request(app).get('/json-page');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [1, 2, 3] });

    delete require.cache[require.resolve(mockFile)];
  });

  it('should execute service calls via ctx.service in definePage load', async () => {
    const app = express();
    const mockFile = path.resolve(__dirname, '../../fixtures/mock-page.js');
    const descriptor = {
      type: 'page',
      method: 'GET',
      path: '/service-page',
      file: mockFile,
      source: 'src/pages/service-page.js',
    };

    const mockServiceRegistry = {
      call: (name, input) => {
        if (name === 'data.fetch') return { data: `Fetched ${input.id}` };
        return null;
      },
    };

    require.cache[require.resolve(mockFile)] = {
      id: mockFile,
      filename: mockFile,
      loaded: true,
      exports: definePage({
        load: async (ctx) => {
          const result = await ctx.service('data.fetch', { id: 42 });
          return result;
        },
      }),
    };

    const handler = createPageHandler(descriptor, { serviceRegistry: mockServiceRegistry });
    app.get('/service-page', handler);

    const res = await request(app).get('/service-page');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: 'Fetched 42' });

    delete require.cache[require.resolve(mockFile)];
  });

  it('should handle load exceptions and annotate trace metadata', async () => {
    const app = express();
    const mockFile = path.resolve(__dirname, '../../fixtures/mock-page.js');
    const descriptor = {
      type: 'page',
      method: 'GET',
      path: '/dev-trace-page',
      file: mockFile,
      source: 'src/pages/dev-trace-page.js',
      module: 'analytics',
    };

    require.cache[require.resolve(mockFile)] = {
      id: mockFile,
      filename: mockFile,
      loaded: true,
      exports: definePage({
        load: async () => {
          throw new Error('Dev failure');
        },
      }),
    };

    const handler = createPageHandler(descriptor, {});
    app.get('/dev-trace-page', handler);

    app.use((err, req, res, next) => {
      res.status(500).json({
        error: err.message,
        route: err.route,
        method: err.method,
        source: err.source,
        module: err.module,
        phase: err.phase,
      });
    });

    const res = await request(app).get('/dev-trace-page');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Dev failure');
    expect(res.body.route).toBe('/dev-trace-page');
    expect(res.body.method).toBe('GET');
    expect(res.body.module).toBe('analytics');
    expect(res.body.phase).toBe('page');

    delete require.cache[require.resolve(mockFile)];
  });
});

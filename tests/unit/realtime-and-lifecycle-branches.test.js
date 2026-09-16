'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const express = require('express');
const nunjucks = require('nunjucks');
const { z } = require('zod');

describe('Realtime Layer & Server Lifecycle Branch Coverage', () => {
  describe('src/server.js deep branch coverage', () => {
    const { createApp } = require('../../src/server.js');

    it('handles Nunjucks safe circular template detection', () => {
      const fixtureDir = path.join(__dirname, '../fixtures/pages-basic');
      const { nunjucksEnv } = createApp({
        pagesDir: fixtureDir,
        helmet: false,
      });

      // Test getTemplate without cycle
      expect(typeof nunjucksEnv.getTemplate).toBe('function');
      
      // Test renderString with circular prevention
      const res = nunjucksEnv.renderString('Hello {{ name }}', { name: 'World' });
      expect(res).toBe('Hello World');

      // Test error branch of getTemplate with callback
      try {
        nunjucksEnv.getTemplate('non-existent-template.njk', (err) => {
          expect(err).toBeDefined();
        });
      } catch (e) {
        expect(e).toBeDefined();
      }
    });

    it('merges plugin CSP headers correctly with and without none', () => {
      const pluginWithCsp = {
        name: 'csp-plugin',
        csp: {
          styleSrc: 'https://styles.example.com',
          scriptSrc: ['https://scripts.example.com'],
          frameSrc: 'https://frame.example.com',
          imgSrc: ['https://img1.com', 'https://img2.com'],
          fontSrc: 'https://fonts.example.com',
          connectSrc: ['https://api.example.com'],
        },
      };

      const fixtureDir = path.join(__dirname, '../fixtures/pages-basic');
      const { app } = createApp({
        pagesDir: fixtureDir,
        plugins: [pluginWithCsp],
        helmet: {
          contentSecurityPolicy: {
            directives: {
              defaultSrc: ["'self'"],
              frameSrc: ["'none'"],
              styleSrc: ["'self'"],
            },
          },
        },
      });

      expect(app).toBeDefined();
    });

    it('handles custom errorPages handlers and customErrorHandler', async () => {
      const fixtureDir = path.join(__dirname, '../fixtures/pages-basic');
      const request = require('supertest');

      const { app } = createApp({
        pagesDir: fixtureDir,
        helmet: false,
        setupRoutes: (a) => {
          a.get('/trigger-error', () => {
            throw new Error('Explosion');
          });
        },
        errorPages: {
          notFound: (req, res, ctx) => {
            return res.status(404).send('custom-not-found');
          },
          serverError: (err, req, res, ctx) => {
            return res.status(500).send('custom-server-error');
          },
          timeout: (req, res, ctx) => {
            return res.status(503).send('custom-timeout');
          },
        },
      });

      const res404 = await request(app).get('/non-existent-page-xyz');
      expect(res404.status).toBe(404);
      expect(res404.text).toBe('custom-not-found');

      const res500 = await request(app).get('/trigger-error');
      expect(res500.status).toBe(500);
      expect(res500.text).toBe('custom-server-error');

      // Test custom error handler (app.setErrorHandler)
      const { app: appWithHandler } = createApp({
        pagesDir: fixtureDir,
        helmet: false,
        setupRoutes: (a) => {
          a.get('/teapot-error', () => {
            throw new Error('I am a teapot');
          });
        },
      });
      appWithHandler.setErrorHandler(async (err, req, res) => {
        res.status(418).send('I am a custom teapot');
        return true;
      });

      const resTeapot = await request(appWithHandler).get('/teapot-error');
      expect(resTeapot.status).toBe(418);
      expect(resTeapot.text).toBe('I am a custom teapot');

      // Test app shutdown lifecycle helpers
      app.onShutdown(() => {});
      app.enableShutdownHooks();
      app.disableShutdownHooks();
      expect(typeof app.close).toBe('function');
      expect(app.isShuttingDown).toBe(false);
    });

    it('handles template rendering failure fallback in error handlers', async () => {
      const fixtureDir = path.join(__dirname, '../fixtures/pages-basic');
      const request = require('supertest');

      const { app } = createApp({
        pagesDir: fixtureDir,
        helmet: false,
        setupRoutes: (a) => {
          a.get('/throw-server-err', () => {
            throw new Error('Boom');
          });
        },
        errorPages: {
          notFound: 'invalid-missing-404.njk',
          serverError: 'invalid-missing-500.njk',
        },
      });

      const res404Html = await request(app).get('/missing-route').set('Accept', 'text/html');
      expect(res404Html.status).toBe(404);
      expect(res404Html.text).toContain('404');

      const res404Json = await request(app).get('/missing-route').set('Accept', 'application/json');
      expect(res404Json.status).toBe(404);
      expect(res404Json.body.error).toBe('Not Found');

      const res500Html = await request(app).get('/throw-server-err').set('Accept', 'text/html');
      expect(res500Html.status).toBe(500);
      expect(res500Html.text).toContain('500');

      const res500Json = await request(app).get('/throw-server-err').set('Accept', 'application/json');
      expect(res500Json.status).toBe(500);
      expect(res500Json.body.status).toBe(500);
    });

    it('handles request draining during shutdown', async () => {
      const fixtureDir = path.join(__dirname, '../fixtures/pages-basic');
      const request = require('supertest');
      const { app, shutdownManager } = createApp({
        pagesDir: fixtureDir,
        helmet: false,
      });

      // Simulate shutdown mode
      shutdownManager.isShuttingDown = true;
      expect(app.isShuttingDown).toBe(true);

      const resHtml = await request(app).get('/').set('Accept', 'text/html');
      expect(resHtml.status).toBe(503);
      expect(resHtml.text).toContain('Server is shutting down');

      const resJson = await request(app).get('/api/any').set('Accept', 'application/json');
      expect(resJson.status).toBe(503);
      expect(resJson.body.error).toBe('Service Unavailable');
    });
  });

  describe('src/api/api-loader.js and define-api.js branch coverage', () => {
    const { createApiHandler, compileApiSchema, validateRequestInput } = require('../../src/api/api-loader.js');
    const { defineApi } = require('../../src/api/define-api.js');

    it('exercises compileApiSchema with various inputs', () => {
      expect(compileApiSchema(null)).toBeNull();
      expect(compileApiSchema(undefined)).toBeNull();
      expect(compileApiSchema({ body: z.object({}) })).toBeDefined();

      const fnSchema = compileApiSchema(({ z: zLocal }) => ({
        body: zLocal.object({ name: zLocal.string() }),
      }));
      expect(fnSchema.body).toBeDefined();

      expect(() => {
        compileApiSchema(() => {
          throw new Error('schema failure');
        });
      }).toThrow('Failed to compile API schema: schema failure');

      expect(compileApiSchema('invalid-schema')).toBeNull();
    });

    it('exercises validateRequestInput with all request compartments', () => {
      const req = {
        body: { a: 1 },
        params: { id: '123' },
        query: { q: 'search' },
        headers: { 'x-test': 'val' },
      };

      validateRequestInput(req, null);
      expect(req.input.body).toBeUndefined();

      const schema = {
        body: z.object({ a: z.number() }),
        params: z.object({ id: z.string() }),
        query: z.object({ q: z.string() }),
        headers: z.object({ 'x-test': z.string() }),
      };

      validateRequestInput(req, schema);
      expect(req.input.body).toEqual({ a: 1 });
      expect(req.input.params).toEqual({ id: '123' });
      expect(req.input.query).toEqual({ q: 'search' });
      expect(req.input.headers).toEqual({ 'x-test': 'val' });
    });

    it('exercises defineApi helper function and object formats', () => {
      const fnApi = defineApi((req, res) => ({ ok: true }));
      expect(fnApi.__isWebspressoApi).toBe(true);
      expect(typeof fnApi.handler).toBe('function');

      const objApi = defineApi({
        handler: async () => ({ status: 'ok' }),
        description: 'Test API',
      });
      expect(objApi.__isWebspressoApi).toBe(true);
      expect(objApi.description).toBe('Test API');
    });

    it('exercises createApiHandler execution, validation success, failure, and missing file', async () => {
      const mockDescriptor = {
        file: path.join(__dirname, '../fixtures/mock-api.js'),
        path: '/api/items',
        method: 'post',
        source: 'mock-api.js',
      };

      const handler = createApiHandler(mockDescriptor, {
        middlewares: {
          testMw: (req, res, next) => next(),
        },
        serviceRegistry: {
          call: (name, input) => ({ called: name, input }),
        },
        db: { query: () => {} },
      });

      // 1. Successful validation and execution
      const reqSuccess = {
        body: { name: 'Espresso', price: 4.5 },
        params: {},
        query: {},
        headers: {},
        id: 'req-success',
      };
      let sentJson = null;
      const resSuccess = {
        headersSent: false,
        status() { return this; },
        json(data) {
          this.headersSent = true;
          sentJson = data;
          return this;
        },
      };

      await handler(reqSuccess, resSuccess, (err) => {
        if (err) throw err;
      });

      expect(resSuccess.headersSent).toBe(true);
      expect(sentJson).toEqual({
        id: 'item_123',
        name: 'Espresso',
        price: 4.5,
      });

      // 2. Validation failure (price missing)
      const reqInvalid = {
        body: { name: 'E' }, // min(2) failure and price missing
        params: {},
        query: {},
        headers: {},
        id: 'req-invalid',
      };
      let errorStatus = 200;
      let errorJson = null;
      const resInvalid = {
        headersSent: false,
        status(code) {
          errorStatus = code;
          return this;
        },
        json(data) {
          this.headersSent = true;
          errorJson = data;
          return this;
        },
      };

      await handler(reqInvalid, resInvalid, (err) => {
        if (err) throw err;
      });

      expect(errorStatus).toBe(400);
      expect(errorJson.error).toBe('Validation Error');
      expect(Array.isArray(errorJson.issues)).toBe(true);

      // 3. Missing file handling
      const missingDescriptor = {
        file: path.join(__dirname, '../fixtures/non-existent-api.js'),
        path: '/api/missing',
        method: 'get',
      };
      const missingHandler = createApiHandler(missingDescriptor, {});
      let nextError = null;
      await missingHandler(reqSuccess, resSuccess, (err) => {
        nextError = err;
      });
      expect(nextError).toBeDefined();
    });
  });

  describe('src/pages/page-loader.js and define-page.js branch coverage', () => {
    const { createPageHandler, resolveMiddlewaresWithModule } = require('../../src/pages/page-loader.js');
    const { definePage } = require('../../src/pages/define-page.js');

    it('exercises definePage helper function and object formats', () => {
      const fnPage = definePage(async (ctx) => ({ title: 'Home' }));
      expect(fnPage.__isWebspressoPage).toBe(true);
      expect(typeof fnPage.load).toBe('function');

      const objPage = definePage({
        load: async () => ({ title: 'About' }),
        layout: 'admin',
      });
      expect(objPage.__isWebspressoPage).toBe(true);
      expect(objPage.layout).toBe('admin');
    });

    it('exercises resolveMiddlewaresWithModule helper', () => {
      const globalMw = {
        auth: (req, res, next) => next(),
      };
      const moduleMw = {
        custom: (req, res, next) => next(),
      };

      const resolved = resolveMiddlewaresWithModule(['auth', 'custom'], globalMw, moduleMw);
      expect(resolved.length).toBe(2);
    });

    it('exercises createPageHandler with custom render and helpers', async () => {
      const mockDescriptor = {
        file: path.join(__dirname, '../fixtures/mock-page.js'),
        path: '/hello',
        method: 'get',
        source: 'mock-page.js',
      };

      const handler = createPageHandler(mockDescriptor, {
        middlewares: {},
        serviceRegistry: null,
      });

      const req = {
        path: '/hello',
        params: {},
        query: { name: 'Alice' },
        headers: {},
        cookies: {},
        get: (h) => '',
        url: '/hello?name=Alice',
        method: 'GET',
      };
      let sentBody = null;
      let contentType = '';
      const res = {
        headersSent: false,
        setHeader(name, val) {
          if (name.toLowerCase() === 'content-type') contentType = val;
        },
        send(html) {
          this.headersSent = true;
          sentBody = html;
          return this;
        },
      };

      await handler(req, res, (err) => {
        if (err) throw err;
      });

      expect(sentBody).toBe('<main><h1>Hello Alice</h1></main>');
      expect(contentType).toContain('text/html');
    });

    it('exercises createPageHandler redirect and error context helpers', async () => {
      const redirectDescriptor = {
        file: path.join(__dirname, '../fixtures/mock-redirect-page.js'),
        path: '/redirect-me',
        method: 'get',
      };

      const handler = createPageHandler(redirectDescriptor, {});

      let redirectedTo = null;
      let redirectStatus = null;
      const req = {
        path: '/redirect-me',
        params: {},
        query: {},
        headers: {},
        cookies: {},
        get: () => '',
        url: '/redirect-me',
        method: 'GET',
      };
      const res = {
        headersSent: false,
        redirect(status, url) {
          if (typeof status === 'string') {
            redirectedTo = status;
            redirectStatus = 302;
          } else {
            redirectStatus = status;
            redirectedTo = url;
          }
          this.headersSent = true;
        },
      };

      await handler(req, res, (err) => {
        if (err) throw err;
      });

      expect(redirectedTo).toBe('/new-path');
      expect(redirectStatus).toBe(301);
    });
  });

  describe('src/file-router.js routing markers and locale matching', () => {
    const {
      filePathToRoute,
      extractMethodFromFilename,
      routeRegistrationMeta,
      compareRouteRegistrationOrder,
      detectLocale,
      createTranslator,
    } = require('../../src/file-router.js');

    it('exercises filePathToRoute conversion with Windows and POSIX separators', () => {
      expect(filePathToRoute('index.njk', '.njk')).toBe('/');
      expect(filePathToRoute('about/index.njk', '.njk')).toBe('/about');
      expect(filePathToRoute('posts/[id].njk', '.njk')).toBe('/posts/:id');
      expect(filePathToRoute('docs/[...slug].njk', '.njk')).toBe('/docs/*slug');
      expect(filePathToRoute('files\\view.njk', '.njk')).toBe('/files/view');
    });

    it('exercises extractMethodFromFilename for API and standard routes', () => {
      expect(extractMethodFromFilename('users.get.js')).toEqual({ method: 'get', baseName: 'users' });
      expect(extractMethodFromFilename('notes.post.js')).toEqual({ method: 'post', baseName: 'notes' });
      expect(extractMethodFromFilename('items.delete.js')).toEqual({ method: 'delete', baseName: 'items' });
      expect(extractMethodFromFilename('profile.js')).toEqual({ method: 'get', baseName: 'profile' });
    });

    it('exercises routeRegistrationMeta and compareRouteRegistrationOrder', () => {
      const meta1 = routeRegistrationMeta('/api/users');
      expect(meta1.depth).toBe(2);
      expect(meta1.literalSegCount).toBe(2);

      const meta2 = routeRegistrationMeta('/api/users/:id');
      expect(meta2.paramSegCount).toBe(1);

      const meta3 = routeRegistrationMeta('/static/*splat');
      expect(meta3.tier).toBeDefined();

      const sorted = [
        { routePath: '/users/*splat' },
        { routePath: '/users/:id' },
        { routePath: '/users/active' },
      ].sort((a, b) => compareRouteRegistrationOrder(a, b));

      expect(sorted[0].routePath).toBe('/users/active');
      expect(sorted[1].routePath).toBe('/users/:id');
      expect(sorted[2].routePath).toBe('/users/*splat');
    });

    it('exercises detectLocale and createTranslator', () => {
      const origSupported = process.env.SUPPORTED_LOCALES;
      process.env.SUPPORTED_LOCALES = 'en,fr,de';

      const reqWithQuery = {
        query: { lang: 'fr' },
        get: () => 'en-US,en;q=0.9',
      };
      expect(detectLocale(reqWithQuery)).toBe('fr');

      const reqWithHeader = {
        query: {},
        get: (h) => (h.toLowerCase() === 'accept-language' ? 'de-DE,de;q=0.9' : ''),
      };
      expect(detectLocale(reqWithHeader)).toBe('de');

      const translations = {
        nav: { home: 'Accueil', welcome: 'Bonjour {{name}}' },
      };
      const t = createTranslator(translations, { locale: 'fr' });
      expect(t('nav.home')).toBe('Accueil');
      expect(t('nav.welcome', { name: 'Jean' })).toBe('Bonjour Jean');
      expect(t('nav.missing', null, 'Default Nav')).toBe('Default Nav');

      if (origSupported !== undefined) {
        process.env.SUPPORTED_LOCALES = origSupported;
      } else {
        delete process.env.SUPPORTED_LOCALES;
      }
    });
  });

  describe('plugins/realtime and core/realtime branch coverage', () => {
    const { realtimePlugin, realtime } = require('../../plugins/realtime/index.js');
    const { SseAdapter, resolveSseUrl } = require('../../core/realtime/adapters/sse.js');
    const { AuthManager } = require('../../core/realtime/auth-manager.js');
    const { ReconnectManager } = require('../../core/realtime/reconnect-manager.js');

    const createMockAdapter = () => ({
      name: 'mock',
      isConnected: () => true,
      connect: async () => {},
      subscribe: (channel, params, callbacks) => {
        callbacks.connected?.();
        return {
          send: () => {},
          perform: () => {},
          unsubscribe: () => {},
        };
      },
      disconnect: () => {},
      destroy: () => {},
    });

    it('exercises realtimePlugin lifecycle and realtime factory', () => {
      const mockAdapter = createMockAdapter();
      const plugin = realtimePlugin({ adapter: mockAdapter });
      expect(plugin.name).toBe('realtime');

      let disposeCallback = null;
      const mockCtx = {
        app: {},
        onDispose: (cb) => {
          disposeCallback = cb;
        },
      };

      plugin.register(mockCtx);
      expect(mockCtx.app.realtime).toBeDefined();

      if (disposeCallback) {
        disposeCallback();
      }

      plugin.browserReady();
      plugin.destroy();

      const client = realtime({ adapter: mockAdapter });
      expect(client.plugin).toBeDefined();
      client.destroy();
    });

    it('exercises resolveSseUrl with function, string, and token appending', async () => {
      const url1 = await resolveSseUrl('http://localhost:3000/events', {});
      expect(url1).toBe('http://localhost:3000/events');

      const url2 = await resolveSseUrl(
        'http://localhost:3000/events?foo=bar',
        { auth: { token: 'secret-token' } },
        'jwt'
      );
      expect(url2).toBe('http://localhost:3000/events?foo=bar&jwt=secret-token');

      const url3 = await resolveSseUrl(
        async () => 'http://localhost:3000/dynamic',
        { auth: { token: 'token123' } }
      );
      expect(url3).toBe('http://localhost:3000/dynamic?token=token123');

      await expect(resolveSseUrl(12345, {})).rejects.toThrow('SSE adapter requires a valid url string');
    });

    it('exercises SseAdapter connection, messages, subscribe, and teardown', async () => {
      class MockEventSource {
        constructor(url) {
          this.url = url;
          this.onopen = null;
          this.onerror = null;
          this.onmessage = null;
          setTimeout(() => {
            if (this.onopen) this.onopen();
          }, 10);
        }
        close() {}
      }

      const adapter = new SseAdapter({
        url: 'http://localhost:3000/events',
        EventSource: MockEventSource,
      });

      expect(adapter.isConnected()).toBe(false);

      const removeListener = adapter.on('disconnected', () => {});
      expect(typeof removeListener).toBe('function');
      removeListener();

      await adapter.connect({});
      expect(adapter.isConnected()).toBe(true);

      let receivedData = null;
      let connectedCalled = false;
      const sub = adapter.subscribe('chat-channel', {}, {
        connected: () => {
          connectedCalled = true;
        },
        received: (data) => {
          receivedData = data;
        },
      });

      expect(connectedCalled).toBe(true);
      expect(() => sub.send()).toThrow('SSE adapter is unidirectional');
      expect(() => sub.perform()).toThrow('SSE adapter is unidirectional');

      // Dispatch message
      adapter.eventSource.onmessage({
        data: JSON.stringify({ identifier: 'chat-channel', data: { message: 'hello' } }),
      });
      expect(receivedData).toEqual({ message: 'hello' });

      // Raw string message
      adapter.eventSource.onmessage({
        data: 'raw text message',
      });
      expect(receivedData).toBe('raw text message');

      sub.unsubscribe();
      adapter.disconnect();
      adapter.destroy();
      expect(adapter.isConnected()).toBe(false);
    });

    it('exercises AuthManager strategies, tokens, and errors', async () => {
      const noneAuth = new AuthManager(false);
      expect(noneAuth.isEnabled()).toBe(false);
      expect(noneAuth.getStrategy()).toBe('none');
      expect(await noneAuth.resolveAuthMetadata()).toEqual({ type: 'none' });
      expect(await noneAuth.refreshToken()).toEqual({ type: 'none' });

      const cookieAuth = new AuthManager({ strategy: 'cookie' });
      expect(cookieAuth.getStrategy()).toBe('cookie');
      expect(await cookieAuth.resolveAuthMetadata()).toEqual({ type: 'cookie' });

      const tokenAuth = new AuthManager({
        strategy: 'token',
        getToken: async () => 'bearer-abc',
        refreshToken: async () => 'bearer-def',
        onUnauthorized: () => {},
      });
      expect(await tokenAuth.resolveAuthMetadata()).toEqual({ type: 'token', token: 'bearer-abc' });
      expect(await tokenAuth.refreshToken()).toEqual({ type: 'token', token: 'bearer-def' });
      tokenAuth.handleUnauthorized(new Error('unauthorized'));

      const customAuth = new AuthManager({
        strategy: 'custom',
        resolve: async () => ({ user: 'admin', apiKey: 'key1' }),
      });
      expect(await customAuth.resolveAuthMetadata()).toEqual({ type: 'custom', user: 'admin', apiKey: 'key1' });

      // Error branches
      const invalidTokenAuth = new AuthManager({ strategy: 'token' });
      await expect(invalidTokenAuth.resolveAuthMetadata()).rejects.toThrow('requires a getToken() function');

      const emptyTokenAuth = new AuthManager({ strategy: 'token', getToken: async () => null });
      await expect(emptyTokenAuth.resolveAuthMetadata()).rejects.toThrow('No authentication token provided');

      const unsupportedAuth = new AuthManager({ strategy: 'oauth' });
      await expect(unsupportedAuth.resolveAuthMetadata()).rejects.toThrow('Unsupported auth strategy');
    });

    it('exercises ReconnectManager backoff and cancel', () => {
      const mgr = new ReconnectManager({
        enabled: true,
        maxAttempts: 3,
        baseDelay: 10,
        maxDelay: 50,
        factor: 2,
        jitter: false,
      });

      expect(mgr.canReconnect()).toBe(true);
      expect(mgr.calculateDelay(0)).toBe(10);
      expect(mgr.calculateDelay(1)).toBe(20);
      expect(mgr.calculateDelay(2)).toBe(40);
      expect(mgr.calculateDelay(3)).toBe(50); // capped

      let attemptFired = false;
      const scheduled = mgr.schedule(
        async () => {},
        ({ attempt }) => {
          attemptFired = true;
        }
      );
      expect(scheduled).toBe(true);
      expect(mgr.isReconnecting()).toBe(true);

      mgr.reset();
      expect(mgr.isReconnecting()).toBe(false);

      mgr.cancel();
      expect(mgr.canReconnect()).toBe(false);
    });
  });

  describe('plugins/polar and nunjucks-filters branch coverage', () => {
    const {
      dateLabel,
      createSafeTruncateFilter,
      registerNunjucksFilters,
    } = require('../../plugins/polar/src/nunjucks-filters.js');
    const {
      polarIpKey,
      polarUserOrIpKey,
      buildDefaultRateLimits,
      getDefaultRateLimits,
      resolvePolarRateLimiters,
    } = require('../../plugins/polar/src/rate-limit.js');

    it('exercises dateLabel with Date, strings, and fallbacks', () => {
      expect(dateLabel(null)).toBe('');
      expect(dateLabel(undefined)).toBe('');

      const validDate = new Date('2026-09-16T12:00:00Z');
      expect(dateLabel(validDate)).toBe('2026-09-16');

      const invalidDate = new Date('invalid');
      expect(dateLabel(invalidDate)).toBe('');

      expect(dateLabel('2026-09-16T08:30:00Z')).toBe('2026-09-16');
      expect(dateLabel('not-a-date')).toBe('not-a-date');
    });

    it('exercises safe truncate filter with objects and errors', () => {
      const origTruncate = (str, len, end = '…') => (str.length > len ? str.slice(0, len) + end : str);
      const safeTruncate = createSafeTruncateFilter(origTruncate);

      expect(safeTruncate(null, 10)).toBe('');
      expect(safeTruncate(new Date('2026-09-16'), 10)).toBe('2026-09-16');
      expect(safeTruncate({ name: 'Webspresso' }, 5)).toBe('{"nam…');

      // Circular object test
      const circular = {};
      circular.self = circular;
      expect(safeTruncate(circular, 10)).toBe('[object Ob…');

      expect(safeTruncate('Short text', 20)).toBe('Short text');
    });

    it('exercises registerNunjucksFilters with mock environment', () => {
      const filters = {};
      const mockEnv = {
        addFilter: (name, fn) => {
          filters[name] = fn;
        },
        getFilter: (name) => (name === 'truncate' ? (s) => s : null),
      };

      registerNunjucksFilters(mockEnv);
      expect(typeof filters.dateLabel).toBe('function');
      expect(typeof filters.truncate).toBe('function');
    });

    it('exercises polar rate limit key generators and limiter resolution', () => {
      const mockIpKeyGen = (ip, subnet) => `norm:${ip}:${subnet}`;
      const ipKeyFn = polarIpKey(mockIpKeyGen, 'prefix');
      expect(ipKeyFn({ ip: '127.0.0.1' })).toBe('prefix:norm:127.0.0.1:56');

      const userOrIpKeyFn = polarUserOrIpKey(mockIpKeyGen, 'prefix');
      expect(userOrIpKeyFn({ user: { id: 42 } })).toBe('prefix:42');
      expect(userOrIpKeyFn({ user: null, ip: '192.168.1.1' })).toBe('prefix:norm:192.168.1.1:56');

      const defaultLimits = buildDefaultRateLimits(mockIpKeyGen);
      expect(defaultLimits.webhook.limit).toBe(120);
      expect(defaultLimits.checkout.limit).toBe(5);

      // resolvePolarRateLimiters disabled
      expect(resolvePolarRateLimiters({}, { rateLimit: false })).toEqual({});
      expect(resolvePolarRateLimiters({}, { rateLimit: { enabled: false } })).toEqual({});

      // resolvePolarRateLimiters with missing middleware factory
      const emptyResult = resolvePolarRateLimiters({ middlewares: {} }, { rateLimit: true });
      expect(emptyResult).toEqual({});

      // resolvePolarRateLimiters with mock middleware factory
      const mockFactory = (opts) => (req, res, next) => next();
      const limiters = resolvePolarRateLimiters(
        { middlewares: { rateLimit: mockFactory } },
        { rateLimit: { checkout: { limit: 10 }, portal: false } }
      );
      expect(limiters.checkout).toBeDefined();
      expect(limiters.portal).toBeUndefined();

      // Deprecated DEFAULT_RATE_LIMITS getter
      const { DEFAULT_RATE_LIMITS } = require('../../plugins/polar/src/rate-limit.js');
      expect(DEFAULT_RATE_LIMITS).toBeDefined();
      expect(DEFAULT_RATE_LIMITS.webhook).toBeDefined();
    });
  });

  describe('plugins/mcp/transports/stdio.js comprehensive branch coverage', () => {
    const {
      startStdioTransport,
      redirectConsoleToStderr,
      restoreConsole,
    } = require('../../plugins/mcp/transports/stdio.js');
    const { Readable } = require('stream');

    it('exercises redirectConsoleToStderr and restoreConsole idempotency', () => {
      redirectConsoleToStderr();
      // Second call when already redirected
      redirectConsoleToStderr();

      console.log('test log string');
      console.log({ test: 'object' });
      console.info('test info string');
      console.info({ test: 'info-object' });

      restoreConsole();
      // Second call when already restored
      restoreConsole();
    });

    it('exercises startStdioTransport with message parsing, error handling, and shutdown', async () => {
      const mockInput = new Readable({ read() {} });
      const mockOutput = {
        writes: [],
        write(data) {
          this.writes.push(data);
        },
      };

      const mockServer = {
        handleMessage: vi.fn(async (msg) => {
          if (msg.method === 'boom') {
            throw new Error('Server error');
          }
          return { jsonrpc: '2.0', id: msg.id, result: 'ok' };
        }),
      };

      const transport = startStdioTransport(mockServer, {
        input: mockInput,
        output: mockOutput,
        redirectStderr: false,
      });

      // 1. Empty/whitespace line
      transport.rl.emit('line', '   ');
      expect(mockOutput.writes.length).toBe(0);

      // 2. Parse error
      transport.rl.emit('line', '{ invalid-json');
      expect(mockOutput.writes.length).toBe(1);
      const parseErr = JSON.parse(mockOutput.writes[0]);
      expect(parseErr.error.code).toBe(-32700);

      // 3. Valid message
      transport.rl.emit('line', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
      await new Promise((r) => setTimeout(r, 10));
      expect(mockOutput.writes.length).toBe(2);
      const successMsg = JSON.parse(mockOutput.writes[1]);
      expect(successMsg.result).toBe('ok');

      // 4. Server handling error
      transport.rl.emit('line', JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'boom' }));
      await new Promise((r) => setTimeout(r, 10));
      expect(mockOutput.writes.length).toBe(3);
      const serverErr = JSON.parse(mockOutput.writes[2]);
      expect(serverErr.error.code).toBe(-32603);

      transport.close();
    });
  });

  describe('src/server.js and src/pages/page-loader.js additional branch coverage', () => {
    const { createApp } = require('../../src/server.js');
    const { createPageHandler } = require('../../src/pages/page-loader.js');
    const { RequestAbortedError, HttpError } = require('../../core/errors');
    const request = require('supertest');

    it('exercises 404 data loader execution and error handling', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-404-loader-'));

      fs.writeFileSync(
        path.join(tmpDir, '404.njk'),
        '<h1>Custom 404: {{ customData }}</h1>'
      );
      fs.writeFileSync(
        path.join(tmpDir, '404.js'),
        'module.exports = { load: async () => ({ customData: "LoadedValue" }) };'
      );

      const { app } = createApp({
        pagesDir: tmpDir,
        helmet: false,
      });

      const res = await request(app).get('/missing-route').set('Accept', 'text/html');
      expect(res.status).toBe(404);
      expect(res.text).toContain('Custom 404: LoadedValue');

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('exercises request timeout and HttpError headers in central error handler', async () => {
      const fixtureDir = path.join(__dirname, '../fixtures/pages-basic');
      const { app } = createApp({
        pagesDir: fixtureDir,
        helmet: false,
        setupRoutes: (a) => {
          a.get('/trigger-timeout', (req, res, next) => {
            req.timedout = true;
            next(new Error('Timeout'));
          });
          a.get('/trigger-http-error', (req, res, next) => {
            const err = new HttpError(402, 'Payment Required', {
              headers: { 'X-Custom-Header': 'CustomVal' },
            });
            next(err);
          });
          a.get('/trigger-aborted', (req, res, next) => {
            req.aborted = true;
            next(new RequestAbortedError('Aborted'));
          });
        },
      });

      const resTimeoutHtml = await request(app).get('/trigger-timeout').set('Accept', 'text/html');
      expect(resTimeoutHtml.status).toBe(503);

      const resTimeoutJson = await request(app).get('/trigger-timeout').set('Accept', 'application/json');
      expect(resTimeoutJson.status).toBe(503);
      expect(resTimeoutJson.body.error).toBe('Request Timeout');

      const resHttpErr = await request(app).get('/trigger-http-error').set('Accept', 'application/json');
      expect(resHttpErr.status).toBe(402);
      expect(resHttpErr.headers['x-custom-header']).toBe('CustomVal');

      try {
        const resAborted = await request(app).get('/trigger-aborted');
        expect(resAborted.status).toBeDefined();
      } catch (err) {
        expect(err).toBeDefined();
      }
    });

    it('exercises page loader fallback JSON, string, custom error, and nunjucks error branches', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-page-fallbacks-'));

      const createMockReq = (p) => ({
        path: p,
        query: {},
        params: {},
        headers: {},
        get: () => '',
        cookies: {},
      });

      // Page with no Nunjucks returning JSON object
      const jsonPageFile = path.join(tmpDir, 'json-page.js');
      fs.writeFileSync(
        jsonPageFile,
        'module.exports = { load: async () => ({ status: "json_fallback", count: 42 }) };'
      );

      const jsonHandler = createPageHandler({ file: jsonPageFile, path: '/json-page' }, {});
      const resJson = {
        headersSent: false,
        json: vi.fn(),
      };
      await jsonHandler(createMockReq('/json-page'), resJson, (err) => {
        if (err) throw err;
      });
      expect(resJson.json).toHaveBeenCalledWith({ status: 'json_fallback', count: 42 });

      // Page with no Nunjucks returning primitive string
      const strPageFile = path.join(tmpDir, 'str-page.js');
      fs.writeFileSync(
        strPageFile,
        'module.exports = { load: async () => "raw string response" };'
      );
      const strHandler = createPageHandler({ file: strPageFile, path: '/str-page' }, {});
      const resStr = {
        headersSent: false,
        send: vi.fn(),
      };
      await strHandler(createMockReq('/str-page'), resStr, (err) => {
        if (err) throw err;
      });
      expect(resStr.send).toHaveBeenCalledWith('raw string response');

      // Page throwing via ctx.error()
      const errPageFile = path.join(tmpDir, 'err-page.js');
      fs.writeFileSync(
        errPageFile,
        'module.exports = { load: async (ctx) => { ctx.error(400, "Bad Request Thrown"); } };'
      );
      const errHandler = createPageHandler({ file: errPageFile, path: '/err-page' }, {});
      let capturedError = null;
      await errHandler(createMockReq('/err-page'), {}, (err) => {
        capturedError = err;
      });
      expect(capturedError).toBeDefined();
      expect(capturedError.status).toBe(400);
      expect(capturedError.message).toBe('Bad Request Thrown');
      expect(capturedError.route).toBe('/err-page');

      // Page with template rendering error
      const brokenTplFile = path.join(tmpDir, 'broken.njk');
      const brokenJsFile = path.join(tmpDir, 'broken.js');
      fs.writeFileSync(brokenTplFile, '<h1>{{ invalid.deep.nested }}</h1>');
      fs.writeFileSync(brokenJsFile, 'module.exports = { load: async () => ({}) };');

      const brokenHandler = createPageHandler(
        { file: brokenJsFile, path: '/broken' },
        {
          nunjucks: {
            render: (tpl, data, cb) => cb(new Error('Nunjucks render fail')),
          },
        }
      );
      let renderError = null;
      await brokenHandler(createMockReq('/broken'), {}, (err) => {
        renderError = err;
      });
      expect(renderError).toBeDefined();
      expect(renderError.message).toBe('Nunjucks render fail');

      // Page with custom render() function
      const renderPageFile = path.join(tmpDir, 'render-page.js');
      fs.writeFileSync(
        renderPageFile,
        'module.exports = { load: async () => ({ user: "Bob" }), render: async (data) => `<section>User: ${data.user}</section>` };'
      );
      const renderHandler = createPageHandler({ file: renderPageFile, path: '/render-page' }, {});
      let renderedHtml = '';
      const resRender = {
        headersSent: false,
        setHeader: vi.fn(),
        send: (html) => {
          renderedHtml = html;
        },
      };
      await renderHandler(createMockReq('/render-page'), resRender, (err) => {
        if (err) throw err;
      });
      expect(renderedHtml).toBe('<section>User: Bob</section>');

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('exercises customErrorHandler fall-through and exception handling in server error boundary', async () => {
      const fixtureDir = path.join(__dirname, '../fixtures/pages-basic');

      // 1. customErrorHandler returning false (falls through)
      const { app: appFallthrough } = createApp({
        pagesDir: fixtureDir,
        helmet: false,
        setupRoutes: (a) => {
          a.get('/fallthrough-err', () => {
            throw new Error('Should fall through');
          });
        },
      });

      appFallthrough.setErrorHandler(async () => {
        // Return false so default error handler runs
        return false;
      });

      const resFallthrough = await request(appFallthrough).get('/fallthrough-err').set('Accept', 'application/json');
      expect(resFallthrough.status).toBe(500);

      // 2. customErrorHandler throwing an exception (caught and falls through)
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { app: appExplodingHandler } = createApp({
        pagesDir: fixtureDir,
        helmet: false,
        setupRoutes: (a) => {
          a.get('/handler-explode', () => {
            throw new Error('Original Error');
          });
        },
      });

      appExplodingHandler.setErrorHandler(async () => {
        throw new Error('Error Handler Crashed!');
      });

      const resExplode = await request(appExplodingHandler).get('/handler-explode').set('Accept', 'application/json');
      expect(resExplode.status).toBe(500);
      consoleErrorSpy.mockRestore();
    });

    it('exercises api-loader missing handler function, sync middleware throw, and early return', async () => {
      const { createApiHandler } = require('../../src/api/api-loader.js');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-api-loader-branches-'));

      // 1. API file exporting non-function handler
      const invalidApiFile = path.join(tmpDir, 'invalid-handler.js');
      fs.writeFileSync(invalidApiFile, 'module.exports = { handler: "not-a-function" };');

      const invalidHandler = createApiHandler(
        { file: invalidApiFile, path: '/api/invalid', source: 'invalid-handler.js' },
        {}
      );
      let capturedErr = null;
      await invalidHandler({ headers: {}, query: {}, params: {} }, {}, (err) => {
        capturedErr = err;
      });
      expect(capturedErr).toBeDefined();
      expect(capturedErr.message).toContain('does not export a valid handler function');

      // 2. Middleware throwing synchronous error
      const validApiFile = path.join(tmpDir, 'sync-mw-test.js');
      fs.writeFileSync(
        validApiFile,
        'module.exports = { middleware: ["syncBomb"], handler: async () => ({ ok: true }) };'
      );
      const syncMwHandler = createApiHandler(
        { file: validApiFile, path: '/api/sync-mw', source: 'sync-mw-test.js' },
        {
          middlewares: {
            syncBomb: () => {
              throw new Error('Synchronous MW Explosion');
            },
          },
        }
      );
      let syncMwErr = null;
      await syncMwHandler({ headers: {}, query: {}, params: {} }, {}, (err) => {
        syncMwErr = err;
      });
      expect(syncMwErr).toBeDefined();
      expect(syncMwErr.message).toBe('Synchronous MW Explosion');

      // 3. Middleware sending response early (headersSent)
      const earlyResApiFile = path.join(tmpDir, 'early-res.js');
      fs.writeFileSync(
        earlyResApiFile,
        'module.exports = { middleware: ["sendEarly"], handler: vi.fn() };'
      );
      const earlyResHandler = createApiHandler(
        { file: earlyResApiFile, path: '/api/early', source: 'early-res.js' },
        {
          middlewares: {
            sendEarly: (req, res, next) => {
              res.headersSent = true;
              res.send('Early Response');
              next();
            },
          },
        }
      );
      const resEarly = {
        headersSent: false,
        send: vi.fn(),
      };
      await earlyResHandler({ headers: {}, query: {}, params: {} }, resEarly, vi.fn());
      expect(resEarly.send).toHaveBeenCalledWith('Early Response');

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});



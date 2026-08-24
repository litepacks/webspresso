const {
  preferJsonErrorResponse,
  renderDefaultErrorHtml,
  createCentralErrorHandler,
} = require('../../core/errors/middleware');
const {
  HttpError,
  NotFoundError,
  ValidationError,
  RequestAbortedError,
} = require('../../core/errors');

describe('Central Error Handler Middleware (core/errors/middleware)', () => {
  describe('preferJsonErrorResponse', () => {
    it('should return true for /api/ and /_admin/api/ routes', () => {
      expect(preferJsonErrorResponse({ path: '/api/users', headers: {} })).toBe(true);
      expect(preferJsonErrorResponse({ path: '/_admin/api/posts', headers: {} })).toBe(true);
    });

    it('should return true when Accept header includes application/json without text/html', () => {
      expect(preferJsonErrorResponse({ path: '/catalog', headers: { accept: 'application/json, text/plain' } })).toBe(true);
      expect(preferJsonErrorResponse({ path: '/catalog', headers: { accept: 'text/html, application/json' } })).toBe(false);
    });

    it('should return true for XHR requests', () => {
      expect(preferJsonErrorResponse({ path: '/contact', headers: {}, xhr: true })).toBe(true);
      expect(preferJsonErrorResponse({ path: '/contact', headers: { 'x-requested-with': 'XMLHttpRequest' } })).toBe(true);
      expect(preferJsonErrorResponse({ path: '/contact', headers: {} })).toBe(false);
    });
  });

  describe('renderDefaultErrorHtml', () => {
    it('should render HTML with escaped messages in production without stack traces', () => {
      const err = new Error('<script>alert("xss")</script>');
      err.status = 500;
      err.expose = false;

      const html = renderDefaultErrorHtml(err, false);
      expect(html).toContain('Error 500');
      expect(html).toContain('Internal Server Error');
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('at renderDefaultErrorHtml');
    });

    it('should render stack traces and exposed messages in development mode', () => {
      const err = new NotFoundError('Custom page not found');
      const html = renderDefaultErrorHtml(err, true);

      expect(html).toContain('404');
      expect(html).toContain('Custom page not found');
      expect(html).toContain('<pre style=');
    });
  });

  describe('createCentralErrorHandler', () => {
    function createMockRes() {
      const res = {
        statusCode: 200,
        headers: {},
        headersSent: false,
        body: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        setHeader(k, v) {
          this.headers[k.toLowerCase()] = v;
          return this;
        },
        json(data) {
          this.body = data;
          this.headersSent = true;
          return this;
        },
        send(data) {
          this.body = data;
          this.headersSent = true;
          return this;
        },
      };
      return res;
    }

    it('should delegate to next(err) if res.headersSent is true', async () => {
      const handler = createCentralErrorHandler();
      const res = createMockRes();
      res.headersSent = true;
      let nextCalledWith = null;

      await handler(new Error('Boom'), { path: '/test', headers: {} }, res, (err) => {
        nextCalledWith = err;
      });

      expect(nextCalledWith).not.toBeNull();
      expect(nextCalledWith.message).toBe('Boom');
    });

    it('should not write to socket if RequestAbortedError or socket destroyed', async () => {
      const handler = createCentralErrorHandler();
      const res = createMockRes();
      const req = { path: '/test', headers: {}, socket: { destroyed: true } };

      await handler(new RequestAbortedError(), req, res, () => {});
      expect(res.headersSent).toBe(false);
      expect(res.body).toBeNull();
    });

    it('should attach custom headers from HttpError', async () => {
      const handler = createCentralErrorHandler();
      const res = createMockRes();
      const req = { path: '/api/item', headers: {} };

      const err = new HttpError(429, 'Rate limit exceeded', {
        headers: { 'Retry-After': '120', 'X-RateLimit': '0' },
      });

      await handler(err, req, res, () => {});

      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBe('120');
      expect(res.headers['x-ratelimit']).toBe('0');
      expect(res.body.status).toBe(429);
    });

    it('should call customErrorHandler if registered and handle response', async () => {
      let customCalled = false;
      const handler = createCentralErrorHandler({
        getCustomHandler: () => (err, req, res) => {
          customCalled = true;
          res.status(418).json({ custom: true });
          return true;
        },
      });

      const res = createMockRes();
      await handler(new Error('Tea'), { path: '/api/tea', headers: {} }, res, () => {});

      expect(customCalled).toBe(true);
      expect(res.statusCode).toBe(418);
      expect(res.body.custom).toBe(true);
    });

    it('should safely fall back if customErrorHandler throws', async () => {
      const handler = createCentralErrorHandler({
        getCustomHandler: () => () => {
          throw new Error('Custom handler crashed');
        },
      });

      const res = createMockRes();
      await handler(new Error('Original error'), { path: '/api/data', headers: {} }, res, () => {});

      expect(res.statusCode).toBe(500);
      expect(res.body.error).toBe('Internal Server Error');
    });

    it('should call renderHtmlError and send custom HTML error template', async () => {
      const handler = createCentralErrorHandler({
        renderHtmlError: async (err, req, res) => {
          return `<div id="custom-404">${err.status}</div>`;
        },
      });

      const res = createMockRes();
      await handler(new NotFoundError('Not here'), { path: '/missing', headers: {} }, res, () => {});

      expect(res.statusCode).toBe(404);
      expect(res.body).toBe('<div id="custom-404">404</div>');
    });

    it('should fall back to default HTML if renderHtmlError throws', async () => {
      const handler = createCentralErrorHandler({
        renderHtmlError: async () => {
          throw new Error('Template render crashed');
        },
      });

      const res = createMockRes();
      await handler(new NotFoundError('Not here'), { path: '/missing', headers: {} }, res, () => {});

      expect(res.statusCode).toBe(404);
      expect(res.body).toContain('Error 404');
    });
  });
});

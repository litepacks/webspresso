const {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockReq,
  createMockRes,
} = require('../utils/http');

describe('Test Utilities - HTTP Mocks (Step 1)', () => {
  describe('createMockRequest / createMockReq', () => {
    it('creates request with standard defaults', () => {
      const req = createMockRequest();
      expect(req.method).toBe('GET');
      expect(req.path).toBe('/');
      expect(req.url).toBe('/');
      expect(req.originalUrl).toBe('/');
      expect(req.headers).toEqual({});
      expect(req.query).toEqual({});
      expect(req.params).toEqual({});
      expect(req.body).toEqual({});
      expect(req.ip).toBe('127.0.0.1');
      expect(req.protocol).toBe('http');
      expect(req.secure).toBe(false);
      expect(req.auth).toBeNull();
      expect(req.user).toBeNull();
    });

    it('normalizes header names to lowercase and provides getter helpers', () => {
      const req = createMockReq({
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
          Accept: 'text/html, application/json',
        },
      });

      expect(req.get('content-type')).toBe('application/json');
      expect(req.get('Content-Type')).toBe('application/json');
      expect(req.header('authorization')).toBe('Bearer test-token');
      expect(req.get('non-existent')).toBeNull();

      expect(req.accepts('json')).toBe(true);
      expect(req.accepts('xml')).toBe(false);
      expect(req.is('json')).toBe(true);
      expect(req.is('xml')).toBe(false);
    });

    it('populates Webspresso input container from body, query, params', () => {
      const req = createMockReq({
        body: { title: 'Hello' },
        query: { sort: 'asc' },
        params: { id: '42' },
      });

      expect(req.input.body).toEqual({ title: 'Hello' });
      expect(req.input.query).toEqual({ sort: 'asc' });
      expect(req.input.params).toEqual({ id: '42' });
    });

    it('supports custom context services, queues, and db overrides', () => {
      const mockDb = { getRepository: vi.fn() };
      const mockService = vi.fn();
      const mockQueue = { dispatch: vi.fn() };

      const req = createMockReq({
        db: mockDb,
        service: mockService,
        queue: mockQueue,
      });

      expect(req.db).toBe(mockDb);
      expect(req.service).toBe(mockService);
      expect(req.queue).toBe(mockQueue);
    });
  });

  describe('createMockResponse / createMockRes', () => {
    it('creates response with standard defaults and supports status chaining', () => {
      const res = createMockRes();
      expect(res.statusCode).toBe(200);
      expect(res.headersSent).toBe(false);
      expect(res._ended).toBe(false);

      const chained = res.status(201);
      expect(chained).toBe(res);
      expect(res.statusCode).toBe(201);
    });

    it('records json output in body, payload, data, jsonData, and _json', async () => {
      const res = createMockRes();
      res.json({ success: true, count: 5 });

      expect(res.headers['content-type']).toBe('application/json');
      expect(res.jsonData).toEqual({ success: true, count: 5 });
      expect(res.data).toEqual({ success: true, count: 5 });
      expect(res.payload).toEqual({ success: true, count: 5 });
      expect(res._json).toEqual({ success: true, count: 5 });
      expect(res.body).toEqual({ success: true, count: 5 });
      expect(res._ended).toBe(true);
      expect(res.headersSent).toBe(true);
      await expect(res.done).resolves.toBe(res);
    });

    it('handles headers via set, setHeader, getHeader, hasHeader, removeHeader, getHeaders', () => {
      const res = createMockRes();
      res.setHeader('X-Custom-Header', 'custom-value');
      res.set({ 'X-Another': '123' });

      expect(res.getHeader('x-custom-header')).toBe('custom-value');
      expect(res.getHeader('X-Custom-Header')).toBe('custom-value');
      expect(res.hasHeader('x-another')).toBe(true);
      expect(res.hasHeader('X-Another')).toBe(true);
      expect(res.hasHeader('missing')).toBe(false);

      expect(res.getHeaders()).toEqual({
        'x-custom-header': 'custom-value',
        'x-another': '123',
      });

      res.removeHeader('X-Another');
      expect(res.hasHeader('x-another')).toBe(false);
    });

    it('handles writeHead and end', () => {
      const res = createMockRes();
      res.writeHead(404, { 'X-Error': 'not-found' });
      res.end('Not found body');

      expect(res.statusCode).toBe(404);
      expect(res.getHeader('x-error')).toBe('not-found');
      expect(res.body).toBe('Not found body');
      expect(res._ended).toBe(true);
      expect(res.headersSent).toBe(true);
    });

    it('handles sendStatus', () => {
      const res = createMockRes();
      res.sendStatus(204);

      expect(res.statusCode).toBe(204);
      expect(res._ended).toBe(true);
      expect(res.headersSent).toBe(true);
    });

    it('handles redirect with 1 or 2 parameters', () => {
      const res1 = createMockRes();
      res1.redirect('/login');
      expect(res1.statusCode).toBe(302);
      expect(res1.redirectUrl).toBe('/login');
      expect(res1.headers['location']).toBe('/login');
      expect(res1._ended).toBe(true);

      const res2 = createMockRes();
      res2.redirect(301, '/permanent');
      expect(res2.statusCode).toBe(301);
      expect(res2.redirectUrl).toBe('/permanent');
      expect(res2.headers['location']).toBe('/permanent');
    });

    it('handles cookie and clearCookie', () => {
      const res = createMockRes();
      res.cookie('token', 'xyz', { httpOnly: true, secure: true });
      expect(res.cookies['token']).toEqual({
        value: 'xyz',
        options: { httpOnly: true, secure: true },
      });

      res.clearCookie('token');
      expect(res.cookies['token']).toBeUndefined();
      expect(res._clearedCookies['token']).toEqual({});
    });

    it('handles render with callback', () => {
      const res = createMockRes();
      let cbCalled = false;
      res.render('profile.njk', { name: 'Ahmet' }, (err, html) => {
        cbCalled = true;
        expect(err).toBeNull();
        expect(html).toBe('<html></html>');
      });

      expect(res.renderedView).toBe('profile.njk');
      expect(res.renderedData).toEqual({ name: 'Ahmet' });
      expect(cbCalled).toBe(true);
    });

    it('handles events with on and emit', () => {
      const res = createMockRes();
      let finished = false;
      res.on('finish', () => {
        finished = true;
      });

      res.emit('finish');
      expect(finished).toBe(true);
    });

    it('wraps terminal methods in Vitest spies when spy: true is specified', () => {
      const res = createMockRes({ spy: true });
      res.status(200).json({ ok: true });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
      expect(res.statusCode).toBe(200);
      expect(res.jsonData).toEqual({ ok: true });
    });
  });

  describe('createMockNext', () => {
    it('tracks whether it was called and what error was passed', () => {
      const next = createMockNext();
      expect(next.called).toBe(false);
      expect(next.callCount).toBe(0);
      expect(next.error).toBeNull();

      next();
      expect(next.called).toBe(true);
      expect(next.callCount).toBe(1);
      expect(next.error).toBeNull();

      const testError = new Error('route failed');
      next(testError);
      expect(next.callCount).toBe(2);
      expect(next.error).toBe(testError);
    });

    it('supports spy: true wrapping for Vitest assertion', () => {
      const next = createMockNext({ spy: true });
      next('err');
      expect(next).toHaveBeenCalledWith('err');
      expect(next.called).toBe(true);
      expect(next.error).toBe('err');
    });
  });
});

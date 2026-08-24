const { createRecaptchaMiddleware } = require('../../plugins/recaptcha/middleware');

describe('reCAPTCHA Express Middleware (plugins/recaptcha/middleware)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should throw if secret is missing', () => {
    expect(() => createRecaptchaMiddleware({})).toThrow('requires options.secret');
  });

  it('should reject request when verification fails and return 400 with error codes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: false, 'error-codes': ['invalid-input-response'] }),
      })
    );

    const middleware = createRecaptchaMiddleware({
      secret: 'dummy-secret',
    });

    const req = {
      body: { 'g-recaptcha-response': 'bad-token' },
      headers: {},
    };

    let statusCode = 200;
    let jsonBody = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        jsonBody = data;
        return this;
      },
    };

    let nextCalled = false;
    await middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(400);
    expect(jsonBody.error).toContain('failed');
    expect(jsonBody.codes).toEqual(['invalid-input-response']);
  });

  it('should attach result to req.recaptcha and call next() on mock success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, hostname: 'example.com' }),
      })
    );

    const middleware = createRecaptchaMiddleware({
      secret: 'valid-secret',
      bodyField: 'captcha_token',
    });

    const req = {
      body: { captcha_token: 'valid-token' },
      headers: { 'x-forwarded-for': '127.0.0.1' },
    };

    let statusCode = 200;
    let jsonBody = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        jsonBody = data;
        return this;
      },
    };

    let nextCalled = false;
    await middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(statusCode).toBe(200);
    expect(req.recaptcha).toBeDefined();
    expect(req.recaptcha.success).toBe(true);
    expect(req.recaptcha.hostname).toBe('example.com');
  });
});

/**
 * reCAPTCHA plugin exports — resolveRecaptchaMiddlewareParams
 */
const {
  resolveRecaptchaMiddlewareParams,
  createRecaptchaMiddleware,
} = require('../../../plugins/recaptcha');

describe('resolveRecaptchaMiddlewareParams', () => {
  it('maps plugin-style options to middleware params', () => {
    const p = resolveRecaptchaMiddlewareParams({
      secretKey: 'sec',
      version: 'v3',
      minScore: 0.7,
      expectedAction: 'login',
    });
    expect(p.secret).toBe('sec');
    expect(p.version).toBe('v3');
    expect(p.minScore).toBe(0.7);
    expect(p.expectedAction).toBe('login');
  });

  it('defaults version to v2', () => {
    const p = resolveRecaptchaMiddlewareParams({ secretKey: 'x' });
    expect(p.version).toBe('v2');
  });
});

describe('createRecaptchaMiddleware + resolve spread', () => {
  it('builds middleware from spread params', () => {
    const mw = createRecaptchaMiddleware({
      ...resolveRecaptchaMiddlewareParams({ secretKey: 's', version: 'v2' }),
      bodyField: 'g-recaptcha-response',
    });
    expect(typeof mw).toBe('function');
  });

  it('recaptchaPlugin.register adds named middleware to ctx.middlewares', () => {
    const { recaptchaPlugin } = require('../../../plugins/recaptcha');
    const p = recaptchaPlugin({ siteKey: 'dummySiteKey', secretKey: 'dummySecretKey' });
    const middlewares = {};
    const helpers = new Map();
    p.register({
      middlewares,
      addHelper: (k, v) => helpers.set(k, v),
    });

    expect(typeof middlewares.recaptcha).toBe('function');
    const mw = middlewares.recaptcha();
    expect(typeof mw).toBe('function');
  });
});

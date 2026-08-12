const crypto = require('crypto');
const request = require('supertest');
const express = require('express');
const session = require('express-session');
const nunjucks = require('nunjucks');
const csrfPlugin = require('../../plugins/csrf');

describe('CSRF Plugin', () => {
  let app;
  let env;
  let middlewares;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Set up sessions for session tests
    app.use(
      session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: true,
        cookie: {
          secure: process.env.NODE_ENV === 'production',
          httpOnly: true,
          sameSite: 'lax',
        },
      })
    );

    // Mock Nunjucks env
    env = nunjucks.configure({ autoescape: true });
    middlewares = {};
  });

  it('should register named route middleware and Nunjucks helpers', () => {
    const plugin = csrfPlugin();
    const mockCtx = {
      app,
      nunjucksEnv: env,
      middlewares,
      addHelper: vi.fn(),
    };

    plugin.register(mockCtx);

    expect(mockCtx.addHelper).toHaveBeenCalledWith('csrfToken', expect.any(Function));
    expect(mockCtx.addHelper).toHaveBeenCalledWith('csrfInput', expect.any(Function));
    expect(mockCtx.middlewares.csrf).toBeDefined();
  });

  it('should block mutating requests without CSRF token in session mode', async () => {
    const plugin = csrfPlugin();
    const mockCtx = {
      app,
      nunjucksEnv: env,
      middlewares,
      addHelper: () => {},
    };
    plugin.register(mockCtx);

    // Apply the CSRF middleware on POST route
    app.post('/test', mockCtx.middlewares.csrf(), (req, res) => {
      res.status(200).send('success');
    });

    // Request without token should fail
    await request(app)
      .post('/test')
      .expect(403);
  });

  it('should allow mutating requests with a valid token in session mode', async () => {
    const plugin = csrfPlugin();
    const mockCtx = {
      app,
      nunjucksEnv: env,
      middlewares,
      addHelper: () => {},
    };
    plugin.register(mockCtx);

    // Route that generates the token (GET) and renders it
    app.get('/form', mockCtx.middlewares.csrf(), (req, res) => {
      res.send({ token: req.csrfToken() });
    });

    app.post('/submit', mockCtx.middlewares.csrf(), (req, res) => {
      res.send('success');
    });

    const agent = request.agent(app);

    // 1. Get token
    const resGet = await agent.get('/form').expect(200);
    const token = resGet.body.token;
    expect(token).toBeDefined();

    // 2. Submit token in body
    await agent
      .post('/submit')
      .send({ _csrf: token })
      .expect(200, 'success');

    // 3. Submit token in headers
    await agent
      .post('/submit')
      .set('x-csrf-token', token)
      .expect(200, 'success');
  });

  it('should fallback to cookies if session is not present or explicitly requested', async () => {
    const appNoSession = express();
    appNoSession.use(express.json());

    const plugin = csrfPlugin({ cookie: true });
    const mockCtx = {
      app: appNoSession,
      nunjucksEnv: env,
      middlewares,
      addHelper: () => {},
    };
    plugin.register(mockCtx);

    appNoSession.get('/form', mockCtx.middlewares.csrf(), (req, res) => {
      res.send({ token: req.csrfToken() });
    });

    appNoSession.post('/submit', mockCtx.middlewares.csrf(), (req, res) => {
      res.send('success');
    });

    const agent = request.agent(appNoSession);

    // 1. Get token (sets cookie)
    const resGet = await agent.get('/form').expect(200);
    const token = resGet.body.token;

    // Verify cookie was set
    const cookies = resGet.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toContain('_csrf=');

    // 2. Submit without token - should fail
    await agent.post('/submit').expect(403);

    // 3. Submit with token - should succeed
    await agent
      .post('/submit')
      .send({ _csrf: token })
      .expect(200, 'success');
  });

  it('should ignore validation for paths listed in ignorePaths', async () => {
    const plugin = csrfPlugin({
      ignorePaths: ['/api/webhook', /^\/ignored-regex/],
    });
    const mockCtx = {
      app,
      nunjucksEnv: env,
      middlewares,
      addHelper: () => {},
    };
    plugin.register(mockCtx);

    app.post('/api/webhook', mockCtx.middlewares.csrf(), (req, res) => {
      res.send('webhook-success');
    });
    app.post('/ignored-regex/some-subpath', mockCtx.middlewares.csrf(), (req, res) => {
      res.send('regex-success');
    });

    await request(app)
      .post('/api/webhook')
      .expect(200, 'webhook-success');

    await request(app)
      .post('/ignored-regex/some-subpath')
      .expect(200, 'regex-success');
  });

  it('should support dynamic template helper rendering', async () => {
    const plugin = csrfPlugin();
    const registeredHelpers = {};
    const mockCtx = {
      app,
      nunjucksEnv: env,
      middlewares,
      addHelper: (name, fn) => {
        registeredHelpers[name] = fn;
      },
    };
    plugin.register(mockCtx);

    app.get('/render', mockCtx.middlewares.csrf(), (req, res) => {
      // Build render context mimicking webspresso file-router
      const context = {
        fsy: {
          csrfToken: registeredHelpers.csrfToken,
          csrfInput: registeredHelpers.csrfInput,
        },
      };

      const resultToken = context.fsy.csrfToken();
      const resultInput = context.fsy.csrfInput();

      res.send({
        token: resultToken,
        input: String(resultInput),
      });
    });

    const res = await request(app).get('/render').expect(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.input).toContain('<input type="hidden" name="_csrf"');
    expect(res.body.input).toContain(res.body.token);
  });
});

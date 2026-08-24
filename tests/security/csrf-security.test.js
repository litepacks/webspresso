const request = require('supertest');
const express = require('express');
const session = require('express-session');
const csrfPlugin = require('../../plugins/csrf');

describe('Security: CSRF Plugin Security', () => {
  it('should block mutating requests (POST, PUT, DELETE, PATCH) when token is missing', async () => {
    const app = express();
    app.use(session({ secret: 'sec-secret', resave: false, saveUninitialized: true }));
    app.use(express.json());

    const plugin = csrfPlugin({ global: true });
    plugin.register({ app, addHelper: () => {}, middlewares: {} });

    app.post('/api/action', (req, res) => res.json({ success: true }));
    app.put('/api/action', (req, res) => res.json({ success: true }));
    app.delete('/api/action', (req, res) => res.json({ success: true }));
    app.patch('/api/action', (req, res) => res.json({ success: true }));

    await request(app).post('/api/action').expect(403);
    await request(app).put('/api/action').expect(403);
    await request(app).delete('/api/action').expect(403);
    await request(app).patch('/api/action').expect(403);
  });

  it('should reject invalid / forged tokens', async () => {
    const app = express();
    app.use(session({ secret: 'sec-secret', resave: false, saveUninitialized: true }));
    app.use(express.json());

    const plugin = csrfPlugin({ global: true });
    plugin.register({ app, addHelper: () => {}, middlewares: {} });

    app.post('/api/action', (req, res) => res.json({ success: true }));

    await request(app)
      .post('/api/action')
      .set('X-CSRF-Token', 'forged-token-value-12345')
      .expect(403);
  });

  it('should accept valid tokens in header or body and allow state-changing operations', async () => {
    const app = express();
    app.use(session({ secret: 'sec-secret', resave: false, saveUninitialized: true }));
    app.use(express.json());

    const plugin = csrfPlugin({ global: true });
    plugin.register({ app, addHelper: () => {}, middlewares: {} });

    app.get('/api/token', (req, res) => {
      res.json({ token: req.csrfToken() });
    });
    app.post('/api/action', (req, res) => res.json({ success: true }));

    const agent = request.agent(app);
    const tokenRes = await agent.get('/api/token').expect(200);
    const token = tokenRes.body.token;
    expect(token).toBeDefined();

    // Valid header
    await agent
      .post('/api/action')
      .set('X-CSRF-Token', token)
      .send({})
      .expect(200);

    // Valid body
    await agent
      .post('/api/action')
      .send({ _csrf: token })
      .expect(200);
  });
});

/**
 * compat-app unit tests
 */

const { request } = require('../../helpers/http');
const { createCompatApp } = require('../../../src/http/compat-app');

describe('createCompatApp', () => {
  it('mountBodyParsers parses JSON and form bodies', async () => {
    const app = createCompatApp({ cookieSecret: 'test-secret-32-chars-minimum!!' });
    app.mountBodyParsers();
    app.post('/echo', (req, res) => res.json(req.body));

    const jsonRes = await request(app)
      .post('/echo')
      .send({ a: 1 })
      .set('Content-Type', 'application/json')
      .expect(200);
    expect(jsonRes.body.a).toBe(1);

    const formRes = await request(app)
      .post('/echo')
      .send('x=1')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .expect(200);
    expect(formRes.body.x).toBe('1');
  });

  it('mountBodyParsers tolerates invalid JSON', async () => {
    const app = createCompatApp({ cookieSecret: 'test-secret-32-chars-minimum!!' });
    app.mountBodyParsers();
    app.post('/echo', (req, res) => res.json(req.body || {}));

    const res = await request(app)
      .post('/echo')
      .send('{bad')
      .set('Content-Type', 'application/json')
      .expect(200);
    expect(res.body).toEqual({});
  });

  it('mountTimeout sets timedout flag', async () => {
    const app = createCompatApp({ cookieSecret: 'test-secret-32-chars-minimum!!' });
    app.mountTimeout(50);
    app.mountHaltOnTimedout();
    app.get('/slow', async (req, res) => {
      await new Promise((r) => setTimeout(r, 200));
      res.json({ timedout: !!req.timedout });
    });

    const res = await request(app).get('/slow').expect(200);
    expect(res.body.timedout).toBe(true);
  });

  it('supports app.all and custom notFound/onError', async () => {
    const app = createCompatApp({ cookieSecret: 'test-secret-32-chars-minimum!!' });
    app.all('/any', (req, res) => res.json({ method: req.method }));
    app.notFound((c) => c.json({ nf: true }, 404));
    app.onError((c, err) => c.json({ err: err.message }, 500));
    app.get('/boom', () => {
      throw new Error('kaput');
    });

    await request(app).post('/any').expect(200);
    const nf = await request(app).get('/missing').expect(404);
    expect(nf.body.nf).toBe(true);
    const err = await request(app).get('/boom').expect(500);
    expect(err.body.err).toBe('kaput');
  });

  it('useSecureHeaders applies and removes headers', async () => {
    const app = createCompatApp({ cookieSecret: 'test-secret-32-chars-minimum!!' });
    app.useSecureHeaders({ 'X-Test': 'yes', 'X-Remove': '' });
    app.get('/hdr', (req, res) => res.send('ok'));

    const res = await request(app).get('/hdr').expect(200);
    expect(res.headers['x-test']).toBe('yes');
    expect(res.headers['x-remove']).toBeUndefined();
  });
});

/**
 * HTTP context adapter (buildReq / compat response)
 */

const { Hono } = require('hono');
const { buildReq, createCompatResponse } = require('../../../src/http/context');

describe('http/context', () => {
  it('buildReq parses nested query via qs', async () => {
    const app = new Hono();
    app.get('/search', (c) => {
      const req = buildReq(c);
      return c.json({
        filter: req.query.filter,
        page: req.query.page,
      });
    });
    const res = await app.request('http://127.0.0.1/search?filter[name][op]=equals&page=2');
    const body = await res.json();
    expect(body.filter).toEqual({ name: { op: 'equals' } });
    expect(body.page).toBe('2');
  });

  it('createCompatResponse redirect defaults to 302', async () => {
    const app = new Hono();
    app.get('/go', async (c) => {
      const res = createCompatResponse(c);
      await res.redirect('/home');
      const ret = c.get('compatReturnValue');
      return ret;
    });
    const res = await app.request('http://127.0.0.1/go');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/home');
  });

  it('buildReq accepts() treats missing Accept as html', async () => {
    const app = new Hono();
    app.get('/accept', (c) => {
      const req = buildReq(c);
      return c.json({ html: req.accepts('html'), json: req.accepts('json') });
    });
    const res = await app.request('http://127.0.0.1/accept');
    const body = await res.json();
    expect(body.html).toBe(true);
    expect(body.json).toBe(false);
  });

  it('createCompatResponse preserves application/xml for string bodies', async () => {
    const app = new Hono();
    app.get('/xml', async (c) => {
      const res = createCompatResponse(c);
      res.type('application/xml');
      await res.send('<?xml version="1.0"?><root/>');
      return c.get('compatReturnValue');
    });
    const res = await app.request('http://127.0.0.1/xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/xml/);
    expect(await res.text()).toContain('<?xml');
  });
});

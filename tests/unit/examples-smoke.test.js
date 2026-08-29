/**
 * @vitest-environment node
 */
const request = require('supertest');
const app = require('../../examples/basic-ssr/server');

describe('examples/basic-ssr smoke test', () => {
  it('should render the SSR homepage with loader data', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('Welcome to Webspresso SSR!');
    expect(res.text).toContain('Server Time:');
  });

  it('should respond with JSON on /api/health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('uptime');
  });
});

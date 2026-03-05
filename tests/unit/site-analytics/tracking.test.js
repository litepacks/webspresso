/**
 * Tracking Middleware Unit Tests
 */
const { createTrackingMiddleware } = require('../../../plugins/site-analytics/tracking');

describe('Tracking Middleware', () => {
  let knex;
  let inserted;

  beforeEach(async () => {
    inserted = [];

    knex = {
      client: { config: { client: 'better-sqlite3' } },
      schema: {
        hasTable: vi.fn().mockResolvedValue(true),
        createTable: vi.fn().mockResolvedValue(undefined),
      },
      fn: { now: () => 'NOW()' },
    };

    const chainable = {
      insert: vi.fn((data) => {
        const rows = Array.isArray(data) ? data : [data];
        inserted.push(...rows);
        return Promise.resolve([rows.length]);
      }),
    };
    knex.__chainable = chainable;

    // knex(tableName) returns the chainable
    const knexFn = (tableName) => chainable;
    Object.assign(knexFn, knex);
    knex = knexFn;
    knex.client = { config: { client: 'better-sqlite3' } };
    knex.schema = {
      hasTable: vi.fn().mockResolvedValue(true),
      createTable: vi.fn().mockResolvedValue(undefined),
    };
    knex.fn = { now: () => 'NOW()' };
  });

  function mockReq(overrides = {}) {
    return {
      method: 'GET',
      path: '/some-page',
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
      headers: {
        'user-agent': 'Mozilla/5.0 Chrome/120',
        ...overrides.headers,
      },
      ...overrides,
    };
  }

  const trackingOpts = (opts = {}) => ({ knex, batchSize: 1, flushIntervalMs: 10, ...opts });

  it('should call next() immediately (non-blocking)', async () => {
    const middleware = createTrackingMiddleware(trackingOpts());
    const next = vi.fn();
    const req = mockReq();

    await middleware(req, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('should skip non-GET requests', async () => {
    const middleware = createTrackingMiddleware(trackingOpts());
    const next = vi.fn();
    const req = mockReq({ method: 'POST' });

    await middleware(req, {}, next);
    // Give async code time to execute
    await new Promise(r => setTimeout(r, 50));
    expect(inserted.length).toBe(0);
  });

  it('should skip static file extensions', async () => {
    const middleware = createTrackingMiddleware(trackingOpts());
    const next = vi.fn();

    for (const ext of ['.js', '.css', '.png', '.jpg', '.ico', '.woff2', '.svg']) {
      await middleware(mockReq({ path: '/assets/file' + ext }), {}, next);
    }
    await new Promise(r => setTimeout(r, 50));
    expect(inserted.length).toBe(0);
  });

  it('should skip admin paths by default', async () => {
    const middleware = createTrackingMiddleware(trackingOpts());
    const next = vi.fn();

    await middleware(mockReq({ path: '/_admin/dashboard' }), {}, next);
    await new Promise(r => setTimeout(r, 50));
    expect(inserted.length).toBe(0);
  });

  it('should skip API paths by default', async () => {
    const middleware = createTrackingMiddleware(trackingOpts());
    const next = vi.fn();

    await middleware(mockReq({ path: '/api/users' }), {}, next);
    await new Promise(r => setTimeout(r, 50));
    expect(inserted.length).toBe(0);
  });

  it('should skip custom excludePaths', async () => {
    const middleware = createTrackingMiddleware(trackingOpts({ excludePaths: ['/health', '/robots'] }));
    const next = vi.fn();

    await middleware(mockReq({ path: '/health' }), {}, next);
    await middleware(mockReq({ path: '/robots.txt' }), {}, next);
    await new Promise(r => setTimeout(r, 50));
    expect(inserted.length).toBe(0);
  });

  it('should record a page view for valid GET request', async () => {
    const middleware = createTrackingMiddleware(trackingOpts());
    const next = vi.fn();
    const req = mockReq({ path: '/blog/hello' });

    await middleware(req, {}, next);
    await new Promise(r => setTimeout(r, 100));

    expect(inserted.length).toBe(1);
    expect(inserted[0].path).toBe('/blog/hello');
    expect(inserted[0].is_bot).toBe(false);
    expect(inserted[0].visitor_id).toBeTruthy();
    expect(inserted[0].session_id).toBeTruthy();
    expect(inserted[0].ip_hash).toBeTruthy();
  });

  it('should detect bots and set is_bot and bot_name', async () => {
    const middleware = createTrackingMiddleware(trackingOpts());
    const next = vi.fn();
    const req = mockReq({
      path: '/page',
      headers: { 'user-agent': 'Googlebot/2.1' },
    });

    await middleware(req, {}, next);
    await new Promise(r => setTimeout(r, 100));

    expect(inserted.length).toBe(1);
    expect(inserted[0].is_bot).toBe(true);
    expect(inserted[0].bot_name).toBe('Google');
  });

  it('should skip bots when trackBots is false', async () => {
    const middleware = createTrackingMiddleware(trackingOpts({ trackBots: false }));
    const next = vi.fn();
    const req = mockReq({
      path: '/page',
      headers: { 'user-agent': 'Googlebot/2.1' },
    });

    await middleware(req, {}, next);
    await new Promise(r => setTimeout(r, 100));
    expect(inserted.length).toBe(0);
  });

  it('should detect country from headers', async () => {
    const middleware = createTrackingMiddleware(trackingOpts());
    const next = vi.fn();
    const req = mockReq({
      path: '/page',
      headers: {
        'user-agent': 'Chrome/120',
        'cf-ipcountry': 'TR',
      },
    });

    await middleware(req, {}, next);
    await new Promise(r => setTimeout(r, 100));

    expect(inserted.length).toBe(1);
    expect(inserted[0].country).toBe('TR');
  });

  it('should hash IP address (not store raw IP)', async () => {
    const middleware = createTrackingMiddleware(trackingOpts());
    const next = vi.fn();
    const req = mockReq({ path: '/page', ip: '192.168.1.100' });

    await middleware(req, {}, next);
    await new Promise(r => setTimeout(r, 100));

    expect(inserted.length).toBe(1);
    expect(inserted[0].ip_hash).toBeTruthy();
    expect(inserted[0].ip_hash).not.toBe('192.168.1.100');
  });

  it('should get IP from x-forwarded-for header', async () => {
    const middleware = createTrackingMiddleware(trackingOpts());
    const next = vi.fn();
    const req = mockReq({
      path: '/page',
      headers: {
        'user-agent': 'Chrome',
        'x-forwarded-for': '1.2.3.4, 10.0.0.1',
      },
    });

    await middleware(req, {}, next);
    await new Promise(r => setTimeout(r, 100));

    expect(inserted.length).toBe(1);
    // IP should be hashed from the first forwarded IP
    expect(inserted[0].ip_hash).toBeTruthy();
  });

  it('should generate same visitor_id for same IP+UA combination', async () => {
    const middleware = createTrackingMiddleware(trackingOpts());
    const next = vi.fn();
    const req1 = mockReq({ path: '/page1', ip: '1.2.3.4' });
    const req2 = mockReq({ path: '/page2', ip: '1.2.3.4' });

    await middleware(req1, {}, next);
    await new Promise(r => setTimeout(r, 50));
    await middleware(req2, {}, next);
    await new Promise(r => setTimeout(r, 50));

    expect(inserted.length).toBe(2);
    expect(inserted[0].visitor_id).toBe(inserted[1].visitor_id);
  });

  it('should reuse session_id within 30min window', async () => {
    const middleware = createTrackingMiddleware(trackingOpts());
    const next = vi.fn();
    const req1 = mockReq({ path: '/page1', ip: '1.2.3.4' });
    const req2 = mockReq({ path: '/page2', ip: '1.2.3.4' });

    await middleware(req1, {}, next);
    await new Promise(r => setTimeout(r, 50));
    await middleware(req2, {}, next);
    await new Promise(r => setTimeout(r, 50));

    expect(inserted.length).toBe(2);
    expect(inserted[0].session_id).toBe(inserted[1].session_id);
  });

  it('should truncate long referrer and user_agent', async () => {
    const middleware = createTrackingMiddleware(trackingOpts());
    const next = vi.fn();
    const longStr = 'x'.repeat(2000);
    const req = mockReq({
      path: '/page',
      headers: {
        'user-agent': longStr,
        'referer': 'https://example.com/' + longStr,
      },
    });

    await middleware(req, {}, next);
    await new Promise(r => setTimeout(r, 100));

    expect(inserted.length).toBe(1);
    expect(inserted[0].user_agent.length).toBeLessThanOrEqual(1000);
    expect(inserted[0].referrer.length).toBeLessThanOrEqual(500);
  });

  it('should create table if it does not exist', async () => {
    knex.schema.hasTable = vi.fn().mockResolvedValue(false);
    knex.schema.createTable = vi.fn().mockResolvedValue(undefined);

    const middleware = createTrackingMiddleware(trackingOpts());
    const next = vi.fn();

    await middleware(mockReq({ path: '/page' }), {}, next);
    await new Promise(r => setTimeout(r, 100));

    expect(knex.schema.hasTable).toHaveBeenCalledWith('analytics_page_views');
    expect(knex.schema.createTable).toHaveBeenCalled();
  });
});

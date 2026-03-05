/**
 * Analytics API Handlers Unit Tests
 * Uses in-memory SQLite for realistic query testing
 */
const knexLib = require('knex');
const { createAnalyticsApiHandlers } = require('../../../plugins/site-analytics/api-handlers');

describe('Analytics API Handlers', () => {
  let knex;
  let handlers;
  const TABLE = 'analytics_page_views';

  beforeAll(async () => {
    knex = knexLib({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await knex.schema.createTable(TABLE, (table) => {
      table.bigIncrements('id').primary();
      table.string('session_id', 64);
      table.string('visitor_id', 64);
      table.string('path', 500).notNullable();
      table.string('referrer', 500);
      table.text('user_agent');
      table.string('ip_hash', 64);
      table.string('country', 2);
      table.boolean('is_bot').defaultTo(false);
      table.string('bot_name', 100);
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });

    await knex.schema.createTable('analytics_client_errors', (table) => {
      table.bigIncrements('id').primary();
      table.string('error_type', 50);
      table.string('message', 500);
      table.text('stack');
      table.string('path', 500);
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });

    handlers = createAnalyticsApiHandlers({
      knex,
      tableName: TABLE,
      errorsTableName: 'analytics_client_errors',
    });
  });

  afterAll(async () => {
    await knex.destroy();
  });

  beforeEach(async () => {
    await knex(TABLE).del();
    if (await knex.schema.hasTable('analytics_client_errors')) {
      await knex('analytics_client_errors').del();
    }
  });

  function mockRes() {
    const res = {
      statusCode: 200,
      _body: null,
      status(code) { res.statusCode = code; return res; },
      json(data) { res._body = data; return res; },
    };
    return res;
  }

  function mockReq(query = {}) {
    return { query };
  }

  async function seedPageViews(views) {
    for (const v of views) {
      await knex(TABLE).insert({
        session_id: v.session_id || 'sess1',
        visitor_id: v.visitor_id || 'vis1',
        path: v.path || '/',
        referrer: v.referrer || null,
        user_agent: v.user_agent || 'Chrome',
        ip_hash: v.ip_hash || 'hash1',
        country: v.country || null,
        is_bot: v.is_bot || false,
        bot_name: v.bot_name || null,
        created_at: v.created_at || new Date().toISOString(),
      });
    }
  }

  describe('getStats', () => {
    it('should return zero stats for empty table', async () => {
      const req = mockReq({ days: '30' });
      const res = mockRes();

      await handlers.getStats(req, res);

      expect(res._body.views).toBe(0);
      expect(res._body.visitors).toBe(0);
      expect(res._body.uniquePages).toBe(0);
      expect(res._body.sessions).toBe(0);
    });

    it('should count views correctly', async () => {
      await seedPageViews([
        { path: '/a', visitor_id: 'v1', session_id: 's1' },
        { path: '/b', visitor_id: 'v1', session_id: 's1' },
        { path: '/a', visitor_id: 'v2', session_id: 's2' },
      ]);

      const res = mockRes();
      await handlers.getStats(mockReq({ days: '30' }), res);

      expect(res._body.views).toBe(3);
      expect(res._body.visitors).toBe(2);
      expect(res._body.uniquePages).toBe(2);
      expect(res._body.sessions).toBe(2);
    });

    it('should exclude bots from stats', async () => {
      await seedPageViews([
        { path: '/a', is_bot: false },
        { path: '/b', is_bot: true, bot_name: 'Google' },
      ]);

      const res = mockRes();
      await handlers.getStats(mockReq({ days: '30' }), res);

      expect(res._body.views).toBe(1);
    });

    it('should filter by days parameter', async () => {
      const old = new Date();
      old.setDate(old.getDate() - 60);

      await seedPageViews([
        { path: '/recent' },
        { path: '/old', created_at: old.toISOString() },
      ]);

      const res = mockRes();
      await handlers.getStats(mockReq({ days: '30' }), res);

      expect(res._body.views).toBe(1);
    });

    it('should default to 30 days if no days param', async () => {
      const res = mockRes();
      await handlers.getStats(mockReq({}), res);
      expect(res._body.days).toBe(30);
    });

    it('should clamp days to max 365', async () => {
      const res = mockRes();
      await handlers.getStats(mockReq({ days: '999' }), res);
      expect(res._body.days).toBe(365);
    });
  });

  describe('getViewsOverTime', () => {
    it('should return daily data with gap-filling', async () => {
      await seedPageViews([{ path: '/a' }]);

      const res = mockRes();
      await handlers.getViewsOverTime(mockReq({ days: '7' }), res);

      expect(Array.isArray(res._body)).toBe(true);
      // Should have ~7-8 entries (today + 7 days back)
      expect(res._body.length).toBeGreaterThanOrEqual(7);
      // Each entry should have date, views, visitors, sessions
      const last = res._body[res._body.length - 1];
      expect(last).toHaveProperty('date');
      expect(last).toHaveProperty('views');
      expect(last).toHaveProperty('visitors');
      expect(last).toHaveProperty('sessions');
    });

    it('should exclude bots from time series', async () => {
      await seedPageViews([
        { path: '/a', is_bot: false, visitor_id: 'human1', session_id: 'sh1' },
        { path: '/a', is_bot: false, visitor_id: 'human1', session_id: 'sh1' },
        { path: '/b', is_bot: true, bot_name: 'Google', visitor_id: 'bot1', session_id: 'sb1' },
        { path: '/b', is_bot: true, bot_name: 'Google', visitor_id: 'bot1', session_id: 'sb1' },
      ]);

      // Verify bot filtering: top-pages should only count human views
      const pagesRes = mockRes();
      await handlers.getTopPages(mockReq({ days: '7' }), pagesRes);
      expect(pagesRes._body.length).toBe(1);
      expect(pagesRes._body[0].path).toBe('/a');
      expect(pagesRes._body[0].views).toBe(2);

      // Verify bots appear in bot activity
      const botRes = mockRes();
      await handlers.getBotActivity(mockReq({ days: '7' }), botRes);
      expect(botRes._body.length).toBe(1);
      expect(botRes._body[0].name).toBe('Google');
      expect(botRes._body[0].requests).toBe(2);
    });
  });

  describe('getTopPages', () => {
    it('should return empty array for no data', async () => {
      const res = mockRes();
      await handlers.getTopPages(mockReq({ days: '30' }), res);
      expect(res._body).toEqual([]);
    });

    it('should return pages sorted by views descending', async () => {
      await seedPageViews([
        { path: '/popular' },
        { path: '/popular' },
        { path: '/popular' },
        { path: '/less-popular' },
      ]);

      const res = mockRes();
      await handlers.getTopPages(mockReq({ days: '30' }), res);

      expect(res._body[0].path).toBe('/popular');
      expect(res._body[0].views).toBe(3);
      expect(res._body[1].path).toBe('/less-popular');
      expect(res._body[1].views).toBe(1);
    });

    it('should respect limit parameter', async () => {
      await seedPageViews([
        { path: '/a' }, { path: '/b' }, { path: '/c' },
      ]);

      const res = mockRes();
      await handlers.getTopPages(mockReq({ days: '30', limit: '2' }), res);
      expect(res._body.length).toBe(2);
    });

    it('should exclude bots', async () => {
      await seedPageViews([
        { path: '/human', is_bot: false },
        { path: '/bot', is_bot: true },
      ]);

      const res = mockRes();
      await handlers.getTopPages(mockReq({ days: '30' }), res);
      expect(res._body.length).toBe(1);
      expect(res._body[0].path).toBe('/human');
    });
  });

  describe('getBotActivity', () => {
    it('should return empty array for no bots', async () => {
      const res = mockRes();
      await handlers.getBotActivity(mockReq({ days: '30' }), res);
      expect(res._body).toEqual([]);
    });

    it('should aggregate bot requests by name', async () => {
      await seedPageViews([
        { path: '/', is_bot: true, bot_name: 'Google' },
        { path: '/a', is_bot: true, bot_name: 'Google' },
        { path: '/', is_bot: true, bot_name: 'curl' },
      ]);

      const res = mockRes();
      await handlers.getBotActivity(mockReq({ days: '30' }), res);

      expect(res._body.length).toBe(2);
      expect(res._body[0].name).toBe('Google');
      expect(res._body[0].requests).toBe(2);
      expect(res._body[1].name).toBe('curl');
      expect(res._body[1].requests).toBe(1);
    });
  });

  describe('getCountries', () => {
    it('should return empty array for no country data', async () => {
      const res = mockRes();
      await handlers.getCountries(mockReq({ days: '30' }), res);
      expect(res._body).toEqual([]);
    });

    it('should aggregate by country sorted by views', async () => {
      await seedPageViews([
        { path: '/', country: 'TR' },
        { path: '/', country: 'TR' },
        { path: '/', country: 'DE' },
      ]);

      const res = mockRes();
      await handlers.getCountries(mockReq({ days: '30' }), res);

      expect(res._body.length).toBe(2);
      expect(res._body[0].country).toBe('TR');
      expect(res._body[0].views).toBe(2);
      expect(res._body[1].country).toBe('DE');
      expect(res._body[1].views).toBe(1);
    });

    it('should exclude bots', async () => {
      await seedPageViews([
        { path: '/', country: 'US', is_bot: false },
        { path: '/', country: 'CN', is_bot: true },
      ]);

      const res = mockRes();
      await handlers.getCountries(mockReq({ days: '30' }), res);

      expect(res._body.length).toBe(1);
      expect(res._body[0].country).toBe('US');
    });
  });

  describe('getClientErrors', () => {
    it('should return empty array when no errors', async () => {
      const res = mockRes();
      await handlers.getClientErrors(mockReq({ days: '30' }), res);
      expect(res._body).toEqual([]);
    });

    it('should return client errors sorted by created_at desc', async () => {
      await knex('analytics_client_errors').insert([
        { error_type: 'error', message: 'TypeError: x is null', path: '/', created_at: new Date(Date.now() - 60000).toISOString() },
        { error_type: 'unhandledrejection', message: 'Failed to fetch', path: '/about', created_at: new Date().toISOString() },
      ]);

      const res = mockRes();
      await handlers.getClientErrors(mockReq({ days: '30' }), res);

      expect(res._body.length).toBe(2);
      expect(res._body[0].message).toBe('Failed to fetch');
      expect(res._body[0].path).toBe('/about');
      expect(res._body[1].message).toBe('TypeError: x is null');
      expect(res._body[1].path).toBe('/');
    });

    it('should filter by days', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 45);
      await knex('analytics_client_errors').insert({
        error_type: 'error',
        message: 'Old error',
        path: '/',
        created_at: oldDate.toISOString(),
      });

      const res = mockRes();
      await handlers.getClientErrors(mockReq({ days: '30' }), res);
      expect(res._body).toEqual([]);
    });
  });

  describe('getRecent', () => {
    it('should return empty array for no data', async () => {
      const res = mockRes();
      await handlers.getRecent(mockReq({}), res);
      expect(res._body).toEqual([]);
    });

    it('should return most recent page views', async () => {
      const now = new Date();
      const earlier = new Date(now - 60000);

      await seedPageViews([
        { path: '/older', created_at: earlier.toISOString() },
        { path: '/newer', created_at: now.toISOString() },
      ]);

      const res = mockRes();
      await handlers.getRecent(mockReq({}), res);

      expect(res._body.length).toBe(2);
      expect(res._body[0].path).toBe('/newer');
    });

    it('should exclude bots', async () => {
      await seedPageViews([
        { path: '/human', is_bot: false },
        { path: '/bot', is_bot: true },
      ]);

      const res = mockRes();
      await handlers.getRecent(mockReq({}), res);

      expect(res._body.length).toBe(1);
      expect(res._body[0].path).toBe('/human');
    });

    it('should respect limit parameter', async () => {
      await seedPageViews([
        { path: '/a' }, { path: '/b' }, { path: '/c' },
      ]);

      const res = mockRes();
      await handlers.getRecent(mockReq({ limit: '2' }), res);
      expect(res._body.length).toBe(2);
    });
  });
});

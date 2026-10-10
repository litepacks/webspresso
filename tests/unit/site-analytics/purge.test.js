/**
 * Site Analytics Data Purge & Retention Unit Tests
 */

const knexLib = require('knex');
const { purgeAnalyticsData } = require('../../../plugins/site-analytics/purge');
const { createAnalyticsApiHandlers } = require('../../../plugins/site-analytics/api-handlers');
const siteAnalyticsPlugin = require('../../../plugins/site-analytics');
const { registerCommand } = require('../../../bin/commands/analytics-prune');

describe('Site Analytics Data Purge & Retention', () => {
  let knex;
  const VIEWS_TABLE = 'analytics_page_views';
  const ERRORS_TABLE = 'analytics_client_errors';

  beforeAll(async () => {
    knex = knexLib({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await knex.schema.createTable(VIEWS_TABLE, (table) => {
      table.bigIncrements('id').primary();
      table.string('path', 500).notNullable();
      table.timestamp('created_at').notNullable();
    });

    await knex.schema.createTable(ERRORS_TABLE, (table) => {
      table.bigIncrements('id').primary();
      table.string('message', 500);
      table.timestamp('created_at').notNullable();
    });
  });

  afterAll(async () => {
    await knex.destroy();
  });

  beforeEach(async () => {
    await knex(VIEWS_TABLE).del();
    await knex(ERRORS_TABLE).del();
  });

  describe('purgeAnalyticsData()', () => {
    it('deletes page views and error logs older than specified days', async () => {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;

      // Old page view: 100 days old
      await knex(VIEWS_TABLE).insert({
        path: '/old-page',
        created_at: new Date(now - 100 * dayMs).toISOString(),
      });
      // Recent page view: 10 days old
      await knex(VIEWS_TABLE).insert({
        path: '/recent-page',
        created_at: new Date(now - 10 * dayMs).toISOString(),
      });

      // Old client error: 40 days old
      await knex(ERRORS_TABLE).insert({
        message: 'Old error',
        created_at: new Date(now - 40 * dayMs).toISOString(),
      });
      // Recent client error: 5 days old
      await knex(ERRORS_TABLE).insert({
        message: 'Recent error',
        created_at: new Date(now - 5 * dayMs).toISOString(),
      });

      const result = await purgeAnalyticsData(knex, {
        days: 90,
        errorDays: 30,
        tableName: VIEWS_TABLE,
        errorsTableName: ERRORS_TABLE,
      });

      expect(result.viewsDeleted).toBe(1);
      expect(result.errorsDeleted).toBe(1);
      expect(typeof result.viewsCutoff).toBe('string');
      expect(typeof result.errorsCutoff).toBe('string');

      // Check remaining records
      const remainingViews = await knex(VIEWS_TABLE).select();
      expect(remainingViews.length).toBe(1);
      expect(remainingViews[0].path).toBe('/recent-page');

      const remainingErrors = await knex(ERRORS_TABLE).select();
      expect(remainingErrors.length).toBe(1);
      expect(remainingErrors[0].message).toBe('Recent error');
    });

    it('supports explicit olderThan and errorsOlderThan Date instances', async () => {
      const cutoff = new Date('2025-06-01T00:00:00.000Z');
      const errorCutoff = new Date('2025-05-01T00:00:00.000Z');

      await knex(VIEWS_TABLE).insert([
        { path: '/page1', created_at: '2025-05-15T00:00:00.000Z' },
        { path: '/page2', created_at: '2025-07-01T00:00:00.000Z' },
      ]);

      await knex(ERRORS_TABLE).insert([
        { message: 'err1', created_at: '2025-04-10T00:00:00.000Z' },
        { message: 'err2', created_at: '2025-05-20T00:00:00.000Z' },
      ]);

      const result = await purgeAnalyticsData(knex, {
        olderThan: cutoff,
        errorsOlderThan: errorCutoff,
        tableName: VIEWS_TABLE,
        errorsTableName: ERRORS_TABLE,
      });

      expect(result.viewsDeleted).toBe(1);
      expect(result.errorsDeleted).toBe(1);

      const views = await knex(VIEWS_TABLE).select();
      expect(views.length).toBe(1);
      expect(views[0].path).toBe('/page2');

      const errs = await knex(ERRORS_TABLE).select();
      expect(errs.length).toBe(1);
      expect(errs[0].message).toBe('err2');
    });

    it('gracefully skips deletion when table does not exist', async () => {
      const result = await purgeAnalyticsData(knex, {
        days: 30,
        tableName: 'nonexistent_views_table',
        errorsTableName: 'nonexistent_errors_table',
      });

      expect(result.viewsDeleted).toBe(0);
      expect(result.errorsDeleted).toBe(0);
    });

    it('rejects invalid days parameter', async () => {
      await expect(
        purgeAnalyticsData(knex, { days: -5 })
      ).rejects.toThrow('days must be a positive number');

      await expect(
        purgeAnalyticsData(knex, { days: 'invalid' })
      ).rejects.toThrow('days must be a positive number');
    });

    it('rejects invalid errorDays parameter', async () => {
      await expect(
        purgeAnalyticsData(knex, { errorDays: 0 })
      ).rejects.toThrow('errorDays must be a positive number');
    });

    it('rejects invalid date instances', async () => {
      await expect(
        purgeAnalyticsData(knex, { olderThan: new Date('invalid') })
      ).rejects.toThrow('invalid olderThan date');

      await expect(
        purgeAnalyticsData(knex, { errorsOlderThan: 'not-a-date' })
      ).rejects.toThrow('invalid errorsOlderThan date');
    });
  });

  describe('API Handler purge()', () => {
    it('executes purge from request body and returns JSON summary', async () => {
      const handlers = createAnalyticsApiHandlers({
        knex,
        tableName: VIEWS_TABLE,
        errorsTableName: ERRORS_TABLE,
      });

      const dayMs = 24 * 60 * 60 * 1000;
      await knex(VIEWS_TABLE).insert({
        path: '/stale',
        created_at: new Date(Date.now() - 50 * dayMs).toISOString(),
      });

      let jsonResponse = null;
      let statusCode = 200;

      const req = {
        body: { days: 30, errorDays: 15 },
        query: {},
      };
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(data) {
          jsonResponse = data;
          return this;
        },
      };

      await handlers.purge(req, res);

      expect(statusCode).toBe(200);
      expect(jsonResponse).toHaveProperty('ok', true);
      expect(jsonResponse.viewsDeleted).toBe(1);
      expect(jsonResponse.errorsDeleted).toBe(0);
      expect(jsonResponse.viewsCutoff).toBeDefined();
    });

    it('returns 400 when invalid days are passed to API handler', async () => {
      const handlers = createAnalyticsApiHandlers({
        knex,
        tableName: VIEWS_TABLE,
        errorsTableName: ERRORS_TABLE,
      });

      let jsonResponse = null;
      let statusCode = 200;

      const req = {
        body: { days: 'invalid-days' },
        query: {},
      };
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(data) {
          jsonResponse = data;
          return this;
        },
      };

      await handlers.purge(req, res);

      expect(statusCode).toBe(400);
      expect(jsonResponse.error).toMatch(/positive number/i);
    });
  });

  describe('Plugin Retention Configuration & Lifecycle', () => {
    it('initializes with default retention settings', () => {
      const plugin = siteAnalyticsPlugin({
        db: { knex },
        autoCleanup: false, // Don't start timer in test
      });

      const config = plugin.api.getRetentionConfig();
      expect(config.enabled).toBe(true);
      expect(config.days).toBe(90);
      expect(config.errorDays).toBe(30);
      expect(config.intervalMs).toBe(86400000);
      expect(config.runOnStart).toBe(true);
    });

    it('disables retention when retention: false is provided', () => {
      const plugin = siteAnalyticsPlugin({
        db: { knex },
        retention: false,
      });

      const config = plugin.api.getRetentionConfig();
      expect(config.enabled).toBe(false);
    });

    it('accepts custom retention shorthand object', () => {
      const plugin = siteAnalyticsPlugin({
        db: { knex },
        retention: {
          enabled: true,
          days: 60,
          errorDays: 14,
          intervalMs: 3600000,
          runOnStart: false,
        },
      });

      const config = plugin.api.getRetentionConfig();
      expect(config.enabled).toBe(true);
      expect(config.days).toBe(60);
      expect(config.errorDays).toBe(14);
      expect(config.intervalMs).toBe(3600000);
      expect(config.runOnStart).toBe(false);

      plugin.dispose();
    });

    it('provides startCleanup and stopCleanup controls on plugin.api', () => {
      const plugin = siteAnalyticsPlugin({
        db: { knex },
        autoCleanup: false,
      });

      plugin.api.startCleanup(10000);
      // Calling again is idempotent / updates interval
      plugin.api.startCleanup(20000);

      plugin.api.stopCleanup();
      // Calling stop again is safe
      plugin.api.stopCleanup();
    });

    it('allows programmatic purge via plugin.api.purge()', async () => {
      const plugin = siteAnalyticsPlugin({
        db: { knex },
        retentionDays: 45,
        errorRetentionDays: 20,
        autoCleanup: false,
      });

      const dayMs = 24 * 60 * 60 * 1000;
      await knex(VIEWS_TABLE).insert({
        path: '/very-old',
        created_at: new Date(Date.now() - 60 * dayMs).toISOString(),
      });

      const result = await plugin.api.purge();
      expect(result.viewsDeleted).toBe(1);
      expect(result.errorsDeleted).toBe(0);

      plugin.dispose();
    });

    it('cleans up timers when disposer returned from register() is called', () => {
      const plugin = siteAnalyticsPlugin({
        db: { knex },
        cleanupIntervalMs: 50000,
        autoCleanup: true,
      });

      const mockApp = { use: () => {} };
      const disposer = plugin.register({
        app: mockApp,
        usePlugin: () => null,
        addRoute: () => {},
        injectBody: () => {},
      });

      expect(typeof disposer).toBe('function');
      // Calling disposer should clear timer without error
      disposer();
    });

    it('cleans up timers on plugin.shutdown()', () => {
      const plugin = siteAnalyticsPlugin({
        db: { knex },
        autoCleanup: true,
      });

      plugin.shutdown();
    });
  });

  describe('CLI Command Registration', () => {
    it('registers analytics:prune command on commander program', () => {
      const commands = [];
      const mockProgram = {
        command: (name) => {
          const cmd = {
            name,
            description: (desc) => cmd,
            option: (flags, desc, defaultVal) => cmd,
            action: (fn) => cmd,
          };
          commands.push(name);
          return cmd;
        },
      };

      registerCommand(mockProgram);
      expect(commands).toContain('analytics:prune');
    });
  });
});

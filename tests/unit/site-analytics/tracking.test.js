/**
 * Tracking Middleware Unit Tests
 */
const {
  createTrackingMiddleware,
  formatDbError,
  isPermanentDbError,
} = require('../../../plugins/site-analytics/tracking');

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

  const trackingOpts = (opts = {}) => ({ knex, batchSize: 1, flushIntervalMs: 1, ...opts });

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
    await new Promise(r => setTimeout(r, 5));
    expect(inserted.length).toBe(0);
  });

  it('should skip static file extensions', async () => {
    const middleware = createTrackingMiddleware(trackingOpts());
    const next = vi.fn();

    for (const ext of ['.js', '.css', '.png', '.jpg', '.ico', '.woff2', '.svg']) {
      await middleware(mockReq({ path: '/assets/file' + ext }), {}, next);
    }
    await new Promise(r => setTimeout(r, 5));
    expect(inserted.length).toBe(0);
  });

  it('should skip admin paths by default', async () => {
    const middleware = createTrackingMiddleware(trackingOpts());
    const next = vi.fn();

    await middleware(mockReq({ path: '/_admin/dashboard' }), {}, next);
    await new Promise(r => setTimeout(r, 5));
    expect(inserted.length).toBe(0);
  });

  it('should skip API paths by default', async () => {
    const middleware = createTrackingMiddleware(trackingOpts());
    const next = vi.fn();

    await middleware(mockReq({ path: '/api/users' }), {}, next);
    await new Promise(r => setTimeout(r, 5));
    expect(inserted.length).toBe(0);
  });

  it('should skip custom excludePaths', async () => {
    const middleware = createTrackingMiddleware(trackingOpts({ excludePaths: ['/health', '/robots'] }));
    const next = vi.fn();

    await middleware(mockReq({ path: '/health' }), {}, next);
    await middleware(mockReq({ path: '/robots.txt' }), {}, next);
    await new Promise(r => setTimeout(r, 5));
    expect(inserted.length).toBe(0);
  });

  it('should record a page view for valid GET request', async () => {
    const middleware = createTrackingMiddleware(trackingOpts());
    const next = vi.fn();
    const req = mockReq({ path: '/blog/hello' });

    await middleware(req, {}, next);
    await new Promise(r => setTimeout(r, 5));

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
    await new Promise(r => setTimeout(r, 5));

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
    await new Promise(r => setTimeout(r, 5));
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
    await new Promise(r => setTimeout(r, 5));

    expect(inserted.length).toBe(1);
    expect(inserted[0].country).toBe('TR');
  });

  it('should hash IP address (not store raw IP)', async () => {
    const middleware = createTrackingMiddleware(trackingOpts());
    const next = vi.fn();
    const req = mockReq({ path: '/page', ip: '192.168.1.100' });

    await middleware(req, {}, next);
    await new Promise(r => setTimeout(r, 5));

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
    await new Promise(r => setTimeout(r, 5));

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
    await new Promise(r => setTimeout(r, 5));
    await middleware(req2, {}, next);
    await new Promise(r => setTimeout(r, 5));

    expect(inserted.length).toBe(2);
    expect(inserted[0].visitor_id).toBe(inserted[1].visitor_id);
  });

  it('should reuse session_id within 30min window', async () => {
    const middleware = createTrackingMiddleware(trackingOpts());
    const next = vi.fn();
    const req1 = mockReq({ path: '/page1', ip: '1.2.3.4' });
    const req2 = mockReq({ path: '/page2', ip: '1.2.3.4' });

    await middleware(req1, {}, next);
    await new Promise(r => setTimeout(r, 5));
    await middleware(req2, {}, next);
    await new Promise(r => setTimeout(r, 5));

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
    await new Promise(r => setTimeout(r, 5));

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
    await new Promise(r => setTimeout(r, 5));

    expect(knex.schema.hasTable).toHaveBeenCalledWith('analytics_page_views');
    expect(knex.schema.createTable).toHaveBeenCalled();
  });

  describe('formatDbError', () => {
    it('should strip raw SQL and extract actual error message', () => {
      const knexErr = new Error('insert into "analytics_page_views" ("col1", "col2") values (?, ?) - SQLITE_FULL: database or disk is full');
      const formatted = formatDbError(knexErr);
      expect(formatted).toBe('SQLITE_FULL: database or disk is full');
      expect(formatted).not.toContain('insert into');
    });

    it('should handle error with .code property', () => {
      const err = { code: 'SQLITE_IOERR', message: 'I/O failure' };
      const formatted = formatDbError(err);
      expect(formatted).toContain('I/O failure');
    });

    it('should handle string error, null and undefined', () => {
      expect(formatDbError(null)).toBe('Unknown error');
      expect(formatDbError(undefined)).toBe('Unknown error');
      expect(formatDbError('Direct database error string')).toBe('Direct database error string');
      expect(formatDbError({})).toBe('Database error');
    });

    it('should normalize multiline messages and slice to max 150 chars', () => {
      const longMessage = 'A'.repeat(300) + '\n\n' + 'B'.repeat(50);
      const formatted = formatDbError(new Error(longMessage));
      expect(formatted.length).toBeLessThanOrEqual(150);
      expect(formatted).not.toContain('\n');
    });
  });

  describe('isPermanentDbError', () => {
    it('should detect permanent SQLite and OS disk errors', () => {
      expect(isPermanentDbError({ code: 'SQLITE_FULL' })).toBe(true);
      expect(isPermanentDbError({ code: 'SQLITE_IOERR' })).toBe(true);
      expect(isPermanentDbError({ code: 'SQLITE_CORRUPT' })).toBe(true);
      expect(isPermanentDbError({ code: 'ER_DISK_FULL' })).toBe(true);
      expect(isPermanentDbError({ code: 'ENOSPC' })).toBe(true);
      expect(isPermanentDbError(new Error('database or disk is full'))).toBe(true);
      expect(isPermanentDbError(new Error('disk I/O error occurred'))).toBe(true);
      expect(isPermanentDbError(new Error('database disk image is malformed'))).toBe(true);
    });

    it('should return false for transient errors or null', () => {
      expect(isPermanentDbError(null)).toBe(false);
      expect(isPermanentDbError({ code: 'SQLITE_BUSY' })).toBe(false);
      expect(isPermanentDbError(new Error('Connection timeout'))).toBe(false);
      expect(isPermanentDbError(new Error('table locked'))).toBe(false);
    });
  });

  describe('Exponential Backoff, Circuit Breaker & Log Throttling', () => {
    it('should drop batch immediately on permanent DB error (e.g. disk full)', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      knex.__chainable.insert = vi.fn().mockRejectedValue(new Error('insert into tbl - SQLITE_FULL: database or disk is full'));

      const middleware = createTrackingMiddleware(trackingOpts({ batchSize: 1 }));
      await middleware(mockReq({ path: '/page1' }), {}, vi.fn());
      await new Promise(r => setTimeout(r, 10));

      // Batch was dropped immediately, queue must be empty
      expect(middleware.getQueue().length).toBe(0);
      expect(middleware.getFailureCount()).toBe(1);
      expect(middleware.getNextAllowedFlushTime()).toBeGreaterThan(Date.now() - 100);

      consoleErrorSpy.mockRestore();
      middleware.stop();
    });

    it('should rate-limit error logs and report suppressed occurrences', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      knex.__chainable.insert = vi.fn().mockRejectedValue(new Error('SQLITE_BUSY: locked'));

      // Use short 20ms log interval for testing
      const middleware = createTrackingMiddleware(trackingOpts({
        batchSize: 1,
        flushIntervalMs: 5,
        errorLogIntervalMs: 20,
        maxRetries: 10,
      }));

      // Trigger 1st error (should log immediately)
      await middleware(mockReq({ path: '/err1' }), {}, vi.fn());
      await new Promise(r => setTimeout(r, 8));
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('[site-analytics] Batch insert failed: SQLITE_BUSY: locked');

      // Trigger 2nd error within window (should be suppressed)
      middleware.resetState();
      // Manually simulate subsequent failure within suppression window
      await middleware(mockReq({ path: '/err2' }), {}, vi.fn());
      await new Promise(r => setTimeout(r, 5));
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1); // Still 1

      consoleErrorSpy.mockRestore();
      middleware.stop();
    });

    it('should drop items after reaching maxRetries (3) on transient errors', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      knex.__chainable.insert = vi.fn().mockRejectedValue(new Error('Temporary lock'));

      const middleware = createTrackingMiddleware(trackingOpts({
        batchSize: 1,
        flushIntervalMs: 1,
        maxRetries: 3,
      }));

      // Add item and fail retry 1
      await middleware(mockReq({ path: '/retry-page' }), {}, vi.fn());
      await new Promise(r => setTimeout(r, 5));
      expect(middleware.getQueue().length).toBe(1);
      expect(middleware.getQueue()[0]._retries).toBe(1);

      // Force failure retry 2
      middleware.resetState();
      middleware.getQueue().push({ path: '/retry-page', _retries: 1 });
      await middleware.flush();
      expect(middleware.getQueue().length).toBe(1);
      expect(middleware.getQueue()[0]._retries).toBe(2);

      // Force failure retry 3 (reaches maxRetries, should be dropped)
      middleware.resetState();
      middleware.getQueue().push({ path: '/retry-page', _retries: 2 });
      await middleware.flush();
      expect(middleware.getQueue().length).toBe(0); // Dropped!

      consoleErrorSpy.mockRestore();
      middleware.stop();
    });

    it('should reset backoff and failureCount when DB write recovers', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      knex.__chainable.insert = vi.fn()
        .mockRejectedValueOnce(new Error('Temporary glitch'))
        .mockResolvedValueOnce([1]);

      const middleware = createTrackingMiddleware(trackingOpts({ batchSize: 1 }));
      await middleware(mockReq({ path: '/glitch' }), {}, vi.fn());
      await new Promise(r => setTimeout(r, 10));

      expect(middleware.getFailureCount()).toBe(1);

      // Reset timer to allow retry flush immediately
      middleware.resetState();
      await middleware(mockReq({ path: '/recovered' }), {}, vi.fn());
      await new Promise(r => setTimeout(r, 10));

      expect(middleware.getFailureCount()).toBe(0);
      expect(middleware.getNextAllowedFlushTime()).toBe(0);

      consoleErrorSpy.mockRestore();
      middleware.stop();
    });

    it('should drop bot visits during database failures to protect queue', async () => {
      const middleware = createTrackingMiddleware(trackingOpts({ batchSize: 1 }));
      // Set artificial failure count to simulate active DB outage
      middleware.resetState();
      // Cause an outage state
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      knex.__chainable.insert = vi.fn().mockRejectedValue(new Error('SQLITE_FULL: disk full'));

      await middleware(mockReq({ path: '/fail' }), {}, vi.fn());
      await new Promise(r => setTimeout(r, 10));
      expect(middleware.getFailureCount()).toBeGreaterThan(0);

      // Now a crawler bot visits during the failure
      await middleware(mockReq({
        path: '/crawled-url',
        headers: { 'user-agent': 'PetalBot/1.0' },
      }), {}, vi.fn());

      // Crawler was dropped, queue should still be empty
      expect(middleware.getQueue().length).toBe(0);

      consoleErrorSpy.mockRestore();
      middleware.stop();
    });

    it('should strip _retries before inserting into database', async () => {
      let insertedPayload = null;
      knex.__chainable.insert = vi.fn(async (rows) => {
        insertedPayload = rows;
        return [rows.length];
      });

      const middleware = createTrackingMiddleware(trackingOpts({ batchSize: 1 }));
      await middleware(mockReq({ path: '/clean-row' }), {}, vi.fn());
      await new Promise(r => setTimeout(r, 10));

      expect(insertedPayload).toBeTruthy();
      expect(insertedPayload[0]._retries).toBeUndefined();
      expect(insertedPayload[0].created_at).toBe('NOW()');
      middleware.stop();
    });
  });
});

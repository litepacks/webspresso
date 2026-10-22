const knex = require('knex');
const {
  createUserSessionsTable,
  dropUserSessionsTable,
  createKnexSessionTracker,
} = require('../../../core/auth');

describe('KnexSessionTracker Concurrent Race Condition Hardening', () => {
  let db;
  let tracker;

  beforeAll(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });
    await createUserSessionsTable(db);
    tracker = createKnexSessionTracker(db);
  });

  afterAll(async () => {
    if (db) {
      await dropUserSessionsTable(db);
      await db.destroy();
    }
  });

  it('handles 10 simultaneous concurrent track calls for the same new session without unique constraint errors', async () => {
    const sessionId = 'race-session-new-1';

    // 10 concurrent requests trying to track the brand-new session ID at the same moment
    const promises = Array.from({ length: 10 }, (_, i) =>
      tracker.track(sessionId, 100 + i, {
        ip: `192.168.1.${i + 1}`,
        userAgent: `Test-Agent-${i}`,
      })
    );

    const results = await Promise.all(promises);

    expect(results).toHaveLength(10);
    for (const res of results) {
      expect(res).toBeDefined();
      expect(res.session_id).toBe(sessionId);
    }

    // Verify database has exactly 1 record for this session
    const rows = await db('user_sessions').where({ session_id: sessionId });
    expect(rows).toHaveLength(1);
    expect(rows[0].session_id).toBe(sessionId);
  });

  it('handles parallel track calls on existing session cleanly', async () => {
    const sessionId = 'race-session-existing-2';
    await tracker.track(sessionId, 50, { ip: '10.0.0.1' });

    const promises = Array.from({ length: 5 }, (_, i) =>
      tracker.track(sessionId, 50, {
        ip: `10.0.0.${i + 2}`,
        browser: `Browser-${i}`,
      })
    );

    const results = await Promise.all(promises);
    expect(results).toHaveLength(5);

    const count = await db('user_sessions').where({ session_id: sessionId }).count('id as count');
    expect(Number(count[0].count)).toBe(1);
  });

  it('still re-throws non-constraint database errors', async () => {
    const brokenDb = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });
    // Table not created on brokenDb -> should re-throw SQL error
    const brokenTracker = createKnexSessionTracker(brokenDb, { tableName: 'non_existent_table' });

    await expect(
      brokenTracker.track('sess-fail', 1, { ip: '1.1.1.1' })
    ).rejects.toThrow();

    await brokenDb.destroy();
  });
});

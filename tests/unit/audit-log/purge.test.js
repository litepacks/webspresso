/**
 * purgeAuditLogs
 */
const { purgeAuditLogs } = require('../../../plugins/audit-log/purge');

describe('purgeAuditLogs', () => {
  it('deletes rows older than cutoff', async () => {
    const deleted = [];
    const knex = (table) => ({
      where() {
        return this;
      },
      delete() {
        deleted.push({ table });
        return Promise.resolve(42);
      },
    });

    const d = new Date('2020-01-01');
    const n = await purgeAuditLogs(knex, { tableName: 'audit_logs', olderThan: d });
    expect(n).toBe(42);
  });

  it('throws on invalid date', async () => {
    await expect(
      purgeAuditLogs({}, { olderThan: 'not-a-date' })
    ).rejects.toThrow(/invalid olderThan/);
  });
});

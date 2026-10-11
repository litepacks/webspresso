/**
 * Tests for audit log purge, api handlers, and plugin retention
 */

const { purgeAuditLogs } = require('../../../plugins/audit-log/purge');
const { createAuditLogHandlers } = require('../../../plugins/audit-log/api-handlers');
const auditLogPlugin = require('../../../plugins/audit-log');

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

  it('calculates cutoff from days option', async () => {
    const knex = () => ({
      where() {
        return this;
      },
      delete() {
        return Promise.resolve(10);
      },
    });

    const n = await purgeAuditLogs(knex, { days: 30 });
    expect(n).toBe(10);
  });

  it('calculates cutoff from retentionDays option', async () => {
    const knex = () => ({
      where() {
        return this;
      },
      delete() {
        return Promise.resolve(15);
      },
    });

    const n = await purgeAuditLogs(knex, { retentionDays: 60 });
    expect(n).toBe(15);
  });

  it('throws on missing knex', async () => {
    await expect(purgeAuditLogs(null)).rejects.toThrow(/requires a database/);
  });

  it('throws on invalid date', async () => {
    await expect(
      purgeAuditLogs({}, { olderThan: 'not-a-date' })
    ).rejects.toThrow(/invalid olderThan/);
  });

  it('throws on invalid days value', async () => {
    await expect(
      purgeAuditLogs({}, { days: -5 })
    ).rejects.toThrow(/positive number/);
  });

  it('returns 0 when table does not exist', async () => {
    const knex = {
      schema: {
        hasTable: async () => false,
      },
    };
    const count = await purgeAuditLogs(knex, { days: 30 });
    expect(count).toBe(0);
  });
});

describe('createAuditLogHandlers purgeHandler', () => {
  it('calls purgeAuditLogs and returns JSON response', async () => {
    const knex = () => ({
      where() {
        return this;
      },
      delete() {
        return Promise.resolve(7);
      },
    });

    const handlers = createAuditLogHandlers({ knex, tableName: 'audit_logs' });
    let status = 200;
    let jsonResult = null;
    const req = { body: { days: 45 } };
    const res = {
      status(s) { status = s; return this; },
      json(d) { jsonResult = d; return this; },
    };

    await handlers.purgeHandler(req, res);
    expect(status).toBe(200);
    expect(jsonResult.ok).toBe(true);
    expect(jsonResult.deleted).toBe(7);
    expect(jsonResult.olderThan).toBeDefined();
  });

  it('validates invalid days and returns 400', async () => {
    const knex = () => ({});
    const handlers = createAuditLogHandlers({ knex });
    let status = 200;
    let jsonResult = null;
    const req = { body: { days: 'invalid' } };
    const res = {
      status(s) { status = s; return this; },
      json(d) { jsonResult = d; return this; },
    };

    await handlers.purgeHandler(req, res);
    expect(status).toBe(400);
    expect(jsonResult.error).toContain('positive integer');
  });
});

describe('auditLogPlugin retention', () => {
  it('configures retention defaults and api methods', () => {
    const knex = () => ({
      where() { return this; },
      delete() { return Promise.resolve(5); },
    });
    const db = { knex };

    const plugin = auditLogPlugin({
      db,
      retentionDays: 45,
      cleanupIntervalMs: 3600000,
    });

    const retentionConfig = plugin.api.getRetentionConfig();
    expect(retentionConfig.enabled).toBe(true);
    expect(retentionConfig.days).toBe(45);
    expect(retentionConfig.intervalMs).toBe(3600000);

    plugin.api.startCleanup();
    plugin.api.stopCleanup();
    plugin.dispose();
  });

  it('supports disabling retention', () => {
    const knex = () => ({});
    const db = { knex };

    const plugin = auditLogPlugin({
      db,
      retention: false,
    });

    const retentionConfig = plugin.api.getRetentionConfig();
    expect(retentionConfig.enabled).toBe(false);
  });

  it('registers audit:prune command on commander program', () => {
    const { registerCommand } = require('../../../bin/commands/audit-prune');
    const commands = [];
    const mockProgram = {
      command: (name) => {
        const cmd = {
          name,
          description: () => cmd,
          option: () => cmd,
          action: () => cmd,
        };
        commands.push(name);
        return cmd;
      },
    };

    registerCommand(mockProgram);
    expect(commands).toContain('audit:prune');
  });
});

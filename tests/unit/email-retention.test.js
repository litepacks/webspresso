/**
 * Tests for email log purge, api handlers, and plugin retention
 */

import { describe, it, expect, vi } from 'vitest';
const { purgeEmailLogs } = require('../../plugins/email/purge');
const emailPlugin = require('../../plugins/email');

describe('purgeEmailLogs', () => {
  it('deletes rows older than cutoff date', async () => {
    const deleted = [];
    const knex = (table) => ({
      where() {
        return this;
      },
      delete() {
        deleted.push({ table });
        return Promise.resolve(25);
      },
    });

    const d = new Date('2020-01-01');
    const n = await purgeEmailLogs(knex, { tableName: 'email_logs', olderThan: d });
    expect(n).toBe(25);
  });

  it('calculates cutoff from days option', async () => {
    const knex = () => ({
      where() {
        return this;
      },
      delete() {
        return Promise.resolve(12);
      },
    });

    const n = await purgeEmailLogs(knex, { days: 60 });
    expect(n).toBe(12);
  });

  it('calculates cutoff from retentionDays option', async () => {
    const knex = () => ({
      where() {
        return this;
      },
      delete() {
        return Promise.resolve(8);
      },
    });

    const n = await purgeEmailLogs(knex, { retentionDays: 90 });
    expect(n).toBe(8);
  });

  it('throws on missing knex', async () => {
    await expect(purgeEmailLogs(null)).rejects.toThrow(/requires a database/);
  });

  it('throws on invalid date', async () => {
    await expect(
      purgeEmailLogs({}, { olderThan: 'not-a-date' })
    ).rejects.toThrow(/invalid olderThan/);
  });

  it('throws on invalid days value', async () => {
    await expect(
      purgeEmailLogs({}, { days: -1 })
    ).rejects.toThrow(/positive number/);
  });

  it('returns 0 when table does not exist', async () => {
    const knex = {
      schema: {
        hasTable: async () => false,
      },
    };
    const count = await purgeEmailLogs(knex, { days: 30 });
    expect(count).toBe(0);
  });
});

describe('emailPlugin retention', () => {
  it('configures retention defaults and api methods', () => {
    const knex = () => ({
      where() { return this; },
      delete() { return Promise.resolve(3); },
    });
    const db = { knex };

    const plugin = emailPlugin({
      db,
      retentionDays: 60,
      cleanupIntervalMs: 7200000,
    });

    const retentionConfig = plugin.api.getRetentionConfig();
    expect(retentionConfig.enabled).toBe(true);
    expect(retentionConfig.days).toBe(60);
    expect(retentionConfig.intervalMs).toBe(7200000);

    plugin.api.startCleanup();
    plugin.api.stopCleanup();
    plugin.dispose();
  });

  it('supports disabling retention', () => {
    const knex = () => ({});
    const db = { knex };

    const plugin = emailPlugin({
      db,
      retention: false,
    });

    const retentionConfig = plugin.api.getRetentionConfig();
    expect(retentionConfig.enabled).toBe(false);
  });

  it('registers email:prune command on commander program', () => {
    const { registerCommand } = require('../../bin/commands/email-prune');
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
    expect(commands).toContain('email:prune');
  });
});

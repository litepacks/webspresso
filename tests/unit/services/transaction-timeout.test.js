/**
 * Transactional services must roll back when they time out: the caller sees SERVICE_TIMEOUT,
 * so committing the work afterwards would apply it twice on retry.
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const { createDatabase, defineModel, zdb } = require('../../../index');
const { clearRegistry } = require('../../../core/orm/model');
const { createServiceRegistry } = require('../../../core/services');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('service timeout inside a transaction', () => {
  let db;

  beforeEach(async () => {
    clearRegistry();
    db = createDatabase({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    defineModel({ name: 'TxPayment', table: 'tx_payments', schema: { id: zdb.id(), amount: zdb.integer() } });
    await db.knex.schema.createTable('tx_payments', (t) => {
      t.increments('id');
      t.integer('amount');
    });
  });

  afterEach(async () => {
    await db.knex.destroy();
    clearRegistry();
  });

  const countRows = async () => Number((await db.knex('tx_payments').count({ n: '*' }).first()).n);

  it('rolls back writes when the service times out', async () => {
    const registry = createServiceRegistry({});
    registry.register('payment.charge', {
      transaction: true,
      timeout: 50,
      handler: async (input, ctx) => {
        await ctx.db.getRepository('TxPayment').create({ amount: input.amount });
        await sleep(150);
        return { ok: true };
      },
    });

    await expect(registry.call('payment.charge', { amount: 100 }, { db })).rejects.toMatchObject({
      code: 'SERVICE_TIMEOUT',
    });
    await sleep(250); // let the abandoned handler finish
    expect(await countRows()).toBe(0);
  });

  it('commits when the service finishes within its timeout', async () => {
    const registry = createServiceRegistry({});
    registry.register('payment.charge', {
      transaction: true,
      timeout: 1000,
      handler: async (input, ctx) => {
        await ctx.db.getRepository('TxPayment').create({ amount: input.amount });
        return { ok: true };
      },
    });

    await expect(registry.call('payment.charge', { amount: 100 }, { db })).resolves.toEqual({ ok: true });
    expect(await countRows()).toBe(1);
  });

  it('exposes a working ctx.db.query() bound to the transaction', async () => {
    const registry = createServiceRegistry({});
    registry.register('payment.list', {
      transaction: true,
      handler: async (input, ctx) => {
        await ctx.db.getRepository('TxPayment').create({ amount: 7 });
        const qb = ctx.db.query('TxPayment');
        return qb ? qb.find() : null;
      },
    });

    const rows = await registry.call('payment.list', {}, { db });
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.map((r) => r.amount)).toEqual([7]);
  });
});

/**
 * ORM transaction helpers
 */
const { createTransactionContext, runTransaction } = require('../../core/orm/transaction');

describe('core/orm/transaction', () => {
  describe('createTransactionContext', () => {
    it('exposes trx and scope helpers', () => {
      const trx = { tag: 'trx' };
      const ctx = createTransactionContext(trx);
      expect(ctx.trx).toBe(trx);
      expect(typeof ctx.createRepository).toBe('function');
      expect(ctx.forTenant('tenant-1')).toBe(ctx);
      expect(ctx.getScopeContext().tenantId).toBe('tenant-1');
    });

    it('uses provided scopeContext when passed', () => {
      const trx = {};
      const scope = { tenantId: 'preset' };
      const ctx = createTransactionContext(trx, scope);
      expect(ctx.getScopeContext().tenantId).toBe('preset');
      ctx.forTenant('other');
      expect(ctx.getScopeContext().tenantId).toBe('other');
    });
  });

  describe('runTransaction', () => {
    it('runs callback inside knex.transaction', async () => {
      const knex = {
        transaction: async (fn) => fn({ mock: true }),
      };
      const out = await runTransaction(knex, (ctx) => {
        expect(ctx.trx).toEqual({ mock: true });
        return 'ok';
      });
      expect(out).toBe('ok');
    });

    it('forwards optional scopeContext', async () => {
      const knex = {
        transaction: async (fn) => fn({}),
      };
      const scope = { tenantId: 't9' };
      await runTransaction(
        knex,
        (ctx) => {
          expect(ctx.getScopeContext().tenantId).toBe('t9');
        },
        scope,
      );
    });
  });
});

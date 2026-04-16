/**
 * Scopes Unit Tests
 */

const {
  applySoftDeleteScope,
  applyTenantScope,
  applyInsertTimestamps,
  applyUpdateTimestamps,
  applyInsertTenant,
  applyInsertNanoidPrimary,
  applyInsertModifiers,
  applyUpdateModifiers,
  getSoftDeleteData,
  getRestoreData,
  createScopeContext,
} = require('../../../core/orm/scopes');

// Mock Knex query builder
function createMockQueryBuilder() {
  const calls = [];
  const qb = {
    whereNull: (col) => { calls.push({ method: 'whereNull', col }); return qb; },
    whereNotNull: (col) => { calls.push({ method: 'whereNotNull', col }); return qb; },
    where: (col, val) => { calls.push({ method: 'where', col, val }); return qb; },
    getCalls: () => calls,
  };
  return qb;
}

// Mock model definitions
const modelWithSoftDelete = {
  name: 'User',
  table: 'users',
  primaryKey: 'id',
  scopes: { softDelete: true, timestamps: false, tenant: null },
};

const modelWithTimestamps = {
  name: 'Post',
  table: 'posts',
  primaryKey: 'id',
  scopes: { softDelete: false, timestamps: true, tenant: null },
};

const modelWithTenant = {
  name: 'Task',
  table: 'tasks',
  primaryKey: 'id',
  scopes: { softDelete: false, timestamps: false, tenant: 'tenant_id' },
};

const modelWithAll = {
  name: 'Order',
  table: 'orders',
  primaryKey: 'id',
  scopes: { softDelete: true, timestamps: true, tenant: 'tenant_id' },
};

const modelWithNone = {
  name: 'Log',
  table: 'logs',
  primaryKey: 'id',
  scopes: { softDelete: false, timestamps: false, tenant: null },
};

const modelWithNanoidPk = {
  name: 'Nano',
  table: 'nanos',
  primaryKey: 'id',
  scopes: { softDelete: false, timestamps: false, tenant: null },
  columns: new Map([
    ['id', { type: 'nanoid', primary: true, maxLength: 21 }],
  ]),
};

describe('Scopes', () => {
  describe('applySoftDeleteScope', () => {
    it('should add whereNull for soft delete model', () => {
      const qb = createMockQueryBuilder();
      const context = createScopeContext();
      
      applySoftDeleteScope(qb, context, modelWithSoftDelete);
      
      expect(qb.getCalls()).toContainEqual({ method: 'whereNull', col: 'deleted_at' });
    });

    it('should not filter when withTrashed is true', () => {
      const qb = createMockQueryBuilder();
      const context = { ...createScopeContext(), withTrashed: true };
      
      applySoftDeleteScope(qb, context, modelWithSoftDelete);
      
      expect(qb.getCalls()).toHaveLength(0);
    });

    it('should use whereNotNull when onlyTrashed is true', () => {
      const qb = createMockQueryBuilder();
      const context = { ...createScopeContext(), onlyTrashed: true };
      
      applySoftDeleteScope(qb, context, modelWithSoftDelete);
      
      expect(qb.getCalls()).toContainEqual({ method: 'whereNotNull', col: 'deleted_at' });
    });

    it('should do nothing for model without soft delete', () => {
      const qb = createMockQueryBuilder();
      const context = createScopeContext();
      
      applySoftDeleteScope(qb, context, modelWithNone);
      
      expect(qb.getCalls()).toHaveLength(0);
    });
  });

  describe('applyTenantScope', () => {
    it('should add where clause for tenant', () => {
      const qb = createMockQueryBuilder();
      const context = { ...createScopeContext(), tenantId: 123 };
      
      applyTenantScope(qb, context, modelWithTenant);
      
      expect(qb.getCalls()).toContainEqual({ method: 'where', col: 'tenant_id', val: 123 });
    });

    it('should do nothing without tenantId', () => {
      const qb = createMockQueryBuilder();
      const context = createScopeContext();
      
      applyTenantScope(qb, context, modelWithTenant);
      
      expect(qb.getCalls()).toHaveLength(0);
    });

    it('should do nothing for model without tenant scope', () => {
      const qb = createMockQueryBuilder();
      const context = { ...createScopeContext(), tenantId: 123 };
      
      applyTenantScope(qb, context, modelWithNone);
      
      expect(qb.getCalls()).toHaveLength(0);
    });
  });

  describe('applyInsertTimestamps', () => {
    it('should add created_at and updated_at', () => {
      const data = { name: 'Test' };
      
      const result = applyInsertTimestamps(data, modelWithTimestamps);
      
      expect(result.name).toBe('Test');
      expect(result.created_at).toBeInstanceOf(Date);
      expect(result.updated_at).toBeInstanceOf(Date);
    });

    it('should not override existing timestamps', () => {
      const existingDate = new Date('2020-01-01');
      const data = { name: 'Test', created_at: existingDate };
      
      const result = applyInsertTimestamps(data, modelWithTimestamps);
      
      expect(result.created_at).toBe(existingDate);
    });

    it('should return unchanged data for model without timestamps', () => {
      const data = { name: 'Test' };
      
      const result = applyInsertTimestamps(data, modelWithNone);
      
      expect(result).toEqual(data);
      expect(result.created_at).toBeUndefined();
    });
  });

  describe('applyUpdateTimestamps', () => {
    it('should update updated_at', () => {
      const data = { name: 'Updated' };
      
      const result = applyUpdateTimestamps(data, modelWithTimestamps);
      
      expect(result.name).toBe('Updated');
      expect(result.updated_at).toBeInstanceOf(Date);
    });

    it('should return unchanged data for model without timestamps', () => {
      const data = { name: 'Test' };
      
      const result = applyUpdateTimestamps(data, modelWithNone);
      
      expect(result).toEqual(data);
    });
  });

  describe('applyInsertTenant', () => {
    it('should add tenant_id to data', () => {
      const data = { name: 'Test' };
      const context = { ...createScopeContext(), tenantId: 456 };
      
      const result = applyInsertTenant(data, context, modelWithTenant);
      
      expect(result.tenant_id).toBe(456);
    });

    it('should not override existing tenant_id', () => {
      const data = { name: 'Test', tenant_id: 789 };
      const context = { ...createScopeContext(), tenantId: 456 };
      
      const result = applyInsertTenant(data, context, modelWithTenant);
      
      expect(result.tenant_id).toBe(789);
    });

    it('should return unchanged data without tenant context', () => {
      const data = { name: 'Test' };
      const context = createScopeContext();
      
      const result = applyInsertTenant(data, context, modelWithTenant);
      
      expect(result).toEqual(data);
    });
  });

  describe('applyInsertNanoidPrimary', () => {
    it('should generate nanoid when primary key is missing', () => {
      const data = { title: 'Hello' };
      const result = applyInsertNanoidPrimary(data, modelWithNanoidPk);
      expect(result.title).toBe('Hello');
      expect(result.id).toBeDefined();
      expect(result.id).toHaveLength(21);
      expect(result.id).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should not override existing primary key', () => {
      const data = { id: 'custom_id_value_12345', title: 'Hi' };
      const result = applyInsertNanoidPrimary(data, modelWithNanoidPk);
      expect(result.id).toBe('custom_id_value_12345');
    });
  });

  describe('applyInsertModifiers', () => {
    it('should apply all insert modifiers', () => {
      const data = { name: 'Test' };
      const context = { ...createScopeContext(), tenantId: 100 };
      
      const result = applyInsertModifiers(data, context, modelWithAll);
      
      expect(result.name).toBe('Test');
      expect(result.created_at).toBeInstanceOf(Date);
      expect(result.updated_at).toBeInstanceOf(Date);
      expect(result.tenant_id).toBe(100);
    });

    it('should generate nanoid primary for nanoid models', () => {
      const data = { label: 'x' };
      const result = applyInsertModifiers(data, createScopeContext(), modelWithNanoidPk);
      expect(result.label).toBe('x');
      expect(result.id).toHaveLength(21);
    });
  });

  describe('applyUpdateModifiers', () => {
    it('should apply update modifiers', () => {
      const data = { name: 'Updated' };
      
      const result = applyUpdateModifiers(data, modelWithTimestamps);
      
      expect(result.updated_at).toBeInstanceOf(Date);
    });
  });

  describe('getSoftDeleteData', () => {
    it('should return deleted_at with current date', () => {
      const result = getSoftDeleteData();
      
      expect(result.deleted_at).toBeInstanceOf(Date);
    });
  });

  describe('getRestoreData', () => {
    it('should return deleted_at as null', () => {
      const result = getRestoreData();
      
      expect(result.deleted_at).toBeNull();
    });
  });

  describe('createScopeContext', () => {
    it('should return default scope context', () => {
      const context = createScopeContext();
      
      expect(context.tenantId).toBeUndefined();
      expect(context.withTrashed).toBe(false);
      expect(context.onlyTrashed).toBe(false);
    });
  });
});


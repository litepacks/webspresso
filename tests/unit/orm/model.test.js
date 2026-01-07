/**
 * Model Unit Tests
 */

const { z } = require('zod');
const {
  defineModel,
  getModel,
  getAllModels,
  hasModel,
  clearRegistry,
  unregisterModel,
  resolveRelationModel,
  getRelationKeys,
  _registry,
} = require('../../../core/orm/model');
const { createSchemaHelpers } = require('../../../core/orm/schema-helpers');

describe('Model', () => {
  const zdb = createSchemaHelpers(z);

  // Clear registry before each test
  beforeEach(() => {
    clearRegistry();
  });

  describe('defineModel', () => {
    it('should define a model with required options', () => {
      const schema = z.object({
        id: zdb.id(),
        name: zdb.string(),
      });

      const model = defineModel({
        name: 'TestModel',
        table: 'test_models',
        schema,
      });

      expect(model.name).toBe('TestModel');
      expect(model.table).toBe('test_models');
      expect(model.primaryKey).toBe('id');
      expect(model.schema).toBe(schema);
    });

    it('should use default values for optional fields', () => {
      const schema = z.object({ id: zdb.id() });
      const model = defineModel({
        name: 'Test',
        table: 'tests',
        schema,
      });

      expect(model.primaryKey).toBe('id');
      expect(model.relations).toEqual({});
      expect(model.scopes).toEqual({
        softDelete: false,
        timestamps: false,
        tenant: null,
      });
    });

    it('should extract columns from schema', () => {
      const schema = z.object({
        id: zdb.id(),
        email: zdb.string({ unique: true }),
      });

      const model = defineModel({
        name: 'User',
        table: 'users',
        schema,
      });

      expect(model.columns.size).toBe(2);
      expect(model.columns.get('id').primary).toBe(true);
      expect(model.columns.get('email').unique).toBe(true);
    });

    it('should throw error for missing name', () => {
      expect(() => defineModel({
        table: 'test',
        schema: z.object({}),
      })).toThrow('Model name is required');
    });

    it('should throw error for missing table', () => {
      expect(() => defineModel({
        name: 'Test',
        schema: z.object({}),
      })).toThrow('Model table is required');
    });

    it('should throw error for missing schema', () => {
      expect(() => defineModel({
        name: 'Test',
        table: 'tests',
      })).toThrow('Model schema is required');
    });

    it('should throw error for duplicate model name', () => {
      const schema = z.object({ id: zdb.id() });
      
      defineModel({ name: 'Duplicate', table: 'duplicates', schema });
      
      expect(() => defineModel({
        name: 'Duplicate',
        table: 'other_duplicates',
        schema,
      })).toThrow('already defined');
    });

    it('should validate relation types', () => {
      const schema = z.object({ id: zdb.id() });
      
      expect(() => defineModel({
        name: 'Bad',
        table: 'bad',
        schema,
        relations: {
          rel: { type: 'invalidType', model: () => ({}), foreignKey: 'fk' },
        },
      })).toThrow('Invalid relation type');
    });

    it('should validate relation model is function', () => {
      const schema = z.object({ id: zdb.id() });
      
      expect(() => defineModel({
        name: 'Bad2',
        table: 'bad2',
        schema,
        relations: {
          rel: { type: 'belongsTo', model: 'notAFunction', foreignKey: 'fk' },
        },
      })).toThrow('must have a model function');
    });

    it('should register model in registry', () => {
      const schema = z.object({ id: zdb.id() });
      
      defineModel({ name: 'Registered', table: 'registered', schema });
      
      expect(_registry.has('Registered')).toBe(true);
    });
  });

  describe('getModel', () => {
    it('should retrieve a registered model', () => {
      const schema = z.object({ id: zdb.id() });
      const original = defineModel({ name: 'Findable', table: 'findables', schema });
      
      const found = getModel('Findable');
      
      expect(found).toBe(original);
    });

    it('should return undefined for non-existent model', () => {
      expect(getModel('NonExistent')).toBeUndefined();
    });
  });

  describe('getAllModels', () => {
    it('should return all registered models', () => {
      const schema = z.object({ id: zdb.id() });
      
      defineModel({ name: 'Model1', table: 't1', schema });
      defineModel({ name: 'Model2', table: 't2', schema });
      
      const all = getAllModels();
      
      expect(all.size).toBe(2);
      expect(all.has('Model1')).toBe(true);
      expect(all.has('Model2')).toBe(true);
    });

    it('should return a copy of the registry', () => {
      const schema = z.object({ id: zdb.id() });
      defineModel({ name: 'Model', table: 't', schema });
      
      const all = getAllModels();
      all.delete('Model');
      
      expect(hasModel('Model')).toBe(true);
    });
  });

  describe('hasModel', () => {
    it('should return true for registered models', () => {
      const schema = z.object({ id: zdb.id() });
      defineModel({ name: 'Exists', table: 'exists', schema });
      
      expect(hasModel('Exists')).toBe(true);
    });

    it('should return false for non-existent models', () => {
      expect(hasModel('DoesNotExist')).toBe(false);
    });
  });

  describe('clearRegistry', () => {
    it('should remove all models', () => {
      const schema = z.object({ id: zdb.id() });
      defineModel({ name: 'ToClear1', table: 'tc1', schema });
      defineModel({ name: 'ToClear2', table: 'tc2', schema });
      
      clearRegistry();
      
      expect(getAllModels().size).toBe(0);
    });
  });

  describe('unregisterModel', () => {
    it('should remove a specific model', () => {
      const schema = z.object({ id: zdb.id() });
      defineModel({ name: 'ToRemove', table: 'tr', schema });
      
      const removed = unregisterModel('ToRemove');
      
      expect(removed).toBe(true);
      expect(hasModel('ToRemove')).toBe(false);
    });

    it('should return false for non-existent model', () => {
      expect(unregisterModel('NonExistent')).toBe(false);
    });
  });

  describe('resolveRelationModel', () => {
    it('should resolve lazy model reference', () => {
      const schema = z.object({ id: zdb.id() });
      const Related = defineModel({ name: 'Related', table: 'related', schema });
      
      const relation = {
        type: 'belongsTo',
        model: () => Related,
        foreignKey: 'related_id',
      };

      const resolved = resolveRelationModel(relation);
      
      expect(resolved).toBe(Related);
    });
  });

  describe('getRelationKeys', () => {
    it('should return relation keys for belongsTo', () => {
      const schema = z.object({
        id: zdb.id(),
        company_id: zdb.foreignKey('companies'),
      });

      const Company = defineModel({ name: 'Company', table: 'companies', schema: z.object({ id: zdb.id() }) });
      
      const User = defineModel({
        name: 'User',
        table: 'users',
        schema,
        relations: {
          company: {
            type: 'belongsTo',
            model: () => Company,
            foreignKey: 'company_id',
          },
        },
      });

      const keys = getRelationKeys(User, 'company');
      
      expect(keys.localKey).toBe('id');
      expect(keys.foreignKey).toBe('company_id');
      expect(keys.relatedModel).toBe(Company);
    });

    it('should throw for non-existent relation', () => {
      const schema = z.object({ id: zdb.id() });
      const model = defineModel({ name: 'NoRel', table: 'norel', schema });
      
      expect(() => getRelationKeys(model, 'nonexistent')).toThrow('not found');
    });
  });
});


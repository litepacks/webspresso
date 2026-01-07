/**
 * Schema Explorer Plugin Unit Tests
 */

const { z } = require('zod');
const { createSchemaHelpers, defineModel, clearRegistry } = require('../../../core/orm');
const schemaExplorerPlugin = require('../../../plugins/schema-explorer');

describe('Schema Explorer Plugin', () => {
  const zdb = createSchemaHelpers(z);

  beforeEach(() => {
    clearRegistry();
  });

  describe('plugin creation', () => {
    it('should create plugin with default options', () => {
      const plugin = schemaExplorerPlugin();

      expect(plugin.name).toBe('schema-explorer');
      expect(plugin.version).toBe('1.0.0');
      expect(plugin.api).toBeDefined();
      expect(plugin.onRoutesReady).toBeDefined();
    });

    it('should accept custom path option', () => {
      const plugin = schemaExplorerPlugin({ path: '/api/models' });

      expect(plugin.name).toBe('schema-explorer');
    });
  });

  describe('plugin API', () => {
    it('should return empty array when no models defined', () => {
      const plugin = schemaExplorerPlugin();

      expect(plugin.api.getModels()).toEqual([]);
      expect(plugin.api.getModelNames()).toEqual([]);
    });

    it('should return all models', () => {
      const schema = z.object({
        id: zdb.id(),
        name: zdb.string(),
      });

      defineModel({ name: 'User', table: 'users', schema });
      defineModel({ name: 'Post', table: 'posts', schema });

      const plugin = schemaExplorerPlugin();
      const models = plugin.api.getModels();

      expect(models).toHaveLength(2);
      expect(models.map(m => m.name).sort()).toEqual(['Post', 'User']);
    });

    it('should exclude specified models', () => {
      const schema = z.object({ id: zdb.id() });

      defineModel({ name: 'User', table: 'users', schema });
      defineModel({ name: 'Secret', table: 'secrets', schema });

      const plugin = schemaExplorerPlugin({ exclude: ['Secret'] });
      const models = plugin.api.getModels();

      expect(models).toHaveLength(1);
      expect(models[0].name).toBe('User');
    });

    it('should get single model by name', () => {
      const schema = z.object({
        id: zdb.id(),
        email: zdb.string({ unique: true }),
      });

      defineModel({ name: 'User', table: 'users', schema });

      const plugin = schemaExplorerPlugin();
      const model = plugin.api.getModel('User');

      expect(model).not.toBeNull();
      expect(model.name).toBe('User');
      expect(model.table).toBe('users');
    });

    it('should return null for non-existent model', () => {
      const plugin = schemaExplorerPlugin();
      const model = plugin.api.getModel('NonExistent');

      expect(model).toBeNull();
    });

    it('should return model names', () => {
      const schema = z.object({ id: zdb.id() });

      defineModel({ name: 'Alpha', table: 'alphas', schema });
      defineModel({ name: 'Beta', table: 'betas', schema });

      const plugin = schemaExplorerPlugin();
      const names = plugin.api.getModelNames();

      expect(names.sort()).toEqual(['Alpha', 'Beta']);
    });
  });

  describe('model serialization', () => {
    it('should serialize column metadata', () => {
      const schema = z.object({
        id: zdb.id(),
        email: zdb.string({ unique: true, index: true, maxLength: 255 }),
        status: zdb.enum(['active', 'inactive'], { default: 'active' }),
        bio: zdb.text({ nullable: true }),
      });

      defineModel({ name: 'User', table: 'users', schema });

      const plugin = schemaExplorerPlugin();
      const model = plugin.api.getModel('User');

      expect(model.columns).toHaveLength(4);

      const idCol = model.columns.find(c => c.name === 'id');
      expect(idCol.type).toBe('bigint');
      expect(idCol.primary).toBe(true);
      expect(idCol.autoIncrement).toBe(true);

      const emailCol = model.columns.find(c => c.name === 'email');
      expect(emailCol.type).toBe('string');
      expect(emailCol.unique).toBe(true);
      expect(emailCol.index).toBe(true);
      expect(emailCol.maxLength).toBe(255);

      const statusCol = model.columns.find(c => c.name === 'status');
      expect(statusCol.type).toBe('enum');
      expect(statusCol.enumValues).toEqual(['active', 'inactive']);
      expect(statusCol.default).toBe('active');

      const bioCol = model.columns.find(c => c.name === 'bio');
      expect(bioCol.nullable).toBe(true);
    });

    it('should serialize relation metadata', () => {
      const companySchema = z.object({ id: zdb.id(), name: zdb.string() });
      const Company = defineModel({ name: 'Company', table: 'companies', schema: companySchema });

      const userSchema = z.object({
        id: zdb.id(),
        company_id: zdb.foreignKey('companies'),
      });

      defineModel({
        name: 'User',
        table: 'users',
        schema: userSchema,
        relations: {
          company: { type: 'belongsTo', model: () => Company, foreignKey: 'company_id' },
        },
      });

      const plugin = schemaExplorerPlugin();
      const model = plugin.api.getModel('User');

      expect(model.relations).toHaveLength(1);
      expect(model.relations[0]).toEqual({
        name: 'company',
        type: 'belongsTo',
        relatedModel: 'Company',
        foreignKey: 'company_id',
        localKey: 'id',
      });
    });

    it('should serialize scope configuration', () => {
      const schema = z.object({
        id: zdb.id(),
        deleted_at: zdb.timestamp({ nullable: true }),
      });

      defineModel({
        name: 'User',
        table: 'users',
        schema,
        scopes: {
          softDelete: true,
          timestamps: true,
          tenant: 'tenant_id',
        },
      });

      const plugin = schemaExplorerPlugin();
      const model = plugin.api.getModel('User');

      expect(model.scopes).toEqual({
        softDelete: true,
        timestamps: true,
        tenant: 'tenant_id',
      });
    });

    it('should optionally exclude columns', () => {
      const schema = z.object({ id: zdb.id() });
      defineModel({ name: 'User', table: 'users', schema });

      const plugin = schemaExplorerPlugin({ includeColumns: false });
      const model = plugin.api.getModel('User');

      expect(model.columns).toBeUndefined();
    });

    it('should optionally exclude relations', () => {
      const schema = z.object({ id: zdb.id() });
      defineModel({
        name: 'User',
        table: 'users',
        schema,
        relations: {
          posts: { type: 'hasMany', model: () => ({}), foreignKey: 'user_id' },
        },
      });

      const plugin = schemaExplorerPlugin({ includeRelations: false });
      const model = plugin.api.getModel('User');

      expect(model.relations).toBeUndefined();
    });

    it('should optionally exclude scopes', () => {
      const schema = z.object({ id: zdb.id() });
      defineModel({
        name: 'User',
        table: 'users',
        schema,
        scopes: { softDelete: true },
      });

      const plugin = schemaExplorerPlugin({ includeScopes: false });
      const model = plugin.api.getModel('User');

      expect(model.scopes).toBeUndefined();
    });
  });

  describe('complex schema', () => {
    it('should handle full model with all features', () => {
      // Company model
      const companySchema = z.object({
        id: zdb.id(),
        name: zdb.string({ maxLength: 255 }),
        slug: zdb.string({ unique: true }),
        created_at: zdb.timestamp({ auto: 'create' }),
      });

      const Company = defineModel({
        name: 'Company',
        table: 'companies',
        schema: companySchema,
        scopes: { timestamps: true },
      });

      // User model with relations
      const userSchema = z.object({
        id: zdb.id(),
        email: zdb.string({ unique: true, index: true }),
        name: zdb.string(),
        role: zdb.enum(['admin', 'user', 'guest'], { default: 'user' }),
        company_id: zdb.foreignKey('companies', { nullable: true }),
        metadata: zdb.json({ nullable: true }),
        created_at: zdb.timestamp({ auto: 'create' }),
        updated_at: zdb.timestamp({ auto: 'update' }),
        deleted_at: zdb.timestamp({ nullable: true }),
      });

      const User = defineModel({
        name: 'User',
        table: 'users',
        schema: userSchema,
        relations: {
          company: { type: 'belongsTo', model: () => Company, foreignKey: 'company_id' },
        },
        scopes: { softDelete: true, timestamps: true },
      });

      // Post model
      const postSchema = z.object({
        id: zdb.id(),
        title: zdb.string({ maxLength: 500 }),
        content: zdb.text({ nullable: true }),
        user_id: zdb.foreignKey('users'),
        published_at: zdb.datetime({ nullable: true }),
      });

      defineModel({
        name: 'Post',
        table: 'posts',
        schema: postSchema,
        relations: {
          author: { type: 'belongsTo', model: () => User, foreignKey: 'user_id' },
        },
      });

      const plugin = schemaExplorerPlugin();
      const models = plugin.api.getModels();

      expect(models).toHaveLength(3);

      // Check User model
      const user = models.find(m => m.name === 'User');
      expect(user.columns).toHaveLength(9);
      expect(user.relations).toHaveLength(1);
      expect(user.scopes.softDelete).toBe(true);

      // Check relation points to correct model
      const companyRelation = user.relations.find(r => r.name === 'company');
      expect(companyRelation.relatedModel).toBe('Company');
      expect(companyRelation.type).toBe('belongsTo');
    });
  });
});


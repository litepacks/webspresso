/**
 * Schema Explorer Plugin Integration Tests
 */

const request = require('supertest');
const express = require('express');
const { z } = require('zod');
const { zdb, defineModel, clearRegistry } = require('../../core/orm');
const schemaExplorerPlugin = require('../../plugins/schema-explorer');

describe('Schema Explorer Plugin Integration', () => {
  let app;

  beforeEach(() => {
    clearRegistry();
    app = express();
    app.use(express.json());
  });

  /**
   * Helper to setup plugin routes
   */
  function setupPlugin(options = {}) {
    const plugin = schemaExplorerPlugin({ enabled: true, ...options });

    // Simulate onRoutesReady context
    const ctx = {
      addRoute: (method, path, handler) => {
        app[method](path, handler);
      },
    };

    plugin.onRoutesReady(ctx);
    return plugin;
  }

  describe('GET /_schema', () => {
    it('should return all models', async () => {
      const schema = z.object({
        id: zdb.id(),
        name: zdb.string(),
      });

      defineModel({ name: 'User', table: 'users', schema });
      defineModel({ name: 'Post', table: 'posts', schema });

      setupPlugin();

      const res = await request(app)
        .get('/_schema')
        .expect(200);

      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.modelCount).toBe(2);
      expect(res.body.models).toHaveLength(2);
    });

    it('should include column metadata', async () => {
      const schema = z.object({
        id: zdb.id(),
        email: zdb.string({ unique: true }),
        status: zdb.enum(['active', 'inactive']),
      });

      defineModel({ name: 'User', table: 'users', schema });

      setupPlugin();

      const res = await request(app)
        .get('/_schema')
        .expect(200);

      const user = res.body.models[0];
      expect(user.columns).toHaveLength(3);

      const emailCol = user.columns.find(c => c.name === 'email');
      expect(emailCol.unique).toBe(true);
    });

    it('should respect exclude option', async () => {
      const schema = z.object({ id: zdb.id() });

      defineModel({ name: 'User', table: 'users', schema });
      defineModel({ name: 'Secret', table: 'secrets', schema });

      setupPlugin({ exclude: ['Secret'] });

      const res = await request(app)
        .get('/_schema')
        .expect(200);

      expect(res.body.models).toHaveLength(1);
      expect(res.body.models[0].name).toBe('User');
    });

    it('should work with custom path', async () => {
      const schema = z.object({ id: zdb.id() });
      defineModel({ name: 'User', table: 'users', schema });

      setupPlugin({ path: '/api/models' });

      const res = await request(app)
        .get('/api/models')
        .expect(200);

      expect(res.body.models).toHaveLength(1);
    });
  });

  describe('GET /_schema/:modelName', () => {
    it('should return single model', async () => {
      const schema = z.object({
        id: zdb.id(),
        email: zdb.string({ unique: true }),
      });

      defineModel({ name: 'User', table: 'users', schema });

      setupPlugin();

      const res = await request(app)
        .get('/_schema/User')
        .expect(200);

      expect(res.body.model.name).toBe('User');
      expect(res.body.model.table).toBe('users');
      expect(res.body.model.columns).toHaveLength(2);
    });

    it('should return 404 for non-existent model', async () => {
      setupPlugin();

      const res = await request(app)
        .get('/_schema/NonExistent')
        .expect(404);

      expect(res.body.error).toContain('not found');
    });

    it('should return 404 for excluded model', async () => {
      const schema = z.object({ id: zdb.id() });
      defineModel({ name: 'Secret', table: 'secrets', schema });

      setupPlugin({ exclude: ['Secret'] });

      const res = await request(app)
        .get('/_schema/Secret')
        .expect(404);

      expect(res.body.error).toContain('not found');
    });
  });

  describe('GET /_schema/openapi', () => {
    it('should return OpenAPI schema', async () => {
      const schema = z.object({
        id: zdb.id(),
        email: zdb.string({ maxLength: 255 }),
        age: zdb.integer({ nullable: true }),
        status: zdb.enum(['active', 'inactive']),
        created_at: zdb.timestamp({ auto: 'create' }),
      });

      defineModel({ name: 'User', table: 'users', schema });

      setupPlugin();

      const res = await request(app)
        .get('/_schema/openapi')
        .expect(200);

      expect(res.body.openapi).toBe('3.0.0');
      expect(res.body.components.schemas.User).toBeDefined();
      expect(res.body.components.schemas.UserInput).toBeDefined();

      // Check User schema
      const userSchema = res.body.components.schemas.User;
      expect(userSchema.type).toBe('object');
      expect(userSchema.properties.id.type).toBe('integer');
      expect(userSchema.properties.email.type).toBe('string');
      expect(userSchema.properties.email.maxLength).toBe(255);
      expect(userSchema.properties.age.nullable).toBe(true);
      expect(userSchema.properties.status.enum).toEqual(['active', 'inactive']);
      expect(userSchema.properties.created_at.format).toBe('date-time');

      // Check UserInput doesn't have auto fields
      const inputSchema = res.body.components.schemas.UserInput;
      expect(inputSchema.properties.id).toBeUndefined();
      expect(inputSchema.properties.created_at).toBeUndefined();
    });

    it('should handle all column types', async () => {
      const schema = z.object({
        id: zdb.uuid(),
        count: zdb.bigint(),
        price: zdb.decimal({ precision: 10, scale: 2 }),
        rate: zdb.float(),
        active: zdb.boolean({ default: true }),
        birth_date: zdb.date(),
        metadata: zdb.json({ nullable: true }),
        content: zdb.text(),
        parent_id: zdb.foreignNanoid('parents', { nullable: true }),
      });

      defineModel({ name: 'Test', table: 'tests', schema });

      setupPlugin();

      const res = await request(app)
        .get('/_schema/openapi')
        .expect(200);

      const props = res.body.components.schemas.Test.properties;
      expect(props.id.format).toBe('uuid');
      expect(props.count.format).toBe('int64');
      expect(props.price.type).toBe('number');
      expect(props.rate.type).toBe('number');
      expect(props.active.type).toBe('boolean');
      expect(props.active.default).toBe(true);
      expect(props.birth_date.format).toBe('date');
      expect(props.metadata.type).toBe('object');
      expect(props.content.type).toBe('string');
      expect(props.parent_id.type).toBe('string');
      expect(props.parent_id.maxLength).toBe(21);
    });
  });

  describe('authorization', () => {
    it('should allow access when authorize returns true', async () => {
      const schema = z.object({ id: zdb.id() });
      defineModel({ name: 'User', table: 'users', schema });

      setupPlugin({
        authorize: (req) => req.headers['x-api-key'] === 'secret',
      });

      const res = await request(app)
        .get('/_schema')
        .set('X-API-Key', 'secret')
        .expect(200);

      expect(res.body.models).toHaveLength(1);
    });

    it('should deny access when authorize returns false', async () => {
      const schema = z.object({ id: zdb.id() });
      defineModel({ name: 'User', table: 'users', schema });

      setupPlugin({
        authorize: (req) => req.headers['x-api-key'] === 'secret',
      });

      const res = await request(app)
        .get('/_schema')
        .expect(403);

      expect(res.body.error).toBe('Forbidden');
    });

    it('should apply authorization to all endpoints', async () => {
      const schema = z.object({ id: zdb.id() });
      defineModel({ name: 'User', table: 'users', schema });

      setupPlugin({
        authorize: () => false,
      });

      await request(app).get('/_schema').expect(403);
      await request(app).get('/_schema/User').expect(403);
      await request(app).get('/_schema/openapi').expect(403);
    });
  });

  describe('relations in schema', () => {
    it('should include relation metadata', async () => {
      const companySchema = z.object({
        id: zdb.id(),
        name: zdb.string(),
      });

      const Company = defineModel({
        name: 'Company',
        table: 'companies',
        schema: companySchema,
      });

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

      setupPlugin();

      const res = await request(app)
        .get('/_schema/User')
        .expect(200);

      expect(res.body.model.relations).toHaveLength(1);
      expect(res.body.model.relations[0]).toEqual({
        name: 'company',
        type: 'belongsTo',
        relatedModel: 'Company',
        foreignKey: 'company_id',
        localKey: 'id',
      });
    });
  });
});


/**
 * Integration tests for Schema Explorer Admin Module
 * Tests integration of schemaExplorerPlugin with adminPanelPlugin
 * @vitest-environment node
 */

const request = require('supertest');
const path = require('path');
const { createApp } = require('../../src/server.js');
const { createDatabase, defineModel, zdb, clearRegistry } = require('../../index.js');
const { adminPanelPlugin, schemaExplorerPlugin } = require('../../plugins/index.js');

describe('Schema Explorer Admin Plugin Integration', () => {
  let app;
  let db;
  let sharedCookie;

  beforeAll(async () => {
    clearRegistry();

    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
      models: './tests/fixtures/models-empty',
    });

    await db.knex.schema.createTable('admin_users', (table) => {
      table.bigIncrements('id');
      table.string('email').unique();
      table.string('password');
      table.string('name');
      table.string('role').defaultTo('admin');
      table.boolean('active').defaultTo(true);
      table.timestamp('created_at');
      table.timestamp('updated_at');
    });

    // Define models with relations
    const Department = defineModel({
      name: 'Department',
      table: 'departments',
      schema: zdb.schema({
        id: zdb.id(),
        name: zdb.string(),
      }),
      admin: { enabled: true },
    });

    defineModel({
      name: 'Employee',
      table: 'employees',
      schema: zdb.schema({
        id: zdb.id(),
        name: zdb.string(),
        department_id: zdb.foreignKey('departments'),
      }),
      relations: {
        department: {
          type: 'belongsTo',
          model: () => Department,
          foreignKey: 'department_id',
        },
      },
      scopes: {
        timestamps: true,
        softDelete: true,
      },
      admin: { enabled: true },
    });

    const emptyPagesDir = path.join(__dirname, '../fixtures/empty-pages');
    const result = createApp({
      pagesDir: emptyPagesDir,
      viewsDir: './tests/fixtures/views',
      silent: true,
      helmet: false,
      compression: false,
      cache: false,
      healthCheck: false,
      metrics: false,
      lazyRoutes: true,
      plugins: [
        adminPanelPlugin({ db }),
        schemaExplorerPlugin({
          admin: true,
          adminPath: '/schema',
          menuLabel: 'Schema Explorer',
        }),
      ],
    });

    app = result.app;

    await db.knex('admin_users').insert({
      email: 'admin@webspresso.local',
      password: '$2b$04$Wuy3PNKivlnz5etS8gSaoeMqE7OUaMbnKcBRjSD0AxL.Qrd5hTAAK',
      name: 'Admin Tester',
      role: 'admin',
      active: true,
    });

    const loginRes = await request(app)
      .post('/_admin/api/auth/login')
      .send({
        email: 'admin@webspresso.local',
        password: 'password123',
      });
    expect(loginRes.status).toBe(200);

    sharedCookie = loginRes.headers['set-cookie'];
  });

  afterAll(async () => {
    if (db && db.destroy) {
      await db.destroy();
    }
  });

  describe('Admin UI Page route', () => {
    it('serves the admin panel HTML on GET /_admin/schema', async () => {
      const res = await request(app)
        .get('/_admin/schema')
        .set('Cookie', sharedCookie);

      expect(res.status).toBe(200);
      expect(res.text).toContain('<!DOCTYPE html>');
      expect(res.text).toContain('schema-explorer');
    });
  });

  describe('Admin API routes (/_admin/api/schema/*)', () => {
    it('GET /_admin/api/schema returns all models, columns, relations, and mermaid ER code', async () => {
      const res = await request(app)
        .get('/_admin/api/schema')
        .set('Cookie', sharedCookie);

      expect(res.status).toBe(200);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.modelCount).toBeGreaterThanOrEqual(2);
      expect(res.body.models).toBeDefined();
      expect(res.body.relationships).toBeDefined();
      expect(res.body.mermaid).toBeDefined();

      const emp = res.body.models.find(m => m.name === 'Employee');
      expect(emp).toBeDefined();
      expect(emp.table).toBe('employees');
      expect(emp.scopes.timestamps).toBe(true);
      expect(emp.scopes.softDelete).toBe(true);
      expect(emp.outgoingRelations).toHaveLength(1);
      expect(emp.outgoingRelations[0].targetModel).toBe('Department');

      const dept = res.body.models.find(m => m.name === 'Department');
      expect(dept).toBeDefined();
      expect(dept.incomingRelations).toHaveLength(1);
      expect(dept.incomingRelations[0].sourceModel).toBe('Employee');

      expect(res.body.mermaid).toContain('erDiagram');
      expect(res.body.mermaid).toContain('Employee }o--|| Department');
    });

    it('GET /_admin/api/schema/relations returns relationship edge list', async () => {
      const res = await request(app)
        .get('/_admin/api/schema/relations')
        .set('Cookie', sharedCookie);

      expect(res.status).toBe(200);
      expect(res.body.relationships).toBeDefined();
      const rel = res.body.relationships.find(r => r.sourceModel === 'Employee');
      expect(rel).toBeDefined();
      expect(rel.type).toBe('belongsTo');
      expect(rel.targetModel).toBe('Department');
      expect(rel.foreignKey).toBe('department_id');
    });

    it('GET /_admin/api/schema/mermaid returns Mermaid ER code', async () => {
      const res = await request(app)
        .get('/_admin/api/schema/mermaid')
        .set('Cookie', sharedCookie);

      expect(res.status).toBe(200);
      expect(res.body.mermaid).toContain('erDiagram');
      expect(res.body.mermaid).toContain('Department {');
      expect(res.body.mermaid).toContain('Employee {');
    });

    it('GET /_admin/api/schema/models/:modelName returns specific enriched model', async () => {
      const res = await request(app)
        .get('/_admin/api/schema/models/Employee')
        .set('Cookie', sharedCookie);

      expect(res.status).toBe(200);
      expect(res.body.model).toBeDefined();
      expect(res.body.model.name).toBe('Employee');
      expect(res.body.model.outgoingRelations).toHaveLength(1);
      expect(res.body.model.connectedModels).toContain('Department');
    });

    it('GET /_admin/api/schema/models/:modelName returns 404 for unknown model', async () => {
      const res = await request(app)
        .get('/_admin/api/schema/models/NonExistentModel')
        .set('Cookie', sharedCookie);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });
});

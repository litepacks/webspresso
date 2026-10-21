/**
 * Database Storage & Health Widget Unit Tests
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
const knex = require('knex');
const vm = require('vm');
const {
  collectDatabaseStorageStats,
  registerDashboardWidgets,
  generateDashboardComponent,
} = require('../../../plugins/admin-panel/modules/dashboard');

describe('Database Storage & Health Widget', () => {
  let db;

  beforeAll(async () => {
    const k = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    // Create sample tables
    await k.schema.createTable('users', (t) => {
      t.increments('id');
      t.string('email');
    });

    await k.schema.createTable('posts', (t) => {
      t.increments('id');
      t.string('title');
    });

    await k.schema.createTable('audit_logs', (t) => {
      t.increments('id');
      t.string('action');
      t.timestamp('created_at').defaultTo(k.fn.now());
    });

    // Insert dummy records
    await k('users').insert([{ email: 'user1@test.com' }, { email: 'user2@test.com' }]);
    await k('posts').insert([{ title: 'First Post' }]);

    db = {
      knex: k,
      getAllModels: () => [
        { name: 'User', table: 'users', admin: { enabled: true, label: 'Users' } },
        { name: 'Post', table: 'posts', admin: { enabled: true, label: 'Posts' } },
      ],
      getModel: () => null,
      getRepository: (name) => ({
        count: async () => (name === 'User' ? 2 : 1),
        query: () => ({
          orderBy: () => ({
            first: async () => null,
          }),
        }),
      }),
    };
  });

  afterAll(async () => {
    if (db && db.knex) {
      await db.knex.destroy();
    }
  });

  describe('collectDatabaseStorageStats', () => {
    it('handles null or missing db gracefully', async () => {
      const stats = await collectDatabaseStorageStats(null);
      expect(stats.engine).toBe('Unknown');
      expect(stats.totalTables).toBe(0);
      expect(stats.totalRows).toBe(0);
      expect(stats.overallHealth).toBe('healthy');
      expect(stats.tables).toEqual([]);
    });

    it('collects table counts and engine statistics for SQLite', async () => {
      const stats = await collectDatabaseStorageStats(db);

      expect(stats.engine).toBe('SQLite');
      expect(stats.totalTables).toBeGreaterThanOrEqual(3);
      expect(stats.totalRows).toBe(3); // 2 users + 1 post + 0 audit_logs
      expect(stats.overallHealth).toBe('healthy');

      // Check table categorization
      const userTable = stats.tables.find((t) => t.table === 'users');
      expect(userTable).toBeDefined();
      expect(userTable.count).toBe(2);
      expect(userTable.category).toBe('orm');
      expect(userTable.modelName).toBe('User');

      const auditTable = stats.tables.find((t) => t.table === 'audit_logs');
      expect(auditTable).toBeDefined();
      expect(auditTable.category).toBe('logs');

      // SQLite PRAGMA storage info
      expect(stats.sqliteInfo).not.toBeNull();
      expect(stats.sqliteInfo.pageSize).toBeGreaterThan(0);
      expect(stats.sqliteInfo.pageCount).toBeGreaterThanOrEqual(1);
    });

    it('flags high-volume log tables and marks health as attention', async () => {
      const highVolumeDb = {
        knex: Object.assign(
          (table) => ({
            count: () => ({
              first: async () => ({ count: 35000 }),
            }),
          }),
          {
            client: { config: { client: 'better-sqlite3' } },
            schema: {
              hasTable: async (t) => t === 'audit_logs',
            },
            raw: async () => [{ name: 'audit_logs' }],
            destroy: async () => {},
          }
        ),
        getAllModels: () => [],
      };

      const stats = await collectDatabaseStorageStats(highVolumeDb);
      expect(stats.overallHealth).toBe('attention');

      const auditTable = stats.tables.find((t) => t.table === 'audit_logs');
      expect(auditTable.count).toBe(35000);
      expect(auditTable.isHighVolume).toBe(true);
    });
  });

  describe('registerDashboardWidgets', () => {
    it('registers database-storage widget with order 15 and size full', async () => {
      const widgets = {};
      const registry = {
        registerWidget: (id, config) => {
          widgets[id] = config;
        },
      };

      registerDashboardWidgets({ registry, db });

      expect(widgets['database-storage']).toBeDefined();
      expect(widgets['database-storage'].title).toBe('Database Storage & Health');
      expect(widgets['database-storage'].size).toBe('full');
      expect(widgets['database-storage'].order).toBe(15);

      const data = await widgets['database-storage'].dataLoader({ db });
      expect(data.engine).toBe('SQLite');
      expect(data.totalRows).toBe(3);
    });
  });

  describe('Client Widget Renderer', () => {
    it('renders database-storage metrics and progress breakdown in Mithril tree', () => {
      const code = generateDashboardComponent();
      const m = (selector, attrsOrChildren, maybeChildren) => {
        let attrs = {};
        let children = [];
        if (attrsOrChildren && typeof attrsOrChildren === 'object' && !Array.isArray(attrsOrChildren) && !attrsOrChildren.tag) {
          attrs = attrsOrChildren;
          children = Array.isArray(maybeChildren) ? maybeChildren : (maybeChildren !== undefined ? [maybeChildren] : []);
        } else if (Array.isArray(attrsOrChildren)) {
          children = attrsOrChildren;
        } else if (attrsOrChildren !== undefined) {
          children = [attrsOrChildren];
        }

        return {
          tag: selector,
          attrs,
          children: children.flat ? children.flat() : children,
        };
      };

      const context = {
        m,
        WidgetRenderers: null,
        formatDate: () => '',
        Icon: { view: () => null },
        runAdminAutoRefresh: () => () => {},
        api: { get: async () => ({}) },
      };

      vm.createContext(context);
      vm.runInContext(code + '\n;globalThis.WidgetRenderers = WidgetRenderers;', context);

      const renderer = context.WidgetRenderers['database-storage'];
      expect(renderer).toBeDefined();

      const sampleData = {
        engine: 'SQLite',
        totalTables: 4,
        totalRows: 1200,
        overallHealth: 'healthy',
        sqliteInfo: { sizeBytes: 1048576 },
        tables: [
          { table: 'posts', count: 1000, category: 'orm', modelName: 'Post', isHighVolume: false },
          { table: 'users', count: 200, category: 'orm', modelName: 'User', isHighVolume: false },
        ],
      };

      const tree = renderer.render(sampleData);
      const jsonStr = JSON.stringify(tree);

      expect(jsonStr).toContain('Database Engine');
      expect(jsonStr).toContain('SQLite');
      expect(jsonStr).toContain('Total Tables');
      expect(jsonStr).toContain('Total Records');
      expect(jsonStr).toContain('1,200');
      expect(jsonStr).toContain('Healthy');
      expect(jsonStr).toContain('posts');
      expect(jsonStr).toContain('users');
      expect(jsonStr).toContain('ORM');
    });
  });
});

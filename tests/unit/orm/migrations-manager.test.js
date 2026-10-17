import { describe, it, expect, vi } from 'vitest';
import {
  createMigrationManager,
  getDefaultMigrationTemplate,
  diffSchema,
  makeMigrations,
} from '../../../core/orm/migrations';

describe('core/orm/migrations/index', () => {
  describe('createMigrationManager', () => {
    it('initializes with default config and provides getConfig()', () => {
      const mockKnex = {
        migrate: {},
        schema: {},
      };
      const manager = createMigrationManager(mockKnex);
      expect(manager.getConfig()).toEqual({
        directory: './migrations',
        tableName: 'knex_migrations',
      });
    });

    it('initializes with custom config', () => {
      const mockKnex = { migrate: {}, schema: {} };
      const manager = createMigrationManager(mockKnex, {
        directory: './custom-migrations',
        tableName: 'my_migrations',
      });
      expect(manager.getConfig()).toEqual({
        directory: './custom-migrations',
        tableName: 'my_migrations',
      });
    });

    it('latest runs knex.migrate.latest with config', async () => {
      const mockLatest = vi.fn().mockResolvedValue([1, ['20261017_init.js']]);
      const mockKnex = {
        migrate: { latest: mockLatest },
      };
      const manager = createMigrationManager(mockKnex, { directory: './mig', tableName: 't_mig' });
      const result = await manager.latest();
      expect(mockLatest).toHaveBeenCalledWith({ directory: './mig', tableName: 't_mig' });
      expect(result).toEqual({ batch: 1, migrations: ['20261017_init.js'] });
    });

    it('rollback runs knex.migrate.rollback with default and all=true', async () => {
      const mockRollback = vi.fn().mockResolvedValue([1, ['20261017_init.js']]);
      const mockKnex = {
        migrate: { rollback: mockRollback },
      };
      const manager = createMigrationManager(mockKnex, { directory: './mig', tableName: 't_mig' });

      // Default rollback
      const res1 = await manager.rollback();
      expect(mockRollback).toHaveBeenCalledWith({ directory: './mig', tableName: 't_mig' });
      expect(res1).toEqual({ batch: 1, migrations: ['20261017_init.js'] });

      // Rollback all
      mockRollback.mockClear();
      const res2 = await manager.rollback({ all: true });
      expect(mockRollback).toHaveBeenCalledWith({ directory: './mig', tableName: 't_mig', all: true });
      expect(res2).toEqual({ batch: 1, migrations: ['20261017_init.js'] });
    });

    it('currentVersion returns knex.migrate.currentVersion', async () => {
      const mockVersion = vi.fn().mockResolvedValue('20261017_add_users.js');
      const mockKnex = {
        migrate: { currentVersion: mockVersion },
      };
      const manager = createMigrationManager(mockKnex, { directory: './mig', tableName: 't_mig' });
      const version = await manager.currentVersion();
      expect(mockVersion).toHaveBeenCalledWith({ directory: './mig', tableName: 't_mig' });
      expect(version).toBe('20261017_add_users.js');
    });

    it('status parses and sorts completed and pending migrations', async () => {
      const completedList = [
        { name: '20261002_profiles.js', migration_time: '2026-10-02T10:00:00Z', batch: 2 },
        '20261001_users.js', // string format fallback
      ];
      const pendingList = [
        { name: '20261003_posts.js' },
        '20261004_comments.js', // string format fallback
      ];

      const mockList = vi.fn().mockResolvedValue([completedList, pendingList]);
      const mockKnex = {
        migrate: { list: mockList },
      };
      const manager = createMigrationManager(mockKnex, { directory: './mig', tableName: 't_mig' });

      const statuses = await manager.status();
      expect(mockList).toHaveBeenCalledWith({ directory: './mig', tableName: 't_mig' });
      expect(statuses).toEqual([
        {
          name: '20261001_users.js',
          completed: true,
          ran_at: null,
          batch: null,
        },
        {
          name: '20261002_profiles.js',
          completed: true,
          ran_at: '2026-10-02T10:00:00Z',
          batch: 2,
        },
        {
          name: '20261003_posts.js',
          completed: false,
          ran_at: null,
          batch: null,
        },
        {
          name: '20261004_comments.js',
          completed: false,
          ran_at: null,
          batch: null,
        },
      ]);
    });

    it('make creates custom content migration object', async () => {
      const mockKnex = { migrate: {} };
      const manager = createMigrationManager(mockKnex, { directory: './migrations' });
      const res = await manager.make('add_orders', { content: '// custom migration' });

      expect(res.filename).toMatch(/^\d{8}_\d{6}_add_orders\.js$/);
      expect(res.filepath).toBe(`./migrations/${res.filename}`);
      expect(res.content).toBe('// custom migration');
    });

    it('make delegates to knex.migrate.make when no content is provided', async () => {
      const mockMake = vi.fn().mockResolvedValue('/app/migrations/20261017_default.js');
      const mockKnex = {
        migrate: { make: mockMake },
      };
      const manager = createMigrationManager(mockKnex, { directory: './migrations', tableName: 'knex_migrations' });
      const res = await manager.make('default_migration');

      expect(mockMake).toHaveBeenCalledWith('default_migration', { directory: './migrations', tableName: 'knex_migrations' });
      expect(res).toEqual({
        filename: '20261017_default.js',
        filepath: '/app/migrations/20261017_default.js',
        content: null,
      });
    });

    it('up runs knex.migrate.up with migration name', async () => {
      const mockUp = vi.fn().mockResolvedValue();
      const mockKnex = {
        migrate: { up: mockUp },
      };
      const manager = createMigrationManager(mockKnex, { directory: './mig', tableName: 't_mig' });
      await manager.up('20261017_test.js');
      expect(mockUp).toHaveBeenCalledWith({ directory: './mig', tableName: 't_mig', name: '20261017_test.js' });
    });

    it('down runs knex.migrate.down with migration name', async () => {
      const mockDown = vi.fn().mockResolvedValue();
      const mockKnex = {
        migrate: { down: mockDown },
      };
      const manager = createMigrationManager(mockKnex, { directory: './mig', tableName: 't_mig' });
      await manager.down('20261017_test.js');
      expect(mockDown).toHaveBeenCalledWith({ directory: './mig', tableName: 't_mig', name: '20261017_test.js' });
    });

    it('hasTable queries knex.schema.hasTable', async () => {
      const mockHasTable = vi.fn().mockResolvedValue(true);
      const mockKnex = {
        schema: { hasTable: mockHasTable },
      };
      const manager = createMigrationManager(mockKnex, { tableName: 'custom_migrations_tbl' });
      const exists = await manager.hasTable();
      expect(mockHasTable).toHaveBeenCalledWith('custom_migrations_tbl');
      expect(exists).toBe(true);
    });

    it('diff delegates to diffSchema', async () => {
      const mockKnex = { schema: {}, migrate: {} };
      const manager = createMigrationManager(mockKnex);
      const diffResult = await manager.diff({ models: [] });
      expect(diffResult).toHaveProperty('hasChanges');
      expect(diffResult).toHaveProperty('changes');
    });

    it('makeMigrations delegates to makeMigrations helper', async () => {
      const mockKnex = { schema: {}, migrate: {} };
      const manager = createMigrationManager(mockKnex, { directory: './migrations' });
      const result = await manager.makeMigrations({ models: [] });
      expect(result).toHaveProperty('hasChanges');
      expect(result).toHaveProperty('created');
      expect(result).toHaveProperty('skipped');
    });
  });

  describe('getDefaultMigrationTemplate', () => {
    it('returns valid JavaScript migration template with up and down', () => {
      const tpl = getDefaultMigrationTemplate();
      expect(typeof tpl).toBe('string');
      expect(tpl).toContain('exports.up = function(knex)');
      expect(tpl).toContain('exports.down = function(knex)');
      expect(tpl).toContain('knex.schema.createTable');
      expect(tpl).toContain('knex.schema.dropTableIfExists');
    });
  });

  describe('exports', () => {
    it('exports diffSchema and makeMigrations functions', () => {
      expect(typeof diffSchema).toBe('function');
      expect(typeof makeMigrations).toBe('function');
    });
  });
});

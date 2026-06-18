/**
 * Model migration scaffolding utilities
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { z } = require('zod');
const { defineModel, clearRegistry, zdb } = require('../../../core/orm');
const {
  sortModelsByDependencies,
  findExistingCreateMigration,
  scaffoldMigrationsFromModels,
  getReferencedTables,
} = require('../../../bin/utils/model-migrations');

describe('model-migrations utilities', () => {
  beforeEach(() => {
    clearRegistry();
  });

  describe('sortModelsByDependencies', () => {
    it('orders parent tables before dependents', () => {
      const userSchema = zdb.schema({
        id: zdb.id(),
        email: zdb.string({ maxLength: 255 }),
      });
      const postSchema = z.object({
        id: zdb.id(),
        user_id: zdb.foreignKey('users'),
        title: zdb.string({ maxLength: 200 }),
      });

      const User = defineModel({ name: 'User', table: 'users', schema: userSchema });
      const Post = defineModel({ name: 'Post', table: 'posts', schema: postSchema });

      const sorted = sortModelsByDependencies([Post, User]);
      expect(sorted.map((m) => m.table)).toEqual(['users', 'posts']);
    });

    it('throws on circular dependencies', () => {
      const a = {
        name: 'A',
        table: 'a_table',
        columns: new Map([['b_id', { type: 'bigint', references: 'b_table' }]]),
      };
      const b = {
        name: 'B',
        table: 'b_table',
        columns: new Map([['a_id', { type: 'bigint', references: 'a_table' }]]),
      };

      expect(() => sortModelsByDependencies([a, b])).toThrow(/Circular table dependency/);
    });
  });

  describe('getReferencedTables', () => {
    it('collects references from column metadata', () => {
      const model = {
        columns: new Map([
          ['id', { type: 'bigint', primary: true }],
          ['user_id', { type: 'bigint', references: 'users' }],
        ]),
      };
      expect([...getReferencedTables(model)]).toEqual(['users']);
    });
  });

  describe('findExistingCreateMigration', () => {
    it('detects existing createTable migration for a table', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-mig-'));
      fs.writeFileSync(
        path.join(dir, '20240101_create_users_table.js'),
        "exports.up = (knex) => knex.schema.createTable('users', () => {});"
      );

      expect(findExistingCreateMigration(dir, 'users')).toBe('20240101_create_users_table.js');
      expect(findExistingCreateMigration(dir, 'posts')).toBeNull();

      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('scaffoldMigrationsFromModels', () => {
    let root;
    let modelsDir;
    let migrationDir;

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-scaffold-'));
      modelsDir = path.join(root, 'models');
      migrationDir = path.join(root, 'migrations');
      fs.mkdirSync(modelsDir, { recursive: true });

      const ormPath = path.resolve(__dirname, '../../../core/orm').replace(/\\/g, '/');

      fs.writeFileSync(
        path.join(modelsDir, 'User.js'),
        `const { defineModel, zdb } = require('${ormPath}');
module.exports = defineModel({
  name: 'User',
  table: 'users',
  schema: zdb.schema({
    id: zdb.id(),
    email: zdb.string({ maxLength: 255, unique: true }),
    created_at: zdb.timestamp({ auto: 'create' }),
  }),
});
`
      );

      fs.writeFileSync(
        path.join(modelsDir, 'Post.js'),
        `const { defineModel, zdb } = require('${ormPath}');
module.exports = defineModel({
  name: 'Post',
  table: 'posts',
  schema: zdb.schema({
    id: zdb.id(),
    user_id: zdb.foreignKey('users'),
    title: zdb.string({ maxLength: 200 }),
  }),
});
`
      );
    });

    afterEach(() => {
      if (root) {
        fs.rmSync(root, { recursive: true, force: true });
      }
      clearRegistry();
    });

    it('creates one migration per model in dependency order', () => {
      const prevCwd = process.cwd();
      process.chdir(root);
      try {
        const result = scaffoldMigrationsFromModels({
          modelsDir: './models',
          migrationDir,
        });

        expect(result.errors).toEqual([]);
        expect(result.created).toHaveLength(2);
        expect(result.created[0].table).toBe('users');
        expect(result.created[1].table).toBe('posts');

        const usersContent = fs.readFileSync(result.created[0].path, 'utf8');
        const postsContent = fs.readFileSync(result.created[1].path, 'utf8');
        expect(usersContent).toContain("createTable('users'");
        expect(postsContent).toContain("createTable('posts'");
      } finally {
        process.chdir(prevCwd);
      }
    });

    it('skips tables that already have a create migration', () => {
      fs.mkdirSync(migrationDir, { recursive: true });
      fs.writeFileSync(
        path.join(migrationDir, 'existing_users.js'),
        "exports.up = (knex) => knex.schema.createTable('users', () => {});"
      );

      const prevCwd = process.cwd();
      process.chdir(root);
      try {
        const result = scaffoldMigrationsFromModels({
          modelsDir: './models',
          migrationDir,
        });

        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0].table).toBe('users');
        expect(result.created).toHaveLength(1);
        expect(result.created[0].table).toBe('posts');
      } finally {
        process.chdir(prevCwd);
      }
    });

    it('supports --only filter via only option', () => {
      const prevCwd = process.cwd();
      process.chdir(root);
      try {
        const result = scaffoldMigrationsFromModels({
          modelsDir: './models',
          migrationDir,
          only: ['User'],
        });

        expect(result.created).toHaveLength(1);
        expect(result.created[0].model).toBe('User');
      } finally {
        process.chdir(prevCwd);
      }
    });

    it('dry-run does not write files', () => {
      const prevCwd = process.cwd();
      process.chdir(root);
      try {
        const result = scaffoldMigrationsFromModels({
          modelsDir: './models',
          migrationDir,
          dryRun: true,
        });

        expect(result.created).toHaveLength(2);
        expect(fs.existsSync(migrationDir)).toBe(false);
      } finally {
        process.chdir(prevCwd);
      }
    });
  });
});

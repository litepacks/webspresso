const {
  wait
} = require('../../utils');

/**
 * Repository Integration Tests
 * Uses SQLite in-memory database
 */

const { createDatabase, clearRegistry } = require('../../../core/orm');
const {
  initModels,
  createTestSchema,
  dropTestSchema,
  seedTestData,
} = require('../../fixtures/orm/models');

describe('Repository Integration', () => {
  let db;
  let User, Company, Post;
  let UserRepo, CompanyRepo, PostRepo;

  beforeAll(async () => {
    clearRegistry();

    // Create database instance (skip auto-loading)
    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      cache: false,
      models: './tests/fixtures/models-empty',
    });

    // Initialize models (force reset for test isolation)
    const models = initModels(true);
    User = models.User;
    Company = models.Company;
    Post = models.Post;
    
    // Register models with db instance
    db.registerModel(User);
    db.registerModel(Company);
    db.registerModel(Post);

    // Create schema
    await createTestSchema(db.knex);
    await seedTestData(db.knex);

    UserRepo = db.getRepository('User');
    CompanyRepo = db.getRepository('Company');
    PostRepo = db.getRepository('Post');
  });

  afterAll(async () => {
    await db.destroy();
    clearRegistry();
  });

  let dirty = false;

  beforeEach(async () => {
    if (dirty) {
      // Clear and re-seed data before each test
      await db.knex('posts').del();
      await db.knex('users').del();
      await db.knex('companies').del();
      await seedTestData(db.knex);

      // Create fresh repositories
      UserRepo = db.getRepository('User');
      CompanyRepo = db.getRepository('Company');
      PostRepo = db.getRepository('Post');
      dirty = false;
    }
  });

  describe('findById', () => {
    it('should find a record by ID', async () => {
      const user = await UserRepo.findById(1);

      expect(user).not.toBeNull();
      expect(user.id).toBe(1);
      expect(user.email).toBe('john@acme.com');
    });

    it('should return null for non-existent ID', async () => {
      const user = await UserRepo.findById(999);

      expect(user).toBeNull();
    });

    it('should respect soft delete by default', async () => {
      // User 4 is soft-deleted
      const user = await UserRepo.findById(4);

      expect(user).toBeNull();
    });

    it('should load relations with with option', async () => {
      const user = await UserRepo.findById(1, { with: ['company', 'posts'] });

      expect(user.company).not.toBeNull();
      expect(user.company.name).toBe('Acme Corp');
      expect(user.posts).toBeInstanceOf(Array);
      expect(user.posts.length).toBe(2);
    });

    it('should select specific columns', async () => {
      const user = await UserRepo.findById(1, { select: ['id', 'email'] });

      expect(user.id).toBe(1);
      expect(user.email).toBe('john@acme.com');
      expect(user.name).toBeUndefined();
    });
  });

  describe('findOne', () => {
    it('should find a record by conditions', async () => {
      const user = await UserRepo.findOne({ email: 'jane@acme.com' });

      expect(user).not.toBeNull();
      expect(user.name).toBe('Jane Smith');
    });

    it('should return null if no match', async () => {
      const user = await UserRepo.findOne({ email: 'nonexistent@test.com' });

      expect(user).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all non-deleted records', async () => {
      const users = await UserRepo.findAll();

      expect(users.length).toBe(3); // User 4 is soft-deleted
    });

    it('should load relations for all records', async () => {
      const users = await UserRepo.findAll({ with: ['company'] });

      expect(users[0].company).not.toBeNull();
    });
  });

  describe('create', () => {
    afterEach(() => {
      dirty = true;
    });

    it('should create a new record', async () => {
      const user = await UserRepo.create({
        email: 'new@test.com',
        name: 'New User',
        status: 'active',
      });

      expect(user.id).toBeDefined();
      expect(user.email).toBe('new@test.com');
    });

    it('should auto-set timestamps', async () => {
      const user = await UserRepo.create({
        email: 'timestamps@test.com',
        name: 'Timestamp User',
      });

      expect(user.created_at).toBeDefined();
      expect(user.updated_at).toBeDefined();
    });

    it('should validate with Zod schema for invalid fields', async () => {
      await expect(UserRepo.create({
        email: 'invalid', // Too short for Zod max length validation
        name: 'x'.repeat(300), // Exceeds maxLength
      })).rejects.toThrow();
    });

    it('should reject when required fields are missing on create', async () => {
      await expect(UserRepo.create({
        name: 'Missing Email User',
      })).rejects.toThrow(/email/i);
    });
  });

  describe('createMany', () => {
    afterEach(() => {
      dirty = true;
    });

    it('should reject batch creation when required fields are missing', async () => {
      await expect(UserRepo.createMany([
        { name: 'Missing Email 1' },
      ])).rejects.toThrow(/email/i);
    });

    it('should create multiple records', async () => {
      const users = await UserRepo.createMany([
        { email: 'batch1@test.com', name: 'Batch 1' },
        { email: 'batch2@test.com', name: 'Batch 2' },
      ]);

      expect(users.length).toBe(2);
      expect(users[0].email).toBe('batch1@test.com');
      expect(users[1].email).toBe('batch2@test.com');
    });
  });

  describe('update', () => {
    afterEach(() => {
      dirty = true;
    });

    it('should update a record', async () => {
      const updated = await UserRepo.update(1, { name: 'Updated Name' });

      expect(updated.name).toBe('Updated Name');
      expect(updated.id).toBe(1);
    });

    it('should update timestamps', async () => {
      const before = await UserRepo.findById(1);
      
      // Wait a tick to ensure different timestamp
      await wait(1);
      
      const updated = await UserRepo.update(1, { name: 'Newer Name' });

      expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(before.updated_at).getTime()
      );
    });

    it('should return null for non-existent record', async () => {
      const updated = await UserRepo.update(999, { name: 'Ghost' });

      expect(updated).toBeNull();
    });
  });

  describe('updateWhere', () => {
    afterEach(() => {
      dirty = true;
    });

    it('should update multiple records matching conditions', async () => {
      const count = await UserRepo.updateWhere(
        { company_id: 1 },
        { status: 'inactive' }
      );

      expect(count).toBe(2); // John and Jane
      
      const john = await UserRepo.findById(1);
      expect(john.status).toBe('inactive');
    });
  });

  describe('delete (soft)', () => {
    afterEach(() => {
      dirty = true;
    });

    it('should soft delete a record', async () => {
      const result = await UserRepo.delete(1);

      expect(result).toBe(true);

      // Should not find with default scope
      const user = await UserRepo.findById(1);
      expect(user).toBeNull();

      // Should find with raw query
      const raw = await db.knex('users').where('id', 1).first();
      expect(raw).not.toBeNull();
      expect(raw.deleted_at).not.toBeNull();
    });
  });

  describe('forceDelete', () => {
    afterEach(() => {
      dirty = true;
    });

    it('should permanently delete a record', async () => {
      // Delete posts first to avoid FK constraint
      await db.knex('posts').where('user_id', 3).del();
      
      const result = await UserRepo.forceDelete(3);

      expect(result).toBe(true);

      // Should not find even with raw query
      const raw = await db.knex('users').where('id', 3).first();
      expect(raw).toBeUndefined();
    });
  });

  describe('restore', () => {
    afterEach(() => {
      dirty = true;
    });

    it('should restore a soft-deleted record', async () => {
      // User 4 is soft-deleted
      const restored = await UserRepo.restore(4);

      expect(restored).not.toBeNull();
      expect(restored.deleted_at).toBeNull();

      // Should now be findable
      const found = await UserRepo.findById(4);
      expect(found).not.toBeNull();
    });
  });

  describe('count', () => {
    it('should count all records', async () => {
      const count = await UserRepo.count();

      expect(count).toBe(3); // Excludes soft-deleted
    });

    it('should count with conditions', async () => {
      const count = await UserRepo.count({ status: 'active' });

      expect(count).toBe(2);
    });
  });

  describe('exists', () => {
    it('should return true if record exists', async () => {
      const exists = await UserRepo.exists({ email: 'john@acme.com' });

      expect(exists).toBe(true);
    });

    it('should return false if record does not exist', async () => {
      const exists = await UserRepo.exists({ email: 'ghost@test.com' });

      expect(exists).toBe(false);
    });
  });

  describe('JSON field handling', () => {
    afterEach(() => {
      dirty = true;
    });

    it('should store and retrieve JSON object correctly', async () => {
      const metadata = {
        preferences: { theme: 'dark', notifications: true },
        tags: ['developer', 'admin'],
        lastLogin: '2024-01-15T10:30:00Z',
      };

      const user = await UserRepo.create({
        email: 'json-test@test.com',
        name: 'JSON User',
        metadata,
      });

      expect(user.id).toBeDefined();

      // Fetch and verify JSON is properly parsed
      const fetched = await UserRepo.findById(user.id);
      expect(fetched.metadata).toEqual(metadata);
      expect(typeof fetched.metadata).toBe('object');
      expect(fetched.metadata.preferences.theme).toBe('dark');
      expect(fetched.metadata.tags).toContain('developer');
    });

    it('should update JSON field correctly', async () => {
      const user = await UserRepo.create({
        email: 'json-update@test.com',
        name: 'JSON Update User',
        metadata: { version: 1 },
      });

      const updatedMetadata = { version: 2, updated: true };
      const updated = await UserRepo.update(user.id, {
        metadata: updatedMetadata,
      });

      expect(updated.metadata).toEqual(updatedMetadata);
      expect(updated.metadata.version).toBe(2);
    });

    it('should handle null JSON field', async () => {
      const user = await UserRepo.create({
        email: 'json-null@test.com',
        name: 'JSON Null User',
        metadata: null,
      });

      const fetched = await UserRepo.findById(user.id);
      expect(fetched.metadata).toBeNull();
    });

    it('should handle empty object in JSON field', async () => {
      const user = await UserRepo.create({
        email: 'json-empty@test.com',
        name: 'JSON Empty User',
        metadata: {},
      });

      const fetched = await UserRepo.findById(user.id);
      expect(fetched.metadata).toEqual({});
    });

    it('should handle array in JSON field', async () => {
      const user = await UserRepo.create({
        email: 'json-array@test.com',
        name: 'JSON Array User',
        metadata: ['item1', 'item2', { nested: true }],
      });

      const fetched = await UserRepo.findById(user.id);
      expect(Array.isArray(fetched.metadata)).toBe(true);
      expect(fetched.metadata.length).toBe(3);
      expect(fetched.metadata[2].nested).toBe(true);
    });

    it('should handle nested objects in JSON field', async () => {
      const deepNested = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
              array: [1, 2, 3],
            },
          },
        },
      };

      const user = await UserRepo.create({
        email: 'json-nested@test.com',
        name: 'JSON Nested User',
        metadata: deepNested,
      });

      const fetched = await UserRepo.findById(user.id);
      expect(fetched.metadata.level1.level2.level3.value).toBe('deep');
      expect(fetched.metadata.level1.level2.level3.array).toEqual([1, 2, 3]);
    });

    it('should handle special characters in JSON field', async () => {
      const specialChars = {
        quote: 'He said "Hello"',
        backslash: 'Path: C:\\Users',
        unicode: '日本語テスト',
        newline: 'Line1\nLine2',
        html: '<script>alert("xss")</script>',
      };

      const user = await UserRepo.create({
        email: 'json-special@test.com',
        name: 'JSON Special User',
        metadata: specialChars,
      });

      const fetched = await UserRepo.findById(user.id);
      expect(fetched.metadata).toEqual(specialChars);
    });
  });

  describe('SQLite PRAGMA Configuration', () => {
    it('should configure busy_timeout and foreign_keys on SQLite connection pool', async () => {
      const busyRes = await db.knex.raw('PRAGMA busy_timeout;');
      expect(busyRes[0].timeout).toBe(5000);

      const fkRes = await db.knex.raw('PRAGMA foreign_keys;');
      expect(fkRes[0].foreign_keys).toBe(1);
    });
  });
});


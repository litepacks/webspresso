/**
 * Repository Integration Tests
 * Uses SQLite in-memory database
 */

const knex = require('knex');
const { createDatabase } = require('../../../core/orm');
const {
  initModels,
  createTestSchema,
  dropTestSchema,
  seedTestData,
} = require('../../fixtures/orm/models');

describe('Repository Integration', () => {
  let db;
  let knexInstance;
  let User, Company, Post;
  let UserRepo, CompanyRepo, PostRepo;

  beforeAll(async () => {
    // Create SQLite in-memory database
    knexInstance = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    // Create database instance
    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    // Initialize models
    const models = initModels();
    User = models.User;
    Company = models.Company;
    Post = models.Post;

    // Create schema
    await createTestSchema(db.knex);
  });

  afterAll(async () => {
    await db.destroy();
    await knexInstance.destroy();
  });

  beforeEach(async () => {
    // Clear and re-seed data before each test
    await db.knex('posts').del();
    await db.knex('users').del();
    await db.knex('companies').del();
    await seedTestData(db.knex);

    // Create fresh repositories
    UserRepo = db.createRepository(User);
    CompanyRepo = db.createRepository(Company);
    PostRepo = db.createRepository(Post);
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

    it('should validate with Zod schema', async () => {
      await expect(UserRepo.create({
        email: 'invalid', // Too short for Zod max length validation
        name: 'x'.repeat(300), // Exceeds maxLength
      })).rejects.toThrow();
    });
  });

  describe('createMany', () => {
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
    it('should update a record', async () => {
      const updated = await UserRepo.update(1, { name: 'Updated Name' });

      expect(updated.name).toBe('Updated Name');
      expect(updated.id).toBe(1);
    });

    it('should update timestamps', async () => {
      const before = await UserRepo.findById(1);
      
      // Wait a bit to ensure different timestamp
      await new Promise(r => setTimeout(r, 10));
      
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
});


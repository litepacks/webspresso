/**
 * Query Builder Integration Tests
 */

const knex = require('knex');
const { createDatabase } = require('../../../core/orm');
const {
  initModels,
  createTestSchema,
  seedTestData,
} = require('../../fixtures/orm/models');

describe('Query Builder Integration', () => {
  let db;
  let User, Company, Post;
  let UserRepo;

  beforeAll(async () => {
    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    const models = initModels();
    User = models.User;
    Company = models.Company;
    Post = models.Post;

    await createTestSchema(db.knex);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db.knex('posts').del();
    await db.knex('users').del();
    await db.knex('companies').del();
    await seedTestData(db.knex);

    UserRepo = db.createRepository(User);
  });

  describe('where clauses', () => {
    it('should filter with object syntax', async () => {
      const users = await UserRepo.query()
        .where({ status: 'active' })
        .list();

      expect(users.length).toBe(2);
    });

    it('should filter with two-arg syntax', async () => {
      const users = await UserRepo.query()
        .where('status', 'inactive')
        .list();

      expect(users.length).toBe(1);
      expect(users[0].name).toBe('Bob Wilson');
    });

    it('should filter with three-arg syntax', async () => {
      const users = await UserRepo.query()
        .where('id', '>', 1)
        .list();

      expect(users.length).toBe(2);
    });

    it('should handle multiple where clauses', async () => {
      const users = await UserRepo.query()
        .where('status', 'active')
        .where('company_id', 1)
        .list();

      expect(users.length).toBe(2);
    });
  });

  describe('orWhere', () => {
    it('should handle OR conditions', async () => {
      const users = await UserRepo.query()
        .where('status', 'inactive')
        .orWhere('company_id', 2)
        .list();

      // Bob is inactive AND in company 2, so should be 1 user
      expect(users.length).toBe(1);
    });
  });

  describe('whereIn / whereNotIn', () => {
    it('should filter with IN clause', async () => {
      const users = await UserRepo.query()
        .whereIn('id', [1, 2])
        .list();

      expect(users.length).toBe(2);
    });

    it('should filter with NOT IN clause', async () => {
      const users = await UserRepo.query()
        .whereNotIn('id', [1, 2])
        .list();

      expect(users.length).toBe(1);
    });
  });

  describe('whereNull / whereNotNull', () => {
    it('should filter with IS NULL', async () => {
      // Note: company_id is only null for soft-deleted user 4
      // But user 4 is excluded by soft delete scope
      const users = await UserRepo.query()
        .whereNull('company_id')
        .list();

      expect(users.length).toBe(0);
    });

    it('should filter with IS NOT NULL', async () => {
      const users = await UserRepo.query()
        .whereNotNull('company_id')
        .list();

      expect(users.length).toBe(3);
    });
  });

  describe('orderBy', () => {
    it('should order ascending', async () => {
      const users = await UserRepo.query()
        .orderBy('name', 'asc')
        .list();

      expect(users[0].name).toBe('Bob Wilson');
      expect(users[1].name).toBe('Jane Smith');
      expect(users[2].name).toBe('John Doe');
    });

    it('should order descending', async () => {
      const users = await UserRepo.query()
        .orderBy('id', 'desc')
        .list();

      expect(users[0].id).toBe(3);
    });

    it('should handle multiple orderBy', async () => {
      const users = await UserRepo.query()
        .orderBy('status', 'asc')
        .orderBy('name', 'asc')
        .list();

      // Active users first, then sorted by name
      expect(users[0].status).toBe('active');
    });
  });

  describe('limit / offset', () => {
    it('should limit results', async () => {
      const users = await UserRepo.query()
        .limit(1)
        .list();

      expect(users.length).toBe(1);
    });

    it('should offset results', async () => {
      const users = await UserRepo.query()
        .orderBy('id', 'asc')
        .offset(1)
        .list();

      expect(users[0].id).toBe(2);
    });

    it('should combine limit and offset', async () => {
      const users = await UserRepo.query()
        .orderBy('id', 'asc')
        .limit(1)
        .offset(1)
        .list();

      expect(users.length).toBe(1);
      expect(users[0].id).toBe(2);
    });
  });

  describe('select', () => {
    it('should select specific columns', async () => {
      const users = await UserRepo.query()
        .select('id', 'email')
        .list();

      expect(users[0].id).toBeDefined();
      expect(users[0].email).toBeDefined();
      expect(users[0].name).toBeUndefined();
    });
  });

  describe('first', () => {
    it('should return first result', async () => {
      const user = await UserRepo.query()
        .orderBy('id', 'asc')
        .first();

      expect(user.id).toBe(1);
    });

    it('should return null if no results', async () => {
      const user = await UserRepo.query()
        .where('email', 'nonexistent@test.com')
        .first();

      expect(user).toBeNull();
    });
  });

  describe('count', () => {
    it('should count results', async () => {
      const count = await UserRepo.query()
        .where('status', 'active')
        .count();

      expect(count).toBe(2);
    });
  });

  describe('exists', () => {
    it('should check existence', async () => {
      const exists = await UserRepo.query()
        .where('email', 'john@acme.com')
        .exists();

      expect(exists).toBe(true);
    });
  });

  describe('paginate', () => {
    it('should return paginated results', async () => {
      const result = await UserRepo.query()
        .orderBy('id', 'asc')
        .paginate(1, 2);

      expect(result.data.length).toBe(2);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.perPage).toBe(2);
      expect(result.totalPages).toBe(2);
    });

    it('should handle second page', async () => {
      const result = await UserRepo.query()
        .orderBy('id', 'asc')
        .paginate(2, 2);

      expect(result.data.length).toBe(1);
      expect(result.data[0].id).toBe(3);
    });
  });

  describe('withTrashed / onlyTrashed', () => {
    it('should include soft-deleted with withTrashed', async () => {
      const users = await UserRepo.query()
        .withTrashed()
        .list();

      expect(users.length).toBe(4); // Includes user 4
    });

    it('should only return soft-deleted with onlyTrashed', async () => {
      const users = await UserRepo.query()
        .onlyTrashed()
        .list();

      expect(users.length).toBe(1);
      expect(users[0].email).toBe('deleted@test.com');
    });
  });

  describe('with (eager loading)', () => {
    it('should load belongsTo relation', async () => {
      // Need to use repository's query since it handles eager loading
      const user = await UserRepo.findById(1, { with: ['company'] });

      expect(user.company).not.toBeNull();
      expect(user.company.name).toBe('Acme Corp');
    });

    it('should load hasMany relation', async () => {
      const user = await UserRepo.findById(1, { with: ['posts'] });

      expect(user.posts).toBeInstanceOf(Array);
      expect(user.posts.length).toBe(2);
    });

    it('should load multiple relations', async () => {
      const user = await UserRepo.findById(1, { with: ['company', 'posts'] });

      expect(user.company).not.toBeNull();
      expect(user.posts.length).toBe(2);
    });
  });

  describe('update / delete on query builder', () => {
    it('should update matching records', async () => {
      const count = await UserRepo.query()
        .where('company_id', 1)
        .update({ status: 'inactive' });

      expect(count).toBe(2);
    });

    it('should delete matching records', async () => {
      // This does hard delete since it's direct query builder
      const PostRepo = db.createRepository(Post);
      const count = await PostRepo.query()
        .where('user_id', 1)
        .delete();

      expect(count).toBe(2);
    });
  });

  describe('clone', () => {
    it('should clone query builder', async () => {
      const baseQuery = UserRepo.query().where('status', 'active');
      const cloned = baseQuery.clone().where('company_id', 1);

      const baseResults = await baseQuery.list();
      const clonedResults = await cloned.list();

      expect(baseResults.length).toBe(2);
      expect(clonedResults.length).toBe(2);
    });
  });
});


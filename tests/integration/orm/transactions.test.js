/**
 * Transaction Integration Tests
 */

const { createDatabase } = require('../../../core/orm');
const {
  initModels,
  createTestSchema,
  seedTestData,
} = require('../../fixtures/orm/models');

describe('Transaction Integration', () => {
  let db;
  let User, Company, Post;

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
  });

  describe('successful transaction', () => {
    it('should commit all changes on success', async () => {
      await db.transaction(async (trx) => {
        const userRepo = trx.createRepository(User);
        const postRepo = trx.createRepository(Post);

        const user = await userRepo.create({
          email: 'transactional@test.com',
          name: 'Transactional User',
        });

        await postRepo.create({
          title: 'Transaction Post',
          content: 'Created in transaction',
          user_id: user.id,
        });
      });

      // Verify changes persisted
      const userRepo = db.createRepository(User);
      const user = await userRepo.findOne({ email: 'transactional@test.com' });
      expect(user).not.toBeNull();

      const postRepo = db.createRepository(Post);
      const post = await postRepo.findOne({ title: 'Transaction Post' });
      expect(post).not.toBeNull();
    });

    it('should return value from transaction', async () => {
      const result = await db.transaction(async (trx) => {
        const userRepo = trx.createRepository(User);
        const user = await userRepo.create({
          email: 'return@test.com',
          name: 'Return User',
        });
        return { userId: user.id };
      });

      expect(result.userId).toBeDefined();
    });
  });

  describe('failed transaction', () => {
    it('should rollback all changes on error', async () => {
      const initialCount = await db.createRepository(User).count();

      try {
        await db.transaction(async (trx) => {
          const userRepo = trx.createRepository(User);

          // This should succeed
          await userRepo.create({
            email: 'willrollback@test.com',
            name: 'Rollback User',
          });

          // This should fail (duplicate email)
          await userRepo.create({
            email: 'willrollback@test.com',
            name: 'Duplicate User',
          });
        });
      } catch (error) {
        // Expected to fail
      }

      // Verify rollback - count should be same
      const finalCount = await db.createRepository(User).count();
      expect(finalCount).toBe(initialCount);

      // Verify user was not created
      const user = await db.createRepository(User)
        .findOne({ email: 'willrollback@test.com' });
      expect(user).toBeNull();
    });

    it('should propagate error from transaction', async () => {
      await expect(
        db.transaction(async (trx) => {
          throw new Error('Intentional error');
        })
      ).rejects.toThrow('Intentional error');
    });
  });

  describe('nested operations', () => {
    it('should handle multiple repository operations', async () => {
      await db.transaction(async (trx) => {
        const companyRepo = trx.createRepository(Company);
        const userRepo = trx.createRepository(User);
        const postRepo = trx.createRepository(Post);

        // Create company
        const company = await companyRepo.create({
          name: 'New Company',
          slug: 'new-company',
        });

        // Create user in company
        const user = await userRepo.create({
          email: 'nested@test.com',
          name: 'Nested User',
          company_id: company.id,
        });

        // Create posts for user
        await postRepo.create({
          title: 'Post 1',
          user_id: user.id,
        });

        await postRepo.create({
          title: 'Post 2',
          user_id: user.id,
        });
      });

      // Verify all created
      const company = await db.createRepository(Company)
        .findOne({ slug: 'new-company' });
      expect(company).not.toBeNull();

      const user = await db.createRepository(User)
        .findOne({ email: 'nested@test.com' }, { with: ['posts'] });
      expect(user).not.toBeNull();
      expect(user.posts.length).toBe(2);
    });
  });

  describe('transaction context', () => {
    it('should isolate repositories within transaction', async () => {
      // Create a user outside transaction
      const outsideRepo = db.createRepository(User);
      
      await db.transaction(async (trx) => {
        const insideRepo = trx.createRepository(User);
        
        // Create user inside transaction
        await insideRepo.create({
          email: 'inside@test.com',
          name: 'Inside User',
        });

        // Inside transaction, user should be visible
        const insideUser = await insideRepo.findOne({ email: 'inside@test.com' });
        expect(insideUser).not.toBeNull();
      });

      // After commit, should be visible to outside repo too
      const user = await outsideRepo.findOne({ email: 'inside@test.com' });
      expect(user).not.toBeNull();
    });
  });

  describe('update and delete in transaction', () => {
    it('should handle updates in transaction', async () => {
      await db.transaction(async (trx) => {
        const userRepo = trx.createRepository(User);
        
        await userRepo.update(1, { name: 'Transaction Updated' });
      });

      const user = await db.createRepository(User).findById(1);
      expect(user.name).toBe('Transaction Updated');
    });

    it('should handle deletes in transaction', async () => {
      await db.transaction(async (trx) => {
        const userRepo = trx.createRepository(User);
        
        await userRepo.delete(3);
      });

      // User 3 should be soft-deleted
      const user = await db.createRepository(User).findById(3);
      expect(user).toBeNull();
    });
  });
});


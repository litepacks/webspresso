const {
  createMockQueryBuilder,
  createMockRepo,
  createMockDb,
} = require('../utils/orm');

describe('Test Utilities - ORM & Database Mocks (Step 2)', () => {
  describe('createMockQueryBuilder', () => {
    it('supports chainable filtering methods and records calls', async () => {
      const initialUsers = [
        { id: 1, name: 'Alice', age: 25, status: 'active', tenant_id: 't1' },
        { id: 2, name: 'Bob', age: 30, status: 'inactive', tenant_id: 't1' },
        { id: 3, name: 'Charlie', age: 35, status: 'active', tenant_id: 't2' },
      ];

      const qb = createMockQueryBuilder({ items: initialUsers });

      qb.where('status', 'active')
        .where('age', '>', 26)
        .forTenant('t2')
        .orderBy('name', 'asc');

      const results = await qb.find();
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Charlie');

      expect(qb.getCalls('where')).toHaveLength(2);
      expect(qb.getCalls('forTenant')).toHaveLength(1);
      expect(qb.getCalls('orderBy')).toHaveLength(1);
    });

    it('supports whereIn, whereNotIn, whereNull, whereNotNull, whereBetween', async () => {
      const items = [
        { id: 1, score: 50, tag: null },
        { id: 2, score: 75, tag: 'featured' },
        { id: 3, score: 100, tag: 'top' },
      ];

      const qb1 = createMockQueryBuilder({ items });
      const inRes = await qb1.whereIn('id', [1, 3]).find();
      expect(inRes).toHaveLength(2);

      const qb2 = createMockQueryBuilder({ items });
      const notInRes = await qb2.whereNotIn('id', [2]).find();
      expect(notInRes).toHaveLength(2);

      const qb3 = createMockQueryBuilder({ items });
      const nullRes = await qb3.whereNull('tag').find();
      expect(nullRes).toHaveLength(1);
      expect(nullRes[0].id).toBe(1);

      const qb4 = createMockQueryBuilder({ items });
      const notNullRes = await qb4.whereNotNull('tag').find();
      expect(notNullRes).toHaveLength(2);

      const qb5 = createMockQueryBuilder({ items });
      const betweenRes = await qb5.whereBetween('score', [60, 90]).find();
      expect(betweenRes).toHaveLength(1);
      expect(betweenRes[0].id).toBe(2);
    });

    it('supports pagination, limit, offset, and first', async () => {
      const items = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, num: i }));
      const qb = createMockQueryBuilder({ items });

      const paged = await qb.paginate({ page: 2, limit: 10 });
      expect(paged.data).toHaveLength(10);
      expect(paged.data[0].id).toBe(11);
      expect(paged.pagination.page).toBe(2);
      expect(paged.pagination.total).toBe(25);
      expect(paged.pagination.totalPages).toBe(3);
      expect(paged.pagination.hasPrev).toBe(true);
      expect(paged.pagination.hasNext).toBe(true);

      const firstItem = await qb.first();
      expect(firstItem.id).toBe(1);

      const count = await qb.count();
      expect(count).toBe(25);
    });
  });

  describe('createMockRepo', () => {
    it('performs CRUD operations in-memory with auto-increment IDs', async () => {
      const repo = createMockRepo();

      const user1 = await repo.create({ name: 'User 1', email: 'u1@example.com' });
      expect(user1.id).toBe(1);
      expect(user1.created_at).toBeDefined();

      const user2 = await repo.create({ name: 'User 2', email: 'u2@example.com' });
      expect(user2.id).toBe(2);

      const found = await repo.findById(1);
      expect(found.name).toBe('User 1');

      const updated = await repo.update(1, { name: 'User 1 Updated' });
      expect(updated.name).toBe('User 1 Updated');

      const afterUpdate = await repo.findById(1);
      expect(afterUpdate.name).toBe('User 1 Updated');

      const deleted = await repo.delete(1);
      expect(deleted).toBe(true);

      const notFound = await repo.findById(1);
      expect(notFound).toBeNull();
    });

    it('supports find and findOne with object criteria or filter predicate', async () => {
      const repo = createMockRepo([
        { id: 10, role: 'admin', active: true },
        { id: 20, role: 'user', active: true },
        { id: 30, role: 'user', active: false },
      ]);

      const admin = await repo.findOne({ role: 'admin' });
      expect(admin.id).toBe(10);

      const activeUsers = await repo.find({ role: 'user', active: true });
      expect(activeUsers).toHaveLength(1);
      expect(activeUsers[0].id).toBe(20);

      const predicateFound = await repo.findOne((r) => r.id === 30);
      expect(predicateFound.active).toBe(false);

      const count = await repo.count({ active: true });
      expect(count).toBe(2);
    });

    it('supports soft delete and restore', async () => {
      const repo = createMockRepo({
        items: [{ id: 1, title: 'Note 1' }],
        softDelete: true,
      });

      await repo.delete(1);
      expect(repo.items[0].deleted_at).toBeDefined();

      await repo.restore(1);
      expect(repo.items[0].deleted_at).toBeNull();
    });

    it('spawns a mock query builder connected to current repository items', async () => {
      const repo = createMockRepo([{ id: 1, val: 'a' }, { id: 2, val: 'b' }]);
      const qb = repo.query();
      const res = await qb.where('val', 'b').find();
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe(2);
    });

    it('supports transaction callback execution', async () => {
      const repo = createMockRepo();
      const result = await repo.transaction(async (trx) => {
        return trx.create({ name: 'Tx Created' });
      });
      expect(result.name).toBe('Tx Created');
    });
  });

  describe('createMockDb', () => {
    it('provides getRepository for pre-configured models and item arrays', async () => {
      const userRepo = createMockRepo([{ id: 1, name: 'Alice' }]);

      const db = createMockDb({
        User: userRepo,
        Post: [{ id: 101, title: 'First Post' }],
      });

      const retrievedUserRepo = db.getRepository('User');
      expect(retrievedUserRepo).toBe(userRepo);
      expect(db.getRepository).toHaveBeenCalledWith('User');

      const retrievedPostRepo = db.getRepository('Post');
      expect(retrievedPostRepo.name).toBe('Post');
      const post = await retrievedPostRepo.findById(101);
      expect(post.title).toBe('First Post');
    });

    it('auto-provisions mock repository for undeclared models by default', () => {
      const db = createMockDb();
      const categoryRepo = db.getRepository('Category');

      expect(categoryRepo).toBeDefined();
      expect(categoryRepo.name).toBe('Category');
      expect(db.getRepository('Category')).toBe(categoryRepo); // caches provisioned repo
    });

    it('simulates transaction method and knex client dialect configuration', async () => {
      const db = createMockDb({}, { dialect: 'sqlite3' });

      expect(db.knex.client.config.client).toBe('sqlite3');

      let executed = false;
      const res = await db.transaction(async (trx) => {
        executed = true;
        return trx.raw('SELECT 1');
      });

      expect(executed).toBe(true);
      expect(res).toEqual([]);
    });
  });
});

/**
 * ORM Relational Cascade Soft-Delete & Restore Integration Tests
 * Tests automatic cascade for hasMany, hasOne, multi-level chains,
 * selective restore timestamp matching, forceDelete, and cycle prevention.
 */

const {
  zdb,
  defineModel,
  clearRegistry,
  getModel,
  createDatabase,
  isCascadeEnabled,
} = require('../../../core/orm');

describe('isCascadeEnabled helper', () => {
  it('handles boolean true and false', () => {
    expect(isCascadeEnabled({ cascade: true }, 'delete')).toBe(true);
    expect(isCascadeEnabled({ cascade: true }, 'restore')).toBe(true);
    expect(isCascadeEnabled({ cascade: false }, 'delete')).toBe(false);
    expect(isCascadeEnabled({ cascade: false }, 'restore')).toBe(false);
    expect(isCascadeEnabled({}, 'delete')).toBe(false);
  });

  it('handles string modes ("delete", "restore", "all")', () => {
    expect(isCascadeEnabled({ cascade: 'delete' }, 'delete')).toBe(true);
    expect(isCascadeEnabled({ cascade: 'delete' }, 'restore')).toBe(false);
    expect(isCascadeEnabled({ cascade: 'restore' }, 'restore')).toBe(true);
    expect(isCascadeEnabled({ cascade: 'restore' }, 'delete')).toBe(false);
    expect(isCascadeEnabled({ cascade: 'all' }, 'delete')).toBe(true);
    expect(isCascadeEnabled({ cascade: 'all' }, 'restore')).toBe(true);
  });

  it('handles array and object configurations', () => {
    expect(isCascadeEnabled({ cascade: ['delete'] }, 'delete')).toBe(true);
    expect(isCascadeEnabled({ cascade: ['delete'] }, 'restore')).toBe(false);
    expect(isCascadeEnabled({ cascade: ['delete', 'restore'] }, 'restore')).toBe(true);
    expect(isCascadeEnabled({ cascade: { delete: true, restore: false } }, 'delete')).toBe(true);
    expect(isCascadeEnabled({ cascade: { delete: true, restore: false } }, 'restore')).toBe(false);
  });
});

describe('ORM Relational Cascade Soft-Delete & Restore', () => {
  let db;
  let AuthorRepo, PostRepo, CommentRepo, ProfileRepo, CircularARepo, CircularBRepo;
  let dirty = false;

  beforeAll(async () => {
    clearRegistry();

    // 1. Author Model (hasMany Posts with cascade: true, hasOne Profile with cascade: true)
    defineModel({
      name: 'CascadeAuthor',
      table: 'cascade_authors',
      schema: zdb.schema({
        id: zdb.id(),
        name: zdb.string({ maxLength: 100 }),
        deleted_at: zdb.timestamp({ nullable: true }),
      }),
      relations: {
        posts: {
          type: 'hasMany',
          model: () => 'CascadePost', // Lazy string model reference
          foreignKey: 'author_id',
          cascade: true,
        },
        profile: {
          type: 'hasOne',
          model: () => 'CascadeProfile', // Lazy string model reference
          foreignKey: 'author_id',
          cascade: true,
        },
      },
      scopes: {
        softDelete: true,
      },
      cache: 'auto',
    });

    // 2. Post Model (hasMany Comments with cascade: true, belongsTo Author)
    defineModel({
      name: 'CascadePost',
      table: 'cascade_posts',
      schema: zdb.schema({
        id: zdb.id(),
        author_id: zdb.foreignKey('cascade_authors'),
        title: zdb.string({ maxLength: 200 }),
        deleted_at: zdb.timestamp({ nullable: true }),
      }),
      relations: {
        author: {
          type: 'belongsTo',
          model: () => 'CascadeAuthor',
          foreignKey: 'author_id',
        },
        comments: {
          type: 'hasMany',
          model: () => getModel('CascadeComment'),
          foreignKey: 'post_id',
          cascade: true,
        },
      },
      scopes: {
        softDelete: true,
      },
      cache: 'auto',
    });

    // 3. Comment Model (belongsTo Post)
    defineModel({
      name: 'CascadeComment',
      table: 'cascade_comments',
      schema: zdb.schema({
        id: zdb.id(),
        post_id: zdb.foreignKey('cascade_posts'),
        body: zdb.string({ maxLength: 500 }),
        deleted_at: zdb.timestamp({ nullable: true }),
      }),
      relations: {
        post: {
          type: 'belongsTo',
          model: () => 'CascadePost',
          foreignKey: 'post_id',
        },
      },
      scopes: {
        softDelete: true,
      },
      cache: 'auto',
    });

    // 4. Profile Model (hasOne related to Author)
    defineModel({
      name: 'CascadeProfile',
      table: 'cascade_profiles',
      schema: zdb.schema({
        id: zdb.id(),
        author_id: zdb.foreignKey('cascade_authors'),
        bio: zdb.string({ maxLength: 500 }),
        deleted_at: zdb.timestamp({ nullable: true }),
      }),
      relations: {
        author: {
          type: 'belongsTo',
          model: () => 'CascadeAuthor',
          foreignKey: 'author_id',
        },
      },
      scopes: {
        softDelete: true,
      },
    });

    // 5. Circular Models for cycle testing
    defineModel({
      name: 'CircularA',
      table: 'circular_a',
      schema: zdb.schema({
        id: zdb.id(),
        b_id: zdb.foreignKey('circular_b', { nullable: true }),
        name: zdb.string({ maxLength: 50 }),
        deleted_at: zdb.timestamp({ nullable: true }),
      }),
      relations: {
        b: {
          type: 'hasOne',
          model: () => 'CircularB',
          foreignKey: 'a_id',
          cascade: true,
        },
      },
      scopes: { softDelete: true },
    });

    defineModel({
      name: 'CircularB',
      table: 'circular_b',
      schema: zdb.schema({
        id: zdb.id(),
        a_id: zdb.foreignKey('circular_a', { nullable: true }),
        name: zdb.string({ maxLength: 50 }),
        deleted_at: zdb.timestamp({ nullable: true }),
      }),
      relations: {
        a: {
          type: 'hasOne',
          model: () => 'CircularA',
          foreignKey: 'b_id',
          cascade: true,
        },
      },
      scopes: { softDelete: true },
    });

    // 6. Delete-only cascade model
    defineModel({
      name: 'DeleteOnlyChild',
      table: 'delete_only_children',
      schema: zdb.schema({
        id: zdb.id(),
        parent_id: zdb.foreignKey('delete_only_parents'),
        text: zdb.string({ maxLength: 100 }),
        deleted_at: zdb.timestamp({ nullable: true }),
      }),
      scopes: { softDelete: true },
    });

    defineModel({
      name: 'DeleteOnlyParent',
      table: 'delete_only_parents',
      schema: zdb.schema({
        id: zdb.id(),
        name: zdb.string({ maxLength: 100 }),
        deleted_at: zdb.timestamp({ nullable: true }),
      }),
      relations: {
        children: {
          type: 'hasMany',
          model: () => 'DeleteOnlyChild',
          foreignKey: 'parent_id',
          cascade: 'delete', // Only cascade delete, not restore!
        },
      },
      scopes: { softDelete: true },
    });

    // Create DB instance
    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      models: './tests/fixtures/models-empty',
      cache: { enabled: true, defaultStrategy: 'auto' },
    });

    db.registerModel(getModel('CascadeAuthor'));
    db.registerModel(getModel('CascadePost'));
    db.registerModel(getModel('CascadeComment'));
    db.registerModel(getModel('CascadeProfile'));
    db.registerModel(getModel('CircularA'));
    db.registerModel(getModel('CircularB'));
    db.registerModel(getModel('DeleteOnlyChild'));
    db.registerModel(getModel('DeleteOnlyParent'));

    // Create DB tables
    await db.knex.schema.createTable('cascade_authors', (t) => {
      t.increments('id').primary();
      t.string('name', 100).notNullable();
      t.timestamp('deleted_at').nullable();
    });

    await db.knex.schema.createTable('cascade_posts', (t) => {
      t.increments('id').primary();
      t.integer('author_id').notNullable();
      t.string('title', 200).notNullable();
      t.timestamp('deleted_at').nullable();
    });

    await db.knex.schema.createTable('cascade_comments', (t) => {
      t.increments('id').primary();
      t.integer('post_id').notNullable();
      t.string('body', 500).notNullable();
      t.timestamp('deleted_at').nullable();
    });

    await db.knex.schema.createTable('cascade_profiles', (t) => {
      t.increments('id').primary();
      t.integer('author_id').notNullable();
      t.string('bio', 500).notNullable();
      t.timestamp('deleted_at').nullable();
    });

    await db.knex.schema.createTable('circular_a', (t) => {
      t.increments('id').primary();
      t.integer('b_id').nullable();
      t.string('name', 50);
      t.timestamp('deleted_at').nullable();
    });

    await db.knex.schema.createTable('circular_b', (t) => {
      t.increments('id').primary();
      t.integer('a_id').nullable();
      t.string('name', 50);
      t.timestamp('deleted_at').nullable();
    });

    await db.knex.schema.createTable('delete_only_parents', (t) => {
      t.increments('id').primary();
      t.string('name', 100);
      t.timestamp('deleted_at').nullable();
    });

    await db.knex.schema.createTable('delete_only_children', (t) => {
      t.increments('id').primary();
      t.integer('parent_id').notNullable();
      t.string('text', 100);
      t.timestamp('deleted_at').nullable();
    });

    AuthorRepo = db.getRepository('CascadeAuthor');
    PostRepo = db.getRepository('CascadePost');
    CommentRepo = db.getRepository('CascadeComment');
    ProfileRepo = db.getRepository('CascadeProfile');
    CircularARepo = db.getRepository('CircularA');
    CircularBRepo = db.getRepository('CircularB');
  });

  afterAll(async () => {
    await db.destroy();
    clearRegistry();
  });

  beforeEach(async () => {
    if (dirty) {
      await db.knex('cascade_comments').del();
      await db.knex('cascade_posts').del();
      await db.knex('cascade_profiles').del();
      await db.knex('cascade_authors').del();
      await db.knex('circular_b').del();
      await db.knex('circular_a').del();
      await db.knex('delete_only_children').del();
      await db.knex('delete_only_parents').del();
      if (db.cache) {
        db.cache.purge();
      }
      dirty = false;
    }
  });

  afterEach(() => {
    dirty = true;
  });

  describe('Soft-delete cascading', () => {
    it('cascades soft-delete from parent to hasMany children with exact same deleted_at', async () => {
      const author = await AuthorRepo.create({ name: 'Alice Walker' });
      const post1 = await PostRepo.create({ author_id: author.id, title: 'Post 1' });
      const post2 = await PostRepo.create({ author_id: author.id, title: 'Post 2' });

      // Deleting author should soft-delete author and both posts
      const deleted = await AuthorRepo.delete(author.id);
      expect(deleted).toBe(true);

      // Repositories should not find soft-deleted records by default
      expect(await AuthorRepo.findById(author.id)).toBeNull();
      expect(await PostRepo.findById(post1.id)).toBeNull();
      expect(await PostRepo.findById(post2.id)).toBeNull();

      // Raw DB checks
      const rawAuthor = await db.knex('cascade_authors').where('id', author.id).first();
      const rawPost1 = await db.knex('cascade_posts').where('id', post1.id).first();
      const rawPost2 = await db.knex('cascade_posts').where('id', post2.id).first();

      expect(rawAuthor.deleted_at).not.toBeNull();
      expect(rawPost1.deleted_at).not.toBeNull();
      expect(rawPost2.deleted_at).not.toBeNull();

      // Timestamps must match exactly
      expect(String(rawPost1.deleted_at)).toBe(String(rawAuthor.deleted_at));
      expect(String(rawPost2.deleted_at)).toBe(String(rawAuthor.deleted_at));
    });

    it('cascades soft-delete to hasOne relations', async () => {
      const author = await AuthorRepo.create({ name: 'Bob Smith' });
      const profile = await ProfileRepo.create({ author_id: author.id, bio: 'Award winning novelist' });

      await AuthorRepo.delete(author.id);

      expect(await AuthorRepo.findById(author.id)).toBeNull();
      expect(await ProfileRepo.findById(profile.id)).toBeNull();

      const rawProfile = await db.knex('cascade_profiles').where('id', profile.id).first();
      expect(rawProfile.deleted_at).not.toBeNull();
    });

    it('bypasses cascade when { cascade: false } is explicitly passed', async () => {
      const author = await AuthorRepo.create({ name: 'Charlie Brown' });
      const post = await PostRepo.create({ author_id: author.id, title: 'Independent Post' });

      await AuthorRepo.delete(author.id, { cascade: false });

      expect(await AuthorRepo.findById(author.id)).toBeNull();
      // Child post should NOT be deleted
      const foundPost = await PostRepo.findById(post.id);
      expect(foundPost).not.toBeNull();
      expect(foundPost.id).toBe(post.id);
    });
  });

  describe('Selective cascade restore', () => {
    it('only restores children deleted in the same cascade event, protecting previously deleted records', async () => {
      const author = await AuthorRepo.create({ name: 'Diana Prince' });
      const post1 = await PostRepo.create({ author_id: author.id, title: 'Old Draft' });
      const post2 = await PostRepo.create({ author_id: author.id, title: 'Active Post 2' });
      const post3 = await PostRepo.create({ author_id: author.id, title: 'Active Post 3' });

      // Step 1: Manually delete post1 beforehand with an older timestamp
      const olderDate = new Date(Date.now() - 3600 * 1000); // 1 hour ago
      await PostRepo.delete(post1.id, { deletedAt: olderDate });
      expect(await PostRepo.findById(post1.id)).toBeNull();

      // Step 2: Now soft-delete author (cascades to post2 and post3)
      await AuthorRepo.delete(author.id);

      expect(await AuthorRepo.findById(author.id)).toBeNull();
      expect(await PostRepo.findById(post2.id)).toBeNull();
      expect(await PostRepo.findById(post3.id)).toBeNull();

      // Step 3: Restore author
      const restoredAuthor = await AuthorRepo.restore(author.id);
      expect(restoredAuthor).not.toBeNull();
      expect(restoredAuthor.deleted_at).toBeNull();

      // Step 4: Verify Post 2 and Post 3 are restored, but Post 1 remains soft-deleted!
      const foundPost2 = await PostRepo.findById(post2.id);
      const foundPost3 = await PostRepo.findById(post3.id);
      const foundPost1 = await PostRepo.findById(post1.id);

      expect(foundPost2).not.toBeNull();
      expect(foundPost3).not.toBeNull();
      expect(foundPost1).toBeNull(); // Post 1 was NOT resurrected!

      // Post 1 still has its older deleted_at in the database
      const rawPost1 = await db.knex('cascade_posts').where('id', post1.id).first();
      expect(rawPost1.deleted_at).not.toBeNull();
    });

    it('restores all child records when { allChildren: true } is passed', async () => {
      const author = await AuthorRepo.create({ name: 'Edward Elric' });
      const post1 = await PostRepo.create({ author_id: author.id, title: 'Post 1' });
      const post2 = await PostRepo.create({ author_id: author.id, title: 'Post 2' });

      // Manually delete post1 earlier
      const olderDate = new Date(Date.now() - 50000);
      await PostRepo.delete(post1.id, { deletedAt: olderDate });

      // Delete author
      await AuthorRepo.delete(author.id);

      // Restore with allChildren: true
      await AuthorRepo.restore(author.id, { allChildren: true });

      // Both posts should be restored
      expect(await PostRepo.findById(post1.id)).not.toBeNull();
      expect(await PostRepo.findById(post2.id)).not.toBeNull();
    });
  });

  describe('Deep multi-level cascading (Author -> Post -> Comment)', () => {
    it('cascades soft-delete and restore through 3 levels of relations', async () => {
      const author = await AuthorRepo.create({ name: 'Tolkien' });
      const post = await PostRepo.create({ author_id: author.id, title: 'The Hobbit' });
      const comment1 = await CommentRepo.create({ post_id: post.id, body: 'Great read!' });
      const comment2 = await CommentRepo.create({ post_id: post.id, body: 'A classic.' });

      // Soft-delete author
      await AuthorRepo.delete(author.id);

      // All 3 levels must be soft-deleted
      expect(await AuthorRepo.findById(author.id)).toBeNull();
      expect(await PostRepo.findById(post.id)).toBeNull();
      expect(await CommentRepo.findById(comment1.id)).toBeNull();
      expect(await CommentRepo.findById(comment2.id)).toBeNull();

      // Raw checks for comments
      const rawC1 = await db.knex('cascade_comments').where('id', comment1.id).first();
      const rawC2 = await db.knex('cascade_comments').where('id', comment2.id).first();
      expect(rawC1.deleted_at).not.toBeNull();
      expect(rawC2.deleted_at).not.toBeNull();

      // Restore author -> all 3 levels must be restored!
      await AuthorRepo.restore(author.id);

      expect(await AuthorRepo.findById(author.id)).not.toBeNull();
      expect(await PostRepo.findById(post.id)).not.toBeNull();
      expect(await CommentRepo.findById(comment1.id)).not.toBeNull();
      expect(await CommentRepo.findById(comment2.id)).not.toBeNull();
    });
  });

  describe('Hard-delete cascading (forceDelete)', () => {
    it('permanently deletes child records first to satisfy foreign keys', async () => {
      const author = await AuthorRepo.create({ name: 'George Orwell' });
      const post = await PostRepo.create({ author_id: author.id, title: '1984' });
      const comment = await CommentRepo.create({ post_id: post.id, body: 'Doubleplusgood' });

      // Force delete author
      const forceDeleted = await AuthorRepo.forceDelete(author.id);
      expect(forceDeleted).toBe(true);

      // Records must be permanently deleted from database tables
      const rawAuthor = await db.knex('cascade_authors').where('id', author.id).first();
      const rawPost = await db.knex('cascade_posts').where('id', post.id).first();
      const rawComment = await db.knex('cascade_comments').where('id', comment.id).first();

      expect(rawAuthor).toBeUndefined();
      expect(rawPost).toBeUndefined();
      expect(rawComment).toBeUndefined();
    });
  });

  describe('Granular cascade settings (cascade: "delete")', () => {
    it('cascades delete but does not cascade restore when cascade is "delete"', async () => {
      const ParentRepo = db.getRepository('DeleteOnlyParent');
      const ChildRepo = db.getRepository('DeleteOnlyChild');

      const parent = await ParentRepo.create({ name: 'Restricted Parent' });
      const child = await ChildRepo.create({ parent_id: parent.id, text: 'Child item' });

      // Soft delete parent -> child should be soft deleted
      await ParentRepo.delete(parent.id);
      expect(await ChildRepo.findById(child.id)).toBeNull();

      // Restore parent -> child should NOT be restored
      await ParentRepo.restore(parent.id);
      expect(await ParentRepo.findById(parent.id)).not.toBeNull();
      expect(await ChildRepo.findById(child.id)).toBeNull();
    });
  });

  describe('Circular reference safety', () => {
    it('terminates safely without stack overflow when relations form a cycle', async () => {
      const a = await CircularARepo.create({ name: 'Record A' });
      const b = await CircularBRepo.create({ a_id: a.id, name: 'Record B' });
      await db.knex('circular_a').where('id', a.id).update({ b_id: b.id });

      // Deleting a should not recurse infinitely
      const result = await CircularARepo.delete(a.id);
      expect(result).toBe(true);

      expect(await CircularARepo.findById(a.id)).toBeNull();
      expect(await CircularBRepo.findById(b.id)).toBeNull();
    });
  });

  describe('Query cache invalidation on cascaded models', () => {
    it('invalidates query cache for related models during cascade operations', async () => {
      const author = await AuthorRepo.create({ name: 'Asimov' });
      const post = await PostRepo.create({ author_id: author.id, title: 'Foundation' });

      // Populate cache for post
      const cachedPost = await PostRepo.findById(post.id);
      expect(cachedPost).not.toBeNull();

      // Delete author (cascades to post)
      await AuthorRepo.delete(author.id);

      // Querying post through repo should yield null (cache was invalidated)
      const postAfterDelete = await PostRepo.findById(post.id);
      expect(postAfterDelete).toBeNull();

      // Restore author (cascades to post)
      await AuthorRepo.restore(author.id);

      // Querying post through repo should yield restored record (cache was invalidated)
      const postAfterRestore = await PostRepo.findById(post.id);
      expect(postAfterRestore).not.toBeNull();
      expect(postAfterRestore.id).toBe(post.id);
    });
  });
});

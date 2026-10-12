import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createDatabase,
  defineModel,
  zdb,
  clearRegistry,
  loadRelations,
  parseRelationTree,
} from '../../../core/orm';

describe('Nested Eager Loading', () => {
  describe('parseRelationTree parser', () => {
    it('should parse flat relation names', () => {
      const tree = parseRelationTree(['author', 'tags']);
      expect(Array.from(tree.keys())).toEqual(['author', 'tags']);
      expect(tree.get('author')).toEqual([]);
      expect(tree.get('tags')).toEqual([]);
    });

    it('should parse dot-separated nested relations', () => {
      const tree = parseRelationTree(['author.profile', 'comments.author']);
      expect(Array.from(tree.keys())).toEqual(['author', 'comments']);
      expect(tree.get('author')).toEqual(['profile']);
      expect(tree.get('comments')).toEqual(['author']);
    });

    it('should parse multi-level deep nested relations', () => {
      const tree = parseRelationTree(['author.company.country', 'comments.author.profile.avatar']);
      expect(tree.get('author')).toEqual(['company.country']);
      expect(tree.get('comments')).toEqual(['author.profile.avatar']);
    });

    it('should group siblings under the same top-level relation without duplicates', () => {
      const tree = parseRelationTree([
        'author',
        'author.profile',
        'author.company',
        'comments.author',
        'comments.likes',
      ]);

      expect(Array.from(tree.keys())).toEqual(['author', 'comments']);
      expect(tree.get('author')).toEqual(['profile', 'company']);
      expect(tree.get('comments')).toEqual(['author', 'likes']);
    });

    it('should support object notation', () => {
      const tree = parseRelationTree([
        {
          author: ['profile', 'company'],
          comments: 'author',
        },
      ]);

      expect(tree.get('author')).toEqual(['profile', 'company']);
      expect(tree.get('comments')).toEqual(['author']);
    });
  });

  describe('Database Integration with SQLite in-memory', () => {
    let db;
    let Country;
    let Company;
    let Profile;
    let User;
    let Post;
    let Comment;

    beforeEach(async () => {
      clearRegistry();

      db = createDatabase({
        client: 'better-sqlite3',
        connection: ':memory:',
        models: './tests/fixtures/models-empty',
      });

      // 1. Define Models
      Country = defineModel({
        name: 'Country',
        table: 'countries',
        schema: zdb.schema({
          id: zdb.id(),
          name: zdb.string(),
          code: zdb.string(),
        }),
      });

      Company = defineModel({
        name: 'Company',
        table: 'companies',
        schema: zdb.schema({
          id: zdb.id(),
          name: zdb.string(),
          country_id: zdb.integer().nullable(),
          metadata: zdb.json().nullable(),
        }),
        relations: {
          country: {
            type: 'belongsTo',
            model: () => Country,
            foreignKey: 'country_id',
          },
          users: {
            type: 'hasMany',
            model: () => User,
            foreignKey: 'company_id',
          },
        },
      });

      Profile = defineModel({
        name: 'Profile',
        table: 'profiles',
        schema: zdb.schema({
          id: zdb.id(),
          user_id: zdb.integer(),
          bio: zdb.string(),
          website: zdb.string().nullable(),
        }),
      });

      User = defineModel({
        name: 'User',
        table: 'users',
        schema: zdb.schema({
          id: zdb.id(),
          name: zdb.string(),
          email: zdb.string(),
          company_id: zdb.integer().nullable(),
        }),
        relations: {
          company: {
            type: 'belongsTo',
            model: () => Company,
            foreignKey: 'company_id',
          },
          profile: {
            type: 'hasOne',
            model: () => Profile,
            foreignKey: 'user_id',
          },
          posts: {
            type: 'hasMany',
            model: () => Post,
            foreignKey: 'user_id',
          },
        },
      });

      Post = defineModel({
        name: 'Post',
        table: 'posts',
        schema: zdb.schema({
          id: zdb.id(),
          title: zdb.string(),
          user_id: zdb.integer().nullable(),
        }),
        relations: {
          author: {
            type: 'belongsTo',
            model: () => User,
            foreignKey: 'user_id',
          },
          comments: {
            type: 'hasMany',
            model: () => Comment,
            foreignKey: 'post_id',
          },
        },
      });

      Comment = defineModel({
        name: 'Comment',
        table: 'comments',
        schema: zdb.schema({
          id: zdb.id(),
          post_id: zdb.integer(),
          user_id: zdb.integer(),
          content: zdb.string(),
        }),
        relations: {
          author: {
            type: 'belongsTo',
            model: () => User,
            foreignKey: 'user_id',
          },
        },
      });

      db.registerModel(Country);
      db.registerModel(Company);
      db.registerModel(Profile);
      db.registerModel(User);
      db.registerModel(Post);
      db.registerModel(Comment);

      // 2. Create Tables
      await db.knex.schema.createTable('countries', (t) => {
        t.increments('id').primary();
        t.string('name').notNullable();
        t.string('code').notNullable();
      });

      await db.knex.schema.createTable('companies', (t) => {
        t.increments('id').primary();
        t.string('name').notNullable();
        t.integer('country_id').nullable();
        t.text('metadata').nullable();
      });

      await db.knex.schema.createTable('profiles', (t) => {
        t.increments('id').primary();
        t.integer('user_id').notNullable();
        t.string('bio').notNullable();
        t.string('website').nullable();
      });

      await db.knex.schema.createTable('users', (t) => {
        t.increments('id').primary();
        t.string('name').notNullable();
        t.string('email').notNullable();
        t.integer('company_id').nullable();
      });

      await db.knex.schema.createTable('posts', (t) => {
        t.increments('id').primary();
        t.string('title').notNullable();
        t.integer('user_id').nullable();
      });

      await db.knex.schema.createTable('comments', (t) => {
        t.increments('id').primary();
        t.integer('post_id').notNullable();
        t.integer('user_id').notNullable();
        t.string('content').notNullable();
      });

      // 3. Seed Fixture Data
      await db.knex('countries').insert([
        { id: 1, name: 'Turkey', code: 'TR' },
        { id: 2, name: 'United States', code: 'US' },
      ]);

      await db.knex('companies').insert([
        { id: 1, name: 'Webspresso HQ', country_id: 1, metadata: JSON.stringify({ tier: 'enterprise' }) },
        { id: 2, name: 'Acme Global', country_id: 2, metadata: JSON.stringify({ tier: 'standard' }) },
      ]);

      await db.knex('users').insert([
        { id: 1, name: 'Ahmet', email: 'ahmet@example.com', company_id: 1 },
        { id: 2, name: 'John Doe', email: 'john@example.com', company_id: 2 },
        { id: 3, name: 'Jane Smith', email: 'jane@example.com', company_id: 1 },
      ]);

      await db.knex('profiles').insert([
        { id: 10, user_id: 1, bio: 'Lead Developer', website: 'https://ahmet.dev' },
        { id: 20, user_id: 2, bio: 'Product Manager', website: 'https://johndoe.com' },
      ]);

      await db.knex('posts').insert([
        { id: 101, title: 'Webspresso 1.0 Released', user_id: 1 },
        { id: 102, title: 'Understanding Zero Dependency', user_id: 1 },
        { id: 103, title: 'Guest Article Without Author', user_id: null },
      ]);

      await db.knex('comments').insert([
        { id: 1001, post_id: 101, user_id: 2, content: 'Awesome framework!' },
        { id: 1002, post_id: 101, user_id: 3, content: 'Love the performance!' },
        { id: 1003, post_id: 102, user_id: 1, content: 'Thank you all!' },
      ]);
    });

    afterEach(async () => {
      await db.destroy();
    });

    it('should eager load nested belongsTo in belongsTo: author.company', async () => {
      const posts = await db.getRepository('Post')
        .query()
        .where('id', 101)
        .include('author.company')
        .find();

      expect(posts.length).toBe(1);
      const post = posts[0];
      expect(post.author).toBeDefined();
      expect(post.author.name).toBe('Ahmet');
      expect(post.author.company).toBeDefined();
      expect(post.author.company.name).toBe('Webspresso HQ');
      // Verify JSON column was deserialized on nested relation
      expect(post.author.company.metadata).toEqual({ tier: 'enterprise' });
    });

    it('should eager load 3-level deep nested relation: author.company.country', async () => {
      const posts = await db.getRepository('Post')
        .query()
        .where('id', 101)
        .include('author.company.country')
        .find();

      expect(posts.length).toBe(1);
      const post = posts[0];
      expect(post.author.name).toBe('Ahmet');
      expect(post.author.company.name).toBe('Webspresso HQ');
      expect(post.author.company.country).toBeDefined();
      expect(post.author.company.country.name).toBe('Turkey');
      expect(post.author.company.country.code).toBe('TR');
    });

    it('should eager load nested hasOne: author.profile', async () => {
      const post = await db.getRepository('Post')
        .query()
        .where('id', 101)
        .include('author.profile')
        .first();

      expect(post).not.toBeNull();
      expect(post.author.profile).toBeDefined();
      expect(post.author.profile.bio).toBe('Lead Developer');
      expect(post.author.profile.website).toBe('https://ahmet.dev');
    });

    it('should eager load nested belongsTo in hasMany: comments.author', async () => {
      const post = await db.getRepository('Post')
        .query()
        .where('id', 101)
        .include('comments.author')
        .first();

      expect(post.comments).toHaveLength(2);

      const comment1 = post.comments.find((c) => c.id === 1001);
      const comment2 = post.comments.find((c) => c.id === 1002);

      expect(comment1.author).toBeDefined();
      expect(comment1.author.name).toBe('John Doe');

      expect(comment2.author).toBeDefined();
      expect(comment2.author.name).toBe('Jane Smith');
    });

    it('should eager load nested hasMany in hasMany: users.posts', async () => {
      const companies = await db.getRepository('Company')
        .query()
        .where('id', 1)
        .include('users.posts')
        .find();

      expect(companies.length).toBe(1);
      const company = companies[0];
      expect(company.users.length).toBeGreaterThan(0);

      const ahmet = company.users.find((u) => u.name === 'Ahmet');
      expect(ahmet).toBeDefined();
      expect(ahmet.posts).toHaveLength(2);
      expect(ahmet.posts.map((p) => p.title)).toContain('Webspresso 1.0 Released');
      expect(ahmet.posts.map((p) => p.title)).toContain('Understanding Zero Dependency');
    });

    it('should load multiple nested relations in a single query: author.profile, author.company, comments.author', async () => {
      const post = await db.getRepository('Post')
        .query()
        .where('id', 101)
        .include('author.profile', 'author.company', 'comments.author')
        .first();

      // Top level author
      expect(post.author.name).toBe('Ahmet');
      // Sibling nested relations under author
      expect(post.author.profile.bio).toBe('Lead Developer');
      expect(post.author.company.name).toBe('Webspresso HQ');
      // Separate branch comments.author
      expect(post.comments).toHaveLength(2);
      expect(post.comments[0].author).toBeDefined();
      expect(post.comments[1].author).toBeDefined();
    });

    it('should handle null relations gracefully without errors or queries', async () => {
      const post = await db.getRepository('Post')
        .query()
        .where('id', 103) // user_id is null
        .include('author.profile', 'author.company')
        .first();

      expect(post.author).toBeNull();
    });

    it('should support include and with as identical aliases', async () => {
      const resWith = await db.getRepository('Post')
        .query()
        .where('id', 101)
        .with('author.company')
        .find();

      const resInclude = await db.getRepository('Post')
        .query()
        .where('id', 101)
        .include('author.company')
        .find();

      expect(resWith).toEqual(resInclude);
    });

    it('should support find(), list(), and get() as identical execution methods on QueryBuilder', async () => {
      const q = () => db.getRepository('Post').query().where('id', 101).include('author.profile');

      const resFind = await q().find();
      const resList = await q().list();
      const resGet = await q().get();

      expect(resFind).toEqual(resList);
      expect(resFind).toEqual(resGet);
    });

    it('should support repo.findById with options.include', async () => {
      const post = await db.getRepository('Post').findById(101, {
        include: ['author.company'],
      });

      expect(post).not.toBeNull();
      expect(post.author.company.name).toBe('Webspresso HQ');
    });

    it('should support repo.findOne with options.include', async () => {
      const post = await db.getRepository('Post').findOne({ id: 101 }, {
        include: ['author.profile'],
      });

      expect(post).not.toBeNull();
      expect(post.author.profile.bio).toBe('Lead Developer');
    });

    it('should support repo.find(conditions, { include })', async () => {
      const posts = await db.getRepository('Post').find({ user_id: 1 }, {
        include: ['author.company'],
      });

      expect(posts.length).toBe(2);
      expect(posts[0].author.company.name).toBe('Webspresso HQ');
      expect(posts[1].author.company.name).toBe('Webspresso HQ');
    });

    it('should support repo.include() chaining shortcut: repo.include(...).find()', async () => {
      const posts = await db.getRepository('Post')
        .include('author.profile')
        .where('id', 101)
        .find();

      expect(posts.length).toBe(1);
      expect(posts[0].author.profile.bio).toBe('Lead Developer');
    });

    it('should work with pagination: paginate() with nested relations', async () => {
      const paginated = await db.getRepository('Post')
        .query()
        .include('author.company')
        .paginate(1, 10);

      expect(paginated.total).toBe(3);
      expect(paginated.data.length).toBe(3);

      const post101 = paginated.data.find((p) => p.id === 101);
      expect(post101.author.company.name).toBe('Webspresso HQ');

      const post103 = paginated.data.find((p) => p.id === 103);
      expect(post103.author).toBeNull();
    });
  });
});

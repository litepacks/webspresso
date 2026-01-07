/**
 * Seeder Integration Tests
 */

const { z } = require('zod');
const { faker } = require('@faker-js/faker');
const knex = require('knex');
const { createSchemaHelpers, defineModel, clearRegistry } = require('../../../core/orm');
const { createSeeder } = require('../../../core/orm/seeder');

describe('Seeder Integration', () => {
  const zdb = createSchemaHelpers(z);
  let knexInstance;
  let seederFactory;

  beforeAll(async () => {
    knexInstance = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    // Create tables
    await knexInstance.schema.createTable('companies', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.string('slug').unique();
      table.timestamp('created_at');
    });

    await knexInstance.schema.createTable('users', (table) => {
      table.increments('id').primary();
      table.string('email').unique().notNullable();
      table.string('name').notNullable();
      table.string('status').defaultTo('active');
      table.integer('company_id').references('id').inTable('companies');
      table.timestamp('created_at');
      table.timestamp('updated_at');
    });

    await knexInstance.schema.createTable('posts', (table) => {
      table.increments('id').primary();
      table.string('title').notNullable();
      table.text('content');
      table.string('status').defaultTo('draft');
      table.integer('user_id').references('id').inTable('users').notNullable();
      table.timestamp('published_at');
      table.timestamp('created_at');
    });

    // Create seeder factory function
    seederFactory = () => createSeeder(faker, knexInstance);
  });

  afterAll(async () => {
    await knexInstance.destroy();
  });

  beforeEach(async () => {
    clearRegistry();
    faker.seed(12345);

    // Define models
    const companySchema = z.object({
      id: zdb.id(),
      name: zdb.string(),
      slug: zdb.string({ unique: true }),
      created_at: zdb.timestamp({ auto: 'create', nullable: true }),
    });

    const Company = defineModel({
      name: 'Company',
      table: 'companies',
      schema: companySchema,
    });

    const userSchema = z.object({
      id: zdb.id(),
      email: zdb.string({ unique: true }),
      name: zdb.string(),
      status: zdb.enum(['active', 'inactive', 'pending'], { default: 'active' }),
      company_id: zdb.foreignKey('companies', { nullable: true }),
      created_at: zdb.timestamp({ auto: 'create', nullable: true }),
      updated_at: zdb.timestamp({ auto: 'update', nullable: true }),
    });

    const User = defineModel({
      name: 'User',
      table: 'users',
      schema: userSchema,
      relations: {
        company: { type: 'belongsTo', model: () => Company, foreignKey: 'company_id' },
      },
    });

    const postSchema = z.object({
      id: zdb.id(),
      title: zdb.string(),
      content: zdb.text({ nullable: true }),
      status: zdb.enum(['draft', 'published', 'archived'], { default: 'draft' }),
      user_id: zdb.foreignKey('users'),
      published_at: zdb.timestamp({ nullable: true }),
      created_at: zdb.timestamp({ auto: 'create', nullable: true }),
    });

    defineModel({
      name: 'Post',
      table: 'posts',
      schema: postSchema,
      relations: {
        author: { type: 'belongsTo', model: () => User, foreignKey: 'user_id' },
      },
    });

    // Clear tables
    await knexInstance('posts').del();
    await knexInstance('users').del();
    await knexInstance('companies').del();
  });

  describe('factory().create()', () => {
    it('should create and save a single record', async () => {
      const seeder = seederFactory();
      const company = await seeder.factory('Company').create();

      expect(company.id).toBeDefined();
      expect(company.name).toBeDefined();

      // Verify in database
      const found = await knexInstance('companies').where('id', company.id).first();
      expect(found).toBeDefined();
      expect(found.name).toBe(company.name);
    });

    it('should create multiple records', async () => {
      const seeder = seederFactory();
      const companies = await seeder.factory('Company').create(5);

      expect(companies).toHaveLength(5);

      const count = await knexInstance('companies').count('* as count').first();
      expect(count.count).toBe(5);
    });

    it('should apply overrides', async () => {
      const seeder = seederFactory();
      const company = await seeder.factory('Company')
        .override({ name: 'Test Company', slug: 'test-company' })
        .create();

      expect(company.name).toBe('Test Company');
      expect(company.slug).toBe('test-company');
    });

    it('should auto-create belongsTo relations', async () => {
      const seeder = seederFactory();
      
      // User has belongsTo Company, should auto-create company
      const user = await seeder.factory('User').create();

      expect(user.id).toBeDefined();
      expect(user.company_id).toBeDefined();

      // Verify company was created
      const company = await knexInstance('companies').where('id', user.company_id).first();
      expect(company).toBeDefined();
    });

    it('should create hasMany relations with with()', async () => {
      const seeder = seederFactory();

      // First create a user
      const user = await seeder.factory('User').create();

      // Then create posts for that user
      const seeder2 = seederFactory();
      const posts = await seeder2.factory('Post')
        .override({ user_id: user.id })
        .create(3);

      expect(posts).toHaveLength(3);
      posts.forEach(post => {
        expect(post.user_id).toBe(user.id);
      });
    });
  });

  describe('seed()', () => {
    it('should seed a model with specified count', async () => {
      const seeder = seederFactory();
      const companies = await seeder.seed('Company', 10);

      expect(companies).toHaveLength(10);

      const count = await knexInstance('companies').count('* as count').first();
      expect(count.count).toBe(10);
    });

    it('should apply options to seed', async () => {
      const seeder = seederFactory();
      
      seeder.defineFactory('Company', {
        states: {
          tech: { name: 'Tech Corp' },
        },
      });

      const companies = await seeder.seed('Company', 3, { state: 'tech' });

      companies.forEach(c => {
        expect(c.name).toBe('Tech Corp');
      });
    });
  });

  describe('run()', () => {
    it('should run multiple seeders', async () => {
      const seeder = seederFactory();

      const results = await seeder.run([
        { model: 'Company', count: 5 },
      ]);

      expect(results.Company).toHaveLength(5);

      const companyCount = await knexInstance('companies').count('* as count').first();
      expect(companyCount.count).toBe(5);
    });
  });

  describe('truncate() and clearAll()', () => {
    it('should truncate a single table', async () => {
      const seeder = seederFactory();
      
      // Create some data
      await seeder.seed('Company', 5);
      
      let count = await knexInstance('companies').count('* as count').first();
      expect(count.count).toBe(5);

      // Truncate
      await seeder.truncate('Company');

      count = await knexInstance('companies').count('* as count').first();
      expect(count.count).toBe(0);
    });

    it('should truncate multiple tables', async () => {
      const seeder = seederFactory();
      
      await seeder.seed('Company', 3);
      
      await seeder.truncate(['Company']);

      const count = await knexInstance('companies').count('* as count').first();
      expect(count.count).toBe(0);
    });

    it('should clear all tables', async () => {
      const seeder = seederFactory();
      
      // Create companies first
      const companies = await seeder.seed('Company', 2);
      
      // Create users with company
      await seeder.factory('User')
        .override({ company_id: companies[0].id })
        .create(2);

      // Clear all (should handle foreign keys)
      await seeder.clearAll();

      const userCount = await knexInstance('users').count('* as count').first();
      const companyCount = await knexInstance('companies').count('* as count').first();

      expect(userCount.count).toBe(0);
      expect(companyCount.count).toBe(0);
    });
  });

  describe('defineFactory with states', () => {
    it('should use defined factory with states', async () => {
      const seeder = seederFactory();

      seeder.defineFactory('User', {
        defaults: { status: 'pending' },
        states: {
          active: { status: 'active' },
          admin: (f) => ({ 
            email: `admin-${f.number.int({ max: 1000 })}@example.com`,
            status: 'active',
          }),
        },
      });

      const pendingUser = await seeder.factory('User').create();
      expect(pendingUser.status).toBe('pending');

      const activeUser = await seeder.factory('User').state('active').create();
      expect(activeUser.status).toBe('active');

      const adminUser = await seeder.factory('User').state('admin').create();
      expect(adminUser.status).toBe('active');
      expect(adminUser.email).toMatch(/^admin-\d+@example\.com$/);
    });
  });

  describe('custom generators', () => {
    it('should use custom generators', async () => {
      const seeder = seederFactory();

      const company = await seeder.factory('Company')
        .generators({
          name: () => 'Custom Company Name',
          slug: (f) => `custom-${f.string.alphanumeric(6).toLowerCase()}`,
        })
        .create();

      expect(company.name).toBe('Custom Company Name');
      expect(company.slug).toMatch(/^custom-[a-z0-9]{6}$/);
    });
  });

  describe('real-world scenario', () => {
    it('should seed a complete dataset', async () => {
      const seeder = seederFactory();

      // Define factories
      seeder.defineFactory('Company', {
        generators: {
          slug: (f) => f.lorem.slug({ min: 2, max: 3 }),
        },
      });

      seeder.defineFactory('User', {
        states: {
          active: { status: 'active' },
          inactive: { status: 'inactive' },
        },
      });

      seeder.defineFactory('Post', {
        states: {
          published: { status: 'published', published_at: new Date().toISOString() },
          draft: { status: 'draft' },
        },
      });

      // Seed companies
      const companies = await seeder.seed('Company', 3);

      // Seed users for each company
      const allUsers = [];
      for (const company of companies) {
        const users = await seeder.factory('User')
          .state('active')
          .override({ company_id: company.id })
          .create(2);
        allUsers.push(...(Array.isArray(users) ? users : [users]));
      }

      // Seed posts for some users
      for (const user of allUsers.slice(0, 3)) {
        await seeder.factory('Post')
          .state('published')
          .override({ user_id: user.id })
          .create(2);
      }

      // Verify
      const companyCount = await knexInstance('companies').count('* as count').first();
      const userCount = await knexInstance('users').count('* as count').first();
      const postCount = await knexInstance('posts').count('* as count').first();

      expect(companyCount.count).toBe(3);
      expect(userCount.count).toBe(6);
      expect(postCount.count).toBe(6);

      // Verify relationships
      const usersWithCompany = await knexInstance('users')
        .whereNotNull('company_id');
      expect(usersWithCompany.length).toBe(6);

      const publishedPosts = await knexInstance('posts')
        .where('status', 'published');
      expect(publishedPosts.length).toBe(6);
    });
  });
});


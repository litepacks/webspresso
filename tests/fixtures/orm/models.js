/**
 * Test Models for ORM
 * User belongs to Company, User has many Posts
 */

const { z } = require('zod');
const { createSchemaHelpers, defineModel, clearRegistry } = require('../../../core/orm');

// Create zdb helpers
const zdb = createSchemaHelpers(z);

// ============================================================================
// Company Model
// ============================================================================

const CompanySchema = z.object({
  id: zdb.id(),
  name: zdb.string({ maxLength: 255 }),
  slug: zdb.string({ maxLength: 100, unique: true }),
  created_at: zdb.timestamp({ auto: 'create' }),
  updated_at: zdb.timestamp({ auto: 'update' }),
});

// ============================================================================
// User Model
// ============================================================================

const UserSchema = z.object({
  id: zdb.id(),
  email: zdb.string({ maxLength: 255, unique: true, index: true }),
  name: zdb.string({ maxLength: 255 }),
  status: zdb.enum(['active', 'inactive', 'banned'], { default: 'active' }),
  company_id: zdb.foreignKey('companies', { nullable: true }),
  created_at: zdb.timestamp({ auto: 'create' }),
  updated_at: zdb.timestamp({ auto: 'update' }),
  deleted_at: zdb.timestamp({ nullable: true }),
});

// ============================================================================
// Post Model
// ============================================================================

const PostSchema = z.object({
  id: zdb.id(),
  title: zdb.string({ maxLength: 255 }),
  content: zdb.text({ nullable: true }),
  published: zdb.boolean({ default: false }),
  user_id: zdb.foreignKey('users'),
  created_at: zdb.timestamp({ auto: 'create' }),
  updated_at: zdb.timestamp({ auto: 'update' }),
  deleted_at: zdb.timestamp({ nullable: true }),
});

// ============================================================================
// Define Models (lazy to avoid circular dependencies)
// ============================================================================

let Company, User, Post;

/**
 * Initialize models (clears registry first for testing)
 * @returns {{ Company, User, Post }}
 */
function initModels() {
  // Clear registry for fresh start (important for tests)
  clearRegistry();

  Company = defineModel({
    name: 'Company',
    table: 'companies',
    schema: CompanySchema,
    primaryKey: 'id',
    relations: {
      users: {
        type: 'hasMany',
        model: () => User,
        foreignKey: 'company_id',
      },
    },
    scopes: {
      timestamps: true,
    },
  });

  User = defineModel({
    name: 'User',
    table: 'users',
    schema: UserSchema,
    primaryKey: 'id',
    relations: {
      company: {
        type: 'belongsTo',
        model: () => Company,
        foreignKey: 'company_id',
      },
      posts: {
        type: 'hasMany',
        model: () => Post,
        foreignKey: 'user_id',
      },
    },
    scopes: {
      softDelete: true,
      timestamps: true,
    },
  });

  Post = defineModel({
    name: 'Post',
    table: 'posts',
    schema: PostSchema,
    primaryKey: 'id',
    relations: {
      author: {
        type: 'belongsTo',
        model: () => User,
        foreignKey: 'user_id',
      },
    },
    scopes: {
      softDelete: true,
      timestamps: true,
    },
  });

  return { Company, User, Post };
}

/**
 * Create test database schema
 * @param {import('knex').Knex} knex - Knex instance
 */
async function createTestSchema(knex) {
  // Create companies table
  await knex.schema.createTable('companies', (table) => {
    table.bigIncrements('id').primary();
    table.string('name', 255).notNullable();
    table.string('slug', 100).unique().notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Create users table
  await knex.schema.createTable('users', (table) => {
    table.bigIncrements('id').primary();
    table.string('email', 255).unique().notNullable();
    table.string('name', 255).notNullable();
    table.enum('status', ['active', 'inactive', 'banned']).defaultTo('active');
    table.bigInteger('company_id').unsigned().nullable();
    table.foreign('company_id').references('id').inTable('companies');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.timestamp('deleted_at').nullable();
    table.index(['email']);
  });

  // Create posts table
  await knex.schema.createTable('posts', (table) => {
    table.bigIncrements('id').primary();
    table.string('title', 255).notNullable();
    table.text('content').nullable();
    table.boolean('published').defaultTo(false);
    table.bigInteger('user_id').unsigned().notNullable();
    table.foreign('user_id').references('id').inTable('users');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.timestamp('deleted_at').nullable();
  });
}

/**
 * Drop test database schema
 * @param {import('knex').Knex} knex - Knex instance
 */
async function dropTestSchema(knex) {
  await knex.schema.dropTableIfExists('posts');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('companies');
}

/**
 * Seed test data
 * @param {import('knex').Knex} knex - Knex instance
 */
async function seedTestData(knex) {
  // Seed companies
  await knex('companies').insert([
    { id: 1, name: 'Acme Corp', slug: 'acme-corp' },
    { id: 2, name: 'Tech Inc', slug: 'tech-inc' },
  ]);

  // Seed users
  await knex('users').insert([
    { id: 1, email: 'john@acme.com', name: 'John Doe', status: 'active', company_id: 1 },
    { id: 2, email: 'jane@acme.com', name: 'Jane Smith', status: 'active', company_id: 1 },
    { id: 3, email: 'bob@tech.com', name: 'Bob Wilson', status: 'inactive', company_id: 2 },
    { id: 4, email: 'deleted@test.com', name: 'Deleted User', status: 'active', company_id: null, deleted_at: new Date() },
  ]);

  // Seed posts
  await knex('posts').insert([
    { id: 1, title: 'First Post', content: 'Hello world!', published: true, user_id: 1 },
    { id: 2, title: 'Second Post', content: 'Another post', published: false, user_id: 1 },
    { id: 3, title: 'Tech Update', content: 'New tech stuff', published: true, user_id: 3 },
  ]);
}

module.exports = {
  // Schemas
  CompanySchema,
  UserSchema,
  PostSchema,
  
  // Model initializer
  initModels,
  
  // Test helpers
  createTestSchema,
  dropTestSchema,
  seedTestData,
  
  // zdb helper
  zdb,
};


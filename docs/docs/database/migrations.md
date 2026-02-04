---
sidebar_position: 7
---

# Migrations

Migrations allow you to version control your database schema changes.

## CLI Commands

### Create Migration

```bash
# Create empty migration
webspresso db:make create_posts_table

# Create migration from model (scaffolding)
webspresso db:make create_users_table --model User
```

### Run Migrations

```bash
# Run pending migrations
webspresso db:migrate
```

### Rollback Migrations

```bash
# Rollback last batch
webspresso db:rollback

# Rollback all migrations
webspresso db:rollback --all
```

### Check Status

```bash
# Show migration status
webspresso db:status
```

## Migration Files

Migrations are stored in the `migrations/` directory:

```
migrations/
├── 20240101_120000_create_users_table.js
├── 20240102_140000_create_posts_table.js
└── 20240103_160000_add_email_to_users.js
```

## Creating Migrations

### Empty Migration

```bash
webspresso db:make create_posts_table
```

Creates:

```javascript
// migrations/YYYYMMDD_HHMMSS_create_posts_table.js
exports.up = function(knex) {
  // Migration logic
};

exports.down = function(knex) {
  // Rollback logic
};
```

### Scaffold from Model

Generate migration from model schema:

```bash
webspresso db:make create_users_table --model User
```

This automatically generates:

- All columns with proper types
- Indexes
- Foreign key constraints
- Up and down functions

## Writing Migrations

### Create Table

```javascript
exports.up = function(knex) {
  return knex.schema.createTable('users', function(table) {
    table.bigIncrements('id').primary();
    table.string('email', 255).unique().notNullable();
    table.string('name', 100).notNullable();
    table.enum('status', ['active', 'inactive']).defaultTo('active');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('users');
};
```

### Alter Table

```javascript
exports.up = function(knex) {
  return knex.schema.table('users', function(table) {
    table.string('phone', 20).nullable();
    table.index('email');
  });
};

exports.down = function(knex) {
  return knex.schema.table('users', function(table) {
    table.dropColumn('phone');
    table.dropIndex('email');
  });
};
```

### Foreign Keys

```javascript
exports.up = function(knex) {
  return knex.schema.table('posts', function(table) {
    table.bigInteger('user_id').unsigned().notNullable();
    table.foreign('user_id').references('id').inTable('users');
  });
};

exports.down = function(knex) {
  return knex.schema.table('posts', function(table) {
    table.dropForeign('user_id');
    table.dropColumn('user_id');
  });
};
```

## Database Configuration

Create `webspresso.db.js`:

```javascript
module.exports = {
  client: 'pg', // or 'mysql2', 'better-sqlite3'
  connection: process.env.DATABASE_URL,
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations',
  },
  
  // Environment overrides
  production: {
    connection: process.env.DATABASE_URL,
    pool: { min: 2, max: 10 },
  },
};
```

## Programmatic API

Use migrations programmatically:

```javascript
const db = createDatabase({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  migrations: { directory: './migrations' },
});

// Run pending migrations
await db.migrate.latest();

// Rollback last batch
await db.migrate.rollback();

// Rollback all
await db.migrate.rollback({ all: true });

// Get status
const status = await db.migrate.status();
```

## Migration Scaffolding

Generate migration from model:

```javascript
const { scaffoldMigration } = require('webspresso');

const migration = scaffoldMigration(User);
// Outputs complete migration file content with:
// - All columns with proper types
// - Indexes
// - Foreign key constraints
// - Up and down functions
```

## Best Practices

1. **Always write down migrations**: Every migration should have a corresponding `down` function
2. **Test rollbacks**: Ensure migrations can be rolled back safely
3. **Use transactions**: Wrap migrations in transactions when possible
4. **Keep migrations small**: One logical change per migration
5. **Never modify existing migrations**: Create new migrations to alter schema

## Examples

### Complete Migration

```javascript
exports.up = function(knex) {
  return knex.schema.createTable('posts', function(table) {
    table.bigIncrements('id').primary();
    table.bigInteger('user_id').unsigned().notNullable();
    table.string('title', 200).notNullable();
    table.text('content').notNullable();
    table.string('slug', 255).unique().notNullable();
    table.enum('status', ['draft', 'published']).defaultTo('draft');
    table.timestamp('published_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.timestamp('deleted_at').nullable();
    
    table.foreign('user_id').references('id').inTable('users');
    table.index('slug');
    table.index('user_id');
    table.index('status');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('posts');
};
```

## Next Steps

- [Seeding](/database/seeding) - Generate test data
- [Transactions](/database/transactions) - Database transactions

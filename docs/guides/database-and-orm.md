# Database & ORM Guide

> **Goal:** Define models, run Knex migrations, execute queries with scoped repositories, and manage relations.

---

## 1. Database Connection Configuration

Configure your database connection in `webspresso.db.js`:

```javascript
// webspresso.db.js
module.exports = {
  client: 'better-sqlite3',
  connection: {
    filename: process.env.DATABASE_URL || './data/app.sqlite',
  },
  useNullAsDefault: true,
};
```

Pass the database instance to `createApp()`:

```javascript
// server.js
const { createApp, createDatabase } = require('webspresso');
const dbConfig = require('./webspresso.db');

const db = createDatabase(dbConfig);

const { app } = createApp({
  db,
  pagesDir: path.join(__dirname, 'pages'),
  viewsDir: path.join(__dirname, 'views'),
});
```

---

## 2. Defining Models (`defineModel`)

Create model definitions in `models/`:

```javascript
// models/User.js
const { defineModel, zdb } = require('webspresso');

module.exports = defineModel({
  name: 'User',
  table: 'users',

  schema: zdb.schema({
    id: zdb.id(),
    email: zdb.string({ unique: true }),
    name: zdb.string(),
    role: zdb.enum(['admin', 'editor', 'member'], { default: 'member' }),
    active: zdb.boolean({ default: true }),
    createdAt: zdb.datetime({ autoNowAdd: true }),
    updatedAt: zdb.datetime({ autoNow: true }),
  }),

  // Model relations
  relations: {
    posts: {
      type: 'hasMany',
      model: 'Post',
      foreignKey: 'userId',
    },
  },

  // Soft delete support
  softDelete: true,
});
```

---

## 3. Repositories API

Access model repositories via `db.getRepository('ModelName')` or `ctx.db.getRepository('ModelName')`:

```javascript
const userRepo = db.getRepository('User');

// Find by ID
const user = await userRepo.findById(123);

// Find one by criteria
const admin = await userRepo.findOne({ email: 'admin@example.com' });

// Paginated query
const paginated = await userRepo.paginate({
  page: 1,
  limit: 20,
  where: { active: true },
  orderBy: { field: 'createdAt', direction: 'desc' },
  include: ['posts'], // Eager load hasMany posts
});

// Create record
const newUser = await userRepo.create({
  email: 'user@example.com',
  name: 'John Doe',
});

// Update record
await userRepo.update(newUser.id, { name: 'Johnathan Doe' });

// Delete record (or soft delete if softDelete: true)
await userRepo.delete(newUser.id);
```

---

## 4. Knex Migrations

Manage database schema changes with the Webspresso CLI:

```bash
# Create a new migration file
npx webspresso db:migrate:make create_users_table

# Run pending migrations
npx webspresso db:migrate

# Rollback last migration batch
npx webspresso db:migrate:rollback
```

Migration file syntax:

```javascript
// migrations/20260828000000_create_users_table.js
exports.up = function(knex) {
  return knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('email').notNullable().unique();
    table.string('name').notNullable();
    table.string('role').defaultTo('member');
    table.boolean('active').defaultTo(true);
    table.timestamps(true, true);
    table.timestamp('deletedAt').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('users');
};
```

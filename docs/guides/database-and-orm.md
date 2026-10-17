---
title: Database & ORM
description: defineModel, zdb schemas, repositories, migrations, relations, and query caching.
---

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
  timestamps: true, // Auto-injects createdAt & updatedAt into schema, validations & query hooks
  softDelete: true, // Auto-injects deletedAt & enables automatic soft-delete scoping

  schema: {
    id: zdb.id(),
    email: zdb.string({ unique: true }),
    name: zdb.string(),
    role: zdb.enum(['admin', 'editor', 'member'], { default: 'member' }),
    active: zdb.boolean({ default: true }),
  },

  // Model relations
  relations: {
    posts: {
      type: 'hasMany',
      model: () => 'Post',
      foreignKey: 'userId',
      cascade: true, // Cascades soft-delete, hard-delete, and selective restore
    },
  },
});
```

> **Tip:** You can declare `timestamps: true` and `softDelete: true` at the model level (or inside `options: { timestamps: true, softDelete: true }`). Webspresso automatically injects `createdAt`, `updatedAt`, and `deletedAt` into your model's Zod schema, column definitions, migrations, and repository scopes.
>
> If you prefer explicit schema declarations or snake_case column names, you can also use `...zdb.timestamps()` and `...zdb.softDeletes()`, or pass options: `{ timestamps: { snakeCase: true } }`.

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

---

## 5. Relational Cascading Soft-Delete & Selective Restore

Webspresso ORM supports automatic relational cascading for `hasMany` and `hasOne` relations with `cascade: true`.

```javascript
// Model Definition
defineModel({
  name: 'User',
  table: 'users',
  schema: UserSchema,
  relations: {
    posts: {
      type: 'hasMany',
      model: () => 'Post',
      foreignKey: 'user_id',
      cascade: true,
    },
    profile: {
      type: 'hasOne',
      model: () => 'Profile',
      foreignKey: 'user_id',
      cascade: true,
    },
  },
  scopes: { softDelete: true },
});
```

### Soft-Delete Cascade
When `userRepo.delete(userId)` is called, the user and all associated active `posts` and `profile` records are soft-deleted with the exact same `deleted_at` timestamp.

### Selective Restore (Timestamp Matching)
When `userRepo.restore(userId)` is called, only child records deleted in the same cascade deletion event are restored. Child records that were manually soft-deleted earlier remain safely deleted:

```javascript
// Restore parent and matching cascaded children
await userRepo.restore(userId);

// Force restore ALL children regardless of when they were deleted
await userRepo.restore(userId, { allChildren: true });

// Skip cascading for a specific call
await userRepo.delete(userId, { cascade: false });
await userRepo.restore(userId, { cascade: false });
```

### Permanent Hard-Delete (`forceDelete`)
When `userRepo.forceDelete(userId)` is called, cascading child records are permanently deleted first to satisfy database foreign-key constraints before deleting the parent.


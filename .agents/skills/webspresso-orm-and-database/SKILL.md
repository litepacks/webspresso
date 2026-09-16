---
name: webspresso-orm-and-database
description: >-
  Define models, run queries, handle transactions, manage relations, and scaffold migrations in
  Webspresso ORM. Use when writing database models (defineModel), using zdb schema builders,
  querying repositories (db.getRepository), configuring query cache, soft deletes, and ambient transactions.
---

# Webspresso ORM & Database Skill

⚠️ **CRITICAL ANTI-PATTERN:** Never write raw Knex table queries (e.g. `db('users')` or `knex('users')`) in application code. Always use Repositories (`db.getRepository('ModelName')`).

---

## 1. Defining Models (`models/*.js`)

```javascript
const { defineModel, zdb } = require('webspresso');

module.exports = defineModel({
  name: 'Product',
  table: 'products',
  primaryKey: 'id',
  
  schema: zdb.object({
    id: zdb.id(),
    name: zdb.string().min(1).max(255),
    slug: zdb.string().unique(),
    price: zdb.decimal({ precision: 10, scale: 2 }),
    in_stock: zdb.boolean().default(true),
    metadata: zdb.json().optional(),
    user_id: zdb.foreignKey('users.id'),
    created_at: zdb.timestamp().autoCreate(),
    updated_at: zdb.timestamp().autoUpdate(),
    deleted_at: zdb.timestamp().nullable(),
  }),

  relations: {
    user: {
      type: 'belongsTo',
      model: 'User',
      foreignKey: 'user_id',
    },
    reviews: {
      type: 'hasMany',
      model: 'Review',
      foreignKey: 'product_id',
    },
  },

  scopes: {
    softDelete: true, // enables deleted_at filtering automatically
    active: (query) => query.where('in_stock', true),
  },

  hidden: ['metadata.internal_notes'], // stripped from output

  cache: 'auto', // query caching ('auto' | 'smart' | true)

  admin: {
    enabled: true,
    label: 'Products',
    icon: 'package',
    columns: ['name', 'price', 'in_stock', 'created_at'],
    search: ['name', 'slug'],
    filters: ['in_stock', 'user_id'],
  },
});
```

---

## 2. Repositories API

```javascript
const repo = db.getRepository('Product');

// Single Record Queries
const item = await repo.findById(id);
const item = await repo.findOne({ slug: 'espresso-blend' });

// Multiple Records & Filtering
const activeItems = await repo.find({ in_stock: true });

// Insert & Update (auto-validates with schema & triggers lifecycle hooks)
const created = await repo.create({
  name: 'Espresso Blend',
  slug: 'espresso-blend',
  price: 14.99,
  user_id: user.id,
});

const updated = await repo.update(created.id, { price: 16.99 });

// Deletion (respects softDelete scope)
await repo.delete(id);

// Fluent Query Builder with Eager Loading & Pagination
const results = await repo.query()
  .where('price', '>=', 10)
  .include('user', 'reviews')
  .orderBy('created_at', 'desc')
  .paginate({ page: 1, limit: 20 });
// Returns: { data: [...], pagination: { total, page, limit, totalPages } }
```

---

## 3. Ambient Transactions (`AsyncLocalStorage`)

Inside `db.transaction()` or services declared with `transaction: true`, all repository operations automatically bind to the ambient transaction without manual `trx` passing:

```javascript
await db.transaction(async () => {
  const user = await db.getRepository('User').create(userData);
  const account = await db.getRepository('Account').create({ userId: user.id, balance: 100 });
  // Automatically commits if promise resolves, or rolls back if an exception is thrown
});
```

# Webspresso ORM & Database Layer Guide

Webspresso features an intuitive, zero-sprawl ORM (`core/orm`) supporting schema definitions with `zdb`, repository pattern, query caching, soft deletes, multi-tenant scopes, and relation eager loading.

---

## ⚠️ STRICT RULE: ALWAYS Use Repositories (NO Raw Knex `db('table')`)

In application code (API handlers, SSR loaders, services, plugins), **NEVER** write raw Knex table queries like `db('table').where(...)` or `req.db('table').insert(...)`.
Raw Knex queries **completely bypass** schema validation, lifecycle hooks, soft-delete scopes, multi-tenant filters, hidden field stripping, query caching, and ambient transactions.

### ❌ BAD vs ✅ GOOD Code Comparison

```javascript
// ❌ WRONG (Raw Knex — bypasses hooks, schemas, hidden fields, caching)
const user = await req.db('users').where({ id: req.params.id }).first();
await req.db('users').where({ id }).update({ balance: 100 });

// ✅ CORRECT (Webspresso Repository Pattern)
const userRepo = req.db.getRepository('User');
const user = await userRepo.findById(req.params.id);
await userRepo.update(id, { balance: 100 });
```

### Comparison: Raw Knex vs Webspresso Repository

| Operation | ❌ NEVER Use Raw Knex | ✅ ALWAYS Use Repository (`db.getRepository`) |
| :--- | :--- | :--- |
| **Get by ID** | `await db('notes').where({ id }).first()` | `await noteRepo.findById(id)` |
| **Find List** | `await db('notes').where({ active: true })` | `await noteRepo.find({ active: true })` |
| **Find One** | `await db('notes').where({ slug }).first()` | `await noteRepo.findOne({ slug })` |
| **Create Record** | `await db('notes').insert(data)` | `await noteRepo.create(data)` *(validates schema & runs hooks)* |
| **Update Record** | `await db('notes').where({ id }).update(data)`| `await noteRepo.update(id, data)` |
| **Delete Record** | `await db('notes').where({ id }).del()` | `await noteRepo.delete(id)` *(respects soft-delete)* |
| **Custom Query** | `db('notes').where('price', '>', 100)` | `noteRepo.query().where('price', '>', 100)` |
| **Eager Load** | *Manual SQL joins and manual mapping* | `noteRepo.query().include('user', 'tags').find()` |
| **Pagination** | *Manual count + offset/limit calculation* | `noteRepo.query().paginate({ page, limit })` |

> [!NOTE]
> `noteRepo.query()` returns a fully-featured, model-aware query builder that supports all Knex chaining (`where`, `whereIn`, `orderBy`, etc.) while preserving model scopes, hooks, and transactions!

---

## 1. Model Definitions & `zdb` Schemas

Models are defined in `models/*.js` using `defineModel`:

```js
import { defineModel, zdb } from 'webspresso';

export default defineModel({
  name: 'Product',
  table: 'products',
  timestamps: true, // auto-injects createdAt & updatedAt into schema & scopes
  softDelete: true, // auto-injects deletedAt & manages soft-delete scope
  schema: {
    id: zdb.id(),
    name: zdb.string().min(2),
    slug: zdb.string().unique(),
    price: zdb.number().positive(),
    description: zdb.text({ optional: true }),
    image: zdb.file({ optional: true }),
    metadata: zdb.json({ optional: true }),
    category_id: zdb.integer(),
    active: zdb.boolean({ default: true }),
  },
  relations: {
    category: { type: 'belongsTo', model: 'Category', foreignKey: 'category_id' },
    reviews: { type: 'hasMany', model: 'Review', foreignKey: 'product_id' },
  },
  scopes: {
    active: (qb) => qb.where('active', true),
  },
  hidden: ['metadata'],
  admin: {
    enabled: true,
    label: 'Products',
    icon: '📦',
  },
  cache: 'auto', // 'auto' | 'smart' | true | false
});
```

### Automatic Timestamps & Soft Deletes (`timestamps`, `softDelete`)
Instead of manually defining boilerplate timestamp and soft delete columns in `schema`, configure them declaratively:
- **Top-level / Options:** `timestamps: true` (or `options: { timestamps: true }`) automatically injects `createdAt` and `updatedAt` into the Zod schema, validation rules, column map, and Knex migrations.
- **Soft Deletes:** `softDelete: true` (or `softDeletes: true`) automatically injects `deletedAt` (nullable/optional) into the schema and activates the repository `whereNull('deletedAt')` soft-delete scope.
- **Custom column names & snake_case:** `timestamps: { snakeCase: true }` or `timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }`, `softDelete: { deletedAt: 'deleted_at' }`.
- **Explicit Schema Spread:** `...zdb.timestamps()` and `...zdb.softDeletes()` are also supported for explicit schema definitions.

### Supported `zdb` Data Types
- `zdb.id()` — Primary key (BigInt / Auto-increment)
- `zdb.string({ max, unique, optional, sortable })` — String / VarChar
- `zdb.text({ sortable })` — Text blob
- `zdb.integer()`, `zdb.number({ sortable })` — Numeric types
- `zdb.boolean({ default, sortable })` — Boolean flag
- `zdb.file()` — File asset URL / upload path (non-sortable by default)
- `zdb.json()` — Serialized JSON column (non-sortable by default)
- `zdb.timestamp({ auto, sortable })` — Timestamp (`auto: 'create'` / `auto: 'update'`)
- `zdb.timestamps({ snakeCase })` — Timestamp pair (`createdAt`, `updatedAt`)
- `zdb.softDelete()`, `zdb.softDeletes({ snakeCase })` — Soft delete timestamp (`deletedAt`)

*Note: All `zdb` types support chainable `.config({ sortable: boolean })` or options object `{ sortable: boolean }`.*

---

## 2. Repository API

Repositories are accessed via `db.getRepository(modelName)` or `req.db.getRepository(modelName)`:

```js
const productRepo = db.getRepository('Product');

// 1. Basic Read & Find
const product = await productRepo.findById(1);
const activeProducts = await productRepo.find({ active: true });
const singleProduct = await productRepo.findOne({ slug: 'laptop' });

// 2. Insert, Update, Delete & Batch Operations
const newProduct = await productRepo.create({ name: 'Laptop', price: 999, category_id: 1 });
const updated = await productRepo.update(newProduct.id, { price: 899 });
await productRepo.delete(newProduct.id); // Soft or hard delete based on model config

// 2.1 Batch Insert (Auto-Chunked with SQL Variable Limit Protection)
// Automatically chunks rows to stay safely within SQLite/Postgres parameter limits (prevents 'too many SQL variables' error)
// and executes inside an atomic transaction (all succeed or all rollback).
const products = await productRepo.createBatch([
  { name: 'Tablet', price: 499, category_id: 1 },
  { name: 'Phone', price: 799, category_id: 1 },
], { chunkSize: 500, transaction: true });

// 2.2 Upsert & Batch Upsert (onConflict Merge)
// Inserts new records or updates existing records on conflict target (e.g. sku or primaryKey)
const upserted = await productRepo.upsert(
  { sku: 'SKU-001', name: 'Keyboard', price: 59 },
  'sku',
  ['name', 'price']
);

const batchUpserted = await productRepo.upsertBatch(
  catalogItems,
  'sku',
  { updateColumns: ['name', 'price', 'updated_at'] }
);

// 3. Query Builder & Pagination
const result = await productRepo.query()
  .where('price', '>', 500)
  .orderBy('created_at', 'desc')
  .paginate({ page: 1, limit: 10 });
// Returns: { data: [...], pagination: { page: 1, limit: 10, total: 42, totalPages: 5 } }
```

---

## 3. Relations & Nested Eager Loading

Support for `belongsTo`, `hasMany`, and `hasOne` with arbitrary-depth batch nested loading:

```js
// 1. Direct eager loading
const products = await productRepo.query()
  .include('category', 'reviews')
  .find();

// 2. Nested eager loading (dot notation)
const posts = await postRepo.query()
  .include('author.profile', 'author.company.country', 'comments.author')
  .find();

// 3. Eager loading via repository methods
const post = await postRepo.findById(id, { include: ['author.profile'] });
const list = await postRepo.find({ active: true }, { include: ['author.company'] });

// 4. Shorthand repository chaining
const result = await postRepo.include('author.profile').where('user_id', 1).find();
```

> [!TIP]
> Nested relations are loaded using optimized batch queries (`whereIn`) with zero N+1 queries. Shared object references and JSON columns on related models are automatically handled.

---

## 4. Ambient Transactions & AsyncLocalStorage

Webspresso features transparent **Ambient Transactions** (`core/orm/transaction.js`). When code executes inside `db.transaction()` or a service with `transaction: true`, all standard repository operations and query builders (`db.getRepository(...)`, `repo.create()`, `repo.update()`, `repo.query()`) automatically bind to the active transaction context without requiring manual `trx` passing:

```js
// 1. Database Ambient Transaction
await db.transaction(async () => {
  // All repositories automatically bind to the current transaction!
  const user = await db.getRepository('User').create({ name: 'Alice', email: 'alice@example.com' });
  await db.getRepository('Wallet').create({ user_id: user.id, balance: 100 });
  // If an error is thrown anywhere in this block, all operations roll back automatically!
});

// 2. Checking active transaction state
if (db.hasActiveTransaction()) {
  const currentTrx = db.getAmbientTransaction();
}

// 3. Low-level ambient runner
import { runWithAmbientTransaction } from 'webspresso';
await runWithAmbientTransaction(trx, async () => {
  await db.getRepository('Order').update(orderId, { status: 'paid' });
});
```

---

## 5. Query Caching (`cache`)

- **`cache: 'auto'`**: Caches primary key lookups (`findById`) and invalidates automatically on `create`, `update`, `delete`.
- **`cache: 'smart'`**: Selective invalidation per updated record ID.
- **Cache Provider**: In-memory cache by default (`createMemoryCacheProvider`). Supports custom Redis / Memcached providers.

---

## 5. Schema Migrations

Database migrations are managed via Knex in `migrations/`:

```bash
# Run migrations
npx webspresso db:migrate

# Seed database
npx webspresso db:seed
```

---

## 6. REST API Exposure (`restResourcePlugin`)

Models can be exposed as RESTful CRUD endpoints automatically via `restResourcePlugin`:

```js
defineModel({
  name: 'Product',
  table: 'products',
  schema: zdb.schema({ /* ... */ }),
  hidden: ['secret_token'],
  rest: {
    enabled: true,                // Expose REST routes /api/rest/products
    path: 'items',                // Custom path segment (default: pluralized model name)
    allowInclude: ['category'],   // Whitelist relations for ?include=
  },
});
```

See [Plugin Ecosystem Guide](.agents/PLUGINS.md#216-restresourceplugin-pluginsrest-resources) for full details on querying, filtering, pagination, and soft-delete scoping.

---

## 7. Query Complexity & DoS Protection (`queryLimits`)

Webspresso protects your database against unconstrained queries, heavy relation eager loading, and connection pool exhaustion:

```js
defineModel({
  name: 'Product',
  table: 'products',
  schema: zdb.schema({ /* ... */ }),
  queryLimits: {
    maxLimit: 100,            // Max items allowed in a single page (default: 100)
    defaultLimit: 20,         // Default perPage limit (default: 15)
    maxIncludes: 5,           // Max relations eager loaded in one query (default: 5)
    maxFilterConditions: 25,  // Max WHERE filters permitted (default: 25)
  },
});
```

- **QueryBuilder Enforcement**: `query().paginate()` and `query().limit()` clamp requested limits to `maxLimit`.
- **Include Guards**: Excessive `query().with(...)` or `?include=...` relations beyond `maxIncludes` throw `QueryComplexityError` or safely cap relations.
- **REST Resources Protection**: Automatically validates client parameters (`?perPage=5000` or `?include=...`) against model complexity boundaries.

---

## 8. Universal Full-Text Search (FTS)

Webspresso ORM provides database-agnostic full-text and keyword search with transparent dialect optimizations for SQLite, PostgreSQL, and MySQL.

### 8.1 Model Configuration (`searchable`)

Declare default searchable columns on your model:

```javascript
defineModel({
  name: 'Article',
  table: 'articles',
  schema: zdb.schema({
    id: zdb.id(),
    title: zdb.string(),
    content: zdb.text(),
    author: zdb.string(),
  }),
  searchable: ['title', 'content'], // Default columns for .search()
});
```

*(Note: If `searchable` is not defined, `.search()` automatically falls back to `admin.searchFields` if available.)*

### 8.2 Using Search in Application Code

Search is available both on repository instances (`repo.search`) and on query builders (`query().search()` / `query().orSearch()`):

```javascript
const articleRepo = req.db.getRepository('Article');

// 1. Basic search across default searchable columns
const results = await articleRepo.search('webspresso framework').get();

// 2. Chained with filtering, ordering, and pagination
const page = await articleRepo
  .search(req.query.q) // Safe no-op when req.query.q is empty or undefined
  .where('status', 'published')
  .orderBy('created_at', 'desc')
  .paginate({ page: 1, limit: 10 });

// 3. Dynamic column override
const byAuthor = await articleRepo.search('Alice', ['author']).get();

// 4. Exact phrase matching
const exact = await articleRepo.search('zero dependency sprawl', null, { exact: true }).get();

// 5. OR matching between words (default is AND)
const anyWord = await articleRepo.search('vue react angular', null, { matchAllWords: false }).get();

// 6. Disjoined search conditions with orSearch()
const mixed = await articleRepo.query()
  .where('author', 'Bob')
  .orSearch('featured article', ['title'])
  .get();
```

### 8.3 Dialect Features & Modes

| Dialect | Mode (`options.mode`) | SQL Strategy | Notes |
| :--- | :--- | :--- | :--- |
| **SQLite** | `'auto'` (default) | Tokenized case-insensitive `LIKE` | Safe out-of-the-box, no virtual table required. |
| **SQLite** | `'fts'` | `articles MATCH ?` or virtual table subquery | Set `{ mode: 'fts', ftsTable: 'articles_fts' }` for FTS5 tables. |
| **PostgreSQL** | `'auto'` / `'fts'` | `to_tsvector @@ plainto_tsquery` / `websearch_to_tsquery` | Native Postgres tsvector search. Pass `{ rank: true }` to order by `ts_rank` relevance. |
| **MySQL** | `'fts'` | `MATCH(...) AGAINST(? IN BOOLEAN MODE)` | Requires FULLTEXT index on table. |

---

## 9. Relational Cascading Soft-Delete & Selective Restore (`cascade: true`)

Webspresso ORM supports automated relational cascade operations for `hasMany` and `hasOne` relationships. When a parent record is soft-deleted or restored, child records are synchronized automatically.

### 9.1 Relation Configuration

Configure `cascade` directly inside your model relations:

```javascript
defineModel({
  name: 'Author',
  table: 'authors',
  schema: zdb.schema({
    id: zdb.id(),
    name: zdb.string(),
    deleted_at: zdb.timestamp({ nullable: true }),
  }),
  relations: {
    // 1. Full cascade (soft-delete, hard-delete, and restore)
    posts: {
      type: 'hasMany',
      model: () => 'Post', // or () => Post
      foreignKey: 'author_id',
      cascade: true,
    },
    // 2. hasOne cascade
    profile: {
      type: 'hasOne',
      model: () => 'Profile',
      foreignKey: 'author_id',
      cascade: true,
    },
    // 3. Delete-only cascade (child is deleted with parent, but NOT restored)
    tokens: {
      type: 'hasMany',
      model: () => 'ApiToken',
      foreignKey: 'author_id',
      cascade: 'delete', // or { delete: true, restore: false }
    },
  },
  scopes: {
    softDelete: true,
  },
});
```

### 9.2 Cascade Deletion Behavior

- **Soft Delete (`repo.delete(id)`)**:
  When an Author is soft-deleted, all active child records in cascading relations (`hasMany`, `hasOne`) are soft-deleted with the **exact same `deleted_at` timestamp**.
  Cascade is recursive: If `Post` also defines `comments` with `cascade: true`, all comments under those posts are cascaded automatically.
- **Hard Delete (`repo.forceDelete(id)`)**:
  When `forceDelete` is called (or when parent is a non-softDelete model), cascading child records are deleted **before** the parent to avoid foreign-key constraint violations (`FOREIGN KEY constraint failed`).
- **Cache Invalidation**:
  The ORM query cache for all affected related models is automatically invalidated.

### 9.3 Selective Restore (Smart Timestamp Matching)

A classic pitfall in soft-delete architectures is resurrecting child records that the user deliberately deleted prior to deleting the parent account:

```
T1 (10:00): User manually deletes Post #1 (deleted_at = 10:00).
T2 (12:00): User account is soft-deleted (deleted_at = 12:00).
            Post #2 and Post #3 receive deleted_at = 12:00.
T3 (15:00): User account is restored.
```

By default, Webspresso ORM executes **selective restore**:
- It restores only child records where `child.deleted_at === parent.deleted_at` (Post #2 and Post #3).
- Post #1 remains soft-deleted because its `deleted_at` was `10:00`!

```javascript
// Default: Safe selective restore (protects previously deleted children)
await authorRepo.restore(authorId);

// Optional: Force restore ALL children regardless of when they were deleted
await authorRepo.restore(authorId, { allChildren: true });

// Optional: Bypass cascading for a specific operation
await authorRepo.delete(authorId, { cascade: false });
await authorRepo.restore(authorId, { cascade: false });
```

### 9.4 Cycle & Recursion Safety

If your data model contains circular relations (e.g. `User.partner` <-> `Partner.user`), Webspresso ORM uses an internal visited set (`model:id`) to terminate recursion cleanly without stack overflows.

---

## 10. Django-inspired Auto-Migrations (`db:makemigrations`)

Webspresso supports automatic schema diffing against your live database, similar to Django's `makemigrations`. It inspects your `models/*.js` definitions, checks the current database schema, and automatically generates required Knex migration files (`createTable` or `alterTable` with `dropColumn` rollbacks):

```bash
# Preview changes without writing files
npx webspresso db:makemigrations --dry-run

# Detect model changes and generate migration file
npx webspresso db:makemigrations

# Custom migration name
npx webspresso db:makemigrations --name add_profile_fields

# Apply migrations
npx webspresso db:migrate
```

Programmatic usage via `db.migrate`:
```javascript
// Check diff
const diff = await db.migrate.diff();
if (diff.hasChanges) {
  console.log(diff.changes);
}

// Generate files
const result = await db.migrate.makeMigrations();
```

---

## 11. AdonisJS-inspired Model Factories (`defineFactory`)

For unit testing, integration tests, and dev database seeding, Webspresso provides declarative Model Factories inspired by AdonisJS Lucid:

```javascript
import { defineFactory } from 'webspresso';

export const UserFactory = defineFactory('User', ({ faker, index }) => ({
  name: faker.person.fullName(),
  email: faker.internet.email(),
  role: 'user',
  isActive: true,
}))
  .state('admin', () => ({ role: 'admin' }))
  .state('suspended', () => ({ isActive: false }));

// In-memory object generation (No DB hit)
const fakeUser = UserFactory.make({ name: 'Custom Name' });
const fakeUsers = UserFactory.count(5).make();

// Database persistence via Repository
const user = await UserFactory.create({ db });
const admins = await UserFactory.count(3).apply('admin').create({ db });
```

---

## 12. Dynamic Model Row-Level Security (RLS)

Webspresso ORM features zero-dependency, declarative Row-Level Security (RLS) directly on model definitions, ensuring data isolation across users, organizations, and multi-tenant systems.

### 12.1 Declaring RLS Policies on Models

Models declare row-level access rules with `rls` inside `defineModel`:

```javascript
const { defineModel, zdb } = require('webspresso');

module.exports = defineModel({
  name: 'Document',
  table: 'documents',
  schema: zdb.schema({
    id: zdb.id(),
    user_id: zdb.integer(),
    tenant_id: zdb.string().optional(),
    title: zdb.string(),
    content: zdb.text(),
    status: zdb.string().default('draft'),
    is_public: zdb.boolean().default(false),
  }),
  rls: {
    // Shorthand: automatically scopes queries and mutations to user.id
    userColumn: 'user_id',

    // Multi-tenant shorthand: scopes to user.tenant_id or scopeContext.tenantId
    tenantColumn: 'tenant_id',

    // Role-based bypass: admins and superadmins bypass RLS by default
    bypassRoles: ['admin', 'superadmin'],

    // Granular action rules:
    // Read / Select: public documents are visible to anyone, drafts only to author
    read: (user, qb) => {
      if (!user) return { is_public: true };
      return (q) => q.where('user_id', user.id).orWhere('is_public', true);
    },

    // Update: only allow modifying draft documents
    update: (user, qb) => {
      if (!user) return false;
      return (q) => q.where('user_id', user.id).where('status', 'draft');
    },

    // Delete: completely disabled or owner only
    delete: (user, qb) => {
      if (!user) return false;
      return { user_id: user.id };
    },

    // Create: auto-populates user_id, validates permissions or modifies payload
    create: (user, data) => {
      if (!user) return false; // Throws UnauthorizedError/ForbiddenError
      return { status: 'draft' }; // Enforce default state
    },
  },
});
```

### 12.2 Scoping Repositories and Query Builders

Repositories and query builders provide fluent scoping methods:

```javascript
const repo = db.getRepository('Document');

// Scoped to specific user:
const userRepo = repo.forUser(currentUser);
const myDocs = await userRepo.findAll();
const myDoc = await userRepo.findById(docId); // null if not owned

// Auto-populates user_id and rejects spoofed user IDs:
const newDoc = await userRepo.create({ title: 'My Report' });

// QueryBuilder chaining:
const count = await repo.query().forUser(currentUser).where('status', 'draft').count();
const paged = await repo.query().forUser(currentUser).paginate(1, 10);

// Explicit bypass (system/admin operations):
const allDocs = await repo.withoutRls().findAll();
const total = await repo.query().withoutRls().count();

// Multi-tenant scoping:
const tenantRepo = repo.forTenant('org_acme');
```

### 12.3 Database Scoped Accessors

```javascript
// Scoped database instance:
const userDb = db.forUser(currentUser);
const docs = await userDb.getRepository('Document').findAll();
const drafts = await userDb.query('Document').where('status', 'draft').list();

// Ambient transaction scoping:
await db.transaction(async (trx) => {
  const noteRepo = trx.forUser(currentUser).getRepository('Document');
  await noteRepo.create({ title: 'Transaction Document' });
});
```

### 12.4 Automatic Express Integration (`rlsPlugin`)

Register `rlsPlugin()` to automatically wrap `req.db.getRepository()` with `req.user` in API endpoints and SSR loaders:

```javascript
const { createApp, rlsPlugin } = require('webspresso');

const app = createApp({
  plugins: [
    rlsPlugin({
      bypassRoles: ['admin', 'superadmin'], // default
      getUser: (req) => req.user,           // default
    }),
  ],
});

// Inside any API route (pages/api/documents.get.js):
module.exports = defineApi({
  handler: async (req, res) => {
    // req.db.getRepository('Document') is automatically scoped to req.user!
    const docs = await req.db.getRepository('Document').findAll();
    return res.json(docs);
  },
});
```





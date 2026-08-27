# Webspresso ORM & Database Layer Guide

Webspresso features an intuitive, Knex-based zero-sprawl ORM (`core/orm`) supporting schema definitions with `zdb`, repository pattern, query caching, soft deletes, multi-tenant scopes, and relation eager loading.

---

## 1. Model Definitions & `zdb` Schemas

Models are defined in `models/*.js` using `defineModel`:

```js
import { defineModel, zdb } from 'webspresso';

export default defineModel({
  name: 'Product',
  table: 'products',
  schema: zdb.schema({
    id: zdb.id(),
    name: zdb.string().min(2),
    slug: zdb.string().unique(),
    price: zdb.number().positive(),
    description: zdb.text({ optional: true }),
    image: zdb.file({ optional: true }),
    metadata: zdb.json({ optional: true }),
    category_id: zdb.integer(),
    active: zdb.boolean({ default: true }),
    created_at: zdb.timestamp({ auto: 'create' }),
    updated_at: zdb.timestamp({ auto: 'update' }),
  }),
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

### Supported `zdb` Data Types
- `zdb.id()` — Primary key (BigInt / Auto-increment)
- `zdb.string({ max, unique, optional, sortable })` — String / VarChar
- `zdb.text({ sortable })` — Text blob
- `zdb.integer()`, `zdb.number({ sortable })` — Numeric types
- `zdb.boolean({ default, sortable })` — Boolean flag
- `zdb.file()` — File asset URL / upload path (non-sortable by default)
- `zdb.json()` — Serialized JSON column (non-sortable by default)
- `zdb.timestamp({ auto, sortable })` — Timestamp (`auto: 'create'` / `auto: 'update'`)

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

// 2. Insert, Update, Delete
const newProduct = await productRepo.create({ name: 'Laptop', price: 999, category_id: 1 });
const updated = await productRepo.update(newProduct.id, { price: 899 });
await productRepo.delete(newProduct.id); // Soft or hard delete based on model config

// 3. Query Builder & Pagination
const result = await productRepo.query()
  .where('price', '>', 500)
  .orderBy('created_at', 'desc')
  .paginate({ page: 1, limit: 10 });
// Returns: { data: [...], pagination: { page: 1, limit: 10, total: 42, totalPages: 5 } }
```

---

## 3. Relations & Eager Loading

Support for `belongsTo`, `hasMany`, and `hasOne`:

```js
// Eager-load relations using include
const productsWithCategory = await productRepo.query()
  .include('category', 'reviews')
  .find();
```

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


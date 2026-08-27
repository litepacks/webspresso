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

## 4. Query Caching (`cache`)

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

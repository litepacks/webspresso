---
sidebar_position: 2
---

# Schema Helpers (zdb)

The `zdb` helpers wrap Zod schemas with database column metadata, allowing you to define schemas once and use them for both validation and database operations.

## Basic Helpers

### `zdb.id()`

Primary key (bigint, auto-increment):

```javascript
const schema = zdb.schema({
  id: zdb.id(),
});
```

### `zdb.uuid()`

UUID primary key:

```javascript
const schema = zdb.schema({
  id: zdb.uuid(),
});
```

### `zdb.string(opts)`

VARCHAR column:

```javascript
const schema = zdb.schema({
  name: zdb.string({ maxLength: 100 }),
  email: zdb.string({ unique: true, index: true }),
  bio: zdb.string({ nullable: true }),
});
```

Options:
- `maxLength` - Maximum string length
- `unique` - Create unique index
- `index` - Create index
- `nullable` - Allow NULL values

### `zdb.text(opts)`

TEXT column:

```javascript
const schema = zdb.schema({
  content: zdb.text(),
  description: zdb.text({ nullable: true }),
});
```

### `zdb.integer(opts)`

INTEGER column:

```javascript
const schema = zdb.schema({
  age: zdb.integer({ nullable: true }),
  count: zdb.integer({ default: 0 }),
});
```

### `zdb.bigint(opts)`

BIGINT column:

```javascript
const schema = zdb.schema({
  views: zdb.bigint({ default: 0 }),
});
```

### `zdb.float(opts)`

FLOAT column:

```javascript
const schema = zdb.schema({
  price: zdb.float(),
  rating: zdb.float({ nullable: true }),
});
```

### `zdb.decimal(opts)`

DECIMAL column:

```javascript
const schema = zdb.schema({
  amount: zdb.decimal({ precision: 10, scale: 2 }),
});
```

Options:
- `precision` - Total number of digits
- `scale` - Number of decimal places
- `nullable` - Allow NULL values

### `zdb.boolean(opts)`

BOOLEAN column:

```javascript
const schema = zdb.schema({
  is_active: zdb.boolean({ default: true }),
  verified: zdb.boolean({ default: false, nullable: true }),
});
```

### `zdb.date(opts)`

DATE column:

```javascript
const schema = zdb.schema({
  birth_date: zdb.date({ nullable: true }),
});
```

### `zdb.datetime(opts)`

DATETIME column:

```javascript
const schema = zdb.schema({
  published_at: zdb.datetime({ nullable: true }),
});
```

### `zdb.timestamp(opts)`

TIMESTAMP column:

```javascript
const schema = zdb.schema({
  created_at: zdb.timestamp({ auto: 'create' }),
  updated_at: zdb.timestamp({ auto: 'update' }),
  deleted_at: zdb.timestamp({ nullable: true }),
});
```

Options:
- `auto: 'create'` - Auto-set on creation
- `auto: 'update'` - Auto-update on modification
- `nullable` - Allow NULL values

### `zdb.json(opts)`

JSON column:

```javascript
const schema = zdb.schema({
  metadata: zdb.json({ nullable: true }),
  settings: zdb.json(),
});
```

### `zdb.array(itemSchema, opts)`

ARRAY column (stored as JSON):

```javascript
const schema = zdb.schema({
  tags: zdb.array(z.string()),
  items: zdb.array(z.object({
    id: z.number(),
    name: z.string(),
  })),
});
```

### `zdb.enum(values, opts)`

ENUM column:

```javascript
const schema = zdb.schema({
  status: zdb.enum(['draft', 'published', 'archived'], { default: 'draft' }),
  role: zdb.enum(['user', 'admin'], { default: 'user' }),
});
```

### `zdb.foreignKey(table, opts)`

Foreign key (bigint):

```javascript
const schema = zdb.schema({
  user_id: zdb.foreignKey('users'),
  company_id: zdb.foreignKey('companies', { nullable: true }),
});
```

Options:
- `referenceColumn` - Column to reference (default: 'id')
- `nullable` - Allow NULL values

### `zdb.foreignUuid(table, opts)`

Foreign key (uuid):

```javascript
const schema = zdb.schema({
  user_id: zdb.foreignUuid('users'),
});
```

## Complete Example

```javascript
const { zdb } = require('webspresso');

const PostSchema = zdb.schema({
  id: zdb.id(),
  user_id: zdb.foreignKey('users'),
  title: zdb.string({ maxLength: 200, index: true }),
  slug: zdb.string({ unique: true, index: true }),
  content: zdb.text(),
  excerpt: zdb.text({ nullable: true }),
  status: zdb.enum(['draft', 'published'], { default: 'draft' }),
  views: zdb.bigint({ default: 0 }),
  metadata: zdb.json({ nullable: true }),
  tags: zdb.array(z.string()),
  published_at: zdb.timestamp({ nullable: true }),
  created_at: zdb.timestamp({ auto: 'create' }),
  updated_at: zdb.timestamp({ auto: 'update' }),
  deleted_at: zdb.timestamp({ nullable: true }),
});
```

## Next Steps

- [Models](/database/models) - Use schemas in models
- [Migrations](/database/migrations) - Generate migrations from schemas

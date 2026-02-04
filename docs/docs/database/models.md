---
sidebar_position: 3
---

# Models

Models define the structure and behavior of your database tables. They combine Zod schemas with database metadata.

## Defining Models

Use `defineModel()` to create a model:

```javascript
const { defineModel, zdb } = require('webspresso');

const UserSchema = zdb.schema({
  id: zdb.id(),
  email: zdb.string({ unique: true }),
  name: zdb.string(),
  created_at: zdb.timestamp({ auto: 'create' }),
  updated_at: zdb.timestamp({ auto: 'update' }),
});

const User = defineModel({
  name: 'User',
  table: 'users',
  schema: UserSchema,
  primaryKey: 'id', // Optional, defaults to 'id'
  scopes: {
    timestamps: true,
  },
});
```

## Model Options

| Option | Description | Default |
|--------|-------------|---------|
| `name` | Model name (used for repository lookup) | Required |
| `table` | Database table name | Required |
| `schema` | Zod schema with zdb helpers | Required |
| `primaryKey` | Primary key column name | `'id'` |
| `relations` | Model relations | `{}` |
| `scopes` | Scope configuration | `{}` |

## Auto-Loading Models

Models are automatically loaded from the `models/` directory:

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
    created_at: zdb.timestamp({ auto: 'create' }),
    updated_at: zdb.timestamp({ auto: 'update' }),
  }),
  scopes: { timestamps: true },
});
```

```javascript
// In your application
const db = createDatabase({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  models: './models', // Auto-loads all models
});

// Use by name
const UserRepo = db.getRepository('User');
```

## Relations

Define relations between models:

```javascript
const User = defineModel({
  name: 'User',
  table: 'users',
  schema: UserSchema,
  relations: {
    // belongsTo: this model has foreign key
    company: {
      type: 'belongsTo',
      model: () => Company,
      foreignKey: 'company_id',
    },
    
    // hasMany: related model has foreign key
    posts: {
      type: 'hasMany',
      model: () => Post,
      foreignKey: 'user_id',
    },
    
    // hasOne: like hasMany but returns single record
    profile: {
      type: 'hasOne',
      model: () => Profile,
      foreignKey: 'user_id',
    },
  },
});
```

### Relation Types

- **belongsTo**: This model has the foreign key
- **hasMany**: Related model has the foreign key (one-to-many)
- **hasOne**: Related model has the foreign key (one-to-one)

## Scopes

Scopes provide automatic behavior:

### Timestamps

Auto-manage `created_at` and `updated_at`:

```javascript
const User = defineModel({
  // ...
  scopes: {
    timestamps: true,
  },
});
```

### Soft Deletes

Use `deleted_at` for soft deletes:

```javascript
const User = defineModel({
  // ...
  scopes: {
    softDelete: true,
  },
});
```

### Multi-Tenant

Add tenant filtering:

```javascript
const User = defineModel({
  // ...
  scopes: {
    tenant: 'tenant_id',
  },
});
```

### Combined Scopes

```javascript
const User = defineModel({
  // ...
  scopes: {
    timestamps: true,
    softDelete: true,
    tenant: 'tenant_id',
  },
});
```

## Model File Structure

Place models in `models/` directory:

```
models/
├── User.js
├── Post.js
├── Company.js
└── _helpers.js  # Files starting with _ are ignored
```

Models are loaded in alphabetical order. Files starting with `_` are ignored (useful for shared utilities).

## Example: Complete Model

```javascript
// models/Post.js
const { defineModel, zdb } = require('webspresso');

const PostSchema = zdb.schema({
  id: zdb.id(),
  user_id: zdb.foreignKey('users'),
  title: zdb.string({ maxLength: 200, index: true }),
  slug: zdb.string({ unique: true, index: true }),
  content: zdb.text(),
  status: zdb.enum(['draft', 'published'], { default: 'draft' }),
  published_at: zdb.timestamp({ nullable: true }),
  created_at: zdb.timestamp({ auto: 'create' }),
  updated_at: zdb.timestamp({ auto: 'update' }),
  deleted_at: zdb.timestamp({ nullable: true }),
});

module.exports = defineModel({
  name: 'Post',
  table: 'posts',
  schema: PostSchema,
  relations: {
    user: {
      type: 'belongsTo',
      model: () => require('./User'),
      foreignKey: 'user_id',
    },
  },
  scopes: {
    timestamps: true,
    softDelete: true,
  },
});
```

## Next Steps

- [Repository](/database/repository) - CRUD operations
- [Relations](/database/relations) - Working with relations
- [Scopes](/database/query-builder#scopes) - Using scopes in queries

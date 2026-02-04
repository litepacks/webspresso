---
sidebar_position: 1
---

# Database/ORM Overview

Webspresso includes a minimal, Eloquent-inspired ORM built on Knex with Zod schemas as the single source of truth.

## Features

- **Zod Schemas**: Define schemas once, use for validation and database operations
- **Type Safety**: Runtime validation with Zod
- **Relations**: Eager loading with N+1 prevention
- **Scopes**: Soft deletes, timestamps, multi-tenant support
- **Query Builder**: Fluent query builder API
- **Migrations**: Database migrations with scaffolding
- **Seeding**: Generate fake data for testing

## Quick Start

```javascript
const { zdb, defineModel, createDatabase } = require('webspresso');

// 1. Define schema with database metadata
const UserSchema = zdb.schema({
  id: zdb.id(),
  email: zdb.string({ unique: true, index: true }),
  name: zdb.string({ maxLength: 100 }),
  status: zdb.enum(['active', 'inactive'], { default: 'active' }),
  created_at: zdb.timestamp({ auto: 'create' }),
  updated_at: zdb.timestamp({ auto: 'update' }),
});

// 2. Define model
const User = defineModel({
  name: 'User',
  table: 'users',
  schema: UserSchema,
  scopes: { timestamps: true },
});

// 3. Create database instance
const db = createDatabase({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  models: './models', // Auto-loads models
});

// 4. Use repository
const UserRepo = db.getRepository('User');
const user = await UserRepo.create({
  email: 'user@example.com',
  name: 'John Doe',
});
```

## Supported Databases

Install the appropriate driver:

```bash
# PostgreSQL
npm install pg

# MySQL
npm install mysql2

# SQLite (recommended for development)
npm install better-sqlite3
```

## Design Philosophy

| Boundary | Zod's Job | ORM's Job |
|----------|-----------|-----------|
| Schema definition | Type shape, validation rules | Column metadata extraction |
| Input validation | `.parse()` / `.safeParse()` | Never - pass through to Zod |
| Query building | N/A | Full ownership |
| Relation resolution | N/A | Eager loading with batch queries |
| Timestamps/SoftDelete | N/A | Auto-inject on operations |

**N+1 Prevention**: Relations are always loaded with batch `WHERE IN (...)` queries, never with individual queries per record.

## Next Steps

- [Schema Helpers](/database/schema-helpers) - Learn about zdb helpers
- [Models](/database/models) - Define models
- [Repository](/database/repository) - CRUD operations
- [Query Builder](/database/query-builder) - Advanced queries

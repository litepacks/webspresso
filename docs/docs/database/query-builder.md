---
sidebar_position: 5
---

# Query Builder

The Query Builder provides a fluent interface for building complex database queries.

## Getting a Query Builder

```javascript
const UserRepo = db.getRepository('User');

// Start a query
const query = UserRepo.query();
```

## Where Clauses

### Basic Where

```javascript
const users = await UserRepo.query()
  .where({ status: 'active' })
  .list();
```

### Where Operators

```javascript
const users = await UserRepo.query()
  .where('age', '>', 18)
  .where('created_at', '>=', '2024-01-01')
  .where('email', 'like', '%@example.com')
  .list();
```

### Where In

```javascript
const users = await UserRepo.query()
  .whereIn('role', ['admin', 'moderator'])
  .list();
```

### Where Not Null

```javascript
const users = await UserRepo.query()
  .whereNotNull('email_verified_at')
  .list();
```

### Multiple Conditions

```javascript
const users = await UserRepo.query()
  .where({ status: 'active' })
  .where('created_at', '>', '2024-01-01')
  .whereIn('role', ['admin', 'moderator'])
  .whereNotNull('email_verified_at')
  .list();
```

## Ordering

### Single Order By

```javascript
const users = await UserRepo.query()
  .orderBy('name', 'asc')
  .list();
```

### Multiple Order By

```javascript
const users = await UserRepo.query()
  .orderBy('name', 'asc')
  .orderBy('created_at', 'desc')
  .list();
```

## Limiting and Pagination

### Limit and Offset

```javascript
const users = await UserRepo.query()
  .limit(10)
  .offset(20)
  .list();
```

### Pagination

```javascript
const result = await UserRepo.query()
  .where({ status: 'active' })
  .orderBy('created_at', 'desc')
  .paginate(1, 20); // page 1, 20 per page

// result = {
//   data: [...],
//   total: 150,
//   page: 1,
//   perPage: 20,
//   totalPages: 8
// }
```

## Selecting Columns

```javascript
const users = await UserRepo.query()
  .select(['id', 'name', 'email'])
  .list();
```

## Eager Loading Relations

### Single Relation

```javascript
const users = await UserRepo.query()
  .with('company')
  .list();
```

### Multiple Relations

```javascript
const users = await UserRepo.query()
  .with('company', 'posts')
  .list();
```

### Nested Relations

```javascript
const posts = await PostRepo.query()
  .with('user', 'user.company')
  .list();
```

## Soft Delete Scopes

### Include Deleted

```javascript
const users = await UserRepo.query()
  .withTrashed()
  .list();
```

### Only Deleted

```javascript
const users = await UserRepo.query()
  .onlyTrashed()
  .list();
```

## Multi-Tenant

```javascript
const users = await UserRepo.query()
  .forTenant(tenantId)
  .list();
```

## Executing Queries

### `list()`

Get all results:

```javascript
const users = await UserRepo.query()
  .where({ status: 'active' })
  .list();
```

### `first()`

Get first result:

```javascript
const user = await UserRepo.query()
  .where({ email: 'admin@example.com' })
  .first();
```

### `count()`

Count results:

```javascript
const count = await UserRepo.query()
  .where({ status: 'active' })
  .count();
```

## Complete Examples

### Complex Query

```javascript
const users = await UserRepo.query()
  .where({ status: 'active' })
  .where('created_at', '>', '2024-01-01')
  .whereIn('role', ['admin', 'moderator'])
  .whereNotNull('email_verified_at')
  .orderBy('name', 'asc')
  .orderBy('created_at', 'desc')
  .limit(10)
  .offset(20)
  .with('company', 'posts')
  .list();
```

### Pagination

```javascript
const page = req.query.page || 1;
const perPage = 20;

const result = await UserRepo.query()
  .where({ status: 'active' })
  .orderBy('created_at', 'desc')
  .paginate(page, perPage);

// Use in template
return {
  users: result.data,
  pagination: {
    current: result.page,
    total: result.totalPages,
    perPage: result.perPage,
  },
};
```

### Search with Relations

```javascript
const posts = await PostRepo.query()
  .where('title', 'like', `%${searchTerm}%`)
  .orWhere('content', 'like', `%${searchTerm}%`)
  .with('user', 'user.company')
  .orderBy('created_at', 'desc')
  .paginate(page, perPage);
```

## Next Steps

- [Relations](/database/relations) - Working with relations
- [Transactions](/database/transactions) - Database transactions

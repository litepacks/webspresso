---
sidebar_position: 4
---

# Repository

The Repository provides a clean API for CRUD operations on your models.

## Getting a Repository

```javascript
const db = createDatabase({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  models: './models',
});

// Get repository by model name
const UserRepo = db.getRepository('User');
```

## Finding Records

### `findById(id, options)`

Find a record by primary key:

```javascript
const user = await UserRepo.findById(1);

// With relations
const user = await UserRepo.findById(1, {
  with: ['company', 'posts'],
});

// Select specific columns
const user = await UserRepo.findById(1, {
  select: ['id', 'name', 'email'],
});
```

### `findOne(conditions, options)`

Find a single record matching conditions:

```javascript
const user = await UserRepo.findOne({ email: 'user@example.com' });

// With relations
const admin = await UserRepo.findOne(
  { role: 'admin' },
  { with: ['permissions'] }
);
```

### `findAll(options)`

Find all records:

```javascript
const users = await UserRepo.findAll();

// With relations
const users = await UserRepo.findAll({
  with: ['company'],
});

// With conditions
const activeUsers = await UserRepo.findAll({
  where: { status: 'active' },
  with: ['company'],
});
```

## Creating Records

### `create(data)`

Create a single record:

```javascript
const user = await UserRepo.create({
  email: 'new@example.com',
  name: 'New User',
  status: 'active',
});
```

### `createMany(dataArray)`

Create multiple records:

```javascript
const users = await UserRepo.createMany([
  { email: 'user1@test.com', name: 'User 1' },
  { email: 'user2@test.com', name: 'User 2' },
  { email: 'user3@test.com', name: 'User 3' },
]);
```

## Updating Records

### `update(id, data)`

Update a record by primary key:

```javascript
const updated = await UserRepo.update(1, {
  name: 'Updated Name',
  status: 'inactive',
});
```

### `updateWhere(conditions, data)`

Update records matching conditions:

```javascript
await UserRepo.updateWhere(
  { status: 'inactive' },
  { status: 'banned' }
);
```

## Deleting Records

### `delete(id)`

Soft delete if enabled, otherwise hard delete:

```javascript
await UserRepo.delete(1);
```

### `forceDelete(id)`

Permanently delete a record:

```javascript
await UserRepo.forceDelete(1);
```

### `restore(id)`

Restore a soft-deleted record:

```javascript
await UserRepo.restore(1);
```

## Counting and Checking

### `count(conditions)`

Count records:

```javascript
const total = await UserRepo.count();
const active = await UserRepo.count({ status: 'active' });
```

### `exists(conditions)`

Check if records exist:

```javascript
const exists = await UserRepo.exists({ email: 'test@example.com' });
```

## Query Builder

Get a query builder for advanced queries:

```javascript
const users = await UserRepo.query()
  .where({ status: 'active' })
  .where('created_at', '>', '2024-01-01')
  .orderBy('name', 'asc')
  .limit(10)
  .list();
```

See [Query Builder](/database/query-builder) for more details.

## Examples

### Basic CRUD

```javascript
// Create
const user = await UserRepo.create({
  email: 'user@example.com',
  name: 'John Doe',
});

// Read
const found = await UserRepo.findById(user.id);

// Update
const updated = await UserRepo.update(user.id, {
  name: 'Jane Doe',
});

// Delete
await UserRepo.delete(user.id);
```

### With Relations

```javascript
// Load user with company and posts
const user = await UserRepo.findById(1, {
  with: ['company', 'posts'],
});

console.log(user.company.name);
console.log(user.posts.length);
```

### Batch Operations

```javascript
// Create multiple
const users = await UserRepo.createMany([
  { email: 'user1@test.com', name: 'User 1' },
  { email: 'user2@test.com', name: 'User 2' },
]);

// Update multiple
await UserRepo.updateWhere(
  { status: 'pending' },
  { status: 'active' }
);
```

## Next Steps

- [Query Builder](/database/query-builder) - Advanced queries
- [Relations](/database/relations) - Working with relations
- [Transactions](/database/transactions) - Database transactions

---
sidebar_position: 9
---

# Transactions

Transactions ensure that a series of database operations either all succeed or all fail together.

## Basic Usage

Wrap operations in a transaction:

```javascript
await db.transaction(async (trx) => {
  const userRepo = trx.getRepository('User');
  const postRepo = trx.getRepository('Post');
  
  // Create user
  const user = await userRepo.create({
    email: 'new@test.com',
    name: 'New User',
  });
  
  // Create post
  await postRepo.create({
    title: 'First Post',
    user_id: user.id,
  });
  
  // All changes committed on success
  // Rolled back on error
});
```

## Transaction Context

The transaction context provides:

- `trx` - Knex transaction object
- `getRepository(modelName)` - Get repository bound to transaction
- `createRepository(model)` - Create repository from model object

## Error Handling

If an error occurs, the transaction is automatically rolled back:

```javascript
try {
  await db.transaction(async (trx) => {
    const userRepo = trx.getRepository('User');
    const postRepo = trx.getRepository('Post');
    
    const user = await userRepo.create({ email: 'test@example.com' });
    
    // This will cause an error and rollback
    await postRepo.create({
      title: 'Post',
      user_id: 999999, // Invalid foreign key
    });
  });
} catch (err) {
  // Transaction was rolled back
  console.error('Transaction failed:', err);
}
```

## Nested Transactions

Transactions can be nested (savepoints):

```javascript
await db.transaction(async (trx) => {
  const userRepo = trx.getRepository('User');
  
  const user = await userRepo.create({ email: 'user@example.com' });
  
  // Nested transaction
  await db.transaction(async (trx2) => {
    const postRepo = trx2.getRepository('Post');
    await postRepo.create({
      title: 'Post',
      user_id: user.id,
    });
  });
});
```

## Use Cases

### Creating Related Records

```javascript
await db.transaction(async (trx) => {
  const userRepo = trx.getRepository('User');
  const companyRepo = trx.getRepository('Company');
  const profileRepo = trx.getRepository('Profile');
  
  // Create company
  const company = await companyRepo.create({
    name: 'Acme Corp',
  });
  
  // Create user
  const user = await userRepo.create({
    email: 'user@acme.com',
    name: 'John Doe',
    company_id: company.id,
  });
  
  // Create profile
  await profileRepo.create({
    user_id: user.id,
    bio: 'Software developer',
  });
  
  // All or nothing
});
```

### Bulk Operations

```javascript
await db.transaction(async (trx) => {
  const userRepo = trx.getRepository('User');
  
  const users = [];
  for (let i = 0; i < 100; i++) {
    users.push({
      email: `user${i}@example.com`,
      name: `User ${i}`,
    });
  }
  
  // Create all users in transaction
  await userRepo.createMany(users);
});
```

### Conditional Rollback

```javascript
await db.transaction(async (trx) => {
  const userRepo = trx.getRepository('User');
  const orderRepo = trx.getRepository('Order');
  
  const user = await userRepo.findById(userId);
  
  if (user.balance < orderTotal) {
    // Manually rollback
    throw new Error('Insufficient balance');
  }
  
  // Update balance
  await userRepo.update(userId, {
    balance: user.balance - orderTotal,
  });
  
  // Create order
  await orderRepo.create({
    user_id: userId,
    total: orderTotal,
  });
});
```

## Best Practices

1. **Keep transactions short**: Long-running transactions can lock tables
2. **Handle errors**: Always wrap transactions in try-catch
3. **Use for related operations**: Group related database operations
4. **Avoid nested transactions**: Use savepoints only when necessary

## Next Steps

- [Repository](/database/repository) - CRUD operations
- [Query Builder](/database/query-builder) - Advanced queries

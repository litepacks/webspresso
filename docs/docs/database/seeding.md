---
sidebar_position: 8
---

# Seeding

Generate fake data for testing and development using `@faker-js/faker`.

## CLI Command

The easiest way to seed your database:

```bash
# Run seeds (requires seeds/index.js)
webspresso seed

# Setup seed files if they don't exist
webspresso seed --setup

# Use custom database config
webspresso seed --config ./custom-db-config.js

# Use different environment
webspresso seed --env production
```

## Automatic Seeding

The `webspresso seed` command:

- Automatically loads all models from `models/` directory
- Generates fake data based on model schemas
- Creates 10 records per model by default
- Uses smart field detection for appropriate fake data

## Manual Setup

### Install Faker

```bash
npm install @faker-js/faker
```

### Basic Usage

```javascript
const { faker } = require('@faker-js/faker');
const db = createDatabase({ /* config */ });

const seeder = db.seeder(faker);

// Generate a single record
const user = await seeder.factory('User').create();

// Generate multiple records
const users = await seeder.factory('User').create(10);

// Generate without saving (for testing)
const userData = seeder.factory('User').make();
```

## Defining Factories

### Defaults and States

```javascript
seeder.defineFactory('User', {
  // Default values
  defaults: {
    status: 'pending',
  },
  
  // Custom generators
  generators: {
    username: (f) => f.internet.username().toLowerCase(),
  },
  
  // Named states for variations
  states: {
    admin: { role: 'admin', status: 'active' },
    verified: (f) => ({
      status: 'verified',
      verified_at: f.date.past().toISOString(),
    }),
  },
});
```

### Using States

```javascript
// Use states
const admin = await seeder.factory('User').state('admin').create();
const verified = await seeder.factory('User').state('verified').create();
```

## Smart Field Detection

The seeder automatically generates appropriate fake data based on column names:

| Field Name Pattern | Generated Data |
|-------------------|----------------|
| `email`, `*_email` | Valid email address |
| `name`, `first_name`, `last_name` | Person names |
| `username` | Username |
| `title` | Short sentence |
| `content`, `body`, `description` | Paragraphs |
| `slug` | URL-safe slug |
| `phone`, `tel` | Phone number |
| `address`, `city`, `country` | Location data |
| `price`, `amount`, `cost` | Decimal numbers |
| `*_url`, `avatar`, `image` | URLs |

## Override and Custom Generators

```javascript
const user = await seeder.factory('User')
  .override({ email: 'test@example.com' })
  .generators({
    code: (f) => `USR-${f.string.alphanumeric(8)}`,
  })
  .create();
```

## Batch Seeding

Seed multiple models at once:

```javascript
// Seed multiple models at once
const results = await seeder.run([
  { model: 'Company', count: 5 },
  { model: 'User', count: 20, state: 'active' },
  { model: 'Post', count: 50 },
]);

// Access results
console.log(results.Company); // Array of 5 companies
console.log(results.User);    // Array of 20 users
```

## Cleanup

### Truncate Tables

```javascript
// Truncate specific tables
await seeder.truncate('User');
await seeder.truncate(['User', 'Post']);

// Clear all registered model tables
await seeder.clearAll();
```

## Complete Example

```javascript
// seeds/index.js
const { faker } = require('@faker-js/faker');
const db = require('../webspresso.db');

async function seed() {
  const seeder = db.createSeeder(faker);
  
  // Define factories
  seeder.defineFactory('User', {
    defaults: {
      status: 'pending',
    },
    states: {
      admin: { role: 'admin', status: 'active' },
      verified: (f) => ({
        status: 'verified',
        verified_at: f.date.past().toISOString(),
      }),
    },
  });
  
  seeder.defineFactory('Post', {
    states: {
      published: (f) => ({
        status: 'published',
        published_at: f.date.past().toISOString(),
      }),
    },
  });
  
  // Seed data
  const results = await seeder.run([
    { model: 'User', count: 10, state: 'verified' },
    { model: 'User', count: 2, state: 'admin' },
    { model: 'Post', count: 50, state: 'published' },
  ]);
  
  console.log(`Created ${results.User.length} users`);
  console.log(`Created ${results.Post.length} posts`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

## Next Steps

- [Migrations](/database/migrations) - Database schema changes
- [Transactions](/database/transactions) - Database transactions

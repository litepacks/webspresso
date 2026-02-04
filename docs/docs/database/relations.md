---
sidebar_position: 6
---

# Relations

Webspresso ORM supports three types of relations: `belongsTo`, `hasMany`, and `hasOne`.

## Defining Relations

Define relations in your model:

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

## Relation Types

### belongsTo

Use when **this model** has the foreign key:

```javascript
// Post model has user_id
const Post = defineModel({
  // ...
  relations: {
    user: {
      type: 'belongsTo',
      model: () => User,
      foreignKey: 'user_id',
    },
  },
});
```

### hasMany

Use when the **related model** has the foreign key (one-to-many):

```javascript
// User model, Post has user_id
const User = defineModel({
  // ...
  relations: {
    posts: {
      type: 'hasMany',
      model: () => Post,
      foreignKey: 'user_id',
    },
  },
});
```

### hasOne

Use when the **related model** has the foreign key (one-to-one):

```javascript
// User model, Profile has user_id
const User = defineModel({
  // ...
  relations: {
    profile: {
      type: 'hasOne',
      model: () => Profile,
      foreignKey: 'user_id',
    },
  },
});
```

## Eager Loading

Load relations to avoid N+1 queries:

### In Repository Methods

```javascript
// Load single relation
const user = await UserRepo.findById(1, {
  with: ['company'],
});

// Load multiple relations
const user = await UserRepo.findById(1, {
  with: ['company', 'posts'],
});

// Nested relations
const post = await PostRepo.findById(1, {
  with: ['user', 'user.company'],
});
```

### In Query Builder

```javascript
// Single relation
const users = await UserRepo.query()
  .with('company')
  .list();

// Multiple relations
const users = await UserRepo.query()
  .with('company', 'posts')
  .list();

// Nested relations
const posts = await PostRepo.query()
  .with('user', 'user.company')
  .list();
```

## N+1 Prevention

Relations are always loaded with batch queries:

```javascript
// This loads all companies in a single query
const users = await UserRepo.query()
  .with('company')
  .list();

// Instead of:
// SELECT * FROM users
// SELECT * FROM companies WHERE id = 1
// SELECT * FROM companies WHERE id = 2
// ...

// It does:
// SELECT * FROM users
// SELECT * FROM companies WHERE id IN (1, 2, 3, ...)
```

## Accessing Relations

After eager loading, relations are available as properties:

```javascript
const user = await UserRepo.findById(1, {
  with: ['company', 'posts'],
});

console.log(user.company.name); // Company name
console.log(user.posts.length); // Number of posts
```

## Examples

### User with Company and Posts

```javascript
// models/User.js
const User = defineModel({
  name: 'User',
  table: 'users',
  schema: UserSchema,
  relations: {
    company: {
      type: 'belongsTo',
      model: () => Company,
      foreignKey: 'company_id',
    },
    posts: {
      type: 'hasMany',
      model: () => Post,
      foreignKey: 'user_id',
    },
  },
});

// Usage
const user = await UserRepo.findById(1, {
  with: ['company', 'posts'],
});

// In template
// {{ user.company.name }}
// {% for post in user.posts %}...{% endfor %}
```

### Post with User and Comments

```javascript
// models/Post.js
const Post = defineModel({
  name: 'Post',
  table: 'posts',
  schema: PostSchema,
  relations: {
    user: {
      type: 'belongsTo',
      model: () => User,
      foreignKey: 'user_id',
    },
    comments: {
      type: 'hasMany',
      model: () => Comment,
      foreignKey: 'post_id',
    },
  },
});

// Usage
const post = await PostRepo.findById(1, {
  with: ['user', 'comments', 'user.company'],
});
```

### User with Profile

```javascript
// models/User.js
const User = defineModel({
  // ...
  relations: {
    profile: {
      type: 'hasOne',
      model: () => Profile,
      foreignKey: 'user_id',
    },
  },
});

// Usage
const user = await UserRepo.findById(1, {
  with: ['profile'],
});

console.log(user.profile.bio);
```

## Next Steps

- [Query Builder](/database/query-builder) - Advanced queries with relations
- [Repository](/database/repository) - CRUD operations

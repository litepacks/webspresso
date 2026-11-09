'use strict';

const { defineModel, zdb } = require('../lib/webspresso');

module.exports = defineModel({
  name: 'User',
  table: 'users',
  timestamps: 'snake',
  schema: {
    id: zdb.id(),
    email: zdb.email({ unique: true }),
    name: zdb.string({ maxLength: 120 }),
    password: zdb.string(),
    role: zdb.enum(['author', 'admin'], { default: 'author' }),
  },
  relations: {
    posts: { type: 'hasMany', model: 'Post', foreignKey: 'author_id' },
  },
  // Never serialized by res.json / JSON.stringify / session storage
  hidden: ['password'],
  cache: 'auto',
});


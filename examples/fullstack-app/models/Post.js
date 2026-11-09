'use strict';

const { defineModel, zdb } = require('../lib/webspresso');

module.exports = defineModel({
  name: 'Post',
  table: 'posts',
  timestamps: 'snake',
  softDelete: 'snake',
  schema: {
    id: zdb.id(),
    title: zdb.string({ maxLength: 200 }),
    slug: zdb.string({ maxLength: 220, unique: true }),
    excerpt: zdb.string({ maxLength: 500 }),
    body: zdb.text(),
    status: zdb.enum(['draft', 'published'], { default: 'draft' }),
    views: zdb.integer({ default: 0 }),
    author_id: zdb.foreignKey('users'),
    category_id: zdb.foreignKey('categories'),
    published_at: zdb.timestamp({ nullable: true }),
  },
  relations: {
    author: { type: 'belongsTo', model: 'User', foreignKey: 'author_id' },
    category: { type: 'belongsTo', model: 'Category', foreignKey: 'category_id' },
    comments: { type: 'hasMany', model: 'Comment', foreignKey: 'post_id' },
  },
  cache: 'auto',
});


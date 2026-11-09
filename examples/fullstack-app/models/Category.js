'use strict';

const { defineModel, zdb } = require('../lib/webspresso');

module.exports = defineModel({
  name: 'Category',
  table: 'categories',
  timestamps: 'snake',
  schema: {
    id: zdb.id(),
    name: zdb.string({ maxLength: 80 }),
    slug: zdb.string({ maxLength: 80, unique: true }),
  },
  relations: {
    posts: { type: 'hasMany', model: 'Post', foreignKey: 'category_id' },
  },
  cache: 'auto',
});


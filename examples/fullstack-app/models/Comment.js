'use strict';

const { defineModel, zdb } = require('../lib/webspresso');

module.exports = defineModel({
  name: 'Comment',
  table: 'comments',
  timestamps: 'snake',
  schema: {
    id: zdb.id(),
    post_id: zdb.foreignKey('posts'),
    author_name: zdb.string({ maxLength: 80 }),
    body: zdb.text(),
  },
  relations: {
    post: { type: 'belongsTo', model: 'Post', foreignKey: 'post_id' },
  },
});


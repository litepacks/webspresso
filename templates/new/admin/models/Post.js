const { defineModel, zdb } = require('webspresso');

module.exports = defineModel({
  name: 'Post',
  table: 'posts',
  schema: zdb.schema({
    id: zdb.id(),
    title: zdb.string({ maxLength: 255 }),
    body: zdb.text({ nullable: true }),
    published: zdb.boolean({ default: false }),
    created_at: zdb.timestamp({ auto: 'create' }),
    updated_at: zdb.timestamp({ auto: 'update' }),
  }),
  admin: {
    enabled: true,
    label: 'Posts',
    icon: 'document',
  },
});

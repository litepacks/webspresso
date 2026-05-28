const { defineModel, zdb } = require('webspresso');

module.exports = defineModel({
  name: 'TestPost',
  table: 'test_posts',
  schema: zdb.schema({
    id: zdb.id(),
    title: zdb.string().min(1).max(200).config({
      label: 'Post Title',
      placeholder: 'Enter post title',
    }),
    content: zdb.text({ nullable: true }).min(10).config({
      label: 'Content',
      placeholder: 'Write your post content here...',
      rows: 6,
    }),
    body: zdb.text({ nullable: true }).config({
      label: 'Body',
      hint: 'Rich text content',
    }),
    status: zdb.enum(['draft', 'pending', 'published', 'archived'], { default: 'draft' }),
    published: zdb.boolean({ default: false }),
    publish_date: zdb.date({ nullable: true }),
    created_at: zdb.timestamp({ auto: 'create' }),
    updated_at: zdb.timestamp({ auto: 'update' }),
  }),
  admin: {
    enabled: true,
    label: 'Test Posts',
    icon: '📝',
    customFields: {
      body: { type: 'rich-text' },
    },
  },
});

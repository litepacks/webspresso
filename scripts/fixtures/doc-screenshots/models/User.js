const { defineModel, zdb } = require('webspresso');

module.exports = defineModel({
  name: 'User',
  table: 'users',
  schema: zdb.schema({
    id: zdb.id(),
    email: zdb.string({ unique: true, maxLength: 255 }),
    password: zdb.string({ maxLength: 255 }),
    name: zdb.string({ maxLength: 255, nullable: true }),
    role: zdb.string({ maxLength: 50, default: 'user' }),
    active: zdb.boolean({ default: true }),
    email_verified_at: zdb.timestamp({ nullable: true }),
    created_at: zdb.timestamp({ auto: 'create' }),
    updated_at: zdb.timestamp({ auto: 'update' }),
  }),
  admin: {
    enabled: true,
    label: 'Site users',
    icon: '👤',
  },
  hidden: ['password'],
});

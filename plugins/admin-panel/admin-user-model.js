/**
 * Admin User Model
 * Model definition for admin panel users
 * @module plugins/admin-panel/admin-user-model
 */

const { defineModel } = require('../../../core/orm/model');
const { zdb } = require('../../../core/orm');

/**
 * AdminUser model schema
 */
const AdminUserSchema = zdb.schema({
  id: zdb.id(),
  email: zdb.string({ unique: true, maxLength: 255 }),
  password: zdb.string({ maxLength: 255 }), // Hashed password
  name: zdb.string({ maxLength: 255 }),
  role: zdb.string({ maxLength: 50, default: 'admin' }),
  active: zdb.boolean({ default: true }),
  created_at: zdb.timestamp({ auto: 'create' }),
  updated_at: zdb.timestamp({ auto: 'update' }),
});

/**
 * Create and register AdminUser model
 * @returns {import('../../../core/orm/types').ModelDefinition}
 */
function createAdminUserModel() {
  return defineModel({
    name: 'AdminUser',
    table: 'admin_users',
    schema: AdminUserSchema,
    scopes: {
      timestamps: true,
    },
  });
}

module.exports = {
  createAdminUserModel,
  AdminUserSchema,
};

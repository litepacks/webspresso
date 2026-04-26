/**
 * Admin Panel - User Management Module
 * Integrates with core auth system for user CRUD
 * @module plugins/admin-panel/modules/user-management
 */

const { hash, verify } = require('../../../core/auth/hash');

/**
 * DBs like SQLite store booleans as 0/1; `repo.count({ active: true })` can return 0 while rows are "active".
 * Postgres/MySQL use real booleans — `true` is correct.
 */
function truthyBooleanForDb(db) {
  try {
    const client = db?.knex?.client?.config?.client;
    if (client === 'sqlite3' || client === 'better-sqlite3') return 1;
  } catch (_) {}
  return true;
}

/**
 * Register user management in admin panel
 * @param {Object} options - Options
 * @param {Object} options.registry - Admin registry
 * @param {Object} options.db - Database instance
 * @param {Object} [options.auth] - Auth manager (optional)
 * @param {Object} [options.config] - User management config
 */
function registerUserManagement(options) {
  const { registry, db, auth, config = {} } = options;
  
  const {
    modelName = 'User',
    fields = {},
    roles = ['user', 'admin'],
    passwordMinLength = 8,
  } = config;

  const fieldMap = {
    email: 'email',
    password: 'password',
    name: 'name',
    role: 'role',
    active: 'active',
    emailVerifiedAt: 'email_verified_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    ...fields,
  };

  // Enable user management in registry
  registry.enableUserManagement({
    model: modelName,
    fields: fieldMap,
  });

  // Register menu group
  registry.registerMenuGroup('users', {
    label: 'Users',
    icon: 'users',
    order: 100,
  });

  // Sidebar targets ORM CRUD routes directly (avoids Mithril onmatch redirect races on /users/new).
  const userModelListPath = '/models/' + encodeURIComponent(modelName);
  const userModelNewPath = userModelListPath + '/new';

  // Register menu items
  registry.registerMenuItem({
    id: 'user-list',
    label: 'All Users',
    path: userModelListPath,
    icon: 'users',
    group: 'users',
    order: 1,
  });

  registry.registerMenuItem({
    id: 'user-create',
    label: 'Add User',
    path: userModelNewPath,
    icon: 'user-plus',
    group: 'users',
    order: 2,
  });

  if (auth) {
    registry.registerMenuItem({
      id: 'user-sessions',
      label: 'Active Sessions',
      path: '/users/sessions',
      icon: 'shield',
      group: 'users',
      order: 3,
    });
  }

  // Register dashboard widget
  registry.registerWidget('user-stats', {
    title: 'User Statistics',
    size: 'md',
    order: 10,
    dataLoader: async ({ db }) => {
      try {
        const repo = db.getRepository(modelName);
        const model = repo.model;
        const total = await repo.count();
        const activeEq = truthyBooleanForDb(db);
        const active = await repo.query().where(fieldMap.active, activeEq).count();
        const admins = await repo.count({ [fieldMap.role]: 'admin' });

        let recentUsers = 0;
        const createdCol = fieldMap.createdAt;
        if (model.columns && model.columns.has(createdCol)) {
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);
          recentUsers = await repo.query()
            .where(createdCol, '>=', weekAgo.toISOString())
            .count();
        }

        return {
          total,
          active,
          inactive: Math.max(0, total - active),
          admins,
          recentUsers,
        };
      } catch (e) {
        return { total: 0, active: 0, inactive: 0, admins: 0, recentUsers: 0, error: e.message };
      }
    },
  });

  // Register actions
  registry.registerAction('user-activate', {
    label: 'Activate',
    icon: 'check',
    color: 'green',
    models: modelName,
    visible: (record) => !record[fieldMap.active],
    handler: async (record, model, { db }) => {
      const repo = db.getRepository(model);
      await repo.update(record.id, { [fieldMap.active]: true });
      return { message: 'User activated' };
    },
  });

  registry.registerAction('user-deactivate', {
    label: 'Deactivate',
    icon: 'x',
    color: 'red',
    models: modelName,
    visible: (record) => record[fieldMap.active],
    handler: async (record, model, { db }) => {
      const repo = db.getRepository(model);
      await repo.update(record.id, { [fieldMap.active]: false });
      return { message: 'User deactivated' };
    },
  });

  registry.registerAction('user-reset-password', {
    label: 'Reset Password',
    icon: 'key',
    color: 'yellow',
    models: modelName,
    confirm: true,
    confirmMessage: 'This will generate a new random password. Continue?',
    handler: async (record, model, { db }) => {
      const repo = db.getRepository(model);
      // Generate random password
      const newPassword = generateRandomPassword(12);
      const hashedPassword = await hash(newPassword);
      await repo.update(record.id, { [fieldMap.password]: hashedPassword });
      return { message: 'Password reset', newPassword }; // Return new password to show in UI
    },
  });

  // Register bulk actions
  registry.registerBulkAction('users-activate', {
    label: 'Activate Selected',
    icon: 'check',
    color: 'green',
    models: modelName,
    handler: async (records, model, { db }) => {
      const repo = db.getRepository(model);
      for (const record of records) {
        await repo.update(record.id, { [fieldMap.active]: true });
      }
      return { message: `${records.length} users activated` };
    },
  });

  registry.registerBulkAction('users-deactivate', {
    label: 'Deactivate Selected',
    icon: 'x',
    color: 'red',
    models: modelName,
    handler: async (records, model, { db }) => {
      const repo = db.getRepository(model);
      for (const record of records) {
        await repo.update(record.id, { [fieldMap.active]: false });
      }
      return { message: `${records.length} users deactivated` };
    },
  });

  registry.registerBulkAction('users-delete', {
    label: 'Delete Selected',
    icon: 'trash',
    color: 'red',
    models: modelName,
    confirm: true,
    confirmMessage: 'Are you sure you want to delete the selected users? This cannot be undone.',
    handler: async (records, model, { db }) => {
      const repo = db.getRepository(model);
      for (const record of records) {
        await repo.delete(record.id);
      }
      return { message: `${records.length} users deleted` };
    },
  });

  // Register hooks for password hashing
  registry.registerHook('beforeCreate', async (context) => {
    if (context.model === modelName && context.data[fieldMap.password]) {
      // Hash password before create
      context.data[fieldMap.password] = await hash(context.data[fieldMap.password]);
    }
  });

  registry.registerHook('beforeUpdate', async (context) => {
    if (context.model === modelName && context.data[fieldMap.password]) {
      // Only hash if password is being changed (not already hashed)
      const password = context.data[fieldMap.password];
      if (!password.startsWith('$2')) {
        context.data[fieldMap.password] = await hash(password);
      }
    }
  });

  return {
    modelName,
    fieldMap,
    roles,
  };
}

/**
 * Create user management API handlers
 * @param {Object} options - Options
 * @param {Object} options.db - Database instance
 * @param {Object} options.config - User management config
 * @param {Object} [options.auth] - Auth manager
 */
function createUserManagementApiHandlers(options) {
  const { db, config, auth } = options;
  const {
    modelName = 'User',
    fields = {},
  } = config;

  const fieldMap = {
    email: 'email',
    password: 'password',
    name: 'name',
    role: 'role',
    active: 'active',
    ...fields,
  };

  /**
   * List users with pagination
   */
  async function listUsers(req, res) {
    try {
      const repo = db.getRepository(modelName);
      const page = parseInt(req.query.page) || 1;
      const perPage = parseInt(req.query.perPage) || 20;
      const search = req.query.search;
      const role = req.query.role;
      const active = req.query.active;

      let query = repo.query();

      // Search
      if (search) {
        query = query.where(function() {
          this.where(fieldMap.email, 'like', `%${search}%`)
              .orWhere(fieldMap.name, 'like', `%${search}%`);
        });
      }

      // Role filter
      if (role) {
        query = query.where(fieldMap.role, role);
      }

      // Active filter
      if (active !== undefined) {
        query = query.where(fieldMap.active, active === 'true');
      }

      const result = await query.paginate(page, perPage);

      // Remove passwords from response
      result.data = result.data.map(user => {
        const { [fieldMap.password]: _, ...userWithoutPassword } = user;
        return userWithoutPassword;
      });

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get single user
   */
  async function getUser(req, res) {
    try {
      const { id } = req.params;
      const repo = db.getRepository(modelName);
      const user = await repo.findById(id);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const { [fieldMap.password]: _, ...userWithoutPassword } = user;
      res.json({ data: userWithoutPassword });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Create user
   */
  async function createUser(req, res) {
    try {
      const repo = db.getRepository(modelName);
      const data = { ...req.body };

      // Validate email
      if (!data[fieldMap.email]) {
        return res.status(400).json({ error: 'Email is required' });
      }

      // Check email uniqueness
      const existing = await repo.findOne({ [fieldMap.email]: data[fieldMap.email] });
      if (existing) {
        return res.status(400).json({ error: 'Email already exists' });
      }

      // Hash password
      if (data[fieldMap.password]) {
        data[fieldMap.password] = await hash(data[fieldMap.password]);
      }

      const user = await repo.create(data);
      const { [fieldMap.password]: _, ...userWithoutPassword } = user;

      res.status(201).json({ data: userWithoutPassword });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Update user
   */
  async function updateUser(req, res) {
    try {
      const { id } = req.params;
      const repo = db.getRepository(modelName);
      const data = { ...req.body };

      // Check if user exists
      const existing = await repo.findById(id);
      if (!existing) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Check email uniqueness if changing email
      if (data[fieldMap.email] && data[fieldMap.email] !== existing[fieldMap.email]) {
        const emailExists = await repo.findOne({ [fieldMap.email]: data[fieldMap.email] });
        if (emailExists) {
          return res.status(400).json({ error: 'Email already exists' });
        }
      }

      // Hash password if provided and not already hashed
      if (data[fieldMap.password] && !data[fieldMap.password].startsWith('$2')) {
        data[fieldMap.password] = await hash(data[fieldMap.password]);
      }

      const user = await repo.update(id, data);
      const { [fieldMap.password]: _, ...userWithoutPassword } = user;

      res.json({ data: userWithoutPassword });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Delete user
   */
  async function deleteUser(req, res) {
    try {
      const { id } = req.params;
      const repo = db.getRepository(modelName);

      const deleted = await repo.delete(id);
      if (!deleted) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get active sessions (requires auth with remember tokens)
   */
  async function getSessions(req, res) {
    try {
      if (!auth?.rememberTokens) {
        return res.json({ data: [], message: 'Session tracking not enabled' });
      }

      const hasTable = await db.knex.schema.hasTable('remember_tokens');
      if (!hasTable) {
        return res.json({ data: [] });
      }

      const sessions = await db.knex('remember_tokens')
        .select('remember_tokens.*', `${modelName}.${fieldMap.email} as user_email`, `${modelName}.${fieldMap.name} as user_name`)
        .leftJoin(modelName, 'remember_tokens.user_id', `${modelName}.id`)
        .orderBy('remember_tokens.created_at', 'desc');

      res.json({ data: sessions });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Revoke session
   */
  async function revokeSession(req, res) {
    try {
      const { token } = req.params;

      if (!auth?.rememberTokens) {
        return res.status(400).json({ error: 'Session management not enabled' });
      }

      await db.knex('remember_tokens').where('token', token).delete();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Revoke all sessions for a user
   */
  async function revokeUserSessions(req, res) {
    try {
      const { userId } = req.params;

      if (!auth?.rememberTokens) {
        return res.status(400).json({ error: 'Session management not enabled' });
      }

      const deleted = await db.knex('remember_tokens').where('user_id', userId).delete();
      res.json({ success: true, revoked: deleted });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  return {
    listUsers,
    getUser,
    createUser,
    updateUser,
    deleteUser,
    getSessions,
    revokeSession,
    revokeUserSessions,
  };
}

/**
 * Generate random password
 */
function generateRandomPassword(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

module.exports = {
  registerUserManagement,
  createUserManagementApiHandlers,
  generateRandomPassword,
};

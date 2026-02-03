/**
 * Admin Panel API Routes
 * CRUD endpoints for admin panel
 * @module plugins/admin-panel/api
 */

const { getAllModels, getModel } = require('../../core/orm/model');
const { checkAdminExists, setupAdmin, login, logout, requireAuth } = require('./auth');

/**
 * Check if rich-text content is empty
 * @param {string} value - Rich-text HTML value
 * @returns {boolean} True if empty
 */
function isRichTextEmpty(value) {
  if (!value) return true;
  // Remove all HTML tags and check if only whitespace remains
  const stripped = value.replace(/<[^>]*>/g, '').trim();
  // Check for common empty Quill outputs
  return stripped === '' || value === '<p><br></p>' || value === '<p></p>';
}

/**
 * Create API route handlers
 * @param {Object} options - Options
 * @param {string} options.path - Admin panel path
 * @param {Object} options.db - Database instance
 * @param {Object} options.AdminUser - AdminUser model
 * @param {Function} options.hashPassword - Bcrypt hash function
 * @param {Function} options.comparePassword - Bcrypt compare function
 * @returns {Object} Route handlers
 */
function createApiHandlers(options) {
  const { path, db, AdminUser, hashPassword, comparePassword } = options;
  const adminPath = path || '/_admin';
  const apiPath = `${adminPath}/api`;

  // Helper to get model from db instance or global registry
  function getModelFromDb(modelName) {
    if (db && typeof db.getModel === 'function') {
      try {
        return db.getModel(modelName);
      } catch {
        // Fall through to global registry
      }
    }
    return getModel(modelName);
  }

  // Get AdminUser repository
  let AdminUserRepo = null;
  if (db && AdminUser) {
    AdminUserRepo = db.getRepository(AdminUser.name);
  }

  /**
   * Check if admin user exists
   */
    async function checkHandler(req, res) {
    try {
      if (!AdminUserRepo) {
        return res.json({ exists: false });
      }
      const exists = await checkAdminExists(AdminUserRepo);
      res.json({ exists });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Setup first admin user
   */
  async function setupHandler(req, res) {
    try {
      if (!AdminUserRepo || !hashPassword) {
        return res.status(500).json({ error: 'Admin user system not initialized' });
      }

      const { email, password, name } = req.body;

      if (!email || !password || !name) {
        return res.status(400).json({ error: 'Email, password, and name are required' });
      }

      const admin = await setupAdmin(AdminUserRepo, { email, password, name }, hashPassword);
      
      // Set session
      req.session.adminUser = admin;
      
      res.json({ success: true, user: admin });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Login handler
   */
  async function loginHandler(req, res) {
    try {
      if (!AdminUserRepo || !comparePassword) {
        return res.status(500).json({ error: 'Admin user system not initialized' });
      }

      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const user = await login(AdminUserRepo, email, password, comparePassword);

      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Set session
      req.session.adminUser = user;

      res.json({ success: true, user });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Logout handler
   */
  async function logoutHandler(req, res) {
    try {
      await logout(req, res);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get current user
   */
  function meHandler(req, res) {
    if (req.session && req.session.adminUser) {
      res.json({ user: req.session.adminUser });
    } else {
      res.status(401).json({ error: 'Not authenticated' });
    }
  }

  /**
   * Get all models (admin enabled)
   */
  function modelsHandler(req, res) {
    try {
      // Use db.getAllModels() if available (local registry), fallback to global registry
      const allModels = db && typeof db.getAllModels === 'function' 
        ? db.getAllModels() 
        : Array.from(getAllModels().values());
      
      const adminModels = [];

      // Handle both Map entries and array of models
      const modelList = Array.isArray(allModels) ? allModels : Array.from(allModels.values());

      for (const model of modelList) {
        if (model.admin && model.admin.enabled === true) {
          adminModels.push({
            name: model.name,
            table: model.table,
            label: model.admin.label || model.name,
            icon: model.admin.icon || null,
            primaryKey: model.primaryKey,
            columns: Array.from(model.columns.keys()),
            relations: Object.keys(model.relations),
          });
        }
      }

      res.json({ models: adminModels });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get model metadata
   */
  function modelHandler(req, res) {
    try {
      const { model: modelName } = req.params;
      const model = getModelFromDb(modelName);

      if (!model) {
        return res.status(404).json({ error: 'Model not found' });
      }

      if (!model.admin || model.admin.enabled !== true) {
        return res.status(403).json({ error: 'Model not enabled in admin panel' });
      }

      // Build column metadata
      const columns = [];
      for (const [name, meta] of model.columns) {
        columns.push({
          name,
          type: meta.type,
          nullable: meta.nullable || false,
          default: meta.default,
          maxLength: meta.maxLength,
          enumValues: meta.enumValues,
          references: meta.references,
          primary: meta.primary || false,
          auto: meta.auto || null, // 'create' | 'update' for timestamps
          autoIncrement: meta.autoIncrement || false,
          customField: model.admin.customFields?.[name] || null,
          validations: meta.validations || null,
          ui: meta.ui || null,
        });
      }

      res.json({
        name: model.name,
        table: model.table,
        label: model.admin.label || model.name,
        icon: model.admin.icon || null,
        primaryKey: model.primaryKey,
        columns,
        relations: Object.keys(model.relations),
        queries: Object.keys(model.admin.queries || {}),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get records (paginated)
   */
  async function recordsListHandler(req, res) {
    try {
      const { model: modelName } = req.params;
      const model = getModelFromDb(modelName);

      if (!model || !model.admin || model.admin.enabled !== true) {
        return res.status(404).json({ error: 'Model not found or not enabled' });
      }

      const repo = db.getRepository(model.name);
      const page = parseInt(req.query.page) || 1;
      const perPage = parseInt(req.query.perPage) || 15;
      const offset = (page - 1) * perPage;

      // Build query
      let query = repo.query();
      let countQuery = repo.query();

      // Parse filter parameters from query string
      // Express's qs library automatically parses filter[column][prop] into nested objects
      // So req.query.filter is already { column: { op: '...', value: '...' } }
      const filterParams = req.query.filter || {};

      // Apply filters
      for (const [colName, filter] of Object.entries(filterParams)) {
        const colMeta = model.columns.get(colName);
        const colType = colMeta?.type || 'string';
        const op = filter.op || (colType === 'boolean' ? 'eq' : 'contains');
        const value = filter.value;
        const from = filter.from;
        const to = filter.to;

        // Handle boolean values - convert string 'true'/'false' to actual boolean
        if (colType === 'boolean' && value !== undefined && value !== null) {
          const boolValue = value === 'true' || value === true ? 1 : 0;
          query = query.where(colName, '=', boolValue);
          countQuery = countQuery.where(colName, '=', boolValue);
          continue;
        }

        if (op === 'between' && (from || to)) {
          if (from && to) {
            query = query.whereBetween(colName, [from, to]);
            countQuery = countQuery.whereBetween(colName, [from, to]);
          } else if (from) {
            query = query.where(colName, '>=', from);
            countQuery = countQuery.where(colName, '>=', from);
          } else if (to) {
            query = query.where(colName, '<=', to);
            countQuery = countQuery.where(colName, '<=', to);
          }
        } else if (op === 'in' && Array.isArray(value) && value.length > 0) {
          query = query.whereIn(colName, value);
          countQuery = countQuery.whereIn(colName, value);
        } else if (value !== undefined && value !== null && value !== '') {
          switch (op) {
            case 'contains':
              // Apply LIKE for string/text types, or if type is unknown
              if (colType === 'string' || colType === 'text' || !colMeta) {
                query = query.where(colName, 'like', `%${value}%`);
                countQuery = countQuery.where(colName, 'like', `%${value}%`);
              }
              break;
            case 'equals':
              query = query.where(colName, '=', value);
              countQuery = countQuery.where(colName, '=', value);
              break;
            case 'starts_with':
              if (colType === 'string' || colType === 'text' || !colMeta) {
                query = query.where(colName, 'like', `${value}%`);
                countQuery = countQuery.where(colName, 'like', `${value}%`);
              }
              break;
            case 'ends_with':
              if (colType === 'string' || colType === 'text' || !colMeta) {
                query = query.where(colName, 'like', `%${value}`);
                countQuery = countQuery.where(colName, 'like', `%${value}`);
              }
              break;
            case 'gt':
              query = query.where(colName, '>', value);
              countQuery = countQuery.where(colName, '>', value);
              break;
            case 'gte':
              query = query.where(colName, '>=', value);
              countQuery = countQuery.where(colName, '>=', value);
              break;
            case 'lt':
              query = query.where(colName, '<', value);
              countQuery = countQuery.where(colName, '<', value);
              break;
            case 'lte':
              query = query.where(colName, '<=', value);
              countQuery = countQuery.where(colName, '<=', value);
              break;
            case 'eq':
            default:
              query = query.where(colName, '=', value);
              countQuery = countQuery.where(colName, '=', value);
              break;
          }
        }
      }

      // Legacy search support (backward compatibility)
      if (req.query.search) {
        const searchTerm = `%${req.query.search}%`;
        const stringColumns = Array.from(model.columns.entries())
          .filter(([_, meta]) => meta.type === 'string' || meta.type === 'text')
          .map(([name]) => name);

        if (stringColumns.length > 0) {
          query = query.where(function() {
            for (let i = 0; i < stringColumns.length; i++) {
              if (i === 0) {
                this.where(stringColumns[i], 'like', searchTerm);
              } else {
                this.orWhere(stringColumns[i], 'like', searchTerm);
              }
            }
          });
          countQuery = countQuery.where(function() {
            for (let i = 0; i < stringColumns.length; i++) {
              if (i === 0) {
                this.where(stringColumns[i], 'like', searchTerm);
              } else {
                this.orWhere(stringColumns[i], 'like', searchTerm);
              }
            }
          });
        }
      }

      // Get total count with filters applied
      const total = await countQuery.count();

      // Apply pagination
      query = query.offset(offset).limit(perPage);

      // Apply sorting (newest first by default)
      const primaryKey = model.primaryKey || 'id';
      query = query.orderBy(primaryKey, 'desc');

      // Get records
      const records = await query.list();

      res.json({
        data: records,
        pagination: {
          page,
          perPage,
          total,
          totalPages: Math.ceil(total / perPage),
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get single record
   */
  async function recordHandler(req, res) {
    try {
      const { model: modelName, id } = req.params;
      const model = getModelFromDb(modelName);

      if (!model || !model.admin || model.admin.enabled !== true) {
        return res.status(404).json({ error: 'Model not found or not enabled' });
      }

      const repo = db.getRepository(model.name);
      const record = await repo.findById(id);

      if (!record) {
        return res.status(404).json({ error: 'Record not found' });
      }

      res.json({ data: record });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Create record
   */
  async function createRecordHandler(req, res) {
    try {
      const { model: modelName } = req.params;
      const model = getModelFromDb(modelName);

      if (!model || !model.admin || model.admin.enabled !== true) {
        return res.status(404).json({ error: 'Model not found or not enabled' });
      }

      // Validate rich-text fields
      for (const [colName, colMeta] of model.columns) {
        if (model.admin.customFields?.[colName]?.type === 'rich-text' && !colMeta.nullable) {
          const value = req.body[colName];
          if (isRichTextEmpty(value)) {
            return res.status(400).json({ 
              error: `Field "${colName}" is required` 
            });
          }
        }
      }

      const repo = db.getRepository(model.name);
      const record = await repo.create(req.body);

      res.status(201).json({ data: record });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Update record
   */
  async function updateRecordHandler(req, res) {
    try {
      const { model: modelName, id } = req.params;
      const model = getModelFromDb(modelName);

      if (!model || !model.admin || model.admin.enabled !== true) {
        return res.status(404).json({ error: 'Model not found or not enabled' });
      }

      // Validate rich-text fields (only if field is being updated)
      for (const [colName, colMeta] of model.columns) {
        if (colName in req.body && model.admin.customFields?.[colName]?.type === 'rich-text' && !colMeta.nullable) {
          const value = req.body[colName];
          if (isRichTextEmpty(value)) {
            return res.status(400).json({ 
              error: `Field "${colName}" is required` 
            });
          }
        }
      }

      const repo = db.getRepository(model.name);
      const record = await repo.update(id, req.body);

      if (!record) {
        return res.status(404).json({ error: 'Record not found' });
      }

      res.json({ data: record });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Delete record
   */
  async function deleteRecordHandler(req, res) {
    try {
      const { model: modelName, id } = req.params;
      const model = getModelFromDb(modelName);

      if (!model || !model.admin || model.admin.enabled !== true) {
        return res.status(404).json({ error: 'Model not found or not enabled' });
      }

      const repo = db.getRepository(model.name);
      const deleted = await repo.delete(id);

      if (!deleted) {
        return res.status(404).json({ error: 'Record not found' });
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get relation data
   */
  async function relationHandler(req, res) {
    try {
      const { model: modelName, relation: relationName } = req.params;
      const model = getModelFromDb(modelName);

      if (!model || !model.admin || model.admin.enabled !== true) {
        return res.status(404).json({ error: 'Model not found or not enabled' });
      }

      const relation = model.relations[relationName];
      if (!relation) {
        return res.status(404).json({ error: 'Relation not found' });
      }

      const relatedModel = relation.model();
      const relatedRepo = db.getRepository(relatedModel.name);

      // Get all related records (for dropdown/select)
      const records = await relatedRepo.findAll();

      res.json({ data: records });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Execute custom query
   */
  async function queryHandler(req, res) {
    try {
      const { model: modelName, query: queryName } = req.params;
      const model = getModelFromDb(modelName);

      if (!model || !model.admin || model.admin.enabled !== true) {
        return res.status(404).json({ error: 'Model not found or not enabled' });
      }

      const queryFn = model.admin.queries?.[queryName];
      if (!queryFn || typeof queryFn !== 'function') {
        return res.status(404).json({ error: 'Query not found' });
      }

      const repo = db.getRepository(model.name);
      const result = await queryFn(repo);

      res.json({ data: result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Reset admin users (TEST ONLY)
   * Clears all admin users from the database
   */
  async function resetHandler(req, res) {
    // Only allow in test environment
    if (process.env.NODE_ENV !== 'test') {
      return res.status(403).json({ error: 'Only available in test environment' });
    }

    try {
      // Try to delete all admin users using db.knex directly
      // This works even if AdminUserRepo is not set up
      if (db && db.knex) {
        const tableExists = await db.knex.schema.hasTable('admin_users');
        if (tableExists) {
          const deleted = await db.knex('admin_users').del();
          console.log(`[TEST RESET] Deleted ${deleted} admin users`);
          res.json({ success: true, message: `Deleted ${deleted} admin users` });
        } else {
          res.json({ success: true, message: 'admin_users table does not exist' });
        }
      } else {
        res.json({ success: true, message: 'No database instance' });
      }
    } catch (error) {
      console.error('[TEST RESET] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  }

  return {
    checkHandler,
    setupHandler,
    loginHandler,
    logoutHandler,
    meHandler,
    modelsHandler,
    modelHandler,
    recordsListHandler,
    recordHandler,
    createRecordHandler,
    updateRecordHandler,
    deleteRecordHandler,
    relationHandler,
    queryHandler,
    resetHandler,
  };
}

module.exports = {
  createApiHandlers,
};

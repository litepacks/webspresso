/**
 * Admin Panel API Routes
 * CRUD endpoints for admin panel
 * @module plugins/admin-panel/api
 */

const { getAllModels, getModel } = require('../../core/orm/model');
const { sanitizeForOutput } = require('../../core/orm/utils');
const { checkAdminExists, setupAdmin, login, logout, requireAuth } = require('./auth');
const { isRichTextEmpty } = require('./lib/is-rich-text-empty');
const { sanitizeRichHtml } = require('./lib/sanitize-rich-html');
const { LoginRateLimiter } = require('./lib/login-rate-limiter');

/**
 * Create API route handlers
 * @param {Object} options - Options
 * @param {string} options.path - Admin panel path
 * @param {Object} options.db - Database instance
 * @param {Object} options.AdminUser - AdminUser model
 * @param {Function} options.hashPassword - Bcrypt hash function
 * @param {Function} options.comparePassword - Bcrypt compare function
 * @param {boolean} [options.richTextSanitize=true] - Sanitize rich-text HTML before create/update
 * @param {boolean|Object} [options.loginRateLimit] - Login rate limiting options
 * @returns {Object} Route handlers
 */
function createApiHandlers(options) {
  const {
    path,
    db,
    registry,
    AdminUser,
    hashPassword,
    comparePassword,
    richTextSanitize = true,
    loginRateLimit,
  } = options;
  const adminPath = path || '/_admin';
  const apiPath = `${adminPath}/api`;
  const rateLimiter = options.rateLimiter || new LoginRateLimiter(loginRateLimit);

  /** Strip XSS vectors from rich-text columns present on body; nullable columns normalize empty → null */
  function mutateRichTextFieldsInBody(body, model) {
    if (!richTextSanitize || !model.admin?.customFields) return;
    for (const [colName, colMeta] of model.columns) {
      if (model.admin.customFields[colName]?.type !== 'rich-text') continue;
      if (!(colName in body)) continue;
      const raw = body[colName];
      if (raw === null || raw === undefined) continue;
      if (typeof raw !== 'string') continue;
      body[colName] = sanitizeRichHtml(raw);
      if (colMeta.nullable && isRichTextEmpty(body[colName])) {
        body[colName] = null;
      }
    }
  }

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

  // Helper to check if model has column (supports zdb and zod shapes)
  function hasColumn(model, colName) {
    if (!model || !colName) return false;
    if (model.columns && typeof model.columns.has === 'function' && model.columns.has(colName)) return true;
    if (model.schema?.shape && colName in model.schema.shape) return true;
    return false;
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
      const blockStatus = rateLimiter.isBlocked(req);
      if (blockStatus.blocked) {
        if (typeof res.setHeader === 'function') {
          res.setHeader('Retry-After', String(blockStatus.retryAfter));
        }
        return res.status(429).json({
          error: blockStatus.message,
          retryAfter: blockStatus.retryAfter,
        });
      }

      if (!AdminUserRepo || !comparePassword) {
        return res.status(500).json({ error: 'Admin user system not initialized' });
      }

      const { email, password } = req.body || {};

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const user = await login(AdminUserRepo, email, password, comparePassword);

      if (!user) {
        rateLimiter.recordFailure(req);
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      rateLimiter.recordSuccess(req);

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
   * Update current user profile
   */
  async function updateProfileHandler(req, res) {
    try {
      if (!req.session || !req.session.adminUser) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const userId = req.session.adminUser.id;
      const { name, email, currentPassword, newPassword } = req.body || {};

      if (!AdminUserRepo) {
        return res.status(500).json({ error: 'Admin user system not initialized' });
      }

      const user = await AdminUserRepo.findById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const updateData = {};

      if (name && typeof name === 'string' && name.trim()) {
        updateData.name = name.trim();
      }

      if (email && typeof email === 'string' && email.trim() && email.trim() !== user.email) {
        const existing = await AdminUserRepo.query().where('email', email.trim()).whereNot('id', userId).first();
        if (existing) {
          return res.status(400).json({ error: 'Email is already in use by another user' });
        }
        updateData.email = email.trim();
      }

      if (newPassword) {
        if (!currentPassword) {
          return res.status(400).json({ error: 'Current password is required to set a new password' });
        }
        if (!comparePassword) {
          return res.status(500).json({ error: 'Password comparison helper not available' });
        }
        const isValid = await comparePassword(currentPassword, user.password);
        if (!isValid) {
          return res.status(400).json({ error: 'Current password is incorrect' });
        }
        if (typeof newPassword !== 'string' || newPassword.length < 6) {
          return res.status(400).json({ error: 'New password must be at least 6 characters long' });
        }
        updateData.password = await hashPassword(newPassword, 10);
      }

      if (Object.keys(updateData).length > 0) {
        await AdminUserRepo.update(userId, updateData);
      }

      const updatedUser = await AdminUserRepo.findById(userId);
      const sanitized = sanitizeForOutput(updatedUser, getModelFromDb('AdminUser') || { hidden: ['password'] });
      if (sanitized) delete sanitized.password;

      req.session.adminUser = {
        ...req.session.adminUser,
        name: updatedUser.name,
        email: updatedUser.email,
      };

      res.json({ success: true, user: sanitized });
    } catch (error) {
      res.status(500).json({ error: error.message });
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
            group: model.admin.group || null,
            readOnly: model.admin.readOnly === true,
            permissions: model.admin.permissions || null,
            displayField: model.admin.displayField || null,
            defaultSort: model.admin.defaultSort || null,
            inlines: model.admin.inlines || null,
            listEditable: model.admin.listEditable || null,
            dateHierarchy: model.admin.dateHierarchy || null,
            listFilter: model.admin.listFilter || null,
          });
        }
      }

      res.json({ models: adminModels });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

/**
 * Helper to determine if a column is sortable based on model and column configs
 */
function isColumnSortable(name, meta, model) {
  if (!meta) return false;
  if (model.admin && model.admin.sortable === false) return false;
  if (model.admin && Array.isArray(model.admin.sortableColumns)) {
    return model.admin.sortableColumns.includes(name);
  }
  if (model.admin?.columns?.[name]?.sortable !== undefined) {
    return Boolean(model.admin.columns[name].sortable);
  }
  if (meta.sortable !== undefined) {
    return Boolean(meta.sortable);
  }
  if (meta.ui?.sortable !== undefined) {
    return Boolean(meta.ui.sortable);
  }
  const nonSortableTypes = ['json', 'array', 'file'];
  return !nonSortableTypes.includes(meta.type);
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

      // Build column metadata (hidden columns excluded from list/forms for security)
      const hiddenSet = new Set(model.hidden || []);
      const columns = [];
      for (const [name, meta] of model.columns) {
        const isHidden = hiddenSet.has(name);
        const colAdminConfig = model.admin.columns?.[name] || null;
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
          ui: meta.ui ? { ...meta.ui, hidden: isHidden || meta.ui.hidden } : (isHidden ? { hidden: true } : null),
          hidden: isHidden, // Excluded from list display and API responses
          sortable: isColumnSortable(name, meta, model),
          badge: colAdminConfig?.badge || meta.badge || model.admin.customFields?.[name]?.badge || null,
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
        softDelete: !!model.scopes?.softDelete,
        listColumns: model.admin.listColumns || null,
        searchFields: model.admin.searchFields || null,
        displayField: model.admin.displayField || null,
        readOnly: model.admin.readOnly === true,
        permissions: model.admin.permissions || null,
        defaultSort: model.admin.defaultSort || null,
        group: model.admin.group || null,
        columnsConfig: model.admin.columns || null,
        relationsConfig: model.admin.relations || null,
        inlines: model.admin.inlines || null,
        listEditable: model.admin.listEditable || null,
        dateHierarchy: model.admin.dateHierarchy || null,
        listFilter: model.admin.listFilter || null,
        actions: [
          ...(registry && typeof registry.getActionsForModel === 'function' ? registry.getActionsForModel(model.name) : []),
          ...(Array.isArray(model.admin.actions) ? model.admin.actions : []),
        ].reduce((acc, a) => {
          if (!acc.some(x => x.id === a.id)) {
            acc.push({
              id: a.id,
              label: a.label,
              icon: a.icon || null,
              color: a.color || 'gray',
              confirm: a.confirm === true,
              confirmMessage: a.confirmMessage || null,
              showWhen: typeof a.showWhen === 'object' && a.showWhen !== null ? a.showWhen : null,
            });
          }
          return acc;
        }, []),
        bulkActions: [
          ...(registry && typeof registry.getBulkActionsForModel === 'function' ? registry.getBulkActionsForModel(model.name) : []),
          ...(Array.isArray(model.admin.bulkActions) ? model.admin.bulkActions : []),
        ].reduce((acc, a) => {
          if (!acc.some(x => x.id === a.id)) {
            acc.push({
              id: a.id,
              label: a.label,
              icon: a.icon || null,
              color: a.color || 'gray',
              confirm: a.confirm !== false,
              confirmMessage: a.confirmMessage || null,
            });
          }
          return acc;
        }, []),
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

      // Build query (with soft delete scope if applicable)
      let query = repo.query();
      let countQuery = repo.query();
      if (model.scopes?.softDelete) {
        const trashed = req.query.trashed;
        if (trashed === 'only') {
          query = query.onlyTrashed();
          countQuery = countQuery.onlyTrashed();
        } else if (trashed === 'include') {
          query = query.withTrashed();
          countQuery = countQuery.withTrashed();
        }
      }

      // Date hierarchy filter (Django date_hierarchy-inspired)
      const dateHierarchyCol = req.query.date_field || model.admin?.dateHierarchy;
      if (dateHierarchyCol && hasColumn(model, dateHierarchyCol)) {
        const { year, month, day, date_from, date_to } = req.query;
        if (year) {
          const yr = String(year);
          if (month) {
            const mo = String(month).padStart(2, '0');
            if (day) {
              const da = String(day).padStart(2, '0');
              query = query.where(dateHierarchyCol, 'like', `${yr}-${mo}-${da}%`);
              countQuery = countQuery.where(dateHierarchyCol, 'like', `${yr}-${mo}-${da}%`);
            } else {
              query = query.where(dateHierarchyCol, 'like', `${yr}-${mo}%`);
              countQuery = countQuery.where(dateHierarchyCol, 'like', `${yr}-${mo}%`);
            }
          } else {
            query = query.where(dateHierarchyCol, 'like', `${yr}%`);
            countQuery = countQuery.where(dateHierarchyCol, 'like', `${yr}%`);
          }
        }
        if (date_from) {
          query = query.where(dateHierarchyCol, '>=', date_from);
          countQuery = countQuery.where(dateHierarchyCol, '>=', date_from);
        }
        if (date_to) {
          query = query.where(dateHierarchyCol, '<=', date_to);
          countQuery = countQuery.where(dateHierarchyCol, '<=', date_to);
        }
      }

      // Parse filter parameters from query string
      // Express's qs library automatically parses filter[column][prop] into nested objects
      // So req.query.filter is already { column: { op: '...', value: '...' } }
      const filterParams = req.query.filter || {};

      // Apply filters
      for (const [colName, filter] of Object.entries(filterParams)) {
        if (!model.columns.has(colName) || !filter || typeof filter !== 'object') {
          continue;
        }
        const colMeta = model.columns.get(colName);
        const colType = colMeta?.type || 'string';
        const op = filter.op || (colType === 'boolean' ? 'eq' : 'contains');
        const value = filter.value;
        const from = filter.from;
        const to = filter.to;

        if (op === 'is_null') {
          query = query.whereNull(colName);
          countQuery = countQuery.whereNull(colName);
          continue;
        }
        if (op === 'is_not_null') {
          query = query.whereNotNull(colName);
          countQuery = countQuery.whereNotNull(colName);
          continue;
        }

        // Handle boolean values - convert string 'true'/'false' to actual boolean
        if (colType === 'boolean' && value !== undefined && value !== null && value !== '') {
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
              // Apply LIKE for string/text/file types, or if type is unknown
              if (colType === 'string' || colType === 'text' || colType === 'file' || !colMeta) {
                query = query.where(colName, 'like', `%${value}%`);
                countQuery = countQuery.where(colName, 'like', `%${value}%`);
              }
              break;
            case 'equals':
              query = query.where(colName, '=', value);
              countQuery = countQuery.where(colName, '=', value);
              break;
            case 'starts_with':
              if (colType === 'string' || colType === 'text' || colType === 'file' || !colMeta) {
                query = query.where(colName, 'like', `${value}%`);
                countQuery = countQuery.where(colName, 'like', `${value}%`);
              }
              break;
            case 'ends_with':
              if (colType === 'string' || colType === 'text' || colType === 'file' || !colMeta) {
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

      // Search support (respects model.admin.searchFields if configured, falls back to string columns)
      if (req.query.search) {
        const searchTerm = `%${req.query.search}%`;
        let stringColumns;
        if (Array.isArray(model.admin.searchFields) && model.admin.searchFields.length > 0) {
          stringColumns = model.admin.searchFields.filter((colName) => model.columns.has(colName));
        } else {
          stringColumns = Array.from(model.columns.entries())
            .filter(([_, meta]) => meta.type === 'string' || meta.type === 'text' || meta.type === 'file')
            .map(([name]) => name);
        }

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

      // Apply sorting
      const primaryKey = model.primaryKey || 'id';
      const sortParam = req.query.sort;
      const orderParam = (req.query.order || req.query.direction || '').toLowerCase();

      if (sortParam && model.columns.has(sortParam)) {
        const sortOrder = orderParam === 'asc' ? 'asc' : 'desc';
        const colMeta = model.columns.get(sortParam);
        if (isColumnSortable(sortParam, colMeta, model)) {
          query = query.orderBy(sortParam, sortOrder);
        } else {
          query = query.orderBy(primaryKey, 'desc');
        }
      } else if (model.admin.defaultSort && model.admin.defaultSort.column && model.columns.has(model.admin.defaultSort.column)) {
        const defCol = model.admin.defaultSort.column;
        const defOrder = (model.admin.defaultSort.order || model.admin.defaultSort.direction || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
        query = query.orderBy(defCol, defOrder);
      } else {
        query = query.orderBy(primaryKey, 'desc');
      }

      // Get records
      const records = await query.list();

      res.json({
        data: sanitizeForOutput(records, model),
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

      if (registry && typeof registry.runHooks === 'function') {
        await registry.runHooks('onRecordView', { model: model.name, id, record, req, user: req.session?.adminUser, db });
      }

      const sanitized = sanitizeForOutput(record, model);

      // Auto-load inlines (Django Inlines-inspired)
      if (model.admin?.inlines && Array.isArray(model.admin.inlines)) {
        const inlinesData = {};
        for (const inlineDef of model.admin.inlines) {
          const targetModel = getModelFromDb(inlineDef.model);
          if (targetModel) {
            const targetRepo = db.getRepository(targetModel.name);
            const fk = inlineDef.foreignKey || `${model.name.toLowerCase()}_id`;
            const rows = await targetRepo.query().where(fk, id).find();
            inlinesData[inlineDef.model] = sanitizeForOutput(rows, targetModel);
          }
        }
        sanitized._inlines = inlinesData;
      }

      res.json({ data: sanitized });
    } catch (error) {
      const statusCode = error.statusCode || error.status || 500;
      res.status(statusCode).json({ error: error.message });
    }
  }

  /**
   * Sync inline child records for a parent record (Django Inlines-inspired)
   */
  async function syncInlines(parentRecord, inlinesPayload, model) {
    if (!model.admin?.inlines || !inlinesPayload || typeof inlinesPayload !== 'object') {
      return;
    }
    for (const inlineDef of model.admin.inlines) {
      const inlineModelName = inlineDef.model;
      const items = inlinesPayload[inlineModelName];
      if (!Array.isArray(items)) continue;

      const targetModel = getModelFromDb(inlineModelName);
      if (!targetModel) continue;

      const targetRepo = db.getRepository(targetModel.name);
      const fk = inlineDef.foreignKey || `${model.name.toLowerCase()}_id`;
      const parentId = parentRecord[model.primaryKey || 'id'];

      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const itemId = item[targetModel.primaryKey || 'id'];

        if (item._delete === true || item._destroy === true) {
          if (itemId) {
            await targetRepo.delete(itemId);
          }
        } else if (itemId) {
          const cleanItem = { ...item };
          delete cleanItem._delete;
          delete cleanItem._destroy;
          await targetRepo.update(itemId, cleanItem);
        } else {
          const cleanItem = { ...item, [fk]: parentId };
          delete cleanItem._delete;
          delete cleanItem._destroy;
          await targetRepo.create(cleanItem);
        }
      }
    }
  }

  /** Extract structured field errors from Zod, ORM or database validation exceptions */
  function extractValidationErrors(error) {
    if (!error) return null;
    const fields = {};
    if (error.errors && typeof error.errors === 'object') {
      if (Array.isArray(error.errors)) {
        for (const item of error.errors) {
          if (item.path && item.message) {
            const key = Array.isArray(item.path) ? item.path.join('.') : String(item.path);
            fields[key] = item.message;
          }
        }
      } else {
        Object.assign(fields, error.errors);
      }
    } else if (error.issues && Array.isArray(error.issues)) {
      for (const issue of error.issues) {
        const key = issue.path && issue.path.length > 0 ? issue.path.join('.') : 'root';
        fields[key] = issue.message;
      }
    } else if (error.fields && typeof error.fields === 'object') {
      Object.assign(fields, error.fields);
    }
    return Object.keys(fields).length > 0 ? fields : null;
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

      if (model.admin.readOnly === true) {
        return res.status(403).json({ error: `Model "${model.name}" is read-only` });
      }
      if (model.admin.permissions?.create === false) {
        return res.status(403).json({ error: `Creation is disabled for model "${model.name}"` });
      }

      mutateRichTextFieldsInBody(req.body, model);

      if (registry && typeof registry.runHooks === 'function') {
        await registry.runHooks('beforeCreate', { model: model.name, data: req.body, req, user: req.session?.adminUser, db });
      }

      // Validate rich-text fields
      for (const [colName, colMeta] of model.columns) {
        if (model.admin.customFields?.[colName]?.type === 'rich-text' && !colMeta.nullable) {
          const value = req.body[colName];
          if (isRichTextEmpty(value)) {
            return res.status(400).json({ 
              error: `Field "${colName}" is required`,
              fields: { [colName]: `Field "${colName}" is required` },
            });
          }
        }
      }

      const payload = { ...req.body };
      const inlinesData = payload._inlines || payload.inlines;
      delete payload._inlines;
      delete payload.inlines;

      const repo = db.getRepository(model.name);
      const record = await repo.create(payload);

      if (inlinesData) {
        await syncInlines(record, inlinesData, model);
      }

      if (registry && typeof registry.runHooks === 'function') {
        await registry.runHooks('afterCreate', { model: model.name, record, data: req.body, req, user: req.session?.adminUser, db });
      }

      res.status(201).json({ data: sanitizeForOutput(record, model) });
    } catch (error) {
      const fields = extractValidationErrors(error);
      const statusCode = error.statusCode || error.status || (error.name === 'ForbiddenError' ? 403 : error.name === 'NotFoundError' ? 404 : 400);
      res.status(statusCode).json({ error: error.message, ...(fields ? { fields } : {}) });
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

      if (model.admin.readOnly === true) {
        return res.status(403).json({ error: `Model "${model.name}" is read-only` });
      }
      if (model.admin.permissions?.edit === false) {
        return res.status(403).json({ error: `Editing is disabled for model "${model.name}"` });
      }

      mutateRichTextFieldsInBody(req.body, model);

      if (registry && typeof registry.runHooks === 'function') {
        await registry.runHooks('beforeUpdate', { model: model.name, id, data: req.body, req, user: req.session?.adminUser, db });
      }

      // Validate rich-text fields (only if field is being updated)
      for (const [colName, colMeta] of model.columns) {
        if (colName in req.body && model.admin.customFields?.[colName]?.type === 'rich-text' && !colMeta.nullable) {
          const value = req.body[colName];
          if (isRichTextEmpty(value)) {
            return res.status(400).json({ 
              error: `Field "${colName}" is required`,
              fields: { [colName]: `Field "${colName}" is required` },
            });
          }
        }
      }

      const payload = { ...req.body };
      const inlinesData = payload._inlines || payload.inlines;
      delete payload._inlines;
      delete payload.inlines;

      const repo = db.getRepository(model.name);
      const record = await repo.update(id, payload);

      if (!record) {
        return res.status(404).json({ error: 'Record not found' });
      }

      if (inlinesData) {
        await syncInlines(record, inlinesData, model);
      }

      if (registry && typeof registry.runHooks === 'function') {
        await registry.runHooks('afterUpdate', { model: model.name, id, record, data: req.body, req, user: req.session?.adminUser, db });
      }

      res.json({ data: sanitizeForOutput(record, model) });
    } catch (error) {
      const fields = extractValidationErrors(error);
      const statusCode = error.statusCode || error.status || (error.name === 'ForbiddenError' ? 403 : error.name === 'NotFoundError' ? 404 : 400);
      res.status(statusCode).json({ error: error.message, ...(fields ? { fields } : {}) });
    }
  }

  /**
   * Delete record (soft delete if model has softDelete scope)
   */
  async function deleteRecordHandler(req, res) {
    try {
      const { model: modelName, id } = req.params;
      const model = getModelFromDb(modelName);

      if (!model || !model.admin || model.admin.enabled !== true) {
        return res.status(404).json({ error: 'Model not found or not enabled' });
      }

      if (model.admin.readOnly === true) {
        return res.status(403).json({ error: `Model "${model.name}" is read-only` });
      }
      if (model.admin.permissions?.delete === false) {
        return res.status(403).json({ error: `Deletion is disabled for model "${model.name}"` });
      }

      if (registry && typeof registry.runHooks === 'function') {
        await registry.runHooks('beforeDelete', { model: model.name, id, req, user: req.session?.adminUser, db });
      }

      const repo = db.getRepository(model.name);
      const deleted = await repo.delete(id);

      if (!deleted) {
        return res.status(404).json({ error: 'Record not found' });
      }

      if (registry && typeof registry.runHooks === 'function') {
        await registry.runHooks('afterDelete', { model: model.name, id, req, user: req.session?.adminUser, db });
      }

      res.json({ success: true });
    } catch (error) {
      const statusCode = error.statusCode || error.status || (error.name === 'ForbiddenError' ? 403 : 500);
      res.status(statusCode).json({ error: error.message });
    }
  }

  /**
   * Restore soft-deleted record
   */
  async function restoreRecordHandler(req, res) {
    try {
      const { model: modelName, id } = req.params;
      const model = getModelFromDb(modelName);

      if (!model || !model.admin || model.admin.enabled !== true) {
        return res.status(404).json({ error: 'Model not found or not enabled' });
      }

      if (!model.scopes?.softDelete) {
        return res.status(400).json({ error: 'Model does not support soft delete' });
      }

      if (registry && typeof registry.runHooks === 'function') {
        await registry.runHooks('beforeRestore', { model: model.name, id, req, user: req.session?.adminUser, db });
      }

      const repo = db.getRepository(model.name);
      const record = await repo.restore(id);

      if (!record) {
        return res.status(404).json({ error: 'Record not found in trash' });
      }

      if (registry && typeof registry.runHooks === 'function') {
        await registry.runHooks('afterRestore', { model: model.name, id, record, req, user: req.session?.adminUser, db });
      }

      res.json({ success: true, data: sanitizeForOutput(record, model) });
    } catch (error) {
      const statusCode = error.statusCode || error.status || (error.name === 'ForbiddenError' ? 403 : 500);
      res.status(statusCode).json({ error: error.message });
    }
  }

  /**
   * Get relation data (with search, pagination, projection, and selected item inclusion)
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

      const rawRelatedModel = typeof relation.model === 'function' ? relation.model() : relation.model;
      const relatedModel = typeof rawRelatedModel === 'string' ? getModelFromDb(rawRelatedModel) : rawRelatedModel;
      if (!relatedModel) {
        return res.status(404).json({ error: 'Related model not found' });
      }
      const relatedRepo = db.getRepository(relatedModel.name);

      const relationConfig = model.admin?.relations?.[relationName] || {};
      let displayField = relationConfig.displayField || relatedModel.admin?.displayField || null;
      const primaryKey = relatedModel.primaryKey || 'id';
      const searchFields = relationConfig.searchFields || relatedModel.admin?.searchFields || null;

      if (!displayField && relatedModel.columns) {
        const candidate = ['name', 'title', 'label', 'username', 'email', 'slug'].find(c => relatedModel.columns.has(c));
        if (candidate) {
          displayField = candidate;
        }
      }

      const search = (req.query.search || req.query.q || '').trim();
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const defaultLimit = typeof relationConfig.limit === 'number' && relationConfig.limit > 0 ? relationConfig.limit : 50;
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || req.query.perPage, 10) || defaultLimit));
      const isAll = req.query.all === 'true' || req.query.all === true;
      const selectedId = req.query.selected || req.query.includeId || null;

      let selectColumns = null;
      if (displayField && relatedModel.columns) {
        const cols = new Set([primaryKey]);
        if (relatedModel.columns.has(displayField)) {
          cols.add(displayField);
        }
        if (Array.isArray(searchFields)) {
          for (const sf of searchFields) {
            if (relatedModel.columns.has(sf)) cols.add(sf);
          }
        }
        selectColumns = Array.from(cols);
      }

      let query = relatedRepo.query();
      let countQuery = relatedRepo.query();

      // Apply search filter if provided
      if (search && relatedModel.columns) {
        const searchTerm = `%${search}%`;
        let targetSearchCols = [];
        if (Array.isArray(searchFields) && searchFields.length > 0) {
          targetSearchCols = searchFields.filter(col => relatedModel.columns.has(col));
        } else if (displayField && relatedModel.columns.has(displayField)) {
          targetSearchCols = [displayField];
        } else {
          targetSearchCols = Array.from(relatedModel.columns.entries())
            .filter(([_, meta]) => meta.type === 'string' || meta.type === 'text')
            .map(([name]) => name);
        }

        if (targetSearchCols.length > 0) {
          const filterFn = function() {
            for (let i = 0; i < targetSearchCols.length; i++) {
              if (i === 0) {
                this.where(targetSearchCols[i], 'like', searchTerm);
              } else {
                this.orWhere(targetSearchCols[i], 'like', searchTerm);
              }
            }
          };
          query = query.where(filterFn);
          countQuery = countQuery.where(filterFn);
        }
      }

      // Count total matches
      const total = await countQuery.count();

      // Ordering
      if (displayField && relatedModel.columns?.has(displayField)) {
        query = query.orderBy(displayField, 'asc');
      } else {
        query = query.orderBy(primaryKey, 'desc');
      }

      // Pagination
      if (isAll) {
        query = query.limit(1000);
      } else {
        const offset = (page - 1) * limit;
        query = query.offset(offset).limit(limit);
      }

      if (selectColumns && selectColumns.length > 0) {
        query = query.select(selectColumns);
      }

      let records = await query.list();

      // If selectedId was requested and is not present in the current paginated list, include it
      if (selectedId !== null && selectedId !== undefined && selectedId !== '') {
        const hasSelected = records.some(r => String(r[primaryKey]) === String(selectedId));
        if (!hasSelected) {
          try {
            const findOpts = selectColumns && selectColumns.length > 0 ? { select: selectColumns } : {};
            const selectedRecord = await relatedRepo.findById(selectedId, findOpts);
            if (selectedRecord) {
              records = [selectedRecord, ...records];
            }
          } catch (_) {
            // Ignore if invalid ID format
          }
        }
      }

      const totalPages = isAll ? 1 : Math.ceil(total / limit);
      const hasMore = isAll ? false : (page * limit < total);

      res.json({
        data: sanitizeForOutput(records, relatedModel),
        displayField,
        primaryKey,
        pagination: {
          page,
          limit: isAll ? total : limit,
          total,
          totalPages,
          hasMore,
        },
      });
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



  /**
   * List inline records for a specific parent record (Django Inlines-inspired)
   */
  async function inlineListHandler(req, res) {
    try {
      const { model: modelName, id, inlineModel: inlineModelName } = req.params;
      const model = getModelFromDb(modelName);
      const inlineModel = getModelFromDb(inlineModelName);

      if (!model || !inlineModel) {
        return res.status(404).json({ error: 'Model or inline model not found' });
      }

      const inlineDef = (model.admin?.inlines || []).find(i => i.model === inlineModelName) || {};
      const fk = inlineDef.foreignKey || `${model.name.toLowerCase()}_id`;

      const repo = db.getRepository(inlineModel.name);
      const records = await repo.query().where(fk, id).find();

      res.json({ data: sanitizeForOutput(records, inlineModel) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Create inline record for a specific parent record (Django Inlines-inspired)
   */
  async function inlineCreateHandler(req, res) {
    try {
      const { model: modelName, id, inlineModel: inlineModelName } = req.params;
      const model = getModelFromDb(modelName);
      const inlineModel = getModelFromDb(inlineModelName);

      if (!model || !inlineModel) {
        return res.status(404).json({ error: 'Model or inline model not found' });
      }

      const inlineDef = (model.admin?.inlines || []).find(i => i.model === inlineModelName) || {};
      const fk = inlineDef.foreignKey || `${model.name.toLowerCase()}_id`;

      const repo = db.getRepository(inlineModel.name);
      const payload = { ...req.body, [fk]: id };
      const record = await repo.create(payload);

      res.status(201).json({ data: sanitizeForOutput(record, inlineModel) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Update inline record
   */
  async function inlineUpdateHandler(req, res) {
    try {
      const { inlineModel: inlineModelName, inlineId } = req.params;
      const inlineModel = getModelFromDb(inlineModelName);

      if (!inlineModel) {
        return res.status(404).json({ error: 'Inline model not found' });
      }

      const repo = db.getRepository(inlineModel.name);
      const record = await repo.update(inlineId, req.body);

      if (!record) {
        return res.status(404).json({ error: 'Inline record not found' });
      }

      res.json({ data: sanitizeForOutput(record, inlineModel) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Delete inline record
   */
  async function inlineDeleteHandler(req, res) {
    try {
      const { inlineModel: inlineModelName, inlineId } = req.params;
      const inlineModel = getModelFromDb(inlineModelName);

      if (!inlineModel) {
        return res.status(404).json({ error: 'Inline model not found' });
      }

      const repo = db.getRepository(inlineModel.name);
      await repo.delete(inlineId);

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Quick-edit a single record inline without full form submission (Django list_editable-inspired)
   */
  async function quickEditHandler(req, res) {
    try {
      const { model: modelName, id } = req.params;
      const model = getModelFromDb(modelName);

      if (!model || !model.admin || model.admin.enabled !== true) {
        return res.status(404).json({ error: 'Model not found or not enabled' });
      }
      if (model.admin.readOnly === true || model.admin.permissions?.edit === false) {
        return res.status(403).json({ error: `Editing is disabled for model "${model.name}"` });
      }

      const allowedCols = Array.isArray(model.admin.listEditable) ? model.admin.listEditable : null;
      const updates = {};
      for (const [k, v] of Object.entries(req.body)) {
        if (allowedCols && !allowedCols.includes(k)) {
          return res.status(400).json({ error: `Column "${k}" is not list-editable on model "${model.name}"` });
        }
        if (hasColumn(model, k)) {
          updates[k] = v;
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid editable fields provided' });
      }

      const repo = db.getRepository(model.name);
      const record = await repo.update(id, updates);
      if (!record) {
        return res.status(404).json({ error: 'Record not found' });
      }

      res.json({ success: true, data: sanitizeForOutput(record, model) });
    } catch (error) {
      const fields = extractValidationErrors(error);
      const statusCode = error.statusCode || error.status || 400;
      res.status(statusCode).json({ error: error.message, ...(fields ? { fields } : {}) });
    }
  }

  /**
   * Batch edit multiple records inline (Django list_editable bulk save)
   */
  async function batchEditHandler(req, res) {
    try {
      const { model: modelName } = req.params;
      const model = getModelFromDb(modelName);

      if (!model || !model.admin || model.admin.enabled !== true) {
        return res.status(404).json({ error: 'Model not found or not enabled' });
      }
      if (model.admin.readOnly === true || model.admin.permissions?.edit === false) {
        return res.status(403).json({ error: `Editing is disabled for model "${model.name}"` });
      }

      const updates = req.body.updates;
      if (!Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ error: 'Array of updates is required' });
      }

      const allowedCols = Array.isArray(model.admin.listEditable) ? model.admin.listEditable : null;
      const repo = db.getRepository(model.name);
      const results = [];

      for (const item of updates) {
        const { id, changes } = item;
        if (!id || !changes || typeof changes !== 'object') continue;

        const cleanChanges = {};
        for (const [k, v] of Object.entries(changes)) {
          if (allowedCols && !allowedCols.includes(k)) continue;
          if (hasColumn(model, k)) {
            cleanChanges[k] = v;
          }
        }

        if (Object.keys(cleanChanges).length > 0) {
          const updated = await repo.update(id, cleanChanges);
          if (updated) {
            results.push(sanitizeForOutput(updated, model));
          }
        }
      }

      res.json({ success: true, count: results.length, records: results });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Date hierarchy drilldown aggregation (Django date_hierarchy-inspired)
   */
  async function dateHierarchyHandler(req, res) {
    try {
      const { model: modelName } = req.params;
      const model = getModelFromDb(modelName);

      if (!model || !model.admin || model.admin.enabled !== true) {
        return res.status(404).json({ error: 'Model not found or not enabled' });
      }

      const dateField = req.query.field || model.admin.dateHierarchy || 'created_at';
      if (!hasColumn(model, dateField)) {
        return res.status(400).json({ error: `Date field "${dateField}" does not exist on model "${model.name}"` });
      }

      const year = req.query.year ? parseInt(req.query.year) : null;
      const month = req.query.month ? parseInt(req.query.month) : null;

      const repo = db.getRepository(model.name);
      let query = repo.query().whereNotNull(dateField);

      // If drilldown to days
      if (year && month) {
        const prefix = `${year}-${String(month).padStart(2, '0')}`;
        query = query.where(dateField, 'like', `${prefix}%`);
        const rows = await query.select(dateField).find();

        const counts = {};
        for (const r of rows) {
          const val = String(r[dateField]);
          const dayMatch = val.match(/^\d{4}-\d{2}-(\d{2})/);
          if (dayMatch) {
            const d = parseInt(dayMatch[1]);
            counts[d] = (counts[d] || 0) + 1;
          }
        }

        const days = Object.entries(counts)
          .map(([d, count]) => ({ day: parseInt(d), count }))
          .sort((a, b) => a.day - b.day);

        return res.json({ level: 'days', year, month, items: days });
      }

      // If drilldown to months
      if (year) {
        query = query.where(dateField, 'like', `${year}%`);
        const rows = await query.select(dateField).find();

        const counts = {};
        for (const r of rows) {
          const val = String(r[dateField]);
          const match = val.match(/^\d{4}-(\d{2})/);
          if (match) {
            const m = parseInt(match[1]);
            counts[m] = (counts[m] || 0) + 1;
          }
        }

        const months = Object.entries(counts)
          .map(([m, count]) => ({ month: parseInt(m), count }))
          .sort((a, b) => a.month - b.month);

        return res.json({ level: 'months', year, items: months });
      }

      // Top level: drilldown by year
      const rows = await query.select(dateField).find();
      const counts = {};
      for (const r of rows) {
        const val = String(r[dateField]);
        const match = val.match(/^(\d{4})/);
        if (match) {
          const y = parseInt(match[1]);
          counts[y] = (counts[y] || 0) + 1;
        }
      }

      const years = Object.entries(counts)
        .map(([y, count]) => ({ year: parseInt(y), count }))
        .sort((a, b) => b.year - a.year);

      return res.json({ level: 'years', field: dateField, items: years });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Filter facets aggregation for list_filter columns (Django list_filter-inspired)
   */
  async function filterFacetsHandler(req, res) {
    try {
      const { model: modelName } = req.params;
      const model = getModelFromDb(modelName);

      if (!model || !model.admin || model.admin.enabled !== true) {
        return res.status(404).json({ error: 'Model not found or not enabled' });
      }

      const requestedFields = req.query.fields
        ? req.query.fields.split(',').map(s => s.trim())
        : (model.admin.listFilter || model.admin.filterable || []);

      const repo = db.getRepository(model.name);
      const facets = {};

      for (const field of requestedFields) {
        if (!hasColumn(model, field)) continue;
        const rows = await repo.query().whereNotNull(field).select(field).find();
        const counts = {};
        for (const r of rows) {
          const val = r[field];
          const key = val === null || val === undefined ? '' : String(val);
          counts[key] = (counts[key] || 0) + 1;
        }
        facets[field] = Object.entries(counts).map(([value, count]) => ({
          value,
          count,
        })).sort((a, b) => b.count - a.count);
      }

      res.json({ facets });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Execute model action or bulk action (Django Actions-inspired)
   */
  async function modelActionHandler(req, res) {
    try {
      const { model: modelName, actionId } = req.params;
      const model = getModelFromDb(modelName);

      if (!model || !model.admin || model.admin.enabled !== true) {
        return res.status(404).json({ error: 'Model not found or not enabled' });
      }

      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Array of record ids is required' });
      }

      const modelActions = Array.isArray(model.admin.actions) ? model.admin.actions : [];
      const modelBulkActions = Array.isArray(model.admin.bulkActions) ? model.admin.bulkActions : [];
      const action = modelActions.find(a => a.id === actionId) || modelBulkActions.find(a => a.id === actionId);

      const repo = db.getRepository(model.name);

      if (action && typeof action.handler === 'function') {
        const result = await action.handler({
          ids,
          model,
          repo,
          db,
          req,
          user: req.session?.adminUser,
        });
        return res.json({ success: true, ...(typeof result === 'object' ? result : { result }) });
      }

      if (registry && typeof registry.getBulkAction === 'function') {
        const bulkAction = registry.getBulkAction(actionId);
        if (bulkAction && typeof bulkAction.handler === 'function') {
          const records = await repo.query().whereIn(model.primaryKey || 'id', ids).find();
          const result = await bulkAction.handler(records, model.name, { db, req, user: req.session?.adminUser });
          return res.json({ success: true, ...(typeof result === 'object' ? result : { result }) });
        }
      }

      return res.status(404).json({ error: `Action "${actionId}" not found for model "${model.name}"` });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  return {
    checkHandler,
    setupHandler,
    loginHandler,
    logoutHandler,
    meHandler,
    updateProfileHandler,
    modelsHandler,
    modelHandler,
    recordsListHandler,
    recordHandler,
    createRecordHandler,
    updateRecordHandler,
    deleteRecordHandler,
    restoreRecordHandler,
    relationHandler,
    queryHandler,
    resetHandler,
    rateLimiter,
    resetLoginAttempts: (ip) => rateLimiter.reset(ip),
    inlineListHandler,
    inlineCreateHandler,
    inlineUpdateHandler,
    inlineDeleteHandler,
    quickEditHandler,
    batchEditHandler,
    dateHierarchyHandler,
    filterFacetsHandler,
    modelActionHandler,
  };
}

module.exports = {
  createApiHandlers,
  LoginRateLimiter,
};

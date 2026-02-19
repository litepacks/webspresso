/**
 * Admin Panel API Extensions
 * API handlers for registry-based extensions
 * @module plugins/admin-panel/core/api-extensions
 */

/**
 * Build query with filters applied
 * @param {Object} repo - Repository instance
 * @param {Object} filters - Filter object from frontend
 * @returns {Object} Query builder with filters applied
 */
function buildFilteredQuery(repo, filters) {
  let query = repo.query();
  
  if (!filters || Object.keys(filters).length === 0) {
    return query;
  }
  
  for (const [column, filter] of Object.entries(filters)) {
    if (!filter || (filter.value === '' && !filter.from && !filter.to)) continue;
    
    const op = filter.op || 'contains';
    
    switch (op) {
      case 'contains':
        query = query.where(column, 'like', `%${filter.value}%`);
        break;
      case 'equals':
        query = query.where(column, '=', filter.value);
        break;
      case 'starts_with':
        query = query.where(column, 'like', `${filter.value}%`);
        break;
      case 'ends_with':
        query = query.where(column, 'like', `%${filter.value}`);
        break;
      case 'eq':
        query = query.where(column, '=', filter.value);
        break;
      case 'gt':
        query = query.where(column, '>', filter.value);
        break;
      case 'gte':
        query = query.where(column, '>=', filter.value);
        break;
      case 'lt':
        query = query.where(column, '<', filter.value);
        break;
      case 'lte':
        query = query.where(column, '<=', filter.value);
        break;
      case 'between':
        if (filter.from) query = query.where(column, '>=', filter.from);
        if (filter.to) query = query.where(column, '<=', filter.to);
        break;
      case 'in':
        if (Array.isArray(filter.value) && filter.value.length > 0) {
          query = query.whereIn(column, filter.value);
        }
        break;
    }
  }
  
  return query;
}

/**
 * Get all record IDs matching filters (for selectAll mode)
 * @param {Object} repo - Repository instance  
 * @param {Object} filters - Filter object
 * @param {string} primaryKey - Primary key column name
 * @returns {Promise<Array>} Array of IDs
 */
async function getAllMatchingIds(repo, filters, primaryKey = 'id') {
  const query = buildFilteredQuery(repo, filters);
  const records = await query.select(primaryKey).list();
  return records.map(r => r[primaryKey]);
}

/**
 * Create extension API handlers
 * @param {Object} options - Options
 * @param {Object} options.registry - Admin registry instance
 * @param {Object} options.db - Database instance
 * @param {Object} options.auth - Auth instance (optional)
 * @returns {Object} API handlers
 */
function createExtensionApiHandlers(options) {
  const { registry, db, auth } = options;

  /**
   * Get admin config (pages, widgets, menu, settings)
   */
  function configHandler(req, res) {
    try {
      const config = registry.toClientConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Load widget data
   */
  async function widgetDataHandler(req, res) {
    try {
      const { widgetId } = req.params;
      const widget = registry.widgets.get(widgetId);

      if (!widget) {
        return res.status(404).json({ error: 'Widget not found' });
      }

      if (!widget.dataLoader) {
        return res.json({ data: null });
      }

      const data = await widget.dataLoader({ db, req, user: req.session?.adminUser });
      res.json({ data });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Execute model action
   */
  async function actionHandler(req, res) {
    try {
      const { actionId, model: modelName, id } = req.params;
      const action = registry.actions.get(actionId);

      if (!action) {
        return res.status(404).json({ error: 'Action not found' });
      }

      // Check if action applies to model
      if (action.models !== '*') {
        const models = Array.isArray(action.models) ? action.models : [action.models];
        if (!models.includes(modelName)) {
          return res.status(403).json({ error: 'Action not available for this model' });
        }
      }

      // Get record
      const repo = db.getRepository(modelName);
      const record = await repo.findById(id);

      if (!record) {
        return res.status(404).json({ error: 'Record not found' });
      }

      // Check visibility
      if (action.visible && !action.visible(record, modelName)) {
        return res.status(403).json({ error: 'Action not available for this record' });
      }

      // Execute action
      const result = await action.handler(record, modelName, {
        db,
        req,
        user: req.session?.adminUser,
        body: req.body,
      });

      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Execute bulk action
   * Supports both specific IDs and selectAll mode with filters
   */
  async function bulkActionHandler(req, res) {
    try {
      const { actionId, model: modelName } = req.params;
      const { ids, selectAll, filters } = req.body;

      const action = registry.bulkActions.get(actionId);

      if (!action) {
        return res.status(404).json({ error: 'Bulk action not found' });
      }

      // Check if action applies to model
      if (action.models !== '*') {
        const models = Array.isArray(action.models) ? action.models : [action.models];
        if (!models.includes(modelName)) {
          return res.status(403).json({ error: 'Action not available for this model' });
        }
      }

      // Get repository
      const repo = db.getRepository(modelName);
      
      // Determine IDs to process
      let recordIds;
      if (selectAll) {
        // Get all matching record IDs based on filters
        const { getModel } = require('../../../core/orm/model');
        const model = db.getModel ? db.getModel(modelName) : getModel(modelName);
        const primaryKey = model?.primaryKey || 'id';
        recordIds = await getAllMatchingIds(repo, filters, primaryKey);
      } else {
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
          return res.status(400).json({ error: 'No records selected' });
        }
        recordIds = ids;
      }

      if (recordIds.length === 0) {
        return res.status(400).json({ error: 'No records match the criteria' });
      }

      // Get records
      const records = [];
      for (const id of recordIds) {
        const record = await repo.findById(id);
        if (record) {
          records.push(record);
        }
      }

      if (records.length === 0) {
        return res.status(404).json({ error: 'No valid records found' });
      }

      // Execute action
      const result = await action.handler(records, modelName, {
        db,
        req,
        user: req.session?.adminUser,
        body: req.body,
      });

      res.json({ success: true, result, affected: records.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Bulk update field values (for enum/boolean fields)
   * Supports both specific IDs and selectAll mode with filters
   */
  async function bulkUpdateFieldHandler(req, res) {
    try {
      const { model: modelName } = req.params;
      const { ids, selectAll, filters, field, value } = req.body;

      if (!field) {
        return res.status(400).json({ error: 'Field name is required' });
      }

      const { getModel } = require('../../../core/orm/model');
      const model = db.getModel ? db.getModel(modelName) : getModel(modelName);

      if (!model || !model.admin?.enabled) {
        return res.status(404).json({ error: 'Model not found or not enabled' });
      }

      // Get field metadata - model.columns is Map<string, ColumnMeta>
      const columnMeta = model.columns.get(field);
      if (!columnMeta) {
        return res.status(400).json({ error: `Field "${field}" not found in model` });
      }

      // Validate field type - only allow enum and boolean
      const enumValues = columnMeta.enumValues || columnMeta.enum;
      const isEnum = enumValues && Array.isArray(enumValues);
      const isBoolean = columnMeta.type === 'boolean';

      if (!isEnum && !isBoolean) {
        return res.status(400).json({ error: `Field "${field}" is not an enum or boolean type` });
      }

      // Validate value for enum fields
      if (isEnum && !enumValues.includes(value)) {
        return res.status(400).json({ error: `Invalid value "${value}" for enum field "${field}"` });
      }

      // Coerce boolean value
      let updateValue = value;
      if (isBoolean) {
        updateValue = value === true || value === 'true' || value === 1 || value === '1';
      }

      // Get repository and determine IDs
      const repo = db.getRepository(modelName);
      let recordIds;
      
      if (selectAll) {
        // Get all matching record IDs based on filters
        const primaryKey = model.primaryKey || 'id';
        recordIds = await getAllMatchingIds(repo, filters, primaryKey);
      } else {
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
          return res.status(400).json({ error: 'No records selected' });
        }
        recordIds = ids;
      }

      if (recordIds.length === 0) {
        return res.status(400).json({ error: 'No records match the criteria' });
      }

      // Perform bulk update
      let updated = 0;

      for (const id of recordIds) {
        try {
          await repo.update(id, { [field]: updateValue });
          updated++;
        } catch (e) {
          console.error(`Failed to update record ${id}:`, e.message);
        }
      }

      res.json({
        success: true,
        result: {
          message: `${updated} of ${recordIds.length} records updated`,
          updated,
          field,
          value: updateValue,
        },
        affected: updated,
      });
    } catch (error) {
      console.error('Bulk update field error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get bulk-updatable fields for a model (enum and boolean fields)
   */
  function bulkFieldsHandler(req, res) {
    try {
      const { model: modelName } = req.params;

      const { getModel } = require('../../../core/orm/model');
      const model = db.getModel ? db.getModel(modelName) : getModel(modelName);

      if (!model || !model.admin?.enabled) {
        return res.status(404).json({ error: 'Model not found or not enabled' });
      }

      const bulkFields = [];

      // model.columns is a Map<string, ColumnMeta> - values are already metadata objects
      for (const [fieldName, columnMeta] of model.columns.entries()) {
        // Check for enum - schema uses 'enumValues' property
        const enumValues = columnMeta.enumValues || columnMeta.enum;
        const isEnum = enumValues && Array.isArray(enumValues);
        const isBoolean = columnMeta.type === 'boolean';

        if (isEnum) {
          bulkFields.push({
            name: fieldName,
            type: 'enum',
            label: columnMeta.label || fieldName,
            options: enumValues.map(v => ({ value: v, label: v })),
          });
        } else if (isBoolean) {
          bulkFields.push({
            name: fieldName,
            type: 'boolean',
            label: columnMeta.label || fieldName,
            options: [
              { value: true, label: 'True' },
              { value: false, label: 'False' },
            ],
          });
        }
      }

      res.json({ fields: bulkFields });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Dashboard stats - includes count, last updated, column count for each model
   */
  async function dashboardStatsHandler(req, res) {
    try {
      const stats = {};
      const { getAllModels } = require('../../../core/orm/model');
      
      // Get all admin-enabled models
      const allModels = db.getAllModels ? db.getAllModels() : Array.from(getAllModels().values());
      const modelList = Array.isArray(allModels) ? allModels : Array.from(allModels.values());

      for (const model of modelList) {
        if (model.admin?.enabled) {
          try {
            const repo = db.getRepository(model.name);
            const count = await repo.count();
            
            // Get column count
            const columnCount = model.columns ? model.columns.size : 0;
            
            // Get last created/updated record
            let lastCreated = null;
            let lastUpdated = null;
            
            // Try to get the most recently created record
            const createdAtCol = model.columns?.has('created_at') ? 'created_at' : 
                                 model.columns?.has('createdAt') ? 'createdAt' : null;
            const updatedAtCol = model.columns?.has('updated_at') ? 'updated_at' : 
                                 model.columns?.has('updatedAt') ? 'updatedAt' : null;
            
            if (createdAtCol) {
              try {
                const lastRecord = await repo.query()
                  .orderBy(createdAtCol, 'desc')
                  .first();
                if (lastRecord && lastRecord[createdAtCol]) {
                  lastCreated = lastRecord[createdAtCol];
                }
              } catch (e) {
                // Column might not exist or be queryable
              }
            }
            
            if (updatedAtCol) {
              try {
                const lastRecord = await repo.query()
                  .orderBy(updatedAtCol, 'desc')
                  .first();
                if (lastRecord && lastRecord[updatedAtCol]) {
                  lastUpdated = lastRecord[updatedAtCol];
                }
              } catch (e) {
                // Column might not exist or be queryable
              }
            }
            
            stats[model.name] = {
              name: model.name,
              label: model.admin.label || model.name,
              icon: model.admin.icon,
              count,
              columnCount,
              lastCreated,
              lastUpdated,
              table: model.table,
            };
          } catch (e) {
            stats[model.name] = { 
              name: model.name, 
              label: model.admin?.label || model.name,
              count: 0, 
              error: e.message 
            };
          }
        }
      }

      res.json({ stats });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get admin settings
   */
  function settingsGetHandler(req, res) {
    try {
      const settings = registry.settings || {};
      res.json({ settings });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Update admin settings
   */
  function settingsUpdateHandler(req, res) {
    try {
      const updates = req.body || {};
      
      // Merge with existing settings
      const currentSettings = registry.settings || {};
      const newSettings = { ...currentSettings, ...updates };
      
      // Update registry settings
      registry.configure({ settings: newSettings });
      
      res.json({ success: true, settings: registry.settings });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Export records (CSV/JSON)
   * Supports both GET (with ids in query) and POST (with ids in body)
   * Also supports selectAll mode with filters
   */
  async function exportHandler(req, res) {
    try {
      // Support both path param and query param for model name
      const modelName = req.params.model || req.query.model;
      const format = req.query.format || 'json';
      const { selectAll, filters } = req.body || {};
      
      // Support IDs from query string (GET) or body (POST)
      let idList = null;
      if (req.body?.ids && Array.isArray(req.body.ids)) {
        idList = req.body.ids;
      } else if (req.query.ids) {
        idList = req.query.ids.split(',');
      }
      
      if (!modelName) {
        return res.status(400).json({ error: 'Model name is required' });
      }
      
      const { getModel } = require('../../../core/orm/model');
      const model = db.getModel ? db.getModel(modelName) : getModel(modelName);

      if (!model || !model.admin?.enabled) {
        return res.status(404).json({ error: 'Model not found or not enabled' });
      }

      const repo = db.getRepository(model.name);
      let records;

      if (selectAll) {
        // Use filtered query to get all matching records
        const query = buildFilteredQuery(repo, filters);
        records = await query.list();
      } else if (idList && idList.length > 0) {
        // Fetch specific IDs
        records = [];
        for (const id of idList) {
          const record = await repo.findById(id);
          if (record) records.push(record);
        }
      } else {
        // Fetch all records
        records = await repo.findAll();
      }

      if (format === 'csv') {
        // CSV export
        const columns = Array.from(model.columns.keys());
        const header = columns.join(',');
        const rows = records.map(record => {
          return columns.map(col => {
            const val = record[col];
            if (val === null || val === undefined) return '';
            if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
              return `"${val.replace(/"/g, '""')}"`;
            }
            if (typeof val === 'object') {
              return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
            }
            return String(val);
          }).join(',');
        });

        const csvContent = [header, ...rows].join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${modelName}_export.csv"`);
        res.json({ data: csvContent, format: 'csv' });
      } else {
        // JSON export
        res.json({ data: records, model: modelName, exportedAt: new Date().toISOString() });
      }
    } catch (error) {
      console.error('Export error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Activity log (if enabled)
   */
  async function activityLogHandler(req, res) {
    try {
      const { page = 1, perPage = 50 } = req.query;
      
      // Check if activity_logs table exists
      const hasTable = await db.knex.schema.hasTable('admin_activity_logs');
      if (!hasTable) {
        return res.json({ data: [], pagination: { page: 1, perPage, total: 0, totalPages: 0 } });
      }

      const offset = (page - 1) * perPage;
      const total = await db.knex('admin_activity_logs').count('id as count').first();
      const logs = await db.knex('admin_activity_logs')
        .orderBy('created_at', 'desc')
        .limit(perPage)
        .offset(offset);

      res.json({
        data: logs,
        pagination: {
          page: parseInt(page),
          perPage: parseInt(perPage),
          total: total?.count || 0,
          totalPages: Math.ceil((total?.count || 0) / perPage),
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  return {
    configHandler,
    widgetDataHandler,
    actionHandler,
    bulkActionHandler,
    bulkUpdateFieldHandler,
    bulkFieldsHandler,
    dashboardStatsHandler,
    exportHandler,
    activityLogHandler,
    settingsGetHandler,
    settingsUpdateHandler,
  };
}

module.exports = {
  createExtensionApiHandlers,
};

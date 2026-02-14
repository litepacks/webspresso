/**
 * Admin Panel API Extensions
 * API handlers for registry-based extensions
 * @module plugins/admin-panel/core/api-extensions
 */

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
   */
  async function bulkActionHandler(req, res) {
    try {
      const { actionId, model: modelName } = req.params;
      const { ids } = req.body;

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'No records selected' });
      }

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

      // Get records
      const repo = db.getRepository(modelName);
      const records = [];
      for (const id of ids) {
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
   * Dashboard stats
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
            stats[model.name] = {
              name: model.name,
              label: model.admin.label || model.name,
              icon: model.admin.icon,
              count,
            };
          } catch (e) {
            stats[model.name] = { name: model.name, count: 0, error: e.message };
          }
        }
      }

      res.json({ stats });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Export records (CSV/JSON)
   */
  async function exportHandler(req, res) {
    try {
      const { model: modelName } = req.params;
      const { format = 'json', ids } = req.query;
      
      const { getModel } = require('../../../core/orm/model');
      const model = db.getModel ? db.getModel(modelName) : getModel(modelName);

      if (!model || !model.admin?.enabled) {
        return res.status(404).json({ error: 'Model not found or not enabled' });
      }

      const repo = db.getRepository(model.name);
      let records;

      // If specific IDs provided, fetch those
      if (ids) {
        const idList = ids.split(',');
        records = [];
        for (const id of idList) {
          const record = await repo.findById(id);
          if (record) records.push(record);
        }
      } else {
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
            if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
              return `"${val.replace(/"/g, '""')}"`;
            }
            return String(val);
          }).join(',');
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${modelName}_export.csv"`);
        res.send([header, ...rows].join('\n'));
      } else {
        // JSON export
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${modelName}_export.json"`);
        res.json({ data: records, model: modelName, exportedAt: new Date().toISOString() });
      }
    } catch (error) {
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
    dashboardStatsHandler,
    exportHandler,
    activityLogHandler,
  };
}

module.exports = {
  createExtensionApiHandlers,
};

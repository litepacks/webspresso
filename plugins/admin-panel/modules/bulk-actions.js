/**
 * Admin Panel - Bulk Actions Module
 * Default bulk actions and export functionality
 * @module plugins/admin-panel/modules/bulk-actions
 */

/**
 * Register default bulk actions
 * @param {Object} options - Options
 * @param {Object} options.registry - Admin registry
 * @param {Object} options.db - Database instance
 */
function registerDefaultBulkActions(options) {
  const { registry, db } = options;

  // Bulk restore (soft delete models only - use with trashed view)
  registry.registerBulkAction('bulk-restore', {
    label: 'Restore Selected',
    icon: 'check',
    color: 'green',
    models: '*',
    confirm: true,
    confirmMessage: 'Restore the selected records?',
    handler: async (records, modelName, { db }) => {
      const { getModel } = require('../../../core/orm/model');
      const model = db.getModel ? db.getModel(modelName) : getModel(modelName);
      if (!model?.scopes?.softDelete) {
        return { message: 'Model does not support restore', error: true };
      }
      const repo = db.getRepository(modelName);
      let restored = 0;
      for (const record of records) {
        try {
          const result = await repo.restore(record.id);
          if (result) restored++;
        } catch (e) {
          console.error(`Failed to restore record ${record.id}:`, e.message);
        }
      }
      return { message: `${restored} of ${records.length} records restored`, restored };
    },
  });

  // Bulk delete
  registry.registerBulkAction('bulk-delete', {
    label: 'Delete Selected',
    icon: 'trash',
    color: 'red',
    models: '*',
    confirm: true,
    confirmMessage: 'Are you sure you want to delete the selected records? This action cannot be undone.',
    handler: async (records, model, { db }) => {
      const repo = db.getRepository(model);
      let deleted = 0;
      
      for (const record of records) {
        try {
          await repo.delete(record.id);
          deleted++;
        } catch (e) {
          console.error(`Failed to delete record ${record.id}:`, e.message);
        }
      }
      
      return { 
        message: `${deleted} of ${records.length} records deleted`,
        deleted,
      };
    },
  });

  // Export as JSON
  registry.registerBulkAction('export-json', {
    label: 'Export as JSON',
    icon: 'download',
    color: 'blue',
    models: '*',
    confirm: false,
    handler: async (records, model, { req, db }) => {
      // Return download URL instead of directly downloading
      const ids = records.map(r => r.id).join(',');
      return {
        download: true,
        url: `/_admin/api/extensions/export/${model}?format=json&ids=${ids}`,
        filename: `${model}_export.json`,
      };
    },
  });

  // Export as CSV
  registry.registerBulkAction('export-csv', {
    label: 'Export as CSV',
    icon: 'download',
    color: 'green',
    models: '*',
    confirm: false,
    handler: async (records, model, { req, db }) => {
      const ids = records.map(r => r.id).join(',');
      return {
        download: true,
        url: `/_admin/api/extensions/export/${model}?format=csv&ids=${ids}`,
        filename: `${model}_export.csv`,
      };
    },
  });
}

/**
 * Register model-specific bulk actions
 * @param {string} modelName - Model name
 * @param {string} field - Field to update
 * @param {*} value - Value to set
 * @param {Object} options - Action options
 */
function createFieldUpdateBulkAction(modelName, field, value, options = {}) {
  const {
    id = `bulk-${field}-${value}`,
    label = `Set ${field} to ${value}`,
    icon = 'edit',
    color = 'gray',
    confirm = true,
    confirmMessage = `Are you sure you want to update ${field} for the selected records?`,
  } = options;

  return {
    id,
    label,
    icon,
    color,
    models: modelName,
    confirm,
    confirmMessage,
    handler: async (records, model, { db }) => {
      const repo = db.getRepository(model);
      let updated = 0;

      for (const record of records) {
        try {
          await repo.update(record.id, { [field]: value });
          updated++;
        } catch (e) {
          console.error(`Failed to update record ${record.id}:`, e.message);
        }
      }

      return {
        message: `${updated} of ${records.length} records updated`,
        updated,
      };
    },
  };
}

/**
 * Generate bulk actions UI component (Mithril.js)
 */
function generateBulkActionsComponent() {
  return `
// Bulk Actions Bar Component
const BulkActionsBar = {
  view(vnode) {
    const { selectedCount, actions, onAction, onClearSelection } = vnode.attrs;
    
    if (selectedCount === 0) return null;

    return m('div.fixed.bottom-0.left-0.right-0.bg-white.border-t.shadow-lg.p-4.z-50', [
      m('div.max-w-7xl.mx-auto.flex.items-center.justify-between', [
        m('div.flex.items-center.gap-4', [
          m('span.text-sm.font-medium.text-gray-700', 
            selectedCount + ' record' + (selectedCount !== 1 ? 's' : '') + ' selected'
          ),
          m('button.text-sm.text-gray-500.hover:text-gray-700.underline', {
            onclick: onClearSelection,
          }, 'Clear selection'),
        ]),
        m('div.flex.items-center.gap-2', 
          actions.map(action => 
            m('button.inline-flex.items-center.gap-1.px-3.py-1.5.text-sm.font-medium.rounded.transition-colors', {
              class: action.color === 'red' 
                ? 'bg-red-100 text-red-700 hover:bg-red-200'
                : action.color === 'green'
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : action.color === 'blue'
                    ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
              onclick: () => onAction(action),
            }, [
              action.icon && m(Icon, { name: action.icon, class: 'w-4 h-4' }),
              action.label,
            ])
          )
        ),
      ]),
    ]);
  },
};

// Confirmation Modal Component
const ConfirmModal = {
  view(vnode) {
    const { title, message, onConfirm, onCancel, confirmLabel = 'Confirm', confirmColor = 'red' } = vnode.attrs;

    return m('div.fixed.inset-0.bg-black.bg-opacity-50.flex.items-center.justify-center.z-50', {
      onclick: (e) => {
        if (e.target === e.currentTarget) onCancel();
      },
    }, [
      m('div.bg-white.rounded-lg.shadow-xl.max-w-md.w-full.mx-4', [
        m('div.p-6', [
          m('h3.text-lg.font-medium.text-gray-900', title || 'Confirm Action'),
          m('p.mt-2.text-sm.text-gray-500', message),
        ]),
        m('div.bg-gray-50.px-6.py-4.flex.justify-end.gap-3.rounded-b-lg', [
          m('button.px-4.py-2.text-sm.font-medium.text-gray-700.bg-white.border.border-gray-300.rounded.hover:bg-gray-50', {
            onclick: onCancel,
          }, 'Cancel'),
          m('button.px-4.py-2.text-sm.font-medium.text-white.rounded', {
            class: confirmColor === 'red' 
              ? 'bg-red-600 hover:bg-red-700'
              : confirmColor === 'green'
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-blue-600 hover:bg-blue-700',
            onclick: onConfirm,
          }, confirmLabel),
        ]),
      ]),
    ]);
  },
};

// Bulk action execution helper
async function executeBulkAction(action, selectedIds, modelName) {
  try {
    const result = await api.post('/extensions/bulk-actions/' + action.id + '/' + modelName, {
      ids: selectedIds,
    });

    if (result.result?.download) {
      // Trigger download
      const link = document.createElement('a');
      link.href = window.__ADMIN_PATH__ + result.result.url;
      link.download = result.result.filename || 'export';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return { success: true, message: 'Download started' };
    }

    return result;
  } catch (error) {
    throw error;
  }
}
`;
}

module.exports = {
  registerDefaultBulkActions,
  createFieldUpdateBulkAction,
  generateBulkActionsComponent,
};

/**
 * Admin Panel - Dashboard Module
 * Dashboard page and widget system
 * @module plugins/admin-panel/modules/dashboard
 */

/**
 * Register default dashboard widgets
 * @param {Object} options - Options
 * @param {Object} options.registry - Admin registry
 * @param {Object} options.db - Database instance
 */
function registerDashboardWidgets(options) {
  const { registry, db } = options;

  // Model stats widget (shows all admin-enabled model counts with extended info)
  registry.registerWidget('model-stats', {
    title: 'Overview',
    size: 'full',
    order: 0,
    dataLoader: async ({ db }) => {
      const { getAllModels } = require('../../../core/orm/model');
      const stats = [];
      
      const allModels = db.getAllModels ? db.getAllModels() : Array.from(getAllModels().values());
      const modelList = Array.isArray(allModels) ? allModels : Array.from(allModels.values());

      for (const model of modelList) {
        if (model.admin?.enabled) {
          try {
            const repo = db.getRepository(model.name);
            const count = await repo.count();
            
            // Get column count
            const columnCount = model.columns ? model.columns.size : 0;
            
            // Get last updated/created timestamp
            let lastCreated = null;
            let lastUpdated = null;
            
            const createdAtCol = model.columns?.has('created_at') ? 'created_at' : 
                                 model.columns?.has('createdAt') ? 'createdAt' : null;
            const updatedAtCol = model.columns?.has('updated_at') ? 'updated_at' : 
                                 model.columns?.has('updatedAt') ? 'updatedAt' : null;
            
            if (createdAtCol) {
              try {
                const lastRecord = await repo.query().orderBy(createdAtCol, 'desc').first();
                if (lastRecord && lastRecord[createdAtCol]) {
                  lastCreated = lastRecord[createdAtCol];
                }
              } catch (e) { /* ignore */ }
            }
            
            if (updatedAtCol) {
              try {
                const lastRecord = await repo.query().orderBy(updatedAtCol, 'desc').first();
                if (lastRecord && lastRecord[updatedAtCol]) {
                  lastUpdated = lastRecord[updatedAtCol];
                }
              } catch (e) { /* ignore */ }
            }
            
            stats.push({
              name: model.name,
              label: model.admin.label || model.name,
              icon: model.admin.icon,
              count,
              columnCount,
              table: model.table,
              lastCreated,
              lastUpdated,
            });
          } catch (e) {
            stats.push({
              name: model.name,
              label: model.admin.label || model.name,
              icon: model.admin.icon,
              count: 0,
              error: e.message,
            });
          }
        }
      }

      return stats;
    },
  });

  // Recent activity widget
  registry.registerWidget('recent-activity', {
    title: 'Recent Activity',
    size: 'lg',
    order: 20,
    dataLoader: async ({ db }) => {
      try {
        const hasTable = await db.knex.schema.hasTable('admin_activity_logs');
        if (!hasTable) {
          return { enabled: false, activities: [] };
        }

        const activities = await db.knex('admin_activity_logs')
          .orderBy('created_at', 'desc')
          .limit(10);

        return { enabled: true, activities };
      } catch (e) {
        return { enabled: false, activities: [], error: e.message };
      }
    },
  });

  // Quick actions widget
  registry.registerWidget('quick-actions', {
    title: 'Quick Actions',
    size: 'sm',
    order: 5,
    dataLoader: async ({ db }) => {
      const { getAllModels } = require('../../../core/orm/model');
      const actions = [];
      
      const allModels = db.getAllModels ? db.getAllModels() : Array.from(getAllModels().values());
      const modelList = Array.isArray(allModels) ? allModels : Array.from(allModels.values());

      for (const model of modelList) {
        if (model.admin?.enabled) {
          actions.push({
            label: `New ${model.admin.label || model.name}`,
            path: `/models/${model.name}/new`,
            icon: 'plus',
          });
        }
      }

      return actions.slice(0, 5); // Max 5 quick actions
    },
  });
}

/**
 * Generate dashboard component code (Mithril.js)
 */
function generateDashboardComponent() {
  return `
// Format relative time
function formatRelativeTime(date) {
  if (!date) return null;
  const now = new Date();
  const d = new Date(date);
  const diff = now - d;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 30) {
    return d.toLocaleDateString();
  } else if (days > 0) {
    return days + ' day' + (days > 1 ? 's' : '') + ' ago';
  } else if (hours > 0) {
    return hours + ' hour' + (hours > 1 ? 's' : '') + ' ago';
  } else if (minutes > 0) {
    return minutes + ' min' + (minutes > 1 ? 's' : '') + ' ago';
  } else {
    return 'Just now';
  }
}

// Dashboard Widget Renderers
const WidgetRenderers = {
  // Model stats (cards grid with extended info)
  'model-stats': {
    render: (data) => {
      if (!data || !Array.isArray(data)) return m('div.text-gray-500', 'No data');
      return m('div.grid.grid-cols-1.md:grid-cols-2.lg:grid-cols-3.gap-4', data.map(stat => 
        m('a.block.bg-white.rounded-lg.shadow.hover:shadow-md.transition-shadow.overflow-hidden', {
          href: '/models/' + stat.name,
          onclick: (e) => {
            e.preventDefault();
            m.route.set('/models/' + stat.name);
          }
        }, [
          // Header with icon and count
          m('div.p-4.flex.items-center.justify-between.border-b.border-gray-100', [
            m('div', [
              m('p.text-sm.font-medium.text-gray-500', stat.label),
              m('p.text-3xl.font-bold.text-gray-900', (stat.count || 0).toLocaleString()),
            ]),
            m('div.w-14.h-14.bg-blue-100.rounded-xl.flex.items-center.justify-center', [
              stat.icon 
                ? m('span.text-2xl', stat.icon)
                : m(Icon, { name: 'database', class: 'w-7 h-7 text-blue-600' }),
            ]),
          ]),
          // Stats row
          m('div.px-4.py-3.bg-gray-50.grid.grid-cols-3.gap-2.text-center', [
            m('div', [
              m('p.text-xs.text-gray-400.uppercase', 'Columns'),
              m('p.text-sm.font-semibold.text-gray-700', stat.columnCount || '-'),
            ]),
            m('div', [
              m('p.text-xs.text-gray-400.uppercase', 'Table'),
              m('p.text-sm.font-semibold.text-gray-700.truncate', { title: stat.table }, stat.table || '-'),
            ]),
            m('div', [
              m('p.text-xs.text-gray-400.uppercase', 'Last Update'),
              m('p.text-sm.font-semibold.text-gray-700', 
                stat.lastUpdated || stat.lastCreated 
                  ? formatRelativeTime(stat.lastUpdated || stat.lastCreated)
                  : '-'
              ),
            ]),
          ]),
        ])
      ));
    },
  },

  // Recent activity (list)
  'recent-activity': {
    render: (data) => {
      if (!data?.enabled) {
        return m('div.text-gray-500.text-center.py-4', 'Activity logging not enabled');
      }
      if (!data.activities?.length) {
        return m('div.text-gray-500.text-center.py-4', 'No recent activity');
      }
      return m('div.divide-y', data.activities.map(activity =>
        m('div.py-3.flex.items-center.gap-3', [
          m('div.w-8.h-8.rounded-full.flex.items-center.justify-center', {
            class: activity.action === 'create' ? 'bg-green-100' :
                   activity.action === 'update' ? 'bg-blue-100' :
                   activity.action === 'delete' ? 'bg-red-100' : 'bg-gray-100'
          }, [
            m(Icon, { 
              name: activity.action === 'create' ? 'plus' :
                    activity.action === 'update' ? 'edit' :
                    activity.action === 'delete' ? 'trash' : 'activity',
              class: 'w-4 h-4'
            }),
          ]),
          m('div.flex-1.min-w-0', [
            m('p.text-sm.text-gray-900.truncate', activity.description || \`\${activity.action} on \${activity.model}\`),
            m('p.text-xs.text-gray-500', formatDate(activity.created_at)),
          ]),
          activity.user_name && m('span.text-xs.text-gray-400', activity.user_name),
        ])
      ));
    },
  },

  // Quick actions (buttons)
  'quick-actions': {
    render: (data) => {
      if (!data || !Array.isArray(data) || data.length === 0) {
        return m('div.text-gray-500.text-center.py-4', 'No quick actions available');
      }
      return m('div.space-y-2', data.map(action =>
        m('a.flex.items-center.gap-2.px-3.py-2.bg-gray-50.rounded.hover:bg-gray-100.transition-colors', {
          href: action.path,
          onclick: (e) => {
            e.preventDefault();
            m.route.set(action.path);
          }
        }, [
          m(Icon, { name: action.icon || 'plus', class: 'w-4 h-4 text-gray-600' }),
          m('span.text-sm.text-gray-700', action.label),
        ])
      ));
    },
  },

  // User stats (for user-management module)
  'user-stats': {
    render: (data) => {
      if (!data) return m('div.text-gray-500', 'No data');
      return m('div.grid.grid-cols-2.gap-4', [
        m('div.text-center.p-3.bg-blue-50.rounded', [
          m('p.text-2xl.font-bold.text-blue-600', data.total),
          m('p.text-xs.text-gray-500', 'Total Users'),
        ]),
        m('div.text-center.p-3.bg-green-50.rounded', [
          m('p.text-2xl.font-bold.text-green-600', data.active),
          m('p.text-xs.text-gray-500', 'Active'),
        ]),
        m('div.text-center.p-3.bg-yellow-50.rounded', [
          m('p.text-2xl.font-bold.text-yellow-600', data.admins),
          m('p.text-xs.text-gray-500', 'Admins'),
        ]),
        m('div.text-center.p-3.bg-purple-50.rounded', [
          m('p.text-2xl.font-bold.text-purple-600', data.recentUsers),
          m('p.text-xs.text-gray-500', 'This Week'),
        ]),
      ]);
    },
  },

  // Default renderer
  default: {
    render: (data) => {
      if (!data) return m('div.text-gray-500', 'No data');
      return m('pre.text-xs.bg-gray-50.p-2.rounded.overflow-auto', JSON.stringify(data, null, 2));
    },
  },
};

// Widget Component
const Widget = {
  oninit(vnode) {
    vnode.state.data = null;
    vnode.state.loading = true;
    vnode.state.error = null;
    
    // Load widget data
    const { widget } = vnode.attrs;
    if (widget.id) {
      api.get('/extensions/widgets/' + widget.id + '/data')
        .then(result => {
          vnode.state.data = result.data;
          vnode.state.loading = false;
          m.redraw();
        })
        .catch(err => {
          vnode.state.error = err.message;
          vnode.state.loading = false;
          m.redraw();
        });
    }
  },

  view(vnode) {
    const { widget } = vnode.attrs;
    const { data, loading, error } = vnode.state;
    
    const sizeClasses = {
      sm: 'col-span-1',
      md: 'col-span-1 md:col-span-2',
      lg: 'col-span-1 md:col-span-2 lg:col-span-3',
      xl: 'col-span-1 md:col-span-2 lg:col-span-4',
      full: 'col-span-full',
    };

    return m('div.bg-white.rounded-lg.shadow', {
      class: sizeClasses[widget.size] || sizeClasses.md,
    }, [
      m('div.px-4.py-3.border-b.border-gray-200', [
        m('h3.text-sm.font-medium.text-gray-900', widget.title),
      ]),
      m('div.p-4', [
        loading 
          ? m('div.flex.justify-center.py-8', m(Spinner))
          : error 
            ? m('div.text-red-500.text-sm', error)
            : (WidgetRenderers[widget.id] || WidgetRenderers.default).render(data),
      ]),
    ]);
  },
};

// Dashboard Page Component
const Dashboard = {
  oninit(vnode) {
    vnode.state.config = null;
    vnode.state.loading = true;
    
    // Load admin config
    api.get('/extensions/config')
      .then(config => {
        vnode.state.config = config;
        vnode.state.loading = false;
        m.redraw();
      })
      .catch(err => {
        console.error('Failed to load admin config:', err);
        vnode.state.loading = false;
        m.redraw();
      });
  },

  view(vnode) {
    const { config, loading } = vnode.state;
    
    if (loading) {
      return m(Layout, [
        m('div.flex.justify-center.items-center.h-64', m(Spinner)),
      ]);
    }

    const widgets = config?.widgets || [];

    return m(Layout, [
      m('div.mb-6', [
        m('h1.text-2xl.font-bold.text-gray-900', config?.settings?.title || 'Dashboard'),
        m('p.text-gray-500.mt-1', 'Welcome back, ' + (state.user?.name || 'Admin')),
      ]),

      widgets.length > 0
        ? m('div.grid.grid-cols-1.md:grid-cols-2.lg:grid-cols-4.gap-4', 
            widgets.map(widget => m(Widget, { key: widget.id, widget }))
          )
        : m('div.text-center.py-12.text-gray-500', [
            m('p', 'No dashboard widgets configured'),
            m('p.text-sm.mt-2', 'Visit the models section to manage your data'),
          ]),
    ]);
  },
};
`;
}

module.exports = {
  registerDashboardWidgets,
  generateDashboardComponent,
};

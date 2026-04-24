/**
 * Admin Panel - Custom Pages Module
 * Support for custom admin pages
 * @module plugins/admin-panel/modules/custom-pages
 */

/**
 * Create page builder helpers
 * @param {Object} registry - Admin registry
 */
function createPageBuilder(registry) {
  return {
    /**
     * Add a simple content page
     */
    addPage(id, config) {
      registry.registerPage(id, config);
      return this;
    },

    /**
     * Add a settings page
     */
    addSettingsPage(id, config) {
      registry.registerPage(id, {
        icon: 'settings',
        ...config,
        type: 'settings',
      });
      return this;
    },

    /**
     * Add a report page
     */
    addReportPage(id, config) {
      registry.registerPage(id, {
        icon: 'chart',
        ...config,
        type: 'report',
      });
      return this;
    },

    /**
     * Add a tool page
     */
    addToolPage(id, config) {
      registry.registerPage(id, {
        icon: 'tool',
        ...config,
        type: 'tool',
      });
      return this;
    },
  };
}

/**
 * Register default pages
 */
function registerDefaultPages(options) {
  const { registry, db } = options;

  // Settings page (if settings are configured)
  if (Object.keys(registry.settings).length > 0) {
    registry.registerPage('admin-settings', {
      title: 'Settings',
      path: '/settings',
      icon: 'settings',
      permission: 'admin',
    });

    registry.registerMenuItem({
      id: 'settings',
      label: 'Settings',
      path: '/settings',
      icon: 'settings',
      order: 999,
    });
  }
}

/**
 * Create custom page API handlers
 */
function createCustomPageApiHandlers(options) {
  const { registry, db } = options;

  /**
   * Get page data
   */
  async function getPageData(req, res) {
    try {
      const { pageId } = req.params;
      const page = registry.pages.get(pageId);

      if (!page) {
        return res.status(404).json({ error: 'Page not found' });
      }

      // If page has a data loader, execute it
      if (page.dataLoader) {
        const data = await page.dataLoader({ db, req, user: req.session?.adminUser });
        return res.json({ data });
      }

      res.json({ data: null });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Execute page action
   */
  async function executePageAction(req, res) {
    try {
      const { pageId, actionId } = req.params;
      const page = registry.pages.get(pageId);

      if (!page) {
        return res.status(404).json({ error: 'Page not found' });
      }

      const action = page.actions?.[actionId];
      if (!action || typeof action !== 'function') {
        return res.status(404).json({ error: 'Action not found' });
      }

      const result = await action({ db, req, body: req.body, user: req.session?.adminUser });
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  return {
    getPageData,
    executePageAction,
  };
}

/**
 * Generate custom page component factory (Mithril.js)
 */
function generateCustomPageComponent() {
  return `
// Custom Page Component Factory
function createCustomPage(pageConfig) {
  return {
    oninit(vnode) {
      vnode.state.data = null;
      vnode.state.loading = true;
      vnode.state.error = null;
      vnode.state.refreshing = false;
      vnode.state._stopPoll = null;

      vnode.state.load = () => {
        if (!pageConfig.dataLoader) {
          vnode.state.loading = false;
          return Promise.resolve();
        }
        vnode.state.loading = true;
        vnode.state.error = null;
        m.redraw();
        return api.get('/extensions/pages/' + pageConfig.id + '/data')
          .then(result => {
            vnode.state.data = result.data;
          })
          .catch(err => {
            vnode.state.error = err.message;
          })
          .finally(() => {
            vnode.state.loading = false;
            m.redraw();
          });
      };

      vnode.state.load();
      vnode.state._stopPoll = pageConfig.dataLoader
        ? runAdminAutoRefresh(() => vnode.state.load())
        : null;
    },

    onremove(vnode) {
      if (vnode.state._stopPoll) vnode.state._stopPoll();
    },

    view(vnode) {
      const { data, loading, error } = vnode.state;

      return m(Layout, [
        m(Breadcrumb, { items: [
          { label: pageConfig.title, href: pageConfig.path },
        ]}),

        m('div.mb-6.flex.items-start.justify-between.gap-4', [
          m('div', [
            m('h1.text-2xl.font-bold.text-gray-900.dark:text-slate-100', pageConfig.title),
            pageConfig.description && m('p.text-gray-500.dark:text-slate-400.mt-1', pageConfig.description),
          ]),
          pageConfig.dataLoader
            ? m(RefreshIconButton, {
                title: 'Reload page data',
                spinning: vnode.state.refreshing || loading,
                onclick: () => {
                  vnode.state.refreshing = true;
                  m.redraw();
                  vnode.state.load().finally(() => {
                    vnode.state.refreshing = false;
                    m.redraw();
                  });
                },
              })
            : null,
        ]),

        loading 
          ? m('div.flex.justify-center.py-12', m(Spinner))
          : error
            ? m('div.bg-red-50.border.border-red-200.rounded.p-4.text-red-700', error)
            : pageConfig.render
              ? pageConfig.render(data, vnode)
              : m('div.bg-white dark:bg-slate-800.rounded-lg.shadow.p-6', [
                  data 
                    ? m('pre.text-sm.overflow-auto', JSON.stringify(data, null, 2))
                    : m('p.text-gray-500', 'No content'),
                ]),
      ]);
    },
  };
}

// Settings Page Component
const SettingsPage = {
  oninit(vnode) {
    vnode.state.config = null;
    vnode.state.loading = true;
    vnode.state.saving = false;
    vnode.state.formData = {};
    vnode.state.reloadBusy = false;

    vnode.state.reloadFromServer = () => {
      vnode.state.reloadBusy = true;
      vnode.state.error = null;
      m.redraw();
      return api.get('/extensions/config')
        .then(result => {
          vnode.state.config = result;
          vnode.state.formData = { ...result.settings };
        })
        .catch(err => {
          vnode.state.error = err.message;
        })
        .finally(() => {
          vnode.state.reloadBusy = false;
          m.redraw();
        });
    };

    api.get('/extensions/config')
      .then(result => {
        vnode.state.config = result;
        vnode.state.formData = { ...result.settings };
        vnode.state.loading = false;
        m.redraw();
      })
      .catch(err => {
        vnode.state.error = err.message;
        vnode.state.loading = false;
        m.redraw();
      });
  },

  view(vnode) {
    const { config, loading, saving, formData, error } = vnode.state;

    if (loading) {
      return m(Layout, m('div.flex.justify-center.py-12', m(Spinner)));
    }

    return m(Layout, [
      m(Breadcrumb, { items: [{ label: 'Settings', href: '/settings' }] }),

      m('div.mb-6.flex.items-start.justify-between.gap-4', [
        m('div', [
          m('h1.text-2xl.font-bold.text-gray-900.dark:text-slate-100', 'Admin Settings'),
          m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', 'Reload discards unsaved changes'),
        ]),
        m(RefreshIconButton, {
          title: 'Reload settings from server',
          disabled: saving,
          spinning: vnode.state.reloadBusy,
          onclick: () => {
            vnode.state.reloadFromServer();
          },
        }),
      ]),

      error && m('div.bg-red-50.border.border-red-200.rounded.p-4.text-red-700.mb-4', error),

      m('div.bg-white dark:bg-slate-800.rounded-lg.shadow', [
        m('div.p-6.space-y-4', [
          m('div', [
            m('label.block.text-sm.font-medium.text-gray-700', 'Panel Title'),
            m('input.mt-1.block.w-full.rounded.border-gray-300 dark:border-slate-600.shadow-sm.focus:border-blue-500.focus:ring-blue-500', {
              type: 'text',
              value: formData.title || '',
              oninput: (e) => { formData.title = e.target.value; },
            }),
          ]),

          m('div', [
            m('label.block.text-sm.font-medium.text-gray-700', 'Primary Color'),
            m('input.mt-1.block.w-24.h-10.rounded.border-gray-300 dark:border-slate-600.shadow-sm', {
              type: 'color',
              value: formData.primaryColor || '#3B82F6',
              oninput: (e) => { formData.primaryColor = e.target.value; },
            }),
          ]),

          m('div', [
            m('label.block.text-sm.font-medium.text-gray-700', 'Records Per Page'),
            m('input.mt-1.block.w-32.rounded.border-gray-300 dark:border-slate-600.shadow-sm.focus:border-blue-500.focus:ring-blue-500', {
              type: 'number',
              min: 5,
              max: 100,
              value: formData.perPage || 20,
              oninput: (e) => { formData.perPage = parseInt(e.target.value); },
            }),
          ]),
        ]),

        m('div.bg-gray-50 dark:bg-slate-900.px-6.py-4.flex.justify-end.gap-3.rounded-b-lg', [
          m('button.px-4.py-2.text-sm.font-medium.text-white.bg-blue-600.rounded.hover:bg-blue-700.disabled:opacity-50', {
            disabled: saving,
            onclick: async () => {
              vnode.state.saving = true;
              m.redraw();
              try {
                await api.post('/extensions/settings', formData);
                // Reload to apply changes
                window.location.reload();
              } catch (err) {
                vnode.state.error = err.message;
                vnode.state.saving = false;
                m.redraw();
              }
            },
          }, saving ? 'Saving...' : 'Save Settings'),
        ]),
      ]),
    ]);
  },
};
`;
}

module.exports = {
  createPageBuilder,
  registerDefaultPages,
  createCustomPageApiHandlers,
  generateCustomPageComponent,
};

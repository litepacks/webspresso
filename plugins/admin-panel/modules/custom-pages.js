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

      const payload = { ...(req.query || {}), ...(req.body || {}) };
      const result = await action({
        db,
        req,
        body: payload,
        payload,
        query: req.query || {},
        user: req.session?.adminUser,
      });
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
  if (pageConfig && (pageConfig.url || (pageConfig.html && pageConfig.iframe))) {
    var iframeAttrs = {
      src: pageConfig.url || undefined,
      srcdoc: pageConfig.html || undefined,
      style: 'width: 100%; height: ' + (pageConfig.layout === false ? '100vh' : 'calc(100vh - 12rem)') + '; min-height: 600px; border: 0; border-radius: 0.5rem;',
      allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen',
      allowfullscreen: true
    };
    if (pageConfig.layout === false) {
      return {
        view: function() {
          return m('iframe', iframeAttrs);
        }
      };
    }
    return {
      view: function() {
        return m(Layout, [
          m(Breadcrumb, { items: [{ label: pageConfig.title, href: pageConfig.path }] }),
          m('div.mb-4.flex.items-start.justify-between.gap-4', [
            m('div', [
              m('h1.text-2xl.font-bold.text-gray-900.dark:text-slate-100', pageConfig.title),
              pageConfig.description && m('p.text-gray-500.dark:text-slate-400.mt-1', pageConfig.description)
            ])
          ]),
          m('iframe', iframeAttrs)
        ]);
      }
    };
  }

  if (pageConfig && pageConfig.html) {
    var executeScripts = function(vnode) {
      if (!vnode.dom) return;
      var scripts = vnode.dom.querySelectorAll('script');
      scripts.forEach(function(oldScript) {
        if (oldScript.dataset && oldScript.dataset.executed) return;
        var newScript = document.createElement('script');
        Array.from(oldScript.attributes).forEach(function(attr) {
          newScript.setAttribute(attr.name, attr.value);
        });
        newScript.dataset.executed = 'true';
        newScript.appendChild(document.createTextNode(oldScript.innerHTML));
        oldScript.parentNode.replaceChild(newScript, oldScript);
      });
    };
    if (pageConfig.layout === false) {
      return {
        oncreate: executeScripts,
        view: function() {
          return m('div.custom-html-container', m.trust(pageConfig.html));
        }
      };
    }
    return {
      oncreate: executeScripts,
      view: function() {
        return m(Layout, [
          m(Breadcrumb, { items: [{ label: pageConfig.title, href: pageConfig.path }] }),
          m('div.mb-4.flex.items-start.justify-between.gap-4', [
            m('div', [
              m('h1.text-2xl.font-bold.text-gray-900.dark:text-slate-100', pageConfig.title),
              pageConfig.description && m('p.text-gray-500.dark:text-slate-400.mt-1', pageConfig.description)
            ])
          ]),
          m('div.custom-html-container', m.trust(pageConfig.html))
        ]);
      }
    };
  }

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
    vnode.state.systemInfo = null;
    vnode.state.loading = true;
    vnode.state.saving = false;
    vnode.state.checkingUpdates = false;
    vnode.state.formData = {};
    vnode.state.reloadBusy = false;
    vnode.state.error = null;

    vnode.state.loadAll = (forceUpdateCheck = false) => {
      vnode.state.reloadBusy = true;
      vnode.state.error = null;
      if (forceUpdateCheck) vnode.state.checkingUpdates = true;
      m.redraw();
      return Promise.all([
        api.get('/extensions/config'),
        api.get('/extensions/system-info' + (forceUpdateCheck ? '?force=true' : '')).catch(() => null)
      ]).then(([configRes, sysRes]) => {
        vnode.state.config = configRes;
        vnode.state.formData = { ...configRes.settings };
        if (sysRes) vnode.state.systemInfo = sysRes;
      }).catch(err => {
        vnode.state.error = err.message;
      }).finally(() => {
        vnode.state.loading = false;
        vnode.state.reloadBusy = false;
        vnode.state.checkingUpdates = false;
        m.redraw();
      });
    };

    vnode.state.loadAll();
  },

  view(vnode) {
    const { config, systemInfo, loading, saving, checkingUpdates, formData, error, reloadBusy } = vnode.state;

    if (loading) {
      return m(Layout, m('div.flex.justify-center.py-12', m(Spinner)));
    }

    return m(Layout, [
      m(Breadcrumb, { items: [{ label: 'Settings', href: '/settings' }] }),

      m('div.mb-6.flex.items-start.justify-between.gap-4', [
        m('div', [
          m('h1.text-2xl.font-bold.text-gray-900.dark:text-slate-100', 'Admin Settings'),
          m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', 'System overview and admin panel configuration'),
        ]),
        m(RefreshIconButton, {
          title: 'Reload settings from server',
          disabled: saving || reloadBusy,
          spinning: reloadBusy,
          onclick: () => {
            vnode.state.loadAll();
          },
        }),
      ]),

      error && m('div.bg-red-50.dark:bg-red-950/40.border.border-red-200.dark:border-red-800.rounded-lg.p-4.text-red-700.dark:text-red-300.mb-6', error),

      // System Information Card
      systemInfo ? m('div.bg-white.dark:bg-slate-800.rounded-xl.shadow-sm.border.border-gray-200.dark:border-slate-700.mb-6.overflow-hidden', [
        m('div.px-6.py-4.border-b.border-gray-100.dark:border-slate-700.flex.items-center.justify-between.bg-gray-50/50.dark:bg-slate-800/80', [
          m('div.flex.items-center.gap-2.5', [
            m('div.w-8.h-8.rounded-lg.bg-indigo-50.dark:bg-indigo-950/60.text-indigo-600.dark:text-indigo-400.flex.items-center.justify-center', [
              m('svg.w-4.h-4', { fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z' })
              )
            ]),
            m('div', [
              m('h2.text-base.font-semibold.text-gray-900.dark:text-slate-100', 'System Information'),
              m('p.text-xs.text-gray-500.dark:text-slate-400', 'Runtime environment and version status')
            ])
          ]),
          m('button.inline-flex.items-center.gap-1.5.px-3.py-1.5.text-xs.font-medium.text-indigo-600.dark:text-indigo-400.bg-indigo-50.dark:bg-indigo-950/50.hover:bg-indigo-100.dark:hover:bg-indigo-900/50.rounded-lg.transition-colors.disabled:opacity-50', {
            disabled: checkingUpdates,
            onclick: () => {
              vnode.state.loadAll(true);
            }
          }, [
            checkingUpdates ? m(Spinner) : m('svg.w-3.5.h-3.5', { fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
              m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' })
            ),
            checkingUpdates ? 'Checking...' : 'Check for Updates'
          ])
        ]),
        m('div.p-6.grid.grid-cols-1.md:grid-cols-2.lg:grid-cols-3.gap-5', [
          // Webspresso Version
          m('div.p-3.5.rounded-lg.bg-gray-50.dark:bg-slate-900/50.border.border-gray-100.dark:border-slate-800', [
            m('div.text-xs.font-medium.text-gray-500.dark:text-slate-400', 'Webspresso Framework'),
            m('div.mt-1.5.flex.items-center.gap-2.flex-wrap', [
              m('span.text-sm.font-semibold.text-gray-900.dark:text-slate-100', 'v' + (systemInfo.webspressoVersion || '0.0.1')),
              systemInfo.hasUpdate
                ? m('span.inline-flex.items-center.px-2.py-0.5.rounded-full.text-[11px].font-semibold.bg-amber-100.text-amber-800.dark:bg-amber-950/60.dark:text-amber-300.border.border-amber-200.dark:border-amber-800', '⚡ Update: v' + systemInfo.latestVersion)
                : m('span.inline-flex.items-center.px-2.py-0.5.rounded-full.text-[11px].font-semibold.bg-emerald-100.text-emerald-800.dark:bg-emerald-950/60.dark:text-emerald-300.border.border-emerald-200.dark:border-emerald-800', '✓ Up to date')
            ]),
            systemInfo.hasUpdate && m('div.mt-2', [
              m('code.text-[11px].bg-white.dark:bg-slate-800.text-indigo-600.dark:text-indigo-400.px-2.py-0.5.rounded.border.border-gray-200.dark:border-slate-700.select-all', 'npm i webspresso@latest')
            ])
          ]),

          // Node.js Version
          m('div.p-3.5.rounded-lg.bg-gray-50.dark:bg-slate-900/50.border.border-gray-100.dark:border-slate-800', [
            m('div.text-xs.font-medium.text-gray-500.dark:text-slate-400', 'Node.js Runtime'),
            m('div.mt-1.5.text-sm.font-semibold.text-gray-900.dark:text-slate-100', systemInfo.nodeVersion || process.version)
          ]),

          // Environment
          m('div.p-3.5.rounded-lg.bg-gray-50.dark:bg-slate-900/50.border.border-gray-100.dark:border-slate-800', [
            m('div.text-xs.font-medium.text-gray-500.dark:text-slate-400', 'Environment'),
            m('div.mt-1.5', [
              m('span.inline-flex.items-center.px-2.5.py-0.5.rounded-full.text-xs.font-semibold', {
                class: systemInfo.environment === 'production'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
              }, systemInfo.environment || 'development')
            ])
          ]),

          // Operating System
          m('div.p-3.5.rounded-lg.bg-gray-50.dark:bg-slate-900/50.border.border-gray-100.dark:border-slate-800', [
            m('div.text-xs.font-medium.text-gray-500.dark:text-slate-400', 'OS & Architecture'),
            m('div.mt-1.5.text-sm.font-semibold.text-gray-900.dark:text-slate-100.truncate', { title: systemInfo.platform }, systemInfo.platform || 'Server')
          ]),

          // Server Uptime
          m('div.p-3.5.rounded-lg.bg-gray-50.dark:bg-slate-900/50.border.border-gray-100.dark:border-slate-800', [
            m('div.text-xs.font-medium.text-gray-500.dark:text-slate-400', 'Server Uptime'),
            m('div.mt-1.5.text-sm.font-semibold.text-gray-900.dark:text-slate-100', systemInfo.uptimeFormatted || '0s')
          ]),

          // Memory Usage
          m('div.p-3.5.rounded-lg.bg-gray-50.dark:bg-slate-900/50.border.border-gray-100.dark:border-slate-800', [
            m('div.text-xs.font-medium.text-gray-500.dark:text-slate-400', 'Memory (Heap / RSS)'),
            m('div.mt-1.5.text-sm.font-semibold.text-gray-900.dark:text-slate-100',
              (systemInfo.memory?.heapUsed || '0 MB') + ' / ' + (systemInfo.memory?.heapTotal || '0 MB') + ' (' + (systemInfo.memory?.rss || '0 MB') + ')'
            )
          ]),

          // Database Engine
          m('div.p-3.5.rounded-lg.bg-gray-50.dark:bg-slate-900/50.border.border-gray-100.dark:border-slate-800', [
            m('div.text-xs.font-medium.text-gray-500.dark:text-slate-400', 'Database Client'),
            m('div.mt-1.5.text-sm.font-semibold.text-gray-900.dark:text-slate-100', systemInfo.database?.client || 'knex')
          ])
        ])
      ]) : null,

      // Admin Preferences Card
      m('div.bg-white.dark:bg-slate-800.rounded-xl.shadow-sm.border.border-gray-200.dark:border-slate-700.overflow-hidden', [
        m('div.px-6.py-4.border-b.border-gray-100.dark:border-slate-700.flex.items-center.gap-2.5.bg-gray-50/50.dark:bg-slate-800/80', [
          m('div.w-8.h-8.rounded-lg.bg-blue-50.dark:bg-blue-950/60.text-blue-600.dark:text-blue-400.flex.items-center.justify-center', [
            m('svg.w-4.h-4', { fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
              m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4' })
            )
          ]),
          m('div', [
            m('h2.text-base.font-semibold.text-gray-900.dark:text-slate-100', 'Panel Preferences'),
            m('p.text-xs.text-gray-500.dark:text-slate-400', 'Customize admin title, theme colors, and table pagination')
          ])
        ]),

        m('div.p-6.space-y-5', [
          m('div', [
            m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300', 'Panel Title'),
            m('input.mt-1.block.w-full.rounded-lg.border-gray-300.dark:border-slate-600.dark:bg-slate-900.dark:text-slate-100.shadow-sm.focus:border-blue-500.focus:ring-blue-500.text-sm.px-3.py-2', {
              type: 'text',
              value: formData.title || '',
              placeholder: 'Admin Panel',
              oninput: (e) => { formData.title = e.target.value; },
            }),
          ]),

          m('div', [
            m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300', 'Primary Accent Color'),
            m('div.mt-1.5.flex.items-center.gap-3', [
              m('input.w-10.h-10.rounded-lg.border.border-gray-300.dark:border-slate-600.cursor-pointer.p-0.5.bg-transparent', {
                type: 'color',
                value: formData.primaryColor || '#3B82F6',
                oninput: (e) => { formData.primaryColor = e.target.value; },
              }),
              m('span.text-xs.font-mono.text-gray-600.dark:text-slate-400', formData.primaryColor || '#3B82F6'),
            ]),
          ]),

          m('div', [
            m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300', 'Records Per Page'),
            m('input.mt-1.block.w-32.rounded-lg.border-gray-300.dark:border-slate-600.dark:bg-slate-900.dark:text-slate-100.shadow-sm.focus:border-blue-500.focus:ring-blue-500.text-sm.px-3.py-2', {
              type: 'number',
              min: 5,
              max: 100,
              value: formData.perPage || 20,
              oninput: (e) => { formData.perPage = parseInt(e.target.value); },
            }),
          ]),
        ]),

        m('div.bg-gray-50.dark:bg-slate-900/70.px-6.py-4.flex.justify-end.gap-3.border-t.border-gray-100.dark:border-slate-700', [
          m('button.inline-flex.items-center.gap-2.px-4.py-2.text-sm.font-medium.text-white.bg-blue-600.hover:bg-blue-700.rounded-lg.shadow-sm.transition-colors.disabled:opacity-50', {
            disabled: saving,
            onclick: async () => {
              vnode.state.saving = true;
              m.redraw();
              try {
                await api.post('/extensions/settings', formData);
                window.location.reload();
              } catch (err) {
                vnode.state.error = err.message;
                vnode.state.saving = false;
                m.redraw();
              }
            },
          }, saving ? [m(Spinner), 'Saving...'] : 'Save Settings'),
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

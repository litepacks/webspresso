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
// Developer Error Boundary for Custom Pages
function renderCustomPageError(page, err) {
  var isFullscreen = page && page.layout === false;
  var pageTitle = (page && page.title) || (page && page.id) || 'Custom Page';
  var pageId = (page && page.id) || 'unknown';
  var errorMsg = (err && (err.message || String(err))) || 'Unknown error';
  var stack = (err && err.stack) || '';

  var errorCard = m('div.max-w-4xl.mx-auto.bg-white.dark:bg-slate-900.rounded-xl.shadow-lg.border.border-red-200.dark:border-red-900/60.overflow-hidden', [
    // Header
    m('div.px-6.py-4.bg-red-50.dark:bg-red-950/60.border-b.border-red-100.dark:border-red-900/40.flex.items-center.justify-between.gap-4', [
      m('div.flex.items-center.gap-3', [
        m('div.w-9.h-9.rounded-lg.bg-red-100.dark:bg-red-900/80.text-red-600.dark:text-red-300.flex.items-center.justify-center.flex-shrink-0', [
          m('svg.w-5.h-5', { fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
            m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' })
          )
        ]),
        m('div', [
          m('h3.text-base.font-bold.text-red-900.dark:text-red-200', 'Custom Page Component Error'),
          m('p.text-xs.text-red-600.dark:text-red-400', 'Page ID: ' + pageId + (pageTitle !== pageId ? ' (' + pageTitle + ')' : ''))
        ])
      ]),
      m('span.px-2.5.py-1.rounded.text-xs.font-mono.font-semibold.bg-red-200/60.dark:bg-red-900.text-red-800.dark:text-red-200', 'Error Boundary')
    ]),

    // Body
    m('div.p-6.space-y-4', [
      m('div.p-4.rounded-lg.bg-red-50/50.dark:bg-red-950/30.border.border-red-200.dark:border-red-900/40', [
        m('div.text-xs.font-semibold.uppercase.tracking-wider.text-red-700.dark:text-red-400.mb-1', 'Exception Message'),
        m('div.text-sm.font-semibold.text-red-900.dark:text-red-200.break-words', errorMsg)
      ]),

      stack ? m('div.space-y-1.5', [
        m('div.text-xs.font-semibold.uppercase.tracking-wider.text-gray-500.dark:text-slate-400', 'Stack Trace'),
        m('pre.p-4.rounded-lg.bg-slate-900.text-red-300.dark:text-red-400.text-xs.font-mono.overflow-x-auto.leading-relaxed.border.border-slate-800.max-h-80.overflow-y-auto', stack)
      ]) : null,

      // Actions
      m('div.pt-3.flex.items-center.justify-end.gap-3.border-t.border-gray-100.dark:border-slate-800', [
        m('button.px-4.py-2.text-xs.font-medium.text-gray-700.dark:text-slate-300.bg-gray-100.dark:bg-slate-800.hover:bg-gray-200.dark:hover:bg-slate-700.rounded-lg.transition-colors', {
          onclick: function() { m.route.set('/'); }
        }, 'Back to Dashboard'),
        m('button.inline-flex.items-center.gap-1.5.px-4.py-2.text-xs.font-medium.text-white.bg-red-600.hover:bg-red-700.rounded-lg.shadow-sm.transition-colors', {
          onclick: function() { window.location.reload(); }
        }, [
          m('svg.w-3.5.h-3.5', { fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
            m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' })
          ),
          'Reload Page'
        ])
      ])
    ])
  ]);

  if (isFullscreen || typeof Layout === 'undefined') {
    return m('div.min-h-screen.bg-slate-950.p-6.flex.items-center.justify-center', errorCard);
  }

  var breadcrumbs = [{ label: pageTitle, href: (page && page.path) || '/' }];
  return m(Layout, [
    typeof Breadcrumb !== 'undefined' ? m(Breadcrumb, { items: breadcrumbs }) : null,
    errorCard
  ]);
}

// Admin UI Component Library for Custom Pages & Widgets
var AdminUI = {
  StatCard: {
    view: function(vnode) {
      var attrs = vnode.attrs || {};
      var color = attrs.color || 'blue';
      var colorMap = {
        blue: { bg: 'bg-blue-50 dark:bg-blue-950/60', text: 'text-blue-600 dark:text-blue-400' },
        green: { bg: 'bg-emerald-50 dark:bg-emerald-950/60', text: 'text-emerald-600 dark:text-emerald-400' },
        emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/60', text: 'text-emerald-600 dark:text-emerald-400' },
        indigo: { bg: 'bg-indigo-50 dark:bg-indigo-950/60', text: 'text-indigo-600 dark:text-indigo-400' },
        purple: { bg: 'bg-purple-50 dark:bg-purple-950/60', text: 'text-purple-600 dark:text-purple-400' },
        amber: { bg: 'bg-amber-50 dark:bg-amber-950/60', text: 'text-amber-600 dark:text-amber-400' },
        red: { bg: 'bg-red-50 dark:bg-red-950/60', text: 'text-red-600 dark:text-red-400' },
        gray: { bg: 'bg-gray-50 dark:bg-slate-800', text: 'text-gray-600 dark:text-slate-400' },
      };
      var theme = colorMap[color] || colorMap.blue;
      var trend = attrs.trend || (attrs.change && String(attrs.change).startsWith('+') ? 'up' : attrs.change && String(attrs.change).startsWith('-') ? 'down' : 'neutral');

      return m('div.bg-white.dark:bg-slate-800.rounded-xl.p-5.shadow-sm.border.border-gray-200.dark:border-slate-700.flex.flex-col.justify-between.gap-3', [
        m('div.flex.items-center.justify-between.gap-2', [
          m('span.text-xs.font-medium.text-gray-500.dark:text-slate-400.truncate', attrs.title || ''),
          attrs.icon ? m('div.w-8.h-8.rounded-lg.flex.items-center.justify-center', { class: theme.bg + ' ' + theme.text }, attrs.icon) : null
        ]),
        m('div.flex.items-baseline.justify-between.gap-2', [
          m('div.text-2xl.font-bold.text-gray-900.dark:text-slate-100', attrs.value !== undefined ? String(attrs.value) : '0'),
          attrs.change ? m('span.inline-flex.items-center.gap-0.5.text-xs.font-semibold.px-2.py-0.5.rounded-full', {
            class: trend === 'up'
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
              : trend === 'down'
                ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                : 'bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-300'
          }, [
            trend === 'up' ? '↑ ' : trend === 'down' ? '↓ ' : '',
            attrs.change
          ]) : null
        ]),
        attrs.subtitle ? m('p.text-xs.text-gray-400.dark:text-slate-500', attrs.subtitle) : null
      ]);
    }
  },

  Card: {
    view: function(vnode) {
      var attrs = vnode.attrs || {};
      var hasHeader = attrs.title || attrs.subtitle || attrs.actions;
      return m('div.bg-white.dark:bg-slate-800.rounded-xl.shadow-sm.border.border-gray-200.dark:border-slate-700.overflow-hidden', { class: attrs.class }, [
        hasHeader ? m('div.px-6.py-4.border-b.border-gray-100.dark:border-slate-700.flex.items-center.justify-between.gap-4.bg-gray-50/50.dark:bg-slate-800/80', [
          m('div', [
            attrs.title ? m('h3.text-base.font-semibold.text-gray-900.dark:text-slate-100', attrs.title) : null,
            attrs.subtitle ? m('p.text-xs.text-gray-500.dark:text-slate-400.mt-0.5', attrs.subtitle) : null
          ]),
          attrs.actions ? m('div.flex.items-center.gap-2', attrs.actions) : null
        ]) : null,
        m('div.p-6', vnode.children || attrs.children),
        attrs.footer ? m('div.px-6.py-3.bg-gray-50.dark:bg-slate-900/50.border-t.border-gray-100.dark:border-slate-700', attrs.footer) : null
      ]);
    }
  },

  Button: {
    view: function(vnode) {
      var attrs = vnode.attrs || {};
      var variant = attrs.variant || 'primary';
      var size = attrs.size || 'md';
      var variantClasses = {
        primary: 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm disabled:bg-blue-400',
        secondary: 'bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-200',
        danger: 'bg-red-600 hover:bg-red-700 text-white shadow-sm disabled:bg-red-400',
        success: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:bg-emerald-400',
        outline: 'border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700/50',
      };
      var sizeClasses = {
        sm: 'px-2.5 py-1.5 text-xs',
        md: 'px-3.5 py-2 text-sm',
        lg: 'px-4.5 py-2.5 text-base',
      };
      var vCls = variantClasses[variant] || variantClasses.primary;
      var sCls = sizeClasses[size] || sizeClasses.md;
      var baseClasses = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
      var fullClass = baseClasses + ' ' + vCls + ' ' + sCls + (attrs.class ? ' ' + attrs.class : '');

      return m('button', {
        type: attrs.type || 'button',
        disabled: attrs.disabled || attrs.loading,
        onclick: attrs.onclick,
        class: fullClass,
      }, [
        attrs.loading ? m('span.inline-block.animate-spin', '⟳') : (attrs.icon || null),
        vnode.children || attrs.children
      ]);
    }
  },

  Badge: {
    view: function(vnode) {
      var attrs = vnode.attrs || {};
      var color = attrs.color || 'blue';
      var size = attrs.size || 'md';
      var colorMap = {
        green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
        emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
        red: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border-red-200 dark:border-red-800',
        blue: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800',
        amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800',
        yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800',
        purple: 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-200 dark:border-purple-800',
        indigo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
        gray: 'bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-300 border-gray-200 dark:border-slate-600',
      };
      var cCls = colorMap[color] || colorMap.blue;
      var sCls = size === 'sm' ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2.5 py-1';
      var fullClass = 'inline-flex items-center gap-1.5 font-semibold rounded-full border ' + cCls + ' ' + sCls + (attrs.class ? ' ' + attrs.class : '');

      return m('span', { class: fullClass }, [
        attrs.dot ? m('span.w-1.5.h-1.5.rounded-full.bg-current') : null,
        attrs.text || vnode.children || attrs.children
      ]);
    }
  },

  Modal: {
    view: function(vnode) {
      var attrs = vnode.attrs || {};
      if (!attrs.isOpen) return null;
      var size = attrs.size || 'md';
      var sizeMap = {
        sm: 'max-w-md',
        md: 'max-w-lg',
        lg: 'max-w-2xl',
        xl: 'max-w-4xl',
      };
      var sCls = sizeMap[size] || sizeMap.md;

      return m('div.fixed.inset-0.z-50.flex.items-center.justify-center.p-4.overflow-y-auto', [
        m('div.fixed.inset-0.bg-black/50.backdrop-blur-sm.transition-opacity', {
          onclick: function() { if (attrs.onClose) attrs.onClose(); }
        }),
        m('div.relative.bg-white.dark:bg-slate-900.rounded-xl.shadow-2xl.border.border-gray-200.dark:border-slate-700.w-full.overflow-hidden.z-10.transform.transition-all', {
          class: sCls
        }, [
          m('div.px-6.py-4.border-b.border-gray-100.dark:border-slate-800.flex.items-center.justify-between', [
            m('h3.text-lg.font-bold.text-gray-900.dark:text-slate-100', attrs.title || 'Modal'),
            m('button.text-gray-400.hover:text-gray-600.dark:hover:text-slate-300.rounded-lg.p-1', {
              onclick: function() { if (attrs.onClose) attrs.onClose(); }
            }, '✕')
          ]),
          m('div.p-6', vnode.children || attrs.children),
          (attrs.onConfirm || attrs.onClose) ? m('div.px-6.py-3.bg-gray-50.dark:bg-slate-800/50.border-t.border-gray-100.dark:border-slate-800.flex.items-center.justify-end.gap-3', [
            attrs.onClose ? m('button.px-4.py-2.text-xs.font-medium.text-gray-700.dark:text-slate-300.bg-gray-100.dark:bg-slate-800.hover:bg-gray-200.dark:hover:bg-slate-700.rounded-lg', {
              onclick: function() { attrs.onClose(); }
            }, attrs.cancelText || 'Cancel') : null,
            attrs.onConfirm ? m('button.px-4.py-2.text-xs.font-medium.text-white.rounded-lg.shadow-sm', {
              class: attrs.confirmVariant === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700',
              onclick: function() { attrs.onConfirm(); }
            }, attrs.confirmText || 'Confirm') : null,
          ]) : null
        ])
      ]);
    }
  },

  Tabs: {
    view: function(vnode) {
      var attrs = vnode.attrs || {};
      var tabs = attrs.tabs || [];
      var active = attrs.active;
      var onChange = attrs.onChange || function() {};

      return m('div.border-b.border-gray-200.dark:border-slate-700.mb-6', [
        m('nav.flex.space-x-8', tabs.map(function(tab) {
          var isActive = tab.id === active;
          return m('button.flex.items-center.gap-2.py-3.px-1.border-b-2.text-sm.font-medium.transition-colors', {
            class: isActive
              ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
              : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:border-gray-300',
            onclick: function(e) {
              e.preventDefault();
              onChange(tab.id);
            }
          }, [
            tab.icon ? (typeof tab.icon === 'function' ? tab.icon() : tab.icon) : null,
            m('span', tab.label || tab.title || tab.id),
            tab.badge !== undefined ? m('span.ml-1.px-2.py-0.5.text-xs.rounded-full', {
              class: isActive ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300' : 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300'
            }, String(tab.badge)) : null
          ]);
        }))
      ]);
    }
  }
};

// Toast Notification State & Handlers
var toastState = {
  items: [],
  add: function(type, message, options) {
    options = options || {};
    if (typeof type === 'object') {
      options = type;
      type = options.type || 'info';
      message = options.message || '';
    }
    var id = 'toast_' + Math.random().toString(36).substring(2, 9);
    var item = {
      id: id,
      type: type || 'info',
      message: message,
      title: options.title || '',
      duration: options.duration !== undefined ? options.duration : 4000
    };
    toastState.items.push(item);
    if (item.duration > 0) {
      setTimeout(function() {
        toastState.remove(id);
      }, item.duration);
    }
    try {
      if (typeof m !== 'undefined' && typeof m.redraw === 'function') {
        m.redraw();
      }
    } catch (e) {}
    return id;
  },
  remove: function(id) {
    toastState.items = toastState.items.filter(function(t) { return t.id !== id; });
    try {
      if (typeof m !== 'undefined' && typeof m.redraw === 'function') {
        m.redraw();
      }
    } catch (e) {}
  },
  clear: function() {
    toastState.items = [];
    try {
      if (typeof m !== 'undefined' && typeof m.redraw === 'function') {
        m.redraw();
      }
    } catch (e) {}
  }
};

function normalizeToastOptions(options) {
  if (typeof options === 'number') {
    return { duration: options };
  }
  return options || {};
}

var AdminToast = function(message, type, options) {
  var opts = normalizeToastOptions(options);
  if (typeof type === 'object') {
    opts = type;
    type = opts.type || 'info';
  }
  return toastState.add(type || 'info', message, opts);
};
AdminToast.success = function(message, options) { return toastState.add('success', message, normalizeToastOptions(options)); };
AdminToast.error = function(message, options) { return toastState.add('error', message, normalizeToastOptions(options)); };
AdminToast.warning = function(message, options) { return toastState.add('warning', message, normalizeToastOptions(options)); };
AdminToast.info = function(message, options) { return toastState.add('info', message, normalizeToastOptions(options)); };
AdminToast.remove = function(id) { return toastState.remove(id); };
AdminToast.clear = function() { return toastState.clear(); };

var ToastContainer = {
  view: function() {
    if (!toastState.items || toastState.items.length === 0) return null;
    return m('div.fixed.top-4.right-4.z-50.flex.flex-col.gap-2.5.max-w-sm.w-full.pointer-events-none.px-4.sm:px-0',
      toastState.items.map(function(t) {
        var typeConfig = {
          success: {
            border: 'border-emerald-200 dark:border-emerald-800/80',
            bg: 'bg-white dark:bg-slate-900',
            iconColor: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60',
            symbol: '✓',
          },
          error: {
            border: 'border-red-200 dark:border-red-800/80',
            bg: 'bg-white dark:bg-slate-900',
            iconColor: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/60',
            symbol: '!',
          },
          warning: {
            border: 'border-amber-200 dark:border-amber-800/80',
            bg: 'bg-white dark:bg-slate-900',
            iconColor: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60',
            symbol: '⚠',
          },
          info: {
            border: 'border-blue-200 dark:border-blue-800/80',
            bg: 'bg-white dark:bg-slate-900',
            iconColor: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60',
            symbol: 'ℹ',
          },
        };
        var cfg = typeConfig[t.type] || typeConfig.info;

        return m('div.pointer-events-auto.shadow-xl.rounded-xl.border.p-4.flex.items-start.gap-3.transition-all.transform', {
          key: t.id,
          class: cfg.border + ' ' + cfg.bg
        }, [
          m('div.w-7.h-7.rounded-lg.flex.items-center.justify-center.text-xs.font-bold.flex-shrink-0', {
            class: cfg.iconColor
          }, cfg.symbol),
          m('div.flex-1.min-w-0', [
            t.title ? m('h4.text-sm.font-semibold.text-gray-900.dark:text-slate-100', t.title) : null,
            m('p.text-xs.text-gray-600.dark:text-slate-300.break-words', t.message)
          ]),
          m('button.text-gray-400.hover:text-gray-600.dark:hover:text-slate-200.p-1.text-xs', {
            onclick: function() { toastState.remove(t.id); }
          }, '✕')
        ]);
      })
    );
  }
};

// Confirm Modal State & Handlers
var confirmState = {
  current: null,
  open: function(options) {
    options = options || {};
    if (typeof options === 'string') {
      options = { message: options };
    }
    return new Promise(function(resolve) {
      confirmState.current = {
        title: options.title || 'Confirmation',
        message: options.message || 'Are you sure you want to proceed?',
        confirmText: options.confirmText || 'Confirm',
        cancelText: options.cancelText || 'Cancel',
        confirmColor: options.confirmColor || (options.danger ? 'red' : 'blue'),
        danger: options.danger || false,
        resolve: resolve
      };
      try {
        if (typeof m !== 'undefined' && typeof m.redraw === 'function') {
          m.redraw();
        }
      } catch (e) {}
    });
  },
  close: function(result) {
    if (confirmState.current && confirmState.current.resolve) {
      confirmState.current.resolve(Boolean(result));
    }
    confirmState.current = null;
    try {
      if (typeof m !== 'undefined' && typeof m.redraw === 'function') {
        m.redraw();
      }
    } catch (e) {}
  }
};

var AdminConfirm = function(options) {
  return confirmState.open(options);
};

var ConfirmModalContainer = {
  view: function() {
    if (!confirmState.current) return null;
    var cur = confirmState.current;
    var isDanger = cur.danger || cur.confirmColor === 'red';

    return m('div.fixed.inset-0.z-50.flex.items-center.justify-center.p-4', [
      m('div.fixed.inset-0.bg-black/50.backdrop-blur-sm', {
        onclick: function() { confirmState.close(false); }
      }),
      m('div.relative.bg-white.dark:bg-slate-900.rounded-xl.shadow-2xl.border.border-gray-200.dark:border-slate-700.max-w-md.w-full.p-6.z-10', [
        m('div.flex.items-start.gap-4', [
          m('div.w-10.h-10.rounded-full.flex.items-center.justify-center.flex-shrink-0', {
            class: isDanger ? 'bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400' : 'bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
          }, isDanger ? '⚠' : '?'),
          m('div.flex-1', [
            m('h3.text-base.font-bold.text-gray-900.dark:text-slate-100', cur.title),
            m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1.5', cur.message)
          ])
        ]),
        m('div.mt-6.flex.items-center.justify-end.gap-3', [
          m('button.px-4.py-2.text-xs.font-medium.text-gray-700.dark:text-slate-300.bg-gray-100.dark:bg-slate-800.hover:bg-gray-200.dark:hover:bg-slate-700.rounded-lg', {
            onclick: function() { confirmState.close(false); }
          }, cur.cancelText),
          m('button.px-4.py-2.text-xs.font-medium.text-white.rounded-lg.shadow-sm', {
            class: isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700',
            onclick: function() { confirmState.close(true); }
          }, cur.confirmText)
        ])
      ])
    ]);
  }
};

// Global Exposure
if (typeof window !== 'undefined') {
  window.AdminUI = AdminUI;
  window.Admin = window.Admin || {};
  window.Admin.ui = AdminUI;
  window.Admin.toast = AdminToast;
  window.Admin.confirm = AdminConfirm;
  window.notify = AdminToast;
  window.toast = AdminToast;
  window.confirmModal = AdminConfirm;
  window.toastState = toastState;
  window.confirmState = confirmState;
  window.ToastContainer = ToastContainer;
  window.ConfirmModalContainer = ConfirmModalContainer;
}

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
          return m('div.relative.w-full.h-full', [
            m('iframe', iframeAttrs),
            m(ToastContainer),
            m(ConfirmModalContainer),
          ]);
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
          return m('div.custom-html-container', [
            m.trust(pageConfig.html),
            m(ToastContainer),
            m(ConfirmModalContainer),
          ]);
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
              ? (function() {
                  try {
                    return pageConfig.render(data, vnode);
                  } catch (renderErr) {
                    console.error('[Admin Panel] Error rendering page "' + pageConfig.id + '":', renderErr);
                    return renderCustomPageError(pageConfig, renderErr);
                  }
                })()
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

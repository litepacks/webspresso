/**
 * Admin Panel - Menu Module
 * Dynamic sidebar menu system
 * @module plugins/admin-panel/modules/menu
 */

/**
 * Register default menu items from models
 * @param {Object} options - Options
 * @param {Object} options.registry - Admin registry
 * @param {Object} options.db - Database instance
 */
function registerModelMenuItems(options) {
  const { registry, db } = options;
  const { getAllModels } = require('../../../core/orm/model');

  // Get all admin-enabled models
  const allModels = db.getAllModels ? db.getAllModels() : Array.from(getAllModels().values());
  const modelList = Array.isArray(allModels) ? allModels : Array.from(allModels.values());

  // Create "Content" menu group for models
  registry.registerMenuGroup('content', {
    label: 'Content',
    icon: 'database',
    order: 0,
  });

  // Register menu items for each model
  for (const model of modelList) {
    if (model.admin?.enabled) {
      registry.registerMenuItem({
        id: `model-${model.name}`,
        label: model.admin.label || model.name,
        path: `/models/${model.name}`,
        icon: model.admin.icon || 'table',
        group: 'content',
        order: model.admin.menuOrder || 10,
      });
    }
  }
}

/**
 * Register system menu items
 * @param {Object} options - Options
 * @param {Object} options.registry - Admin registry
 */
function registerSystemMenuItems(options) {
  const { registry } = options;

  // Dashboard
  registry.registerMenuItem({
    id: 'dashboard',
    label: 'Dashboard',
    path: '/',
    icon: 'home',
    order: -100, // Always first
  });

  // System group
  registry.registerMenuGroup('system', {
    label: 'System',
    icon: 'settings',
    order: 900,
  });
}

/**
 * Generate menu component (Mithril.js)
 */
function generateMenuComponent() {
  return `
// Icon Component (simple SVG icons)
const Icon = {
  view(vnode) {
    const { name, class: className = 'w-5 h-5' } = vnode.attrs;
    
    const icons = {
      home: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />',
      database: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />',
      table: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />',
      users: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />',
      'user-plus': '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />',
      settings: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />',
      plus: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />',
      edit: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />',
      trash: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />',
      download: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />',
      check: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />',
      x: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />',
      key: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />',
      shield: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />',
      chart: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />',
      activity: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />',
      filter: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />',
      search: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />',
      refresh: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />',
      'chevron-down': '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />',
      'chevron-right': '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />',
      logout: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />',
      menu: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />',
      tool: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />',
      sun: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />',
      moon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />',
      monitor: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />',
    };

    const path = icons[name] || icons.database;

    return m('svg', { 
      class: className,
      fill: 'none', 
      stroke: 'currentColor', 
      viewBox: '0 0 24 24',
      xmlns: 'http://www.w3.org/2000/svg',
    }, m.trust(path));
  },
};

function getAdminAutoRefreshMs() {
  const raw = window.__ADMIN_CONFIG__?.settings?.autoRefreshMs;
  if (raw === 0 || raw === false) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 60000;
  return Math.min(Math.max(n, 10000), 3600000);
}

function runAdminAutoRefresh(callback) {
  const ms = getAdminAutoRefreshMs();
  if (!ms) return function noop() {};
  const id = setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    try {
      callback();
    } catch (e) {
      console.error(e);
    }
  }, ms);
  return function stopAdminAutoRefresh() {
    clearInterval(id);
  };
}

const RefreshIconButton = {
  view(vnode) {
    const { title, spinning, onclick, disabled } = vnode.attrs;
    return m('button.inline-flex.items-center.justify-center.p-2.rounded-lg.border.border-gray-200.dark:border-slate-600.bg-white.dark:bg-slate-800.text-gray-600.dark:text-slate-300.hover:bg-gray-50.dark:hover:bg-slate-700.transition-colors.disabled:opacity-50', {
      type: 'button',
      title: title || 'Refresh',
      disabled: !!disabled || !!spinning,
      onclick: (e) => {
        e.preventDefault();
        if (onclick) onclick(e);
      },
    }, m(Icon, {
      name: 'refresh',
      class: 'w-4 h-4' + (spinning ? ' animate-spin' : ''),
    }));
  },
};

var ADMIN_THEME_KEY = 'webspresso-admin-theme';
function getAdminThemePref() {
  try { return localStorage.getItem(ADMIN_THEME_KEY); } catch (e) { return null; }
}
function setAdminThemePref(mode) {
  try {
    if (mode === 'system') localStorage.removeItem(ADMIN_THEME_KEY);
    else localStorage.setItem(ADMIN_THEME_KEY, mode);
  } catch (e) {}
  if (window.__syncAdminTheme) window.__syncAdminTheme();
  m.redraw();
}
const ThemeToggle = {
  view() {
    var pref = getAdminThemePref();
    var isSystem = !pref || pref === 'system';
    var isLight = pref === 'light';
    var isDark = pref === 'dark';
    var btn = function(mode, title, iconName) {
      var active = (mode === 'system' && isSystem) || (mode === 'light' && isLight) || (mode === 'dark' && isDark);
      return m('button.p-1.5.rounded-md.transition-colors', {
        type: 'button',
        title: title,
        class: active
          ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-300 shadow-sm'
          : 'text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700',
        onclick: function() { setAdminThemePref(mode); },
      }, m(Icon, { name: iconName, class: 'w-4 h-4' }));
    };
    return m('div.flex.items-center.gap-0.5.p-0.5.rounded-lg.border.border-gray-200 dark:border-slate-600.bg-gray-50 dark:bg-slate-900/80', [
      btn('system', 'Match system', 'monitor'),
      btn('light', 'Light', 'sun'),
      btn('dark', 'Dark', 'moon'),
    ]);
  },
};

// Menu Item Component
const MenuItem = {
  view(vnode) {
    const { item, active } = vnode.attrs;
    
    return m('a.flex.items-center.gap-3.px-3.py-2.rounded-lg.text-sm.font-medium.transition-colors', {
      href: item.path,
      class: active 
        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' 
        : 'text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700',
      onclick: (e) => {
        e.preventDefault();
        sidebarOpen = false;
        m.route.set(item.path);
      },
    }, [
      item.icon && m(Icon, { name: item.icon, class: 'w-5 h-5 flex-shrink-0' }),
      m('span.truncate', item.label),
      item.badge && m('span.ml-auto.bg-blue-100.dark:bg-blue-900/50.text-blue-600.dark:text-blue-300.text-xs.px-2.py-0.5.rounded-full', item.badge),
    ]);
  },
};

// Menu Group Component
const MenuGroup = {
  oninit(vnode) {
    vnode.state.collapsed = false;
  },

  view(vnode) {
    const { group, currentPath } = vnode.attrs;
    const { collapsed } = vnode.state;
    
    // Check if any item in group is active
    const hasActiveItem = group.items?.some(item => 
      item.path === currentPath || currentPath.startsWith(item.path + '/')
    );

    return m('div.mb-2', [
      // Group header
      group.collapsible !== false
        ? m('button.w-full.flex.items-center.gap-3.px-3.py-2.text-xs.font-semibold.text-gray-500 dark:text-slate-400.uppercase.tracking-wider.hover:text-gray-700 dark:hover:text-slate-200', {
            onclick: () => { vnode.state.collapsed = !collapsed; },
          }, [
            group.icon && m(Icon, { name: group.icon, class: 'w-4 h-4' }),
            m('span.flex-1.text-left', group.label),
            m(Icon, { 
              name: collapsed ? 'chevron-right' : 'chevron-down', 
              class: 'w-4 h-4 transition-transform' 
            }),
          ])
        : m('div.px-3.py-2.text-xs.font-semibold.text-gray-500 dark:text-slate-400.uppercase.tracking-wider', [
            group.icon && m(Icon, { name: group.icon, class: 'w-4 h-4 inline mr-2' }),
            group.label,
          ]),
      
      // Group items
      !collapsed && m('div.space-y-1.mt-1', 
        (group.items || []).map(item => 
          m(MenuItem, { 
            key: item.id, 
            item, 
            active: item.path === currentPath || currentPath.startsWith(item.path + '/'),
          })
        )
      ),
    ]);
  },
};

// Global sidebar state (shared between Sidebar, Layout, and MobileHeader)
var sidebarOpen = false;

// Sidebar Component
const Sidebar = {
  oninit(vnode) {
    vnode.state.menu = [];
    vnode.state.loading = true;
    
    // Load menu from config
    api.get('/extensions/config')
      .then(config => {
        vnode.state.menu = config.menu || [];
        vnode.state.settings = config.settings || {};
        vnode.state.loading = false;
        m.redraw();
      })
      .catch(err => {
        console.error('Failed to load menu:', err);
        vnode.state.loading = false;
        m.redraw();
      });
  },

  view(vnode) {
    const { menu, settings, loading } = vnode.state;
    const currentPath = m.route.get() || '/';
    
    return [
      // Backdrop overlay (mobile only)
      sidebarOpen && m('div.fixed.inset-0.bg-black.bg-opacity-50.z-30.lg:hidden', {
        onclick: () => { sidebarOpen = false; },
      }),

      m('aside.w-64.bg-white dark:bg-slate-800.border-r.border-gray-200 dark:border-slate-600.flex.flex-col.h-screen.fixed.left-0.top-0.z-40.transition-transform.duration-200', {
        class: sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
      }, [
        // Logo/Title
        m('div.h-16.flex.items-center.justify-between.gap-2.px-4.border-b.border-gray-200.dark:border-slate-600', [
          m('a.flex.items-center.gap-2.text-lg.font-bold.text-gray-900.dark:text-slate-100.min-w-0', {
            href: '/',
            onclick: (e) => { e.preventDefault(); sidebarOpen = false; m.route.set('/'); },
          }, [
            m('div.w-8.h-8.bg-blue-600.rounded-lg.flex.items-center.justify-center.flex-shrink-0', [
              m('span.text-white.font-bold', 'A'),
            ]),
            m('span.truncate', settings?.title || 'Admin'),
          ]),
          m('div.flex.items-center.gap-2.flex-shrink-0', [
            m(ThemeToggle),
            m('button.p-1.text-gray-400.dark:text-slate-500.hover:text-gray-600.dark:hover:text-slate-300.lg:hidden', {
              onclick: () => { sidebarOpen = false; },
            }, m(Icon, { name: 'x', class: 'w-5 h-5' })),
          ]),
        ]),

        // Menu
        m('nav.flex-1.overflow-y-auto.p-4.space-y-2', [
          loading 
            ? m('div.flex.justify-center.py-4', m(Spinner))
            : menu.map(item => 
                item.items 
                  ? m(MenuGroup, { key: item.id, group: item, currentPath })
                  : m(MenuItem, { key: item.id, item, active: item.path === currentPath })
              ),
        ]),

        // User section
        state.user && m('div.p-4.border-t.border-gray-200.dark:border-slate-600', [
          m('div.flex.items-center.gap-3', [
            m('div.w-8.h-8.bg-gray-200 dark:bg-slate-700.rounded-full.flex.items-center.justify-center', [
              m('span.text-sm.font-medium.text-gray-600.dark:text-slate-300', 
                (state.user.name || state.user.email || 'A').charAt(0).toUpperCase()
              ),
            ]),
            m('div.flex-1.min-w-0', [
              m('p.text-sm.font-medium.text-gray-900 dark:text-slate-100.truncate', state.user.name || 'Admin'),
              m('p.text-xs.text-gray-500 dark:text-slate-400.truncate', state.user.email),
            ]),
            m('button.p-1.text-gray-400 dark:text-slate-500.hover:text-gray-600 dark:hover:text-slate-300', {
              title: 'Logout',
              onclick: async () => {
                await api.post('/auth/logout');
                state.user = null;
                sidebarOpen = false;
                m.route.set('/login');
              },
            }, m(Icon, { name: 'logout', class: 'w-5 h-5' })),
          ]),
        ]),
      ]),
    ];
  },
};

// Mobile Header with hamburger button
const MobileHeader = {
  view(vnode) {
    return m('div.lg:hidden.fixed.top-0.left-0.right-0.h-14.bg-white.dark:bg-slate-800.border-b.border-gray-200.dark:border-slate-600.flex.items-center.justify-between.px-4.z-20', [
      m('div.flex.items-center.min-w-0', [
        m('button.p-2.-ml-1.text-gray-600.dark:text-slate-400.hover:text-gray-900.dark:hover:text-slate-100.rounded-lg.hover:bg-gray-100.dark:hover:bg-slate-700', {
          onclick: () => { sidebarOpen = true; },
        }, m(Icon, { name: 'menu', class: 'w-6 h-6' })),
        m('span.ml-3.text-lg.font-semibold.text-gray-900.dark:text-slate-100.truncate', 'Admin'),
      ]),
      m(ThemeToggle),
    ]);
  },
};

// Layout Component (with sidebar)
const Layout = {
  view(vnode) {
    return m('div.min-h-screen.bg-gray-50.dark:bg-slate-950', [
      m(MobileHeader),
      m(Sidebar),
      m('main.lg:ml-64.p-6.pt-20.lg:pt-6', vnode.children),
    ]);
  },
};
`;
}

module.exports = {
  registerModelMenuItems,
  registerSystemMenuItems,
  generateMenuComponent,
};

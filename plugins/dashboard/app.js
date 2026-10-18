/**
 * Dashboard Mithril.js Application
 * Components and logic for the dashboard SPA
 */

module.exports = `
// State
const state = {
  activeTab: 'routes',
  filter: 'all',
  search: '',
  routes: window.__DASHBOARD_DATA__.routes || [],
  models: window.__DASHBOARD_DATA__.models || [],
  services: window.__DASHBOARD_DATA__.services || [],
  plugins: window.__DASHBOARD_DATA__.plugins || [],
  config: window.__DASHBOARD_DATA__.config || {}
};

// Icons
const Icons = {
  logo: () => m('svg', { viewBox: '0 0 24 24', fill: 'none' }, [
    m('path', { d: 'M12 2L2 7L12 12L22 7L12 2Z', fill: 'currentColor', opacity: '0.3' }),
    m('path', { d: 'M2 17L12 22L22 17', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    m('path', { d: 'M2 12L12 17L22 12', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
  ]),
  empty: () => m('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' }, [
    m('path', { d: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' })
  ])
};

// Components
const Header = {
  view: () => m('.header', [
    m('div', [
      m('h1', [
        Icons.logo(),
        'Webspresso Dashboard'
      ]),
      m('span.dev-badge', 'development')
    ]),
    m('.header-actions', [
      m('a.action-link', { href: '/_admin', target: '_blank', rel: 'noopener' }, '⚙️ Admin Panel ↗'),
      m('a.action-link', { href: '/_swagger', target: '_blank', rel: 'noopener' }, '📖 API Docs ↗'),
      m('a.action-link', { href: '/_schema', target: '_blank', rel: 'noopener' }, '🗂️ Schema Explorer ↗')
    ])
  ])
};

const Tabs = {
  view: () => m('.tabs', [
    ['routes', 'Routes (' + state.routes.length + ')'],
    ['models', 'Models (' + state.models.length + ')'],
    ['services', 'Services (' + state.services.length + ')'],
    ['plugins', 'Plugins (' + state.plugins.length + ')'],
    ['config', 'Config']
  ].map(([id, label]) => 
    m('button.tab', {
      class: state.activeTab === id ? 'active' : '',
      onclick: () => { state.activeTab = id; }
    }, label)
  ))
};

const FilterBar = {
  view: () => m('.filter-bar', [
    m('.filter-group', [
      ['all', 'All'],
      ['ssr', 'SSR'],
      ['api', 'API']
    ].map(([id, label]) =>
      m('button.filter-btn', {
        class: state.filter === id ? 'active' : '',
        onclick: () => { state.filter = id; }
      }, label)
    )),
    m('input.search-input', {
      type: 'text',
      placeholder: 'Search routes...',
      value: state.search,
      oninput: (e) => { state.search = e.target.value; }
    })
  ])
};

const MethodBadge = {
  view: (vnode) => m('span.method-badge.method-' + (vnode.attrs.method || 'get').toLowerCase(), 
    (vnode.attrs.method || 'GET').toUpperCase()
  )
};

const TypeBadge = {
  view: (vnode) => {
    const rawType = vnode.attrs.type || 'page';
    const label = rawType === 'page' ? 'SSR' : rawType.toUpperCase();
    return m('span.type-badge.type-' + (rawType === 'page' ? 'ssr' : rawType), label);
  }
};

const RoutesTable = {
  view: () => {
    let routes = state.routes;
    
    // Apply filter: SSR matches both 'ssr' and 'page'
    if (state.filter === 'ssr') {
      routes = routes.filter(r => r.type === 'ssr' || r.type === 'page');
    } else if (state.filter === 'api') {
      routes = routes.filter(r => r.type === 'api');
    }
    
    // Apply search: checks path or pattern or file
    if (state.search) {
      const search = state.search.toLowerCase();
      routes = routes.filter(r => 
        ((r.path || r.pattern || '')).toLowerCase().includes(search) ||
        ((r.file || '')).toLowerCase().includes(search)
      );
    }
    
    if (routes.length === 0) {
      return m('.table-container', 
        m('.empty-state', [
          Icons.empty(),
          m('p', 'No routes found')
        ])
      );
    }
    
    return m('.table-container',
      m('table', [
        m('thead',
          m('tr', [
            m('th', 'Method'),
            m('th', 'Path'),
            m('th', 'File'),
            m('th', 'Type')
          ])
        ),
        m('tbody',
          routes.map(route => {
            const displayPath = route.path || route.pattern || '/';
            return m('tr', [
              m('td', m(MethodBadge, { method: route.method })),
              m('td', [
                m('span.code', displayPath),
                route.isDynamic ? m('span.dynamic-indicator', '⚡ dynamic') : null
              ]),
              m('td', m('span.file-path', route.file || 'custom')),
              m('td', m(TypeBadge, { type: route.type }))
            ]);
          })
        )
      ])
    );
  }
};

const StatsGrid = {
  view: () => {
    const ssrCount = state.routes.filter(r => r.type === 'ssr' || r.type === 'page').length;
    const apiCount = state.routes.filter(r => r.type === 'api').length;
    const dynamicCount = state.routes.filter(r => r.isDynamic).length;
    
    return m('.stats-grid', [
      m('.card', [
        m('.card-title', 'Total Routes'),
        m('.card-value', state.routes.length)
      ]),
      m('.card', [
        m('.card-title', 'SSR Pages'),
        m('.card-value', ssrCount)
      ]),
      m('.card', [
        m('.card-title', 'API Endpoints'),
        m('.card-value', apiCount)
      ]),
      m('.card', [
        m('.card-title', 'Dynamic Routes'),
        m('.card-value', dynamicCount)
      ])
    ]);
  }
};

const RoutesView = {
  view: () => m('div', [
    m(StatsGrid),
    m(FilterBar),
    m(RoutesTable)
  ])
};

const ModelsView = {
  view: () => {
    const models = state.models || [];
    if (models.length === 0) {
      return m('.table-container',
        m('.empty-state', [
          Icons.empty(),
          m('p', 'No ORM models registered in core/orm')
        ])
      );
    }

    return m('div', [
      m('.stats-grid', [
        m('.card', [
          m('.card-title', 'Total Models'),
          m('.card-value', models.length)
        ]),
        m('.card', [
          m('.card-title', 'Cached Models'),
          m('.card-value', models.filter(m => Boolean(m.cache)).length)
        ]),
        m('.card', [
          m('.card-title', 'Soft-Delete Enabled'),
          m('.card-value', models.filter(m => Boolean(m.softDelete)).length)
        ])
      ]),
      m('.table-container',
        m('table', [
          m('thead',
            m('tr', [
              m('th', 'Model'),
              m('th', 'Table'),
              m('th', 'Primary Key'),
              m('th', 'Columns'),
              m('th', 'Soft Delete'),
              m('th', 'Cache')
            ])
          ),
          m('tbody',
            models.map(mod =>
              m('tr', [
                m('td', m('strong', mod.name)),
                m('td', m('span.code-badge', mod.table)),
                m('td', m('span.badge.badge-blue', mod.primaryKey || 'id')),
                m('td', (mod.columnCount || 0) + ' columns'),
                m('td', mod.softDelete ? m('span.badge.badge-green', 'Enabled') : m('span.badge.badge-gray', 'Disabled')),
                m('td', mod.cache ? m('span.badge.badge-purple', String(mod.cache)) : m('span.badge.badge-gray', 'None'))
              ])
            )
          )
        ])
      )
    ]);
  }
};

const ServicesView = {
  view: () => {
    const services = state.services || [];
    if (services.length === 0) {
      return m('.table-container',
        m('.empty-state', [
          Icons.empty(),
          m('p', 'No services registered in services/ or ServiceRegistry')
        ])
      );
    }

    return m('div', [
      m('.stats-grid', [
        m('.card', [
          m('.card-title', 'Total Services'),
          m('.card-value', services.length)
        ]),
        m('.card', [
          m('.card-title', 'ACID Transactions'),
          m('.card-value', services.filter(s => s.transaction).length)
        ]),
        m('.card', [
          m('.card-title', 'Auth Protected'),
          m('.card-value', services.filter(s => s.auth).length)
        ])
      ]),
      m('.table-container',
        m('table', [
          m('thead',
            m('tr', [
              m('th', 'Service Name'),
              m('th', 'Transaction (ACID)'),
              m('th', 'Auth Guard'),
              m('th', 'Schema Validation')
            ])
          ),
          m('tbody',
            services.map(srv =>
              m('tr', [
                m('td', m('span.code-badge', srv.name)),
                m('td', srv.transaction ? m('span.badge.badge-green', 'Active') : m('span.badge.badge-gray', 'No')),
                m('td', srv.auth ? m('span.badge.badge-orange', String(srv.auth)) : m('span.badge.badge-gray', 'Public')),
                m('td', srv.hasSchema ? m('span.badge.badge-blue', 'Zod Schema') : m('span.badge.badge-gray', 'None'))
              ])
            )
          )
        ])
      )
    ]);
  }
};

const PluginsView = {
  view: () => {
    if (state.plugins.length === 0) {
      return m('.table-container',
        m('.empty-state', [
          Icons.empty(),
          m('p', 'No plugins loaded')
        ])
      );
    }
    
    return m('.table-container',
      state.plugins.map(plugin =>
        m('.plugin-item', [
          m('div', [
            m('.plugin-name', plugin.name),
            plugin.description ? m('p', { style: 'color: var(--text-secondary); font-size: 13px; margin-top: 4px;' }, plugin.description) : null
          ]),
          m('.plugin-version', 'v' + plugin.version)
        ])
      )
    );
  }
};

const ConfigView = {
  view: () => {
    const config = state.config;
    
    return m('div', [
      // Environment
      m('.config-section', [
        m('h3', 'Environment'),
        m('.table-container',
          Object.entries(config.env || {}).map(([key, value]) =>
            m('.config-item', [
              m('.config-key', key),
              m('.config-value', String(value))
            ])
          )
        )
      ]),
      
      // i18n
      m('.config-section', [
        m('h3', 'Internationalization'),
        m('.table-container', [
          m('.config-item', [
            m('.config-key', 'Default Locale'),
            m('.config-value', config.i18n?.defaultLocale || 'en')
          ]),
          m('.config-item', [
            m('.config-key', 'Supported Locales'),
            m('.config-value', (config.i18n?.supportedLocales || ['en']).join(', '))
          ])
        ])
      ]),
      
      // Server
      m('.config-section', [
        m('h3', 'Server'),
        m('.table-container', [
          m('.config-item', [
            m('.config-key', 'Port'),
            m('.config-value', config.server?.port || '7331')
          ]),
          m('.config-item', [
            m('.config-key', 'Base URL'),
            m('.config-value', config.server?.baseUrl || 'http://localhost:7331')
          ])
        ])
      ])
    ]);
  }
};

const App = {
  view: () => m('.dashboard', [
    m(Header),
    m(Tabs),
    state.activeTab === 'routes' ? m(RoutesView) : null,
    state.activeTab === 'models' ? m(ModelsView) : null,
    state.activeTab === 'services' ? m(ServicesView) : null,
    state.activeTab === 'plugins' ? m(PluginsView) : null,
    state.activeTab === 'config' ? m(ConfigView) : null
  ])
};

// Mount app
m.mount(document.getElementById('app'), App);
`;

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
    m('h1', [
      Icons.logo(),
      'Webspresso Dashboard'
    ]),
    m('span.dev-badge', 'development')
  ])
};

const Tabs = {
  view: () => m('.tabs', [
    ['routes', 'Routes'],
    ['plugins', 'Plugins'],
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
  view: (vnode) => m('span.method-badge.method-' + vnode.attrs.method, 
    vnode.attrs.method.toUpperCase()
  )
};

const TypeBadge = {
  view: (vnode) => m('span.type-badge.type-' + vnode.attrs.type, 
    vnode.attrs.type.toUpperCase()
  )
};

const RoutesTable = {
  view: () => {
    let routes = state.routes;
    
    // Apply filter
    if (state.filter !== 'all') {
      routes = routes.filter(r => r.type === state.filter);
    }
    
    // Apply search
    if (state.search) {
      const search = state.search.toLowerCase();
      routes = routes.filter(r => 
        r.pattern.toLowerCase().includes(search) ||
        r.file.toLowerCase().includes(search)
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
          routes.map(route =>
            m('tr', [
              m('td', m(MethodBadge, { method: route.method })),
              m('td', [
                m('span.code', route.pattern),
                route.isDynamic ? m('span.dynamic-indicator', '⚡ dynamic') : null
              ]),
              m('td', m('span.file-path', route.file)),
              m('td', m(TypeBadge, { type: route.type }))
            ])
          )
        )
      ])
    );
  }
};

const StatsGrid = {
  view: () => {
    const ssrCount = state.routes.filter(r => r.type === 'ssr').length;
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
            m('.config-value', config.server?.port || '3000')
          ]),
          m('.config-item', [
            m('.config-key', 'Base URL'),
            m('.config-value', config.server?.baseUrl || 'http://localhost:3000')
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
    state.activeTab === 'plugins' ? m(PluginsView) : null,
    state.activeTab === 'config' ? m(ConfigView) : null
  ])
};

// Mount app
m.mount(document.getElementById('app'), App);
`;


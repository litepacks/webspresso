/**
 * Admin Panel Mithril.js Application
 * Main SPA entry point
 */

const components = require('./components');

module.exports = components + `
// Set route prefix to admin path
m.route.prefix = window.__ADMIN_PATH__ || '/_admin';

// Helper to check auth status
async function checkAuth() {
  if (state.user) return true;
  
  try {
    const result = await api.get('/auth/me');
    state.user = result.user;
    return true;
  } catch (err) {
    state.user = null;
    return false;
  }
}

// Helper to check if setup is needed
async function checkSetupNeeded() {
  try {
    const checkResult = await api.get('/auth/check');
    state.needsSetup = !checkResult.exists;
    return state.needsSetup;
  } catch (err) {
    state.needsSetup = false;
    return false;
  }
}

// Site user management: menu uses /models/{userModel}*; /users* kept as aliases (redirect) + /users/sessions
function getUserManagementModel() {
  var um = window.__ADMIN_CONFIG__ && window.__ADMIN_CONFIG__.userManagement;
  if (!um || !um.enabled) return null;
  return um.model || 'User';
}

async function guardUserManagementRoutes() {
  var isAuth = await checkAuth();
  if (!isAuth) {
    m.route.set('/login');
    return false;
  }
  if (!getUserManagementModel()) {
    m.route.set('/');
    return false;
  }
  return true;
}

const UserSessionsPage = {
  oninit: async function (vnode) {
    vnode.state.loading = true;
    vnode.state.rows = [];
    vnode.state.message = null;
    vnode.state.error = null;
    try {
      var res = await api.get('/users/sessions');
      vnode.state.rows = res.data || [];
      vnode.state.message = res.message || null;
    } catch (e) {
      vnode.state.error = e.message || String(e);
    }
    vnode.state.loading = false;
    m.redraw();
  },
  view: function (vnode) {
    var rows = vnode.state.rows || [];
    var umModel = getUserManagementModel();
    var usersCrudHref = umModel ? '/models/' + encodeURIComponent(umModel) : '/';
    return m(Layout, { breadcrumbs: [{ label: 'Users', href: usersCrudHref }, { label: 'Active Sessions', href: '/users/sessions' }] }, [
      m('h2.text-2xl.font-bold.mb-4.text-gray-900.dark:text-slate-100', 'Active Sessions'),
      vnode.state.loading ? m('p.text-gray-600.dark:text-slate-400', 'Loading…') : null,
      vnode.state.error ? m('p.text-red-600.dark:text-red-400.mb-2', vnode.state.error) : null,
      vnode.state.message ? m('p.text-sm.text-gray-600.dark:text-slate-400.mb-2', vnode.state.message) : null,
      !vnode.state.loading && rows.length === 0 && !vnode.state.error
        ? m('p.text-gray-600.dark:text-slate-400', 'No remember-me sessions (or tracking not enabled).')
        : m('.overflow-x-auto.rounded-lg.border.border-gray-200.dark:border-slate-700.bg-white.dark:bg-slate-800/50', [
            m('table.min-w-full.text-sm.text-left', [
              m('thead.bg-gray-50.dark:bg-slate-900', m('tr', [
                m('th.px-3.py-2.text-xs.font-medium.text-gray-500.dark:text-slate-400.uppercase.tracking-wider', 'User'),
                m('th.px-3.py-2.text-xs.font-medium.text-gray-500.dark:text-slate-400.uppercase.tracking-wider', 'Token (prefix)'),
                m('th.px-3.py-2.text-xs.font-medium.text-gray-500.dark:text-slate-400.uppercase.tracking-wider', 'Created'),
                m('th.px-3.py-2', ''),
              ])),
              m('tbody.divide-y.divide-gray-100.dark:divide-slate-700', rows.map(function (r) {
                var tok = (r.token || '').slice(0, 12) + '…';
                return m('tr.bg-white.dark:bg-slate-800/30', [
                  m('td.px-3.py-2.text-gray-900.dark:text-slate-200', (r.user_email || r.user_id || '') + ''),
                  m('td.px-3.py-2.font-mono.text-xs.text-gray-800.dark:text-slate-300', tok),
                  m('td.px-3.py-2.text-gray-700.dark:text-slate-300', r.created_at ? new Date(r.created_at).toLocaleString() : ''),
                  m('td.px-3.py-2', m('button.text-red-600.dark:text-red-400.text-xs', {
                    onclick: async function () {
                      if (!confirm('Revoke this session?')) return;
                      try {
                        await api.delete('/users/sessions/' + encodeURIComponent(r.token));
                        vnode.state.rows = vnode.state.rows.filter(function (x) { return x.token !== r.token; });
                        m.redraw();
                      } catch (err) {
                        alert(err.message || err);
                      }
                    },
                  }, 'Revoke')),
                ]);
              })),
            ]),
          ]),
    ]);
  },
};

// Build routes
var routes = {
  '/': {
    onmatch: async () => {
      const needsSetup = await checkSetupNeeded();
      if (needsSetup) {
        return SetupForm;
      }
      const isAuth = await checkAuth();
      if (!isAuth) {
        return LoginForm;
      }
      return Dashboard;
    }
  },
  '/login': {
    onmatch: async () => {
      const isAuth = await checkAuth();
      if (isAuth) {
        m.route.set('/');
        return;
      }
      return LoginForm;
    }
  },
  '/setup': {
    onmatch: async () => {
      const needsSetup = await checkSetupNeeded();
      if (!needsSetup) {
        m.route.set('/login');
        return;
      }
      return SetupForm;
    }
  },
  '/settings': {
    onmatch: async () => {
      const isAuth = await checkAuth();
      if (!isAuth) {
        m.route.set('/login');
        return;
      }
      return SettingsPage;
    }
  },
  '/users/sessions': {
    onmatch: async () => {
      if (!(await guardUserManagementRoutes())) return;
      return UserSessionsPage;
    }
  },
  '/users/new': {
    onmatch: async () => {
      if (!(await guardUserManagementRoutes())) return;
      var model = getUserManagementModel();
      m.route.set('/models/' + encodeURIComponent(model) + '/new');
    }
  },
  '/users/:id/edit': {
    onmatch: async () => {
      if (!(await guardUserManagementRoutes())) return;
      var model = getUserManagementModel();
      var id = m.route.param('id');
      m.route.set('/models/' + encodeURIComponent(model) + '/edit/' + encodeURIComponent(id));
    }
  },
  '/users': {
    onmatch: async () => {
      if (!(await guardUserManagementRoutes())) return;
      var model = getUserManagementModel();
      m.route.set('/models/' + encodeURIComponent(model));
    }
  },
  '/models/:model': {
    onmatch: async () => {
      const isAuth = await checkAuth();
      if (!isAuth) {
        m.route.set('/login');
        return;
      }
      return RecordList;
    }
  },
  '/models/:model/new': {
    onmatch: async () => {
      const isAuth = await checkAuth();
      if (!isAuth) {
        m.route.set('/login');
        return;
      }
      return RecordForm;
    }
  },
  '/models/:model/edit/:id': {
    onmatch: async () => {
      const isAuth = await checkAuth();
      if (!isAuth) {
        m.route.set('/login');
        return;
      }
      return RecordForm;
    }
  },
};

// Dynamic routes for custom pages registered via plugins
var config = window.__ADMIN_CONFIG__;
if (config && config.pages) {
  config.pages.forEach(function(page) {
    if (!routes[page.path]) {
      routes[page.path] = {
        onmatch: async () => {
          const isAuth = await checkAuth();
          if (!isAuth) {
            m.route.set('/login');
            return;
          }
          if (window.__customPages && window.__customPages[page.id]) {
            return window.__customPages[page.id];
          }
          return createCustomPage(page);
        }
      };
    }
  });
}

m.route(document.getElementById('app'), '/', routes);
`;

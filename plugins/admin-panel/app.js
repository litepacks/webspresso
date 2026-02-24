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

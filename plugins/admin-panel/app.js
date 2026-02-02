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

// Router
m.route(document.getElementById('app'), '/', {
  '/': {
    onmatch: async () => {
      // Check if setup is needed first
      const needsSetup = await checkSetupNeeded();
      if (needsSetup) {
        return SetupForm;
      }
      
      // Check if user is authenticated
      const isAuth = await checkAuth();
      if (!isAuth) {
        return LoginForm;
      }
      return ModelList;
    }
  },
  '/login': {
    onmatch: async () => {
      // If already logged in, redirect to home
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
      // If admin exists, redirect to login
      const needsSetup = await checkSetupNeeded();
      if (!needsSetup) {
        m.route.set('/login');
        return;
      }
      return SetupForm;
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
});
`;

/**
 * Admin Panel Mithril.js Application
 * Main SPA entry point
 */

const components = require('./components');

module.exports = components + `
// Router
m.route(document.getElementById('app'), '/', {
  '/': {
    onmatch: async () => {
      // Check if user is authenticated
      try {
        const result = await api.get('/auth/me');
        state.user = result.user;
      } catch (err) {
        state.user = null;
      }
      
      // Check if setup is needed
      try {
        const checkResult = await api.get('/auth/check');
        state.needsSetup = !checkResult.exists;
      } catch (err) {
        state.needsSetup = false;
      }
      
      if (state.needsSetup) {
        return SetupForm;
      }
      if (!state.user) {
        return LoginForm;
      }
      return ModelList;
    }
  },
  '/login': LoginForm,
  '/setup': SetupForm,
  '/models/:model': {
    onmatch: async (params) => {
      if (!state.user) {
        m.route.set('/login');
        return;
      }
      return RecordList;
    }
  },
  '/models/:model/new': {
    onmatch: async (params) => {
      if (!state.user) {
        m.route.set('/login');
        return;
      }
      return RecordForm;
    }
  },
  '/models/:model/edit/:id': {
    onmatch: async (params) => {
      if (!state.user) {
        m.route.set('/login');
        return;
      }
      return RecordForm;
    }
  },
});
`;

/**
 * Admin Panel Plugin
 * Lightweight CRUD admin panel for Webspresso models
 * @module plugins/admin-panel
 */

const { createAdminUserModel } = require('./admin-user-model');
const { generateAdminUsersMigration } = require('./migration-template');
const { createApiHandlers } = require('./api');
const { requireAuth, optionalAuth } = require('./auth');

/**
 * Admin Panel Plugin Factory
 * @param {Object} options - Plugin options
 * @param {string} [options.path='/_admin'] - Admin panel path
 * @param {boolean} [options.enabled=true] - Enable/disable plugin
 * @param {string} [options.sessionSecret] - Session secret (default: random)
 * @param {Object} [options.db] - Database instance (required)
 * @returns {Object} Plugin definition
 */
function adminPanelPlugin(options = {}) {
  const {
    path: adminPath = '/_admin',
    enabled = true,
    sessionSecret,
    db,
  } = options;

  // Validate required options
  if (!db) {
    throw new Error('Admin panel plugin requires a database instance. Pass `db` in options.');
  }

  // Dependencies are now in main package
  const session = require('express-session');
  const bcrypt = require('bcrypt');

  return {
    name: 'admin-panel',
    version: '1.0.0',
    description: 'Lightweight CRUD admin panel for Webspresso models',
    enabled,

    /**
     * Register hook - called when plugin is registered
     */
    register(ctx) {
      // Ensure enabled is set
      this.enabled = enabled;
    },

    /**
     * Routes ready hook - called after routes are mounted
     */
    onRoutesReady(ctx) {
      // Use closure variable 'enabled' directly (plugin.enabled property)
      if (!enabled) {
        return;
      }

      const { app } = ctx;
      
      // Create and register AdminUser model
      // Check global registry first (defineModel adds to global registry)
      const { hasModel: hasGlobalModel, getModel: getGlobalModel } = require('../../core/orm/model');
      let AdminUser;
      
      if (hasGlobalModel('AdminUser')) {
        // Model exists in global registry
        AdminUser = getGlobalModel('AdminUser');
        // Ensure it's also in db's local registry
        if (!db.hasModel('AdminUser')) {
          db.registerModel(AdminUser);
        }
      } else {
        // Create AdminUser model (adds to global registry)
        AdminUser = createAdminUserModel();
        // Also add to db's local registry
        db.registerModel(AdminUser);
      }

      // Setup session middleware (only once, even if multiple plugins)
      // Check if session middleware is already registered
      if (!app._webspressoSessionInitialized) {
        const sessionSecret = options.sessionSecret || process.env.SESSION_SECRET || 'webspresso-admin-secret-change-in-production';
        
        app.use(session({
          secret: sessionSecret,
          resave: false,
          saveUninitialized: false,
          cookie: {
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
          },
        }));
        
        app._webspressoSessionInitialized = true;
      }

      // Create API handlers
      const apiHandlers = createApiHandlers({
        path: adminPath,
        db,
        AdminUser,
        hashPassword: (password, rounds) => bcrypt.hash(password, rounds),
        comparePassword: (password, hash) => bcrypt.compare(password, hash),
      });

      // Auth API routes (no auth required)
      ctx.addRoute('get', `${adminPath}/api/auth/check`, apiHandlers.checkHandler);
      ctx.addRoute('post', `${adminPath}/api/auth/setup`, apiHandlers.setupHandler);
      ctx.addRoute('post', `${adminPath}/api/auth/login`, apiHandlers.loginHandler);
      ctx.addRoute('post', `${adminPath}/api/auth/logout`, requireAuth, apiHandlers.logoutHandler);
      ctx.addRoute('get', `${adminPath}/api/auth/me`, requireAuth, apiHandlers.meHandler);

      // Debug/Test routes (no auth, TEST ENV ONLY)
      ctx.addRoute('post', `${adminPath}/api/debug/reset`, apiHandlers.resetHandler);

      // Model API routes (auth required)
      ctx.addRoute('get', `${adminPath}/api/models`, requireAuth, apiHandlers.modelsHandler);
      ctx.addRoute('get', `${adminPath}/api/models/:model`, requireAuth, apiHandlers.modelHandler);

      // Record API routes (auth required)
      ctx.addRoute('get', `${adminPath}/api/models/:model/records`, requireAuth, apiHandlers.recordsListHandler);
      ctx.addRoute('get', `${adminPath}/api/models/:model/records/:id`, requireAuth, apiHandlers.recordHandler);
      ctx.addRoute('post', `${adminPath}/api/models/:model/records`, requireAuth, apiHandlers.createRecordHandler);
      ctx.addRoute('put', `${adminPath}/api/models/:model/records/:id`, requireAuth, apiHandlers.updateRecordHandler);
      ctx.addRoute('delete', `${adminPath}/api/models/:model/records/:id`, requireAuth, apiHandlers.deleteRecordHandler);

      // Relation API routes (auth required)
      ctx.addRoute('get', `${adminPath}/api/models/:model/relations/:relation`, requireAuth, apiHandlers.relationHandler);

      // Query API routes (auth required)
      ctx.addRoute('get', `${adminPath}/api/models/:model/queries/:query`, requireAuth, apiHandlers.queryHandler);

      // Admin panel HTML endpoint (optional auth - frontend handles routing)
      // This serves the SPA for all admin panel routes
      // IMPORTANT: These routes must be added AFTER all API routes
      // Express matches routes in order, so more specific routes (API) come first
      const serveAdminPanel = (req, res) => {
        res.type('text/html');
        res.send(generateAdminPanelHtml(adminPath));
      };
      
      // Root admin path
      ctx.addRoute('get', adminPath, optionalAuth, serveAdminPanel);
      
      // Catch-all route for admin panel SPA routes (everything under /_admin except /api)
      // This allows Mithril.js to handle client-side routing
      // Express matches routes in order, so API routes (added above) will match first
      // IMPORTANT: More specific routes must be added BEFORE less specific ones
      // So /models/:model/new comes before /models/:model
      ctx.addRoute('get', adminPath + '/login', optionalAuth, serveAdminPanel);
      ctx.addRoute('get', adminPath + '/setup', optionalAuth, serveAdminPanel);
      ctx.addRoute('get', adminPath + '/models/:model/edit/:id', optionalAuth, serveAdminPanel);
      ctx.addRoute('get', adminPath + '/models/:model/new', optionalAuth, serveAdminPanel);
      ctx.addRoute('get', adminPath + '/models/:model', optionalAuth, serveAdminPanel);
      

      // Log admin panel URL
      console.log(`\n🔐 Admin Panel available at: http://localhost:${process.env.PORT || 3000}${adminPath}\n`);
    },

    /**
     * Get migration template for admin_users table
     */
    getMigrationTemplate() {
      return generateAdminUsersMigration();
    },
  };
}

/**
 * Generate admin panel HTML
 * @param {string} adminPath - Admin panel path
 * @returns {string} HTML content
 */
function generateAdminPanelHtml(adminPath) {
  const appScript = require('./app');
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Panel</title>
  <script src="https://unpkg.com/mithril/mithril.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script>
    window.__ADMIN_PATH__ = ${JSON.stringify(adminPath)};
  </script>
  <script>${appScript}</script>
</body>
</html>`;
}

module.exports = adminPanelPlugin;

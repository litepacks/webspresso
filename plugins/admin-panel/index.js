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

  // Check for peer dependencies
  let session = null;
  let bcrypt = null;

  try {
    session = require('express-session');
  } catch (e) {
    throw new Error(
      'Admin panel plugin requires express-session. Install it with: npm install express-session'
    );
  }

  try {
    bcrypt = require('bcrypt');
  } catch (e) {
    throw new Error(
      'Admin panel plugin requires bcrypt. Install it with: npm install bcrypt'
    );
  }

  return {
    name: 'admin-panel',
    version: '1.0.0',
    description: 'Lightweight CRUD admin panel for Webspresso models',
    enabled,

    /**
     * Register hook - called when plugin is registered
     */
    async register(ctx) {
      // Create and register AdminUser model
      const AdminUser = createAdminUserModel();

      // Store in plugin context for later use
      this._adminUser = AdminUser;
      this._db = db;
      this._bcrypt = bcrypt;
      this._session = session;
      this._adminPath = adminPath;
    },

    /**
     * Routes ready hook - called after routes are mounted
     */
    onRoutesReady(ctx) {
      if (!this.enabled) {
        return;
      }

      const { app } = ctx;
      const AdminUser = this._adminUser;
      const db = this._db;
      const bcrypt = this._bcrypt;
      const session = this._session;

      // Setup session middleware
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
      ctx.addRoute('get', adminPath, optionalAuth, (req, res) => {
        // This will be handled by Mithril SPA
        // For now, return a simple HTML that loads the SPA
        res.type('text/html');
        res.send(generateAdminPanelHtml(adminPath));
      });

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

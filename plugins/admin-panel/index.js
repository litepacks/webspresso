/**
 * Admin Panel Plugin
 * Lightweight CRUD admin panel for Webspresso models
 * @module plugins/admin-panel
 */

const { createAdminUserModel } = require('./admin-user-model');
const { generateAdminUsersMigration } = require('./migration-template');
const { createApiHandlers } = require('./api');
const { requireAuth, optionalAuth } = require('./auth');
const { AdminRegistry, defaultRegistry } = require('./core/registry');
const { createExtensionApiHandlers } = require('./core/api-extensions');
const { registerUserManagement, createUserManagementApiHandlers } = require('./modules/user-management');
const { registerDashboardWidgets, generateDashboardComponent } = require('./modules/dashboard');
const { registerDefaultBulkActions, generateBulkActionsComponent } = require('./modules/bulk-actions');
const { registerDefaultPages, createCustomPageApiHandlers, generateCustomPageComponent } = require('./modules/custom-pages');
const { registerModelMenuItems, registerSystemMenuItems, generateMenuComponent } = require('./modules/menu');
const { registerModule } = require('./core/admin-module');

/**
 * Admin Panel Plugin Factory
 * @param {Object} options - Plugin options
 * @param {string} [options.path='/_admin'] - Admin panel path
 * @param {boolean} [options.enabled=true] - Enable/disable plugin
 * @param {string} [options.sessionSecret] - Session secret (default: random)
 * @param {Object} [options.db] - Database instance (required)
 * @param {Object} [options.auth] - Auth manager instance (optional, for user management)
 * @param {Object} [options.userManagement] - User management config
 * @param {boolean} [options.userManagement.enabled=false] - Enable user management
 * @param {string} [options.userManagement.model='User'] - User model name
 * @param {Object} [options.userManagement.fields] - Field mappings
 * @param {Function} [options.configure] - Configuration callback (registry) => void
 * @returns {Object} Plugin definition
 */
function adminPanelPlugin(options = {}) {
  const {
    path: adminPath = '/_admin',
    enabled = true,
    sessionSecret,
    db,
    auth,
    userManagement: userMgmtConfig,
    configure,
  } = options;

  // Validate required options
  if (!db) {
    throw new Error('Admin panel plugin requires a database instance. Pass `db` in options.');
  }

  // Create fresh registry for this plugin instance
  const registry = new AdminRegistry();

  // Dependencies are now in main package
  const session = require('express-session');
  const bcrypt = require('bcrypt');

  const serveAdminPanel = (req, res) => {
    res.type('text/html');
    res.send(generateAdminPanelHtml(adminPath, registry));
  };

  return {
    name: 'admin-panel',
    version: '2.0.0',
    description: 'Modular admin panel for Webspresso with extensions support',
    
    // CSP requirements for admin panel scripts
    // Note: cdn.quilljs.com 301-redirects to cdn.jsdelivr.net; CSP is enforced on the final URL.
    csp: {
      styleSrc: ['https://cdn.quilljs.com', 'https://cdn.jsdelivr.net'],
      scriptSrc: [
        'https://cdn.quilljs.com',
        'https://cdn.jsdelivr.net',
        'https://unpkg.com',
        'https://cdn.tailwindcss.com',
      ],
      connectSrc: ['https://unpkg.com', 'https://cdn.tailwindcss.com', 'https://cdn.jsdelivr.net'],
    },
    enabled,
    registry, // Expose registry for external configuration

    api: {
      getRegistry() { return registry; },
      getAdminPath() { return adminPath; },
      serveAdminPanel,
      requireAuth,
      optionalAuth,
      registerModule(config) {
        // When bound to plugin, "this" is the plugin; _ctx lives on this.api
        const ctx = this.api?._ctx ?? this._ctx;
        if (!ctx) {
          throw new Error('registerModule can only be called during or after onRoutesReady');
        }
        return registerModule(config, {
          registry,
          adminPath,
          ctx,
          requireAuth,
          optionalAuth,
          serveAdminPanel,
        });
      },
      _ctx: null,
    },

    /**
     * Register hook - called when plugin is registered
     */
    register(ctx) {
      // Ensure enabled is set
      this.enabled = enabled;

      // Run user configuration callback if provided
      if (typeof configure === 'function') {
        configure(registry);
      }
    },

    /**
     * Routes ready hook - called after routes are mounted
     */
    onRoutesReady(ctx) {
      if (!enabled) {
        return;
      }

      this.api._ctx = ctx;
      const { app } = ctx;

      // Check if admin_users table exists (migration run)
      db.knex.schema.hasTable('admin_users').then((hasAdminTable) => {
        if (!hasAdminTable) {
          console.warn(
            '\n⚠️  [admin-panel] admin_users table not found. Run: webspresso admin:setup\n' +
            '   Or create the table manually via migration. See: AdminUser model / getMigrationTemplate()\n'
          );
        }
      }).catch((err) => {
        console.warn('[admin-panel] Could not check admin_users table:', err.message);
      });

      // Create and register AdminUser model
      const { hasModel: hasGlobalModel, getModel: getGlobalModel } = require('../../core/orm/model');
      let AdminUser;

      if (hasGlobalModel('AdminUser')) {
        AdminUser = getGlobalModel('AdminUser');
        if (!db.hasModel('AdminUser')) {
          db.registerModel(AdminUser);
        }
      } else {
        AdminUser = createAdminUserModel();
        db.registerModel(AdminUser);
      }

      // Setup session middleware (only once)
      if (!app._webspressoSessionInitialized) {
        const secret = sessionSecret || process.env.SESSION_SECRET || 'webspresso-admin-secret-change-in-production';

        app.use(session({
          secret,
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

      // Register default modules
      registerSystemMenuItems({ registry });
      registerModelMenuItems({ registry, db });
      registerDashboardWidgets({ registry, db });
      registerDefaultBulkActions({ registry, db });
      registerDefaultPages({ registry, db });

      // Register user management if enabled
      if (userMgmtConfig?.enabled) {
        registerUserManagement({
          registry,
          db,
          auth,
          config: userMgmtConfig,
        });
      }

      // Create API handlers
      const apiHandlers = createApiHandlers({
        path: adminPath,
        db,
        AdminUser,
        hashPassword: (password, rounds) => bcrypt.hash(password, rounds),
        comparePassword: (password, hash) => bcrypt.compare(password, hash),
      });

      const extensionHandlers = createExtensionApiHandlers({
        registry,
        db,
        auth,
      });

      const pageHandlers = createCustomPageApiHandlers({ registry, db });

      // User management API handlers
      let userHandlers = null;
      if (userMgmtConfig?.enabled) {
        userHandlers = createUserManagementApiHandlers({
          db,
          config: userMgmtConfig,
          auth,
        });
      }

      // ==========================================
      // API Routes
      // ==========================================

      // Auth API routes (no auth required)
      ctx.addRoute('get', `${adminPath}/api/auth/check`, apiHandlers.checkHandler);
      ctx.addRoute('post', `${adminPath}/api/auth/setup`, apiHandlers.setupHandler);
      ctx.addRoute('post', `${adminPath}/api/auth/login`, apiHandlers.loginHandler);
      ctx.addRoute('post', `${adminPath}/api/auth/logout`, requireAuth, apiHandlers.logoutHandler);
      ctx.addRoute('get', `${adminPath}/api/auth/me`, requireAuth, apiHandlers.meHandler);

      // Extensions API routes
      ctx.addRoute('get', `${adminPath}/api/extensions/config`, requireAuth, extensionHandlers.configHandler);
      ctx.addRoute('get', `${adminPath}/api/extensions/widgets/:widgetId/data`, requireAuth, extensionHandlers.widgetDataHandler);
      ctx.addRoute('get', `${adminPath}/api/extensions/dashboard/stats`, requireAuth, extensionHandlers.dashboardStatsHandler);
      ctx.addRoute('post', `${adminPath}/api/extensions/actions/:actionId/:model/:id`, requireAuth, extensionHandlers.actionHandler);
      ctx.addRoute('post', `${adminPath}/api/extensions/bulk-actions/:actionId/:model`, requireAuth, extensionHandlers.bulkActionHandler);
      ctx.addRoute('get', `${adminPath}/api/extensions/bulk-fields/:model`, requireAuth, extensionHandlers.bulkFieldsHandler);
      ctx.addRoute('post', `${adminPath}/api/extensions/bulk-update/:model`, requireAuth, extensionHandlers.bulkUpdateFieldHandler);
      ctx.addRoute('get', `${adminPath}/api/extensions/export/:model`, requireAuth, extensionHandlers.exportHandler);
      ctx.addRoute('get', `${adminPath}/api/extensions/export`, requireAuth, extensionHandlers.exportHandler);
      ctx.addRoute('post', `${adminPath}/api/extensions/export/:model`, requireAuth, extensionHandlers.exportHandler);
      ctx.addRoute('post', `${adminPath}/api/extensions/export`, requireAuth, extensionHandlers.exportHandler);
      ctx.addRoute('get', `${adminPath}/api/extensions/activity`, requireAuth, extensionHandlers.activityLogHandler);
      
      // Settings API routes
      ctx.addRoute('get', `${adminPath}/api/extensions/settings`, requireAuth, extensionHandlers.settingsGetHandler);
      ctx.addRoute('post', `${adminPath}/api/extensions/settings`, requireAuth, extensionHandlers.settingsUpdateHandler);

      // Custom pages API routes
      ctx.addRoute('get', `${adminPath}/api/extensions/pages/:pageId/data`, requireAuth, pageHandlers.getPageData);
      ctx.addRoute('post', `${adminPath}/api/extensions/pages/:pageId/actions/:actionId`, requireAuth, pageHandlers.executePageAction);

      // User management API routes
      if (userHandlers) {
        ctx.addRoute('get', `${adminPath}/api/users`, requireAuth, userHandlers.listUsers);
        ctx.addRoute('get', `${adminPath}/api/users/:id`, requireAuth, userHandlers.getUser);
        ctx.addRoute('post', `${adminPath}/api/users`, requireAuth, userHandlers.createUser);
        ctx.addRoute('put', `${adminPath}/api/users/:id`, requireAuth, userHandlers.updateUser);
        ctx.addRoute('delete', `${adminPath}/api/users/:id`, requireAuth, userHandlers.deleteUser);
        ctx.addRoute('get', `${adminPath}/api/users/sessions`, requireAuth, userHandlers.getSessions);
        ctx.addRoute('delete', `${adminPath}/api/users/sessions/:token`, requireAuth, userHandlers.revokeSession);
        ctx.addRoute('delete', `${adminPath}/api/users/:userId/sessions`, requireAuth, userHandlers.revokeUserSessions);
      }

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
      ctx.addRoute('post', `${adminPath}/api/models/:model/records/:id/restore`, requireAuth, apiHandlers.restoreRecordHandler);

      // Relation API routes (auth required)
      ctx.addRoute('get', `${adminPath}/api/models/:model/relations/:relation`, requireAuth, apiHandlers.relationHandler);

      // Query API routes (auth required)
      ctx.addRoute('get', `${adminPath}/api/models/:model/queries/:query`, requireAuth, apiHandlers.queryHandler);

      // ==========================================
      // HTML Endpoints
      // ==========================================

      // Root admin path
      ctx.addRoute('get', adminPath, optionalAuth, serveAdminPanel);

      // SPA routes
      ctx.addRoute('get', adminPath + '/login', optionalAuth, serveAdminPanel);
      ctx.addRoute('get', adminPath + '/setup', optionalAuth, serveAdminPanel);
      ctx.addRoute('get', adminPath + '/settings', optionalAuth, serveAdminPanel);
      ctx.addRoute('get', adminPath + '/users', optionalAuth, serveAdminPanel);
      ctx.addRoute('get', adminPath + '/users/new', optionalAuth, serveAdminPanel);
      ctx.addRoute('get', adminPath + '/users/sessions', optionalAuth, serveAdminPanel);
      ctx.addRoute('get', adminPath + '/users/:id/edit', optionalAuth, serveAdminPanel);
      ctx.addRoute('get', adminPath + '/models/:model/edit/:id', optionalAuth, serveAdminPanel);
      ctx.addRoute('get', adminPath + '/models/:model/new', optionalAuth, serveAdminPanel);
      ctx.addRoute('get', adminPath + '/models/:model', optionalAuth, serveAdminPanel);

      // Custom pages
      for (const page of registry.getPages()) {
        ctx.addRoute('get', adminPath + page.path, optionalAuth, serveAdminPanel);
      }

      // Log admin panel URL
      console.log(`\n🔐 Admin Panel v2.0 available at: http://localhost:${process.env.PORT || 3000}${adminPath}\n`);
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
 * @param {AdminRegistry} registry - Admin registry instance
 * @returns {string} HTML content
 */
function generateAdminPanelHtml(adminPath, registry) {
  const appScript = require('./app');
  const menuComponent = generateMenuComponent();
  const dashboardComponent = generateDashboardComponent();
  const bulkActionsComponent = generateBulkActionsComponent();
  const customPageComponent = generateCustomPageComponent();

  const settings = registry.settings;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${settings.title || 'Admin Panel'}</title>
  <script>
  (function () {
    var K = 'webspresso-admin-theme';
    function sync() {
      try {
        var v = localStorage.getItem(K);
        var dark = (v === 'dark') || ((v !== 'light') && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.classList.toggle('dark', dark);
      } catch (e) {}
    }
    sync();
    window.__syncAdminTheme = sync;
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
        var v = localStorage.getItem(K);
        if (v === 'light' || v === 'dark') return;
        sync();
      });
    } catch (e) {}
  })();
  </script>
  <script src="https://unpkg.com/mithril/mithril.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>tailwind.config = { darkMode: 'class' };</script>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
    html.dark { color-scheme: dark; }
    :root {
      --primary-color: ${settings.primaryColor || '#3B82F6'};
    }
    .bg-primary { background-color: var(--primary-color); }
    .text-primary { color: var(--primary-color); }
    .border-primary { border-color: var(--primary-color); }
    .dark .ql-toolbar.ql-snow { border-color: #475569; background: #1e293b; }
    .dark .ql-container.ql-snow { border-color: #475569; background: #0f172a; }
    .dark .ql-editor { color: #f1f5f9; min-height: 8rem; }
    .dark .ql-snow .ql-stroke { stroke: #94a3b8; }
    .dark .ql-snow .ql-fill { fill: #94a3b8; }
    .dark .ql-picker { color: #cbd5e1; }
  </style>
</head>
<body class="min-h-screen bg-gray-50 dark:bg-slate-950 text-gray-900 dark:text-slate-100 antialiased">
  <div id="app"></div>
  <script>
    window.__ADMIN_PATH__ = ${JSON.stringify(adminPath)};
    window.__ADMIN_CONFIG__ = ${JSON.stringify(registry.toClientConfig())};
  </script>
  <script>
    // Helper functions
    function formatDate(dateStr) {
      if (!dateStr) return '';
      const date = new Date(dateStr);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Spinner Component
    const Spinner = {
      view: () => m('div.animate-spin.rounded-full.h-6.w-6.border-2.border-blue-500.dark:border-blue-400.border-t-transparent'),
    };

    ${menuComponent}
    ${dashboardComponent}
    ${bulkActionsComponent}
    ${customPageComponent}

    // Custom page components container
    window.__customPages = window.__customPages || {};
    ${registry.getClientComponents()}
  </script>
  <script>${appScript}</script>
</body>
</html>`;
}

// Export registry and utilities for external use
module.exports = adminPanelPlugin;
module.exports.AdminRegistry = AdminRegistry;
module.exports.defaultRegistry = defaultRegistry;
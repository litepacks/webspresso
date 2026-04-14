/**
 * Admin Module Registration System
 * Declarative API for registering admin pages, menu items, API routes, and widgets
 * @module plugins/admin-panel/core/admin-module
 */

/**
 * Register an admin module with all its components in a single declarative call
 * @param {Object} config - Module configuration
 * @param {string} config.id - Unique module identifier (required)
 * @param {Array} [config.pages] - Custom admin pages
 * @param {Array} [config.menu] - Sidebar menu items
 * @param {Object} [config.menuGroups] - Menu group definitions
 * @param {Object} [config.api] - API endpoint definitions
 * @param {Array} [config.widgets] - Dashboard widgets
 * @param {Object} deps - Internal dependencies injected by admin-panel
 * @param {Object} deps.registry - AdminRegistry instance
 * @param {string} deps.adminPath - Admin panel base path
 * @param {Object} deps.ctx - Plugin context
 * @param {Function} deps.requireAuth - Auth middleware
 * @param {Function} deps.optionalAuth - Optional auth middleware
 * @param {Function} deps.serveAdminPanel - SPA HTML handler
 */
function registerModule(config, deps) {
  if (!config || typeof config !== 'object') {
    throw new Error('registerModule requires a config object');
  }

  if (!config.id || typeof config.id !== 'string') {
    throw new Error('registerModule requires a string "id" field');
  }

  const { registry, adminPath, ctx, requireAuth, optionalAuth, serveAdminPanel } = deps;

  if (config.menuGroups) {
    registerMenuGroups(config.menuGroups, registry);
  }

  if (config.pages) {
    registerPages(config.id, config.pages, { registry, adminPath, ctx, optionalAuth, serveAdminPanel });
  }

  if (config.menu) {
    registerMenuItems(config.menu, registry);
  }

  if (config.api) {
    registerApiRoutes(config.id, config.api, { adminPath, ctx, requireAuth, optionalAuth });
  }

  if (config.widgets) {
    registerWidgets(config.widgets, registry);
  }
}

function registerPages(moduleId, pages, deps) {
  if (!Array.isArray(pages)) {
    throw new Error(`Module "${moduleId}": pages must be an array`);
  }

  const { registry, adminPath, ctx, optionalAuth, serveAdminPanel } = deps;

  for (const page of pages) {
    const pageId = page.id || moduleId;

    if (!page.title || !page.path) {
      throw new Error(`Module "${moduleId}", page "${pageId}": requires title and path`);
    }

    registry.registerPage(pageId, {
      title: page.title,
      path: page.path,
      icon: page.icon,
      description: page.description,
      permission: page.permission,
    });

    if (page.component) {
      registry.registerClientComponent(pageId, page.component);
    }

    ctx.addRoute('get', `${adminPath}${page.path}`, optionalAuth, serveAdminPanel);
  }
}

function registerMenuItems(menu, registry) {
  if (!Array.isArray(menu)) {
    throw new Error('menu must be an array');
  }

  for (const item of menu) {
    registry.registerMenuItem(item);
  }
}

function registerMenuGroups(menuGroups, registry) {
  if (typeof menuGroups !== 'object' || Array.isArray(menuGroups)) {
    throw new Error('menuGroups must be an object');
  }

  for (const [id, config] of Object.entries(menuGroups)) {
    registry.registerMenuGroup(id, config);
  }
}

function registerApiRoutes(moduleId, apiConfig, deps) {
  if (typeof apiConfig !== 'object') {
    throw new Error(`Module "${moduleId}": api must be an object`);
  }

  const { adminPath, ctx, requireAuth, optionalAuth } = deps;
  const prefix = apiConfig.prefix || '';
  const defaultAuth = apiConfig.auth !== false;

  if (!Array.isArray(apiConfig.routes)) {
    throw new Error(`Module "${moduleId}": api.routes must be an array`);
  }

  for (const route of apiConfig.routes) {
    if (typeof route.path !== 'string' || typeof route.handler !== 'function') {
      throw new Error(`Module "${moduleId}": each API route requires path (string, use "" for prefix root) and handler`);
    }

    const method = (route.method || 'get').toLowerCase();
    const fullPath = `${adminPath}/api${prefix}${route.path}`;
    const useAuth = route.auth !== undefined ? route.auth : defaultAuth;
    const authMiddleware = useAuth ? requireAuth : optionalAuth;

    ctx.addRoute(method, fullPath, authMiddleware, route.handler);
  }
}

function registerWidgets(widgets, registry) {
  if (!Array.isArray(widgets)) {
    throw new Error('widgets must be an array');
  }

  for (const widget of widgets) {
    if (!widget.id) {
      throw new Error('Each widget requires an id');
    }
    registry.registerWidget(widget.id, widget);
  }
}

module.exports = { registerModule };

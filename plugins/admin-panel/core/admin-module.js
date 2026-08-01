const fs = require('fs');
const path = require('path');

/**
 * Format client component code to ensure it assigns to window.__customPages[pageId]
 */
function formatClientComponent(pageId, rawCode) {
  let code = (rawCode || '').trim();
  if (!code) return '';
  if (code.includes('window.__customPages')) {
    return code;
  }
  if (code.startsWith('module.exports =')) {
    code = code.replace(/^module\.exports\s*=\s*/, '');
  }
  if (code.endsWith(';')) {
    code = code.slice(0, -1);
  }
  return `window.__customPages = window.__customPages || {};\nwindow.__customPages[${JSON.stringify(pageId)}] = ${code};`;
}

/**
 * Load page definitions and components from a directory structure
 */
function loadPagesFromDir(dirPath) {
  const resolvedDir = path.resolve(dirPath);
  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`pagesDir directory not found: ${dirPath}`);
  }
  const stat = fs.statSync(resolvedDir);
  if (!stat.isDirectory()) {
    throw new Error(`pagesDir path is not a directory: ${dirPath}`);
  }

  const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
  const pages = [];
  const menuItems = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    let pageConfig = null;
    let componentFile = null;

    if (entry.isDirectory()) {
      const folderPath = path.join(resolvedDir, entry.name);
      const jsonCandidate = path.join(folderPath, 'page.json');
      const configJsonCandidate = path.join(folderPath, 'config.json');

      if (fs.existsSync(jsonCandidate)) {
        pageConfig = JSON.parse(fs.readFileSync(jsonCandidate, 'utf8'));
      } else if (fs.existsSync(configJsonCandidate)) {
        pageConfig = JSON.parse(fs.readFileSync(configJsonCandidate, 'utf8'));
      } else {
        pageConfig = { id: entry.name, title: entry.name, path: '/' + entry.name };
      }

      const jsCandidates = ['component.js', 'index.js', 'page.js', `${entry.name}.js`];
      for (const cand of jsCandidates) {
        const fullCandPath = path.join(folderPath, cand);
        if (fs.existsSync(fullCandPath)) {
          componentFile = fullCandPath;
          break;
        }
      }
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      const jsonPath = path.join(resolvedDir, entry.name);
      pageConfig = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const baseName = entry.name.slice(0, -5);
      const jsCandidate = path.join(resolvedDir, baseName + '.js');
      if (fs.existsSync(jsCandidate)) {
        componentFile = jsCandidate;
      }
    }

    if (pageConfig) {
      if (componentFile && !pageConfig.componentFile) {
        pageConfig.componentFile = componentFile;
      }
      if (pageConfig.menu) {
        if (pageConfig.menu === true) {
          menuItems.push({
            id: pageConfig.id,
            label: pageConfig.title,
            path: pageConfig.path,
            icon: pageConfig.icon,
          });
        } else if (typeof pageConfig.menu === 'object') {
          menuItems.push({
            id: pageConfig.id,
            label: pageConfig.title,
            path: pageConfig.path,
            icon: pageConfig.icon,
            ...pageConfig.menu,
          });
        }
      }
      pages.push(pageConfig);
    }
  }

  return { pages, menuItems };
}

/**
 * Register an admin module with all its components in a single declarative call
 * @param {Object} config - Module configuration
 * @param {string} config.id - Unique module identifier (required)
 * @param {Array} [config.pages] - Custom admin pages
 * @param {string} [config.pagesDir] - Directory path containing page folders/configs
 * @param {Array} [config.menu] - Sidebar menu items
 * @param {Object} [config.menuGroups] - Menu group definitions
 * @param {Object} [config.api] - API endpoint definitions
 * @param {Array} [config.widgets] - Dashboard widgets
 * @param {Object} deps - Internal dependencies injected by admin-panel
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

  if (config.pages !== undefined) {
    if (!Array.isArray(config.pages)) {
      throw new Error(`Module "${config.id}": pages must be an array`);
    }
  }

  if (config.menu !== undefined) {
    if (!Array.isArray(config.menu)) {
      throw new Error('menu must be an array');
    }
  }

  let pagesList = config.pages ? [...config.pages] : [];
  let menuList = config.menu ? [...config.menu] : [];

  if (config.pagesDir) {
    const { pages: dirPages, menuItems: dirMenuItems } = loadPagesFromDir(config.pagesDir);
    pagesList = pagesList.concat(dirPages);
    menuList = menuList.concat(dirMenuItems);
  }

  if (pagesList.length > 0) {
    registerPages(config.id, pagesList, { registry, adminPath, ctx, optionalAuth, serveAdminPanel });
  }

  if (menuList.length > 0) {
    registerMenuItems(menuList, registry);
  }


  if (config.api) {
    registerApiRoutes(config.id, config.api, { adminPath, ctx, requireAuth, optionalAuth });
  }

  if (config.widgets) {
    registerWidgets(config.widgets, registry);
  }
}

/**
 * Register custom admin pages from a directory directly
 * @param {string} dirPath - Directory path containing custom page folders/configs
 * @param {Object} deps - Dependencies injected by admin-panel
 */
function registerPageDir(dirPath, deps) {
  const { pages, menuItems } = loadPagesFromDir(dirPath);
  const moduleId = path.basename(dirPath);
  registerPages(moduleId, pages, deps);
  if (menuItems.length > 0) {
    registerMenuItems(menuItems, deps.registry);
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
      layout: page.layout !== undefined ? page.layout : true,
    });

    if (page.componentFile) {
      const resolvedPath = path.resolve(page.componentFile);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Module "${moduleId}", page "${pageId}": componentFile not found at ${page.componentFile}`);
      }
      const rawCode = fs.readFileSync(resolvedPath, 'utf8');
      const formattedCode = formatClientComponent(pageId, rawCode);
      registry.registerClientComponent(pageId, formattedCode);
    } else if (page.component) {
      const formattedCode = formatClientComponent(pageId, page.component);
      registry.registerClientComponent(pageId, formattedCode);
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

    const safeHandler = async (req, res, next) => {
      try {
        await route.handler(req, res, next);
      } catch (err) {
        if (typeof next === 'function') {
          next(err);
        } else {
          throw err;
        }
      }
    };
    safeHandler._originalHandler = route.handler;

    ctx.addRoute(method, fullPath, authMiddleware, safeHandler);
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

module.exports = { registerModule, registerPageDir, loadPagesFromDir, formatClientComponent };


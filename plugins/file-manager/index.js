/**
 * Webspresso File Manager Plugin
 * Filesystem-first media library, directory browser and asset picker for Admin Panel.
 * @module plugins/file-manager
 */

const path = require('path');
const { createFileManagerApiHandlers } = require('./api-handlers');
const { generateFileManagerComponent } = require('./admin-component');
const { createFileManagerServices } = require('../../src/services/builtins/file-manager');
const core = require('./core');
const security = require('./security');

/**
 * @param {Object} [options]
 * @param {string} [options.baseDir='./public/uploads'] - Filesystem directory to manage
 * @param {string} [options.publicBasePath='/uploads'] - URL prefix for stored files
 * @param {string} [options.apiPrefix='/files'] - API subpath under Admin API
 * @param {string} [options.pageTitle='Dosya Yöneticisi'] - Title of admin page
 * @param {string} [options.menuLabel='Dosya Yöneticisi'] - Sidebar menu label
 * @param {number} [options.menuOrder=50] - Sidebar menu ordering
 * @param {number} [options.maxUploadBytes=10485760] - Max upload size in bytes (10MB default)
 * @param {number|null} [options.maxTotalStorageBytes] - Storage quota limit in bytes (optional)
 * @param {string[]|null} [options.allowedExtensions] - Whitelist of allowed extensions
 * @param {string[]|null} [options.allowedMimeTypes] - Whitelist of allowed MIME types
 * @param {Record<string, string[]>|null} [options.permissions] - RBAC permissions map
 * @param {Object} [options.security] - Security configurations
 * @param {boolean} [options.security.validateMagicBytes=true] - Validate file signatures
 * @param {boolean} [options.security.sanitizeSvg=true] - Sanitize SVG XSS payloads
 * @param {boolean} [options.includePage=true] - Whether to register admin menu item & page
 */
function fileManagerPlugin(options = {}) {
  const {
    baseDir = path.join(process.cwd(), 'public', 'uploads'),
    publicBasePath = '/uploads',
    apiPrefix = '/files',
    pageTitle = 'Dosya Yöneticisi',
    menuLabel = 'Dosya Yöneticisi',
    menuOrder = 50,
    maxUploadBytes = 10 * 1024 * 1024,
    maxTotalStorageBytes = null,
    allowedExtensions = null,
    allowedMimeTypes = null,
    permissions = null,
    security: securityOpts = { validateMagicBytes: true, sanitizeSvg: true },
    includePage = true,
  } = options;

  const resolvedBaseDir = path.resolve(baseDir);

  const handlers = createFileManagerApiHandlers({
    baseDir: resolvedBaseDir,
    publicBasePath,
    maxUploadBytes,
    maxTotalStorageBytes,
    allowedExtensions,
    allowedMimeTypes,
    permissions,
    security: securityOpts,
  });

  return {
    name: 'file-manager',
    version: '1.0.0',
    description: 'Filesystem-first media library, directory explorer & asset picker',
    dependencies: { 'admin-panel': '*' },

    api: {
      ...core,
      security,
    },

    register(ctx) {
      // Register built-in services in app service registry if available
      if (ctx.app && ctx.app.serviceRegistry) {
        const services = createFileManagerServices({
          baseDir: resolvedBaseDir,
          publicBasePath,
        });
        for (const [name, def] of Object.entries(services)) {
          if (!ctx.app.serviceRegistry.has(name)) {
            ctx.app.serviceRegistry.register(name, def);
          }
        }
      }
    },

    onRoutesReady(ctx) {
      const adminApi = ctx.usePlugin('admin-panel');
      if (!adminApi) {
        console.warn('[file-manager] admin-panel plugin not found, skipping Admin UI registration');
        return;
      }

      adminApi.registerModule({
        id: 'files',
        pages: includePage
          ? [{
              id: 'files',
              title: pageTitle,
              path: '/files',
              icon: 'folder',
              component: generateFileManagerComponent({
                apiPrefix,
                publicBasePath,
              }),
            }]
          : [],

        menu: includePage
          ? [{
              id: 'files',
              label: menuLabel,
              path: '/files',
              icon: 'folder',
              order: menuOrder,
            }]
          : [],

        api: {
          prefix: apiPrefix,
          routes: [
            { method: 'get', path: '', handler: handlers.list },
            { method: 'post', path: '/mkdir', handler: handlers.mkdir },
            { method: 'post', path: '/rename', handler: handlers.rename },
            { method: 'post', path: '/move', handler: handlers.move },
            { method: 'post', path: '/delete', handler: handlers.delete },
            { method: 'post', path: '/upload', handler: handlers.upload },
          ],
        },
      });
    },
  };
}

module.exports = fileManagerPlugin;
module.exports.fileManagerPlugin = fileManagerPlugin;
module.exports.core = core;
module.exports.security = security;

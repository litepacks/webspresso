/**
 * Schema-driven content CMS plugin for Webspresso.
 * @module plugins/content
 */

const fs = require('fs');
const path = require('path');
const { createContentService } = require('../../core/content');
const { createContentTypeModel } = require('./models/content-type');
const { createContentEntryModel } = require('./models/content-entry');
const { createContentApiHandlers } = require('./api-handlers');
const { createRequestContentHelpers, isAdminSession } = require('./helpers');
const { generateContentTypesComponent } = require('./admin/content-types-component');
const { generateContentEntriesComponent } = require('./admin/content-entries-component');
const { generateContentMigrations } = require('./migration-template');

const INLINE_EDIT_JS = fs.readFileSync(path.join(__dirname, 'client/inline-edit.js'), 'utf8');
const INLINE_EDIT_CSS = fs.readFileSync(path.join(__dirname, 'client/inline-edit.css'), 'utf8');

/**
 * @param {Object} options
 * @param {import('../../core/orm').Database} options.db
 * @param {string} [options.adminPath='/_admin']
 * @param {string} [options.publicApiPath='/api/content']
 * @param {boolean} [options.inlineEdit=true]
 * @param {number|null} [options.cacheTtlMs] - In-memory cache TTL; null (default) = until write invalidation
 */
function contentPlugin(options = {}) {
  const {
    db,
    adminPath: adminPathOpt,
    publicApiPath = '/api/content',
    inlineEdit = true,
    cacheTtlMs,
  } = options;

  if (!db) {
    throw new Error('content plugin requires a database instance. Pass `db` in options.');
  }

  /** @type {ReturnType<typeof createContentService>|null} */
  let contentService = null;
  let adminPath = adminPathOpt || '/_admin';

  function getService(database) {
    if (!contentService) {
      let sanitizeRichHtml;
      try {
        ({ sanitizeRichHtml } = require('../admin-panel/lib/sanitize-rich-html'));
      } catch {
        sanitizeRichHtml = (v) => v;
      }
      contentService = createContentService(database || db, { cacheTtlMs, sanitizeRichHtml });
    }
    return contentService;
  }

  function maybeInjectInlineEdit(req, html) {
    if (!inlineEdit || !isAdminSession(req, adminPath)) {
      return html;
    }
    const configScript =
      '<script>window.__WS_CONTENT__=' +
      JSON.stringify({ enabled: true, adminPath }) +
      ';</script>';
    const styleTag = '<style id="ws-content-inline-css">' + INLINE_EDIT_CSS + '</style>';
    const scriptTag = '<script id="ws-content-inline-edit">' + INLINE_EDIT_JS + '</script>';
    const bundle = configScript + styleTag + scriptTag;
    if (html.includes('</body>')) {
      return html.replace('</body>', bundle + '</body>');
    }
    return html + bundle;
  }

  return {
    name: 'content',
    version: '1.0.0',
    description: 'Schema-driven SQLite CMS with inline admin editing',
    dependencies: { 'admin-panel': '*' },

    csp: {
      styleSrc: ["'unsafe-inline'"],
      scriptSrc: ["'unsafe-inline'"],
    },

    api: {
      getContentService: getService,
      createRequestHelpers: () => createRequestContentHelpers({ adminPath }),
      maybeInjectInlineEdit,
      getMigrationTemplate: generateContentMigrations,
      _options: { adminPath },
    },

    register(ctx) {
      const { hasModel, getModel } = require('../../core/orm/model');

      if (!hasModel('ContentType')) {
        db.registerModel(createContentTypeModel());
      } else if (!db.hasModel('ContentType')) {
        db.registerModel(getModel('ContentType'));
      }

      if (!hasModel('ContentEntry')) {
        db.registerModel(createContentEntryModel());
      } else if (!db.hasModel('ContentEntry')) {
        db.registerModel(getModel('ContentEntry'));
      }

      getService(db);
    },

    onRoutesReady(ctx) {
      adminPath = adminPathOpt || '/_admin';
      this.api._options = { adminPath };

      const service = getService(ctx.db || db);
      const handlers = createContentApiHandlers({ contentService: service });

      const publicBase = publicApiPath.replace(/\/$/, '');
      ctx.addRoute(
        'get',
        `${publicBase}/:typeSlug/:entrySlug`,
        handlers.publicGetEntryHandler
      );

      const adminApi = ctx.usePlugin('admin-panel');
      if (!adminApi) {
        console.warn('[content] admin-panel plugin not found, skipping admin UI');
        const { requireAuth } = require('../admin-panel/auth');
        const base = `${adminPath}/api/content`;
        ctx.addRoute('get', `${base}/types`, requireAuth, handlers.listTypesHandler);
        ctx.addRoute('post', `${base}/types`, requireAuth, handlers.createTypeHandler);
        ctx.addRoute('get', `${base}/types/:id`, requireAuth, handlers.getTypeHandler);
        ctx.addRoute('put', `${base}/types/:id`, requireAuth, handlers.updateTypeHandler);
        ctx.addRoute('delete', `${base}/types/:id`, requireAuth, handlers.deleteTypeHandler);
        ctx.addRoute('get', `${base}/types/:typeSlug/schema`, requireAuth, handlers.getTypeSchemaHandler);
        ctx.addRoute('get', `${base}/types/:typeSlug/entries`, requireAuth, handlers.listEntriesHandler);
        ctx.addRoute('post', `${base}/types/:typeSlug/entries`, requireAuth, handlers.createEntryHandler);
        ctx.addRoute('get', `${base}/entries/:id`, requireAuth, handlers.getEntryHandler);
        ctx.addRoute('put', `${base}/entries/:id`, requireAuth, handlers.updateEntryHandler);
        ctx.addRoute('delete', `${base}/entries/:id`, requireAuth, handlers.deleteEntryHandler);
        return;
      }

      const apiPrefix = '/content';
      adminApi.registerModule({
        id: 'content',

        menuGroups: {
          cms: {
            label: 'CMS',
            icon: 'database',
            order: -1,
          },
        },

        menu: [
          {
            id: 'content-types',
            label: 'Content Types',
            path: '/content/types',
            icon: 'database',
            group: 'cms',
            order: 0,
          },
        ],

        pages: [
          {
            id: 'content-types',
            title: 'Content Types',
            path: '/content/types',
            icon: 'database',
            component: generateContentTypesComponent({ apiPrefix }),
          },
          {
            id: 'content-types-new',
            title: 'New Content Type',
            path: '/content/types/new',
            component: generateContentTypesComponent({ apiPrefix }),
          },
          {
            id: 'content-types-edit',
            title: 'Edit Content Type',
            path: '/content/types/edit/:id',
            component: generateContentTypesComponent({ apiPrefix }),
          },
          {
            id: 'content-entries',
            title: 'Content Entries',
            path: '/content/types/:typeSlug/entries',
            component: generateContentEntriesComponent({ apiPrefix }),
          },
          {
            id: 'content-entries-new',
            title: 'New Content Entry',
            path: '/content/types/:typeSlug/entries/new',
            component: generateContentEntriesComponent({ apiPrefix }),
          },
          {
            id: 'content-entries-edit',
            title: 'Edit Content Entry',
            path: '/content/types/:typeSlug/entries/edit/:id',
            component: generateContentEntriesComponent({ apiPrefix }),
          },
        ],

        api: {
          prefix: apiPrefix,
          routes: [
            { method: 'get', path: '/types', handler: handlers.listTypesHandler },
            { method: 'post', path: '/types', handler: handlers.createTypeHandler },
            { method: 'get', path: '/types/:typeSlug/schema', handler: handlers.getTypeSchemaHandler },
            { method: 'get', path: '/types/:typeSlug/entries', handler: handlers.listEntriesHandler },
            { method: 'post', path: '/types/:typeSlug/entries', handler: handlers.createEntryHandler },
            { method: 'get', path: '/types/:id', handler: handlers.getTypeHandler },
            { method: 'put', path: '/types/:id', handler: handlers.updateTypeHandler },
            { method: 'delete', path: '/types/:id', handler: handlers.deleteTypeHandler },
            { method: 'get', path: '/entries/:id', handler: handlers.getEntryHandler },
            { method: 'put', path: '/entries/:id', handler: handlers.updateEntryHandler },
            { method: 'delete', path: '/entries/:id', handler: handlers.deleteEntryHandler },
          ],
        },
      });
    },
  };
}

module.exports = contentPlugin;
module.exports.contentPlugin = contentPlugin;
module.exports.generateContentMigrations = generateContentMigrations;

/**
 * Webspresso Content Layer plugin
 */

const path = require('path');
const { resolveContentConfig } = require('../../core/content/config');
const { ContentIndex } = require('../../core/content/index');
const { createContentService } = require('../../core/content/service');
const { mountContentRoutes, registerContentSitemapUrls } = require('../../core/content/routes');
const { registerContentNunjucks } = require('./nunjucks');

/**
 * @param {import('../../core/content/config').ContentResolvedConfig|boolean|object} [options]
 */
function contentPlugin(options = {}) {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const resolved =
    options && typeof options === 'object' && options.enabled !== undefined && options.absoluteDir
      ? options
      : resolveContentConfig(
          options === true ? { enabled: true } : options,
          nodeEnv
        );

  if (!resolved || !resolved.enabled) {
    return {
      name: 'content',
      version: '1.0.0',
      description: 'Webspresso Content Layer (disabled)',
      onRoutesReady() {},
    };
  }

  const manifestItems = resolved._manifestItems || null;
  const index = new ContentIndex(resolved, manifestItems);
  const contentService = createContentService(index, resolved);

  /** @type {Record<string, import('../../core/content/config').CollectionConfig & { name: string }>} */
  const extraCollections = {};

  return {
    name: 'content',
    version: '1.0.0',
    description: 'Webspresso Content Layer — Markdown collections',
    contentConfigKeys: ['enabled', 'dir', 'collections', 'failOnInvalid'],

    register(ctx) {
      const helpers = registerContentNunjucks(contentService, ctx.nunjucksEnv);
      for (const [name, fn] of Object.entries(helpers)) {
        ctx.addHelper(name, fn);
      }
    },

    onRoutesReady(ctx) {
      const pm = ctx.options?.pluginManager;
      if (pm) {
        pm.contentService = contentService;
      }

      const mergedConfig = {
        ...resolved,
        collections: { ...resolved.collections, ...extraCollections },
      };

      const pagesDir = ctx.options?.pagesDir || 'pages';
      const viewsDir = ctx.options?.viewsDir;
      const templateDirs = viewsDir
        ? [path.resolve(viewsDir), path.resolve(pagesDir)]
        : [path.resolve(pagesDir)];

      const { routeMetadata } = mountContentRoutes(ctx.app, {
        nunjucksEnv: ctx.nunjucksEnv,
        templateDirs,
        pluginManager: ctx.options?.pluginManager,
        clientRuntime: ctx.options?.clientRuntime || { alpine: false, swup: false },
        silent: process.env.NODE_ENV === 'test',
      }, contentService, mergedConfig);

      if (ctx.options?.pluginManager?.routes) {
        ctx.options.pluginManager.routes.push(...routeMetadata);
      }

      registerContentSitemapUrls(ctx, index, mergedConfig);

      if (resolved._watch !== false && process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
        startContentWatcher(resolved.absoluteDir, index);
      }
    },

    api: {
      getService: () => contentService,
      rebuildIndex: () => index.rebuild(),
      registerCollection(name, cfg = {}) {
        const { normalizeCollectionConfig } = require('../../core/content/config');
        extraCollections[name] = normalizeCollectionConfig(name, cfg);
        index.config.collections[name] = extraCollections[name];
        index.rebuild();
      },
    },
  };
}

/**
 * @param {string} contentDir
 * @param {import('../../core/content/index').ContentIndex} index
 */
function startContentWatcher(contentDir, index) {
  try {
    const chokidar = require('chokidar');
    let debounce = null;
    const watcher = chokidar.watch(contentDir, {
      ignoreInitial: true,
      ignored: /(^|[/\\])\../,
    });
    const refresh = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        try {
          index.rebuild();
        } catch (err) {
          console.warn('[webspresso:content] Index rebuild failed:', err.message);
        }
      }, 300);
    };
    watcher.on('add', refresh);
    watcher.on('change', refresh);
    watcher.on('unlink', refresh);
  } catch {
    // chokidar optional at runtime
  }
}

module.exports = contentPlugin;
module.exports.resolveContentConfig = resolveContentConfig;

/**
 * Auto-register content collection routes.
 */

const path = require('path');
const { createHelpers } = require('../../src/helpers');
const { detectLocale, createTranslator } = require('../../src/router-edge');
const { buildSeoFromItem } = require('./seo');
const { resolveContentLayout } = require('./layout');
const { buildContentUrl } = require('./slug');

/**
 * @typedef {object} MountContentRoutesResult
 * @property {object[]} routeMetadata
 */

/**
 * @param {object} app - Compat app
 * @param {object} ctx
 * @param {import('./service').ReturnType<typeof createContentService>} contentService
 * @param {import('./config').ContentResolvedConfig} config
 * @param {object} ctx.nunjucksEnv
 * @param {string[]} ctx.templateDirs
 * @param {object} [ctx.pluginManager]
 * @param {object} [ctx.clientRuntime]
 * @param {boolean} [ctx.silent]
 * @returns {MountContentRoutesResult}
 */
function mountContentRoutes(app, ctx, contentService, config) {
  const {
    nunjucksEnv,
    templateDirs = [],
    pluginManager = null,
    clientRuntime = { alpine: false, swup: false },
    silent = false,
  } = ctx;

  const log = silent ? () => {} : console.log.bind(console);
  /** @type {object[]} */
  const routeMetadata = [];
  const index = contentService.index;

  for (const [collectionName, collCfg] of Object.entries(config.collections)) {
    const items = index.getCollectionItems(collectionName, {
      includeDrafts: config.includeDrafts,
    });

    for (const item of items) {
      const pattern = buildContentUrl(collCfg.route, item.slug);
      const itemRef = item;
      registerContentGet(app, pattern, async (req, res, next) => {
        try {
          const found = index.findBySlug(collectionName, itemRef.slug, {
            includeDrafts: config.includeDrafts,
          });
          if (!found) {
            res.status(404);
            return next();
          }
          await renderContentPage({
            req,
            res,
            item: found,
            collCfg,
            collectionName,
            nunjucksEnv,
            templateDirs,
            pluginManager,
            clientRuntime,
            kind: 'post',
          });
        } catch (err) {
          return next(err);
        }
      });
      routeMetadata.push({
        type: 'content',
        method: 'get',
        pattern,
        file: item.path,
        isDynamic: true,
        collection: collectionName,
      });
      log(`  GET    ${pattern} -> content:${item.path}`);
    }

    if (collCfg.indexRoute) {
      const indexPattern = collCfg.indexRoute;
      registerContentGet(app, indexPattern, async (req, res, next) => {
        try {
          const listItems = index.getCollectionItems(collectionName, {
            includeDrafts: config.includeDrafts,
          });
          await renderContentPage({
            req,
            res,
            item: null,
            items: listItems,
            collCfg,
            collectionName,
            nunjucksEnv,
            templateDirs,
            pluginManager,
            clientRuntime,
            kind: 'list',
          });
        } catch (err) {
          return next(err);
        }
      });
      routeMetadata.push({
        type: 'content',
        method: 'get',
        pattern: indexPattern,
        file: `content/${collectionName}/index`,
        isDynamic: false,
        collection: collectionName,
      });
      log(`  GET    ${indexPattern} -> content:${collectionName} index`);
    }

    if (collCfg.tagsRoute) {
      const tagPattern = collCfg.tagsRoute;
      registerContentGet(app, tagPattern, async (req, res, next) => {
        try {
          const tag = req.params.tag;
          const tagged = index
            .getCollectionItems(collectionName, { includeDrafts: config.includeDrafts })
            .filter((i) =>
              (i.tags || []).some((t) => String(t).toLowerCase() === String(tag).toLowerCase())
            );
          await renderContentPage({
            req,
            res,
            item: null,
            items: tagged,
            collCfg,
            collectionName,
            nunjucksEnv,
            templateDirs,
            pluginManager,
            clientRuntime,
            kind: 'tag',
            tag,
          });
        } catch (err) {
          return next(err);
        }
      });
      routeMetadata.push({
        type: 'content',
        method: 'get',
        pattern: tagPattern,
        file: `content/${collectionName}/tags`,
        isDynamic: true,
        collection: collectionName,
      });
      log(`  GET    ${tagPattern} -> content:${collectionName} tags`);
    }
  }

  return { routeMetadata };
}

/**
 * @param {object} app
 * @param {string} pattern
 * @param {Function} handler
 */
function registerContentGet(app, pattern, handler) {
  app.get(pattern, handler);
}

/**
 * @param {object} params
 */
async function renderContentPage(params) {
  const {
    req,
    res,
    item,
    items = [],
    collCfg,
    collectionName,
    nunjucksEnv,
    templateDirs,
    pluginManager,
    clientRuntime,
    kind,
    tag,
  } = params;

  const locale = detectLocale(req);
  const t = createTranslator({});
  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const baseHelpers = createHelpers({ req, res, locale, baseUrl });
  const pluginHelpers = pluginManager ? pluginManager.getHelpers() : {};
  const fsy = { ...baseHelpers, ...pluginHelpers };

  const seo = item ? buildSeoFromItem(item, { baseUrl }) : {
    title: collectionName,
    description: null,
    canonical: `${baseUrl.replace(/\/$/, '')}${collCfg.indexRoute || `/${collectionName}`}`,
    indexable: true,
    robots: null,
    author: null,
    tags: [],
  };

  const meta = { ...seo };

  const layoutRel = resolveContentLayout({
    templateDirs,
    collection: collectionName,
    layoutFromConfig: collCfg.layout,
    kind,
  });

  const renderContext = {
    content: item,
    items,
    collection: collectionName,
    tag: tag || null,
    meta,
    seo,
    locale,
    t,
    fsy,
    clientRuntime,
    req: {
      path: req.path,
      query: req.query,
      params: req.params,
    },
  };

  let html;
  if (layoutRel) {
    html = nunjucksEnv.render(layoutRel, renderContext);
  } else if (item) {
    html = `<!DOCTYPE html><html><head><title>${escapeHtml(item.title)}</title></head><body><h1>${escapeHtml(item.title)}</h1><div>${item.html}</div></body></html>`;
  } else {
    const links = items
      .map((i) => `<li><a href="${escapeHtml(i.url)}">${escapeHtml(i.title)}</a></li>`)
      .join('');
    html = `<!DOCTYPE html><html><body><ul>${links}</ul></body></html>`;
  }

  await res.send(html);
}

/**
 * @param {string} s
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Register content URLs with sitemap plugin.
 * @param {object} ctx
 * @param {import('./index').ContentIndex} index
 * @param {import('./config').ContentResolvedConfig} config
 */
function registerContentSitemapUrls(ctx, index, config) {
  const sitemap = ctx.usePlugin?.('sitemap');
  if (!sitemap?.api?.addUrl) return;

  const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

  for (const item of index.published()) {
    const collCfg = config.collections[item.collection];
    if (!collCfg || collCfg.sitemap === false) continue;

    let path = item.url;
    if (item.canonical) {
      if (/^https?:\/\//i.test(item.canonical)) {
        const prefix = baseUrl;
        path = item.canonical.startsWith(prefix)
          ? item.canonical.slice(prefix.length) || item.url
          : item.url;
      } else {
        path = item.canonical.startsWith('/') ? item.canonical : `/${item.canonical}`;
      }
    }

    const lastmod = formatLastmod(item.updatedAt || item.date);
    sitemap.api.addUrl(path, {
      lastmod,
      priority: collCfg.priority,
      changefreq: collCfg.changefreq,
    });
  }

  for (const [, collCfg] of Object.entries(config.collections)) {
    if (collCfg.indexRoute && collCfg.sitemap !== false) {
      sitemap.api.addUrl(collCfg.indexRoute, {
        changefreq: collCfg.changefreq,
        priority: (collCfg.priority || 0.8) * 0.9,
      });
    }
  }
}

/**
 * @param {string|null|undefined} date
 */
function formatLastmod(date) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

module.exports = {
  mountContentRoutes,
  registerContentSitemapUrls,
  renderContentPage,
};

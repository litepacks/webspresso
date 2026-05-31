/**
 * Content layer configuration resolution.
 */

const path = require('path');
const fs = require('fs');

const DEFAULT_CONTENT_DIR = 'content';

/**
 * @typedef {object} CollectionConfig
 * @property {string} [route]
 * @property {string} [indexRoute]
 * @property {string} [tagsRoute]
 * @property {string} [layout]
 * @property {boolean} [draft]
 * @property {boolean} [sitemap]
 * @property {import('zod').ZodTypeAny} [schema]
 * @property {number} [priority]
 * @property {string} [changefreq]
 */

/**
 * @typedef {object} ContentResolvedConfig
 * @property {boolean} enabled
 * @property {string} dir
 * @property {string} absoluteDir
 * @property {boolean} failOnInvalid
 * @property {boolean} includeDrafts
 * @property {boolean} isProduction
 * @property {Record<string, CollectionConfig & { name: string }>} collections
 */

/**
 * @param {boolean|object|null|undefined} contentOption
 * @param {string} [nodeEnv]
 * @param {string} [cwd]
 * @returns {ContentResolvedConfig|null}
 */
function resolveContentConfig(contentOption, nodeEnv = process.env.NODE_ENV || 'development', cwd = process.cwd()) {
  if (contentOption === false || contentOption === null) {
    return null;
  }

  const isProduction = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';

  const raw =
    contentOption === true || contentOption === undefined
      ? {}
      : typeof contentOption === 'object'
        ? contentOption
        : {};

  const enabled =
    raw.enabled !== undefined ? raw.enabled === true : !isTest;

  if (!enabled) {
    return {
      enabled: false,
      dir: raw.dir || DEFAULT_CONTENT_DIR,
      absoluteDir: path.resolve(cwd, raw.dir || DEFAULT_CONTENT_DIR),
      failOnInvalid: false,
      includeDrafts: !isProduction,
      isProduction,
      collections: {},
    };
  }

  const dir = raw.dir || DEFAULT_CONTENT_DIR;
  const absoluteDir = path.resolve(cwd, dir);
  const failOnInvalid = raw.failOnInvalid === true;
  const includeDrafts = raw.includeDrafts === true || (!isProduction && raw.includeDrafts !== false);

  /** @type {Record<string, CollectionConfig & { name: string }>} */
  const collections = {};

  const configured = raw.collections && typeof raw.collections === 'object' ? raw.collections : {};

  for (const [name, cfg] of Object.entries(configured)) {
    collections[name] = normalizeCollectionConfig(name, cfg);
  }

  if (fs.existsSync(absoluteDir)) {
    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
      if (!collections[ent.name]) {
        collections[ent.name] = normalizeCollectionConfig(ent.name, {});
      }
    }
  }

  return {
    enabled: true,
    dir,
    absoluteDir,
    failOnInvalid,
    includeDrafts,
    isProduction,
    collections,
  };
}

/**
 * @param {string} name
 * @param {object} cfg
 * @returns {CollectionConfig & { name: string }}
 */
function normalizeCollectionConfig(name, cfg = {}) {
  return {
    name,
    route: cfg.route || `/${name}/:slug`,
    indexRoute: cfg.indexRoute,
    tagsRoute: cfg.tagsRoute,
    layout: cfg.layout || null,
    draft: cfg.draft === true,
    sitemap: cfg.sitemap !== false,
    schema: cfg.schema,
    priority: cfg.priority,
    changefreq: cfg.changefreq,
  };
}

module.exports = {
  resolveContentConfig,
  normalizeCollectionConfig,
  DEFAULT_CONTENT_DIR,
};

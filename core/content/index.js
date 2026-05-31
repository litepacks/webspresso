/**
 * Content index — filesystem scan + in-memory cache.
 */

const fs = require('fs');
const path = require('path');
const { parseMarkdownContent } = require('./parse');
const { resolveSlug, buildContentUrl } = require('./slug');
const { validateContentItem } = require('./validate');

/**
 * @typedef {object} ContentItem
 * @property {string} collection
 * @property {string} slug
 * @property {string} title
 * @property {string} [description]
 * @property {string} [date]
 * @property {string} [updatedAt]
 * @property {string[]} tags
 * @property {boolean} draft
 * @property {string} body
 * @property {string} html
 * @property {string} excerpt
 * @property {string} path
 * @property {string} url
 * @property {string} [image]
 * @property {string} [canonical]
 * @property {string} [robots]
 * @property {string} [author]
 * @property {boolean} sitemapEligible
 * @property {string[]} [validationErrors]
 */

class ContentIndex {
  /**
   * @param {import('./config').ContentResolvedConfig} config
   * @param {object[]} [manifestItems] Pre-built items from manifest
   */
  constructor(config, manifestItems = null) {
    this.config = config;
    /** @type {Map<string, ContentItem>} key: collection/slug */
    this.items = new Map();
    /** @type {Map<string, ContentItem[]>} */
    this.byCollection = new Map();

    if (manifestItems && Array.isArray(manifestItems)) {
      this._loadFromManifest(manifestItems);
    } else if (config.enabled) {
      this.rebuild();
    }
  }

  /**
   * @param {object[]} items
   */
  _loadFromManifest(items) {
    this.items.clear();
    this.byCollection.clear();
    for (const item of items) {
      if (!item.collection || !item.slug) continue;
      const normalized = this._normalizeItem(item);
      const key = `${normalized.collection}/${normalized.slug}`;
      this.items.set(key, normalized);
      const list = this.byCollection.get(normalized.collection) || [];
      list.push(normalized);
      this.byCollection.set(normalized.collection, list);
    }
    for (const [, list] of this.byCollection) {
      list.sort((a, b) => compareByDate(b, a));
    }
  }

  rebuild() {
    this.items.clear();
    this.byCollection.clear();
    const { absoluteDir, collections } = this.config;
    if (!fs.existsSync(absoluteDir)) return;

    for (const [collectionName, collCfg] of Object.entries(collections)) {
      const collDir = path.join(absoluteDir, collectionName);
      if (!fs.existsSync(collDir)) continue;

      const files = this._scanMarkdownFiles(collDir);
      for (const filePath of files) {
        try {
          const item = this._parseFile(filePath, collectionName, collCfg);
          if (!item) continue;

          const validation = validateContentItem(item, collCfg, this.config);
          if (validation.errors.length) {
            item.validationErrors = validation.errors;
            if (this.config.failOnInvalid && this.config.isProduction) {
              throw new Error(
                `Content validation failed for ${item.path}: ${validation.errors.join('; ')}`
              );
            }
            if (!this.config.isProduction) {
              console.warn(
                `[webspresso:content] ${item.path}: ${validation.errors.join('; ')}`
              );
            }
          }

          const key = `${item.collection}/${item.slug}`;
          this.items.set(key, item);
          const list = this.byCollection.get(collectionName) || [];
          list.push(item);
          this.byCollection.set(collectionName, list);
        } catch (err) {
          if (this.config.failOnInvalid) throw err;
          console.warn(`[webspresso:content] Skip ${filePath}:`, err.message);
        }
      }
      const list = this.byCollection.get(collectionName);
      if (list) list.sort((a, b) => compareByDate(b, a));
    }
  }

  /**
   * @param {string} dir
   * @returns {string[]}
   */
  _scanMarkdownFiles(dir) {
    /** @type {string[]} */
    const out = [];
    const walk = (d) => {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory() && !ent.name.startsWith('.')) {
          walk(full);
        } else if (ent.isFile() && /\.md$/i.test(ent.name)) {
          out.push(full);
        }
      }
    };
    walk(dir);
    return out;
  }

  /**
   * @param {string} filePath
   * @param {string} collectionName
   * @param {import('./config').CollectionConfig & { name: string }} collCfg
   * @returns {ContentItem|null}
   */
  _parseFile(filePath, collectionName, collCfg) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const { fm, body, html, excerpt } = parseMarkdownContent(raw);
    const relPath = path.relative(process.cwd(), filePath).split(path.sep).join('/');
    const fileBase = path.basename(filePath, path.extname(filePath));

    const fmObj = fm || {};
    const slug = resolveSlug({
      frontmatterSlug: fmObj.slug,
      fileBaseName: fileBase,
      title: typeof fmObj.title === 'string' ? fmObj.title : undefined,
    });

    const draft =
      fmObj.draft === true || (fmObj.draft !== false && collCfg.draft === true);
    const tags = normalizeTags(fmObj.tags);

    const item = this._normalizeItem({
      collection: collectionName,
      slug,
      title: typeof fmObj.title === 'string' ? fmObj.title : slug,
      description: typeof fmObj.description === 'string' ? fmObj.description : '',
      date: fmObj.date != null ? String(fmObj.date) : null,
      updatedAt: fmObj.updatedAt != null ? String(fmObj.updatedAt) : null,
      tags,
      draft,
      body,
      html,
      excerpt,
      path: relPath,
      image: fmObj.image != null ? String(fmObj.image) : null,
      canonical: fmObj.canonical != null ? String(fmObj.canonical) : null,
      robots: fmObj.robots != null ? String(fmObj.robots) : null,
      author: fmObj.author != null ? String(fmObj.author) : null,
      route: collCfg.route,
      sitemap: collCfg.sitemap !== false && fmObj.sitemap !== false,
    });

    return item;
  }

  /**
   * @param {Partial<ContentItem> & { route?: string, sitemap?: boolean }} raw
   * @returns {ContentItem}
   */
  _normalizeItem(raw) {
    const route = raw.route || `/${raw.collection}/:slug`;
    const url = buildContentUrl(route, raw.slug);
    const draft = raw.draft === true;
    const sitemapFlag = raw.sitemap !== false;
    return {
      collection: raw.collection,
      slug: raw.slug,
      title: raw.title || raw.slug,
      description: raw.description || '',
      date: raw.date || null,
      updatedAt: raw.updatedAt || null,
      tags: raw.tags || [],
      draft,
      body: raw.body || '',
      html: raw.html || '',
      excerpt: raw.excerpt || '',
      path: raw.path || '',
      url,
      image: raw.image || null,
      canonical: raw.canonical || null,
      robots: raw.robots || null,
      author: raw.author || null,
      sitemapEligible: !draft && sitemapFlag,
      validationErrors: raw.validationErrors,
    };
  }

  /**
   * @param {object} [opts]
   * @param {boolean} [opts.includeDrafts]
   */
  _shouldIncludeDraft(opts = {}) {
    if (opts.includeDrafts === true) return true;
    return this.config.includeDrafts;
  }

  /**
   * @param {string} collection
   * @param {object} [opts]
   * @returns {ContentItem[]}
   */
  getCollectionItems(collection, opts = {}) {
    const list = this.byCollection.get(collection) || [];
    if (this._shouldIncludeDraft(opts)) return [...list];
    return list.filter((i) => !i.draft);
  }

  /**
   * @param {string} collection
   * @param {string} slug
   * @param {object} [opts]
   * @returns {ContentItem|null}
   */
  findBySlug(collection, slug, opts = {}) {
    const key = `${collection}/${slug}`;
    const item = this.items.get(key);
    if (!item) return null;
    if (!this._shouldIncludeDraft(opts) && item.draft) return null;
    return item;
  }

  /**
   * Published items for sitemap (never drafts).
   * @returns {ContentItem[]}
   */
  published() {
    return [...this.items.values()].filter((i) => i.sitemapEligible);
  }

  /**
   * @returns {{ name: string, count: number, draftCount: number }[]}
   */
  listCollections() {
    return Object.keys(this.config.collections).map((name) => {
      const all = this.byCollection.get(name) || [];
      const draftCount = all.filter((i) => i.draft).length;
      const visible = this._shouldIncludeDraft() ? all.length : all.length - draftCount;
      return { name, count: visible, draftCount, total: all.length };
    });
  }

  /**
   * Simple search across fields.
   * @param {string} query
   * @param {object} [opts]
   * @returns {ContentItem[]}
   */
  search(query, opts = {}) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];
    const results = [];
    for (const item of this.items.values()) {
      if (!this._shouldIncludeDraft(opts) && item.draft) continue;
      const hay = [
        item.title,
        item.description,
        item.body,
        ...(item.tags || []),
      ]
        .join(' ')
        .toLowerCase();
      if (hay.includes(q)) results.push(item);
    }
    return results.sort((a, b) => compareByDate(b, a));
  }

  /**
   * Related items by tag overlap and date.
   * @param {ContentItem} item
   * @param {number} [limit]
   * @returns {ContentItem[]}
   */
  related(item, limit = 5) {
    const pool = this.getCollectionItems(item.collection).filter(
      (i) => i.slug !== item.slug
    );
    const itemTags = new Set(item.tags || []);
    const scored = pool.map((c) => {
      const shared = (c.tags || []).filter((t) => itemTags.has(t)).length;
      const dateScore = dateProximityScore(item.date, c.date);
      return { item: c, score: shared * 10 + dateScore };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.item);
  }

  /**
   * Unique tags in a collection.
   * @param {string} collection
   * @returns {string[]}
   */
  tags(collection) {
    const set = new Set();
    for (const item of this.getCollectionItems(collection)) {
      for (const t of item.tags || []) set.add(t);
    }
    return [...set].sort();
  }
}

/**
 * @param {unknown} tags
 * @returns {string[]}
 */
function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((t) => String(t));
  if (typeof tags === 'string') return tags.split(',').map((t) => t.trim()).filter(Boolean);
  return [];
}

/**
 * @param {ContentItem} a
 * @param {ContentItem} b
 */
function compareByDate(a, b) {
  const da = parseDate(a.date || a.updatedAt);
  const db = parseDate(b.date || b.updatedAt);
  return db - da;
}

/**
 * @param {string|null|undefined} d
 */
function parseDate(d) {
  if (!d) return 0;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 */
function dateProximityScore(a, b) {
  const ta = parseDate(a);
  const tb = parseDate(b);
  if (!ta || !tb) return 0;
  const diff = Math.abs(ta - tb);
  const days = diff / (86400000);
  return Math.max(0, 5 - Math.min(days / 30, 5));
}

module.exports = {
  ContentIndex,
  compareByDate,
  normalizeTags,
};

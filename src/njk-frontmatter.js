/**
 * YAML frontmatter for pages/*.njk (optional).
 * Opens with --- … --- at file top; merges into ctx.meta / ctx.data before route hooks/load.
 */

const fs = require('fs');
const { parse } = require('yaml');

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

/** @typedef {{ metaPatch: Record<string, unknown>, dataPatch: Record<string, unknown> }} Patch */

const prodRouteCache = new Map();
/** @type {Map<string, { mtimeMs: number, cached: LoadedNjk }>} */
const devRouteCache = new Map();

/** @typedef {{ useStringRender: boolean, templateBody: string|null, metaPatch: Record<string, unknown>, dataPatch: Record<string, unknown> }} LoadedNjk */

/**
 * @param {string} raw
 * @returns {{ body: string, yamlText: string|null, extracted: boolean }}
 */
function extractFrontmatterBlock(raw) {
  const strippedBom = raw.replace(/^\uFEFF/, '');
  const match = strippedBom.match(FRONTMATTER_BLOCK);
  if (!match) {
    return { body: strippedBom, yamlText: null, extracted: false };
  }
  const body = strippedBom.slice(match[0].length);
  const yamlText = match[1] != null ? String(match[1]).trimEnd() : '';
  return { body, yamlText, extracted: true };
}

/**
 * @param {string} content Full .njk file contents
 */
function parseNjkFrontmatter(content) {
  const { body, yamlText, extracted } = extractFrontmatterBlock(content);
  if (!extracted || yamlText == null) {
    return { body, fm: null, hasDelimiter: extracted };
  }
  if (yamlText === '') {
    return { body, fm: {}, hasDelimiter: true };
  }
  try {
    const fm = parse(yamlText);
    return {
      body,
      fm: fm && typeof fm === 'object' && !Array.isArray(fm) ? fm : null,
      hasDelimiter: true,
    };
  } catch (err) {
    console.warn('[webspresso] .njk frontmatter YAML parse failed — rendering without fm meta:', err.message);
    return { body, fm: null, hasDelimiter: true };
  }
}

/**
 * @param {unknown} fm
 * @returns {Patch}
 */
function frontmatterToPatches(fm) {
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) {
    return { metaPatch: {}, dataPatch: {} };
  }

  /** @type {Record<string, unknown>} */
  const metaPatch = {};
  const fmObj = fm;
  const nestedMeta = fmObj.meta;
  if (nestedMeta && typeof nestedMeta === 'object' && !Array.isArray(nestedMeta)) {
    Object.assign(metaPatch, nestedMeta);
  }
  for (const k of ['title', 'description', 'canonical', 'indexable']) {
    if (Object.prototype.hasOwnProperty.call(fmObj, k) && fmObj[k] !== undefined) {
      metaPatch[k] = fmObj[k];
    }
  }

  /** @type {Record<string, unknown>} */
  let dataPatch = {};
  const d = fmObj.data;
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    dataPatch = { ...d };
  }

  return { metaPatch, dataPatch };
}

/**
 * @param {boolean} [isDevLike]
 */
function readAndParse(absPath, isDevLike = false) {
  const raw = fs.readFileSync(absPath, 'utf8');
  const { body, fm, hasDelimiter } = parseNjkFrontmatter(raw);
  const patches = frontmatterToPatches(fm);

  /** @type {LoadedNjk} */
  const loaded = {
    useStringRender: !!hasDelimiter,
    templateBody: hasDelimiter ? body : null,
    metaPatch: patches.metaPatch,
    dataPatch: patches.dataPatch,
  };

  if (isDevLike) {
    return loaded;
  }
  prodRouteCache.set(absPath, loaded);
  return loaded;
}

/**
 * @param {string} absPath Absolute path to pages/…/*.njk
 * @param {boolean} isDev NODE_ENV !== 'production' style
 */
function loadNjkRouteTemplate(absPath, isDev) {
  if (!fs.existsSync(absPath)) {
    return {
      useStringRender: false,
      templateBody: null,
      metaPatch: {},
      dataPatch: {},
    };
  }

  const stat = fs.statSync(absPath);

  if (isDev) {
    const prev = devRouteCache.get(absPath);
    if (prev && prev.mtimeMs >= stat.mtimeMs) {
      return prev.cached;
    }
    const fresh = readAndParse(absPath, true);
    devRouteCache.set(absPath, { mtimeMs: stat.mtimeMs, cached: fresh });
    return fresh;
  }

  if (prodRouteCache.has(absPath)) {
    return prodRouteCache.get(absPath);
  }
  return readAndParse(absPath, false);
}

function clearNjkFrontmatterCaches() {
  prodRouteCache.clear();
  devRouteCache.clear();
}

module.exports = {
  parseNjkFrontmatter,
  frontmatterToPatches,
  loadNjkRouteTemplate,
  clearNjkFrontmatterCaches,
  extractFrontmatterBlock,
};

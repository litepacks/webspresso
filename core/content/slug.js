/**
 * Slug resolution for content items.
 */

/**
 * @param {string} str
 * @returns {string}
 */
function slugify(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * @param {object} opts
 * @param {string} [opts.frontmatterSlug]
 * @param {string} fileBaseName - filename without extension
 * @param {string} [opts.title]
 * @returns {string}
 */
function resolveSlug({ frontmatterSlug, fileBaseName, title }) {
  if (frontmatterSlug && typeof frontmatterSlug === 'string' && frontmatterSlug.trim()) {
    return slugify(frontmatterSlug.trim()) || frontmatterSlug.trim();
  }
  if (fileBaseName && fileBaseName !== 'index') {
    return fileBaseName;
  }
  const fromTitle = slugify(title || '');
  return fromTitle || fileBaseName || 'untitled';
}

/**
 * Build URL from route pattern and slug.
 * @param {string} routePattern e.g. /blog/:slug
 * @param {string} slug
 * @returns {string}
 */
function buildContentUrl(routePattern, slug) {
  return routePattern.replace(/:(\w+)/g, (_, param) => {
    if (param === 'slug') return encodeURIComponent(slug);
    return `:${param}`;
  });
}

module.exports = {
  slugify,
  resolveSlug,
  buildContentUrl,
};

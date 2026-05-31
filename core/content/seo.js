/**
 * SEO metadata from content frontmatter.
 */

/**
 * @param {import('./index').ContentItem} item
 * @param {object} [opts]
 * @param {string} [opts.baseUrl]
 * @returns {Record<string, unknown>}
 */
function buildSeoFromItem(item, opts = {}) {
  const baseUrl = (opts.baseUrl || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  let canonical = item.canonical || null;
  if (canonical && !/^https?:\/\//i.test(canonical)) {
    canonical = `${baseUrl}${canonical.startsWith('/') ? canonical : `/${canonical}`}`;
  } else if (!canonical && item.url) {
    canonical = `${baseUrl}${item.url}`;
  }

  const robots = item.robots || null;
  let indexable = true;
  if (typeof robots === 'string' && /noindex/i.test(robots)) {
    indexable = false;
  }

  return {
    title: item.title || null,
    description: item.description || null,
    image: item.image || null,
    canonical,
    robots,
    indexable,
    author: item.author || null,
    tags: item.tags || [],
  };
}

module.exports = {
  buildSeoFromItem,
};

/**
 * Resolve Nunjucks layout template for content pages.
 */

const fs = require('fs');
const path = require('path');

/**
 * @param {object} opts
 * @param {string[]} opts.templateDirs - Nunjucks roots (viewsDir, pagesDir)
 * @param {string} collection
 * @param {string|null} layoutFromConfig
 * @param {'post'|'list'|'tag'} [kind]
 * @returns {string|null} Template path relative to a template root
 */
function resolveContentLayout({ templateDirs, collection, layoutFromConfig, kind = 'post' }) {
  const candidates = [];

  if (layoutFromConfig) {
    candidates.push(`layouts/${layoutFromConfig}.njk`);
    candidates.push(`layouts/${layoutFromConfig}`);
  }

  if (kind === 'list') {
    candidates.push(`content/${collection}-index.njk`);
    candidates.push('content/list.njk');
  } else if (kind === 'tag') {
    candidates.push('content/tag.njk');
  } else {
    candidates.push(`content/${collection}-post.njk`);
    candidates.push(`content/${collection}-page.njk`);
    candidates.push('content/post.njk');
    candidates.push('content/page.njk');
  }

  candidates.push('content/default.njk');

  for (const rel of candidates) {
    for (const root of templateDirs) {
      const abs = path.join(root, rel);
      if (fs.existsSync(abs)) {
        return rel;
      }
    }
  }

  return null;
}

module.exports = {
  resolveContentLayout,
};

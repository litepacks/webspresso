/**
 * Build phase — pre-index content collections for manifest.
 * @module core/build/phases/02b-content-index
 */

const { resolveContentConfig } = require('../../content/config');
const { ContentIndex } = require('../../content/index');

/**
 * @param {import('../index').BuildContextInternal} ctx
 * @param {object} [appContentConfig] from webspresso.build.js or package
 * @returns {{ items: object[] }|null}
 */
function buildContentIndexPhase(ctx, appContentConfig = null) {
  const contentOpt =
    appContentConfig ||
    ctx.config.content ||
    (ctx.config.contentDir ? { enabled: true, dir: ctx.config.contentDir } : null);

  if (!contentOpt) {
    return null;
  }

  const resolved = resolveContentConfig(
    typeof contentOpt === 'object' ? { ...contentOpt, enabled: contentOpt.enabled !== false } : { enabled: true },
    'production',
    ctx.cwd
  );

  if (!resolved?.enabled) {
    return null;
  }

  const index = new ContentIndex(resolved);
  return {
    version: 1,
    builtAt: new Date().toISOString(),
    items: [...index.items.values()],
  };
}

module.exports = { buildContentIndexPhase };

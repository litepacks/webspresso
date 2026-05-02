/**
 * Resolve the same webspresso/core/orm instance that app model files use
 * when they `require('webspresso')`. Global CLI would otherwise load a
 * different module copy than the project's node_modules.
 */

const path = require('path');

/**
 * @param {string} cwd - Project root (typically `process.cwd()`).
 * @returns {typeof import('../../core/orm')}
 */
function getWebspressoOrmForProject(cwd) {
  try {
    const pkgJson = require.resolve('webspresso/package.json', { paths: [cwd] });
    const root = path.dirname(pkgJson);
    return require(path.join(root, 'core', 'orm'));
  } catch {
    return require(path.join(__dirname, '../../core/orm'));
  }
}

module.exports = { getWebspressoOrmForProject };

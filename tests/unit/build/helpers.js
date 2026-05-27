const fs = require('fs');
const os = require('os');
const path = require('path');

const FIXTURES = path.join(__dirname, '..', '..', 'fixtures');
const PAGES_DIR = path.join(FIXTURES, 'pages');
const VIEWS_DIR = path.join(FIXTURES, 'views');

/**
 * @param {object} [opts]
 * @param {string} [opts.adapter]
 * @param {Record<string, unknown>} [opts.config]
 */
function createBuildProject(opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-build-'));
  fs.cpSync(PAGES_DIR, path.join(tmp, 'pages'), { recursive: true });
  fs.cpSync(VIEWS_DIR, path.join(tmp, 'views'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'public'), { recursive: true });
  const adapter = opts.adapter || 'node';
  const extra = opts.config ? `, ${JSON.stringify(opts.config).slice(1, -1)}` : '';
  fs.writeFileSync(
    path.join(tmp, 'webspresso.build.js'),
    `module.exports = { adapter: "${adapter}", pagesDir: "pages", viewsDir: "views"${extra} };`
  );
  return tmp;
}

/**
 * @param {string} cwd
 */
async function loadBuiltHandlers(cwd) {
  const { pathToFileURL } = require('url');
  const handlersPath = path.join(cwd, '.webspresso/server/handlers.mjs');
  const mod = await import(pathToFileURL(handlersPath).href);
  return mod.handlers;
}

/**
 * @param {string} cwd
 */
function readManifest(cwd) {
  return JSON.parse(
    fs.readFileSync(path.join(cwd, '.webspresso/server/manifest.json'), 'utf8')
  );
}

module.exports = {
  FIXTURES,
  PAGES_DIR,
  VIEWS_DIR,
  createBuildProject,
  loadBuiltHandlers,
  readManifest,
};

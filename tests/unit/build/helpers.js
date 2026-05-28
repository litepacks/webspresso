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
 * @param {'node'|'cloudflare'|'bun'} [adapter]
 */
function outputSubdir(adapter = 'node') {
  return adapter === 'cloudflare' ? 'worker' : 'server';
}

/**
 * @param {string} cwd
 * @param {'node'|'cloudflare'|'bun'} [adapter]
 */
function outputDir(cwd, adapter = 'node') {
  return path.join(cwd, '.webspresso', outputSubdir(adapter));
}

/**
 * @param {string} cwd
 * @param {'node'|'cloudflare'|'bun'} [adapter]
 */
async function loadBuiltHandlers(cwd, adapter = 'node') {
  const { pathToFileURL } = require('url');
  const handlersPath = path.join(outputDir(cwd, adapter), 'handlers.mjs');
  const mod = await import(pathToFileURL(handlersPath).href);
  return mod.handlers;
}

/**
 * @param {string} cwd
 * @param {'node'|'cloudflare'|'bun'} [adapter]
 */
function readManifest(cwd, adapter = 'node') {
  return JSON.parse(
    fs.readFileSync(path.join(outputDir(cwd, adapter), 'manifest.json'), 'utf8')
  );
}

/**
 * @param {string} cwd
 */
async function loadPrecompiledTemplates(cwd) {
  const { pathToFileURL } = require('url');
  const templatesPath = path.join(outputDir(cwd, 'cloudflare'), 'templates.mjs');
  const mod = await import(pathToFileURL(templatesPath).href);
  return mod.default;
}

module.exports = {
  FIXTURES,
  PAGES_DIR,
  VIEWS_DIR,
  createBuildProject,
  outputSubdir,
  outputDir,
  loadBuiltHandlers,
  readManifest,
  loadPrecompiledTemplates,
};

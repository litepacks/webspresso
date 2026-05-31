const path = require('path');
const nunjucks = require('nunjucks');
const fs = require('fs');

const styles = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');

let env = null;

function getEnv() {
  if (!env) {
    env = nunjucks.configure(path.join(__dirname, 'views'), {
      autoescape: true,
      noCache: process.env.NODE_ENV !== 'production',
    });
  }
  return env;
}

const NAV = [
  { id: 'overview', label: 'Overview', path: '' },
  { id: 'routes', label: 'Routes', path: '/routes' },
  { id: 'plugins', label: 'Plugins', path: '/plugins' },
  { id: 'orm', label: 'ORM', path: '/orm' },
  { id: 'cache', label: 'Cache', path: '/cache' },
  { id: 'health', label: 'Health', path: '/health' },
  { id: 'openapi', label: 'OpenAPI', path: '/openapi' },
  { id: 'sitemap', label: 'Sitemap', path: '/sitemap' },
  { id: 'content', label: 'Content', path: '/content' },
  { id: 'env', label: 'Env', path: '/env' },
  { id: 'logs', label: 'Logs', path: '/logs' },
];

/**
 * @param {string} page
 * @param {object} data
 */
function renderStudioPage(page, data = {}) {
  const base = data.studioPath || '/_webspresso';
  const nav = NAV.map((item) => ({
    ...item,
    href: base + item.path,
    active: item.id === page,
  }));

  return getEnv().render('page.njk', {
    ...data,
    page,
    nav,
    styles,
    studioPath: base,
    nodeEnv: process.env.NODE_ENV || 'development',
    title: data.title || 'Webspresso Studio',
    partial: `${page}.njk`,
  });
}

module.exports = { renderStudioPage, NAV };

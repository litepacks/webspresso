const path = require('path');
const { parseEnv } = require('./env.schema');
const { healthCheckPlugin, sitemapPlugin } = require('webspresso/plugins');

function getCreateAppOptions() {
  parseEnv();
  const rootDir = path.resolve(__dirname, '..');
  return {
    pagesDir: path.join(rootDir, 'pages'),
    viewsDir: path.join(rootDir, 'views'),
    publicDir: path.join(rootDir, 'public'),
    plugins: [
      healthCheckPlugin({ path: '/health' }),
      sitemapPlugin({ baseUrl: process.env.BASE_URL || 'http://localhost:3000' }),
    ],
  };
}

module.exports = getCreateAppOptions;

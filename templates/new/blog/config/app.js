const path = require('path');
const fs = require('fs');
const { parseEnv } = require('./env.schema');

function getCreateAppOptions() {
  parseEnv();
  const rootDir = path.resolve(__dirname, '..');
  const options = {
    pagesDir: path.join(rootDir, 'pages'),
    viewsDir: path.join(rootDir, 'views'),
    publicDir: path.join(rootDir, 'public'),
    plugins: [],
  };
  const dbFile = path.join(rootDir, 'webspresso.db.js');
  if (fs.existsSync(dbFile)) {
    const { createDatabase } = require('webspresso');
    options.db = createDatabase(require(dbFile));
  }
  return options;
}

module.exports = getCreateAppOptions;

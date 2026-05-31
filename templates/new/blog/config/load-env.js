const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function loadEnv(rootDir) {
  const root = rootDir || path.resolve(__dirname, '..');
  const loadFile = (name) => {
    const full = path.join(root, name);
    if (fs.existsSync(full)) {
      dotenv.config({ path: full, override: true });
    }
  };
  loadFile('.env');
  loadFile('.env.local');
  const mode = process.env.NODE_ENV || 'development';
  loadFile(`.env.${mode}`);
  loadFile(`.env.${mode}.local`);
}

module.exports = { loadEnv };

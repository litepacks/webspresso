const fs = require('fs');
const path = require('path');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const TEMP_DIRS = [
  path.join(FIXTURES_DIR, 'cli-test-projects'),
  path.join(FIXTURES_DIR, 'cli-test-project'),
  path.join(FIXTURES_DIR, 'admin-password-cli'),
  path.join(FIXTURES_DIR, 'favicon-test'),
];

module.exports = async function () {
  // Clean up any stale temp directories before tests start
  for (const dir of TEMP_DIRS) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  return async () => {
    // Clean up all temp directories after all tests complete
    for (const dir of TEMP_DIRS) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  };
};

/**
 * Start Command
 * Start production server
 */

const fs = require('fs');
const path = require('path');

function registerCommand(program) {
  program
    .command('start')
    .description('Start production server')
    .option('-p, --port <port>', 'Port number (default: $PORT or 7331)')
    .action((options) => {
      if (!fs.existsSync('server.js')) {
        console.error('❌ server.js not found! Make sure you are in a Webspresso project.');
        process.exit(1);
      }
      
      // Respect the platform-provided PORT (Cloud Run, Render, Heroku...) unless --port is given
      options.port = options.port || process.env.PORT || '7331';
      process.env.PORT = options.port;
      process.env.NODE_ENV = 'production';
      
      console.log(`\n🚀 Starting production server on port ${options.port}...\n`);
      
      const serverPath = path.resolve(process.cwd(), 'server.js');
      require(serverPath);
    });
}

module.exports = { registerCommand };

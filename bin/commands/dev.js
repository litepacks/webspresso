/**
 * Dev Command
 * Start development server
 */

const fs = require('fs');
const { spawn } = require('child_process');

function registerCommand(program) {
  program
    .command('dev')
    .description('Start development server')
    .option('-p, --port <port>', 'Port number', '3000')
    .option('--no-css', 'Skip CSS watch (if Tailwind is set up)')
    .action((options) => {
      if (!fs.existsSync('server.js')) {
        console.error('❌ server.js not found! Make sure you are in a Webspresso project.');
        process.exit(1);
      }
      
      process.env.PORT = options.port;
      process.env.NODE_ENV = 'development';
      
      const hasTailwind = fs.existsSync('tailwind.config.js') && fs.existsSync('src/input.css');
      const shouldWatchCss = hasTailwind && options.css !== false;
      
      if (shouldWatchCss) {
        console.log(`\n🚀 Starting development server on port ${options.port}...`);
        console.log('   Watching CSS and server files...\n');
        
        // Start CSS watch
        const cssWatch = spawn('npm', ['run', 'watch:css'], {
          stdio: 'inherit',
          shell: true
        });
        
        // Start server
        const server = spawn('node', ['--watch', 'server.js'], {
          stdio: 'inherit',
          shell: true,
          env: { ...process.env, PORT: options.port, NODE_ENV: 'development' }
        });
        
        // Handle exit
        const cleanup = () => {
          cssWatch.kill();
          server.kill();
          process.exit(0);
        };
        
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
        
        cssWatch.on('exit', cleanup);
        server.on('exit', cleanup);
      } else {
        console.log(`\n🚀 Starting development server on port ${options.port}...\n`);
        
        const { spawn } = require('child_process');
        const child = spawn('node', ['--watch', 'server.js'], {
          stdio: 'inherit',
          shell: true,
          env: { ...process.env, PORT: options.port, NODE_ENV: 'development' }
        });
        
        child.on('exit', (code) => {
          process.exit(code || 0);
        });
      }
    });
}

module.exports = { registerCommand };

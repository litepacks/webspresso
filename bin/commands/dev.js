/**
 * Dev Command
 * Start development server
 */

const fs = require('fs');
const { spawn } = require('child_process');

/**
 * Build node --watch arguments with additional watch paths
 * @returns {string[]} Node arguments
 */
function buildWatchArgs() {
  const args = ['--watch'];
  
  // Add watch paths for common directories
  const watchPaths = ['pages', 'models', 'views'];
  
  for (const dir of watchPaths) {
    if (fs.existsSync(dir)) {
      args.push(`--watch-path=./${dir}`);
    }
  }
  
  args.push('server.js');
  return args;
}

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
      
      // Build watch arguments
      const watchArgs = buildWatchArgs();
      const watchDirs = watchArgs.filter(a => a.startsWith('--watch-path')).map(a => a.split('=')[1]);
      
      if (shouldWatchCss) {
        console.log(`\n🚀 Starting development server on port ${options.port}...`);
        console.log(`   Watching: server.js${watchDirs.length ? ', ' + watchDirs.join(', ') : ''}, CSS\n`);
        
        // Start CSS watch
        const cssWatch = spawn('npm', ['run', 'watch:css'], {
          stdio: 'inherit',
          shell: true
        });
        
        // Start server with watch paths
        const server = spawn('node', watchArgs, {
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
        console.log(`\n🚀 Starting development server on port ${options.port}...`);
        console.log(`   Watching: server.js${watchDirs.length ? ', ' + watchDirs.join(', ') : ''}\n`);
        
        const child = spawn('node', watchArgs, {
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

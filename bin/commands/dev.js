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
  
  // Add watch paths for server-side code directories (services, models, config, pages)
  // Note: views contains Nunjucks templates which are live-reloaded in-memory by devReloadHub
  const watchPaths = ['pages', 'models', 'services', 'config'];
  
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
    .option('-p, --port <port>', 'Port number', '7331')
    .option('--no-css', 'Skip CSS watch (if Tailwind is set up)')
    .option('--no-js', 'Skip client JS watch (if esbuild / watch:js is set up)')
    .action((options) => {
      if (!fs.existsSync('server.js')) {
        console.error('❌ server.js not found! Make sure you are in a Webspresso project.');
        process.exit(1);
      }
      
      process.env.PORT = options.port;
      process.env.NODE_ENV = 'development';
      
      let packageJson = {};
      if (fs.existsSync('package.json')) {
        try {
          packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
        } catch (_) {}
      }
      const hasTailwindV3 = fs.existsSync('tailwind.config.js') && fs.existsSync('src/input.css');
      const hasTailwindV4 = fs.existsSync('src/input.css') && Boolean(
        (packageJson.devDependencies && (packageJson.devDependencies['@tailwindcss/cli'] || packageJson.devDependencies['tailwindcss'])) ||
        (packageJson.scripts && packageJson.scripts['watch:css'])
      );
      const hasTailwind = hasTailwindV3 || hasTailwindV4;
      const shouldWatchCss = hasTailwind && options.css !== false;

      const hasJsWatch = Boolean(
        (packageJson.scripts && packageJson.scripts['watch:js']) ||
        fs.existsSync('src/client/main.js') ||
        fs.existsSync('src/client/main.ts') ||
        fs.existsSync('esbuild.config.js')
      );
      const shouldWatchJs = hasJsWatch && options.js !== false && Boolean(packageJson.scripts && packageJson.scripts['watch:js']);
      
      // Build watch arguments
      const watchArgs = buildWatchArgs();
      const watchDirs = watchArgs.filter(a => a.startsWith('--watch-path')).map(a => a.split('=')[1]);
      
      const watchingLabels = ['server.js'];
      if (watchDirs.length) watchingLabels.push(...watchDirs);
      if (shouldWatchCss) watchingLabels.push('CSS');
      if (shouldWatchJs) watchingLabels.push('JS (esbuild)');

      console.log(`\n🚀 Starting development server on port ${options.port}...`);
      console.log(`   Watching: ${watchingLabels.join(', ')}\n`);

      const managedProcesses = [];
      let isCleaningUp = false;

      const cleanup = (code = 0) => {
        if (isCleaningUp) return;
        isCleaningUp = true;
        for (const p of managedProcesses) {
          try {
            if (p && !p.killed) {
              p.kill('SIGTERM');
            }
          } catch (_) {}
        }
        process.exit(code);
      };

      process.once('SIGINT', () => cleanup(0));
      process.once('SIGTERM', () => cleanup(0));

      if (shouldWatchCss) {
        const cssWatch = spawn('npm', ['run', 'watch:css'], {
          stdio: 'inherit',
          shell: true,
        });
        managedProcesses.push(cssWatch);
        cssWatch.on('exit', () => cleanup(0));
      }

      if (shouldWatchJs) {
        const jsWatch = spawn('npm', ['run', 'watch:js'], {
          stdio: 'inherit',
          shell: true,
        });
        managedProcesses.push(jsWatch);
        jsWatch.on('exit', () => cleanup(0));
      }

      const server = spawn('node', watchArgs, {
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, PORT: options.port, NODE_ENV: 'development' },
      });
      managedProcesses.push(server);
      server.on('exit', (code) => cleanup(code || 0));
    });
}

module.exports = { registerCommand };

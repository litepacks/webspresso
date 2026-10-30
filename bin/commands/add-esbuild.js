/**
 * Add esbuild Command
 * Add esbuild client bundling and incremental watch to the project
 */

const fs = require('fs');
const path = require('path');
const { getAddCommand } = require('../utils/add-command');

function registerCommand(program) {
  configureCommand(program.command('add:esbuild'));
  configureCommand(getAddCommand(program).command('esbuild'));
}

function configureCommand(command) {
  command
    .description('Add esbuild client bundling and incremental watch to the project')
    .action(async () => {
      if (!fs.existsSync('package.json')) {
        console.error('❌ Not a Webspresso project! Run this command in your project directory.');
        process.exit(1);
      }

      console.log('\n⚡ Adding esbuild client bundler to your project...\n');

      // Read package.json
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
      packageJson.devDependencies = packageJson.devDependencies || {};
      packageJson.devDependencies['esbuild'] = '^0.25.0';

      packageJson.scripts = packageJson.scripts || {};
      packageJson.scripts['build:js'] = 'esbuild src/client/main.js --bundle --outdir=public/js --minify --sourcemap';
      packageJson.scripts['watch:js'] = 'esbuild src/client/main.js --bundle --outdir=public/js --sourcemap --watch';

      fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2) + '\n');
      console.log('✅ Updated package.json (esbuild devDependency and build:js / watch:js scripts)');

      // Create src/client directory
      if (!fs.existsSync('src/client')) {
        fs.mkdirSync('src/client', { recursive: true });
      }

      // Create src/client/main.js if not exists
      const mainJsPath = path.join('src', 'client', 'main.js');
      if (!fs.existsSync(mainJsPath)) {
        const clientStarterCode = `// Client-side JavaScript entry point
console.log('⚡ Webspresso client script loaded');

document.addEventListener('DOMContentLoaded', () => {
  // Client interactivity
});
`;
        fs.writeFileSync(mainJsPath, clientStarterCode);
        console.log('✅ Created src/client/main.js');
      }

      // Create public/js directory
      if (!fs.existsSync(path.join('public', 'js'))) {
        fs.mkdirSync(path.join('public', 'js'), { recursive: true });
      }

      // Update layout.njk to include script if not present
      const layoutPath = path.join('views', 'layout.njk');
      if (fs.existsSync(layoutPath)) {
        let layoutContent = fs.readFileSync(layoutPath, 'utf-8');
        if (!layoutContent.includes('/js/main.js')) {
          layoutContent = layoutContent.replace(
            /(<\/head>)/,
            '  <script defer src="/js/main.js"></script>\n$1'
          );
          fs.writeFileSync(layoutPath, layoutContent);
          console.log('✅ Updated views/layout.njk (<script defer src="/js/main.js"></script>)');
        }
      }

      console.log('\n✅ esbuild setup complete!\n');
      console.log('Next steps:');
      console.log('  npm install');
      console.log('  npm run build:js');
      console.log('  npm run dev\n');
    });
}

module.exports = { registerCommand };

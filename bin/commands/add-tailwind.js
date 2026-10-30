/**
 * Add Tailwind Command
 * Add Tailwind CSS to the project with build process
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getAddCommand } = require('../utils/add-command');

function registerCommand(program) {
  configureCommand(program.command('add:tailwind'));
  configureCommand(getAddCommand(program).command('tailwind'));
}

function configureCommand(command) {
  command
    .description('Add Tailwind CSS to the project with build process')
    .option('--v4', 'Use Tailwind CSS v4 (Oxide engine, LightningCSS, zero postcss config)')
    .option('--v3', 'Use Tailwind CSS v3 (legacy PostCSS engine)')
    .option('-v, --tailwind-version <version>', 'Tailwind version (3 or 4)', '3')
    .option('--upgrade', 'Upgrade existing Tailwind v3 project to Tailwind v4')
    .action(async (...actionArgs) => {
      const cmd = actionArgs[actionArgs.length - 1];
      const options = (cmd && typeof cmd.opts === 'function')
        ? cmd.opts()
        : (actionArgs.find(a => a && typeof a === 'object') || {});

      if (!fs.existsSync('package.json')) {
        console.error('❌ Not a Webspresso project! Run this command in your project directory.');
        process.exit(1);
      }
      
      const isV4 = Boolean(options.v4 || options.upgrade || options.tailwindVersion === '4');

      console.log(`\n🎨 Adding Tailwind CSS ${isV4 ? 'v4 (Oxide engine, zero-config)' : 'v3'} to your project...\n`);
      
      // Read package.json
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
      
      // Add dev dependencies
      if (!packageJson.devDependencies) {
        packageJson.devDependencies = {};
      }
      
      if (!packageJson.scripts) {
        packageJson.scripts = {};
      }

      if (isV4) {
        packageJson.devDependencies['@tailwindcss/cli'] = '^4.0.0';
        packageJson.devDependencies['tailwindcss'] = '^4.0.0';
        delete packageJson.devDependencies['postcss'];
        delete packageJson.devDependencies['autoprefixer'];

        packageJson.scripts['build:css'] = '@tailwindcss/cli -i ./src/input.css -o ./public/css/style.css --minify';
        packageJson.scripts['watch:css'] = '@tailwindcss/cli -i ./src/input.css -o ./public/css/style.css --watch';
      } else {
        packageJson.devDependencies['tailwindcss'] = '^3.4.1';
        packageJson.devDependencies['postcss'] = '^8.4.35';
        packageJson.devDependencies['autoprefixer'] = '^10.4.17';

        packageJson.scripts['build:css'] = 'tailwindcss -i ./src/input.css -o ./public/css/style.css --minify';
        packageJson.scripts['watch:css'] = 'tailwindcss -i ./src/input.css -o ./public/css/style.css --watch';
      }
      
      // Update dev script to include CSS watch
      if (packageJson.scripts.dev) {
        packageJson.scripts.dev = 'npm run watch:css & node --watch server.js';
      }
      
      // Update start script to build CSS
      if (packageJson.scripts.start) {
        packageJson.scripts.start = 'npm run build:css && NODE_ENV=production node server.js';
      }
      
      fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2) + '\n');
      console.log(`✅ Updated package.json (${isV4 ? 'Tailwind v4' : 'Tailwind v3'})`);
      
      // Create src directory if it doesn't exist
      if (!fs.existsSync('src')) {
        fs.mkdirSync('src', { recursive: true });
      }
      
      if (isV4) {
        // Create v4 input.css
        const inputCss = `@import "tailwindcss";

@source "../pages/**/*.{njk,js}";
@source "../views/**/*.njk";
@source "../src/**/*.js";
`;
        fs.writeFileSync('src/input.css', inputCss);
        console.log('✅ Created src/input.css (@import "tailwindcss"; + @source directives)');

        // If upgrading from v3, clean up obsolete configs
        if (fs.existsSync('postcss.config.js')) {
          try {
            fs.unlinkSync('postcss.config.js');
            console.log('🧹 Removed obsolete postcss.config.js (not needed in v4)');
          } catch (_) {}
        }
        if (fs.existsSync('tailwind.config.js')) {
          try {
            fs.renameSync('tailwind.config.js', 'tailwind.config.js.backup');
            console.log('ℹ️  Renamed tailwind.config.js to tailwind.config.js.backup (v4 is CSS-first)');
          } catch (_) {}
        }
      } else {
        // Create v3 input.css
        const inputCss = `@tailwind base;
@tailwind components;
@tailwind utilities;
`;
        fs.writeFileSync('src/input.css', inputCss);
        console.log('✅ Created src/input.css');
        
        // Create tailwind.config.js
        const tailwindConfig = `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{njk,js}',
    './views/**/*.njk',
    './src/**/*.js'
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
`;
        fs.writeFileSync('tailwind.config.js', tailwindConfig);
        console.log('✅ Created tailwind.config.js');
        
        // Create postcss.config.js
        const postcssConfig = `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`;
        fs.writeFileSync('postcss.config.js', postcssConfig);
        console.log('✅ Created postcss.config.js');
      }
      
      // Check if layout.njk exists and update it (before creating CSS)
      const layoutPath = 'views/layout.njk';
      if (fs.existsSync(layoutPath)) {
        let layoutContent = fs.readFileSync(layoutPath, 'utf-8');
        
        // Remove CDN script if exists
        layoutContent = layoutContent.replace(
          /<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/g,
          ''
        );
        
        // Add local CSS link if not exists
        if (!layoutContent.includes('/css/style.css')) {
          layoutContent = layoutContent.replace(
            /(<\/head>)/,
            '  <link rel="stylesheet" href="/css/style.css">\n$1'
          );
        }
        
        fs.writeFileSync(layoutPath, layoutContent);
        console.log('✅ Updated views/layout.njk');
      }
      
      // Create public/css directory
      if (!fs.existsSync('public/css')) {
        fs.mkdirSync('public/css', { recursive: true });
      }
      
      // Create placeholder CSS
      fs.writeFileSync('public/css/style.css', '/* Run npm run build:css */\n');
      console.log('✅ Created public/css/style.css');

      // Ensure public/css/style.css is in .gitignore
      if (fs.existsSync('.gitignore')) {
        let gitignore = fs.readFileSync('.gitignore', 'utf-8');
        if (!gitignore.includes('public/css/style.css')) {
          gitignore = gitignore.trimEnd() + '\npublic/css/style.css\n';
          fs.writeFileSync('.gitignore', gitignore);
          console.log('✅ Added public/css/style.css to .gitignore');
        }
      }
      
      // Try to build CSS if tailwindcss / @tailwindcss/cli is already installed
      const tailwindBin = path.join(process.cwd(), 'node_modules', '.bin', 'tailwindcss');
      const tailwindCliBin = path.join(process.cwd(), 'node_modules', '.bin', '@tailwindcss/cli');
      if (fs.existsSync(tailwindBin) || fs.existsSync(tailwindCliBin)) {
        try {
          console.log('\n🎨 Building Tailwind CSS from your templates...');
          execSync('npm run build:css', { stdio: 'inherit', cwd: process.cwd() });
          console.log('✅ Tailwind CSS built successfully!\n');
        } catch (err) {
          console.log('\n⚠️  CSS build failed. Run "npm run build:css" manually.\n');
        }
      } else {
        console.log(`\n✅ Tailwind CSS ${isV4 ? 'v4' : 'v3'} added successfully!\n`);
        console.log('Next steps:');
        console.log('  npm install');
        console.log('  npm run build:css');
        console.log('  npm run dev\n');
      }
    });
}

module.exports = { registerCommand };

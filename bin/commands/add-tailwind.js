/**
 * Add Tailwind Command
 * Add Tailwind CSS to the project with build process
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function registerCommand(program) {
  program
    .command('add tailwind')
    .description('Add Tailwind CSS to the project with build process')
    .action(async () => {
      if (!fs.existsSync('package.json')) {
        console.error('❌ Not a Webspresso project! Run this command in your project directory.');
        process.exit(1);
      }
      
      console.log('\n🎨 Adding Tailwind CSS to your project...\n');
      
      // Read package.json
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
      
      // Add dev dependencies
      if (!packageJson.devDependencies) {
        packageJson.devDependencies = {};
      }
      
      packageJson.devDependencies['tailwindcss'] = '^3.4.1';
      packageJson.devDependencies['postcss'] = '^8.4.35';
      packageJson.devDependencies['autoprefixer'] = '^10.4.17';
      
      // Add build scripts
      if (!packageJson.scripts) {
        packageJson.scripts = {};
      }
      
      packageJson.scripts['build:css'] = 'tailwindcss -i ./src/input.css -o ./public/css/style.css --minify';
      packageJson.scripts['watch:css'] = 'tailwindcss -i ./src/input.css -o ./public/css/style.css --watch';
      
      // Update dev script to include CSS watch
      if (packageJson.scripts.dev) {
        packageJson.scripts.dev = 'npm run watch:css & node --watch server.js';
      }
      
      // Update start script to build CSS
      if (packageJson.scripts.start) {
        packageJson.scripts.start = 'npm run build:css && NODE_ENV=production node server.js';
      }
      
      fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2) + '\n');
      console.log('✅ Updated package.json');
      
      // Create src directory if it doesn't exist
      if (!fs.existsSync('src')) {
        fs.mkdirSync('src', { recursive: true });
      }
      
      // Create input.css
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
      
      // Try to build CSS if tailwindcss is already installed
      const tailwindBin = path.join(process.cwd(), 'node_modules', '.bin', 'tailwindcss');
      if (fs.existsSync(tailwindBin)) {
        try {
          console.log('\n🎨 Building Tailwind CSS from your templates...');
          execSync('npm run build:css', { stdio: 'inherit', cwd: process.cwd() });
          console.log('✅ Tailwind CSS built successfully!\n');
        } catch (err) {
          console.log('\n⚠️  CSS build failed. Run "npm run build:css" manually.\n');
        }
      } else {
        console.log('\n✅ Tailwind CSS added successfully!\n');
        console.log('Next steps:');
        console.log('  npm install');
        console.log('  npm run build:css');
        console.log('  npm run dev\n');
      }
    });
}

module.exports = { registerCommand };

#!/usr/bin/env node

/**
 * Webspresso CLI
 * Command-line interface for Webspresso framework
 */

const { program } = require('commander');
const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

program
  .name('webspresso')
  .description('Webspresso CLI - Minimal file-based SSR framework')
  .version(require('../package.json').version);

// New project command
program
  .command('new [project-name]')
  .description('Create a new Webspresso project')
  .option('-t, --template <template>', 'Template to use (minimal, full)', 'minimal')
  .option('--no-tailwind', 'Skip Tailwind CSS setup')
  .option('-i, --install', 'Auto install dependencies and build CSS')
  .action(async (projectNameArg, options) => {
    const useTailwind = options.tailwind !== false;
    const autoInstall = options.install === true;
    
    let projectName;
    let projectPath;
    let useCurrentDir = false;
    
    if (!projectNameArg) {
      // No project name provided - ask if they want to use current directory
      const currentDirName = path.basename(process.cwd());
      const currentDirFiles = fs.readdirSync(process.cwd());
      const hasExistingFiles = currentDirFiles.some(f => !f.startsWith('.'));
      
      const { useCurrent } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'useCurrent',
          message: `Install in current directory (${currentDirName})?`,
          default: true
        }
      ]);
      
      if (useCurrent) {
        useCurrentDir = true;
        projectPath = process.cwd();
        
        // Check for existing Webspresso files
        if (fs.existsSync(path.join(projectPath, 'server.js')) || 
            fs.existsSync(path.join(projectPath, 'pages'))) {
          console.error('❌ Current directory already contains a Webspresso project!');
          process.exit(1);
        }
        
        // Warn if there are existing files
        if (hasExistingFiles) {
          const { continueAnyway } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'continueAnyway',
              message: '⚠️  Current directory is not empty. Continue anyway?',
              default: false
            }
          ]);
          
          if (!continueAnyway) {
            console.log('Cancelled.');
            process.exit(0);
          }
        }
        
        // Ask for project name (for package.json)
        const { name } = await inquirer.prompt([
          {
            type: 'input',
            name: 'name',
            message: 'Project name:',
            default: currentDirName,
            validate: (input) => {
              if (!input.trim()) return 'Project name is required';
              if (!/^[a-z0-9-_]+$/i.test(input)) return 'Project name can only contain letters, numbers, hyphens, and underscores';
              return true;
            }
          }
        ]);
        
        projectName = name;
      } else {
        // Ask for directory name
        const { dirName } = await inquirer.prompt([
          {
            type: 'input',
            name: 'dirName',
            message: 'Project directory name:',
            validate: (input) => {
              if (!input.trim()) return 'Directory name is required';
              if (!/^[a-z0-9-_]+$/i.test(input)) return 'Directory name can only contain letters, numbers, hyphens, and underscores';
              if (fs.existsSync(path.resolve(input))) return `Directory ${input} already exists!`;
              return true;
            }
          }
        ]);
        
        projectName = dirName;
        projectPath = path.resolve(dirName);
      }
    } else {
      projectName = projectNameArg;
      projectPath = path.resolve(projectNameArg);
      
      if (fs.existsSync(projectPath)) {
        console.error(`❌ Directory ${projectName} already exists!`);
        process.exit(1);
      }
    }
    
    console.log(`\n🚀 Creating new Webspresso project: ${projectName}\n`);
    
    // Create directory structure (skip root if using current dir)
    if (!useCurrentDir) {
      fs.mkdirSync(projectPath, { recursive: true });
    }
    fs.mkdirSync(path.join(projectPath, 'pages'), { recursive: true });
    fs.mkdirSync(path.join(projectPath, 'pages', 'locales'), { recursive: true });
    fs.mkdirSync(path.join(projectPath, 'views'), { recursive: true });
    fs.mkdirSync(path.join(projectPath, 'public'), { recursive: true });
    
    // Create package.json
    const packageJson = {
      name: projectName,
      version: '1.0.0',
      description: 'Webspresso project',
      main: 'server.js',
      scripts: {
        dev: 'node --watch server.js',
        start: 'NODE_ENV=production node server.js'
      },
      dependencies: {
        webspresso: '*',
        dotenv: '^16.3.1'
      }
    };
    
    fs.writeFileSync(
      path.join(projectPath, 'package.json'),
      JSON.stringify(packageJson, null, 2) + '\n'
    );
    
    // Create server.js
    const serverJs = `require('dotenv').config();
const { createApp } = require('webspresso');
const path = require('path');

const { app } = createApp({
  pagesDir: path.join(__dirname, 'pages'),
  viewsDir: path.join(__dirname, 'views'),
  publicDir: path.join(__dirname, 'public')
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(\`🚀 Server running at http://localhost:\${PORT}\`);
});
`;
    
    fs.writeFileSync(path.join(projectPath, 'server.js'), serverJs);
    
    // Create .env.example
    const envExample = `PORT=3000
NODE_ENV=development
DEFAULT_LOCALE=en
SUPPORTED_LOCALES=en,tr
BASE_URL=http://localhost:3000
`;
    
    fs.writeFileSync(path.join(projectPath, '.env.example'), envExample);
    
    // Create .gitignore
    const gitignore = `node_modules/
.env
.env.local
.DS_Store
coverage/
*.log
`;
    
    fs.writeFileSync(path.join(projectPath, '.gitignore'), gitignore);
    
    // Create default layout
    let layoutNjk;
    
    if (useTailwind) {
      layoutNjk = `<!DOCTYPE html>
<html lang="{{ locale or 'en' }}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{ meta.title or 'Webspresso' }}</title>
  {% if meta.description %}
  <meta name="description" content="{{ meta.description }}">
  {% endif %}
  {% if meta.canonical %}
  <link rel="canonical" href="{{ meta.canonical }}">
  {% else %}
  <link rel="canonical" href="{{ fsy.canonical() }}">
  {% endif %}
  <link rel="stylesheet" href="/css/style.css">
</head>
<body class="min-h-screen flex flex-col bg-gray-50">
  <nav class="bg-white shadow-sm border-b border-gray-200">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex justify-between h-16">
        <div class="flex items-center">
          <a href="/" class="text-xl font-bold text-gray-900 hover:text-gray-700">
            {{ t('site.name') or 'Webspresso' }}
          </a>
        </div>
        <div class="flex items-center space-x-4">
          <a href="/" class="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium {% if fsy.isPath('/') %}text-blue-600 bg-blue-50{% endif %}">
            {{ t('nav.home') or 'Home' }}
          </a>
        </div>
      </div>
    </div>
  </nav>
  
  <main class="flex-1 max-w-7xl mx-auto py-6 sm:px-6 lg:px-8 w-full">
    {% block content %}{% endblock %}
  </main>
  
  <footer class="bg-white border-t border-gray-200">
    <div class="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8">
      <p class="text-center text-sm text-gray-500">
        {{ t('footer.copyright') or '© 2025 Webspresso. All rights reserved.' }}
      </p>
    </div>
  </footer>
</body>
</html>
`;
    } else {
      layoutNjk = `<!DOCTYPE html>
<html lang="{{ locale or 'en' }}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{ meta.title or 'Webspresso' }}</title>
  {% if meta.description %}
  <meta name="description" content="{{ meta.description }}">
  {% endif %}
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
  <main>
    {% block content %}{% endblock %}
  </main>
</body>
</html>
`;
    }
    
    fs.writeFileSync(path.join(projectPath, 'views', 'layout.njk'), layoutNjk);
    
    // Create index page
    let indexNjk;
    
    if (useTailwind) {
      indexNjk = `{% extends "layout.njk" %}

{% block content %}
<div class="px-4 py-16 sm:px-6 lg:px-8">
  <div class="text-center">
    <h1 class="text-4xl font-bold text-gray-900 sm:text-5xl md:text-6xl">
      {{ t('welcome') or 'Welcome to Webspresso' }}
    </h1>
    <p class="mt-3 max-w-md mx-auto text-base text-gray-500 sm:text-lg md:mt-5 md:text-xl md:max-w-3xl">
      {{ t('description') or 'Start building your SSR app!' }}
    </p>
    <div class="mt-5 max-w-md mx-auto sm:flex sm:justify-center md:mt-8">
      <div class="rounded-md shadow">
        <a href="/" class="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 md:py-4 md:text-lg md:px-10">
          Get started
        </a>
      </div>
    </div>
  </div>
</div>
{% endblock %}
`;
    } else {
      indexNjk = `{% extends "layout.njk" %}

{% block content %}
<div>
  <h1>{{ t('welcome') or 'Welcome to Webspresso' }}</h1>
  <p>{{ t('description') or 'Start building your SSR app!' }}</p>
</div>
{% endblock %}
`;
    }
    
    fs.writeFileSync(path.join(projectPath, 'pages', 'index.njk'), indexNjk);
    
    // Create locales
    const enJson = {
      site: {
        name: 'Webspresso'
      },
      nav: {
        home: 'Home'
      },
      footer: {
        copyright: '© 2025 Webspresso. All rights reserved.'
      },
      welcome: 'Welcome to Webspresso',
      description: 'Start building your SSR app!'
    };
    
    fs.writeFileSync(
      path.join(projectPath, 'pages', 'locales', 'en.json'),
      JSON.stringify(enJson, null, 2) + '\n'
    );
    
    const trJson = {
      site: {
        name: 'Webspresso'
      },
      nav: {
        home: 'Ana Sayfa'
      },
      footer: {
        copyright: '© 2025 Webspresso. Tüm hakları saklıdır.'
      },
      welcome: 'Webspresso\'ya Hoş Geldiniz',
      description: 'SSR uygulamanızı oluşturmaya başlayın!'
    };
    
    fs.writeFileSync(
      path.join(projectPath, 'pages', 'locales', 'tr.json'),
      JSON.stringify(trJson, null, 2) + '\n'
    );
    
    // Create README
    const readme = `# ${projectName}

Webspresso project

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

Visit http://localhost:3000
`;
    
    fs.writeFileSync(path.join(projectPath, 'README.md'), readme);
    
    // Add Tailwind if requested (default: true)
    if (useTailwind) {
      console.log('\n🎨 Setting up Tailwind CSS...\n');
      
      // Create src directory
      fs.mkdirSync(path.join(projectPath, 'src'), { recursive: true });
      
      // Create input.css
      const inputCss = `@tailwind base;
@tailwind components;
@tailwind utilities;
`;
      fs.writeFileSync(path.join(projectPath, 'src', 'input.css'), inputCss);
      
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
      fs.writeFileSync(path.join(projectPath, 'tailwind.config.js'), tailwindConfig);
      
      // Create postcss.config.js
      const postcssConfig = `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`;
      fs.writeFileSync(path.join(projectPath, 'postcss.config.js'), postcssConfig);
      
      // Create public/css directory
      fs.mkdirSync(path.join(projectPath, 'public', 'css'), { recursive: true });
      
      // Create placeholder CSS (will be replaced by build)
      fs.writeFileSync(path.join(projectPath, 'public', 'css', 'style.css'), '/* Run npm run build:css */\n');
      
      // Update package.json
      const updatedPackageJson = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8'));
      updatedPackageJson.devDependencies = updatedPackageJson.devDependencies || {};
      updatedPackageJson.devDependencies['tailwindcss'] = '^3.4.1';
      updatedPackageJson.devDependencies['postcss'] = '^8.4.35';
      updatedPackageJson.devDependencies['autoprefixer'] = '^10.4.17';
      
      updatedPackageJson.scripts['build:css'] = 'tailwindcss -i ./src/input.css -o ./public/css/style.css --minify';
      updatedPackageJson.scripts['watch:css'] = 'tailwindcss -i ./src/input.css -o ./public/css/style.css --watch';
      updatedPackageJson.scripts.dev = 'npm run watch:css & node --watch server.js';
      updatedPackageJson.scripts.start = 'npm run build:css && NODE_ENV=production node server.js';
      
      fs.writeFileSync(
        path.join(projectPath, 'package.json'),
        JSON.stringify(updatedPackageJson, null, 2) + '\n'
      );
      
      console.log('✅ Tailwind CSS setup complete!');
    }
    
    // Auto install if requested
    if (autoInstall) {
      console.log('\n📦 Installing dependencies...\n');
      const { execSync } = require('child_process');
      try {
        execSync('npm install', { 
          stdio: 'inherit', 
          cwd: projectPath 
        });
        
        if (useTailwind) {
          console.log('\n🎨 Building Tailwind CSS...\n');
          execSync('npm run build:css', { 
            stdio: 'inherit', 
            cwd: projectPath 
          });
        }
        
        console.log('\n✅ Project ready!\n');
        console.log('Start developing:');
        if (!useCurrentDir) {
          console.log(`  cd ${projectName}`);
        }
        console.log('  npm run dev\n');
      } catch (err) {
        console.error('❌ Installation failed:', err.message);
        process.exit(1);
      }
    } else {
      console.log('\n✅ Project created successfully!\n');
      console.log('Next steps:');
      if (!useCurrentDir) {
        console.log(`  cd ${projectName}`);
      }
      console.log('  npm install');
      if (useTailwind) {
        console.log('  npm run build:css');
      }
      console.log('  npm run dev\n');
    }
  });

// Add page command
program
  .command('page')
  .description('Add a new page to the current project')
  .action(async () => {
    if (!fs.existsSync('pages')) {
      console.error('❌ Not a Webspresso project! Run this command in your project directory.');
      process.exit(1);
    }
    
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'route',
        message: 'Route path (e.g., /about or /blog/post):',
        validate: (input) => {
          if (!input.startsWith('/')) {
            return 'Route must start with /';
          }
          return true;
        }
      },
      {
        type: 'confirm',
        name: 'hasConfig',
        message: 'Add route config file (.js)?',
        default: false
      },
      {
        type: 'confirm',
        name: 'hasLocales',
        message: 'Add locale files?',
        default: false
      }
    ]);
    
    const route = answers.route.replace(/^\//, '');
    const routePath = path.join('pages', route);
    const dirPath = path.dirname(routePath);
    const fileName = path.basename(routePath);
    
    // Create directory
    fs.mkdirSync(dirPath, { recursive: true });
    
    // Create .njk file
    const templateName = fileName === 'index' ? 'index' : fileName;
    const njkFile = path.join(dirPath, `${templateName}.njk`);
    
    const njkContent = `{% extends "layout.njk" %}

{% block content %}
<div>
  <h1>{{ t('title') or '${route}' }}</h1>
  <p>{{ t('description') or 'Page content' }}</p>
</div>
{% endblock %}
`;
    
    fs.writeFileSync(njkFile, njkContent);
    console.log(`✅ Created ${njkFile}`);
    
    // Create config file if requested
    if (answers.hasConfig) {
      const jsFile = path.join(dirPath, `${templateName}.js`);
      const jsContent = `module.exports = {
  async load(req, ctx) {
    return {
      // Add your data here
    };
  },
  
  meta(req, ctx) {
    return {
      title: ctx.t('meta.title') || '${route}',
      description: ctx.t('meta.description') || ''
    };
  }
};
`;
      
      fs.writeFileSync(jsFile, jsContent);
      console.log(`✅ Created ${jsFile}`);
    }
    
    // Create locales if requested
    if (answers.hasLocales) {
      const localesDir = path.join(dirPath, 'locales');
      fs.mkdirSync(localesDir, { recursive: true });
      
      const enContent = {
        title: route,
        description: 'Page description',
        meta: {
          title: `${route} - Webspresso`,
          description: 'Page description'
        }
      };
      
      fs.writeFileSync(
        path.join(localesDir, 'en.json'),
        JSON.stringify(enContent, null, 2) + '\n'
      );
      
      const trContent = {
        title: route,
        description: 'Sayfa açıklaması',
        meta: {
          title: `${route} - Webspresso`,
          description: 'Sayfa açıklaması'
        }
      };
      
      fs.writeFileSync(
        path.join(localesDir, 'tr.json'),
        JSON.stringify(trContent, null, 2) + '\n'
      );
      
      console.log(`✅ Created locale files in ${localesDir}`);
    }
    
    console.log(`\n✅ Page created at ${route}\n`);
  });

// Add API command
program
  .command('api')
  .description('Add a new API endpoint to the current project')
  .action(async () => {
    if (!fs.existsSync('pages')) {
      console.error('❌ Not a Webspresso project! Run this command in your project directory.');
      process.exit(1);
    }
    
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'route',
        message: 'API route path (e.g., /api/users or /api/users/[id]):',
        validate: (input) => {
          if (!input.startsWith('/api/')) {
            return 'API route must start with /api/';
          }
          return true;
        }
      },
      {
        type: 'list',
        name: 'method',
        message: 'HTTP method:',
        choices: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        default: 'GET'
      }
    ]);
    
    const route = answers.route.replace(/^\/api\//, '');
    const routePath = path.join('pages', 'api', route);
    const dirPath = path.dirname(routePath);
    const fileName = path.basename(routePath);
    
    // Create directory
    fs.mkdirSync(dirPath, { recursive: true });
    
    // Create API file
    const apiFile = path.join(dirPath, `${fileName}.${answers.method.toLowerCase()}.js`);
    
    const apiContent = `/**
 * ${answers.method} ${answers.route}
 */

module.exports = async function handler(req, res) {
  res.json({
    message: 'Hello from ${answers.route}',
    method: '${answers.method}',
    timestamp: new Date().toISOString()
  });
};
`;
    
    fs.writeFileSync(apiFile, apiContent);
    console.log(`\n✅ Created ${apiFile}\n`);
  });

// Dev command
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

// Start command
program
  .command('start')
  .description('Start production server')
  .option('-p, --port <port>', 'Port number', '3000')
  .action((options) => {
    if (!fs.existsSync('server.js')) {
      console.error('❌ server.js not found! Make sure you are in a Webspresso project.');
      process.exit(1);
    }
    
    process.env.PORT = options.port;
    process.env.NODE_ENV = 'production';
    
    console.log(`\n🚀 Starting production server on port ${options.port}...\n`);
    
    const serverPath = path.resolve(process.cwd(), 'server.js');
    require(serverPath);
  });

// Add Tailwind command
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
        const { execSync } = require('child_process');
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

// ============================================================================
// Database Commands
// ============================================================================

/**
 * Load database configuration
 * @param {string} [configPath] - Custom config path
 * @returns {Object} Database config
 */
function loadDbConfig(configPath) {
  const defaultPaths = ['webspresso.db.js', 'knexfile.js'];
  const paths = configPath ? [configPath, ...defaultPaths] : defaultPaths;
  
  for (const p of paths) {
    const fullPath = path.resolve(process.cwd(), p);
    if (fs.existsSync(fullPath)) {
      return { config: require(fullPath), path: fullPath };
    }
  }
  
  console.error('❌ Database config not found. Create webspresso.db.js or knexfile.js');
  process.exit(1);
}

/**
 * Create database instance from config
 * @param {Object} config - Database config
 * @param {string} [env] - Environment name
 * @returns {Promise<Object>} Database instance
 */
async function createDbInstance(config, env) {
  const environment = env || process.env.NODE_ENV || 'development';
  const dbConfig = config[environment] || config;
  
  // Dynamic import knex
  let knex;
  try {
    knex = require('knex');
  } catch {
    console.error('❌ Knex not installed. Run: npm install knex');
    process.exit(1);
  }
  
  return knex(dbConfig);
}

// db:migrate command
program
  .command('db:migrate')
  .description('Run pending database migrations')
  .option('-e, --env <environment>', 'Environment (development, production)', 'development')
  .option('-c, --config <path>', 'Path to database config file')
  .action(async (options) => {
    const { config, path: configPath } = loadDbConfig(options.config);
    console.log(`\n📦 Using config: ${configPath}`);
    console.log(`   Environment: ${options.env}\n`);
    
    const knex = await createDbInstance(config, options.env);
    
    try {
      const migrationConfig = config.migrations || {};
      const [batch, migrations] = await knex.migrate.latest(migrationConfig);
      
      if (migrations.length === 0) {
        console.log('✅ Already up to date.\n');
      } else {
        console.log(`Running migrations (batch ${batch}):`);
        for (const m of migrations) {
          console.log(`  → ${m}`);
        }
        console.log(`\n✅ Done. ${migrations.length} migration(s) completed.\n`);
      }
    } catch (err) {
      console.error('❌ Migration failed:', err.message);
      process.exit(1);
    } finally {
      await knex.destroy();
    }
  });

// db:rollback command
program
  .command('db:rollback')
  .description('Rollback the last batch of migrations')
  .option('-e, --env <environment>', 'Environment (development, production)', 'development')
  .option('-c, --config <path>', 'Path to database config file')
  .option('-a, --all', 'Rollback all migrations')
  .action(async (options) => {
    const { config, path: configPath } = loadDbConfig(options.config);
    console.log(`\n📦 Using config: ${configPath}`);
    console.log(`   Environment: ${options.env}\n`);
    
    const knex = await createDbInstance(config, options.env);
    
    try {
      const migrationConfig = {
        ...(config.migrations || {}),
        ...(options.all ? { all: true } : {}),
      };
      
      const [batch, migrations] = await knex.migrate.rollback(migrationConfig);
      
      if (migrations.length === 0) {
        console.log('✅ Nothing to rollback.\n');
      } else {
        console.log(`Rolling back${options.all ? ' all' : ''} migrations:`);
        for (const m of migrations) {
          console.log(`  ← ${m}`);
        }
        console.log(`\n✅ Done. ${migrations.length} migration(s) rolled back.\n`);
      }
    } catch (err) {
      console.error('❌ Rollback failed:', err.message);
      process.exit(1);
    } finally {
      await knex.destroy();
    }
  });

// db:status command
program
  .command('db:status')
  .description('Show migration status')
  .option('-e, --env <environment>', 'Environment (development, production)', 'development')
  .option('-c, --config <path>', 'Path to database config file')
  .action(async (options) => {
    const { config, path: configPath } = loadDbConfig(options.config);
    console.log(`\n📦 Using config: ${configPath}`);
    console.log(`   Environment: ${options.env}\n`);
    
    const knex = await createDbInstance(config, options.env);
    
    try {
      const migrationConfig = config.migrations || {};
      const [completed, pending] = await knex.migrate.list(migrationConfig);
      
      console.log('Migration Status');
      console.log('================\n');
      
      // Sort all migrations by name
      const all = [
        ...completed.map(m => ({ name: m.name || m, completed: true })),
        ...pending.map(m => ({ name: m.name || m, completed: false })),
      ].sort((a, b) => a.name.localeCompare(b.name));
      
      if (all.length === 0) {
        console.log('  No migrations found.\n');
      } else {
        for (const m of all) {
          const status = m.completed ? '✓' : '○';
          const suffix = m.completed ? '' : ' (pending)';
          console.log(`  ${status} ${m.name}${suffix}`);
        }
        console.log(`\n  Total: ${all.length} (${completed.length} completed, ${pending.length} pending)\n`);
      }
    } catch (err) {
      console.error('❌ Failed to get status:', err.message);
      process.exit(1);
    } finally {
      await knex.destroy();
    }
  });

// db:make command
program
  .command('db:make <name>')
  .description('Create a new migration file')
  .option('-c, --config <path>', 'Path to database config file')
  .option('-m, --model <model>', 'Generate migration from model (requires models directory)')
  .action(async (name, options) => {
    const { config, path: configPath } = loadDbConfig(options.config);
    console.log(`\n📦 Using config: ${configPath}\n`);
    
    const migrationDir = config.migrations?.directory || './migrations';
    
    // Ensure migrations directory exists
    if (!fs.existsSync(migrationDir)) {
      fs.mkdirSync(migrationDir, { recursive: true });
      console.log(`Created directory: ${migrationDir}`);
    }
    
    // Generate filename with timestamp
    const now = new Date();
    const timestamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '_',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    
    const filename = `${timestamp}_${name}.js`;
    const filepath = path.join(migrationDir, filename);
    
    let content;
    
    if (options.model) {
      // Try to load model and generate migration from schema
      const modelsDir = config.models || './models';
      const modelPath = path.resolve(process.cwd(), modelsDir, `${options.model}.js`);
      
      if (fs.existsSync(modelPath)) {
        try {
          const model = require(modelPath);
          const { scaffoldMigration } = require('../core/orm/migrations/scaffold');
          content = scaffoldMigration(model);
          console.log(`Generated migration from model: ${options.model}`);
        } catch (err) {
          console.warn(`⚠️  Could not generate from model: ${err.message}`);
          console.log('   Creating empty migration instead.\n');
          content = getDefaultMigrationContent(name);
        }
      } else {
        console.warn(`⚠️  Model not found: ${modelPath}`);
        console.log('   Creating empty migration instead.\n');
        content = getDefaultMigrationContent(name);
      }
    } else {
      content = getDefaultMigrationContent(name);
    }
    
    fs.writeFileSync(filepath, content);
    console.log(`✅ Created: ${filepath}\n`);
  });

/**
 * Get default migration content
 * @param {string} name - Migration name
 * @returns {string}
 */
function getDefaultMigrationContent(name) {
  // Parse table name from migration name (e.g., create_users_table -> users)
  const match = name.match(/^create_(\w+)_table$/);
  const tableName = match ? match[1] : 'table_name';
  
  return `/**
 * Migration: ${name}
 */

exports.up = function(knex) {
  return knex.schema.createTable('${tableName}', (table) => {
    table.bigIncrements('id').primary();
    // Add your columns here
    table.timestamps(true, true);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('${tableName}');
};
`;
}

// Parse arguments
program.parse();


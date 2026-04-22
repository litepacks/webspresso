/**
 * New Project Command
 * Creates a new Webspresso project
 */

const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const { runInstallation, startDevServer } = require('../utils/project');
const { getSeedFileTemplate } = require('../utils/seed');

function registerCommand(program) {
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
      
      // Ask about database
      const { useDatabase, databaseType } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'useDatabase',
          message: 'Will you use a database?',
          default: false
        },
        {
          type: 'list',
          name: 'databaseType',
          message: 'Which database?',
          choices: [
            { name: 'SQLite (better-sqlite3)', value: 'better-sqlite3' },
            { name: 'PostgreSQL (pg)', value: 'pg' },
            { name: 'MySQL (mysql2)', value: 'mysql2' },
            { name: 'None', value: null }
          ],
          default: 'better-sqlite3',
          when: (answers) => answers.useDatabase
        }
      ]);
      
      // Ask about seed data if database is selected
      let useSeed = false;
      if (useDatabase && databaseType) {
        const { generateSeed } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'generateSeed',
            message: 'Generate seed data based on existing models?',
            default: false
          }
        ]);
        useSeed = generateSeed;
      }
      
      // Create directory structure (skip root if using current dir)
      if (!useCurrentDir) {
        fs.mkdirSync(projectPath, { recursive: true });
      }
      fs.mkdirSync(path.join(projectPath, 'pages'), { recursive: true });
      fs.mkdirSync(path.join(projectPath, 'pages', 'locales'), { recursive: true });
      fs.mkdirSync(path.join(projectPath, 'views'), { recursive: true });
      fs.mkdirSync(path.join(projectPath, 'public'), { recursive: true });
      fs.mkdirSync(path.join(projectPath, 'config'), { recursive: true });
      
      // Create models directory if database is selected
      if (useDatabase && databaseType) {
        fs.mkdirSync(path.join(projectPath, 'models'), { recursive: true });
      }
      
      // Create package.json
      const packageJson = {
        name: projectName,
        version: '1.0.0',
        description: 'Webspresso project',
        main: 'server.js',
        scripts: {
          dev: 'webspresso dev',
          start: 'NODE_ENV=production node server.js'
        },
        dependencies: {
          webspresso: '*',
          dotenv: '^16.3.1',
          zod: '^3.23.0'
        }
      };
      
      // Add database driver if selected
      if (useDatabase && databaseType) {
        const dbDrivers = {
          'better-sqlite3': '^9.0.0',
          'pg': '^8.0.0',
          'mysql2': '^3.0.0'
        };
        
        packageJson.dependencies[databaseType] = dbDrivers[databaseType];
      }
      
      // Add faker if seed is selected
      if (useSeed) {
        packageJson.dependencies['@faker-js/faker'] = '^8.0.0';
        packageJson.scripts.seed = 'node seeds/index.js';
      }
      
      fs.writeFileSync(
        path.join(projectPath, 'package.json'),
        JSON.stringify(packageJson, null, 2) + '\n'
      );
      
      // config/load-env.js — dotenv chain (last file wins for each key)
      const loadEnvJs = `const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

/**
 * Load env files in order: .env, .env.local, .env.<NODE_ENV>, .env.<NODE_ENV>.local
 * @param {string} [rootDir] Project root (default: parent of config/)
 */
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
  loadFile(\`.env.\${mode}\`);
  loadFile(\`.env.\${mode}.local\`);
}

module.exports = { loadEnv };
`;

      const envSchemaJs = `const { z } = require('zod');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DEFAULT_LOCALE: z.string().min(1).default('en'),
  SUPPORTED_LOCALES: z.string().min(1).default('en,de'),
  BASE_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().optional(),
});

let _parsed = null;

function parseEnv() {
  if (_parsed) return _parsed;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.format());
    process.exit(1);
  }
  _parsed = result.data;
  return _parsed;
}

module.exports = { envSchema, parseEnv };
`;

      const appConfigJs = `const path = require('path');
const fs = require('fs');
const { parseEnv } = require('./env.schema');

function getCreateAppOptions() {
  parseEnv();
  const rootDir = path.resolve(__dirname, '..');
  const options = {
    pagesDir: path.join(rootDir, 'pages'),
    viewsDir: path.join(rootDir, 'views'),
    publicDir: path.join(rootDir, 'public'),
  };
  const dbFile = path.join(rootDir, 'webspresso.db.js');
  if (fs.existsSync(dbFile)) {
    const { createDatabase } = require('webspresso');
    const knexConfig = require(dbFile);
    options.db = createDatabase(knexConfig);
  }
  return options;
}

module.exports = getCreateAppOptions;
`;

      const serverJs = `const { loadEnv } = require('./config/load-env');
loadEnv();

const { createApp } = require('webspresso');
const getCreateAppOptions = require('./config/app');
const { parseEnv } = require('./config/env.schema');

const env = parseEnv();
const { app } = createApp(getCreateAppOptions());

app.listen(env.PORT, () => {
  console.log(\`🚀 Server running at http://localhost:\${env.PORT}\`);
});
`;

      fs.writeFileSync(path.join(projectPath, 'config', 'load-env.js'), loadEnvJs);
      fs.writeFileSync(path.join(projectPath, 'config', 'env.schema.js'), envSchemaJs);
      fs.writeFileSync(path.join(projectPath, 'config', 'app.js'), appConfigJs);
      fs.writeFileSync(path.join(projectPath, 'server.js'), serverJs);
      
      // Create .env.example (see config/load-env.js for merge order)
      let envExample = `# Copy to .env and adjust. Optional overrides: .env.local, .env.<NODE_ENV>, .env.<NODE_ENV>.local
PORT=3000
NODE_ENV=development
DEFAULT_LOCALE=en
SUPPORTED_LOCALES=en,de
BASE_URL=http://localhost:3000
`;
      
      if (useDatabase && databaseType) {
        if (databaseType === 'better-sqlite3') {
          envExample += `DATABASE_URL=sqlite:./database.sqlite
`;
        } else if (databaseType === 'pg') {
          envExample += `DATABASE_URL=postgresql://user:password@localhost:5432/dbname
`;
        } else if (databaseType === 'mysql2') {
          envExample += `DATABASE_URL=mysql://user:password@localhost:3306/dbname
`;
        }
      }
      
      fs.writeFileSync(path.join(projectPath, '.env.example'), envExample);
      
      // Create database config if database is selected
      if (useDatabase && databaseType) {
        let dbConfig = '';
        
        if (databaseType === 'better-sqlite3') {
          dbConfig = `module.exports = {
  client: 'better-sqlite3',
  connection: {
    filename: process.env.DATABASE_URL?.replace('sqlite:', '') || './database.sqlite'
  },
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations',
  },
  useNullAsDefault: true
};
`;
        } else if (databaseType === 'pg') {
          dbConfig = `module.exports = {
  client: 'pg',
  connection: process.env.DATABASE_URL,
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations',
  },
  pool: {
    min: 2,
    max: 10
  }
};
`;
        } else if (databaseType === 'mysql2') {
          dbConfig = `module.exports = {
  client: 'mysql2',
  connection: process.env.DATABASE_URL,
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations',
  },
  pool: {
    min: 2,
    max: 10
  }
};
`;
        }
        
        fs.writeFileSync(path.join(projectPath, 'webspresso.db.js'), dbConfig);
        
        // Create migrations directory
        fs.mkdirSync(path.join(projectPath, 'migrations'), { recursive: true });
      }
      
      // Create seed files if seed is selected
      if (useSeed) {
        fs.mkdirSync(path.join(projectPath, 'seeds'), { recursive: true });
        
        const seedIndex = getSeedFileTemplate();
        
        fs.writeFileSync(path.join(projectPath, 'seeds', 'index.js'), seedIndex);
      }
      
      // Create .gitignore (.env optional: teams often commit a non-secret .env for local defaults)
      const gitignore = `node_modules/
.env
.env.local
.env.*.local
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
      
      const deJson = {
        site: {
          name: 'Webspresso'
        },
        nav: {
          home: 'Startseite'
        },
        footer: {
          copyright: '© 2025 Webspresso. All rights reserved.'
        },
        welcome: 'Willkommen bei Webspresso',
        description: 'Start building your SSR app!'
      };
      
      fs.writeFileSync(
        path.join(projectPath, 'pages', 'locales', 'de.json'),
        JSON.stringify(deJson, null, 2) + '\n'
      );
      
      // Create README
      const readme = `# ${projectName}

Webspresso project

## Getting Started

\`\`\`bash
npm install
cp .env.example .env
npm run dev
\`\`\`

Visit http://localhost:3000

## Configuration

- **\`config/load-env.js\`** — loads \`.env\`, \`.env.local\`, then \`.env.$NODE_ENV\` and \`.env.$NODE_ENV.local\` (later files override keys).
- **\`config/env.schema.js\`** — [Zod](https://zod.dev) schema for \`process.env\`; fails fast on invalid values.
- **\`config/app.js\`** — builds options passed to \`createApp()\` (paths; adds \`db\` when \`webspresso.db.js\` exists).
- **\`server.js\`** — calls \`loadEnv()\`, then \`createApp(getCreateAppOptions())\`.
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
        updatedPackageJson.scripts.dev = 'webspresso dev';
        updatedPackageJson.scripts.start = 'npm run build:css && NODE_ENV=production node server.js';
        
        fs.writeFileSync(
          path.join(projectPath, 'package.json'),
          JSON.stringify(updatedPackageJson, null, 2) + '\n'
        );
        
        console.log('✅ Tailwind CSS setup complete!');
      }
      
      
      // Auto install if requested or ask interactively
      if (autoInstall) {
        await runInstallation(projectPath, useTailwind);
        
        // Ask if user wants to start dev server
        const { shouldStartDev } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'shouldStartDev',
            message: 'Start development server?',
            default: true
          }
        ]);
        
        if (shouldStartDev) {
          startDevServer(projectPath, useTailwind);
        } else {
          console.log('✅ Project ready!\n');
          console.log('Start developing:');
          if (!useCurrentDir) {
            console.log(`  cd ${projectName}`);
          }
          console.log('  npm run dev\n');
        }
      } else {
        // Ask if user wants to install dependencies
        const { shouldInstall } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'shouldInstall',
            message: 'Install dependencies and build CSS now?',
            default: true
          }
        ]);
        
        if (shouldInstall) {
          await runInstallation(projectPath, useTailwind);
          
          // Ask if user wants to start dev server
          const { shouldStartDev } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'shouldStartDev',
              message: 'Start development server?',
              default: true
            }
          ]);
          
          if (shouldStartDev) {
            startDevServer(projectPath, useTailwind);
          } else {
            console.log('\n✅ Project ready!\n');
            console.log('Start developing:');
            if (!useCurrentDir) {
              console.log(`  cd ${projectName}`);
            }
            console.log('  npm run dev\n');
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
      }
    });
}

module.exports = { registerCommand };

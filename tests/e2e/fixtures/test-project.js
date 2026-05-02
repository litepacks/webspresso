/**
 * Test Project Helper
 * Creates a test Webspresso project for E2E tests
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_PROJECT_DIR = path.join(os.tmpdir(), 'webspresso-e2e-test');

/**
 * Create a new test project (deterministic scaffold — no interactive CLI).
 * Piping answers into `webspresso new` is unreliable on CI; when the CLI exited 0,
 * the old code skipped this scaffold and ran `npm install` in an empty directory.
 * @returns {Promise<string>} Project directory path
 */
async function createTestProject() {
  // Clean up existing test project
  if (fs.existsSync(TEST_PROJECT_DIR)) {
    fs.rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
  }

  // Create project directory
  fs.mkdirSync(TEST_PROJECT_DIR, { recursive: true });

  const projectName = 'test-app';
  const projectPath = path.join(TEST_PROJECT_DIR, projectName);
  fs.mkdirSync(projectPath, { recursive: true });

  console.log('Creating test project (e2e fixture scaffold)...');
    
    // Create package.json
    const packageJson = {
      name: projectName,
      version: '1.0.0',
      scripts: {
        dev: 'webspresso dev',
        start: 'webspresso start',
      },
      dependencies: {
        webspresso: path.join(__dirname, '../../..'),
        'better-sqlite3': '^11.10.0',
      },
    };
    
    fs.writeFileSync(
      path.join(projectPath, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );

    // Create server.js with in-memory database for tests
    const serverJs = `const { createApp, createDatabase } = require('webspresso');
const { adminPanelPlugin, dataExchangePlugin, auditLogPlugin, seoCheckerPlugin } = require('webspresso/plugins');
const path = require('path');

const db = createDatabase({
  client: 'better-sqlite3',
  connection: ':memory:',
  models: './models',
});

// Initialize server
(async () => {
  try {
    // Create tables manually for in-memory database
    await db.knex.schema.createTableIfNotExists('admin_users', (table) => {
      table.bigIncrements('id');
      table.string('email').unique();
      table.string('password');
      table.string('name');
      table.string('role').defaultTo('admin');
      table.boolean('active').defaultTo(true);
      table.timestamp('created_at');
      table.timestamp('updated_at');
    });

    await db.knex.schema.createTableIfNotExists('test_posts', (table) => {
      table.bigIncrements('id');
      table.string('title');
      table.text('content');
      table.text('body');
      table.string('status').defaultTo('draft');
      table.boolean('published').defaultTo(false);
      table.timestamp('created_at');
      table.timestamp('updated_at');
    });

    await db.knex.schema.createTableIfNotExists('audit_logs', (table) => {
      table.bigIncrements('id');
      table.timestamp('created_at').defaultTo(db.knex.fn.now()).index();
      table.bigInteger('actor_id').nullable().index();
      table.string('actor_email', 255).nullable();
      table.string('action', 32).notNullable();
      table.string('resource_model', 255).notNullable();
      table.string('resource_id', 255).nullable();
      table.string('http_method', 16).notNullable();
      table.string('path', 2000).notNullable();
      table.string('ip', 64).nullable();
      table.text('user_agent').nullable();
      table.json('metadata').nullable();
    });

    await db.knex.schema.createTableIfNotExists('users', (table) => {
      table.bigIncrements('id').primary();
      table.string('email', 255).unique();
      table.string('password', 255);
      table.string('name', 255).nullable();
      table.string('role', 50).defaultTo('user');
      table.boolean('active').defaultTo(true);
      table.timestamp('email_verified_at').nullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
    });

    await db.knex('users').insert({
      email: 'visitor@e2e.test',
      password: 'not-used',
      name: 'E2E Visitor',
      role: 'user',
      active: 1,
      created_at: db.knex.fn.now(),
      updated_at: db.knex.fn.now(),
    });

    const { app } = createApp({
      pagesDir: path.join(__dirname, 'pages'),
      viewsDir: path.join(__dirname, 'views'),
      publicDir: path.join(__dirname, 'public'),
      plugins: [
        adminPanelPlugin({
          path: '/_admin',
          db,
          userManagement: { enabled: true, model: 'User' },
        }),
        dataExchangePlugin({
          adminPath: '/_admin',
          db,
        }),
        auditLogPlugin({
          db,
          adminPath: '/_admin',
        }),
        seoCheckerPlugin({
          enabled: true,
        }),
      ],
    });

    const PORT = process.env.PORT || 3001;
    console.log('Environment:', process.env.NODE_ENV);
    console.log('Models directory:', path.join(__dirname, 'models'));
    app.listen(PORT, () => {
      console.log(\`Server running on http://localhost:\${PORT}\`);
      console.log('Admin panel available at: http://localhost:' + PORT + '/_admin');
    });
  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
})();
`;

    fs.writeFileSync(path.join(projectPath, 'server.js'), serverJs);

    // Create pages directory
    fs.mkdirSync(path.join(projectPath, 'pages'), { recursive: true });
    
    // Create index page with SEO elements for testing
    const indexPage = `{% extends "layout.njk" %}

{% set title = "Welcome to Webspresso - Test Site" %}
{% set description = "This is a test project for E2E testing of Webspresso framework features." %}

{% block content %}
<main>
  <h1>Welcome to Webspresso</h1>
  <p>This is a test project for E2E tests. It includes various features for testing the framework.</p>
  
  <h2>Features</h2>
  <ul>
    <li>Admin Panel</li>
    <li>SEO Checker</li>
    <li>Database Integration</li>
  </ul>
  
  <article>
    <h3>Getting Started</h3>
    <p>Webspresso is a powerful Node.js SSR framework that makes it easy to build modern web applications with great SEO out of the box.</p>
    <a href="/about">Learn more about us</a>
    <a href="https://example.com" target="_blank" rel="noopener">External Link</a>
  </article>
  
  <img src="/images/test.jpg" alt="Test image for SEO checker" width="200" height="150">
</main>
{% endblock %}
`;

    fs.writeFileSync(path.join(projectPath, 'pages', 'index.njk'), indexPage);

    // Create views directory with layout
    fs.mkdirSync(path.join(projectPath, 'views'), { recursive: true });
    
    const layout = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{ title or 'Webspresso' }}</title>
  <meta name="description" content="{{ description or 'Test page for Webspresso E2E tests' }}">
  {{ fsy.injectHead() | safe }}
</head>
<body>
  {% block content %}{% endblock %}
  {{ fsy.injectBody() | safe }}
  {{ fsy.devToolbar() | safe }}
</body>
</html>
`;

    fs.writeFileSync(path.join(projectPath, 'views', 'layout.njk'), layout);

    // Create public directory
    fs.mkdirSync(path.join(projectPath, 'public'), { recursive: true });

    // Create models directory
    fs.mkdirSync(path.join(projectPath, 'models'), { recursive: true });

    // Create a test model with admin enabled and chainable validations
    const testModel = `const { defineModel, zdb } = require('webspresso');

module.exports = defineModel({
  name: 'TestPost',
  table: 'test_posts',
  schema: zdb.schema({
    id: zdb.id(),
    title: zdb.string().min(1).max(200).config({
      label: 'Post Title',
      placeholder: 'Enter post title',
      hint: 'Title must be between 1 and 200 characters',
    }),
    content: zdb.text({ nullable: true }).min(10).config({
      label: 'Content',
      placeholder: 'Write your post content here...',
      hint: 'Content must be at least 10 characters',
      rows: 6,
    }),
    body: zdb.text({ nullable: true }).config({
      label: 'Body',
      hint: 'Rich text content',
    }),
    status: zdb.enum(['draft', 'pending', 'published', 'archived'], { default: 'draft' }).config({
      label: 'Status',
      hint: 'Post status',
    }),
    published: zdb.boolean({ default: false }).config({
      label: 'Published',
      hint: 'Check to publish this post',
    }),
    created_at: zdb.timestamp({ auto: 'create' }),
    updated_at: zdb.timestamp({ auto: 'update' }),
  }),
  admin: {
    enabled: true,
    label: 'Test Posts',
    icon: '📝',
    customFields: {
      body: {
        type: 'rich-text',
      },
    },
  },
});
`;

    fs.writeFileSync(path.join(projectPath, 'models', 'TestPost.js'), testModel);

    const userModelFile = `const { defineModel, zdb } = require('webspresso');

module.exports = defineModel({
  name: 'User',
  table: 'users',
  schema: zdb.schema({
    id: zdb.id(),
    email: zdb.string({ unique: true, maxLength: 255 }),
    password: zdb.string({ maxLength: 255 }),
    name: zdb.string({ maxLength: 255, nullable: true }),
    role: zdb.string({ maxLength: 50, default: 'user' }),
    active: zdb.boolean({ default: true }),
    email_verified_at: zdb.timestamp({ nullable: true }),
    created_at: zdb.timestamp({ auto: 'create' }),
    updated_at: zdb.timestamp({ auto: 'update' }),
  }),
  admin: {
    enabled: true,
    label: 'Site users',
    icon: '👤',
  },
  hidden: ['password'],
});
`;
    fs.writeFileSync(path.join(projectPath, 'models', 'User.js'), userModelFile);

    // Create migrations directory
    fs.mkdirSync(path.join(projectPath, 'migrations'), { recursive: true });

    // Create webspresso.db.js config (in-memory for tests)
    const dbConfig = `module.exports = {
  client: 'better-sqlite3',
  connection: ':memory:',
  migrations: {
    directory: './migrations',
  },
  models: './models',
};
`;

    fs.writeFileSync(path.join(projectPath, 'webspresso.db.js'), dbConfig);

  // Install dependencies
  console.log('Installing dependencies...');
  execSync('npm install', {
    cwd: projectPath,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' },
  });

  // Tables will be created automatically in server.js for in-memory database
  // No need to run migrations

  return projectPath;
}

/**
 * Start test server
 * @param {string} projectPath - Project directory path
 * @returns {Promise<import('child_process').ChildProcess>} Server process
 */
async function startTestServer(projectPath) {
  console.log('Starting test server...');
  
  const server = spawn('node', ['server.js'], {
    cwd: projectPath,
    stdio: 'pipe',
    env: { ...process.env, PORT: '3001', NODE_ENV: 'test' },
  });

  // Wait for server to be ready
  return new Promise((resolve, reject) => {
    let output = '';
    
    server.stdout.on('data', (data) => {
      output += data.toString();
      if (output.includes('Server running on')) {
        console.log('Test server started');
        resolve(server);
      }
    });

    server.stderr.on('data', (data) => {
      const error = data.toString();
      if (error.includes('EADDRINUSE')) {
        reject(new Error('Port 3001 is already in use'));
      } else if (!error.includes('Server running')) {
        console.error('Server error:', error);
      }
    });

    server.on('error', reject);

    const startTimeoutMs = process.env.CI ? 90_000 : 30_000;
    setTimeout(() => {
      if (!server.killed) {
        reject(new Error('Server startup timeout'));
      }
    }, startTimeoutMs);
  });
}

/**
 * Clean up test project
 */
function cleanupTestProject() {
  if (fs.existsSync(TEST_PROJECT_DIR)) {
    fs.rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
  }
}

// If run directly, start the server
if (require.main === module) {
  (async () => {
    try {
      const projectPath = await createTestProject();
      const server = await startTestServer(projectPath);
      
      // Keep process alive
      process.on('SIGINT', () => {
        server.kill();
        cleanupTestProject();
        process.exit(0);
      });
      
      process.on('SIGTERM', () => {
        server.kill();
        cleanupTestProject();
        process.exit(0);
      });
    } catch (error) {
      console.error('Failed to start test server:', error);
      process.exit(1);
    }
  })();
}

module.exports = {
  createTestProject,
  startTestServer,
  cleanupTestProject,
  TEST_PROJECT_DIR,
};

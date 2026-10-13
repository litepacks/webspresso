/**
 * Add Docker Command
 * Generate production-ready multi-stage Dockerfile, .dockerignore, and docker-compose.yml
 * @module bin/commands/add-docker
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Normalize Node image version string
 * @param {string} [nodeVer='22-alpine']
 * @returns {string}
 */
function normalizeNodeVersion(nodeVer = '22-alpine') {
  let v = String(nodeVer).trim();
  if (v.startsWith('node:')) {
    v = v.slice(5);
  }
  if (!v.includes('-')) {
    v = `${v}-alpine`;
  }
  return v;
}

/**
 * Auto-detect database from package.json or knexfile.js
 * @param {string} cwd
 * @param {Object} [pkg]
 * @returns {'postgres'|'mysql'|'sqlite'|'none'}
 */
function detectDatabase(cwd, pkg = {}) {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  if (deps['pg'] || deps['pg-hstore']) return 'postgres';
  if (deps['mysql2'] || deps['mysql']) return 'mysql';
  if (deps['better-sqlite3'] || deps['sqlite3']) return 'sqlite';

  // Check knexfile.js or webspresso.db.js
  const knexfilePath = path.join(cwd, 'knexfile.js');
  if (fs.existsSync(knexfilePath)) {
    try {
      const content = fs.readFileSync(knexfilePath, 'utf8');
      if (content.includes('postgresql') || content.includes('pg')) return 'postgres';
      if (content.includes('mysql')) return 'mysql';
      if (content.includes('sqlite')) return 'sqlite';
    } catch (_) {}
  }

  return 'sqlite';
}

/**
 * Generate production-grade multi-stage Dockerfile
 * @param {Object} options
 * @param {string} [options.node='22-alpine']
 * @param {number} [options.port=3000]
 * @param {boolean} [options.hasBuildScript=false]
 * @returns {string}
 */
function generateDockerfile(options = {}) {
  const nodeImage = normalizeNodeVersion(options.node || '22-alpine');
  const port = options.port || 3000;
  const isAlpine = nodeImage.includes('alpine');

  return `# ==========================================
# Webspresso Multi-Stage Production Dockerfile
# Security-hardened, non-root, minimal image size
# ==========================================

# ------------------------------------------
# Stage 1: Dependencies (Native builds cache)
# ------------------------------------------
FROM node:${nodeImage} AS deps
${isAlpine ? 'RUN apk add --no-cache libc6-compat python3 make g++' : 'RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*'}
WORKDIR /app

# Copy dependency manifests
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ------------------------------------------
# Stage 2: Builder (Compile assets & app)
# ------------------------------------------
FROM node:${nodeImage} AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci
COPY . .

# Run build if a build script is defined in package.json
RUN if grep -q '"build":' package.json; then npm run build; fi

# ------------------------------------------
# Stage 3: Runner (Production Image)
# ------------------------------------------
FROM node:${nodeImage} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=${port}

# Create unprivileged system group and user
${isAlpine
  ? 'RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 webspresso'
  : 'RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 webspresso'}

# Copy dependencies and source code
COPY --from=deps --chown=webspresso:nodejs /app/node_modules ./node_modules
COPY --chown=webspresso:nodejs . .

# Copy compiled public assets from builder if present
COPY --from=builder --chown=webspresso:nodejs /app/public ./public

# Ensure upload and storage directories exist with proper write permissions
RUN mkdir -p storage/uploads public/uploads data && \\
    chown -R webspresso:nodejs storage public data

# Run as non-root user
USER webspresso

EXPOSE ${port}

# Container Healthcheck (checks /health or /healthz endpoint)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\
  CMD wget --no-verbose --tries=1 --spider http://localhost:${port}/health || \\
      wget --no-verbose --tries=1 --spider http://localhost:${port}/healthz || \\
      exit 1

# Start the Webspresso application
CMD ["node", "server.js"]
`;
}

/**
 * Generate .dockerignore file content
 * @returns {string}
 */
function generateDockerignore() {
  return `# Dependencies
node_modules
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# Git & IDE
.git
.gitignore
.gitattributes
.DS_Store
.idea
.vscode
*.suo
*.ntvs*
*.njsproj

# Environment & Secrets
.env
.env.*
!.env.example

# Local SQLite databases
*.sqlite
*.sqlite3
*.db
*.db-journal
*.db-wal
*.db-shm

# Tests & Coverage
tests
coverage
.nyc_output
playwright-report
test-results

# Temporary & Build Cache
dist/tmp
.turbo
.agents
docs

# Uploads directory (keep directory, exclude uploaded user media)
storage/uploads/*
!storage/uploads/.gitkeep
public/uploads/*
!public/uploads/.gitkeep
`;
}

/**
 * Generate docker-compose.yml file content
 * @param {Object} options
 * @param {string} options.appName
 * @param {'postgres'|'mysql'|'sqlite'|'none'} options.db
 * @param {boolean} [options.redis=false]
 * @param {number} [options.port=3000]
 * @returns {string}
 */
function generateDockerCompose(options = {}) {
  const {
    appName = 'webspresso-app',
    db = 'sqlite',
    redis = false,
    port = 3000,
  } = options;

  let dbService = '';
  let dbVolume = '';
  let dependsOn = [];
  let appEnv = [
    '      - NODE_ENV=production',
    `      - PORT=${port}`,
    '      - SESSION_SECRET=change-me-to-a-random-32-char-string-in-production',
  ];

  if (db === 'postgres') {
    dependsOn.push('      postgres:\n        condition: service_healthy');
    appEnv.push('      - DATABASE_URL=postgres://webspresso:secretpassword@postgres:5432/webspresso');
    dbService = `
  postgres:
    image: postgres:16-alpine
    container_name: ${appName}-postgres
    environment:
      POSTGRES_DB: webspresso
      POSTGRES_USER: webspresso
      POSTGRES_PASSWORD: secretpassword
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U webspresso -d webspresso"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
`;
    dbVolume = '  postgres_data:\n';
  } else if (db === 'mysql') {
    dependsOn.push('      mysql:\n        condition: service_healthy');
    appEnv.push('      - DATABASE_URL=mysql://webspresso:secretpassword@mysql:3306/webspresso');
    dbService = `
  mysql:
    image: mysql:8.0
    container_name: ${appName}-mysql
    environment:
      MYSQL_DATABASE: webspresso
      MYSQL_USER: webspresso
      MYSQL_PASSWORD: secretpassword
      MYSQL_ROOT_PASSWORD: rootsecretpassword
    ports:
      - "3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
`;
    dbVolume = '  mysql_data:\n';
  } else if (db === 'sqlite') {
    appEnv.push('      - DATABASE_CLIENT=better-sqlite3');
    appEnv.push('      - DATABASE_FILENAME=/app/data/app.sqlite');
  }

  let redisService = '';
  let redisVolume = '';
  if (redis) {
    dependsOn.push('      redis:\n        condition: service_healthy');
    appEnv.push('      - REDIS_URL=redis://redis:6379');
    redisService = `
  redis:
    image: redis:7-alpine
    container_name: ${appName}-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
`;
    redisVolume = '  redis_data:\n';
  }

  let dependsOnBlock = '';
  if (dependsOn.length > 0) {
    dependsOnBlock = `    depends_on:\n${dependsOn.join('\n')}\n`;
  }

  const appVolumes = ['      - ./storage/uploads:/app/storage/uploads'];
  if (db === 'sqlite') {
    appVolumes.push('      - ./data:/app/data');
  }

  let volumesSection = '';
  if (dbVolume || redisVolume) {
    volumesSection = `volumes:\n${dbVolume}${redisVolume}`;
  }

  return `services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: ${appName}
    ports:
      - "${port}:${port}"
    environment:
${appEnv.join('\n')}
    volumes:
${appVolumes.join('\n')}
${dependsOnBlock}    restart: unless-stopped
${dbService}${redisService}
${volumesSection}`;
}

/**
 * Register command with Commander
 * @param {import('commander').Command} program
 */
function registerCommand(program) {
  program
    .command('add:docker [docker]')
    .alias('docker')
    .alias('add-docker')
    .description('Generate production-ready multi-stage Dockerfile, .dockerignore, and docker-compose.yml')
    .option('-n, --node <version>', 'Node.js base image version (default: 22-alpine)', '22-alpine')
    .option('-d, --db <type>', 'Database service to configure: postgres, mysql, sqlite, none (auto-detected by default)')
    .option('-r, --redis', 'Include Redis service in docker-compose.yml', false)
    .option('-p, --port <port>', 'Application container port (default: 3000)', '3000')
    .option('-f, --force', 'Overwrite existing Dockerfile and docker-compose.yml without prompting', false)
    .action(async (...actionArgs) => {
      const cmd = actionArgs[actionArgs.length - 1];
      const options = (cmd && typeof cmd.opts === 'function')
        ? cmd.opts()
        : (actionArgs.find((a) => a && typeof a === 'object') || {});

      const cwd = process.cwd();
      const pkgPath = path.join(cwd, 'package.json');

      if (!fs.existsSync(pkgPath)) {
        console.error('❌ Not a Webspresso project! package.json was not found in current directory.');
        process.exit(1);
      }

      let pkg = {};
      try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      } catch (err) {
        console.error(`❌ Failed to parse package.json: ${err.message}`);
        process.exit(1);
      }

      const appName = pkg.name ? pkg.name.replace(/[^a-zA-Z0-9_-]/g, '-') : 'webspresso-app';
      const port = parseInt(options.port || '3000', 10) || 3000;
      const dbType = options.db || detectDatabase(cwd, pkg);
      const isRedis = Boolean(options.redis);
      const nodeVersion = options.node || '22-alpine';
      const force = Boolean(options.force);

      console.log('\n🐳 Setting up Docker & Container configuration for Webspresso...\n');

      const dockerfilePath = path.join(cwd, 'Dockerfile');
      const dockerignorePath = path.join(cwd, '.dockerignore');
      const composePath = path.join(cwd, 'docker-compose.yml');

      // 1. Create .dockerignore
      if (!fs.existsSync(dockerignorePath) || force) {
        fs.writeFileSync(dockerignorePath, generateDockerignore(), 'utf8');
        console.log('  ✅ Created .dockerignore');
      } else {
        console.log('  ℹ️  .dockerignore already exists (use --force to overwrite)');
      }

      // 2. Create Dockerfile
      if (!fs.existsSync(dockerfilePath) || force) {
        const dockerfileContent = generateDockerfile({
          node: nodeVersion,
          port,
          hasBuildScript: Boolean(pkg.scripts && pkg.scripts.build),
        });
        fs.writeFileSync(dockerfilePath, dockerfileContent, 'utf8');
        console.log(`  ✅ Created Dockerfile (multi-stage Node ${nodeVersion}, non-root webspresso user)`);
      } else {
        console.log('  ℹ️  Dockerfile already exists (use --force to overwrite)');
      }

      // 3. Create docker-compose.yml
      if (!fs.existsSync(composePath) || force) {
        const composeContent = generateDockerCompose({
          appName,
          db: dbType,
          redis: isRedis,
          port,
        });
        fs.writeFileSync(composePath, composeContent, 'utf8');
        console.log(`  ✅ Created docker-compose.yml (app: port ${port}, db: ${dbType}${isRedis ? ', redis: true' : ''})`);
      } else {
        console.log('  ℹ️  docker-compose.yml already exists (use --force to overwrite)');
      }

      // 4. Ensure local data & upload folders exist
      if (dbType === 'sqlite') {
        const dataDir = path.join(cwd, 'data');
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
          console.log('  ✅ Created data/ directory for persistent SQLite storage');
        }
      }

      const storageDir = path.join(cwd, 'storage', 'uploads');
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
        fs.writeFileSync(path.join(storageDir, '.gitkeep'), '', 'utf8');
      }

      // 5. Update package.json scripts
      pkg.scripts = pkg.scripts || {};
      let pkgModified = false;

      const dockerScripts = {
        'docker:build': `docker build -t ${appName} .`,
        'docker:run': `docker run -p ${port}:${port} --env-file .env ${appName}`,
        'docker:up': 'docker compose up -d',
        'docker:down': 'docker compose down',
      };

      for (const [key, cmdStr] of Object.entries(dockerScripts)) {
        if (!pkg.scripts[key] || force) {
          pkg.scripts[key] = cmdStr;
          pkgModified = true;
        }
      }

      if (pkgModified) {
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
        console.log('  ✅ Added docker:* helper scripts to package.json');
      }

      console.log('\n🎉 Docker setup complete!\n');
      console.log('Next steps:');
      console.log(`  1. Build image:       npm run docker:build`);
      console.log(`  2. Run container:     npm run docker:run`);
      console.log(`  3. Start all stack:   npm run docker:up\n`);
      console.log(`  Run preflight check:  npx webspresso deploy:check\n`);
    });
}

module.exports = {
  registerCommand,
  generateDockerfile,
  generateDockerignore,
  generateDockerCompose,
  detectDatabase,
  normalizeNodeVersion,
};

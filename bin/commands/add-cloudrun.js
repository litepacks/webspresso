/**
 * Add Cloud Run Command
 * Generate production-ready Google Cloud Run configuration (cloudbuild.yaml, .gcloudignore, deploy-cloudrun.sh)
 * @module bin/commands/add-cloudrun
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { generateDockerfile, generateDockerignore } = require('./add-docker');

/**
 * Generate cloudbuild.yaml for Google Cloud Build CI/CD
 * @param {Object} options
 * @param {string} options.appName
 * @param {string} [options.region='us-central1']
 * @param {string} [options.memory='512Mi']
 * @param {string} [options.cpu='1']
 * @param {number} [options.port=8080]
 * @param {number} [options.minInstances=0]
 * @param {number} [options.maxInstances=10]
 * @param {string} [options.cloudSql]
 * @returns {string}
 */
function generateCloudBuildYaml(options = {}) {
  const {
    appName = 'webspresso-app',
    region = 'us-central1',
    memory = '512Mi',
    cpu = '1',
    port = 8080,
    minInstances = 0,
    maxInstances = 10,
    cloudSql = '',
  } = options;

  const cloudSqlArgs = cloudSql
    ? `\n      - '--add-cloudsql-instances'\n      - '${cloudSql}'`
    : '';

  return `# ==============================================================================
# Google Cloud Build Pipeline for Webspresso
# Builds hardened multi-stage Docker image and deploys to Google Cloud Run
# ==============================================================================

steps:
  # 1. Build production container using multi-stage Dockerfile with cache
  - name: 'gcr.io/cloud-builders/docker'
    id: 'build-image'
    args:
      - 'build'
      - '-t'
      - '$_AR_LOCATION-docker.pkg.dev/$PROJECT_ID/$_AR_REPOSITORY/$_SERVICE_NAME:$COMMIT_SHA'
      - '-t'
      - '$_AR_LOCATION-docker.pkg.dev/$PROJECT_ID/$_AR_REPOSITORY/$_SERVICE_NAME:latest'
      - '--cache-from'
      - '$_AR_LOCATION-docker.pkg.dev/$PROJECT_ID/$_AR_REPOSITORY/$_SERVICE_NAME:latest'
      - '.'

  # 2. Push image to Google Artifact Registry
  - name: 'gcr.io/cloud-builders/docker'
    id: 'push-image'
    args:
      - 'push'
      - '$_AR_LOCATION-docker.pkg.dev/$PROJECT_ID/$_AR_REPOSITORY/$_SERVICE_NAME:$COMMIT_SHA'

  # 3. Deploy to Serverless Google Cloud Run
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    id: 'deploy-cloud-run'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - '$_SERVICE_NAME'
      - '--image'
      - '$_AR_LOCATION-docker.pkg.dev/$PROJECT_ID/$_AR_REPOSITORY/$_SERVICE_NAME:$COMMIT_SHA'
      - '--region'
      - '$_REGION'
      - '--platform'
      - 'managed'
      - '--allow-unauthenticated'
      - '--port'
      - '$_PORT'
      - '--memory'
      - '$_MEMORY'
      - '--cpu'
      - '$_CPU'
      - '--min-instances'
      - '$_MIN_INSTANCES'
      - '--max-instances'
      - '$_MAX_INSTANCES'
      - '--execution-environment'
      - 'gen2'
      - '--set-env-vars'
      - 'NODE_ENV=production,PORT=$_PORT'${cloudSqlArgs}

substitutions:
  _SERVICE_NAME: '${appName}'
  _REGION: '${region}'
  _AR_LOCATION: '${region}'
  _AR_REPOSITORY: 'webspresso'
  _PORT: '${port}'
  _MEMORY: '${memory}'
  _CPU: '${cpu}'
  _MIN_INSTANCES: '${minInstances}'
  _MAX_INSTANCES: '${maxInstances}'

images:
  - '$_AR_LOCATION-docker.pkg.dev/$PROJECT_ID/$_AR_REPOSITORY/$_SERVICE_NAME:$COMMIT_SHA'
  - '$_AR_LOCATION-docker.pkg.dev/$PROJECT_ID/$_AR_REPOSITORY/$_SERVICE_NAME:latest'

options:
  logging: CLOUD_LOGGING_ONLY
`;
}

/**
 * Generate .gcloudignore file content
 * @returns {string}
 */
function generateGCloudIgnore() {
  return `# ==============================================================================
# Google Cloud Ignore for Webspresso
# Prevents sensitive files and dev artifacts from uploading to Cloud Build
# ==============================================================================

.gcloudignore
.git
.gitignore
.github

# Dependencies and caches
node_modules
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# Environment & Secrets (Never upload secrets into container build context)
.env
.env.*
!.env.example

# Local SQLite databases (Ephemeral on Cloud Run)
*.sqlite
*.sqlite3
*.db
*.db-journal
*.db-wal
*.db-shm
data/*.sqlite*

# Test, coverage & documentation
tests
coverage
playwright-report
test-results
docs
.agents

# IDE files
.idea
.vscode
*.swp
.DS_Store
`;
}

/**
 * Generate deploy-cloudrun.sh one-line deployment shell script
 * @param {Object} options
 * @param {string} options.appName
 * @param {string} [options.region='us-central1']
 * @param {string} [options.memory='512Mi']
 * @param {string} [options.cpu='1']
 * @param {number} [options.port=8080]
 * @param {number} [options.minInstances=0]
 * @param {number} [options.maxInstances=10]
 * @param {string} [options.cloudSql]
 * @returns {string}
 */
function generateDeployScript(options = {}) {
  const {
    appName = 'webspresso-app',
    region = 'us-central1',
    memory = '512Mi',
    cpu = '1',
    port = 8080,
    minInstances = 0,
    maxInstances = 10,
    cloudSql = '',
  } = options;

  const cloudSqlFlag = cloudSql ? ` \\\n  --add-cloudsql-instances "${cloudSql}"` : '';

  return `#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Webspresso Google Cloud Run Quick Deploy Script
# Usage: ./deploy-cloudrun.sh [SERVICE_NAME] [REGION]
# ==============================================================================

SERVICE_NAME="\${1:-${appName}}"
REGION="\${2:-${region}}"
PORT="\${PORT:-${port}}"
MEMORY="\${MEMORY:-${memory}}"
CPU="\${CPU:-${cpu}}"
MIN_INSTANCES="\${MIN_INSTANCES:-${minInstances}}"
MAX_INSTANCES="\${MAX_INSTANCES:-${maxInstances}}"

echo "🚀 Deploying '\$SERVICE_NAME' to Google Cloud Run in '\$REGION'..."

gcloud run deploy "\$SERVICE_NAME" \\
  --source . \\
  --region "\$REGION" \\
  --platform managed \\
  --allow-unauthenticated \\
  --port "\$PORT" \\
  --memory "\$MEMORY" \\
  --cpu "\$CPU" \\
  --min-instances "\$MIN_INSTANCES" \\
  --max-instances "\$MAX_INSTANCES" \\
  --execution-environment gen2 \\
  --set-env-vars "NODE_ENV=production,PORT=\$PORT"${cloudSqlFlag}

echo "✅ Webspresso app '\$SERVICE_NAME' deployed successfully to Cloud Run!"
`;
}

/**
 * Register command with Commander
 * @param {import('commander').Command} program
 */
function registerCommand(program) {
  program
    .command('add:cloudrun')
    .alias('cloudrun')
    .alias('add-cloudrun')
    .description('Generate production-ready Google Cloud Run deployment configuration')
    .option('-r, --region <region>', 'Google Cloud region', 'us-central1')
    .option('--memory <memory>', 'Container memory allocation', '512Mi')
    .option('--cpu <cpu>', 'Container CPU allocation', '1')
    .option('--port <port>', 'Container port (Cloud Run defaults to 8080)', (v) => parseInt(v, 10), 8080)
    .option('--min-instances <num>', 'Minimum container instances', (v) => parseInt(v, 10), 0)
    .option('--max-instances <num>', 'Maximum container instances', (v) => parseInt(v, 10), 10)
    .option('--cloud-sql <instance>', 'Cloud SQL instance connection name (e.g. project:region:instance)', '')
    .option('-f, --force', 'Overwrite existing files without prompting', false)
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
      const force = Boolean(options.force);
      const region = options.region || 'us-central1';
      const memory = options.memory || '512Mi';
      const cpu = String(options.cpu || '1');
      const port = options.port || 8080;
      const minInstances = options.minInstances ?? 0;
      const maxInstances = options.maxInstances ?? 10;
      const cloudSql = options.cloudSql || '';

      const cloudbuildPath = path.join(cwd, 'cloudbuild.yaml');
      const gcloudignorePath = path.join(cwd, '.gcloudignore');
      const scriptPath = path.join(cwd, 'deploy-cloudrun.sh');
      const dockerfilePath = path.join(cwd, 'Dockerfile');
      const dockerignorePath = path.join(cwd, '.dockerignore');

      console.log(`\n☁️  Scaffolding Google Cloud Run configuration for "${appName}"...`);

      // 1. Ensure Dockerfile exists (needed by Cloud Run / Cloud Build)
      if (!fs.existsSync(dockerfilePath)) {
        const dockerfileContent = generateDockerfile({ port, node: '22-alpine' });
        fs.writeFileSync(dockerfilePath, dockerfileContent, 'utf8');
        console.log(`✅ Created Dockerfile (configured for port ${port})`);
      }

      if (!fs.existsSync(dockerignorePath)) {
        const dockerignoreContent = generateDockerignore();
        fs.writeFileSync(dockerignorePath, dockerignoreContent, 'utf8');
        console.log(`✅ Created .dockerignore`);
      }

      // 2. cloudbuild.yaml
      if (fs.existsSync(cloudbuildPath) && !force) {
        console.log(`⚠️  ${path.basename(cloudbuildPath)} already exists. Skipping (use --force to overwrite).`);
      } else {
        const yamlContent = generateCloudBuildYaml({
          appName,
          region,
          memory,
          cpu,
          port,
          minInstances,
          maxInstances,
          cloudSql,
        });
        fs.writeFileSync(cloudbuildPath, yamlContent, 'utf8');
        console.log(`✅ Created ${path.basename(cloudbuildPath)}`);
      }

      // 3. .gcloudignore
      if (fs.existsSync(gcloudignorePath) && !force) {
        console.log(`⚠️  ${path.basename(gcloudignorePath)} already exists. Skipping (use --force to overwrite).`);
      } else {
        const ignoreContent = generateGCloudIgnore();
        fs.writeFileSync(gcloudignorePath, ignoreContent, 'utf8');
        console.log(`✅ Created ${path.basename(gcloudignorePath)}`);
      }

      // 4. deploy-cloudrun.sh
      if (fs.existsSync(scriptPath) && !force) {
        console.log(`⚠️  ${path.basename(scriptPath)} already exists. Skipping (use --force to overwrite).`);
      } else {
        const scriptContent = generateDeployScript({
          appName,
          region,
          memory,
          cpu,
          port,
          minInstances,
          maxInstances,
          cloudSql,
        });
        fs.writeFileSync(scriptPath, scriptContent, { encoding: 'utf8', mode: 0o755 });
        console.log(`✅ Created ${path.basename(scriptPath)} (executable)`);
      }

      // 5. Update package.json scripts
      let modifiedPkg = false;
      if (!pkg.scripts) pkg.scripts = {};
      if (!pkg.scripts['gcp:deploy']) {
        pkg.scripts['gcp:deploy'] = './deploy-cloudrun.sh';
        modifiedPkg = true;
      }
      if (!pkg.scripts['gcp:build']) {
        pkg.scripts['gcp:build'] = 'gcloud builds submit --config=cloudbuild.yaml';
        modifiedPkg = true;
      }

      if (modifiedPkg) {
        try {
          fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
          console.log(`✅ Added "gcp:deploy" and "gcp:build" scripts to package.json`);
        } catch (_) {}
      }

      console.log('\n🎉 Google Cloud Run setup complete!');
      console.log('\nNext steps:');
      console.log('  1. Authenticate with GCP: `gcloud auth login`');
      console.log('  2. Set active project: `gcloud config set project YOUR_PROJECT_ID`');
      console.log('  3. Deploy directly: `npm run gcp:deploy` or `gcloud run deploy`');
      console.log('  4. Or build via Cloud Build: `npm run gcp:build`\n');
    });
}

module.exports = {
  registerCommand,
  generateCloudBuildYaml,
  generateGCloudIgnore,
  generateDeployScript,
};

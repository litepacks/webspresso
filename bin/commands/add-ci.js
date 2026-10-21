/**
 * Add CI/CD Command
 * Scaffolds zero-secret GitHub Actions workflows (OIDC / WIF) & GitLab CI pipelines
 * for Google Cloud Run, AWS App Runner / ECS, Cloudflare Workers, and automated test gates.
 *
 * @module bin/commands/add-ci
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Generate standard CI workflow (.github/workflows/ci.yml)
 * Runs tests and deploy:check verification across Node versions
 * @param {Object} options
 * @param {string} [options.branch='main']
 * @returns {string}
 */
function generateBaseCiWorkflow(options = {}) {
  const branch = options.branch || 'main';

  return `name: Webspresso CI & Preflight

on:
  push:
    branches: [ ${branch} ]
  pull_request:
    branches: [ ${branch} ]

jobs:
  test-and-verify:
    name: Test & Deployment Preflight
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20.x, 22.x]

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js \${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node-version }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run Unit & Integration Tests
        run: npm test

      - name: Run Webspresso Preflight Check
        run: npx webspresso deploy:check --strict
`;
}

/**
 * Generate Google Cloud Run Deployment Workflow with Workload Identity Federation (Keyless OIDC)
 * @param {Object} options
 * @param {string} options.appName
 * @param {string} [options.branch='main']
 * @param {string} [options.region='us-central1']
 * @returns {string}
 */
function generateCloudRunWorkflow(options = {}) {
  const {
    appName = 'webspresso-app',
    branch = 'main',
    region = 'us-central1',
  } = options;

  return `name: Deploy to Google Cloud Run

on:
  push:
    branches: [ ${branch} ]

# Permissions required for Google Workload Identity Federation (WIF) OIDC authentication
permissions:
  contents: read
  id-token: write

env:
  SERVICE_NAME: ${appName}
  REGION: ${region}
  AR_LOCATION: ${region}
  AR_REPOSITORY: webspresso-apps

jobs:
  deploy:
    name: Test, Build & Deploy to Cloud Run
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run Test Suite
        run: npm test

      - name: Cloud Run Preflight Audit
        run: npx webspresso deploy:check --platform cloudrun --strict

      # Keyless OIDC Authentication with Google Cloud
      # Requires: WORKLOAD_IDENTITY_PROVIDER and SERVICE_ACCOUNT GitHub secrets
      - name: Authenticate to Google Cloud (Workload Identity)
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: \${{ secrets.GCP_WIF_PROVIDER }}
          service_account: \${{ secrets.GCP_WIF_SERVICE_ACCOUNT }}

      - name: Setup Google Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker for Artifact Registry
        run: gcloud auth configure-docker \${{ env.AR_LOCATION }}-docker.pkg.dev --quiet

      - name: Build Docker Container
        run: |
          IMAGE_TAG="\${{ env.AR_LOCATION }}-docker.pkg.dev/\${{ secrets.GCP_PROJECT_ID }}/\${{ env.AR_REPOSITORY }}/\${{ env.SERVICE_NAME }}:\${{ github.sha }}"
          LATEST_TAG="\${{ env.AR_LOCATION }}-docker.pkg.dev/\${{ secrets.GCP_PROJECT_ID }}/\${{ env.AR_REPOSITORY }}/\${{ env.SERVICE_NAME }}:latest"
          docker build -t "$IMAGE_TAG" -t "$LATEST_TAG" .
          docker push "$IMAGE_TAG"
          docker push "$LATEST_TAG"

      - name: Deploy to Serverless Cloud Run
        run: |
          IMAGE_TAG="\${{ env.AR_LOCATION }}-docker.pkg.dev/\${{ secrets.GCP_PROJECT_ID }}/\${{ env.AR_REPOSITORY }}/\${{ env.SERVICE_NAME }}:\${{ github.sha }}"
          gcloud run deploy \${{ env.SERVICE_NAME }} \\
            --image "$IMAGE_TAG" \\
            --region \${{ env.REGION }} \\
            --platform managed \\
            --allow-unauthenticated
`;
}

/**
 * Generate AWS Deployment Workflow with IAM GitHub OIDC Role (Keyless)
 * @param {Object} options
 * @param {string} options.appName
 * @param {string} [options.branch='main']
 * @param {string} [options.region='us-east-1']
 * @returns {string}
 */
function generateAwsWorkflow(options = {}) {
  const {
    appName = 'webspresso-app',
    branch = 'main',
    region = 'us-east-1',
  } = options;

  return `name: Deploy to AWS (App Runner / ECS)

on:
  push:
    branches: [ ${branch} ]

# Permissions required to request GitHub OIDC token for AWS IAM role assumption
permissions:
  id-token: write
  contents: read

env:
  AWS_REGION: ${region}
  ECR_REPOSITORY: ${appName}
  SERVICE_NAME: ${appName}

jobs:
  deploy:
    name: Test, Build & Deploy to AWS
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run Test Suite
        run: npm test

      - name: AWS Preflight Audit
        run: npx webspresso deploy:check --platform aws --strict

      # Keyless OIDC Authentication with AWS IAM Role
      - name: Configure AWS Credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: \${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: \${{ env.AWS_REGION }}

      - name: Log in to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build, tag, and push image to Amazon ECR
        env:
          ECR_REGISTRY: \${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: \${{ github.sha }}
        run: |
          docker build -t "$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG" -t "$ECR_REGISTRY/$ECR_REPOSITORY:latest" .
          docker push "$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG"
          docker push "$ECR_REGISTRY/$ECR_REPOSITORY:latest"

      # App Runner auto-syncs on ECR push, or trigger manual redeploy:
      - name: Update AWS Deployment
        run: |
          if [ -n "\${{ secrets.AWS_APP_RUNNER_ARN }}" ]; then
            aws apprunner start-deployment --service-arn \${{ secrets.AWS_APP_RUNNER_ARN }}
          fi
`;
}

/**
 * Generate Cloudflare Workers Deployment Workflow
 * @param {Object} options
 * @param {string} [options.branch='main']
 * @returns {string}
 */
function generateCloudflareWorkflow(options = {}) {
  const { branch = 'main' } = options;

  return `name: Deploy to Cloudflare Workers

on:
  push:
    branches: [ ${branch} ]

jobs:
  deploy:
    name: Test & Deploy to Edge
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run Test Suite
        run: npm test

      - name: Cloudflare Preflight Audit
        run: npx webspresso deploy:check --platform cloudflare --strict

      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: \${{ secrets.CLOUDFLARE_API_TOKEN }}
`;
}

/**
 * Generate GitLab CI pipeline configuration (.gitlab-ci.yml)
 * @param {Object} options
 * @param {string} [options.platform='generic']
 * @returns {string}
 */
function generateGitLabCi(options = {}) {
  const { platform = 'generic' } = options;

  let platformAudit = 'npx webspresso deploy:check --strict';
  if (platform === 'cloudrun') {
    platformAudit = 'npx webspresso deploy:check --platform cloudrun --strict';
  } else if (platform === 'aws') {
    platformAudit = 'npx webspresso deploy:check --platform aws --strict';
  } else if (platform === 'cloudflare') {
    platformAudit = 'npx webspresso deploy:check --platform cloudflare --strict';
  }

  return `# ==============================================================================
# GitLab CI/CD Pipeline for Webspresso
# ==============================================================================

image: node:22-alpine

stages:
  - test
  - verify
  - deploy

cache:
  paths:
    - node_modules/
    - .npm/

test:
  stage: test
  script:
    - npm ci --cache .npm --prefer-offline
    - npm test
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == "main"'

preflight_check:
  stage: verify
  script:
    - npm ci --cache .npm --prefer-offline
    - ${platformAudit}
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'

deploy_production:
  stage: deploy
  image: docker:27
  services:
    - docker:dind
  script:
    - echo "Deploying Webspresso container to production..."
    - docker build -t webspresso-app:$CI_COMMIT_SHA .
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
`;
}

/**
 * Detect cloud platform from project artifacts
 * @param {string} cwd
 * @returns {'cloudrun'|'aws'|'cloudflare'|'generic'}
 */
function detectTargetPlatform(cwd) {
  if (fs.existsSync(path.join(cwd, 'cloudbuild.yaml')) || fs.existsSync(path.join(cwd, '.gcloudignore'))) {
    return 'cloudrun';
  }
  if (fs.existsSync(path.join(cwd, 'apprunner.yaml')) || fs.existsSync(path.join(cwd, 'ecs-task-definition.json'))) {
    return 'aws';
  }
  if (fs.existsSync(path.join(cwd, 'wrangler.toml'))) {
    return 'cloudflare';
  }
  return 'generic';
}

/**
 * Register command with Commander
 * @param {import('commander').Command} program
 */
function registerCommand(program) {
  program
    .command('add:ci')
    .alias('add:workflow')
    .alias('add:github-actions')
    .description('Scaffold zero-secret GitHub Actions CI/CD workflows and GitLab CI pipelines')
    .option('-p, --platform <platform>', 'Target platform (cloudrun, aws, cloudflare, generic, all, or auto)', 'auto')
    .option('-b, --branch <branch>', 'Default trigger branch', 'main')
    .option('--region <region>', 'Cloud region override')
    .option('--gitlab', 'Also generate .gitlab-ci.yml pipeline configuration', false)
    .option('--force', 'Overwrite existing workflow files', false)
    .action(async (...actionArgs) => {
      const cmd = actionArgs[actionArgs.length - 1];
      const options = (cmd && typeof cmd.opts === 'function')
        ? cmd.opts()
        : (actionArgs.find((a) => a && typeof a === 'object') || {});

      const cwd = process.cwd();
      const pkgPath = path.join(cwd, 'package.json');
      if (!fs.existsSync(pkgPath)) {
        console.error('❌ package.json not found. Please run this command in a Webspresso project root.');
        process.exit(1);
      }

      let pkg = {};
      try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      } catch (_) {}

      const appName = pkg.name || path.basename(cwd);
      const branch = options.branch || 'main';
      const force = Boolean(options.force);
      let platform = options.platform || 'auto';

      if (platform === 'auto') {
        platform = detectTargetPlatform(cwd);
      }

      console.log(`\n🤖 Scaffolding CI/CD Pipelines for "${appName}"...`);
      console.log(`Target Platform : ${platform.toUpperCase()}`);
      console.log(`Trigger Branch  : ${branch}\n`);

      const workflowsDir = path.join(cwd, '.github', 'workflows');
      if (!fs.existsSync(workflowsDir)) {
        fs.mkdirSync(workflowsDir, { recursive: true });
      }

      // 1. Base CI workflow (ci.yml)
      const baseCiPath = path.join(workflowsDir, 'ci.yml');
      if (fs.existsSync(baseCiPath) && !force) {
        console.log(`⚠️  .github/workflows/ci.yml already exists. Skipping (use --force to overwrite).`);
      } else {
        const baseContent = generateBaseCiWorkflow({ branch });
        fs.writeFileSync(baseCiPath, baseContent, 'utf8');
        console.log(`✅ Created .github/workflows/ci.yml (Test & Preflight gate)`);
      }

      // 2. Platform-Specific Workflow
      if (platform === 'cloudrun' || platform === 'all') {
        const crPath = path.join(workflowsDir, 'deploy-cloudrun.yml');
        if (fs.existsSync(crPath) && !force) {
          console.log(`⚠️  .github/workflows/deploy-cloudrun.yml already exists. Skipping.`);
        } else {
          const crContent = generateCloudRunWorkflow({
            appName,
            branch,
            region: options.region || 'us-central1',
          });
          fs.writeFileSync(crPath, crContent, 'utf8');
          console.log(`✅ Created .github/workflows/deploy-cloudrun.yml (Keyless WIF OIDC)`);
        }
      }

      if (platform === 'aws' || platform === 'all') {
        const awsPath = path.join(workflowsDir, 'deploy-aws.yml');
        if (fs.existsSync(awsPath) && !force) {
          console.log(`⚠️  .github/workflows/deploy-aws.yml already exists. Skipping.`);
        } else {
          const awsContent = generateAwsWorkflow({
            appName,
            branch,
            region: options.region || 'us-east-1',
          });
          fs.writeFileSync(awsPath, awsContent, 'utf8');
          console.log(`✅ Created .github/workflows/deploy-aws.yml (Keyless IAM OIDC)`);
        }
      }

      if (platform === 'cloudflare' || platform === 'all') {
        const cfPath = path.join(workflowsDir, 'deploy-cloudflare.yml');
        if (fs.existsSync(cfPath) && !force) {
          console.log(`⚠️  .github/workflows/deploy-cloudflare.yml already exists. Skipping.`);
        } else {
          const cfContent = generateCloudflareWorkflow({ branch });
          fs.writeFileSync(cfPath, cfContent, 'utf8');
          console.log(`✅ Created .github/workflows/deploy-cloudflare.yml (Wrangler Action)`);
        }
      }

      // 3. GitLab CI pipeline if requested
      if (options.gitlab) {
        const gitlabPath = path.join(cwd, '.gitlab-ci.yml');
        if (fs.existsSync(gitlabPath) && !force) {
          console.log(`⚠️  .gitlab-ci.yml already exists. Skipping.`);
        } else {
          const gitlabContent = generateGitLabCi({ platform });
          fs.writeFileSync(gitlabPath, gitlabContent, 'utf8');
          console.log(`✅ Created .gitlab-ci.yml`);
        }
      }

      // 4. Update package.json scripts
      let modifiedPkg = false;
      if (!pkg.scripts) pkg.scripts = {};
      if (!pkg.scripts['ci:verify']) {
        pkg.scripts['ci:verify'] = 'npm test && webspresso deploy:check --strict';
        modifiedPkg = true;
      }

      if (modifiedPkg) {
        try {
          fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
          console.log(`✅ Added "ci:verify" script to package.json`);
        } catch (_) {}
      }

      console.log('\n🎉 CI/CD Pipeline scaffolding complete!');
      console.log('\nSecurity & Next Steps:');
      if (platform === 'cloudrun') {
        console.log('  1. Configure Workload Identity Pool in GCP IAM:');
        console.log('     gcloud iam workload-identity-pools create "github-pool" --location="global"');
        console.log('  2. Set GitHub Repository Secrets:');
        console.log('     - GCP_PROJECT_ID');
        console.log('     - GCP_WIF_PROVIDER (e.g. projects/123/locations/global/workloadIdentityPools/github-pool/providers/github-provider)');
        console.log('     - GCP_WIF_SERVICE_ACCOUNT (e.g. github-deployer@my-project.iam.gserviceaccount.com)\n');
      } else if (platform === 'aws') {
        console.log('  1. Configure GitHub OIDC Identity Provider in AWS IAM.');
        console.log('  2. Set GitHub Repository Secrets:');
        console.log('     - AWS_DEPLOY_ROLE_ARN (e.g. arn:aws:iam::123456789012:role/GitHubActionsDeployRole)\n');
      } else if (platform === 'cloudflare') {
        console.log('  1. Set GitHub Repository Secret:');
        console.log('     - CLOUDFLARE_API_TOKEN\n');
      } else {
        console.log('  1. Push code to your git remote: git push origin main');
        console.log('  2. GitHub Actions will automatically run test & deploy:check gates.\n');
      }
    });
}

module.exports = {
  registerCommand,
  generateBaseCiWorkflow,
  generateCloudRunWorkflow,
  generateAwsWorkflow,
  generateCloudflareWorkflow,
  generateGitLabCi,
  detectTargetPlatform,
};

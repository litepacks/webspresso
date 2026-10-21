/**
 * Add AWS Command
 * Generate production-ready AWS configuration (apprunner.yaml, ecs-task-definition.json, deploy-aws.sh)
 * Supports AWS App Runner and AWS ECS (Fargate) container deployments
 * @module bin/commands/add-aws
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { generateDockerfile, generateDockerignore } = require('./add-docker');

/**
 * Normalize CPU value to ECS Fargate units (256, 512, 1024, 2048, 4096)
 * @param {string|number} cpu
 * @returns {string}
 */
function normalizeEcsCpu(cpu) {
  if (!cpu) return '512';
  const str = String(cpu).trim().toLowerCase();
  if (str === '0.25' || str === '0.25 vcpu') return '256';
  if (str === '0.5' || str === '0.5 vcpu') return '512';
  if (str === '1' || str === '1 vcpu') return '1024';
  if (str === '2' || str === '2 vcpu') return '2048';
  if (str === '4' || str === '4 vcpu') return '4096';
  return str.replace(/[^0-9]/g, '') || '512';
}

/**
 * Normalize Memory value to ECS Fargate MiB (512, 1024, 2048, etc.)
 * @param {string|number} memory
 * @returns {string}
 */
function normalizeEcsMemory(memory) {
  if (!memory) return '1024';
  const str = String(memory).trim().toLowerCase();
  if (str.endsWith('gb') || str.endsWith('g')) {
    const num = parseFloat(str);
    return String(Math.round(num * 1024));
  }
  if (str.endsWith('mib') || str.endsWith('mb') || str.endsWith('mi')) {
    return str.replace(/[^0-9]/g, '') || '1024';
  }
  return str.replace(/[^0-9]/g, '') || '1024';
}

/**
 * Generate apprunner.yaml for AWS App Runner
 * @param {Object} options
 * @param {string} options.appName
 * @param {number} [options.port=7331]
 * @param {string} [options.nodeVersion='nodejs20']
 * @returns {string}
 */
function generateAppRunnerYaml(options = {}) {
  const {
    port = 7331,
    nodeVersion = 'nodejs20',
  } = options;

  return `# ==============================================================================
# AWS App Runner Configuration for Webspresso
# Fully-managed container & code runtime with auto-scaling and zero-ops TLS
# Docs: https://docs.aws.amazon.com/apprunner/latest/dg/config-file.html
# ==============================================================================

version: 1.0
runtime: ${nodeVersion}

build:
  commands:
    build:
      - npm ci --omit=dev
      - npm run build --if-present
  env:
    - name: NODE_ENV
      value: production

run:
  command: npm start
  network:
    port: "${port}"
    env: PORT
  env:
    - name: NODE_ENV
      value: production
    - name: PORT
      value: "${port}"
`;
}

/**
 * Generate AWS ECS Task Definition JSON for AWS Fargate
 * @param {Object} options
 * @param {string} options.appName
 * @param {string} [options.region='us-east-1']
 * @param {string|number} [options.cpu='512']
 * @param {string|number} [options.memory='1024']
 * @param {number} [options.port=7331]
 * @returns {string}
 */
function generateEcsTaskDefinition(options = {}) {
  const {
    appName = 'webspresso-app',
    region = 'us-east-1',
    cpu = '512',
    memory = '1024',
    port = 7331,
  } = options;

  const normalizedCpu = normalizeEcsCpu(cpu);
  const normalizedMemory = normalizeEcsMemory(memory);

  const taskDef = {
    family: appName,
    networkMode: 'awsvpc',
    requiresCompatibilities: ['FARGATE'],
    cpu: normalizedCpu,
    memory: normalizedMemory,
    executionRoleArn: 'arn:aws:iam::YOUR_AWS_ACCOUNT_ID:role/ecsTaskExecutionRole',
    taskRoleArn: 'arn:aws:iam::YOUR_AWS_ACCOUNT_ID:role/ecsTaskRole',
    containerDefinitions: [
      {
        name: appName,
        image: `YOUR_AWS_ACCOUNT_ID.dkr.ecr.${region}.amazonaws.com/${appName}:latest`,
        essential: true,
        portMappings: [
          {
            containerPort: port,
            hostPort: port,
            protocol: 'tcp',
          },
        ],
        environment: [
          { name: 'NODE_ENV', value: 'production' },
          { name: 'PORT', value: String(port) },
        ],
        healthCheck: {
          command: [
            'CMD-SHELL',
            `node -e 'require("http").get("http://localhost:${port}/healthz", (r) => process.exit(r.statusCode === 200 ? 0 : 1))' || exit 1`,
          ],
          interval: 30,
          timeout: 5,
          retries: 3,
          startPeriod: 15,
        },
        logConfiguration: {
          logDriver: 'awslogs',
          options: {
            'awslogs-group': `/ecs/${appName}`,
            'awslogs-region': region,
            'awslogs-stream-prefix': 'ecs',
            'awslogs-create-group': 'true',
          },
        },
      },
    ],
  };

  return JSON.stringify(taskDef, null, 2) + '\n';
}

/**
 * Generate deploy-aws.sh script for automated deployment to ECR, App Runner, or ECS
 * @param {Object} options
 * @param {string} options.appName
 * @param {string} [options.region='us-east-1']
 * @param {number} [options.port=7331]
 * @returns {string}
 */
function generateAwsDeployScript(options = {}) {
  const {
    appName = 'webspresso-app',
    region = 'us-east-1',
    port = 7331,
  } = options;

  return `#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Webspresso AWS Deployment Automation Script
# Builds hardened Docker image, pushes to Amazon ECR, and updates App Runner / ECS
# Usage: ./deploy-aws.sh [APP_NAME] [REGION]
# ==============================================================================

APP_NAME="\${1:-${appName}}"
REGION="\${2:-\${AWS_REGION:-${region}}}"
PORT="\${PORT:-${port}}"

echo "☁️  Webspresso AWS Deployment Target: '\$APP_NAME' in '\$REGION'"

# 1. Verify AWS CLI
if ! command -v aws &> /dev/null; then
  echo "❌ Error: 'aws' CLI is not installed or not in PATH."
  echo "Please install AWS CLI: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
  exit 1
fi

# 2. Verify Docker
if ! command -v docker &> /dev/null; then
  echo "❌ Error: 'docker' is not installed or not running."
  exit 1
fi

# 3. Retrieve AWS Account ID
AWS_ACCOUNT_ID="\$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)"
if [ -z "\$AWS_ACCOUNT_ID" ]; then
  echo "❌ Error: Could not determine AWS Account ID. Are your AWS credentials configured?"
  echo "Run: aws configure"
  exit 1
fi

ECR_URI="\$AWS_ACCOUNT_ID.dkr.ecr.\$REGION.amazonaws.com/\$APP_NAME"
IMAGE_TAG="\$(git rev-parse --short HEAD 2>/dev/null || echo 'latest')"

echo "🔑 Authenticated as AWS Account: \$AWS_ACCOUNT_ID"
echo "📦 Target ECR Repository: \$ECR_URI"

# 4. Ensure ECR Repository exists
aws ecr describe-repositories --repository-names "\$APP_NAME" --region "\$REGION" &>/dev/null || {
  echo "📁 Creating ECR repository '\$APP_NAME'..."
  aws ecr create-repository \\
    --repository-name "\$APP_NAME" \\
    --image-scanning-configuration scanOnPush=true \\
    --region "\$REGION" >/dev/null
}

# 5. Authenticate Docker with Amazon ECR
echo "🔐 Logging in to Amazon ECR..."
aws ecr get-login-password --region "\$REGION" | docker login --username AWS --password-stdin "\$AWS_ACCOUNT_ID.dkr.ecr.\$REGION.amazonaws.com"

# 6. Build production multi-stage Docker image
echo "🔨 Building Docker image..."
docker build -t "\$APP_NAME:\$IMAGE_TAG" -t "\$ECR_URI:\$IMAGE_TAG" -t "\$ECR_URI:latest" .

# 7. Push to ECR
echo "🚀 Pushing image to Amazon ECR..."
docker push "\$ECR_URI:\$IMAGE_TAG"
docker push "\$ECR_URI:latest"

echo ""
echo "✅ Image successfully built and pushed to Amazon ECR:"
echo "   \$ECR_URI:\$IMAGE_TAG"
echo "   \$ECR_URI:latest"
echo ""
echo "Next steps to complete deployment:"
echo "  Option A (AWS App Runner):"
echo "    aws apprunner create-service --service-name \$APP_NAME \\"
echo "      --source-configuration ImageRepository='{ImageIdentifier=\"'\$ECR_URI:latest'\",ImageRepositoryType=\"ECR\",ImageConfiguration={Port=\"'\$PORT'\"}}'"
echo ""
echo "  Option B (AWS ECS Fargate):"
echo "    aws ecs register-task-definition --cli-input-json file://ecs-task-definition.json"
echo "    aws ecs update-service --cluster \$APP_NAME-cluster --service \$APP_NAME-service --force-new-deployment"
echo ""
`;
}

/**
 * Register command with Commander
 * @param {import('commander').Command} program
 */
function registerCommand(program) {
  program
    .command('add:aws')
    .alias('aws')
    .alias('add-aws')
    .description('Generate production-ready AWS deployment configuration (App Runner & ECS Fargate)')
    .option('-r, --region <region>', 'AWS region', 'us-east-1')
    .option('--port <port>', 'Container port (Webspresso default is 7331)', (v) => parseInt(v, 10), 7331)
    .option('--cpu <cpu>', 'CPU allocation for ECS/App Runner (e.g. 512, 1024 or 1 vCPU)', '512')
    .option('--memory <memory>', 'Memory allocation for ECS/App Runner (e.g. 1024, 1GB)', '1024')
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
      const region = options.region || 'us-east-1';
      const port = options.port || 7331;
      const cpu = options.cpu || '512';
      const memory = options.memory || '1024';

      const appRunnerPath = path.join(cwd, 'apprunner.yaml');
      const ecsTaskDefPath = path.join(cwd, 'ecs-task-definition.json');
      const scriptPath = path.join(cwd, 'deploy-aws.sh');
      const dockerfilePath = path.join(cwd, 'Dockerfile');
      const dockerignorePath = path.join(cwd, '.dockerignore');

      console.log(`\n☁️  Scaffolding AWS deployment configuration for "${appName}"...`);

      // 1. Ensure Dockerfile exists (needed by ECR & container deploy)
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

      // 2. apprunner.yaml
      if (fs.existsSync(appRunnerPath) && !force) {
        console.log(`⚠️  ${path.basename(appRunnerPath)} already exists. Skipping (use --force to overwrite).`);
      } else {
        const appRunnerContent = generateAppRunnerYaml({
          appName,
          port,
        });
        fs.writeFileSync(appRunnerPath, appRunnerContent, 'utf8');
        console.log(`✅ Created ${path.basename(appRunnerPath)} (AWS App Runner)`);
      }

      // 3. ecs-task-definition.json
      if (fs.existsSync(ecsTaskDefPath) && !force) {
        console.log(`⚠️  ${path.basename(ecsTaskDefPath)} already exists. Skipping (use --force to overwrite).`);
      } else {
        const taskDefContent = generateEcsTaskDefinition({
          appName,
          region,
          cpu,
          memory,
          port,
        });
        fs.writeFileSync(ecsTaskDefPath, taskDefContent, 'utf8');
        console.log(`✅ Created ${path.basename(ecsTaskDefPath)} (AWS ECS Fargate Task Definition)`);
      }

      // 4. deploy-aws.sh
      if (fs.existsSync(scriptPath) && !force) {
        console.log(`⚠️  ${path.basename(scriptPath)} already exists. Skipping (use --force to overwrite).`);
      } else {
        const scriptContent = generateAwsDeployScript({
          appName,
          region,
          port,
        });
        fs.writeFileSync(scriptPath, scriptContent, { encoding: 'utf8', mode: 0o755 });
        console.log(`✅ Created ${path.basename(scriptPath)} (executable)`);
      }

      // 5. Update package.json scripts
      let modifiedPkg = false;
      if (!pkg.scripts) pkg.scripts = {};
      if (!pkg.scripts['aws:deploy']) {
        pkg.scripts['aws:deploy'] = './deploy-aws.sh';
        modifiedPkg = true;
      }

      if (modifiedPkg) {
        try {
          fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
          console.log(`✅ Added "aws:deploy" script to package.json`);
        } catch (_) {}
      }

      console.log('\n🎉 AWS deployment configuration complete!');
      console.log('\nNext steps:');
      console.log('  1. Configure AWS CLI: `aws configure`');
      console.log('  2. Review ecs-task-definition.json and apprunner.yaml');
      console.log('  3. Deploy container via ECR: `npm run aws:deploy`\n');
    });
}

module.exports = {
  registerCommand,
  generateAppRunnerYaml,
  generateEcsTaskDefinition,
  generateAwsDeployScript,
  normalizeEcsCpu,
  normalizeEcsMemory,
};

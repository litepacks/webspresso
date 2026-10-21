/**
 * Add Migration Job Command
 * Scaffolds production-grade, zero-downtime database migration jobs for Google Cloud Run,
 * AWS ECS Fargate / App Runner, and Kubernetes pre-upgrade hooks.
 *
 * @module bin/commands/add-migration-job
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Generate Cloud Run Job YAML definition
 * @param {Object} options
 * @returns {string}
 */
function generateCloudRunJobYaml(options = {}) {
  const {
    appName = 'webspresso-app',
    region = 'us-central1',
    memory = '512Mi',
    cpu = '1',
    cloudSql = '',
  } = options;

  const cloudSqlAnnotation = cloudSql
    ? `\n        run.googleapis.com/cloudsql-instances: ${cloudSql}`
    : '';

  return `# ==============================================================================
# Google Cloud Run Migration Job for Webspresso
# Executes isolated database migrations before deploying new web service revisions.
# Docs: https://cloud.google.com/run/docs/create-jobs
# ==============================================================================

apiVersion: run.googleapis.com/v1
kind: Job
metadata:
  name: ${appName}-migrate
  labels:
    cloud.googleapis.com/location: ${region}
spec:
  template:
    metadata:
      annotations:
        run.googleapis.com/execution-environment: gen2${cloudSqlAnnotation}
    spec:
      template:
        spec:
          containers:
          - image: \${IMAGE_TAG:-${region}-docker.pkg.dev/\${PROJECT_ID}/webspresso/${appName}:latest}
            command:
            - npx
            args:
            - webspresso
            - db:migrate
            - --env
            - production
            resources:
              limits:
                memory: ${memory}
                cpu: '${cpu}'
            env:
            - name: NODE_ENV
              value: production
          timeoutSeconds: 600
          maxRetries: 1
`;
}

/**
 * Generate bash script to deploy and execute Cloud Run Job
 * @param {Object} options
 * @returns {string}
 */
function generateCloudRunJobScript(options = {}) {
  const {
    appName = 'webspresso-app',
    region = 'us-central1',
    cloudSql = '',
  } = options;

  const cloudSqlArg = cloudSql ? ` \\\n  --add-cloudsql-instances "${cloudSql}"` : '';

  return `#!/usr/bin/env bash
# ==============================================================================
# Run Google Cloud Run Database Migration Job
# Usage: ./deploy-cloudrun-migration.sh [IMAGE_TAG] [REGION]
# ==============================================================================

set -euo pipefail

IMAGE="\${1:-}"
REGION="\${2:-${region}}"
JOB_NAME="${appName}-migrate"

if [ -z "$IMAGE" ]; then
  echo "❌ Error: Image tag required as first argument."
  echo "Usage: ./deploy-cloudrun-migration.sh <image_url> [region]"
  exit 1
fi

echo "📦 Configuring Cloud Run Job: $JOB_NAME in $REGION..."
gcloud run jobs deploy "$JOB_NAME" \\
  --image "$IMAGE" \\
  --region "$REGION" \\
  --command "npx" \\
  --args "webspresso,db:migrate,--env,production" \\
  --set-env-vars NODE_ENV=production \\
  --max-retries 1 \\
  --wait${cloudSqlArg}

echo "⚡ Executing database migrations..."
gcloud run jobs execute "$JOB_NAME" \\
  --region "$REGION" \\
  --wait

echo "✅ Database migration completed successfully."
`;
}

/**
 * Generate AWS ECS Fargate Task Definition for migrations
 * @param {Object} options
 * @returns {string}
 */
function generateEcsMigrationTaskJson(options = {}) {
  const {
    appName = 'webspresso-app',
    region = 'us-east-1',
    cpu = '256',
    memory = '512',
  } = options;

  const taskDef = {
    family: `${appName}-migration`,
    networkMode: 'awsvpc',
    requiresCompatibilities: ['FARGATE'],
    cpu: String(cpu),
    memory: String(memory),
    executionRoleArn: `arn:aws:iam::\${AWS_ACCOUNT_ID}:role/${appName}-execution-role`,
    taskRoleArn: `arn:aws:iam::\${AWS_ACCOUNT_ID}:role/${appName}-task-role`,
    containerDefinitions: [
      {
        name: `${appName}-migrator`,
        image: `\${AWS_ACCOUNT_ID}.dkr.ecr.${region}.amazonaws.com/${appName}:latest`,
        essential: true,
        command: ['npx', 'webspresso', 'db:migrate', '--env', 'production'],
        environment: [
          { name: 'NODE_ENV', value: 'production' },
        ],
        logConfiguration: {
          logDriver: 'awslogs',
          options: {
            'awslogs-group': `/ecs/${appName}-migration`,
            'awslogs-region': region,
            'awslogs-stream-prefix': 'migration',
            'awslogs-create-group': 'true',
          },
        },
      },
    ],
  };

  return JSON.stringify(taskDef, null, 2) + '\n';
}

/**
 * Generate bash script to run AWS ECS Fargate migration task
 * @param {Object} options
 * @returns {string}
 */
function generateAwsMigrationScript(options = {}) {
  const {
    appName = 'webspresso-app',
    region = 'us-east-1',
  } = options;

  return `#!/usr/bin/env bash
# ==============================================================================
# Run AWS ECS Fargate Database Migration Task
# Usage: ./deploy-aws-migration.sh [CLUSTER_NAME] [SUBNET_ID] [SECURITY_GROUP_ID]
# ==============================================================================

set -euo pipefail

CLUSTER="\${1:-\${ECS_CLUSTER:-default}}"
SUBNET="\${2:-\${SUBNET_ID:-}}"
SEC_GROUP="\${3:-\${SECURITY_GROUP_ID:-}}"
TASK_DEF="${appName}-migration"
REGION="\${AWS_REGION:-${region}}"

if [ -z "$SUBNET" ] || [ -z "$SEC_GROUP" ]; then
  echo "⚠️ Warning: SUBNET_ID or SECURITY_GROUP_ID not provided."
  echo "Usage: ./deploy-aws-migration.sh <cluster> <subnet-id> <security-group-id>"
fi

echo "⚡ Starting one-off ECS migration task on cluster: $CLUSTER..."
TASK_ARN=$(aws ecs run-task \\
  --region "$REGION" \\
  --cluster "$CLUSTER" \\
  --task-definition "$TASK_DEF" \\
  --launch-type FARGATE \\
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET],securityGroups=[$SEC_GROUP],assignPublicIp=ENABLED}" \\
  --query 'tasks[0].taskArn' \\
  --output text)

echo "⏳ Waiting for migration task to complete: $TASK_ARN..."
aws ecs wait tasks-stopped \\
  --region "$REGION" \\
  --cluster "$CLUSTER" \\
  --tasks "$TASK_ARN"

# Inspect container exit code
EXIT_CODE=$(aws ecs describe-tasks \\
  --region "$REGION" \\
  --cluster "$CLUSTER" \\
  --tasks "$TASK_ARN" \\
  --query 'tasks[0].containers[0].exitCode' \\
  --output text)

if [ "$EXIT_CODE" -eq 0 ]; then
  echo "✅ Database migration finished successfully (exit code 0)."
else
  echo "❌ Database migration failed with exit code $EXIT_CODE."
  exit "$EXIT_CODE"
fi
`;
}

/**
 * Generate Kubernetes Pre-Deploy Job YAML (Helm hook compatible)
 * @param {Object} options
 * @returns {string}
 */
function generateK8sMigrationJobYaml(options = {}) {
  const {
    appName = 'webspresso-app',
  } = options;

  return `# ==============================================================================
# Kubernetes Database Migration Job (Helm Pre-Install / Pre-Upgrade Hook)
# Runs schema migrations to completion before rolling out web Deployment pods
# ==============================================================================

apiVersion: batch/v1
kind: Job
metadata:
  name: ${appName}-migration
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "-5"
    "helm.sh/hook-delete-policy": hook-succeeded,before-hook-creation
spec:
  backoffLimit: 1
  template:
    metadata:
      name: ${appName}-migration
      labels:
        app.kubernetes.io/name: ${appName}
        app.kubernetes.io/component: migration
    spec:
      restartPolicy: Never
      containers:
      - name: migrator
        image: \${IMAGE_TAG:-${appName}:latest}
        command:
        - npx
        - webspresso
        - db:migrate
        - --env
        - production
        env:
        - name: NODE_ENV
          value: production
        envFrom:
        - secretRef:
            name: ${appName}-secrets
            optional: true
`;
}

/**
 * Scaffolds migration jobs for the specified platform
 * @param {string} targetDir
 * @param {Object} options
 * @returns {Array<{ path: string, description: string }>}
 */
function runAddMigrationJob(targetDir, options = {}) {
  const platform = (options.platform || 'cloudrun').toLowerCase();
  const force = Boolean(options.force);
  const results = [];

  const writeTarget = (filename, content, desc) => {
    const fullPath = path.isAbsolute(filename) ? filename : path.join(targetDir, filename);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(fullPath) && !force) {
      return { path: fullPath, created: false, description: desc, skipped: true };
    }

    fs.writeFileSync(fullPath, content, 'utf8');
    if (filename.endsWith('.sh')) {
      try {
        fs.chmodSync(fullPath, 0o755);
      } catch (_) {}
    }
    return { path: fullPath, created: true, description: desc, skipped: false };
  };

  // Google Cloud Run
  if (platform === 'cloudrun' || platform === 'all') {
    results.push(writeTarget(
      'cloudrun-job.yaml',
      generateCloudRunJobYaml(options),
      'Cloud Run Job definition for isolated DB migrations'
    ));
    results.push(writeTarget(
      'deploy-cloudrun-migration.sh',
      generateCloudRunJobScript(options),
      'Deployment & execution script for Cloud Run migration job'
    ));
  }

  // AWS ECS Fargate
  if (platform === 'aws' || platform === 'all') {
    results.push(writeTarget(
      'ecs-migration-task.json',
      generateEcsMigrationTaskJson(options),
      'AWS ECS Fargate Task definition for migration runner'
    ));
    results.push(writeTarget(
      'deploy-aws-migration.sh',
      generateAwsMigrationScript(options),
      'AWS ECS run-task script with execution wait loop'
    ));
  }

  // Kubernetes
  if (platform === 'k8s' || platform === 'kubernetes' || platform === 'all') {
    results.push(writeTarget(
      'k8s/migration-job.yaml',
      generateK8sMigrationJobYaml(options),
      'Kubernetes batch/v1 migration Job with Helm pre-upgrade hooks'
    ));
  }

  return results;
}

function registerCommand(program) {
  program
    .command('add:migration-job')
    .description('Scaffold zero-downtime database migration jobs for Google Cloud Run, AWS ECS, or Kubernetes')
    .option('-p, --platform <platform>', 'Target platform: cloudrun, aws, k8s, or all', 'cloudrun')
    .option('-a, --app <name>', 'Application name', 'webspresso-app')
    .option('-r, --region <region>', 'Cloud region (e.g. us-central1 or us-east-1)')
    .option('--cloudsql <instance>', 'Cloud SQL instance connection string (GCP)')
    .option('-f, --force', 'Overwrite existing files')
    .action((opts) => {
      console.log(`\n⚡ Scaffolding Database Migration Job for [${opts.platform}]...`);
      const files = runAddMigrationJob(process.cwd(), opts);

      for (const f of files) {
        if (f.skipped) {
          console.log(`  ○ Skipped (already exists): ${path.relative(process.cwd(), f.path)}`);
        } else {
          console.log(`  ✓ Created: ${path.relative(process.cwd(), f.path)} (${f.description})`);
        }
      }

      console.log('\n🚀 Next steps:');
      if (opts.platform === 'cloudrun' || opts.platform === 'all') {
        console.log('  • Cloud Run: Execute `./deploy-cloudrun-migration.sh <image_tag>` before web service deployment.');
      }
      if (opts.platform === 'aws' || opts.platform === 'all') {
        console.log('  • AWS: Register task def `aws ecs register-task-definition --cli-input-json file://ecs-migration-task.json`');
      }
      console.log('  • CI/CD: Integrate the migration step into your deployment pipeline to guarantee zero-downtime rollout.\n');
    });
}

module.exports = {
  generateCloudRunJobYaml,
  generateCloudRunJobScript,
  generateEcsMigrationTaskJson,
  generateAwsMigrationScript,
  generateK8sMigrationJobYaml,
  runAddMigrationJob,
  registerCommand,
};

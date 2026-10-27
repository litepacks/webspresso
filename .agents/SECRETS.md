# Cloud Secrets Management Guide (`core/secrets` & `secrets:pull`)

Webspresso features an enterprise, built-in Cloud Secrets Management system (`core/secrets`) designed to eliminate plain-text `.env` files and secret leakage in containerized and serverless environments (Google Cloud Run, AWS App Runner, ECS Fargate, Kubernetes).

---

## 🎯 Key Capabilities

1. **Native Cloud Integrations**:
   - Interacts directly with cloud vault REST APIs using native Node.js standard libraries (`https`, `crypto`).
   - **Google Cloud Secret Manager**: Automatically acquires OAuth2 tokens from the local GCP Metadata Server in Cloud Run/GKE, exchanges RSA-SHA256 signed JWTs from `GOOGLE_APPLICATION_CREDENTIALS`, or uses static tokens.
   - **AWS Secrets Manager & SSM Parameter Store**: Employs an embedded, standards-compliant AWS Signature Version 4 (SigV4) signer with HMAC-SHA256.
2. **In-Memory Caching with TTL & Invalidation**:
   - Caches secret values in RAM with a configurable TTL (default: 5 minutes) to avoid redundant HTTP roundtrips.
   - Supports single secret cache busting (`secrets.invalidate(name)`) and full cache clearing (`secrets.clearCache()`) for automated secret rotation.
3. **JSON Secret Bundle Unpacking & Dot-Notation Subkeys**:
   - Access specific fields within JSON bundles using dot-notation:
     `await secrets.get('prod/app/config.DATABASE_URL')`
   - Unpack entire JSON bundles into `process.env`:
     `await secrets.loadBundle('prod/app/config')`
4. **Local Developer Synchronization (`webspresso secrets:pull`)**:
   - Pulls secrets from Google Cloud or AWS into a local `.env.local` file for local development without committing credentials to Git.

---

## 🚀 Usage in Application Bootstrap

### 1. Hydrating Environment at Application Boot

Call `loadSecrets()` before initializing your database or server:

```javascript
// server.js
const { createApp, loadSecrets } = require('webspresso');

async function start() {
  // Load secrets from Google Cloud Secret Manager or AWS before bootstrapping
  await loadSecrets({
    provider: 'auto', // 'cloudrun' | 'gcp' | 'aws' | 'auto'
    secrets: {
      SESSION_SECRET: 'session-secret:latest',
      DATABASE_URL: 'rds-database-url:latest',
    },
    // Or unpack a single JSON bundle holding all config:
    // bundle: 'prod/webspresso/app-secrets',
  });

  const app = createApp({
    server: { port: process.env.PORT || 3000 },
  });

  await app.listen();
}

start();
```

---

## 🛠️ Standalone `SecretManager` Usage

```javascript
const { createSecretManager } = require('webspresso/core/secrets');

const secrets = createSecretManager({
  provider: 'auto',   // Auto-detects GCP or AWS based on environment markers
  cacheTtl: '10m',    // 10 minutes cache TTL
  projectId: 'my-gcp-project', // optional for GCP
  region: 'us-east-1',         // optional for AWS
});

// 1. Fetch a single secret
const apiKey = await secrets.get('STRIPE_SECRET_KEY');

// 2. Fetch with fallback or enforce required
const optionalToken = await secrets.get('SLACK_WEBHOOK', { fallback: null });
const mustExist = await secrets.get('APP_KEY', { required: true });

// 3. Dot-notation subkey access inside JSON secret bundles
const dbPassword = await secrets.get('prod/database.password');

// 4. Invalidate cache on rotation
secrets.invalidate('STRIPE_SECRET_KEY');
```

---

## 💻 CLI Synchronization Tool (`secrets:pull`)

Pulls cloud secrets into `.env.local` for local development:

```bash
# Auto-detect cloud platform and pull expected secrets into .env.local
npx webspresso secrets:pull

# Explicitly pull from Google Cloud Run / Secret Manager
npx webspresso secrets:pull --platform cloudrun -s SESSION_SECRET DATABASE_URL

# Explicitly pull from AWS Secrets Manager
npx webspresso secrets:pull --platform aws -s SESSION_SECRET DATABASE_URL

# Unpack a JSON bundle to stdout (dry run)
npx webspresso secrets:pull --bundle prod/app/config --dry-run

# Output as JSON
npx webspresso secrets:pull -s API_KEY DB_PASS --format json -o secrets.json
```

---

## 🔒 Security Best Practices

1. **Never commit `.env` or `.env.local`**: Ensure `.env.local` is listed in `.gitignore` and `.gcloudignore`.
2. **Minimal IAM Permissions**:
   - GCP: Grant the Cloud Run service account `roles/secretmanager.secretAccessor`.
   - AWS: Grant the ECS Task role `secretsmanager:GetSecretValue` and `ssm:GetParameter`.
3. **Use Short TTL for Rotating Secrets**: If secrets rotate frequently (e.g. daily), configure `cacheTtl: '15m'` or invalidate on rotation webhook triggers.

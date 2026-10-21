# Webspresso CLI Tooling & Commands Reference

The `webspresso` CLI utility (`bin/cli.js`) provides development commands for running local SSR servers, executing database migrations, analyzing project health, and generating favicons.

---

## 1. Development & Build Commands

```bash
# Start local development server with hot reloading
npx webspresso dev
# Flags:
#   --port, -p <number> (default: 3001)
#   --host <string> (default: localhost)

# Build production bundle / compile assets (Tailwind + esbuild with manifest.json)
npx webspresso build
# Flags:
#   --no-css    (skip CSS build)
#   --no-js     (skip JS bundle build)
#   --no-hash   (disable content hashing in filenames)
```

---

## 2. Project Health & Sanity Check (`doctor`)

Scans routing structure, model definitions, and dynamic sibling collisions:

```bash
npx webspresso doctor

# Strict mode: exits with status 1 if warnings are found
npx webspresso doctor --strict
```

Checks performed:
- Dynamic sibling collisions (e.g. `pages/[id].njk` vs `pages/[slug].njk`).
- Naming conventions and lowercase file-based route paths.
- Missing model schemas or invalid `zdb` column definitions.

---

## 3. Database Commands (`db:migrate`, `db:seed`)

```bash
# Run pending Knex database migrations
npx webspresso db:migrate

# Seed database records
npx webspresso db:seed

# Scaffold initial seed files
npx webspresso db:seed --setup
```

---

## 4. Favicon Generator (`favicon:generate`)

Generates multi-resolution browser favicons, `manifest.json`, and `favicons.njk` partial from a PNG logo:

```bash
npx webspresso favicon:generate logo.png

# Flags:
#   --theme-color <hex> (default: #ffffff)
#   --output-dir <path> (default: public)
#   --no-layout (do not modify layout.njk auto-include)
```

---

## 5. Polar Billing Migration (`polar:migrate`)

Generates an idempotent Knex migration adding Polar billing columns to the user table:

```bash
npx webspresso polar:migrate

# Flags:
#   -c, --config <path>   Database config file
#   -t, --table <name>    User table (default: users)
#   -o, --output <path>   Custom migration output path
```

Then run `npx webspresso db:migrate`. See [docs/guides/polar-production-checklist.md](../docs/guides/polar-production-checklist.md).

---

## 6. Interactive Service Runner (`service`, `service:run`)

Test and run services interactively without starting the HTTP server:

```bash
# Interactive selection & prompt mode
npx webspresso service

# Run specific service with JSON payload
npx webspresso service user.get -i '{"id": 42}'

# Run with key=value query string
npx webspresso service payment.refund -i 'transactionId=tx_123 amount=49.99'
```

---

## 7. AI Agent Guidelines Scaffolder (`agents:init`)

Scaffolds and synchronizes AI coding agent rules into any Webspresso project:

```bash
# Scaffold full guidelines bundle (.agents/, AGENTS.md, CLAUDE.md, .cursorrules)
npx webspresso agents:init

# Overwrite existing guidelines
npx webspresso agents:init --force
```

---

## 8. Tailwind CSS Setup & Migration (`add:tailwind`)

Add or upgrade Tailwind CSS in a project:

```bash
# Add Tailwind CSS v4 (Oxide engine, LightningCSS, zero-config)
npx webspresso add tailwind --v4

# Add Tailwind CSS v3 (legacy PostCSS engine)
npx webspresso add tailwind --v3

# Upgrade existing Tailwind v3 project to v4
npx webspresso add tailwind --upgrade
```

---

## 9. Client Bundler Setup (`add:esbuild`)

Add client-side JS/TS bundling with esbuild incremental watching:

```bash
# Scaffold esbuild client bundler setup
npx webspresso add esbuild
# or
npx webspresso add:esbuild
```

---

## 10. Data Retention & Storage Cleanup Commands

Keep databases and storage clean by pruning historical records and unreferenced files:

```bash
# Delete audit log entries older than N days (default: 90)
npx webspresso audit:prune --days 90

# Delete email delivery logs older than N days (default: 90)
npx webspresso email:prune --days 90

# Delete completed/failed background jobs older than N days (default: 30)
npx webspresso queue:prune --days 30

# Delete expired site analytics visits & JS errors older than N days
npx webspresso analytics:prune --days 90

# Scan and delete orphaned uploads not referenced by any database model
npx webspresso upload:prune

# Dry run mode (inspect orphaned files without deleting)
npx webspresso upload:prune --dry-run
```

---

## 11. Routes Introspection (`routes`)

List and inspect all compiled file-based and API routes in terminal:

```bash
# List all application routes in a colorized table
npx webspresso routes

# Filter to only API endpoints
npx webspresso routes --api

# Filter to only SSR page routes
npx webspresso routes --pages

# Output routes as machine-readable JSON
npx webspresso routes --json
```

---

## 12. Dev Server DX & Query Profiler

When starting in development mode (`isDev: true` / `process.env.NODE_ENV !== 'production'`), Webspresso automatically:

- **Displays Startup Banner**: ASCII box with Node/Framework version, Local & Admin URLs, Database dialect, and counts of routes, models, services, and plugins.
- **Request Profiler & Logger**: Color-coded HTTP requests with status, response duration, and database metrics:
  ```text
  [GET 200] /api/notes — 14.2ms | 2 DB queries (2.8ms)
  ```
- **N+1 Query Detection**: Flags queries executing repeatedly against the same table within a single request:
  ```text
  ⚠️  [webspresso:n+1] Potential N+1 query pattern detected on table 'users' (5 queries, 6.4ms). Consider eager loading with repo.query().include('users') or batching.
  ```
- **Configuration (`dev` options in `createApp`)**:
  ```javascript
  createApp({
    dev: {
      banner: true,        // show startup banner (default: true in dev)
      routeTable: true,    // show route table in banner (default: true)
      profiler: true,      // enable request & DB profiler (default: true)
      nPlusOne: true,      // detect N+1 queries (default: true)
      nPlusOneThreshold: 4,// query count threshold for warning (default: 4)
      slowQueryMs: 50,     // flag queries slower than N ms (default: 50)
      verbose: false,      // log individual SQL statements
    }
  });
  ```

---

## 13. Scaffolding & Code Generation (`make:*` Commands)

Quickly generate boilerplate adhering strictly to Webspresso contracts:

```bash
# 1. Scaffold an ORM Model in models/<Name>.js with parsed zdb fields and Knex migration
npx webspresso make:model Post --fields title:string,content:text,published:boolean,views:integer --migration
# Flags:
#   --fields <list>   (title:string,content:text,views:integer,price:number,published:boolean,authorId:id)
#   --table <name>    (custom table name; defaults to pluralized lowercase)
#   --migration, -m   (auto-generate timestamped Knex migration in migrations/)
#   --soft-deletes    (include deletedAt column and default scope)

# 2. Scaffold API Endpoints in pages/api/
# Single endpoint with Zod validation and handler:
npx webspresso make:api notes/export --method POST --auth

# Full REST CRUD Suite (list, create, detail, update, delete) in pages/api/posts:
npx webspresso make:api posts --crud --model Post

# 3. Scaffold an SSR Page in pages/
npx webspresso make:page blog/[slug]
# Generates pages/blog/[slug].njk template + companion loader pages/blog/[slug].js

# 4. Scaffold a Service in services/<domain>/<action>.js
npx webspresso make:service order.process --transaction --auth admin

# 5. Scaffold a Background Queue Worker in jobs/<name>.js
npx webspresso make:job send-welcome-email --queue default --retries 3
```

---

## 14. OpenAPI & API Documentation Export (`openapi` / `api:docs`)

Generate and export standard OpenAPI 3.0 JSON specification from file-based API routes and Zod schemas:

```bash
# Print OpenAPI 3.0 specification to stdout
npx webspresso openapi

# Export directly to a JSON file
npx webspresso openapi --out openapi.json

# Export with custom title, version, and server URL
npx webspresso api:docs --out public/openapi.json --title "My API" --api-version "2.0.0" --server "https://api.myapp.com"

# Include ORM model schemas in components.schemas
npx webspresso openapi --out openapi.json --include-orm
```

---

## 15. TypeScript Definitions & IDE Auto-Complete Generator (`typegen` / `types`)

Scan ORM models, business services, and routes to automatically generate typed TypeScript declaration files (`.webspresso/types.d.ts` and `webspresso-env.d.ts`) with module augmentation:

```bash
# Generate TypeScript definitions
npx webspresso typegen

# Aliases
npx webspresso types
npx webspresso generate:types

# Watch mode (automatically regenerates on model/service/page edits)
npx webspresso typegen --watch

# Custom output destination
npx webspresso typegen --out types/webspresso.d.ts --no-env-file
```

### Generated Capabilities & IDE DX:
- **Typed Models (`db.getRepository('Model')`)**: Auto-completes model names and infers entity column types from Zod schemas.
- **Typed Services (`req.service('name', input)`)**: Auto-completes registered service names and enforces validated input payloads.
- **Typed Route Table (`AppRoute`, `AppRoutePath`)**: Union types for all discovered SSR and API routes.

---

## 16. Containerization & Docker Setup (`add:docker` / `docker`)

Generate production-ready, security-hardened, multi-stage `Dockerfile`, `.dockerignore`, and `docker-compose.yml`:

```bash
# Generate Dockerfile, .dockerignore, and docker-compose.yml
npx webspresso add:docker

# Customize Node.js version, database service, or container port
npx webspresso add:docker --node 22-alpine --db postgres --redis --port 7331

# Overwrite existing files
npx webspresso add:docker --force
```

### Generated Artifacts:
- **Multi-Stage `Dockerfile`**:
  - `deps` stage: caches production dependencies with native build tools (`python3`, `make`, `g++`).
  - `builder` stage: runs asset build scripts (`npm run build`).
  - `runner` stage: runs as unprivileged user `webspresso` (UID 1001), health check with `/health` and `/healthz`, and `SIGTERM` signal handling.
- **`.dockerignore`**: Excludes `node_modules`, `.env`, local `.sqlite` databases, test files, and git metadata while preserving upload directories.
- **`docker-compose.yml`**: Configures app container with persistent upload volumes, database services (PostgreSQL, MySQL, or SQLite), and optional Redis.
- **`package.json` Scripts**: Adds `docker:build`, `docker:run`, `docker:up`, and `docker:down`.

---

## 17. Production Deployment Preflight Check (`deploy:check` / `check:deploy`)

Run comprehensive pre-flight verification before deploying to Google Cloud Run, AWS (App Runner / ECS), Cloudflare Workers, Fly.io, Railway, Render, VPS, or Kubernetes:

```bash
# Run production preflight verification (auto-detects target platform)
npx webspresso deploy:check

# Target a specific cloud platform explicitly (cloudrun, aws, cloudflare, docker)
npx webspresso deploy:check --platform cloudrun
npx webspresso deploy:check --platform aws
npx webspresso deploy:check -p cloudflare

# Run against a specific environment (.env.staging or .env.production)
npx webspresso deploy:check --env staging

# Strict mode: fail with exit code 1 on warnings as well as errors (ideal for CI/CD)
npx webspresso deploy:check --strict

# Machine-readable JSON output for automated deployment pipelines
npx webspresso deploy:check --json
```

### Audited Verification Areas:
1. **Platform-Specific Cloud Preflight**:
   - **Google Cloud Run**: Ephemeral SQLite/local upload warnings, SIGTERM timeout alignment (<= 10000ms), `.gcloudignore` secrets exclusion (`.env`), `cloudbuild.yaml` pipeline, and dynamic `PORT` binding.
   - **AWS (App Runner / ECS Fargate)**: Ephemeral storage audits, `apprunner.yaml` / `ecs-task-definition.json` validity, and CloudWatch `awslogs` log driver configuration.
   - **Cloudflare Workers**: `wrangler.toml` configuration and `nodejs_compat` compatibility flag verification.
   - **Stateless Scale-Out**: Distributed Redis sessions and serverless connection pool limits.
2. **Secrets & Cryptography**: Ensures `SESSION_SECRET` or `APP_KEY` is set, >= 32 characters, and not using weak placeholder defaults.
3. **Git & Leak Prevention**: Verifies `.env` and local database files are excluded in `.gitignore`.
4. **Container Hardening**: Ensures `Dockerfile` runs as a non-root `USER`, configures a `HEALTHCHECK`, and uses multi-stage caching.
5. **Database & Migrations**: Audits for pending unapplied migrations and warns against ephemeral SQLite storage.
6. **Server Optimizations**: Validates HTTP compression (`compression: true`), graceful shutdown, and health check endpoints.
7. **Actionable Remediations**: Emits precise, single-command remediation steps for every warning and error detected.

---

## 18. Custom Management Commands (`run`, `command:run`, `defineCommand`) [Django manage.py & Adonis Ace]

Create and execute isolated management scripts, background cron tasks, data migrations, or maintenance routines with full framework dependency injection (`db`, `queue`, `services`, `mailer`, `events`, `logger`, `args`, `flags`):

```bash
# List all custom management commands in commands/
npx webspresso run

# Execute a custom command with positional arguments and options
npx webspresso run sync-stripe --dry-run --limit 100
```

### Defining a Custom Command (`commands/<name>.js`):

```javascript
const { defineCommand } = require('webspresso');

module.exports = defineCommand({
  name: 'sync-stripe',
  description: 'Synchronize customer subscriptions from Stripe',
  options: [
    { flags: '-d, --dry-run', description: 'Simulate without committing changes', defaultValue: false },
    { flags: '-l, --limit <count>', description: 'Maximum customers to sync', defaultValue: 100 },
  ],
  handle: async ({ db, queue, services, mailer, events, logger, args, flags }) => {
    logger.log('Starting sync, dryRun:', flags.dryRun);

    const userRepo = db.getRepository('User');
    const users = await userRepo.find({ active: true });

    // Events, mailer, and background jobs are fully accessible:
    events.emit('stripe:sync-started', { count: users.length });

    return { synced: users.length };
  },
});
```

---

## 19. Command Palette Index (`list`, `commands`)

Print an organized catalog of all built-in commands (scaffolding, database, server, developer tools) alongside all auto-discovered custom commands in your project:

```bash
npx webspresso list
# or
npx webspresso commands
```

---

## 20. Advanced Scaffolding Generators (`make:*`) [Adonis Ace style]

Rapidly generate boilerplate code following Webspresso architectural conventions:

```bash
# 1. Custom Management Command
npx webspresso make:command users:cleanup --desc "Purge unverified user accounts"
# Outputs: commands/users/cleanup.js

# 2. Authorization Policy (Bouncer)
npx webspresso make:policy Article
# Outputs: policies/article.policy.js

# 3. Model Factory (Testing & Seeding)
npx webspresso make:factory Product
# Outputs: factories/product.factory.js

# 4. Decoupled Event Listener
npx webspresso make:event order:completed
# Outputs: listeners/order-completed.js

# 5. Declarative Mailable Class
npx webspresso make:mail Welcome
# Outputs: emails/WelcomeEmail.js
```

---

## 21. Google Cloud Run Deployment (`add:cloudrun` / `cloudrun`)

Generate production-ready Google Cloud Run configuration with Google Cloud Build CI/CD pipeline, `.gcloudignore`, and one-command deployment script:

```bash
# Generate cloudbuild.yaml, .gcloudignore, deploy-cloudrun.sh, and Dockerfile
npx webspresso add:cloudrun

# Customize region, container resources, scaling limits, and Cloud SQL
npx webspresso add:cloudrun --region europe-west1 --memory 1Gi --cpu 2 --min-instances 1 --max-instances 20 --cloud-sql my-project:europe-west1:my-db

# Overwrite existing files
npx webspresso add:cloudrun --force
```

### Generated Artifacts:
- **`cloudbuild.yaml`**: Multi-stage Docker image build, Google Artifact Registry push, and zero-downtime serverless Cloud Run deployment with Gen2 execution environment.
- **`.gcloudignore`**: Prevents `.env`, SQLite files, node_modules, and test directories from entering the Cloud Build upload context.
- **`deploy-cloudrun.sh`**: Executable bash script for direct zero-friction deployment (`chmod +x`).
- **`package.json` Scripts**: Adds `gcp:deploy` and `gcp:build`.

---

## 22. AWS App Runner & ECS Fargate Deployment (`add:aws` / `aws`)

Generate production-ready AWS deployment configuration supporting both AWS App Runner and Amazon ECS (Fargate):

```bash
# Generate apprunner.yaml, ecs-task-definition.json, deploy-aws.sh, and Dockerfile
npx webspresso add:aws

# Customize region, CPU, and memory allocations
npx webspresso add:aws --region us-east-1 --cpu "1 vCPU" --memory "2 GB"

# Overwrite existing files
npx webspresso add:aws --force
```

### Generated Artifacts:
- **`apprunner.yaml`**: AWS App Runner configuration with build commands (`npm ci --omit=dev`), start command, and port network mapping.
- **`ecs-task-definition.json`**: Production ECS Fargate task definition with `awsvpc` network mode, container resource constraints, CloudWatch `awslogs`, and native `/healthz` health checks.
- **`deploy-aws.sh`**: Automated deployment shell script that verifies AWS credentials, creates Amazon ECR repositories, builds and pushes Docker images, and updates services.
- **`package.json` Scripts**: Adds `aws:deploy`.

---

## 23. Cloudflare Workers Deployment (`add:cloudflare` / `cloudflare`)

Generate serverless edge deployment files for Cloudflare Workers with D1, KV, and Queues support:

```bash
# Generate wrangler.toml and worker.js
npx webspresso add:cloudflare

# Include Cloudflare D1, KV, and Queues
npx webspresso add:cloudflare --d1 --kv --queue
```

---

## 24. Cloud Static Asset Sync (`assets:sync` / `assets-sync`)

Upload and synchronize compiled static assets (`public/assets/`, `dist/`, fonts, images) to S3, Cloudflare R2, or Google Cloud Storage with immutable CDN cache headers:

```bash
# Preview files to be uploaded without transmitting data
npx webspresso assets:sync --dry-run

# Sync assets to an AWS S3 bucket
npx webspresso assets:sync --bucket my-cdn-bucket --provider s3

# Sync assets to Google Cloud Storage
npx webspresso assets:sync --bucket my-gcs-bucket --provider gcs --prefix assets

# Override directory or custom Cache-Control header
npx webspresso assets:sync --dir public --cache-control "public, max-age=604800"
```

---

## 25. Cloud Secrets Synchronization (`secrets:pull` / `pull:secrets`)

Pull cloud secrets from Google Cloud Secret Manager or AWS Secrets Manager into a local `.env.local` file for secure local development:

```bash
# Auto-detect cloud platform and pull expected secrets
npx webspresso secrets:pull

# Explicitly pull specific secrets from Google Cloud Secret Manager
npx webspresso secrets:pull --platform cloudrun -s SESSION_SECRET DATABASE_URL

# Explicitly pull from AWS Secrets Manager
npx webspresso secrets:pull --platform aws -s SESSION_SECRET DATABASE_URL

# Unpack a JSON secret bundle to stdout (dry run)
npx webspresso secrets:pull --bundle prod/app/config --dry-run

# Output secrets in JSON format
npx webspresso secrets:pull -s API_KEY DB_PASS --format json -o secrets.json
```

---

## 26. Zero-Secret CI/CD Pipeline Generator (`add:ci` / `add:workflow`)

Scaffold automated, keyless GitHub Actions workflows (Google WIF, AWS IAM OIDC, Cloudflare) and GitLab CI pipelines with integrated test suites and `webspresso deploy:check --strict` gating:

```bash
# Auto-detect cloud platform and scaffold GitHub Actions workflows
npx webspresso add:ci

# Explicitly target Google Cloud Run (Workload Identity Federation)
npx webspresso add:ci --platform cloudrun

# Explicitly target AWS (IAM OIDC Role & Amazon ECR)
npx webspresso add:ci --platform aws

# Explicitly target Cloudflare Workers
npx webspresso add:ci --platform cloudflare

# Scaffold all cloud workflows alongside a GitLab CI pipeline (.gitlab-ci.yml)
npx webspresso add:ci --platform all --gitlab
```

---

## 27. Type-Safe Frontend Client Generator (`client:generate` / `client:gen`)

Generate an end-to-end typed TypeScript HTTP client from your Webspresso API routes and Zod schemas for React, Next.js, Vite, Vue, Svelte, or mobile apps:

```bash
# Generate client into src/client.ts (or .webspresso/client.ts)
npx webspresso client:generate

# Specify custom output path and base URL
npx webspresso client:generate --out src/api-client.ts --base-url https://api.myapp.com
```

---

## 28. DB Studio Live Telemetry & SQL Runner (`db:studio`)

Launch an interactive database inspector, SQL query runner, and real-time system monitoring dashboard:

```bash
# Launch DB Studio on default port 4567
npx webspresso db:studio

# Custom port without opening default browser
npx webspresso db:studio --port 5000 --no-open
```
- Schema inspection & CRUD operations for all database tables.
- Real-time SSE Live Telemetry streaming Node.js memory metrics (RSS, Heap), Knex connection pool utilization, background queues, and circuit breaker trip states.
- Interactive Circuit Breaker manual reset (`POST /_studio/api/breakers/:name/reset`).

---

## 29. Interactive REPL Console (`console` / `c`)

Launch an interactive Node.js REPL session with auto-injected framework context (database, repositories, services, queues, events, feature flags, and cache):

```bash
# Start interactive console
npx webspresso console
# Alias:
npx webspresso c

# Evaluate a single expression and print output (with top-level await support)
npx webspresso console -e "await Note.find({ status: 'published' })"

# Target specific environment or config file
npx webspresso console -E production -c config/db.js

# Disable command history persistence or banner
npx webspresso console --no-history --no-banner
```

### Context & Shortcuts Injected:
- `db`: Knex / ORM database instance.
- `<ModelName>` (e.g. `Note`, `User`): Direct repository shortcuts (`await Note.find()`, `await Note.findById(1)`).
- `models`: Dictionary of all loaded model repositories (`models.Note`).
- `services`: ServiceRegistry instance.
- `service(name, input)`: Direct helper to invoke domain services (`await service('notes.create', payload)`).
- `queue`: Background QueueDispatcher (`await queue.dispatch('email.send', data)`).
- `events`: Decoupled EventDispatcher (`events.emit('order.created', order)`).
- `flags`: FeatureFlagManager (`flags.isEnabled('new_checkout', { user })`).
- `cache`: TaggedLruCache instance (`await cache.get('key')`).
- `mailer`: Framework mailer service.
- `reload()`: Hot-reloads all models and services from filesystem without exiting the REPL.
- `help()`: Displays interactive help menu with all available objects and commands.

### Custom REPL Dot-Commands:
- `.models`: List all loaded models, table names, and available repository methods.
- `.services`: List all registered business services and descriptions.
- `.routes`: Scan and list all API endpoints and SSR pages.
- `.flags`: List active feature flags and targeting rules.
- `.reload`: Hot-reload models and services from filesystem.
- `.exit`: Exit the console session (`Ctrl+D`).


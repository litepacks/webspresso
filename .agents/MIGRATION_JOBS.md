# Cloud Migration Jobs & Zero-Downtime Database Deploy Guide

Webspresso provides an enterprise, zero-downtime database migration architecture designed specifically for Google Cloud Run, AWS ECS Fargate, AWS App Runner, and Kubernetes.

---

## 🎯 The Cloud Migration Challenge

In containerized, autoscaling cloud platforms (such as Google Cloud Run or AWS ECS), running migrations inside the web application container startup command (`CMD ["node", "server.js"]`) causes severe production risks:

1. **Concurrent Migration Race Conditions**: If a new revision autoscales to multiple container instances, multiple containers attempt to run migrations simultaneously, causing deadlock or corrupt schema states.
2. **Crash Loops & Downtime**: If a migration script fails, web containers fail health checks and crash-loop, but HTTP traffic might already hit partially-migrated schemas.
3. **Stale Lock Hangs**: If a container is forcefully terminated by Cloud Run or ECS during migration, Knex's `knex_migrations_lock` table is left locked (`Migration table is already locked`), breaking all subsequent CI/CD deployments.

### The Webspresso Solution: Dedicated Pre-Deploy Cloud Migration Jobs

Webspresso solves this by separating database schema migrations into a single, isolated pre-deploy job that runs to completion before new web service revisions receive traffic:

```
[ Git Push / CI/CD ]
         │
         ▼
[ Build Container Image ]
         │
         ▼
[ Run Cloud Migration Job ] ──── (Fails? Stop deployment, keep old web version running)
         │ (Success)
         ▼
[ Deploy Web Service Revision ] ─── (Safely route 100% traffic to new code)
```

---

## 🚀 CLI Commands

### 1. Scaffold Migration Jobs (`add:migration-job`)

```bash
# For Google Cloud Run (cloudrun-job.yaml + deploy-cloudrun-migration.sh)
npx webspresso add:migration-job --platform cloudrun --app my-app --cloudsql "project:region:instance"

# For AWS ECS Fargate & App Runner (ecs-migration-task.json + deploy-aws-migration.sh)
npx webspresso add:migration-job --platform aws --app my-app --region us-east-1

# For Kubernetes / Helm (k8s/migration-job.yaml with pre-upgrade hooks)
npx webspresso add:migration-job --platform k8s --app my-app

# For all platforms
npx webspresso add:migration-job --platform all
```

---

## ⚡ Cloud-Safe Migration Options (`db:migrate`)

Webspresso's `db:migrate` command features cloud resilience flags powered by `core/orm/migrate-cloud.js`:

```bash
# Cloud-Safe mode: exponential backoff connection retries + automatic stale lock auto-healing
npx webspresso db:migrate --safe --env production

# Dry-run: preview pending migrations without altering the database
npx webspresso db:migrate --dry-run --env production

# Auto-heal hanging locks left by aborted serverless jobs
npx webspresso db:migrate --unlock-if-stale

# Force unlock migration table immediately
npx webspresso db:migrate --force-unlock
```

---

## 🛡️ Zero-Downtime Migration Rules for Schema Evolution

When modifying production schemas under zero-downtime requirements, follow the **Expand and Contract (Parallel Run)** pattern:

| Goal | ❌ Risky (Breaks running old version) | ✅ Zero-Downtime Pattern |
| :--- | :--- | :--- |
| **Rename Column** | `table.renameColumn('old', 'new')` | 1. Add `new` column<br>2. Dual-write in application<br>3. Backfill data<br>4. Drop `old` column in subsequent deploy |
| **Drop Column** | `table.dropColumn('field')` | Remove column references in application code first, deploy code, then drop column in the next deployment. |
| **Add NOT NULL** | `table.string('col').notNullable()` | 1. Add nullable column or column with default value<br>2. Backfill existing rows<br>3. Alter to `notNullable` |
| **Add Index** | Raw `CREATE INDEX` (locks table) | In Postgres: use `CREATE INDEX CONCURRENTLY` |

---

## 🔍 Preflight Verification (`deploy:check`)

Webspresso's preflight scanner automatically audits migration strategies:

```bash
npx webspresso deploy:check --platform cloudrun --strict
```

If migrations exist and no cloud migration job is detected, it emits an actionable warning to prevent production container race conditions.

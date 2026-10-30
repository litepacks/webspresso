# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **ORM relations accept model name strings**: `relations: { user: { type: 'belongsTo', model: 'User', foreignKey: 'userId' } }` (as typed in `index.d.ts` and shown in the README) no longer throws; string references are resolved lazily, with a clear error for unknown models.
- **`query().paginate({ page, limit })`**: The object form documented in `AGENTS.md` / `.agents/ORM.md` was silently ignored (always page 1, 15 rows). `paginate()` now accepts `{ page, perPage }` / `{ page, limit }` alongside the positional form.
- **CLI `add` commands**: `webspresso add esbuild` ran the Tailwind handler and `webspresso add:tailwind` failed with a missing-argument error. Both `add <integration>` and `add:<integration>` forms now route correctly.

### Docs
- Added the missing `LICENSE` file referenced by the README.
- Corrected the ORM guide pagination example, realtime and dependency-policy wording, plugin count, and dev boot-time claims.

## [0.0.108] - 2026-10-24

### Added
- **Ambient Context & Composable Hooks (`core/context/`)**:
  - Implemented zero-dependency execution context powered by `AsyncLocalStorage` (`app-context.js`, `request.js`).
  - Added composable hooks: `useContext`, `useDb`, `useAuth`, `useUser`, `useService`, `useLogger`, `useReq`, `useRes`, `useParams`, `useQuery`, `useTransaction`, and `withContext` to eliminate prop-drilling across loaders, services, models, and workers.
- **Dedicated Core Validation Module (`core/validation/`)**:
  - Modularized schema compilation, application, and caching into `core/validation/compiler.js`, `core/validation/apply.js`, and `core/validation/cache.js`.
  - Added unified `validation` export on framework root.

### Changed
- **Core Architecture Modularization (`core/services/`, `core/plugins/`)**:
  - Migrated services architecture, discovery, loader, memoization, executor, validator, and built-ins (`auth`, `exchange`, `file-manager`, `mail`, `media`, `system`) into `core/services/`.
  - Migrated `PluginManager` into `core/plugins/plugin-manager.js` for clean separation from legacy source paths.
  - Aligned root export properties and unified `z` / `zdb` schemas.
- **CI Test Suite & Worker Fork Stability (`vitest.config.mjs`)**:
  - Capped `maxForks` to prevent worker starvation and process initialization timeouts under high V8 coverage concurrency.
  - Adjusted test liveness probe tolerance under full-suite CPU loads in `tests/integration/real-world-app.test.js`.

### Fixed
- **Decoupled Events & Error Routing (`core/events/dispatcher.js`)**:
  - Fixed error propagation in `EventDispatcher` by routing listener exceptions to `this.emit('error', ...)` instead of unhandled superclass emitter.
- **SSR Streaming Defense (`core/ssr/stream.js`)**:
  - Hardened error handling in `renderStream` with defensive checks for `res.status`, `res.send`, `res.end`, and `res.statusCode` across diverse server response environments.
  - Handled `AbortError` and race conditions gracefully in streaming scenarios.
- **Queue Manager Idle Race Condition (`tests/unit/queue/queue-manager.test.js`)**:
  - Fixed idle event assertion race by awaiting queue idle event directly.
- **HTTP Pipeline Synchronous Render Fallback (`core/http/pipeline.js`, `tests/unit/core/http-pipeline.test.js`)**:
  - Supported synchronous 2-argument render calls alongside asynchronous 3-argument callbacks.

## [0.0.107] - 2026-10-23

### Added
- **Core Services Architecture Enhancements (`core/services/`)**:
  - Established dedicated `core/services` entrypoint and subpath export in `package.json`.
  - Added native ESM dynamic import support and lazy on-demand service loader (`async registry`).
  - Added service middleware pipeline, lifecycle hooks (`before`, `after`, `onError`), and event emission.
  - Added tagged cache invalidation and pluggable provider support.
  - Added ambient transaction repository safety, query builder wrapping, and nested `service.call` delegation.
- **Centralized Test Utilities & Harness (`tests/utils/`)**:
  - Added centralized mock builders and lifecycle helpers (`createMockRequest`, `createMockResponse`, `createMockNext`, `createMockSpyRes`, `createMockRepo`, `createMockDb`, `createMockQueryBuilder`, `createTempDir`, `withTempDir`, `createMockServiceContext`, `createMockAdminRegistry`, `createMockPluginContext`).
  - Consolidated duplicate test helpers and mock implementations across the test suite.

### Changed
- **Validation Error HTTP Status Standard (`core/errors/`, `src/services/`)**:
  - Standardized `ValidationError` HTTP status code to `422` (Unprocessable Entity) across the services layer and error boundaries.
  - Enriched validation errors with schema attributes, error codes, and structured issue details.
- **Enhanced Developer Dashboard Dynamic Services Discovery (`plugins/dashboard/`)**:
  - Updated `collectServices` and dashboard API endpoints to resolve dynamic service definitions from the app instance registry (`app.serviceRegistry`).

### Fixed
- **Process Context & Worker Isolation (`src/app-context.js`, `tests/setup.js`)**:
  - Added `resetAppContext()` cleanup in `afterEach` test hook, preventing global shutdown manager and context leakage across parallel Vitest workers.
- **Auth & Session Security & Memory Hardening (`core/auth/`)**:
  - Hardened magic link verification against timing attacks, user enumeration side-channels, and token parameter pollution.
  - Aligned `createKvSessionTracker` with `SessionTracker` interface and enhanced `SessionManager` compatibility.
  - Prevented unique constraint race conditions in `createKnexSessionTracker` under concurrent session insertions.
  - Added bounded LRU eviction and `clearTouchCache` to `SessionManager` to prevent memory leaks.
  - Fixed prototype pollution vulnerabilities in admin-panel filter query parsing.
- **Graceful Shutdown Adapter Concurrency (`core/server/shutdown.js`)**:
  - Bound server adapter force-close grace periods to strictly respect the shared shutdown timeout budget across concurrent adapters.

### Performance
- **ORM & Query Engine Optimizations (`core/orm/`)**:
  - Added bounded LRU caching to `parseRelationTree` and optimized relation loading.
  - Pre-cached soft-delete and timestamp column names to eliminate repetitive Map lookups.
  - Optimized JSON serialization and deserialization with fast-path string checks and cached column definitions.
  - Direct `QueryBuilder` instantiation in `db.query` avoiding redundant repository allocations.
  - Streamlined `create` and `update` queries with direct `RETURNING` clauses to eliminate redundant SELECT roundtrips.
  - Parallelized `paginate` execution and stripped unnecessary `orderBy` and projections from count queries.
- **Authentication Fast-Path (`core/auth/`)**:
  - Optimized `verifyJwt` with fast-path HS256 header decoding, bounded LRU verification cache, and payload size guards.
  - Optimized Redis session tracker with parallel retrieval and bulk deletions.

## [0.0.106] - 2026-10-21

### Added

#### Interactive REPL Console (`core/console/`, `bin/commands/console.js`, `tests/unit/console.test.js`)
- **Rails- & Tinker-Inspired Interactive Terminal Console (`webspresso console` / `webspresso c`)**:
  - Implemented zero-dependency interactive REPL console with auto-injected database (`db`), models (`Note`, `User`), services (`services`, `service()`), queues (`queue`), events (`events`), feature flags (`flags`), and cache (`cache`).
  - **Direct Model Shortcuts**: Auto-binds registered ORM models directly to the REPL context (`await Note.find()`, `await User.findById(1)`).
  - **Custom REPL Dot-Commands**: Added `.models` (inspect tables and schema), `.services` (inspect registered business services), `.routes` (scan and display discovered API and SSR routes), `.flags` (view active feature flags), and `.reload` (hot-reload models and services from filesystem without session restart).
  - **One-Off Expression Evaluator (`-e, --eval`)**: Evaluates JavaScript expressions with top-level await and prints inspected output directly to stdout before graceful connection teardown.
  - **Persistent History**: Auto-configures `.webspresso_history` for persistent cross-session command recall.
  - **Full TypeScript Type Declarations & Testing**: Added complete type contracts (`ConsoleOptions`, `ConsoleContext`, `ConsoleSession`) to `index.d.ts` and verified with 12 automated Vitest unit tests in `tests/unit/console.test.js`.

#### Type-Safe Frontend Client Generator (`src/dev/client-gen.js`, `bin/commands/client-generate.js`, `tests/unit/client-gen.test.js`)
- **End-to-End Type-Safe Client Generator (`webspresso client:generate`)**:
  - Automatically scans API routes (`pages/api/**/*.js`) and translates Zod schemas (`body`, `query`, `params`, `response`) into pure TypeScript interfaces.
  - Generates a standalone, zero-dependency universal fetch client (`createWebspressoClient`) for Next.js, Vite, React, Vue, Svelte, or React Native.
  - Supports recursive Proxy routing (`client.api.notes.get()`, `client.api.notes('123').delete()`), dynamic query serialization, bearer auth token callbacks (`getToken`), and typed error boundaries (`WebspressoClientError`).
  - Verified with 4 unit tests in `tests/unit/client-gen.test.js` and CLI integration.

#### DB Studio Live Telemetry & Queue Monitoring (`core/studio/`, `tests/unit/studio.test.js`)
- **Real-Time Telemetry & Monitoring Subsystem**:
  - Added Server-Sent Events (SSE) stream (`GET /_studio/api/live`) and snapshot endpoint (`GET /_studio/api/telemetry`).
  - Real-time monitoring of Node.js memory metrics (heap used/total, RSS), Knex database pool active/idle connections, background job queues, and circuit breaker trip states.
  - Interactive "Live Telemetry" tab in Studio UI powered by Tailwind 4 and EUIXjs.
  - Remote Circuit Breaker reset capabilities (`POST /_studio/api/breakers/:name/reset`) and Queue controls (`POST /_studio/api/queue/:action`).
  - Verified with comprehensive unit test suite in `tests/unit/studio.test.js`.

#### Feature Flags & Canary Traffic Splitter (`core/flags`, `tests/unit/core-flags.test.js`)
- **Zero-Dependency Feature Flag Engine (`core/flags/`)**:
  - Implemented high-throughput feature flag management and traffic splitting engine with zero external runtime dependencies.
  - **Deterministic FNV-1a Hashing (`getBucket`)**: Computes stable 0-99 percentage buckets for user identifiers across distributed instances without database hits or network overhead.
  - **Comprehensive Targeting Rules**: Supports boolean flags, canary percentage rollouts (`rollout: 25`), user whitelists (`users`), role targeting (`roles`), email domain matching (`emailDomains`), multivariate A/B testing variants (`variants`), and custom conditional predicates (`condition`).
  - **Full-Stack Framework Integration**:
    - **Application Kernel (`createApp({ flags })`)**: Instantiates `app.flags` and mounts universal middleware.
    - **Nunjucks SSR Templates**: Seamless access through `{{ fsy.hasFeature('flag_name') }}` and `{{ fsy.flag('theme') }}`.
    - **API Route Guards (`defineApi({ flag })`)**: Automatically protects endpoints with HTTP 404 (or configured status) if feature is disabled.
    - **Environment Overrides**: Instant zero-downtime flag toggling via `FEATURE_<KEY>=true|false`.
  - **Full TypeScript Type Declarations & Testing**: Added complete type contracts to `index.d.ts` and verified with 22 automated Vitest unit tests in `tests/unit/core-flags.test.js`.

#### Native Zero-Dependency Rate Limiting Engine (`core/rate-limit`, `tests/unit/core-rate-limit.test.js`)
- **Zero-Dependency High-Performance Rate Limiter (`core/rate-limit/`)**:
  - Implemented framework-agnostic rate limiting engine working natively across both Express `(req, res, next)` and modern edge/serverless contexts like Hono `(c, next)`.
  - **Memory Leak-Free Sliding Window Store (`MemoryRateLimitStore`)**: Tracks timestamp hits with sub-millisecond precision, auto-expires stale buckets, and features an unref'd sweep timer preventing process hangs or memory unbounded growth.
  - **Distributed Redis Store (`RedisRateLimitStore`)**: Atomic sliding window rate limiting backed by Redis sorted sets (`ZREMRANGEBYSCORE`, `ZADD`, `ZCARD`, `PEXPIRE`) with fail-open fallback (`passOnStoreError: true`). Supports official `redis`, `ioredis`, or Webspresso's internal `MiniRedisClient`.
  - **RFC 6585 & IETF Draft Compliance**: Automatically emits standard headers (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `RateLimit-Policy`), `Retry-After` on HTTP 429, and optional legacy headers (`X-RateLimit-*`).
  - **Intelligent Client IP Extraction (`extractClientIp`)**: Seamlessly resolves real client IPs through reverse proxies, supporting `CF-Connecting-IP` (Cloudflare), `Fastly-Client-IP`, `X-Forwarded-For` chains, and `X-Real-IP`.
  - **Skip Logic & Dynamic Handlers**: Supports `skip(req)`, `skipFailedRequests`, `skipSuccessfulRequests`, custom status codes, and custom exceeded handler callbacks.
  - **Preserved Plugin Ecosystem**: Kept `plugins/rate-limit` intact for existing users relying on `express-rate-limit` peer dependencies.
  - **TypeScript Declarations & Testing**: Full typings in `index.d.ts` and 30 automated Vitest unit tests in `tests/unit/core-rate-limit.test.js`.

#### Cloud-Native Queue Adapters (`AWS SQS` & `Google Cloud Pub/Sub`) (`core/queue/adapters/sqs.js`, `core/queue/adapters/pubsub.js`, `tests/unit/cloud-queue-adapters.test.js`)
- **Zero-Dependency AWS SQS Queue Adapter (`SqsQueueAdapter`)**:
  - Implemented zero-dependency AWS SQS adapter using native Node.js HTTPS and standard AWS Signature Version 4 (SigV4) HMAC-SHA256 request signing.
  - **Pull & Polling Workers**: Supports configurable long-polling wait times (`waitTimeSeconds`, up to 20s), visibility timeouts, message receipt handle tracking, and job name filtering with immediate visibility release for unhandled jobs.
  - **Message Scheduling & Delays**: Automatically computes SQS `DelaySeconds` (up to 900s) from job `runAt` scheduling.
  - **AWS Lambda SQS Batch Execution (`processBatch`)**: Seamlessly dispatches AWS Lambda SQS event batches (`event.Records`) directly through the `QueueManager` with event emitter hooks (`job:start`, `job:completed`, `job:failed`) without needing long-polling worker processes.
- **Zero-Dependency Google Cloud Pub/Sub Queue Adapter (`PubSubQueueAdapter`)**:
  - Implemented zero-dependency Google Cloud Pub/Sub adapter utilizing standard REST APIs (`:publish`, `:pull`, `:acknowledge`, `:modifyAckDeadline`) with automatic base64 payload encoding/decoding and attribute tagging.
  - **Resource Normalization**: Automatically formats full topic and subscription resource paths (`projects/PROJECT_ID/topics/TOPIC` and `projects/PROJECT_ID/subscriptions/SUB`).
  - **Cloud Run Push Subscription Webhooks (`processPushRequest`)**: Handles incoming HTTP push subscription webhooks from Cloud Run or App Engine. Returns HTTP 200 on success, HTTP 204 for unhandled jobs, and HTTP 500 on execution failure so Pub/Sub automatically schedules retries with exponential backoff.
- **Dual Runtime Support**: Accepts either native zero-dependency HTTP configurations or optional official SDK clients (`@aws-sdk/client-sqs`, `@google-cloud/pubsub`).
- **Full TypeScript Type Declarations & Testing**: Added complete type contracts to `index.d.ts` and verified with 15 automated Vitest unit tests in `tests/unit/cloud-queue-adapters.test.js`.

#### Cloud Migration Jobs & Zero-Downtime Database Deploy (`bin/commands/add-migration-job.js`, `core/orm/migrate-cloud.js`, `tests/unit/cli/migration-job.test.js`)
- **Pre-Deploy Cloud Migration Job Generator (`webspresso add:migration-job`)**:
  - Scaffolds isolated, single-run database migration jobs for Google Cloud Run (`cloudrun-job.yaml`, `deploy-cloudrun-migration.sh`), AWS ECS Fargate (`ecs-migration-task.json`, `deploy-aws-migration.sh`), and Kubernetes / Helm pre-upgrade hooks (`k8s/migration-job.yaml`).
  - Completely decouples schema migrations from web server startup commands, preventing multi-instance concurrency locks and crash loops.
- **Resilient Cloud Migration Engine (`core/orm/migrate-cloud.js`, `webspresso db:migrate --safe`)**:
  - Added connection retry with exponential backoff (`waitForDatabaseConnection`) to handle Cloud SQL Auth Proxy and AWS Aurora cold starts.
  - Automatic stale lock detection & auto-healing (`freeStaleMigrationLock`) to clear hanging locks from aborted serverless jobs.
  - Dry-run mode (`webspresso db:migrate --dry-run`) to inspect pending migrations without applying changes.
- **Deployment Auditing (`webspresso deploy:check`)**:
  - Automatically audits projects deploying to Cloud Run or AWS ECS to ensure an isolated migration strategy is in place.

#### Cloud Metrics & Distributed Tracing (`core/metrics`, `tests/unit/metrics.test.js`)
- **Enterprise Prometheus Exposition & Distributed Tracing (`core/metrics`)**:
  - Implemented zero-dependency in-memory Prometheus exposition engine producing compliant `text/plain; version=0.0.4; charset=utf-8` output at `/metrics` and JSON telemetry at `/metrics.json`.
  - **Metric Primitives**: `Counter`, `Gauge`, and `Histogram` with cumulative buckets, sum, count, and label formatting.
  - **HTTP Request Telemetry**: Automated tracking of `webspresso_http_requests_total{method, route, status}`, `webspresso_http_request_duration_seconds{method, route}`, and in-flight active requests `webspresso_http_active_requests`. Internal scraper calls to `/metrics` and `/healthz` are excluded from tracking to avoid dashboard noise.
  - **Automated Runtime Collectors**: Collects process uptime, memory usage (heap total/used, RSS, external), CPU usage (user/system), event loop lag quantiles (`perf_hooks.monitorEventLoopDelay`), Knex connection pool status (size, used, available), in-memory LRU cache entries and byte budget, and circuit breaker states/failures.
  - **Distributed Tracing Context Propagation**: Automatically parses incoming W3C (`traceparent`), GCP (`x-cloud-trace-context`), AWS (`x-amzn-trace-id`), or correlation headers and injects `x-trace-id` and W3C `traceparent` (`00-${traceId}-${spanId}-01`) onto outgoing response headers.
  - **Security & Authorization**: Built-in optional bearer token authentication (`auth: 'secret-token'`).
  - **Full TypeScript Types & DX**: Exported `MetricsRegistry`, `createMetricsRegistry`, `metrics` namespace, and `createApp({ metrics: true })` configuration option.

#### Zero-Secret CI/CD Pipeline Scaffolding (`bin/commands/add-ci.js`, `tests/unit/cli/cloud-commands.test.js`)
- **Automated Keyless CI/CD Generator (`webspresso add:ci`)**:
  - Scaffolds secure, keyless GitHub Actions workflows using Google Workload Identity Federation (WIF) and AWS IAM OIDC roles to eliminate static long-lived credentials.
  - Automatically incorporates `npm test` and `npx webspresso deploy:check --strict` gating before container building or cloud deployment.
  - Supports Google Cloud Run (`deploy-cloudrun.yml`), AWS App Runner / ECS (`deploy-aws.yml`), Cloudflare Workers (`deploy-cloudflare.yml`), general multi-version testing (`ci.yml`), and GitLab CI pipelines (`.gitlab-ci.yml`).

#### Cloud Secrets Management & Synchronization (`core/secrets`, `bin/commands/secrets-pull.js`, `tests/unit/secrets.test.js`)
- **Enterprise Multi-Cloud Secret Manager (`core/secrets`)**:
  - Implemented zero-dependency integration with Google Cloud Secret Manager and AWS Secrets Manager / SSM Parameter Store.
  - **Google Cloud Secret Manager**: Automated OAuth2 token acquisition from the local GCP Metadata Server in Cloud Run/GKE, RSA-SHA256 signed JWT assertions for service account keys, and direct REST API v1 access with base64 decoding.
  - **AWS Secrets Manager & SSM Parameter Store**: Standards-compliant AWS Signature Version 4 (SigV4) HMAC-SHA256 request signing with automatic region and credential resolution.
  - **In-Memory Caching & Rotation**: Bounded RAM caching with configurable TTL (`cacheTtl: '5m'`), single-secret invalidation (`secrets.invalidate(name)`), and full cache clearing (`secrets.clearCache()`).
  - **JSON Bundle Unpacking & Dot Notation**: Resolves subkeys within JSON secret bundles (e.g. `await secrets.get('prod/app.DATABASE_URL')`) and unpacks bundles into `process.env`.
  - **Bootstrap Environment Hydration**: `loadSecrets({ provider: 'auto', secrets: { ... } })` hydrates `process.env` before database or server initialization.
- **Local Developer Secrets Pull CLI (`webspresso secrets:pull`)**:
  - Added CLI command to pull secrets directly from GCP or AWS into a local `.env.local` file with support for key discovery, JSON bundles, dry-run previews, and custom formatters.

#### Cloud Platform Preflight & Deployment Auditing (`bin/commands/deploy-check.js`, `tests/unit/cli/docker-deploy.test.js`)
- **Multi-Cloud Preflight Verification (`webspresso deploy:check --platform <platform>`)**:
  - Implemented target platform auditing with automatic detection (`cloudrun`, `aws`, `cloudflare`, `docker`, or `generic`) from project configuration markers and cloud environment variables.
  - **Google Cloud Run**: Ephemeral SQLite and local file upload storage warnings, SIGTERM shutdown timeout alignment (`timeout <= 10000ms`), `.gcloudignore` secrets exclusion to prevent `.env` leaks in Cloud Build, `cloudbuild.yaml` CI/CD pipeline verification, and dynamic `process.env.PORT` binding.
  - **AWS (App Runner & ECS Fargate)**: Ephemeral storage audits, `apprunner.yaml` and `ecs-task-definition.json` JSON validation, and CloudWatch log driver (`awslogs`) verification.
  - **Cloudflare Workers**: `wrangler.toml` configuration verification and `nodejs_compat` compatibility flag checks.
  - **Actionable Remediation Guidance**: Actionable remediation steps emitted in human-readable console output and machine-readable JSON reports (`--json`), with `--strict` mode support for CI/CD gates.

#### Core Decoupling & Framework Independence (`core/app.js`, `core/index.js`, `core/http`, `core/auth`, `index.js`)
- **Pure Core Container (`core/app.js`, `core/index.js`)**:
  - Implemented `CoreApp` and `createCoreApp(options)` decoupling business logic, service registry, validation, authorization, ambient database transactions, events, circuit breakers, cache, and shutdown management from HTTP/Express concerns.
  - Exported standalone `./core` package entry point (`require('webspresso/core')`) with zero transitive dependency on Express (`require.cache` contains 0 Express modules).
  - Direct service invocation without HTTP server or mock `req`/`res` objects (`core.service(name, input, ctxOrOpts)`).
  - Execution context creation via `core.createContext(extra)` preserving prototype inheritance and object identity without shallow-copy loss.
- **HTTP Adapter & Pipeline Layer (`core/http`)**:
  - Introduced `HttpAdapter` abstract contract (`use`, `route`, `get`, `post`, `put`, `delete`, `patch`, `all`, `listen`, `getApp`) with default `ExpressHttpAdapter` and modern zero-dependency `HonoHttpAdapter`.
  - Added `createHonoHttpAdapter(app, options)` supporting Web standard `app.request()` fetch execution and native Node `http.createServer` socket binding.
  - Framework-agnostic execution pipelines: `executeApiPipeline` and `executePagePipeline` decoupling API endpoints and SSR loaders from Express `(req, res, next)` internals.
  - Route error enrichment helper `enrichRouteError` attaching path, method, source file, module, and request ID metadata.
  - End-to-end integration test suite `tests/integration/real-world-app.test.js` validating 100% behavioral parity between Express and Hono runtimes across database models, domain services, Zod API validation, JWT dual auth, and SSR page rendering.
- **Auth & Session Decoupling (`core/auth/authenticate.js`, `core/auth/middleware.js`)**:
  - Extracted framework-agnostic `authenticateRequest(req, res, authManager)` resolving Bearer JWT header, session store, and remember-me tokens without Express middleware coupling.
  - Lazified `express-session` and `cookie-parser` loading in `core/auth/middleware.js` to ensure zero session overhead when using pure JWT, hashing, or TOTP.
- **Plugin HTTP Contract (`ctx.http`)**:
  - Injected `ctx.http` (`HttpAdapter`) into `PluginRegisterContext` alongside `ctx.app`, providing a framework-agnostic interface (`use`, `route`, `get`, `post`, etc.) for plugin routes and middlewares without hardcoding Express `app.use()`.
  - Added `http: options.http || null` to `CoreAppOptions` and `CoreApp`.
- **Express Integration & Full Backward Compatibility (`src/server.js`, `index.js`)**:
  - `createApp(options)` now delegates core subsystem orchestration to `CoreApp` while preserving 100% of existing Express routes, middleware (`app.use`, `app.get`), router stack, and SSR/API loaders.
  - Added `app.core`, `app.http`, and `app.service(name, input, opts)` directly on the Webspresso application instance.
  - Seamless request context binding: `req.context` and `req.service` injected early and propagated across API handlers, SSR page loaders, and nested service calls.
  - Extracted `CLIENT_RUNTIME_BASE` into `src/client-runtime/constants.js` and lazified Express middleware imports in `core/limits` to keep pure imports lean.

## [0.0.105] - 2026-10-18

### Added

#### Enterprise Resilience & Fault Tolerance (`core/resilience`, `core/errors/domain.js`)
- **Three-State Circuit Breaker (`core/resilience/circuit-breaker.js`)**:
  - Implemented zero-dependency `CircuitBreaker` transitioning between `CLOSED`, `OPEN`, and `HALF_OPEN` states.
  - Rolling window failure rate monitoring, execution timeout bounding per call, graceful fallback handlers, and health state events (`open`, `close`, `halfOpen`, `trip`, `reject`).
  - Seamless integration into Services Layer (`defineService({ circuitBreaker: { failureThreshold, resetTimeout, timeout, fallback } })`) and exposed via `app.breakers`, `app.getBreaker(name)`, and `req.breaker(name)`.
- **Exponential Backoff Retry Engine (`core/resilience/retry.js`)**:
  - Configurable retries with randomized jitter (`full`, `equal`, `decorrelated`) preventing thundering herd problems.
  - Built-in transient error detection (`isTransientError`) covering network drops (`ECONNRESET`, `ETIMEDOUT`, `EPIPE`), HTTP 429 Rate Limits, and HTTP 503/504 Service Unavailable.
  - Declarative retry support on services (`defineService({ retry: { maxRetries, delay, factor, jitter } })`) and helpers `retry()` and `withRetry()`.

#### High-Performance In-Memory LRU & Tagged Cache Engine (`core/cache`)
- **Memory-Bounded LRU Engine (`core/cache/lru.js`, `core/cache/byte-size.js`)**:
  - Zero-dependency O(1) doubly-linked list LRU cache with byte-budget estimation preventing Node.js process Out-Of-Memory (OOM).
  - Configurable via `createApp({ cache: { maxEntries, maxBytes, maxMemoryMb, defaultTtl } })` or standalone `new LruCache()`.
  - Cache stampede protection via async `getOrSet(key, fn, ttl)` mutex deduplication.
- **Tagged Cache Invalidation (`core/cache/tagged-lru.js`)**:
  - `TaggedLruCache` supporting multi-tag association (`cache.set(key, val, { tags: ['posts', 'user:1'] })`) and atomic tag invalidation (`cache.invalidateTag('posts')`) with zero memory leakage.
  - Pluggable backing provider for ORM query cache (`core/orm/cache/memory-provider.js`) and Zod schema caching (`core/schema-cache.js`).

#### Native Cloud & Kubernetes Health & Readiness Probes (`core/health`)
- **RFC-Compliant Probes (`/healthz`, `/readyz`, `/health`)**:
  - Built-in liveness (`/healthz`), readiness (`/readyz`), and combined diagnostic (`/health`) endpoints configured via `createApp({ healthCheck: true })`.
  - Non-blocking event loop lag telemetry via `perf_hooks.monitorEventLoopDelay`, database and queue connectivity checks, and custom user probe registration (`app.addHealthCheck`).
  - Automatic HTTP 503 draining integration with `ShutdownManager` during pod termination.

#### Configurable Payload Size Limits & DoS Protection (`core/limits`)
- **Request Body Limit Enforcement (`core/limits/middleware.js`, `core/limits/normalize.js`)**:
  - Zero-dependency body limit enforcement configured via `createApp({ limits })` or shorthand `limits: '5mb'`.
  - Content-Type specific limits (`json`, `urlencoded`, `raw`, `text`), route overrides (`limits.routes`), and streaming bypass (`limits.exclude`).
  - Automatic mapping to HTTP 413 `PayloadTooLargeError` and HTTP 400 `BadRequestError`, with raw body capture on `req.rawBody` for webhook HMAC signature verification.

#### Dynamic Row-Level Security (RLS) (`plugins/rls`, `core/orm/scopes.js`)
- **Declarative Multi-Tenant Isolation**:
  - Define model row-level policies via `defineModel({ rls: { read, write } })` with role/user context evaluation.
  - Automatic injection of scoping rules into QueryBuilder and Repositories.
  - Express middleware `createRlsMiddleware` and plugin `rlsPlugin`.

#### Batch Upsert & HTTP 103 Early Hints (`core/orm/batch.js`, `core/early-hints`)
- **High-Performance Multi-Row Batch Upsert**:
  - `repo.upsertMany()` and `db.batchUpsert()` with dialect-specific optimizations (`ON CONFLICT` / `ON DUPLICATE KEY UPDATE`).
- **HTTP 103 Early Hints Preloading**:
  - Zero-dependency RFC 8288 / RFC 8297 Early Hints dispatcher configured via `createApp({ earlyHints: true })` or per-page `definePage({ earlyHints })`. Emits informational 103 status code with route CSS/JS preloads before async `load()` finishes.

#### Centralized Core Utilities & Default Port 7331 (`core/utils`, `src/helpers.js`)
- Updated default port from `3000` to `7331` across CLI, servers, docs, and starter templates.
- Centralized crypto, filesystem walking, url, regex, time, duration, and safe JSON serialization helpers.

### Fixed & Hardened

#### Core Isolation & Lifecycle Hardening (`core/shutdown`, `core/orm`, `src/server.js`, `src/plugin-manager.js`, `src/helpers.js`)
- **Transaction Stale Context & Caller Scope Isolation (`core/orm/transaction.js`, `core/orm/index.js`, `core/orm/repository.js`, `core/orm/query-builder.js`)**:
  - `getAmbientTransaction()` now verifies `isCompleted()` on the stored transaction, returning `null` when a transaction is already committed or rolled back so lingering async tasks or late callbacks never execute against closed Knex transaction instances.
  - `db.transaction()` and `createTransactionContext()` now clone `scopeContext`, preventing tenant/user mutations within a transaction block from bleeding into caller context.
  - Added graceful non-transactional fallback in `runTransaction` when `runner.transaction` is not defined (e.g. test stubs or mock Knex instances).
  - Supported passing pre-configured `knex` directly in `createDatabase({ knex })` while keeping `db.knex` as a regular own property.
- **QueryBuilder Clone & Condition Isolation (`core/orm/query-builder.js`)**:
  - `clone()` now explicitly preserves `this.action` (`'select'`, `'update'`, `'delete'`, `'count'`).
  - Synchronized `cloned.state.scopeContext = cloned.scopeContext` to ensure scope mutations remain consistent on cloned instances without polluting parent builders.
  - Deep-copied `wheres` and `orderBys` arrays to prevent cross-query clause mutation.
- **SQL Operator Precedence in RLS Scopes (`core/orm/scopes.js`)**:
  - Wrapped functional query builder rules in parenthesized where groups `qb.where(scopedQb => result(scopedQb))` to prevent `OR` operator precedence leakage into subsequent `.where('id', id)` conditions.
- **ShutdownManager Global Deadline & Hung Disposer Bounding (`core/shutdown/shutdown-manager.js`, `src/server.js`)**:
  - Unified all shutdown steps under a single absolute deadline budget (`startTime + totalTimeout`). Multiple server adapters now share the remaining timeout budget rather than multiplying shutdown duration per adapter.
  - Bounded each plugin disposer and shutdown hook with per-step timeout caps (`Math.min(remainingMs, Math.max(100, Math.floor(remainingMs / (remaining + 1))))`), preventing single stuck or hanging disposers from indefinitely blocking graceful server termination.
  - Eliminated deadlock where `closePromise` was awaited indefinitely after graceful timeout expired.
  - Allowed health endpoints (`/healthz`, `/readyz`, `/health`) to bypass general 503 draining middleware during graceful shutdown so load balancer readiness probes receive structured JSON draining status.
- **NodeHttpAdapter Connection Cleanup (`core/shutdown/http-adapter.js`)**:
  - Invokes `this.destroy()` on adapter close and force close to remove connection listeners and clear socket sets.
- **Multi-App Instance Isolation (`src/server.js`, `src/helpers.js`)**:
  - Initialized Express `app` early in `createApp` and attached per-instance `CircuitBreakerRegistry` (`app.breakers`) and `AssetManager` (`app.assetManager`), preventing breaker trips or asset configurations in one app instance from affecting others running in the same Node.js process.
  - `src/helpers.js` now dynamically resolves `AssetManager` via `Proxy`, respecting per-instance configurations without locking stale closures.
- **Startup Partial Failure Rollback (`src/plugin-manager.js`, `src/server.js`)**:
  - Added `_rollbackPlugin` and `_rollbackPluginSync` to `PluginManager`. If a plugin's `setup()` or `register()` fails, partially registered disposers for that plugin are executed in reverse order and removed without leaving dangling resources.
  - Wrapped `createApp` initialization in a cleanup error boundary, ensuring `shutdownManager.close('startup_failure')` unwinds all acquired resources in reverse order without shadowing the original startup error.
- **Body Parser Introspection & Webhook Backoff Fixes (`core/limits/middleware.js`, `plugins/webhooks/dispatcher.js`)**:
  - Named global body parsing middleware functions (`function jsonParser`, `function urlencodedParser`) for proper Express stack layer introspection.
  - Initialized `this.backoffBaseMs` in `WebhookDispatcher` constructor, fixing `NaN` retry delay calculations.
- **Admin Panel & Test Determinism (`plugins/admin-panel/modules/menu.js`, `tests/unit/core/resilience.test.js`)**:
  - Updated admin panel changelog release link to `https://github.com/litepacks/webspresso/releases`.
  - Configured zero jitter on retry abort unit tests to eliminate timing race conditions under heavy CPU coverage runs.

## [0.0.104] - 2026-10-17

### Fixed

#### Dev Live Reload & Graceful Shutdown Integration (`core/shutdown`, `src/dev-reload`, `src/server.js`, `bin/commands/dev.js`)
- **Deadlock Elimination in `ShutdownManager`**: Executed plugin disposers (e.g. `devReloadHub`, SSE transports, WebSocket clients, queue workers) *before* awaiting HTTP server connection draining (`adapter.close()`). This completely eliminates circular deadlocks where the HTTP server hung for 10,000ms waiting for active SSE streams to close while the disposer closing those streams was waiting for the server to finish closing.
- **Fast Development Shutdown Mode**: In development mode (`isDev`), `ShutdownManager` now defaults to `mode: 'force'` and a `1000ms` timeout (unless explicitly overridden by user options), eliminating port-locking (`EADDRINUSE`) and ensuring instant restarts during `node --watch`.
- **Client Runtime Safe Reload (`safeReload`)**: The browser-side `CLIENT_RUNTIME_SCRIPT` now executes a background `HEAD` ping to verify that the dev server is fully up and listening before triggering full page reload. This prevents the browser from showing Chrome's ugly `ERR_CONNECTION_REFUSED` ("This site can't be reached") screen during watch restarts.
- **Adaptive Reconnect & Auto-Reload on Server Restart**: Reduced dev reload SSE reconnection delay from a static 2000ms to an adaptive 150ms-300ms window, and automatically triggers a page reload as soon as the dev server comes back online.
- **Optimized Watch Directories in CLI (`bin/commands/dev.js`)**: Removed `views/` from `node --watch` (Nunjucks template changes are already live-reloaded in-memory via SSE with zero server restarts) and added `services/` and `config/` to watch paths for reliable server-side JS restarts.

#### Shared Fetch Utilities with Timeout & AbortController (`core/utils/fetch.js`, `core/auth/oauth.js`, `plugins/admin-panel`)
- **Backend Zero-Dependency `fetchWithTimeout`**: Created a production-grade wrapper around native `fetch` featuring configurable timeouts (`options.timeout`), automatic `AbortController` integration, `timer.unref()` to keep the Node event loop clean, signal composition for caller-supplied `options.signal`, and semantic error formatting (`TimeoutError` / `ETIMEDOUT`). Exported across `core/utils/fetch`, `utils.fetchWithTimeout` in `src/helpers.js`, root framework export in `index.js`, and TypeScript types in `index.d.ts`.
- **OAuth 2.0 Hanging Socket Defenses (`core/auth/oauth.js`)**: Replaced raw unprotected `fetch` calls in GitHub extra emails (`/user/emails`), token exchange (`provider.tokenUrl`), user profile retrieval (`provider.userInfoUrl`), and `handleCallback` with `fetchWithTimeout`, accepting custom `timeout` and `signal` options to eliminate hangs when identity providers stall.
- **Frontend Admin Panel Fetch & Abort Architecture (`plugins/admin-panel/`)**: Introduced client-side `fetchWithTimeout` to SPA parts, upgraded `api.request`, `downloadDataExchangeXlsx`, single/multiple file uploads, and data exchange imports with configurable timeouts (30s–60s) and `AbortController` support. Exposed `window.Admin.fetch` and `window.__ADMIN_COMPONENTS__.fetchWithTimeout` for companion plugins (`file-manager`, `schema-explorer`, `orm-cache-admin`).
- **Audit Log Middleware Fix (`plugins/audit-log/middleware.js`)**: Fixed `ReferenceError: metadata is not defined` regression when constructing SQLite metadata payload.

#### Shared Timing-Attack Resistant `safeCompare` (`core/utils/crypto.js`, `core/utils/safe-compare.js`)
- **Unified Cryptographic Constant-Time Comparison**: Created zero-dependency `safeCompare` in `core/utils/crypto.js` using `crypto.timingSafeEqual` with dummy comparison protection on length mismatches to completely prevent timing leaks. Supports both strings and Buffers, and safely handles null/undefined/non-string inputs without throwing. Exported across `core/utils/crypto`, `core/utils/safe-compare`, `utils.safeCompare` in `src/helpers.js`, root framework export in `index.js`, and TypeScript types in `index.d.ts`.
- **Framework-Wide Deduplication**: Replaced redundant, fragmented `timingSafeEqual` and `safeCompare` implementations across `plugins/csrf`, `plugins/basic-auth`, `plugins/api-key`, `plugins/webhooks`, `plugins/mcp`, `plugins/polar`, `core/auth/totp`, `core/auth/oauth`, and `core/auth/jwt`.

#### Shared HTML Escaping & Sanitization (`core/utils/html.js`, `core/utils/escape-html.js`)
- **High-Performance Escaper & Unescaper**: Created zero-dependency `escapeHtml` and `unescapeHtml` in `core/utils/html.js` featuring regex test fast-path and single-pass replacement for `&`, `<`, `>`, `"`, and `'`. Exported across `core/utils/html`, `core/utils/escape-html`, `utils.escapeHtml` / `utils.unescapeHtml` in `src/helpers.js`, root framework export in `index.js`, and typed in `index.d.ts`.
- **Framework-Wide Deduplication**: Unified duplicate HTML escaping routines across `core/errors/middleware.js`, `core/forms/form-builder.js`, `core/content/renderer.js`, `plugins/swagger.js`, `plugins/recaptcha/helpers.js`, and `bin/utils/orm-map-html.js`.

#### Universal Query Filtering Engine (`core/orm/query-filters.js`)
- **Single Source of Truth for Model Query Filters**: Extracted and centralized operator parsing (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `in`, `between`, `null`, `not_null`) and multi-value splitting into `core/orm/query-filters.js`.
- **Deduplicated Admin Panel & REST Resources**: Replaced redundant `applyColumnFilters` and `buildFilteredQuery` implementations in `plugins/rest-resources/index.js` and `plugins/admin-panel/core/api-extensions.js` with the unified engine, ensuring identical SQL semantics, search term matching, and reserved query parameter skipping.

#### Universal Client IP Resolution (`core/utils/ip.js`, `core/utils/get-client-ip.js`)
- **Proxy-Aware Client IP Extraction**: Created zero-dependency `getClientIp(req, fallback)` in `core/utils/ip.js` with comprehensive fallback chains: `x-forwarded-for` (handling comma-separated strings and arrays with whitespace trimming), `x-real-ip`, `req.ip`, `req.connection.remoteAddress`, `req.socket.remoteAddress`, and customizable fallbacks.
- **Framework-Wide Deduplication**: Deduplicated client IP resolution across `core/auth/user-agent.js`, `plugins/site-analytics/tracking.js`, `plugins/admin-panel/lib/login-rate-limiter.js`, `plugins/recaptcha/verify.js`, and `plugins/audit-log/middleware.js`. Exported across `core/utils/ip`, `core/utils/get-client-ip`, `utils.getClientIp` in `src/helpers.js`, root framework export in `index.js`, and TypeScript declarations in `index.d.ts`.

#### Plugin Resilience, Security & Crash Defenses (`plugins/`)
- **Webhooks Unhandled Process Crash Defense (`plugins/webhooks/dispatcher.js`)**: Guarded `this.emit('error', err)` with `this.listenerCount('error') > 0` before emitting unhandled errors on `EventEmitter`, preventing unhandled exception process exits. Marked retry timers with `timer.unref()`.
- **Webhooks SSRF & URL Protocol Validation (`plugins/webhooks/sender.js`)**: Enforced strict `http:` and `https:` URL protocol validation, blocking dangerous pseudo-schemes (`file:`, `javascript:`) and unhandled connection hangs.
- **File Manager Windows Path Separator Fix (`plugins/file-manager/core.js`)**: Fixed Windows backslash bug where `.replace(/\\/g, '')` was stripping path separators instead of converting them to `/`.
- **File Manager URI Decoding Error Handling (`plugins/file-manager/core.js`)**: Wrapped `decodeURIComponent` in try/catch to throw clean `ValidationError(400)` instead of uncaught 500 `URIError`.
- **Admin Panel Login Rate Limiter OOM Defense (`plugins/admin-panel/lib/login-rate-limiter.js`)**: Bounded `attempts` map with a 5,000-item hard ceiling and FIFO eviction to prevent Out-Of-Memory (OOM) under distributed IP brute-force attacks.
- **Admin Panel Logout Session Guard (`plugins/admin-panel/auth.js`)**: Guarded `logout(req, res)` against undefined `req.session` or missing `destroy` method.
- **SEO Checker XSS Defense (`plugins/seo-checker/index.js`)**: Escaped `<` and `>` in injected JSON script tags (`\u003c` / `\u003e`) to prevent script boundary breakout and XSS vulnerabilities.
- **Audit Log SQLite Metadata Serialization (`plugins/audit-log/`)**: Ensured JSON metadata is properly stringified on SQLite in middleware and safely parsed in `listHandler`.
- **External Request Timeout Defenses (`plugins/polar/src/api.js`, `plugins/recaptcha/verify.js`)**: Integrated shared `fetchWithTimeout` across polar and recaptcha plugins with 15s and 10s timeouts.
- **Header Null Checks (`plugins/basic-auth/index.js`, `plugins/cors.js`)**: Added defensive guards against undefined `req.headers`.
- **MCP SSE Transport Lifecycle (`plugins/mcp/`)**: Added `close()` method to `mountSseTransport` and wired up `dispose(ctx)` and `onDispose` hooks for clean SSE connection termination on shutdown.

### Performance

#### SoftScope Profiling & Cache Optimizations
- **Webhook Matcher RegExp Cache (`plugins/webhooks/matcher.js`)**: Added a 1,000-item bounded RegExp cache (`Map`) avoiding regex recompilation on every match, boosting `matchEvent` throughput to 489k ops/sec.
- **File Manager Storage Usage Cache (`plugins/file-manager/core.js`)**: Added a 15-second TTL cache for `calculateStorageUsage` with automatic invalidation on uploads, deletes, and renames, eliminating recursive disk walks on every upload.
- **Sitemap XML String Caching (`plugins/sitemap.js`)**: Pre-rendered and cached sitemap XML string (`cachedXml`) with automatic invalidation, avoiding re-serialization of thousands of XML nodes per request.
- **Swagger OpenAPI Document Caching (`plugins/swagger.js`)**: Added `cachedDoc` in production for `openapi.json` to eliminate repeated route scanning and Zod schema conversions.
- **Schema Explorer Graph Memoization (`plugins/schema-explorer.js`)**: Memoized `getEnrichedGraph()` and added `api.invalidateCache()`.
- **Redirect Rule O(1) Map Lookup (`plugins/redirect/index.js`)**: Added $O(1)$ Map lookup for string redirect rules and fixed null options crash caught during SoftScope fuzzing.

## [0.0.103] - 2026-10-17

### Added

#### Declarative Model Options & Schema Helpers (`core/orm`)
- **Declarative Timestamps & Soft Deletes**: Added `timestamps: true` (or custom `{ createdAt, updatedAt }`), `softDelete: true` / `softDeletes: true` (and `options: { timestamps, softDelete }`) to `defineModel()`. Automatically injects columns and Zod definitions without manual schema spreading.
- **Backward-Compatible Helpers**: Added `...zdb.timestamps()`, `...zdb.softDeletes()`, `zdb.softDelete()`, and `zdb.timestamps().createdAt` helpers in `core/orm/schema-helpers`.
- **Plain Object Schemas**: Supported plain object schemas (`schema: { id: zdb.id(), ... }`) alongside functional schemas in `defineModel()`.

### Fixed

#### ORM Query Builder & Repository Scope Isolation
- **Scope Context Immutability**: Cloned `scopeContext` in `QueryBuilder` constructor and `createRepository.query()` to prevent chained scope modifiers (e.g. `.onlyTrashed()`) from mutating repository state or affecting subsequent operations like `repo.restore()`.
- **Strict Schema Validation**: Tightened ORM model validation to require non-empty schema definitions and reject missing/invalid schemas early.

#### Plugin Resilience & Security
- **Site Analytics Circuit Breaker**: Prevented raw SQL log floods, added exponential backoff, circuit breaker, and retry drop policy in tracking batch flush.
- **Error Sanitization & Rate Limiting**: Added SQL error sanitization and rate limiting in audit-log, email, client-error-handler, and queue polling backoff.
- **File Manager Extension Validation**: Supported standalone safe extensions in `validateSafeExtension`.

### Performance

- **SoftScope Hot Path Optimizations**: Optimized hot paths across JWT handling, user-agent parsing, route table lookups, event dispatching, and plugin resolution.
- **Query Builder & Compression**: Optimized query-builder event guards, JSON deserialization, API loader resolution, and compression encoding negotiation.


#### Lightweight Reusable Services Layer (`src/services`, `ctx.service`, `req.service`)
- **Auto-Discovery & File Naming**: Recursively scans `services/` directory and converts file paths into dot-separated service identifiers (e.g. `services/user/get.js` → `user.get`, `services/post/publish.js` → `post.publish`, `services/user/profile/get.js` → `user.profile.get`).
- **Shared Context Service Composition**: Execute services from SSR loaders (`ctx.service()`), API routes (`req.service()`), or within other services while sharing the exact same request context (`ctx.db`, `ctx.auth`, `ctx.session`, `ctx.user`).
- **Circular Call Detection**: Automatically tracks service call stacks and catches recursion/dependency cycles early (`user.get -> profile.get -> user.get`), throwing a clean `Circular service call detected` error.
- **Zod & Lightweight Input Schema Validation**: Validates arguments prior to handler execution using Zod functional schemas (`({ z }) => z.object(...)`), Zod instances, or simple type descriptors (`'number'`, `'string'`, `'email'`, `'boolean'`, `'object'`, `'array'`, `'date'`).
- **In-Memory Caching & Memoization (`src/services/memoize.js`)**: Cache service results with TTL expiration, Cache Stampede / Thundering Herd in-flight request deduping, true LRU eviction, object mutation protection (`clone: true`), and safe serialization for `BigInt`, `Buffer`, and circular references.
- **Cache Invalidation**: Explicitly invalidate cache keys via `ctx.service.invalidate(name, input)` or clear service cache via `ctx.service.clearCache(name)`.
- **Interactive CLI Runner (`webspresso service`)**: Test and run services interactively from the command line with automatic database resolution without spinning up the HTTP server.
- **Execution Timeouts (`timeout: '5s'`)**: Protect services against hanging handlers with automatic timeout abortion throwing `SERVICE_TIMEOUT` with HTTP 504 status.
- **Database Transaction Boundaries (`transaction: true`)**: Automatic Knex transaction lifecycle handling with seamless rollback on unhandled errors and single-transaction reuse across nested service calls.
- **Branch-Safe Concurrency & Call Stacks**: Parallel sibling service calls (`Promise.all`) execute across isolated call stack branches without colliding.
- **Authorization & Role-Based Access Control (`auth`)**: Built-in RBAC declarative guards (`auth: true`, `auth: 'admin'`, `auth: ['admin', 'finance']`, or custom predicate functions) throwing `UnauthorizedError` (401) or `ForbiddenError` (403).
- **`defineService` Helper & Registry**: Added `defineService()` / `service()` definition helpers and `createServiceRegistry()` factory with duplicate name detection and hot-reload support.

#### Zero-Dependency Native i18n & Localization Enhancements (`src/file-router.js`, `src/helpers.js`, `src/server.js`)
- **Native Pluralization (`Intl.PluralRules`)**: Support for CLDR plural forms (`zero`, `one`, `two`, `few`, `many`, `other`) and explicit numerical keys (`0`, `1`) via `t('key', { count })` and `t.plural(count, forms)`.
- **Automatic Fallback Locale Chain**: Missing dictionary keys in target locales fall back gracefully to `DEFAULT_LOCALE` (`en`) before returning key names. Check key presence via `t.has('key')` / `t.exists('key')`.
- **Built-in `Intl` Formatters on `t`**: Native locale-aware formatters: `t.number()` / `t.formatNumber()`, `t.currency()` / `t.formatCurrency()`, `t.date()` / `t.formatDate()`, and `t.relativeTime()` / `t.formatRelativeTime()`.
- **Nunjucks Template Helpers & Filter**: Added `{{ 'key' | t(params) }}` filter and `fsy.localeUrl(targetLocale)` URL switcher helper with preserved query strings.

#### Security Hardening & Automated Security Testing
- **Open Redirect Protection (`plugins/redirect/index.js`)**: Hardened `isExternalTarget(to)` against backslash evasion (`\\`, `/\`, `\/`) and dangerous pseudo-schemes (`javascript:`, `data:`).
- **Admin Panel Filter Validation (`plugins/admin-panel/api.js`)**: Validates `req.query.filter` column keys strictly against `model.columns` to prevent query builder injection.
- **Prototype Pollution Immunity (`core/orm/utils.js`)**: Protected `deepClone` against `__proto__`, `constructor`, and `prototype` manipulation.
- **CRLF Header Splitting Defense (`plugins/basic-auth/index.js`)**: Sanitized `config.realm` against newline characters before injecting into `WWW-Authenticate` headers.
- **XSS & Script Breakout Defense (`src/server.js`, `src/helpers.js`)**: Nunjucks `json` filter encodes `<` to `\u003c` preventing `</script>` breakouts in templates; `AssetManager.buildAttributes` strictly validates HTML attribute key characters.
- **Configurable `trustProxy`**: Support for `options.trustProxy` (or `options.server.trustProxy`), allowing applications to disable proxy trust (`trustProxy: false`) when running directly without reverse proxies.
- **Automated Security Test Suite & Policy**: Added 14 dedicated security test suites in `tests/security/` (`npm run test:security`), added `npm run security` script, and created [`SECURITY.md`](file:///Users/ahmet/projects/webspresso/SECURITY.md).

## [0.0.86] - 2026-08-13

### Added

#### 3-State Column Sorting in Admin Panel SPA (`plugins/admin-panel`)
- **3-State Dynamic Column Sorting**: Interactive column header sorting cycling through `Unsorted` (↕) → `Ascending` (`asc`, ▲) → `Descending` (`desc`, ▼) → `Unsorted` on click.
- **URL Parameter Sync**: Automatically synchronizes `sort` and `order` query parameters with browser history (`window.history.replaceState`) for shareable, bookmarkable table views.
- **Column-Level Configuration**: Configure sorting per column in `zdb` schemas via `zdb.string({ sortable: true })` / `zdb.text({ sortable: false })` or chainable `.config({ sortable: boolean })`. Complex column types (`json`, `array`, `file`) default to non-sortable.
- **Model-Level Configuration**: Configure model-level sortable column whitelists (`sortableColumns: ['name', 'price']`) or disable table sorting completely (`sortable: false`) in `defineModel({ admin: { ... } })`.

### Fixed

#### Safe Date Parsing in Admin Panel Field Renderers
- **RangeError Prevention**: Fixed `RangeError: Invalid time value` in Mithril.js Admin Panel SPA date/datetime field renderers (`basic.js` and `04-field-renderers.js`) by validating date validity (`!isNaN(d.getTime())`) before calling `.toISOString()`.
- **Model Admin Sorting Options Propagation (`core/orm/model.js`)**: Ensured `sortable`, `sortableColumns`, and `columns` admin configuration options set in `defineModel` are correctly preserved on `model.admin`.

## [0.0.85] - 2026-08-12

### Added

#### Zero-Dependency JWT & Refresh Token System (`core/auth`)
- **HS256 JWT Generator & Verifier (`core/auth/jwt.js`)**: Native, zero-dependency JWT signing (`signJwt`), verification (`verifyJwt`), and decoding (`decodeJwt`) using Node.js's native `crypto` module (HMAC-SHA256, timing-safe signatures, duration parsing for `'15m'`, `'24h'`, `'30d'`, etc.).
- **Dual Authentication Architecture**: Supports **Session + Cookie** (stateful for browser SSR routes & Admin Panel) and **JWT Bearer + Refresh Tokens** (stateless for REST APIs, Mobile Apps & SPAs).
- **Refresh Token Rotation**: `auth.generateRefreshToken(user)` creates long-lived refresh tokens with `jti` nonces. `auth.refreshAccessToken(refreshToken, { rotate: true })` handles token rotation and issues fresh access/refresh token pairs. Automatically rejects refresh tokens when passed to access endpoints.
- **Request & Middleware Integration**:
  - `req.auth` helper methods: `generateUserToken`, `generateRefreshToken`, `refreshAccessToken`, `createJwt`, `verifyJwt`.
  - Global `authenticate` middleware automatically prioritizes `Authorization: Bearer <token>` headers before falling back to Session and Remember-Me cookies.
  - Guard middleware `requireJwt()` (and `middleware: ['jwt']` on file-based API routes) enforces valid Bearer Access Tokens.
- **`quickAuth({ db, jwt: true })`**: Opt-in `jwt` option (`jwt: true` or `jwt: { secret, refreshSecret, expiresIn, refreshExpiresIn }`) to enable JWT & Refresh Token support alongside ORM integration.

#### Zero-Dependency CORS Plugin (`plugins/cors.js`)
- **`corsPlugin(options)`**: Zero-dependency CORS plugin supporting string origins (`'https://app.com'`), origin arrays, RegExp patterns (`/\.domain\.com$/`), and custom callback functions `(origin, callback)`.
- **Preflight & Credentials Support**: Handles `OPTIONS` preflight requests (`204 No Content`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`, `Access-Control-Max-Age`). Supports `credentials: true` with automatic `Access-Control-Allow-Credentials: true` and dynamic origin reflection.
- **Route Filtering**: Supports route prefix filtering (`routes: ['/api']`) and registers named route middleware (`middleware: ['cors']`).
- **Exported from `plugins`**: Re-exported via `webspresso/plugins`.

### Fixed

#### Server Middleware Registration (`src/server.js`)
- Registered `middlewares.jwt` in `createApp` when `authManager` is provided, enabling file-based API route configs (`pages/api/*`) to specify `middleware: ['jwt']` natively.

### Security

#### CodeQL Vulnerability Audit & Fixes
- **CSRF Cookie Options & Storage (`plugins/csrf/index.js`)**: Resolved CodeQL "Clear text storage of sensitive information" alert by computing `effectiveCookieOptions` dynamically inside CSRF middleware, ensuring `httpOnly: true`, `sameSite: 'lax'`, and dynamic HTTPS/secure evaluation (`req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production'`).
- **DOM XSS Sanitization (`plugins/content/client/inline-edit.js`)**: Resolved CodeQL "DOM text reinterpreted as HTML" alert by introducing `sanitizeClientHtml(htmlStr)` using browser `DOMParser` to strip dangerous tags (`<script>`, `<iframe>`, `<object>`, `<embed>`, `<applet>`, `<base>`), inline `on...` event attributes, and `javascript:` URIs before updating DOM elements.
- **HTML Sanitization Regex in Tests (`tests/unit/content/field-types.test.js`)**: Resolved CodeQL "Bad HTML filtering regexp" alert by replacing naive regex `/<script>.*?<\/script>/g` in test mock with the robust `sanitize-html` library.
- **Session Cookie Security in Tests (`tests/integration/csrf.test.js`)**: Resolved CodeQL "Clear text transmission of sensitive cookie" alert by updating test session configuration to explicitly set `secure: process.env.NODE_ENV === 'production'`, `httpOnly: true`, and `sameSite: 'lax'`.
- **Windows Command Execution (`bin/commands/orm-map.js`)**: Resolved CodeQL "Shell command built from environment values" alert by replacing `execFileSync('cmd', ['/c', 'start', '', fp])` with direct `execFileSync('explorer.exe', [fp.replace(/\//g, '\\')])` on Windows, eliminating shell interpreter invocation and command injection risk.
- **Auth Session Cookie Configuration (`core/auth/manager.js`)**: Resolved CodeQL "Clear text transmission of sensitive cookie" alert by enforcing `httpOnly: true` and `sameSite: 'lax'` defaults in `getSessionConfig()` alongside dynamic secure cookie computation.

## [0.0.84] - 2026-08-10

### Added

#### Admin Panel Custom HTML & External URL Pages (`plugins/admin-panel`)
- **Custom Pages (`url` / `iframeUrl`, `html` / `htmlFile`)**: `registerPage` and `registerModule` support embedding external web pages (`url` inside `<iframe>`) or custom HTML documents (`html` or `htmlFile` path rendered directly into the native DOM via `m.trust` with full Tailwind CSS styling and script execution). Optional `iframe: true` allows sandboxed iframe isolation if needed.
- **Automatic Layout Wrapping**: Custom pages are automatically wrapped inside the Admin Panel layout (breadcrumbs, header, title) unless `layout: false` is configured for full-screen pages.

#### SSR Script & Style Import Registration (`plugins/admin-panel`)
- **`registerScript` & `registerStyle`**: Added `registerScript(script)` and `registerStyle(style)` methods to `AdminRegistry`, `adminApi`, and `registerModule({ scripts: [...], styles: [...] })`.
- **SSR Injection**: External scripts (e.g. `<script src="https://unpkg.com/euixjs@latest/dist/EUIXEngine.umd.js"></script>`) and custom CSS links are rendered directly into the Admin Panel SSR `<head>` and `</body>` markup.

### Fixed

#### Inline HTML Script Tag Escaping (`plugins/admin-panel/index.js`)
- Escaped `<` as `\u003c` during JSON serialization of `window.__ADMIN_CONFIG__` in `generateAdminPanelHtml`, preventing raw HTML documents embedded in custom pages from breaking the Admin Panel `<script>` context.

#### SPA Navigation & Route Resolution (`plugins/admin-panel/modules/menu.js`, `plugins/admin-panel/app.js`)
- Updated `MenuItem` href generation to correctly prefix custom route paths with `adminPath` (`/_admin/euix`).
- Scheduled `m.redraw()` on async route resolution to ensure seamless client-side SPA navigation without manual workaround hacks.

#### E2E & Unit Test Coverage
- Added automated E2E tests for interactive EUIX counter components and EUIX documentation site embedding (`tests/e2e/admin-panel.spec.js`).

## [0.0.83] - 2026-08-02

### Fixed

#### Admin Panel Module API Error Handling (`plugins/admin-panel/core/admin-module.js`)
- **`registerModule` API routes**: Wrapped registered API route handlers in an `async (req, res, next)` error wrapper (`safeHandler`). Synchronous errors and rejected Promises in module API routes are caught and forwarded to Express global error handling (`next(err)`), preventing Node.js process crashes.

#### Custom Page Closure Component Lifecycle (`plugins/admin-panel/app.js`)
- **`wrapCustomPageWithLayout`**: Instantiates closure component factory functions (`typeof rawComp === 'function'`) into `vnode.state.instance` during `oninit`. Executes component lifecycle hooks (`oninit`, `oncreate`, `onupdate`, `onbeforeremove`, `onremove`) on `vnode.state.instance`, ensuring custom pages (such as `audit-log` admin UI) run their `oninit` data loaders properly.

#### Audit Log Admin Component (`plugins/audit-log/admin-component.js`)
- **`m.redraw()` on async fetch**: Added `m.redraw()` invocation inside `AuditLogPage`'s `api.get` `.then()` and `.catch()` handlers so Mithril re-renders the component view as soon as data arrives.

#### Audit Log E2E Test (`tests/e2e/audit-log.spec.js`)
- Updated test locator to wait directly for the `/Total:/` text element on page load.

### Security

#### Locale & i18n file paths (`src/file-router.js`)
- **`detectLocale`**: **`?lang`** and **`Accept-Language`** resolve only to **`SUPPORTED_LOCALES`** entries and a safe **`[a-z0-9-]{1,16}`** tag shape; rejects traversal-style **`lang`** for **`loadI18n`** / **`pages/locales/*.json`**. Defaults fall back via **`DEFAULT_LOCALE`** then first configured locale.

#### Translator & SSR utilities
- **`createTranslator`**: interpolates **`{{ key }}`** with **RegExp-escaped keys** when replacing params.
- **`filePathToRoute`**: **`[segment]` / `[...segment]`** conversion uses a linear scan (**no bracket regex** flagged by analyzers).

#### Logging
- **`loadI18nFile`**, **`loadRouteConfig`**: **`console.error`** uses fixed first message + separate arguments (avoid format-string quirks with attacker-influenced paths).

#### Slash trimming (ReDoS-hardened)
- New **`core/url-path-normalize.js`** — **`trimUrlPathSlashes`**: linear-time leading/trailing **`/`** trimming (avoids polynomial regexes like **`/^\/+|\/+$/g`** on long slash runs) in **`plugins/swagger.js`**, **`plugins/rest-resources`**, **`core/orm/model`** (**`rest.path`**), **`plugins/upload/local-file-provider`**.

#### OpenAPI generator (`core/openapi/build-from-api-routes.js`)
- **`paths`** nested maps use **`Object.create(null)`**; only allowlisted lowercase HTTP methods (**`get`**, **`post`**, **`put`**, **`patch`**, **`delete`**, **`head`**, **`options`**) populate operations.

#### Session cookies (`core/auth/manager.js`)
- **`getSessionConfig`**: **`cookie.secure`** is **`true`** when **`NODE_ENV === 'production'`**, **`COOKIE_SECURE === 'true'`**, or **`BASE_URL`** is **`https:`**; an explicit **`session.cookie.secure` boolean from the caller still wins.

#### CLI / tooling
- **`orm:map`**: browser **`open`** / **`xdg-open`** only after the written HTML resolves under **`process.cwd()`** or the OS temp dir (**`realpathSync`** checks).

#### Admin rich-text HTML (`plugins/admin-panel`)
- **`sanitize-html`** (dependency): model **create/update** routes sanitize **`admin.customFields`** columns with **`type: 'rich-text'`** before persistence (whitelist tuned for Quill). Nullable columns normalize empty HTML to **`null`** after sanitization.
- **`adminPanelPlugin({ richTextSanitize: false })`** disables server-side sanitization (increases XSS risk if HTML is rendered unsafely).

#### Admin rich-text emptiness (`plugins/admin-panel`)
- Shared **`lib/is-rich-text-empty.js`** with **repeat-until-stable** stripping of **`/<[^>]*>/`**; **`api.js`** imports it; **SPA bundle prepends** the same file via **`client/load-parts.js`**.

#### Tests
- **`tests/unit/admin-panel/sanitize-rich-html.test.js`**, **`tests/integration/admin-rich-text-sanitize.test.js`**: rich-text HTML sanitization behavior and **`richTextSanitize: false`** opt-out.
- **`tests/unit/cli.test.js`**: interactive **`webspresso new`** flows use **`spawnSync`** + stdin (no shell pipeline); quoted favicon args parsed with **`tokenizeCliLine`**.
- **`tests/unit/error-pages.test.js`**: custom 404 example uses **`encodeURIComponent(req.path)`** instead of raw reflection.
- **`tests/integration/admin-panel.test.js`**: rich-text empty check asserts **`isRichTextEmpty`** from the shared lib.

### Fixed

#### Standalone docs on GitHub Pages (`doc/index.html`)
- **Tailwind Play CDN** (**`cdn.tailwindcss.com`**) loads **without SRI / `crossorigin="anonymous"`** — that combination triggers **CORS** failures (redirect chain, missing **`Access-Control-Allow-Origin`**) on **`*.github.io`**.
- Inline config wrapped in **`typeof tailwind !== 'undefined'`** so a failed CDN load does not throw **`ReferenceError`**.

### Changed

#### Error pages & SSR (`src/server.js`)
- **`createErrorContext`** uses **`detectLocale(req)`** instead of **`req.query.lang`** directly (aligned with i18n allowlist behaviour).

#### File router (`src/file-router.js`)
- API route registration: removed redundant no-op **`/^\/api`** replace before **`filePathToRoute`**.

### Added

#### API routes: runtime Zod + object export
- **`schema`** on `pages/api/*.js` is applied before **`middleware`** and **`handler`**; validated data on **`req.input`**; failures **`400`** `{ error: 'Validation Error', issues }`
- Documented **object export**: `{ middleware: ['name'], schema, handler }` with **`createApp({ middlewares: { name } })`**

#### App context (`req.db`, `getDb()`, `attachDbMiddleware`)
- **`req.db`** — set on each **`pages/api/*`** request when **`createApp({ db })`** is used (before handler and per-route **`middleware`**)
- **`getDb()`**, **`hasDb()`**, **`getAppContext()`** — same instance for scripts/jobs/tests; registry filled by **`createApp`**
- **`attachDbMiddleware`** — use in **`setupRoutes`** for manually registered routes that need **`req.db`**
- **`resetAppContext()`** / **`setAppContext()`** — testing and advanced use

#### ORM: Nanoid column type
- **`zdb.nanoid()`** / **`zdb.nanoid({ maxLength })`**: URL-safe string primary key (VARCHAR in migrations; default length 21).
- **`zdb.foreignNanoid(table, opts)`**: Foreign key to a nanoid primary key (`referenceColumn`, `nullable`, `maxLength`).
- **Auto-fill on create:** Omitting the PK on `repository.create()` generates an id via built-in **`generateNanoid`** (same default alphabet as the `nanoid` package; no extra npm dependency). **`generateNanoid`** is exported from `webspresso`.
- **`zodNanoid(z, size?)`**: Zod helper for API `schema` validation (params/query/body) matching the same alphabet and length as **`generateNanoid`** / **`zdb.nanoid({ maxLength })`**.
- **`z.nanoid()`** on the `z` passed to **`schema: ({ z }) => …`**: same as **`zodNanoid`**, via **`extendZ`** (also exported). Supports **`z.nanoid()`**, **`z.nanoid(12)`**, **`z.nanoid({ maxLength: 12 })`**.
- OpenAPI, admin field renderers, and seeders recognize the `nanoid` column type.

#### Admin panel: dark mode
- **Tailwind `darkMode: 'class'`** on `<html>` with **`localStorage`** key **`webspresso-admin-theme`**: **system** (default, follows `prefers-color-scheme`), **light**, or **dark**.
- **Theme toggle** (monitor / sun / moon) in the **sidebar header** and **mobile top bar**; initial theme script in the admin HTML avoids flash.
- **UI**: `dark:` variants across admin Mithril views; **Quill** rich-text toolbar/editor styled in dark mode via scoped CSS.

#### Plugin Error Handling (Graceful Degradation)
- **Warning instead of crash**: Plugin errors do not crash the app; only `console.warn` is logged
- **Missing / incompatible dependencies**: Warning instead of throw for missing or version-mismatched `dependencies`; plugin still loads
- **Circular dependency**: Warning instead of throw when detected; plugins in the cycle are skipped
- **Duplicate / nameless plugin**: Warning instead of throw for duplicate name or missing `name`
- **`register()` and `onRoutesReady()` errors**: Wrapped in try/catch; on error a warning is logged and the server stays up
- A single faulty plugin no longer blocks the entire application

#### Site Analytics Plugin (New)
- **Self-hosted Analytics**: Privacy-first page view tracking with no external dependencies
- **Tracking Middleware**: Non-blocking Express middleware that records page views asynchronously
- **Bot Detection**: 40+ user-agent patterns (Googlebot, GPTBot, curl, Python, WhatsApp, etc.)
- **Country Detection**: Automatic country identification via CDN headers (Cloudflare, Vercel) with Accept-Language fallback
- **IP Hashing**: Privacy-first design - IP addresses are SHA-256 hashed before storage
- **Session Tracking**: Cookie-free visitor fingerprinting (IP + User-Agent hash) with 30-minute session windows
- **Auto-migration**: `analytics_page_views` table created automatically on first request
- **Admin Dashboard Page**: Full analytics page in the admin panel with:
  - Summary cards (views, visitors, unique pages, sessions)
  - Views over time chart (Chart.js line chart with daily breakdown)
  - Bot activity list with horizontal bar visualization
  - Top pages ranked by view count (scrollable, max-height container)
  - Recent activity feed with country flags and timestamps (scrollable, max-height container)
  - Country statistics with flag emojis and distribution bars
  - Date range filter (Last 7 / 30 / 90 days)
- **6 API Endpoints**: `/stats`, `/views-over-time`, `/top-pages`, `/bot-activity`, `/countries`, `/recent`
- **Database Agnostic**: Works with SQLite, PostgreSQL, and MySQL via Knex
- **Configurable**: `excludePaths`, `trackBots`, custom `tableName` options

#### Admin Panel Extensibility
- **Plugin API**: Admin panel now exposes `api` property for inter-plugin communication (`getRegistry()`, `getAdminPath()`, `serveAdminPanel`, `requireAuth`, `optionalAuth`)
- **Client Components**: New `registerClientComponent(pageId, jsCode)` method on registry for injecting custom Mithril.js page components from external plugins
- **Dynamic Page Routing**: Mithril.js router now automatically creates routes for custom pages registered via the registry
- **`hasClientComponent` Flag**: `toClientConfig()` includes `hasClientComponent` field for each page

#### Admin Module Registration System (New)
- **`registerModule(config)` API**: Declarative method on admin panel API for registering pages, menu items, API routes, widgets, and menu groups in a single call
- **Pages**: Register custom admin pages with optional Mithril.js client component code; SPA routes are created automatically
- **Menu Items & Groups**: Register sidebar menu items and collapsible groups
- **API Routes**: Define API endpoints with configurable prefix, HTTP methods, and per-route auth control (`auth: true/false`)
- **Widgets**: Register dashboard widgets with data loaders
- **Config Validation**: Clear error messages for missing or invalid configuration fields
- **Non-breaking**: Existing manual registry/route registration APIs remain fully supported; `registerModule` is a convenience layer on top
- **Site Analytics Refactored**: `site-analytics` plugin now uses `registerModule` internally, reducing ~20 lines of boilerplate to a single declarative config object

#### ctx.db - Database Access in Plugins and Pages
- **Plugin Context**: `ctx.db` available in `register(ctx)` and `onRoutesReady(ctx)` when `createApp({ db })` is used
- **Page load/meta**: `ctx.db` passed to `load(req, ctx)` and `meta(req, ctx)` in SSR route configs
- **No imports required**: Plugins and pages access the database through context without importing `createDatabase` or passing db in plugin options
- **Nullable**: `ctx.db` is `null` when db is not passed to createApp — check `if (ctx.db)` before use

#### Admin Panel - Mobile Responsive Sidebar
- **Hamburger Menu**: Mobile header with hamburger button for sidebar toggle on small screens
- **Slide-in Sidebar**: Sidebar slides in from the left with `translate-x` animation on mobile
- **Backdrop Overlay**: Semi-transparent dark overlay behind sidebar when open on mobile
- **Close Button**: X button in sidebar header for closing on mobile (visible only on `< lg`)
- **Auto-close on Navigation**: Sidebar automatically closes when a menu item is clicked
- **Responsive Layout**: Main content area uses `lg:ml-64` (desktop sidebar offset) and `pt-20` (mobile header offset) for proper responsive spacing
- **Z-index Layering**: Proper stacking order - mobile header (z-20), backdrop (z-30), sidebar (z-40)

#### Sitemap Plugin v2.0 - Dynamic Database Content
- **Dynamic Sources**: Generate sitemap URLs from database records using `dynamicSources` option
- **Model-based URLs**: Automatically fetch records from ORM models and generate URLs
- **Custom Query Support**: Use custom query functions for complex filtering and joins
- **URL Pattern Placeholders**: Support for `:param` and `[param]` style placeholders
- **Field Mapping**: Map URL placeholders to different database field names
- **Filter Function**: Filter which records appear in sitemap
- **Transform Function**: Transform records before URL generation
- **Caching**: Configurable cache with `cacheMaxAge` option (default: 5 minutes)
- **Cache Invalidation**: `api.invalidateCache()` method for manual cache clearing
- **New API Methods**: `addDynamicSource()`, `getDynamicSources()`, `invalidateCache()`
- **Per-source i18n Control**: Disable i18n for specific sources with `i18n: false`

#### Server Enhancements
- **Request Timeout**: Added `connect-timeout` middleware with configurable timeout (default: 30s)
- **Timeout Options**: `timeout` option in `createApp()` to configure or disable request timeout
- **Timeout Error Pages**: Custom 503 error page support via `errorPages.timeout`
- **Graceful Timeout Handling**: Proper request termination with `haltOnTimedout` helper

#### Script Injection System
- **ScriptInjector Class**: New class for managing dynamic content injection into templates
- **Head Injection**: `fsy.injectHead()` helper to inject content into `<head>` section
- **Body Injection**: `fsy.injectBody()` helper to inject content at end of `<body>`
- **Style Injection**: Inject CSS styles dynamically from plugins
- **Priority Sorting**: Content sorted by priority (higher priority first)
- **Plugin API**: `ctx.injectHead()`, `ctx.injectBody()`, `ctx.injectStyle()` methods for plugins

#### Dev Toolbar
- **Development Toolbar**: Fixed toolbar at bottom of page in development mode
- **Quick Links**: Default links to Dashboard, Admin Panel, Schema Explorer
- **Plugin Registration**: Plugins can register custom links via `ctx.registerDevLink()`
- **Hover Expand**: Toolbar expands on hover, minimized by default
- **Modern Design**: Dark theme with gradient background and smooth animations
- **Auto-hide in Production**: Toolbar automatically hidden in production mode

#### Admin Panel Filter Redesign
- **Descriptive Filter Operators**: Changed symbols (~, =, >, etc.) to readable text (Contains, Equals, Greater than)
- **Quick Filters Bar**: Search input and "All Filters" button above table
- **Filter Drawer**: Slide-in panel for advanced filtering options
- **Boolean Filter UI**: Radio buttons (Yes/No/Any) for boolean field filtering
- **Active Filters Display**: Badge-style display of currently applied filters

#### SEO Checker Plugin (New)
- **Client-side SEO Analysis**: Inspired by django-check-seo, performs 40+ SEO checks in browser
- **7 Check Categories**: Meta, Headings, Content, Links, Images, Structured Data, URL
- **Meta Checks**: Title/description length, canonical, viewport, robots, charset, language
- **Heading Checks**: H1 existence/uniqueness, heading hierarchy, non-empty headings
- **Content Checks**: Word count, paragraph structure, keyword usage and placement
- **Link Checks**: Internal/external links, nofollow analysis, anchor text quality
- **Image Checks**: Alt text, descriptive alt, dimensions, lazy loading
- **Structured Data Checks**: Open Graph, Twitter Card, JSON-LD, hreflang
- **URL Checks**: Length, depth, readability, HTTPS
- **Score Calculation**: Overall SEO score (0-100) based on weighted checks
- **Dev Toolbar Integration**: "SEO Check" button in dev toolbar
- **Floating Panel**: Beautiful dark-themed floating panel with category tabs
- **Configurable Settings**: Customize thresholds for title length, word count, etc.
- **Auto-disabled in Production**: Only active in development mode

### Fixed

#### Admin panel: Quill / CSP
- **jsDelivr in CSP**: `cdn.quilljs.com` now redirects to `cdn.jsdelivr.net`; plugin CSP includes **`https://cdn.jsdelivr.net`** for `style-src`, `script-src`, and `connect-src` so the rich-text editor (Quill) loads in production.

#### ORM Boolean Field Handling
- **SQLite Boolean Coercion**: Fixed `z.boolean()` validation failing with SQLite's 0/1 values
- **String Boolean Support**: Added support for string values ('true', 'false', '0', '1')
- **Preprocess Integration**: Used `z.preprocess()` for automatic type conversion before validation

### Changed
- **Sitemap Plugin Version**: Bumped to 2.0.0 with breaking changes in dynamic URL handling

#### W-Runtime (Experimental)
- **Resumability**: Zero JavaScript execution on page load, islands hydrate lazily on first interaction
- **Event Delegation**: Only 3 global event listeners (click, input, submit) instead of N listeners per element
- **Lazy Hydration**: Islands hydrate only when needed, unused islands never load
- **Attribute-based bindings**: `w-root`, `w-model`, `w-text`, `w-show`, `w-hide`, `w-disabled`, `w-on:click`, `w-on:submit`
- **Backend-driven configuration**: Island state and actions defined server-side as JSON descriptors
- **Descriptor-based actions**: `apiCall` action type for declarative API calls
- **SSR-friendly**: Config embedded as JSON in HTML, initial values rendered server-side
- **Runtime API**: `w.resume()`, `w.init()`, `w.hydrate()`, `w.getStats()` methods
- **Performance**: ~6.6x faster Time to Interactive (TTI), ~20x less initial JS execution

#### Template Helpers
- **dayjs integration**: Added dayjs as a core dependency for date/time manipulation in templates
- **Date helpers**: `fsy.date()`, `fsy.dateFormat()`, `fsy.dateFromNow()`, `fsy.dateAgo()`, `fsy.dateUntil()`
- **Date comparison**: `fsy.dateIsBefore()`, `fsy.dateIsAfter()`, `fsy.dateIsSame()`
- **Date arithmetic**: `fsy.dateAdd()`, `fsy.dateSubtract()`, `fsy.dateDiff()`
- **Date utilities**: `fsy.dateStartOf()`, `fsy.dateEndOf()`
- **Full dayjs API**: Access full dayjs functionality via `fsy.date()` which returns a dayjs instance
- **Plugins included**: relativeTime, utc, timezone, customParseFormat

#### CLI Enhancements
- **Interactive project creation**: `webspresso new` command now accepts optional project name
- **Current directory installation**: Prompt to install in current directory when no project name provided
- **Project name validation**: Interactive prompts for project name when using current directory
- **Better error handling**: Warnings when current directory is not empty or already contains Webspresso project
- **Interactive installation flow**: After project creation, prompts to install dependencies and build CSS
- **Auto dev server start**: Option to automatically start development server after installation
- **CSS watch integration**: Dev server automatically includes `watch:css` when Tailwind is enabled
- **Seed CLI command**: `webspresso seed` command for existing projects to run database seeders
- **Seed setup option**: `--setup` flag to automatically create seed files if they don't exist
- **Automatic seed execution**: Seed command automatically loads models and generates fake data
- **Database selection**: Interactive prompt to select database (SQLite, PostgreSQL, MySQL) during project creation
- **Database driver installation**: Automatically adds appropriate database driver (`better-sqlite3`, `pg`, `mysql2`) to `package.json`
- **Database config generation**: Creates `webspresso.db.js` with proper configuration for selected database
- **Migrations directory**: Automatically creates `migrations/` directory when database is selected
- **Models directory**: Automatically creates `models/` directory when database is selected
- **Seed data generation**: Interactive prompt to generate seed data based on existing models
- **Automatic seed setup**: When seed is selected, adds `@faker-js/faker` dependency and creates `seeds/index.js` with auto-detection
- **Seed script**: Adds `npm run seed` command to `package.json` for easy seed execution
- **Smart model detection**: Seed script automatically loads all models from `models/` directory and generates fake data
- **DATABASE_URL in .env.example**: Adds appropriate `DATABASE_URL` template to `.env.example` based on selected database
- **Streamlined workflow**: `webspresso new` → database selection → seed setup → install → build → dev server (with CSS watch) in one flow
- **--install flag enhancement**: Now also prompts for dev server start (previously only installed dependencies)

#### Documentation
- **W-Runtime documentation**: Complete guide with examples, resumability explanation, and limitations
- **CLI documentation**: Updated `new` command documentation with interactive mode examples

#### Testing
- **W-Runtime unit tests**: 41 comprehensive tests covering path utilities, island hydration, action descriptors, and integration scenarios
- **CLI test updates**: Tests for interactive mode, optional parameters, and error handling

### Changed

- **CLI `new` command**: Project name parameter is now optional (`[project-name]` instead of `<project-name>`)
- **README**: Added W-Runtime section with resumability explanation and performance metrics

### Technical Details

#### W-Runtime Implementation
- **File**: `public/w-runtime.js` (~515 lines)
- **Resumability pattern**: Inspired by Qwik framework
- **Island cache**: WeakMap-based for garbage collection friendly storage
- **Event delegation**: Single global listener per event type with `closest()` traversal
- **State management**: Simple object-based state with path resolution (`state.a`, `state.user.name`)
- **Rerender strategy**: Full rerender on any state change (no dependency tracking in v0)

#### Performance Metrics
| Metric | Before (Hydration) | After (Resumability) | Improvement |
|--------|-------------------|---------------------|-------------|
| Time to Interactive | ~100ms | ~15ms | **6.6x faster** |
| Initial JS Execution | 40ms | 2ms | **20x faster** |
| Event Listeners | 50+ | 3 | **17x fewer** |
| Memory (10 islands) | ~500KB | ~50KB* | **10x less** |

*Only hydrated islands consume memory

## [0.0.7] - 2025-01-07

### Added
- File-based routing with dynamic routes (`[param]`, `[...rest]`)
- API endpoints with method suffixes (`.get.js`, `.post.js`, etc.)
- Zod-based request validation for body, params, and query
- Built-in i18n with JSON-based translations
- Lifecycle hooks (global and route-level)
- Template helpers (Laravel-inspired)
- Plugin system with version control
- Built-in plugins: dashboard, sitemap, analytics
- ORM with Knex integration
- Database migrations CLI commands
- Schema explorer plugin

### Changed
- Initial release structure

---

## Version History

- **0.0.7**: Core framework with routing, ORM, plugins
- **Unreleased**: W-Runtime (experimental), CLI improvements, site analytics plugin, admin panel extensibility

---

## Notes

- W-Runtime is in **experimental** stage. API may change without notice.
- Resumability requires SSR to render initial values in HTML for immediate display.
- Interactive CLI mode requires terminal input, automated testing is limited.

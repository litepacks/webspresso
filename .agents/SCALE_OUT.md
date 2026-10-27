# Stateless Scale-Out & Database Connection Pool Management Guide

When deploying Webspresso to serverless or auto-scaling cloud environments (Google Cloud Run, AWS App Runner, ECS Fargate, AWS Lambda, Kubernetes, or PM2 Cluster), multiple container instances run concurrently and scale up/down dynamically.

To ensure seamless operation without lost user sessions or database exhaustion, Webspresso provides native built-in **Stateless Scale-Out** primitives:
1. **Distributed Redis Session Store** (`createRedisSessionStore`)
2. **Distributed Redis Session & Device Tracker** (`createRedisSessionTracker`)
3. **Built-in Lightweight RESP Redis Client** (`createMiniRedisClient`) & `InMemoryRedisClient`
4. **Serverless Database Connection Pool Optimizer** (`normalizeServerlessPoolConfig`, `isServerlessEnvironment`)

---

## 🎯 Key Capabilities

### 1. Distributed Redis Session Store (`createRedisSessionStore`)
- Drop-in replacement for `express-session` MemoryStore.
- Stores session data in Redis with automatic TTL expiration synced to session cookies (`maxAge`).
- Implements the complete `express-session` Store contract: `get`, `set`, `destroy`, `touch`, `all`, `length`, `clear`.
- Zero external dependencies: works with any standard client (`ioredis`, `redis` v4/v3, or the built-in `createMiniRedisClient`).
- **Auto-Detection**: Setting `REDIS_URL=redis://...` or `SESSION_STORE=redis` in your environment automatically wires the Redis session store without manual boilerplate!

### 2. Distributed Redis Device & Session Tracker (`createRedisSessionTracker`)
- Replaces or supplements Knex database session tracking across ephemeral instances.
- Maintains user active sessions (`user:sessions:<userId>`) and device metadata (`sess:device:<sessionId>`).
- Supports remote single-session revocation, "revoke other sessions", and "force logout from all devices".

### 3. Serverless DB Connection Pool Optimizer (`normalizeServerlessPoolConfig`)
- Prevents database connection exhaustion on managed databases (Google Cloud SQL, AWS RDS / Aurora) when container replicas scale from 1 to 50+.
- Automatically detects serverless platforms (`K_SERVICE` on Cloud Run, `AWS_EXECUTION_ENV` / `AWS_LAMBDA_FUNCTION_NAME` on AWS):
  - Sets `pool.min: 0` (so idle containers release database sockets).
  - Clamps `pool.max: 5` (or `2` on Lambda) per container instance.
  - Reduces `acquireTimeoutMillis` from Knex's 60s default to 10s.
  - Sets safe `idleTimeoutMillis: 30000`, `createTimeoutMillis: 5000`.

---

## 🚀 Quick Start & Usage

### 1. Zero-Configuration Cloud Run / ECS Deployment

Simply provide `REDIS_URL` in your container environment variables:

```bash
# In Cloud Run or AWS ECS Task Definition
REDIS_URL=redis://default:secret@memorystore-or-elasticache:6379
SESSION_SECRET=a_very_secure_random_production_secret_32_chars
```

Webspresso automatically detects `REDIS_URL` and activates both `createRedisSessionStore` and `normalizeServerlessPoolConfig`.

---

### 2. Explicit Auth Session Configuration

```javascript
// server.js
const { createApp, createRedisSessionStore } = require('webspresso');

const app = createApp({
  auth: {
    session: {
      secret: process.env.SESSION_SECRET,
      // Pass custom store or let Webspresso auto-detect REDIS_URL
      store: createRedisSessionStore({
        url: process.env.REDIS_URL,
        prefix: 'myapp:sess:',
        ttl: 86400, // 24 hours
      }),
    },
  },
  server: {
    compression: true,
  },
});
```

---

### 3. Explicit Database Connection Pool Configuration

```javascript
// webspresso.db.js
module.exports = {
  client: 'pg',
  connection: process.env.DATABASE_URL,
  // Enable serverless pool optimization explicitly
  serverlessPool: true,
  pool: {
    // Override defaults if using a pooler like PgBouncer or RDS Proxy
    min: 0,
    max: 5,
  },
};
```

---

### 4. Production Preflight Audit (`webspresso deploy:check`)

Run the preflight check before deploying to verify that your session store and connection pool are properly configured for scale-out:

```bash
npx webspresso deploy:check
```

The preflight check will:
- ✅ Verify distributed session store (Redis) is active in production instead of ephemeral MemoryStore.
- ⚠️ Flag database connection pools with excessively large `max` (> 10) on autoscaling serverless containers.
- ⚠️ Check that `pool.min` is set to 0 for serverless scale-to-zero workloads.

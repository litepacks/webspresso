# Cloud & Kubernetes Health & Readiness Probes (`core/health`)

Webspresso includes a built-in, Docker & Kubernetes-native health inspection system. It provides standard liveness (`/healthz`), readiness (`/readyz`), and combined diagnostics endpoints with automatic database pings, background worker queue checks, event loop delay metrics, and instant graceful shutdown draining integration.

---

## 🎯 Key Capabilities

1. **Kubernetes Liveness Probe (`/healthz`)**:
   - Confirms process vitality and responsiveness.
   - Gathers memory footprint (`rss`, `heapUsed`, `heapTotal` formatted and raw bytes), process uptime, PID, platform, and event loop lag statistics (`meanMs`, `maxMs`, `p99Ms`).
   - If event loop delay exceeds threshold (`eventLoopThresholdMs`), flags status as `degraded`.

2. **Kubernetes Readiness Probe (`/readyz`)**:
   - Confirms the container is fully prepared to handle live client traffic.
   - **Database Connectivity**: Pings active Knex instance (`SELECT 1`) with timeout protection.
   - **Queue Readiness**: Probes worker queue instance status.
   - **Custom Probes**: Executes user-registered async checks concurrently (`checks: { redis, stripe }`).
   - Returns `HTTP 200` (`{ ready: true, status: 'ready' }`) when all components are healthy.
   - Returns `HTTP 503` (`{ ready: false, status: 'unhealthy', checks: ... }`) if any component fails.

3. **Graceful Draining Integration (`ShutdownManager`)**:
   - As soon as the server enters shutdown draining (`app.close()` or `SIGTERM`/`SIGINT`), `/readyz` immediately returns `HTTP 503` (`{ ready: false, status: 'draining' }`).
   - Cloud load balancers (AWS ALB, K8s Ingress, Google Cloud, Cloudflare) immediately stop routing new traffic to this instance, while existing active requests drain cleanly without dropping a single connection.

---

## 🚀 Configuration Examples

### 1. Simple Enablement

```javascript
const { createApp } = require('webspresso');

const app = createApp({
  pagesDir: 'pages',
  // Enables /healthz (liveness), /readyz (readiness), and /health (combined)
  healthCheck: true,
});
```

Shorthand custom path:
```javascript
const app = createApp({
  pagesDir: 'pages',
  healthCheck: '/api/status', // Mounts combined status on /api/status
});
```

### 2. Full Production Configuration

```javascript
const app = createApp({
  pagesDir: 'pages',
  db: myDatabaseInstance,
  queue: myQueueInstance,
  healthCheck: {
    enabled: true,
    path: '/healthz',               // Liveness probe URL
    readyPath: '/readyz',           // Readiness probe URL
    combinedPath: '/health',        // Diagnostic summary URL
    db: true,                       // Automatically probe database (SELECT 1)
    queue: true,                    // Automatically probe worker queue
    eventLoopLag: true,             // Monitor event loop delay
    eventLoopThresholdMs: 300,      // Lag threshold in ms
    timeoutMs: 2500,                // Probe timeout before marking down
    checks: {                       // Custom dependency probes
      redis: async () => redisClient.ping(),
      stripe: async () => checkStripeHealth(),
    },
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  },
});
```

---

## ☸️ Kubernetes Pod Spec Example

```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /readyz
    port: 3000
  initialDelaySeconds: 2
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 2
```

---

## 🔍 Programmatic Inspection

Access health state directly in code or CLI scripts:

```javascript
// Get complete diagnostic payload
const status = await app.getHealthStatus();
console.log('Liveness:', status.liveness);
console.log('Readiness:', status.readiness);

// Or via healthManager
const liveness = await app.healthManager.getLiveness();
const readiness = await app.healthManager.getReadiness();
```

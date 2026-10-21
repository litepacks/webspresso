# Cloud Metrics & Distributed Tracing Guide

Webspresso provides an enterprise-grade, zero-dependency Cloud Metrics & Distributed Tracing engine (`core/metrics`) delivering Prometheus exposition format (`/metrics`), JSON telemetry (`/metrics.json`), HTTP latency histograms, and W3C/GCP/AWS distributed tracing header propagation.

---

## 🎯 Key Capabilities

1. **Prometheus-Compatible Exposition Format**:
   - Zero external dependencies (no `prom-client` or OpenTelemetry npm packages required).
   - Generates compliant `text/plain; version=0.0.4; charset=utf-8` output directly consumable by Prometheus, Grafana Agent, Google Cloud Managed Service for Prometheus, AWS CloudWatch Container Insights, and Datadog.
   - Dual-format exposition: `/metrics` for Prometheus scraping and `/metrics.json` (or `Accept: application/json`) for programmatic inspection or lightweight dashboards.
2. **Distributed Tracing & W3C Propagation**:
   - Parses incoming tracing headers automatically (`traceparent`, `x-cloud-trace-context`, `x-amzn-trace-id`, `x-request-id`).
   - Automatically injects `x-trace-id` and W3C `traceparent` (`00-${traceId}-${spanId}-01`) onto outgoing HTTP response headers.
   - Attaches `req.traceId` and `req.spanId` to the incoming request object for seamless correlation with `req.logger`.
3. **Core HTTP Request Telemetry**:
   - `webspresso_http_requests_total{method, route, status}`: Counter for all processed HTTP requests.
   - `webspresso_http_request_duration_seconds{method, route}`: Latency histogram with cumulative buckets, `_sum`, and `_count`.
   - `webspresso_http_active_requests`: Gauge tracking in-flight concurrent requests.
   - **Noise-free scraping**: Internal scrape calls to `/metrics`, `/metrics.json`, and `/healthz` are excluded from HTTP latency counters to prevent self-polluting metrics graphs.
4. **Automated Node.js & Framework Collectors**:
   - **Process & Memory**: `process_uptime_seconds`, `nodejs_heap_size_used_bytes`, `nodejs_heap_size_total_bytes`, `process_resident_memory_bytes`, `nodejs_external_memory_bytes`.
   - **CPU**: `process_cpu_user_seconds_total`, `process_cpu_system_seconds_total`.
   - **Event Loop Lag**: `nodejs_eventloop_lag_seconds{quantile="0.50|0.99|max"}` via native `perf_hooks.monitorEventLoopDelay`.
   - **Database Connection Pool**: `webspresso_db_pool_size`, `webspresso_db_pool_used`, `webspresso_db_pool_available` (Knex pool).
   - **In-Memory Cache**: `webspresso_cache_entries`, `webspresso_cache_bytes` (LRU cache).
   - **Circuit Breakers**: `webspresso_circuit_breaker_state{name}` (0=closed, 1=half-open, 2=open), `webspresso_circuit_breaker_failures_total{name}`.
5. **Security & Gating**:
   - Protect metrics endpoints with bearer token authentication (`auth: 'secret-token'`).

---

## 🚀 Configuration & Enabling Metrics

### 1. Enabling via `createApp`

```javascript
const { createApp } = require('webspresso');

const { app } = createApp({
  pagesDir: './pages',
  metrics: {
    enabled: true,                // default: true if metrics option is passed
    path: '/metrics',             // default: '/metrics'
    collectDefault: true,         // default: true (system, memory, pool, cache, lag)
    traceHeader: true,            // default: true (x-trace-id, traceparent)
    auth: process.env.METRICS_TOKEN || null, // Optional Bearer token protection
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  },
});
```

Or enable with shorthand:

```javascript
createApp({
  metrics: true, // mounts /metrics and /metrics.json with defaults
});
```

---

## 📊 Custom Application Metrics

Application routes, services, and plugins can register and record custom domain metrics via `app.metrics` or `req.metrics`:

```javascript
// Register a custom counter
const orderCounter = app.metrics.counter(
  'shop_orders_placed_total',
  'Total number of completed customer orders'
);

// Register a custom gauge
const activeUsersGauge = app.metrics.gauge(
  'shop_active_cart_sessions',
  'Number of carts currently active'
);

// In an API handler
// pages/api/checkout.post.js
module.exports = defineApi({
  handler: async (req, res) => {
    const order = await req.service('order.create', req.body);
    
    // Increment domain metric
    orderCounter.inc({ plan: order.plan, currency: order.currency }, 1);
    
    return res.status(201).json(order);
  },
});
```

---

## 🛡️ Standalone Registry Usage

```javascript
const { createMetricsRegistry } = require('webspresso');

const registry = createMetricsRegistry();

const counter = registry.counter('jobs_processed_total', 'Jobs processed by worker');
counter.inc({ queue: 'email', status: 'success' }, 1);

const histogram = registry.histogram('job_execution_duration_seconds', 'Job execution duration', [0.1, 0.5, 1, 5]);
histogram.observe({ queue: 'email' }, 0.24);

// Format output
console.log(registry.formatPrometheus());
console.log(JSON.stringify(registry.formatJson(), null, 2));
```

---

## 📈 Prometheus Scrape Configuration (`prometheus.yml`)

```yaml
scrape_configs:
  - job_name: 'webspresso-app'
    scrape_interval: 15s
    metrics_path: '/metrics'
    bearer_token: 'YOUR_METRICS_TOKEN' # if auth is enabled
    static_configs:
      - targets: ['localhost:3000']
```

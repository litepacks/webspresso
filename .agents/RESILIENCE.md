# Enterprise Resilience, Circuit Breaker & Retry Engine (`core/resilience`)

Webspresso includes a built-in, enterprise-grade resilience and fault tolerance engine built directly on native Node.js primitives (`events`, `perf_hooks`, `async_hooks`). It prevents cascading downstream outages, protects critical services, and recovers automatically from transient network spikes.

---

## 🚦 Architectural Overview

```
                      ┌───────────────────────────────────────┐
                      │            Incoming Request           │
                      └───────────────────┬───────────────────┘
                                          │
                                          ▼
                      ┌───────────────────────────────────────┐
                      │    Circuit Breaker (Fast Fail / OPEN) │
                      └───────┬───────────────────────▲───────┘
                     (Closed) │                       │ (Trips on failure)
                              ▼                       │
                      ┌───────────────────────────────┴───────┐
                      │    Retry Engine (Backoff + Jitter)    │
                      └───────┬───────────────────────▲───────┘
                     (Attempt)│                       │ (Transient Error)
                              ▼                       │
                      ┌───────────────────────────────┴───────┐
                      │   Service Handler / Remote Upstream   │
                      └───────────────────────────────────────┘
```

1. **State Machine (`CircuitBreaker`)**:
   - `CLOSED`: Normal operation. Requests pass through. Failures are tracked in a rolling time window.
   - `OPEN`: Downstream is degraded/unhealthy. Subsequent calls **fail fast immediately** with `CircuitBreakerOpenError` (HTTP 503) without hitting the downstream resource, or return a predefined `fallback`.
   - `HALF_OPEN`: Trial recovery state entered automatically once `resetTimeout` elapses. A controlled number of probe requests (`successThreshold`) test the downstream. If they succeed, the breaker resets to `CLOSED`. If any probe fails, it trips back to `OPEN`.

2. **Retry with Exponential Backoff & Full Jitter (`retry`, `withRetry`)**:
   - Automatically retries transient network errors (`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, 429 Too Many Requests, and 5xx Gateway errors).
   - Skips client-side 4xx errors (e.g. 400 Bad Request, 401, 403, 404, 422) since retrying client errors produces identical failures.
   - Full jitter prevents synchronization spikes (the "thundering herd" problem) against recovering third-party services.
   - Respects `AbortSignal` for cancellation.

3. **Seamless Services Layer Integration**:
   - Declare `circuitBreaker` and `retry` declaratively inside `defineService({ ... })`.
   - Automatically protects service calls from SSR pages, API routes, or worker jobs.

---

## 🛠️ Quick Start & Usage Examples

### 1. Declarative Service Protection (`defineService`)

```javascript
const { defineService } = require('webspresso');

module.exports = defineService({
  // Automatic retry on transient network errors
  retry: {
    retries: 3,
    delay: '100ms',
    factor: 2,
    jitter: true,
  },

  // Circuit breaker with fast-fail and graceful fallback
  circuitBreaker: {
    failureThreshold: 3,          // Open after 3 consecutive failures
    failureRateThreshold: 0.5,    // Or if >= 50% fail in rolling window
    rollingWindow: '10s',         // 10-second sample window
    resetTimeout: '15s',          // Stay open for 15s before trial recovery
    timeout: '3s',                // Per-call execution timeout (ms or string)
    fallback: (err, input) => {
      // Graceful fallback returned when OPEN or when all retries fail
      return { fromCache: true, id: input.id, data: null, degraded: true };
    },
  },

  schema: ({ z }) => ({
    id: z.string(),
  }),

  handler: async (input, ctx) => {
    // Call external payment or inventory API
    const response = await fetch(`https://api.external.com/items/${input.id}`);
    if (!response.ok) {
      const err = new Error(`Upstream API responded with status ${response.status}`);
      err.statusCode = response.status;
      throw err;
    }
    return await response.json();
  },
});
```

### 2. Standalone Circuit Breaker Usage

```javascript
const { createCircuitBreaker } = require('webspresso');

const paymentBreaker = createCircuitBreaker({
  name: 'stripe-gateway',
  failureThreshold: 5,
  resetTimeout: '30s',
  timeout: '5s',
  fallback: (err) => {
    return { status: 'queued_offline', message: 'Payment queued for processing' };
  },
});

// Execute async function wrapped by breaker
const result = await paymentBreaker.execute(async () => {
  return await stripeClient.charges.create({ ... });
});

// Or wrap a function
const safeCharge = paymentBreaker.wrap(chargeFunction);
await safeCharge(args);
```

### 3. Standalone Retry Engine (`retry`)

```javascript
const { retry, isTransientError } = require('webspresso');

const data = await retry(
  async (attempt) => {
    return await fetchRemoteData();
  },
  {
    retries: 3,
    delay: 200,          // Initial 200ms delay
    factor: 2,           // 200ms -> 400ms -> 800ms
    jitter: true,        // Randomized jitter
    onRetry: ({ attempt, error, delayMs }) => {
      console.warn(`Retry attempt ${attempt} after error: ${error.message} (waiting ${delayMs}ms)`);
    },
  }
);
```

### 4. Accessing Breakers & Retry from Route Handlers & Context

In API routes and SSR loaders:

```javascript
// Inside API route handler or SSR loader
export async function handler(req, res) {
  // Named circuit breaker from central registry
  const crmBreaker = req.breaker('hubspot-api', { failureThreshold: 3 });

  // Retry engine available on req
  const lead = await req.retry(async () => {
    return await pushLeadToCrm(req.body);
  }, { retries: 2 });

  return res.json(lead);
}
```

In services handlers (`ctx`):

```javascript
module.exports = defineService({
  handler: async (input, ctx) => {
    // Access circuit breaker
    const breaker = ctx.breaker('custom-api');
    
    // Access retry helper
    return await ctx.retry(async (attempt) => {
      return await queryDownstream();
    });
  },
});
```

---

## ⚙️ Configuration Reference

### `CircuitBreakerOptions`

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | `'default'` | Identifier for logging and registry lookup. |
| `failureThreshold` | `number` | `5` | Consecutive failures before opening circuit. |
| `failureRateThreshold` | `number` | `null` | Failure rate (0.01 - 1.0) in rolling window to open circuit (e.g. `0.5` = 50%). |
| `minimumRequests` | `number` | `5` | Minimum calls in rolling window before failure rate check activates. |
| `rollingWindow` | `number \| string` | `10000` (10s) | Rolling time window for metrics sample pruning. |
| `successThreshold` | `number` | `2` | Consecutive successes in `HALF_OPEN` state required to close circuit. |
| `resetTimeout` | `number \| string` | `10000` (10s) | Duration circuit stays `OPEN` before attempting `HALF_OPEN` probe. |
| `timeout` | `number \| string` | `0` (disabled) | Per-call execution timeout in milliseconds or duration string (`'2s'`). |
| `fallback` | `Function` | `null` | Fallback handler `(error, ...args) => any` called when `OPEN` or call fails. |
| `isFailure` | `Function` | `defaultIsFailure` | Predicate `(error) => boolean`. By default ignores 4xx client errors (except 429). |
| `onStateChange` | `Function` | `null` | Callback `(fromState, toState, breaker) => void`. |

### `RetryOptions`

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `retries` | `number` | `3` | Maximum retry attempts before giving up. |
| `delay` / `minTimeout` | `number \| string` | `100` | Initial delay in ms or duration string (`'100ms'`). |
| `maxTimeout` | `number \| string` | `10000` (10s) | Maximum capped delay for exponential backoff. |
| `factor` | `number` | `2` | Exponential backoff multiplier. |
| `jitter` | `boolean` | `true` | Apply full randomized jitter (`Math.random() * delay`). |
| `shouldRetry` | `Function` | `isTransientError` | Predicate `(error, attempt) => boolean`. Retries network/5xx/429 errors. |
| `onRetry` | `Function` | `null` | Hook `({ attempt, error, delayMs }) => void`. |
| `signal` | `AbortSignal` | `null` | Optional signal to cancel pending retry delays immediately. |

---

## 📊 Telemetry & Monitoring

Inspect health and failure metrics at any time:

```javascript
// Breaker instance stats
const stats = breaker.getStats();
// {
//   name: 'stripe-gateway',
//   state: 'CLOSED',
//   totalCalls: 120,
//   successfulCalls: 118,
//   failedCalls: 2,
//   rejectedCalls: 0,
//   timedOutCalls: 0,
//   fallbackCalls: 0,
//   consecutiveFailures: 0,
//   consecutiveSuccesses: 118,
//   failureRate: 0.016,
//   lastFailureTime: 1713430000000,
//   lastSuccessTime: 1713430001000,
//   lastStateChange: 1713429000000
// }

// Global registry stats across all breakers
const allStats = app.breakers.getStats();
```

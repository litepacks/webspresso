# Structured Cloud Logging & Distributed Tracing Guide

Webspresso features an enterprise, built-in Structured Cloud Logger (`core/logger`) designed specifically for serverless and containerized cloud platforms (Google Cloud Run, AWS App Runner, ECS Fargate, Lambda, Kubernetes).

---

## 🎯 Key Capabilities

1. **Native Cloud Platform Detection & Formatting**:
   - **Google Cloud Platform (`format: 'gcp'`)**: Automatically emits JSON payloads with Google Cloud Logging `severity` levels (`DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`), `logging.googleapis.com/trace`, `logging.googleapis.com/spanId`, and RFC `httpRequest` metadata.
   - **Amazon Web Services (`format: 'aws'`)**: Formats logs with `level`, `requestId`, `xrayTraceId`, and `http` metrics compatible with AWS CloudWatch and AWS X-Ray.
   - **Standard JSON (`format: 'json'`)**: Compact, structured single-line JSON stream for Docker, Kubernetes, and Datadog.
   - **Development Pretty (`format: 'pretty'`)**: Fast, ANSI color-coded console logs for local developer happiness.
2. **Distributed Tracing Context Propagation**:
   - Parses incoming request trace headers automatically:
     - `x-cloud-trace-context` (Google Cloud Trace)
     - `x-amzn-trace-id` (AWS X-Ray)
     - `traceparent` (W3C standard)
     - `x-request-id` / `x-correlation-id`
   - Injects trace ID and span ID into every log statement emitted during the request lifecycle.
3. **Automatic Child Logger on Requests (`req.logger`)**:
   - In API route handlers and SSR page loaders, `req.logger` is pre-bound to the request's trace ID and contextual metadata.
   - Automatically logs HTTP access on request finish (`res.on('finish')`) with latency, status code, remote IP, and user-agent.
4. **Deep Sensitive Key Redaction**:
   - Recursively masks sensitive fields (`password`, `token`, `secret`, `authorization`, `cookie`, `apiKey`) to prevent accidental credential leakage in cloud log aggregation systems.

---

## 🚀 Usage in Application Code

### In API Route Handlers

```javascript
// pages/api/orders.post.js
const { defineApi } = require('webspresso');

module.exports = defineApi({
  schema: ({ z }) => ({
    body: z.object({ amount: z.number().positive(), customerId: z.string() }),
  }),
  handler: async (req, res) => {
    // req.logger is automatically bound to the request's trace ID
    req.logger.info('Processing order checkout', {
      customerId: req.input.body.customerId,
      amount: req.input.body.amount,
    });

    try {
      const order = await req.service('order.create', req.input.body);
      req.logger.info('Order processed successfully', { orderId: order.id });
      return res.status(201).json(order);
    } catch (err) {
      req.logger.error('Failed to process order', { error: err.message });
      throw err;
    }
  },
});
```

### Standalone Logger & Child Context

```javascript
const { createLogger } = require('webspresso');

const logger = createLogger({
  format: 'auto', // 'gcp' | 'aws' | 'json' | 'pretty'
  level: 'info',
  defaultMeta: { service: 'payment-worker' },
  project: 'my-gcp-project', // optional GCP project ID
});

logger.info('Worker started');

// Create contextual child logger
const jobLogger = logger.child({ jobId: 'job_42' });
jobLogger.info('Task execution started');
```

### Configuration in `createApp`

```javascript
const { createApp } = require('webspresso');

const app = createApp({
  pagesDir: './pages',
  logger: {
    format: 'auto', // Auto-detected from K_SERVICE, AWS_EXECUTION_ENV, or NODE_ENV
    level: 'info',
    exclude: ['/healthz', '/readyz', '/favicon.ico'],
    redact: ['password', 'secret', 'token'],
  },
});
```

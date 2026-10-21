import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const express = require('express');
const request = require('supertest');
const { Writable } = require('stream');

const {
  CloudLogger,
  createLogger,
  createLogMiddleware,
  extractTraceContext,
  autoDetectFormat,
} = require('../../core/logger');

const {
  formatGcp,
  formatAws,
  formatJson,
  formatPretty,
  redactSensitive,
} = require('../../core/logger/formatters');

class MemoryStream extends Writable {
  constructor() {
    super();
    this.lines = [];
  }
  _write(chunk, encoding, callback) {
    this.lines.push(chunk.toString().trim());
    callback();
  }
  getLastJson() {
    if (this.lines.length === 0) return null;
    try {
      return JSON.parse(this.lines[this.lines.length - 1]);
    } catch (_) {
      return null;
    }
  }
}

describe('Structured Cloud Logging (core/logger)', () => {
  // ========================================================
  // 1. Trace Context Extraction
  // ========================================================
  describe('Trace Context Extraction (extractTraceContext)', () => {
    it('extracts Google Cloud Trace context from x-cloud-trace-context', () => {
      const req = {
        headers: {
          'x-cloud-trace-context': '105445aa7843bc8bf206b120001000/12345;o=1',
        },
      };

      const ctx = extractTraceContext(req);
      expect(ctx.platform).toBe('gcp');
      expect(ctx.traceId).toBe('105445aa7843bc8bf206b120001000');
      expect(ctx.spanId).toBe('12345');
      expect(ctx.sampled).toBe(true);
    });

    it('extracts AWS X-Ray trace context from x-amzn-trace-id', () => {
      const req = {
        headers: {
          'x-amzn-trace-id': 'Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995cbe3140f4fb;Sampled=1',
        },
      };

      const ctx = extractTraceContext(req);
      expect(ctx.platform).toBe('aws');
      expect(ctx.traceId).toBe('1-5759e988-bd862e3fe1be46a994272793');
      expect(ctx.spanId).toBe('53995cbe3140f4fb');
      expect(ctx.sampled).toBe(true);
    });

    it('extracts W3C traceparent context', () => {
      const req = {
        headers: {
          traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        },
      };

      const ctx = extractTraceContext(req);
      expect(ctx.platform).toBe('w3c');
      expect(ctx.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(ctx.spanId).toBe('00f067aa0ba902b7');
      expect(ctx.sampled).toBe(true);
    });

    it('falls back to x-request-id or generates fresh UUID when no trace headers present', () => {
      const reqWithId = { headers: { 'x-request-id': 'custom-req-123' } };
      expect(extractTraceContext(reqWithId).traceId).toBe('custom-req-123');

      const reqEmpty = { headers: {} };
      const ctx = extractTraceContext(reqEmpty);
      expect(ctx.traceId).toBeTruthy();
      expect(ctx.platform).toBe('generic');
    });
  });

  // ========================================================
  // 2. Formatters & Redaction
  // ========================================================
  describe('Formatters & Redaction Engine', () => {
    it('redacts sensitive fields in nested payloads', () => {
      const payload = {
        user: 'alice',
        password: 'my-super-secret-password',
        auth: { token: 'jwt-token-123', safeValue: 42 },
        deep: { apiKey: 'secret-key-xyz' },
      };

      const cleaned = redactSensitive(payload);
      expect(cleaned.user).toBe('alice');
      expect(cleaned.password).toBe('[REDACTED]');
      expect(cleaned.auth.token).toBe('[REDACTED]');
      expect(cleaned.auth.safeValue).toBe(42);
      expect(cleaned.deep.apiKey).toBe('[REDACTED]');
    });

    it('formats GCP Cloud Logging payload with severity, trace, and httpRequest', () => {
      const raw = formatGcp(
        {
          level: 'error',
          message: 'Order processing failed',
          traceContext: { traceId: 'trace-abc-123', spanId: 'span-99', sampled: true },
          httpRequest: {
            method: 'POST',
            url: '/api/orders',
            status: 500,
            latencyMs: 125,
            ip: '10.0.0.1',
          },
          orderId: 54321,
          password: 'plain-password',
        },
        { project: 'my-gcp-project' }
      );

      const parsed = JSON.parse(raw);
      expect(parsed.severity).toBe('ERROR');
      expect(parsed.message).toBe('Order processing failed');
      expect(parsed['logging.googleapis.com/trace']).toBe('projects/my-gcp-project/traces/trace-abc-123');
      expect(parsed['logging.googleapis.com/spanId']).toBe('span-99');
      expect(parsed['logging.googleapis.com/trace_sampled']).toBe(true);
      expect(parsed.httpRequest.requestMethod).toBe('POST');
      expect(parsed.httpRequest.status).toBe(500);
      expect(parsed.httpRequest.latency).toBe('0.1250s');
      expect(parsed.orderId).toBe(54321);
      expect(parsed.password).toBe('[REDACTED]');
    });

    it('formats AWS CloudWatch payload with level and http metadata', () => {
      const raw = formatAws({
        level: 'info',
        message: 'Lambda execution success',
        traceContext: { traceId: 'root-123', raw: 'Root=root-123;Sampled=1', platform: 'aws' },
        httpRequest: {
          method: 'GET',
          url: '/api/health',
          status: 200,
          latencyMs: 15,
        },
        userId: 'usr_88',
      });

      const parsed = JSON.parse(raw);
      expect(parsed.level).toBe('INFO');
      expect(parsed.message).toBe('Lambda execution success');
      expect(parsed.requestId).toBe('root-123');
      expect(parsed.xrayTraceId).toBe('Root=root-123;Sampled=1');
      expect(parsed.http.method).toBe('GET');
      expect(parsed.http.status).toBe(200);
      expect(parsed.http.durationMs).toBe(15);
      expect(parsed.userId).toBe('usr_88');
    });

    it('formats standard JSON output', () => {
      const raw = formatJson({
        level: 'warn',
        message: 'Memory threshold high',
        memoryMb: 450,
      });

      const parsed = JSON.parse(raw);
      expect(parsed.level).toBe('warn');
      expect(parsed.message).toBe('Memory threshold high');
      expect(parsed.memoryMb).toBe(450);
      expect(parsed.timestamp).toBeDefined();
    });

    it('formats Pretty string output for local terminal', () => {
      const pretty = formatPretty({
        level: 'info',
        message: 'Server listening on port 7331',
      });

      expect(pretty).toContain('INFO');
      expect(pretty).toContain('Server listening on port 7331');
    });
  });

  // ========================================================
  // 3. CloudLogger Instance & Child Loggers
  // ========================================================
  describe('CloudLogger Class & Methods', () => {
    it('logs messages and enforces minLevel filtering', () => {
      const stream = new MemoryStream();
      const logger = createLogger({
        format: 'json',
        level: 'warn',
        stream,
      });

      logger.debug('debug message');
      logger.info('info message');
      expect(stream.lines).toHaveLength(0);

      logger.warn('warning message');
      expect(stream.lines).toHaveLength(1);
      expect(stream.getLastJson().message).toBe('warning message');

      logger.error('error message');
      expect(stream.lines).toHaveLength(2);
      expect(stream.getLastJson().message).toBe('error message');
    });

    it('creates child loggers with merged metadata', () => {
      const stream = new MemoryStream();
      const parent = createLogger({
        format: 'json',
        stream,
        defaultMeta: { service: 'payments' },
      });

      const child = parent.child({ orderId: 999, customerId: 'c1' });
      child.info('Payment confirmed');

      const logged = stream.getLastJson();
      expect(logged.service).toBe('payments');
      expect(logged.orderId).toBe(999);
      expect(logged.customerId).toBe('c1');
      expect(logged.message).toBe('Payment confirmed');
    });

    it('auto-detects format from cloud runtime environment variables', () => {
      const origEnv = { ...process.env };

      try {
        process.env.K_SERVICE = 'my-cloud-run-svc';
        expect(autoDetectFormat()).toBe('gcp');
        delete process.env.K_SERVICE;

        process.env.AWS_EXECUTION_ENV = 'AWS_ECS_FARGATE';
        expect(autoDetectFormat()).toBe('aws');
        delete process.env.AWS_EXECUTION_ENV;

        process.env.NODE_ENV = 'production';
        expect(autoDetectFormat()).toBe('json');
      } finally {
        process.env = origEnv;
      }
    });
  });

  // ========================================================
  // 4. Express Log Middleware & Trace Context
  // ========================================================
  describe('Express Middleware (createLogMiddleware)', () => {
    it('injects req.logger and logs HTTP access on request finish with trace context', async () => {
      const app = express();
      const stream = new MemoryStream();

      const logger = createLogger({
        format: 'gcp',
        stream,
        project: 'test-gcp-project',
      });

      app.use(createLogMiddleware(logger));

      app.get('/api/users', (req, res) => {
        expect(req.logger).toBeDefined();
        req.logger.info('Inside route handler', { queryCount: 3 });
        res.status(200).json({ ok: true });
      });

      const res = await request(app)
        .get('/api/users')
        .set('x-cloud-trace-context', 'abcdef123456/span42;o=1');

      expect(res.status).toBe(200);

      // Should have 2 log entries: route log and finish log
      expect(stream.lines.length).toBe(2);

      // 1. In-route log
      const routeLog = JSON.parse(stream.lines[0]);
      expect(routeLog.message).toBe('Inside route handler');
      expect(routeLog.queryCount).toBe(3);
      expect(routeLog['logging.googleapis.com/trace']).toContain('traces/abcdef123456');

      // 2. HTTP access finish log
      const accessLog = JSON.parse(stream.lines[1]);
      expect(accessLog.severity).toBe('INFO');
      expect(accessLog.httpRequest.requestMethod).toBe('GET');
      expect(accessLog.httpRequest.status).toBe(200);
      expect(accessLog.httpRequest.requestUrl).toBe('/api/users');
      expect(accessLog['logging.googleapis.com/trace']).toContain('traces/abcdef123456');
    });

    it('elevates HTTP log level to WARN for 4xx and ERROR for 5xx', async () => {
      const app = express();
      const stream = new MemoryStream();
      const logger = createLogger({ format: 'gcp', stream });

      app.use(createLogMiddleware(logger));
      app.get('/fail-404', (req, res) => res.status(404).send('Not Found'));
      app.get('/fail-500', (req, res) => res.status(500).send('Boom'));

      await request(app).get('/fail-404');
      const log404 = JSON.parse(stream.lines[stream.lines.length - 1]);
      expect(log404.severity).toBe('WARNING');
      expect(log404.httpRequest.status).toBe(404);

      await request(app).get('/fail-500');
      const log500 = JSON.parse(stream.lines[stream.lines.length - 1]);
      expect(log500.severity).toBe('ERROR');
      expect(log500.httpRequest.status).toBe(500);
    });

    it('skips excluded paths like health checks', async () => {
      const app = express();
      const stream = new MemoryStream();
      const logger = createLogger({ format: 'json', stream });

      app.use(createLogMiddleware(logger, { exclude: ['/healthz'] }));
      app.get('/healthz', (req, res) => res.send('OK'));

      await request(app).get('/healthz');
      expect(stream.lines.length).toBe(0);
    });
  });
});

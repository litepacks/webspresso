'use strict';

/**
 * Webspresso - Core Logger Stress Lab
 * Stress-tests high-volume NDJSON formatting (GCP/AWS/JSON/Pretty), deep redaction + circular
 * reference safety, trace header fuzzing, 20-level child logger isolation, and middleware storms.
 */

const { EventEmitter } = require('events');
const { Writable } = require('stream');
const {
  createLogger,
  createLogMiddleware,
  extractTraceContext,
} = require('../../../core/logger');
const {
  parseGcpTraceContext,
  parseAwsTraceContext,
  parseW3cTraceparent,
} = require('../../../core/logger/trace');

function createCaptureStream() {
  const lines = [];
  let buf = '';
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString();
      const parts = buf.split('\n');
      buf = parts.pop();
      for (const p of parts) {
        if (p) lines.push(p);
      }
      cb();
    },
  });
  return { stream, lines };
}

describe('Core Logger Stress Lab (Throughput, Redaction, Trace Fuzz, Child Isolation, Middleware)', () => {
  it('1. streams 2,000 valid NDJSON/Pretty log lines across all formats and honors silent level', () => {
    for (const fmt of ['gcp', 'aws', 'json', 'pretty']) {
      const { stream, lines } = createCaptureStream();
      const logger = createLogger({ format: fmt, level: 'debug', stream, project: 'stress-proj' });

      for (let i = 0; i < 500; i++) {
        logger.info(`event-${i}`, {
          seq: i,
          traceContext: { traceId: `trace-${i}`, spanId: `span-${i}`, sampled: i % 2 === 0 },
          httpRequest: { method: 'POST', url: `/api/items/${i}`, status: 201, latencyMs: i % 50 },
        });
      }

      expect(lines).toHaveLength(500);
      if (fmt !== 'pretty') {
        for (let i = 0; i < 500; i++) {
          const parsed = JSON.parse(lines[i]);
          expect(parsed.message).toBe(`event-${i}`);
          expect(parsed.seq).toBe(i);
        }
      }
    }

    // Silent level must drop 100% of writes
    const { stream: silentStream, lines: silentLines } = createCaptureStream();
    const silentLogger = createLogger({ format: 'json', level: 'silent', stream: silentStream });
    for (let i = 0; i < 100; i++) {
      silentLogger.fatal(`ignored-${i}`);
      silentLogger.error(`ignored-${i}`);
    }
    expect(silentLines).toHaveLength(0);
  });

  it('2. safely redacts 12-level nested secrets, Errors, and circular graphs without throwing', () => {
    const { stream, lines } = createCaptureStream();
    const logger = createLogger({
      format: 'json',
      level: 'debug',
      stream,
      redact: ['password', 'access_token', 'creditcard', 'customSecret'],
    });

    // Build 12-level nested payload + circular reference + Error object
    const root = { level: 0, customSecret: 'top-secret', items: [] };
    let cursor = root;
    for (let d = 1; d <= 12; d++) {
      cursor.next = {
        level: d,
        password: `pw-${d}`,
        nested: { access_token: `tok-${d}`, creditCardNumber: `4111-${d}` },
      };
      cursor = cursor.next;
    }
    cursor.cycleBack = root; // Circular object
    const err = new Error('db-timeout');
    err.code = 'ETIMEDOUT';
    err.status = 504;

    logger.error('hostile-payload', { payload: root, err });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.payload.customSecret).toBe('[REDACTED]');
    expect(parsed.payload.next.password).toBe('[REDACTED]');
    expect(parsed.payload.next.nested.access_token).toBe('[REDACTED]');
    expect(parsed.payload.next.nested.creditCardNumber).toBe('[REDACTED]');
    expect(parsed.err.code).toBe('ETIMEDOUT');
    expect(parsed.err.status).toBe(504);
    expect(lines[0]).toContain('[Circular]');
  });

  it('3. handles 300 valid and malformed trace headers deterministically without throwing', () => {
    const malformed = [
      '',
      null,
      undefined,
      'not-a-trace',
      '00-short-span-01',
      'Root=;Parent=;Sampled=x',
      '////;o=9',
      'x'.repeat(2048),
    ];

    for (const bad of malformed) {
      expect(parseGcpTraceContext(bad)).toBeNull();
      expect(parseAwsTraceContext(bad)).toBeNull();
      expect(parseW3cTraceparent(bad)).toBeNull();
    }

    for (let i = 0; i < 300; i++) {
      const mode = i % 4;
      let req;
      if (mode === 0) {
        req = { headers: { 'x-cloud-trace-context': `${'a'.repeat(32)}/${i};o=${i % 2}` } };
      } else if (mode === 1) {
        req = { headers: { 'x-amzn-trace-id': `Root=1-5759e988-${String(i).padStart(24, '0')};Parent=1234;Sampled=1` } };
      } else if (mode === 2) {
        req = { headers: { traceparent: `00-${'b'.repeat(32)}-${'c'.repeat(16)}-01` } };
      } else {
        req = { headers: { 'x-cloud-trace-context': 'invalid-header', 'x-request-id': `req-${i}` } };
      }

      const ctx = extractTraceContext(req);
      expect(typeof ctx.traceId).toBe('string');
      expect(ctx.traceId.length).toBeGreaterThan(0);
    }

    // Missing headers object falls back to generated UUID
    const fallback = extractTraceContext({});
    expect(fallback.platform).toBe('generic');
    expect(fallback.traceId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('4. isolates 20-level child logger hierarchy and 50 concurrent sibling children', () => {
    const { stream, lines } = createCaptureStream();
    let current = createLogger({ format: 'json', level: 'debug', stream, defaultMeta: { service: 'core' } });

    for (let i = 1; i <= 20; i++) {
      current = current.child({ [`k${i}`]: i });
    }

    const siblings = Array.from({ length: 50 }, (_, idx) => current.child({ worker: `w-${idx}` }));
    siblings.forEach((sib, idx) => sib.info(`work-${idx}`, { step: idx }));

    expect(lines).toHaveLength(50);
    for (let idx = 0; idx < 50; idx++) {
      const parsed = JSON.parse(lines[idx]);
      expect(parsed.service).toBe('core');
      expect(parsed.k1).toBe(1);
      expect(parsed.k20).toBe(20);
      expect(parsed.worker).toBe(`w-${idx}`);
      expect(parsed.step).toBe(idx);
    }
  });

  it('5. processes 150 concurrent HTTP middleware requests with accurate trace, status level, and exclusions', () => {
    const { stream, lines } = createCaptureStream();
    const logger = createLogger({ format: 'json', level: 'debug', stream });
    const middleware = createLogMiddleware(logger, { exclude: ['/healthz', '/readyz'] });

    for (let i = 0; i < 150; i++) {
      const isExcluded = i % 10 === 0;
      const url = isExcluded ? '/healthz?probe=1' : `/api/orders/${i}?expand=true`;
      const statusCode = i % 15 === 1 ? 502 : i % 7 === 1 ? 404 : 200;

      const req = {
        method: i % 2 === 0 ? 'GET' : 'POST',
        originalUrl: url,
        url,
        headers: {
          'x-request-id': `trace-http-${i}`,
          'user-agent': 'stress-client/1.0',
        },
        ip: '127.0.0.1',
      };
      const res = new EventEmitter();
      res.statusCode = statusCode;

      let nextCalled = false;
      middleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(req.logger).toBeDefined();
      expect(req.logger.defaultMeta.requestId).toBe(`trace-http-${i}`);

      res.emit('finish');
    }

    // 15 excluded (/healthz), 135 logged
    expect(lines).toHaveLength(135);
    for (const line of lines) {
      const entry = JSON.parse(line);
      expect(entry.requestId).toMatch(/^trace-http-\d+$/);
      if (entry.httpRequest.status >= 500) {
        expect(entry.level).toBe('error');
      } else if (entry.httpRequest.status >= 400) {
        expect(entry.level).toBe('warn');
      } else {
        expect(entry.level).toBe('info');
      }
    }
  });
});

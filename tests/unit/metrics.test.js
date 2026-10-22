import { createTempDir, cleanupDir } from '../utils';
'use strict';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import {
  MetricsRegistry,
  createMetricsRegistry,
  Counter,
  Gauge,
  Histogram,
  setupMetricsMiddleware,
  normalizeMetricsConfig,
  createMetricsManager,
  collectSystemMetrics,
  collectDatabaseMetrics,
  collectCacheMetrics,
  collectResilienceMetrics,
} from '../../core/metrics';
import { createApp } from '../../index';

describe('Cloud Metrics & Distributed Tracing (core/metrics)', () => {
  // ====================================================
  // 1. In-Memory Registry & Metrics Formatting
  // ====================================================
  describe('Registry & Metric Primitives', () => {
    it('Counter correctly records increments and produces Prometheus output', () => {
      const counter = new Counter('http_requests_total', 'Total HTTP requests');
      counter.inc();
      counter.inc(2);
      counter.inc({ method: 'GET', status: '200' }, 5);
      counter.inc({ method: 'POST', status: '201' }, 1);

      // Negative increment ignored
      counter.inc({ method: 'GET', status: '200' }, -3);

      expect(counter.get()).toBe(3);
      expect(counter.get({ method: 'GET', status: '200' })).toBe(5);
      expect(counter.get({ method: 'POST', status: '201' })).toBe(1);

      const prom = counter.toPrometheus();
      expect(prom).toContain('# HELP http_requests_total Total HTTP requests');
      expect(prom).toContain('# TYPE http_requests_total counter');
      expect(prom).toContain('http_requests_total 3');
      expect(prom).toContain('http_requests_total{method="GET",status="200"} 5');
      expect(prom).toContain('http_requests_total{method="POST",status="201"} 1');

      counter.reset();
      expect(counter.get()).toBe(0);
      expect(counter.toPrometheus()).toContain('http_requests_total 0');
    });

    it('Gauge correctly sets, increments, decrements and produces Prometheus output', () => {
      const gauge = new Gauge('active_connections', 'Current active connections');
      gauge.set(10);
      expect(gauge.get()).toBe(10);

      gauge.inc(2);
      expect(gauge.get()).toBe(12);

      gauge.dec(5);
      expect(gauge.get()).toBe(7);

      gauge.set({ pool: 'read' }, 4);
      gauge.inc({ pool: 'read' }, 2);
      gauge.dec({ pool: 'read' }, 1);
      expect(gauge.get({ pool: 'read' })).toBe(5);

      const prom = gauge.toPrometheus();
      expect(prom).toContain('# TYPE active_connections gauge');
      expect(prom).toContain('active_connections 7');
      expect(prom).toContain('active_connections{pool="read"} 5');

      gauge.reset();
      expect(gauge.get()).toBe(0);
    });

    it('Histogram observes values and produces standard cumulative buckets, sum, and count', () => {
      const buckets = [0.01, 0.05, 0.1, 0.5, 1];
      const hist = new Histogram('http_request_duration_seconds', 'Request duration', buckets);

      hist.observe({ route: '/api' }, 0.005);
      hist.observe({ route: '/api' }, 0.04);
      hist.observe({ route: '/api' }, 0.08);
      hist.observe({ route: '/api' }, 0.3);
      hist.observe({ route: '/api' }, 0.75);

      const prom = hist.toPrometheus();
      expect(prom).toContain('# TYPE http_request_duration_seconds histogram');
      expect(prom).toContain('http_request_duration_seconds_bucket{le="0.01",route="/api"} 1');
      expect(prom).toContain('http_request_duration_seconds_bucket{le="0.05",route="/api"} 2');
      expect(prom).toContain('http_request_duration_seconds_bucket{le="0.1",route="/api"} 3');
      expect(prom).toContain('http_request_duration_seconds_bucket{le="0.5",route="/api"} 4');
      expect(prom).toContain('http_request_duration_seconds_bucket{le="1",route="/api"} 5');
      expect(prom).toContain('http_request_duration_seconds_bucket{le="+Inf",route="/api"} 5');
      expect(prom).toContain('http_request_duration_seconds_count{route="/api"} 5');
      expect(prom).toContain('http_request_duration_seconds_sum{route="/api"} 1.175');
    });

    it('MetricsRegistry manages multiple metrics and outputs Prometheus text and JSON', () => {
      const registry = createMetricsRegistry();
      const c = registry.counter('my_counter', 'Help for counter');
      const g = registry.gauge('my_gauge', 'Help for gauge');
      const h = registry.histogram('my_histogram', 'Help for histogram', [1, 5]);

      c.inc(10);
      g.set(42);
      h.observe(2.5);

      const prom = registry.formatPrometheus();
      expect(prom).toContain('my_counter 10');
      expect(prom).toContain('my_gauge 42');
      expect(prom).toContain('my_histogram_sum 2.5');

      const json = registry.formatJson();
      expect(json.my_counter.type).toBe('counter');
      expect(json.my_counter.series[0].value).toBe(10);
      expect(json.my_gauge.type).toBe('gauge');
      expect(json.my_gauge.series[0].value).toBe(42);
      expect(json.my_histogram.type).toBe('histogram');
      expect(json.my_histogram.series[0].count).toBe(1);

      registry.remove('my_gauge');
      expect(registry.formatJson().my_gauge).toBeUndefined();

      registry.reset();
      expect(c.get()).toBe(0);
    });
  });

  // ====================================================
  // 2. Telemetry & Metric Collectors
  // ====================================================
  describe('Standard Collectors', () => {
    it('collectSystemMetrics populates process uptime, memory, cpu, and event loop lag', () => {
      const registry = createMetricsRegistry();
      collectSystemMetrics(registry);

      const json = registry.formatJson();
      expect(json.process_uptime_seconds).toBeDefined();
      expect(json.nodejs_heap_size_used_bytes).toBeDefined();
      expect(json.process_resident_memory_bytes).toBeDefined();
      expect(json.process_cpu_user_seconds_total).toBeDefined();
      expect(json.nodejs_eventloop_lag_seconds).toBeDefined();

      const prom = registry.formatPrometheus();
      expect(prom).toContain('nodejs_heap_size_used_bytes');
      expect(prom).toContain('nodejs_eventloop_lag_seconds{quantile="0.99"}');
    });

    it('collectDatabaseMetrics gathers Knex pool statistics', () => {
      const registry = createMetricsRegistry();
      const mockDb = {
        knex: {
          client: {
            pool: {
              numUsed: () => 3,
              numFree: () => 7,
            },
          },
        },
      };

      collectDatabaseMetrics(registry, mockDb);

      const json = registry.formatJson();
      expect(json.webspresso_db_pool_size.series[0].value).toBe(10);
      expect(json.webspresso_db_pool_used.series[0].value).toBe(3);
      expect(json.webspresso_db_pool_available.series[0].value).toBe(7);
    });

    it('collectCacheMetrics records cache entries and byte budget', () => {
      const registry = createMetricsRegistry();
      const mockCache = {
        size: 150,
        currentBytes: 1024 * 1024 * 5, // 5 MB
      };

      collectCacheMetrics(registry, mockCache);

      const json = registry.formatJson();
      expect(json.webspresso_cache_entries.series[0].value).toBe(150);
      expect(json.webspresso_cache_bytes.series[0].value).toBe(5242880);
    });

    it('collectResilienceMetrics captures circuit breaker states and failures', () => {
      const registry = createMetricsRegistry();
      const breakersMap = new Map();
      breakersMap.set('billing-api', { state: 'OPEN', failures: 8 });
      breakersMap.set('email-service', { state: 'HALF_OPEN', failures: 2 });
      breakersMap.set('database', { state: 'CLOSED', failures: 0 });

      collectResilienceMetrics(registry, { breakers: breakersMap });

      const json = registry.formatJson();
      const states = json.webspresso_circuit_breaker_state.series;
      const billingState = states.find(s => s.labels.name === 'billing-api');
      const emailState = states.find(s => s.labels.name === 'email-service');
      const dbState = states.find(s => s.labels.name === 'database');

      expect(billingState.value).toBe(2); // OPEN
      expect(emailState.value).toBe(1); // HALF_OPEN
      expect(dbState.value).toBe(0); // CLOSED
    });
  });

  // ====================================================
  // 3. HTTP Middleware, Tracing & Endpoints
  // ====================================================
  describe('setupMetricsMiddleware & Express integration', () => {
    it('normalizes options correctly', () => {
      const enabled = normalizeMetricsConfig(true);
      expect(enabled.enabled).toBe(true);
      expect(enabled.path).toBe('/metrics');
      expect(enabled.collectDefault).toBe(true);

      const disabled = normalizeMetricsConfig({ enabled: false });
      expect(disabled.enabled).toBe(false);

      const custom = normalizeMetricsConfig({
        path: '/telemetry',
        auth: 'secret-token-123',
        buckets: [0.1, 1],
      });
      expect(custom.path).toBe('/telemetry');
      expect(custom.auth).toBe('secret-token-123');
      expect(custom.buckets).toEqual([0.1, 1]);
    });

    it('injects x-trace-id and W3C traceparent headers onto responses', async () => {
      const app = express();
      setupMetricsMiddleware(app, true);

      app.get('/test-route', (req, res) => {
        expect(req.traceId).toBeDefined();
        expect(req.spanId).toBeDefined();
        res.json({ ok: true, traceId: req.traceId });
      });

      const res = await request(app).get('/test-route');
      expect(res.status).toBe(200);
      expect(res.headers['x-trace-id']).toBeDefined();
      expect(res.headers['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    });

    it('preserves existing W3C traceparent and GCP trace context headers', async () => {
      const app = express();
      setupMetricsMiddleware(app, true);

      app.get('/test-trace', (req, res) => {
        res.json({ traceId: req.traceId });
      });

      const incomingTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
      const incomingSpanId = '00f067aa0ba902b7';
      const w3cHeader = `00-${incomingTraceId}-${incomingSpanId}-01`;

      const res = await request(app)
        .get('/test-trace')
        .set('traceparent', w3cHeader);

      expect(res.status).toBe(200);
      expect(res.headers['x-trace-id']).toBe(incomingTraceId);
      expect(res.headers['traceparent']).toContain(incomingTraceId);
    });

    it('serves Prometheus exposition format at /metrics and JSON at /metrics.json', async () => {
      const app = express();
      const manager = setupMetricsMiddleware(app, true);

      app.get('/api/users', (req, res) => {
        res.status(200).send('users list');
      });

      // Hit an instrumented endpoint
      await request(app).get('/api/users');
      await request(app).get('/api/users');

      // 1. Scrape Prometheus
      const promRes = await request(app).get('/metrics');
      expect(promRes.status).toBe(200);
      expect(promRes.headers['content-type']).toContain('text/plain');
      expect(promRes.text).toContain('webspresso_http_requests_total');
      expect(promRes.text).toContain('nodejs_heap_size_used_bytes');

      // 2. Scrape JSON via path
      const jsonRes = await request(app).get('/metrics.json');
      expect(jsonRes.status).toBe(200);
      expect(jsonRes.headers['content-type']).toContain('application/json');
      expect(jsonRes.body.webspresso_http_requests_total).toBeDefined();

      // 3. Scrape JSON via Accept header
      const acceptJsonRes = await request(app)
        .get('/metrics')
        .set('Accept', 'application/json');
      expect(acceptJsonRes.status).toBe(200);
      expect(acceptJsonRes.body.webspresso_http_requests_total).toBeDefined();
    });

    it('enforces bearer token authentication when auth option is configured', async () => {
      const app = express();
      setupMetricsMiddleware(app, {
        enabled: true,
        auth: 'secret-token-xyz',
      });

      // 1. Unauthorized when missing token
      const unauthRes = await request(app).get('/metrics');
      expect(unauthRes.status).toBe(401);
      expect(unauthRes.text).toBe('Unauthorized');

      // 2. Unauthorized when wrong token
      const wrongRes = await request(app)
        .get('/metrics')
        .set('Authorization', 'Bearer invalid-token');
      expect(wrongRes.status).toBe(401);

      // 3. Authorized when valid token provided
      const okRes = await request(app)
        .get('/metrics')
        .set('Authorization', 'Bearer secret-token-xyz');
      expect(okRes.status).toBe(200);
      expect(okRes.text).toContain('# TYPE webspresso_http_requests_total counter');
    });

    it('ignores metrics scrape endpoints in request tracking to avoid scraping noise', async () => {
      const app = express();
      const manager = setupMetricsMiddleware(app, true);

      // Scrape /metrics 5 times
      for (let i = 0; i < 5; i++) {
        await request(app).get('/metrics');
      }

      const totalScrapeMetrics = manager.requestsTotal.get({ method: 'GET', route: '/metrics', status: '200' });
      expect(totalScrapeMetrics).toBe(0);
    });

    it('createApp correctly initializes metrics registry on app and mounts endpoint', async () => {
      const fs = require('fs');
      const path = require('path');
      const tmpDir = createTempDir('webspresso-metrics-app');
      const pagesDir = path.join(tmpDir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });

      try {
        const { app } = createApp({
          pagesDir,
          metrics: true,
        });

        expect(app.metrics).toBeDefined();
        expect(typeof app.metrics.counter).toBe('function');

        const res = await request(app).get('/metrics');
        expect(res.status).toBe(200);
        expect(res.text).toContain('nodejs_heap_size_used_bytes');
      } finally {
        cleanupDir(tmpDir);
      }
    });
  });
});

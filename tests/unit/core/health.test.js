'use strict';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  createApp,
  health,
  normalizeHealthConfig,
  setupHealthMiddleware,
  createHealthManager,
  probeDatabase,
  probeQueue,
  probeCustomChecks,
  formatMb,
  createEventLoopMonitor,
  getSystemMetrics,
} from '../../../index';

describe('Cloud & Kubernetes Health & Readiness Probes (core/health)', () => {
  describe('normalizeHealthConfig', () => {
    it('returns disabled by default when false or omitted', () => {
      expect(normalizeHealthConfig().enabled).toBe(false);
      expect(normalizeHealthConfig(false).enabled).toBe(false);
      expect(normalizeHealthConfig(null).enabled).toBe(false);
    });

    it('enables with standard defaults when true', () => {
      const cfg = normalizeHealthConfig(true);
      expect(cfg.enabled).toBe(true);
      expect(cfg.path).toBe('/healthz');
      expect(cfg.readyPath).toBe('/readyz');
      expect(cfg.combinedPath).toBe('/health');
      expect(cfg.db).toBe(true);
      expect(cfg.queue).toBe(true);
      expect(cfg.eventLoopLag).toBe(true);
      expect(cfg.eventLoopThresholdMs).toBe(300);
      expect(cfg.headers['Cache-Control']).toContain('no-store');
    });

    it('accepts string shorthand path', () => {
      const cfg = normalizeHealthConfig('/api/status');
      expect(cfg.enabled).toBe(true);
      expect(cfg.path).toBe('/api/status');
      expect(cfg.combinedPath).toBe('/api/status');
    });

    it('unwraps options.healthCheck and options.server.healthCheck', () => {
      const top = normalizeHealthConfig({ healthCheck: { path: '/live' } });
      expect(top.enabled).toBe(true);
      expect(top.path).toBe('/live');

      const server = normalizeHealthConfig({ server: { healthCheck: true } });
      expect(server.enabled).toBe(true);
      expect(server.path).toBe('/healthz');
    });

    it('merges custom options and headers', () => {
      const cfg = normalizeHealthConfig({
        path: '/livez',
        readyPath: '/readiness',
        db: false,
        timeoutMs: 5000,
        headers: { 'X-Custom-Health': 'true' },
      });

      expect(cfg.path).toBe('/livez');
      expect(cfg.readyPath).toBe('/readiness');
      expect(cfg.db).toBe(false);
      expect(cfg.timeoutMs).toBe(5000);
      expect(cfg.headers['X-Custom-Health']).toBe('true');
      expect(cfg.headers['Cache-Control']).toBeDefined();
    });
  });

  describe('Probes and Metrics', () => {
    it('formats bytes accurately', () => {
      expect(formatMb(1024 * 1024)).toBe('1.00 MB');
      expect(formatMb(50 * 1024 * 1024)).toBe('50.00 MB');
      expect(formatMb('invalid')).toBe('0 MB');
    });

    it('collects event loop monitor stats and cleans up', () => {
      const monitor = createEventLoopMonitor();
      expect(monitor).toBeDefined();

      if (monitor) {
        const stats = monitor.getStats();
        expect(typeof stats.meanMs).toBe('number');
        expect(typeof stats.maxMs).toBe('number');
        expect(typeof stats.p50Ms).toBe('number');
        expect(typeof stats.p99Ms).toBe('number');
        monitor.destroy();
      }
    });

    it('gathers comprehensive system metrics', () => {
      const metrics = getSystemMetrics();
      expect(metrics.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(metrics.memory.rss).toContain('MB');
      expect(metrics.memory.heapUsed).toContain('MB');
      expect(metrics.pid).toBe(process.pid);
      expect(metrics.nodeVersion).toBe(process.version);
    });

    it('probeDatabase checks database ping successfully', async () => {
      const mockDb = {
        knex: {
          raw: vi.fn().mockResolvedValue([1]),
        },
      };

      const result = await probeDatabase(mockDb, 1000);
      expect(result.status).toBe('up');
      expect(typeof result.latencyMs).toBe('number');
    });

    it('probeDatabase reports down when ping fails', async () => {
      const failingDb = {
        knex: {
          raw: vi.fn().mockRejectedValue(new Error('Connection lost')),
        },
      };

      const result = await probeDatabase(failingDb, 1000);
      expect(result.status).toBe('down');
      expect(result.error).toBe('Connection lost');
    });

    it('probeDatabase reports skipped when db is null', async () => {
      const result = await probeDatabase(null);
      expect(result.status).toBe('skipped');
    });

    it('probeQueue checks queue status', async () => {
      const mockQueue = {
        getStats: vi.fn().mockResolvedValue({ pending: 0, active: 1 }),
      };

      const result = await probeQueue(mockQueue);
      expect(result.status).toBe('up');
      expect(result.stats).toEqual({ pending: 0, active: 1 });
    });

    it('probeCustomChecks executes custom checks concurrently', async () => {
      const checks = {
        redis: async () => true,
        cache: async () => ({ status: 'up', items: 42 }),
      };

      const result = await probeCustomChecks(checks);
      expect(result.isHealthy).toBe(true);
      expect(result.results.redis.status).toBe('up');
      expect(result.results.cache.items).toBe(42);
    });

    it('probeCustomChecks detects failing checks', async () => {
      const checks = {
        healthyService: async () => true,
        failingService: async () => {
          throw new Error('API down');
        },
      };

      const result = await probeCustomChecks(checks);
      expect(result.isHealthy).toBe(false);
      expect(result.results.healthyService.status).toBe('up');
      expect(result.results.failingService.status).toBe('down');
      expect(result.results.failingService.error).toBe('API down');
    });
  });

  describe('Integration with Express & createApp', () => {
    it('is disabled by default and endpoints return 404', async () => {
      const app = createApp({
        rootDir: process.cwd(),
        pagesDir: 'pages',
      });

      const res = await request(app).get('/healthz');
      expect(res.status).toBe(404);
    });

    it('serves /healthz (liveness) with 200 and system metrics', async () => {
      const app = createApp({
        rootDir: process.cwd(),
        pagesDir: 'pages',
        healthCheck: true,
      });

      const res = await request(app).get('/healthz');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.body.status).toBe('ok');
      expect(res.body.uptimeSeconds).toBeDefined();
      expect(res.body.memory).toBeDefined();
      expect(res.body.pid).toBe(process.pid);
    });

    it('serves /readyz (readiness) with 200 when all systems healthy', async () => {
      const mockDb = {
        knex: {
          raw: vi.fn().mockResolvedValue([1]),
        },
      };

      const app = createApp({
        rootDir: process.cwd(),
        pagesDir: 'pages',
        db: mockDb,
        healthCheck: true,
      });

      const res = await request(app).get('/readyz');
      expect(res.status).toBe(200);
      expect(res.body.ready).toBe(true);
      expect(res.body.status).toBe('ready');
      expect(res.body.checks.database.status).toBe('up');
    });

    it('serves /health (combined) with 200 summary', async () => {
      const app = createApp({
        rootDir: process.cwd(),
        pagesDir: 'pages',
        healthCheck: true,
      });

      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.liveness).toBeDefined();
      expect(res.body.readiness).toBeDefined();
      expect(res.body.status).toBe('ok');
    });

    it('returns HTTP 503 from /readyz when database is down', async () => {
      const brokenDb = {
        knex: {
          raw: vi.fn().mockRejectedValue(new Error('Connection refused')),
        },
      };

      const app = createApp({
        rootDir: process.cwd(),
        pagesDir: 'pages',
        db: brokenDb,
        healthCheck: true,
      });

      const res = await request(app).get('/readyz');
      expect(res.status).toBe(503);
      expect(res.body.ready).toBe(false);
      expect(res.body.status).toBe('unhealthy');
      expect(res.body.checks.database.status).toBe('down');
      expect(res.body.checks.database.error).toBe('Connection refused');
    });

    it('returns HTTP 503 from /readyz when custom check fails', async () => {
      const app = createApp({
        rootDir: process.cwd(),
        pagesDir: 'pages',
        healthCheck: {
          checks: {
            stripe: async () => false,
          },
        },
      });

      const res = await request(app).get('/readyz');
      expect(res.status).toBe(503);
      expect(res.body.ready).toBe(false);
      expect(res.body.checks.custom.stripe.status).toBe('down');
    });

    it('immediately returns HTTP 503 from /readyz when server is draining during graceful shutdown', async () => {
      const app = createApp({
        rootDir: process.cwd(),
        pagesDir: 'pages',
        healthCheck: true,
      });

      // 1. Initial probe is ready
      const resReady = await request(app).get('/readyz');
      expect(resReady.status).toBe(200);
      expect(resReady.body.ready).toBe(true);

      // 2. Trigger graceful shutdown
      app.shutdownManager.isShuttingDown = true;

      // 3. /readyz immediately signals draining with HTTP 503 so load balancers stop routing traffic
      const resDraining = await request(app).get('/readyz');
      expect(resDraining.status).toBe(503);
      expect(resDraining.body.ready).toBe(false);
      expect(resDraining.body.status).toBe('draining');
      expect(resDraining.body.message).toContain('draining');

      // 4. /healthz (liveness) still returns 200 because process is alive
      const resLive = await request(app).get('/healthz');
      expect(resLive.status).toBe(200);

      // Reset
      app.shutdownManager.isShuttingDown = false;
    });

    it('exposes app.getHealthStatus() programmatic helper', async () => {
      const app = createApp({
        rootDir: process.cwd(),
        pagesDir: 'pages',
        healthCheck: true,
      });

      expect(typeof app.getHealthStatus).toBe('function');
      const status = await app.getHealthStatus();
      expect(status.liveness.status).toBe('ok');
      expect(status.readiness.ready).toBe(true);
    });
  });
});

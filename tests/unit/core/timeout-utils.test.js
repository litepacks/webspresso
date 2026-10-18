import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import {
  DEFAULT_TIMEOUTS,
  normalizeTimeouts,
  TimeoutError,
  withTimeout,
  createTimeoutMiddleware,
} from '../../../core/utils/timeout';
import {
  RequestTimeoutError,
  ServiceUnavailableError,
  GatewayTimeoutError,
} from '../../../core/errors/http';
import { createApp } from '../../../src/server';

describe('Centralized Timeout Management & Utilities', () => {
  describe('DEFAULT_TIMEOUTS', () => {
    it('has standard expected default thresholds', () => {
      expect(DEFAULT_TIMEOUTS.request).toBe(30_000);
      expect(DEFAULT_TIMEOUTS.service).toBe(15_000);
      expect(DEFAULT_TIMEOUTS.queue).toBe(30_000);
      expect(DEFAULT_TIMEOUTS.fetch).toBe(10_000);
      expect(DEFAULT_TIMEOUTS.webhook).toBe(10_000);
      expect(DEFAULT_TIMEOUTS.shutdown).toBe(10_000);
      expect(DEFAULT_TIMEOUTS.loader).toBe(10_000);
    });

    it('is frozen to prevent accidental mutation', () => {
      expect(Object.isFrozen(DEFAULT_TIMEOUTS)).toBe(true);
    });
  });

  describe('normalizeTimeouts', () => {
    it('returns default timeouts when given empty options', () => {
      const timeouts = normalizeTimeouts();
      expect(timeouts).toEqual(DEFAULT_TIMEOUTS);
      expect(Object.isFrozen(timeouts)).toBe(true);
    });

    it('normalizes duration strings into milliseconds', () => {
      const timeouts = normalizeTimeouts({
        timeouts: {
          request: '45s',
          service: '5s',
          queue: '1m',
          fetch: '2500ms',
          webhook: '8s',
          shutdown: '15s',
          loader: '3s',
        },
      });

      expect(timeouts.request).toBe(45_000);
      expect(timeouts.service).toBe(5_000);
      expect(timeouts.queue).toBe(60_000);
      expect(timeouts.fetch).toBe(2_500);
      expect(timeouts.webhook).toBe(8_000);
      expect(timeouts.shutdown).toBe(15_000);
      expect(timeouts.loader).toBe(3_000);
    });

    it('supports disabling specific timeouts with false or 0', () => {
      const timeouts = normalizeTimeouts({
        timeouts: {
          request: false,
          service: 0,
          queue: 'false',
        },
      });

      expect(timeouts.request).toBe(false);
      expect(timeouts.service).toBe(false);
      expect(timeouts.queue).toBe(false);
      expect(timeouts.fetch).toBe(DEFAULT_TIMEOUTS.fetch);
    });

    it('maintains backward compatibility with legacy config keys', () => {
      const timeouts = normalizeTimeouts({
        timeout: '20s', // legacy options.timeout -> request
        serviceTimeout: '12s',
        queueTimeout: '40s',
        fetchTimeout: '7s',
        webhookTimeout: '9s',
        shutdown: { timeout: '14s' },
        loaderTimeout: '4s',
      });

      expect(timeouts.request).toBe(20_000);
      expect(timeouts.service).toBe(12_000);
      expect(timeouts.queue).toBe(40_000);
      expect(timeouts.fetch).toBe(7_000);
      expect(timeouts.webhook).toBe(9_000);
      expect(timeouts.shutdown).toBe(14_000);
      expect(timeouts.loader).toBe(4_000);
    });

    it('supports server object nested fallbacks', () => {
      const timeouts = normalizeTimeouts({
        server: {
          timeout: '25s',
          shutdown: { timeout: '18s' },
        },
        services: {
          timeout: '16s',
        },
      });

      expect(timeouts.request).toBe(25_000);
      expect(timeouts.shutdown).toBe(18_000);
      expect(timeouts.service).toBe(16_000);
    });
  });

  describe('Timeout Error Classes', () => {
    it('instantiates TimeoutError with status 504 and ETIMEDOUT code', () => {
      const err = new TimeoutError('Request timed out', { timeout: 5000, scope: 'service' });
      expect(err.name).toBe('TimeoutError');
      expect(err.status).toBe(504);
      expect(err.statusCode).toBe(504);
      expect(err.code).toBe('ETIMEDOUT');
      expect(err.timeout).toBe(5000);
      expect(err.scope).toBe('service');
    });

    it('instantiates HTTP timeout errors with correct status codes', () => {
      const reqTimeout = new RequestTimeoutError();
      expect(reqTimeout.status).toBe(408);
      expect(reqTimeout.code).toBe('REQUEST_TIMEOUT');

      const svcUnavailable = new ServiceUnavailableError();
      expect(svcUnavailable.status).toBe(503);
      expect(svcUnavailable.code).toBe('SERVICE_UNAVAILABLE');

      const gwTimeout = new GatewayTimeoutError();
      expect(gwTimeout.status).toBe(504);
      expect(gwTimeout.code).toBe('GATEWAY_TIMEOUT');
    });
  });

  describe('withTimeout', () => {
    it('resolves directly when operation completes before timeout', async () => {
      const result = await withTimeout(
        async () => {
          await new Promise((r) => setTimeout(r, 10));
          return 'hello-world';
        },
        100
      );

      expect(result).toBe('hello-world');
    });

    it('works with a pre-created Promise instance', async () => {
      const p = new Promise((resolve) => setTimeout(() => resolve(42), 10));
      const res = await withTimeout(p, '100ms');
      expect(res).toBe(42);
    });

    it('throws TimeoutError when operation exceeds timeout', async () => {
      await expect(
        withTimeout(
          () => new Promise((resolve) => setTimeout(resolve, 150)),
          30
        )
      ).rejects.toThrow(/Operation timed out after 30ms/);
    });

    it('aborts controller if controller is passed in options', async () => {
      const controller = new AbortController();
      let wasAborted = false;

      controller.signal.addEventListener('abort', () => {
        wasAborted = true;
      });

      await expect(
        withTimeout(
          () => new Promise((resolve) => setTimeout(resolve, 150)),
          30,
          { controller }
        )
      ).rejects.toThrow();

      expect(wasAborted).toBe(true);
      expect(controller.signal.aborted).toBe(true);
    });

    it('respects external signal that aborts during execution', async () => {
      const controller = new AbortController();

      setTimeout(() => {
        controller.abort(new Error('Parent canceled'));
      }, 20);

      await expect(
        withTimeout(
          () => new Promise((resolve) => setTimeout(resolve, 200)),
          500,
          { signal: controller.signal }
        )
      ).rejects.toThrow('Parent canceled');
    });

    it('rejects immediately if external signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort(new Error('Already aborted'));

      await expect(
        withTimeout(
          () => Promise.resolve('ok'),
          1000,
          { signal: controller.signal }
        )
      ).rejects.toThrow('Already aborted');
    });

    it('runs without timer if timeout is 0 or false', async () => {
      const res = await withTimeout(() => Promise.resolve('zero-timeout'), 0);
      expect(res).toBe('zero-timeout');

      const resFalse = await withTimeout(() => Promise.resolve('false-timeout'), false);
      expect(resFalse).toBe('false-timeout');
    });
  });

  describe('createTimeoutMiddleware', () => {
    it('returns pass-through middleware when timeout is false', () => {
      const mw = createTimeoutMiddleware(false);
      const req = {};
      const res = {};
      const next = vi.fn();

      mw(req, res, next);
      expect(req.timedout).toBe(false);
      expect(typeof req.clearTimeout).toBe('function');
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('attaches req.abortController and req.signal', () => {
      const mw = createTimeoutMiddleware(500);
      const req = {
        emit: vi.fn(),
      };
      const res = {
        once: vi.fn(),
      };
      const next = vi.fn();

      mw(req, res, next);
      expect(req.timedout).toBe(false);
      expect(req.abortController).toBeDefined();
      expect(req.signal).toBeDefined();
      expect(typeof req.clearTimeout).toBe('function');
      req.clearTimeout();
    });

    it('clears timer when req.clearTimeout is called', async () => {
      const mw = createTimeoutMiddleware(30);
      const req = { emit: vi.fn() };
      const res = { once: vi.fn() };
      const next = vi.fn();

      mw(req, res, next);
      req.clearTimeout();

      await new Promise((r) => setTimeout(r, 60));
      expect(req.timedout).toBe(false);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('Express & createApp integration with timeouts', () => {
    it('populates app.get("timeouts") and returns timeouts in createApp()', () => {
      const { app, timeouts } = createApp({
        rootDir: process.cwd(),
        pages: 'pages',
        timeouts: {
          request: '20s',
          service: '8s',
          queue: '15s',
        },
      });

      expect(timeouts.request).toBe(20_000);
      expect(timeouts.service).toBe(8_000);
      expect(timeouts.queue).toBe(15_000);
      expect(app.get('timeouts')).toEqual(timeouts);
    });

    it('injects req.timeouts on incoming requests', async () => {
      let capturedTimeouts = null;

      const { app } = createApp({
        rootDir: process.cwd(),
        pages: 'pages',
        timeout: false,
        timeouts: {
          service: '11s',
        },
        setupRoutes: (a) => {
          a.get('/__check_timeouts', (req, res) => {
            capturedTimeouts = req.timeouts;
            res.json({ ok: true });
          });
        },
      });

      await request(app).get('/__check_timeouts').expect(200);
      expect(capturedTimeouts).toBeDefined();
      expect(capturedTimeouts.service).toBe(11_000);
      expect(capturedTimeouts.request).toBe(false);
    });

    it('handles request timeout with 503 response when request exceeds timeout threshold', async () => {
      const { app } = createApp({
        rootDir: process.cwd(),
        pages: 'pages',
        timeouts: {
          request: '40ms',
        },
        setupRoutes: (a) => {
          a.get('/__slow_route', async (req, res) => {
            await new Promise((resolve) => setTimeout(resolve, 150));
            if (!res.headersSent) {
              res.send('too late');
            }
          });
        },
      });

      const res = await request(app).get('/__slow_route').expect(503);
      expect(res.text).toContain('503');
      expect(res.text).toContain('timed out');
    });

    it('returns JSON 503 on timeout when Accept is application/json', async () => {
      const { app } = createApp({
        rootDir: process.cwd(),
        pages: 'pages',
        timeouts: {
          request: '40ms',
        },
        setupRoutes: (a) => {
          a.get('/__slow_api', async (req, res) => {
            await new Promise((resolve) => setTimeout(resolve, 150));
            if (!res.headersSent) {
              res.json({ too: 'late' });
            }
          });
        },
      });

      const res = await request(app)
        .get('/__slow_api')
        .set('Accept', 'application/json')
        .expect(503);

      expect(res.body.error).toBe('Request Timeout');
      expect(res.body.status).toBe(503);
    });

    it('allows fast requests to complete normally without timing out', async () => {
      const { app } = createApp({
        rootDir: process.cwd(),
        pages: 'pages',
        timeouts: {
          request: '500ms',
        },
        setupRoutes: (a) => {
          a.get('/__fast_route', (req, res) => {
            res.json({ success: true });
          });
        },
      });

      const res = await request(app).get('/__fast_route').expect(200);
      expect(res.body.success).toBe(true);
    });
  });
});

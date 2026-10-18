import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CircuitBreaker,
  createCircuitBreaker,
  STATE_CLOSED,
  STATE_OPEN,
  STATE_HALF_OPEN,
  retry,
  withRetry,
  isTransientError,
  calculateBackoffDelay,
  CircuitBreakerRegistry,
  circuitBreakerRegistry,
  getBreaker,
  CircuitBreakerOpenError,
  CircuitBreakerTimeoutError,
} from '../../../core/resilience';
import {
  createServiceRegistry,
  defineService,
} from '../../../src/services';
import { createApp } from '../../../src/server';

describe('Webspresso Enterprise Resilience Engine (core/resilience)', () => {
  beforeEach(() => {
    circuitBreakerRegistry.clear();
  });

  describe('CircuitBreaker State Machine & Transitions', () => {
    it('should start in CLOSED state and execute successful calls', async () => {
      const breaker = new CircuitBreaker({ name: 'test-service', failureThreshold: 3 });

      expect(breaker.state).toBe(STATE_CLOSED);
      expect(breaker.isClosed).toBe(true);
      expect(breaker.isOpen).toBe(false);
      expect(breaker.isHalfOpen).toBe(false);

      const result = await breaker.execute(async () => 'success_result');
      expect(result).toBe('success_result');

      const stats = breaker.getStats();
      expect(stats.totalCalls).toBe(1);
      expect(stats.successfulCalls).toBe(1);
      expect(stats.failedCalls).toBe(0);
    });

    it('should trip to OPEN after consecutive failures reach failureThreshold', async () => {
      const breaker = new CircuitBreaker({ name: 'api-down', failureThreshold: 3 });
      const stateChanges = [];

      breaker.on('stateChange', (from, to) => {
        stateChanges.push({ from, to });
      });

      const failingFn = async () => {
        const err = new Error('Downstream 500 error');
        err.statusCode = 500;
        throw err;
      };

      // Calls 1 and 2 fail, breaker remains CLOSED
      await expect(breaker.execute(failingFn)).rejects.toThrow('Downstream 500 error');
      await expect(breaker.execute(failingFn)).rejects.toThrow('Downstream 500 error');
      expect(breaker.state).toBe(STATE_CLOSED);
      expect(breaker.consecutiveFailures).toBe(2);

      // Call 3 fails, threshold reached -> transitions to OPEN
      await expect(breaker.execute(failingFn)).rejects.toThrow('Downstream 500 error');
      expect(breaker.state).toBe(STATE_OPEN);
      expect(breaker.isOpen).toBe(true);
      expect(stateChanges).toEqual([{ from: STATE_CLOSED, to: STATE_OPEN }]);

      // Call 4 fast-fails immediately with CircuitBreakerOpenError without running fn
      let fnRan = false;
      await expect(
        breaker.execute(async () => {
          fnRan = true;
          return 'ok';
        })
      ).rejects.toThrow(CircuitBreakerOpenError);

      expect(fnRan).toBe(false);
      expect(breaker.getStats().rejectedCalls).toBe(1);
    });

    it('should transition to HALF_OPEN after resetTimeout has elapsed', async () => {
      vi.useFakeTimers();
      try {
        const breaker = new CircuitBreaker({
          name: 'half-open-test',
          failureThreshold: 2,
          resetTimeout: 1000,
          successThreshold: 2,
        });

        const failingFn = async () => {
          const err = new Error('Fatal');
          err.statusCode = 503;
          throw err;
        };

        await expect(breaker.execute(failingFn)).rejects.toThrow();
        await expect(breaker.execute(failingFn)).rejects.toThrow();
        expect(breaker.state).toBe(STATE_OPEN);

        // Before reset timeout: fast-fails
        await expect(breaker.execute(async () => 'ok')).rejects.toThrow(CircuitBreakerOpenError);

        // Advance time past reset timeout
        vi.advanceTimersByTime(1100);

        // Next call should transition to HALF_OPEN and allow trial execution
        const trialResult = await breaker.execute(async () => 'recovering');
        expect(trialResult).toBe('recovering');
        expect(breaker.state).toBe(STATE_HALF_OPEN);
        expect(breaker.consecutiveSuccesses).toBe(1);

        // Second success reaches successThreshold -> closes circuit
        const trial2 = await breaker.execute(async () => 'healthy');
        expect(trial2).toBe('healthy');
        expect(breaker.state).toBe(STATE_CLOSED);
        expect(breaker.isClosed).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should immediately trip back to OPEN if a call fails in HALF_OPEN state', async () => {
      const breaker = new CircuitBreaker({
        name: 'half-open-fail',
        failureThreshold: 1,
        resetTimeout: 10,
      });

      await expect(breaker.execute(async () => {
        const err = new Error('err');
        err.statusCode = 500;
        throw err;
      })).rejects.toThrow();
      expect(breaker.state).toBe(STATE_OPEN);

      // Force to half-open
      breaker.halfOpen();
      expect(breaker.state).toBe(STATE_HALF_OPEN);

      // A single failure in HALF_OPEN trips immediately to OPEN
      await expect(breaker.execute(async () => {
        const err = new Error('still down');
        err.statusCode = 500;
        throw err;
      })).rejects.toThrow();

      expect(breaker.state).toBe(STATE_OPEN);
    });

    it('should not count 4xx client errors as circuit breaker failures by default', async () => {
      const breaker = new CircuitBreaker({ name: 'client-errors', failureThreshold: 2 });

      const clientErr = new Error('Not found');
      clientErr.statusCode = 404;

      await expect(breaker.execute(async () => { throw clientErr; })).rejects.toThrow('Not found');
      await expect(breaker.execute(async () => { throw clientErr; })).rejects.toThrow('Not found');
      await expect(breaker.execute(async () => { throw clientErr; })).rejects.toThrow('Not found');

      // Breaker stays CLOSED because 404 is not a system outage
      expect(breaker.state).toBe(STATE_CLOSED);
      expect(breaker.consecutiveFailures).toBe(0);
    });

    it('should support manual state controls: open(), close(), reset()', () => {
      const breaker = new CircuitBreaker({ name: 'manual' });
      expect(breaker.state).toBe(STATE_CLOSED);

      breaker.open();
      expect(breaker.isOpen).toBe(true);

      breaker.close();
      expect(breaker.isClosed).toBe(true);

      breaker.halfOpen();
      expect(breaker.isHalfOpen).toBe(true);

      breaker.reset();
      expect(breaker.isClosed).toBe(true);
      expect(breaker.getStats().totalCalls).toBe(0);
    });
  });

  describe('Rolling Window Failure Rate Threshold', () => {
    it('should trip breaker when failure rate percentage exceeds threshold', async () => {
      const breaker = new CircuitBreaker({
        name: 'rate-breaker',
        failureRateThreshold: 0.5, // 50%
        minimumRequests: 4,
        failureThreshold: 10, // high consecutive threshold
      });

      // 2 successes, 2 failures = 50% failure rate over 4 requests
      await breaker.execute(async () => 'ok');
      await breaker.execute(async () => 'ok');
      await expect(breaker.execute(async () => {
        const err = new Error('err 1');
        err.statusCode = 500;
        throw err;
      })).rejects.toThrow();

      expect(breaker.state).toBe(STATE_CLOSED);

      await expect(breaker.execute(async () => {
        const err = new Error('err 2');
        err.statusCode = 500;
        throw err;
      })).rejects.toThrow();

      // Now 4 requests, 2 failures = 50% >= failureRateThreshold -> trips to OPEN
      expect(breaker.state).toBe(STATE_OPEN);
    });
  });

  describe('Execution Timeout & Fallback', () => {
    it('should timeout slow operations and throw CircuitBreakerTimeoutError', async () => {
      const breaker = new CircuitBreaker({
        name: 'timeout-service',
        timeout: 50,
      });

      await expect(
        breaker.execute(async () => {
          await new Promise((resolve) => setTimeout(resolve, 150));
          return 'late';
        })
      ).rejects.toThrow(CircuitBreakerTimeoutError);

      expect(breaker.getStats().timedOutCalls).toBe(1);
    });

    it('should return fallback result when breaker is OPEN or call fails', async () => {
      const breaker = new CircuitBreaker({
        name: 'fallback-service',
        failureThreshold: 1,
        fallback: (err, input) => ({ fallback: true, originalError: err.message, input }),
      });

      // 1. Initial failure invokes fallback and records failure
      const result1 = await breaker.execute(async (inp) => {
        const err = new Error('API failure');
        err.statusCode = 500;
        throw err;
      }, { query: 'test' });

      expect(result1).toEqual({
        fallback: true,
        originalError: 'API failure',
        input: { query: 'test' },
      });
      expect(breaker.state).toBe(STATE_OPEN);

      // 2. While OPEN, execution is short-circuited and returns fallback
      const result2 = await breaker.execute(async (inp) => 'never called', { query: 'retry' });
      expect(result2.fallback).toBe(true);
      expect(result2.input).toEqual({ query: 'retry' });
      expect(breaker.getStats().fallbackCalls).toBe(2);
    });
  });

  describe('Retry Engine (retry & withRetry)', () => {
    it('should execute successfully without retrying on immediate success', async () => {
      let attempts = 0;
      const res = await retry(async (attempt) => {
        attempts = attempt;
        return 'success';
      });

      expect(res).toBe('success');
      expect(attempts).toBe(1);
    });

    it('should retry transient errors with exponential backoff and jitter', async () => {
      let callCount = 0;
      const retriesLog = [];

      const res = await retry(
        async (attempt) => {
          callCount++;
          if (callCount < 3) {
            const err = new Error('ETIMEDOUT');
            err.code = 'ETIMEDOUT';
            throw err;
          }
          return `recovered on attempt ${attempt}`;
        },
        {
          retries: 3,
          delay: 10,
          factor: 2,
          jitter: false,
          onRetry: (info) => retriesLog.push(info),
        }
      );

      expect(res).toBe('recovered on attempt 3');
      expect(callCount).toBe(3);
      expect(retriesLog.length).toBe(2);
      expect(retriesLog[0].attempt).toBe(1);
      expect(retriesLog[0].delayMs).toBe(10);
      expect(retriesLog[1].attempt).toBe(2);
      expect(retriesLog[1].delayMs).toBe(20);
    });

    it('should not retry non-transient 4xx client errors', async () => {
      let callCount = 0;

      await expect(
        retry(
          async () => {
            callCount++;
            const err = new Error('Bad Request');
            err.statusCode = 400;
            throw err;
          },
          { retries: 3, delay: 5 }
        )
      ).rejects.toThrow('Bad Request');

      expect(callCount).toBe(1);
    });

    it('should abort retry loop when AbortSignal is triggered', async () => {
      const controller = new AbortController();
      let callCount = 0;

      const promise = retry(
        async () => {
          callCount++;
          const err = new Error('Transient 503');
          err.statusCode = 503;
          throw err;
        },
        {
          retries: 5,
          delay: 200,
          jitter: false,
          signal: controller.signal,
        }
      );

      // Abort quickly
      setTimeout(() => controller.abort(new Error('User cancelled')), 20);

      await expect(promise).rejects.toThrow('User cancelled');
      expect(callCount).toBe(1);
    });

    it('should wrap async functions with withRetry', async () => {
      let count = 0;
      const wrapped = withRetry(
        async (x) => {
          count++;
          if (count < 2) {
            const err = new Error('Connection reset');
            err.code = 'ECONNRESET';
            throw err;
          }
          return x * 2;
        },
        { retries: 2, delay: 5 }
      );

      const result = await wrapped(21);
      expect(result).toBe(42);
      expect(count).toBe(2);
    });

    it('should calculate exponential backoff delay correctly with and without jitter', () => {
      // Without jitter
      expect(calculateBackoffDelay(1, 100, 1000, 2, false)).toBe(100);
      expect(calculateBackoffDelay(2, 100, 1000, 2, false)).toBe(200);
      expect(calculateBackoffDelay(3, 100, 1000, 2, false)).toBe(400);
      expect(calculateBackoffDelay(5, 100, 500, 2, false)).toBe(500); // capped at maxTimeoutMs

      // With jitter (within range [0, capped])
      const jittered = calculateBackoffDelay(3, 100, 1000, 2, true);
      expect(jittered).toBeGreaterThanOrEqual(0);
      expect(jittered).toBeLessThanOrEqual(400);
    });
  });

  describe('CircuitBreakerRegistry', () => {
    it('should store and reuse named breakers', () => {
      const registry = new CircuitBreakerRegistry();
      const b1 = registry.getBreaker('stripe', { failureThreshold: 3 });
      const b2 = registry.getBreaker('stripe');

      expect(b1).toBe(b2);
      expect(b1.name).toBe('stripe');
      expect(registry.hasBreaker('stripe')).toBe(true);
      expect(registry.hasBreaker('unknown')).toBe(false);
      expect(registry.getAllBreakers()).toEqual([b1]);
    });

    it('should generate telemetry stats for all breakers', () => {
      const registry = new CircuitBreakerRegistry();
      const b1 = registry.getBreaker('serviceA');
      const b2 = registry.getBreaker('serviceB');

      const stats = registry.getStats();
      expect(stats.serviceA).toBeDefined();
      expect(stats.serviceB).toBeDefined();
      expect(stats.serviceA.state).toBe(STATE_CLOSED);
    });

    it('should reset all breakers to CLOSED', () => {
      const registry = new CircuitBreakerRegistry();
      const b1 = registry.getBreaker('service1');
      b1.open();
      expect(b1.isOpen).toBe(true);

      registry.resetAll();
      expect(b1.isClosed).toBe(true);
    });
  });

  describe('Services Layer Integration (src/services)', () => {
    it('should protect services using circuitBreaker configuration', async () => {
      const registry = createServiceRegistry();
      let callCount = 0;

      registry.register('payment.charge', defineService({
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeout: 500,
        },
        handler: async (input) => {
          callCount++;
          if (input.fail) {
            const err = new Error('Payment gateway 502');
            err.statusCode = 502;
            throw err;
          }
          return { charged: true, amount: input.amount };
        },
      }));

      // Initial successful call
      const res1 = await registry.call('payment.charge', { amount: 100 });
      expect(res1).toEqual({ charged: true, amount: 100 });

      // Two consecutive failures trip circuit breaker
      await expect(registry.call('payment.charge', { fail: true })).rejects.toThrow('Payment gateway 502');
      await expect(registry.call('payment.charge', { fail: true })).rejects.toThrow('Payment gateway 502');

      // Next call fast-fails with CircuitBreakerOpenError
      await expect(registry.call('payment.charge', { amount: 50 })).rejects.toThrow(CircuitBreakerOpenError);
      expect(callCount).toBe(3); // Handler was NOT invoked on the 4th call!
    });

    it('should support fallback in service circuitBreaker configuration', async () => {
      const registry = createServiceRegistry();

      registry.register('stock.lookup', defineService({
        circuitBreaker: {
          failureThreshold: 1,
          fallback: (err, input) => ({ id: input.id, stock: 0, fromCache: true }),
        },
        handler: async (input) => {
          const err = new Error('Warehouse offline');
          err.statusCode = 503;
          throw err;
        },
      }));

      const result = await registry.call('stock.lookup', { id: 'SKU-99' });
      expect(result).toEqual({ id: 'SKU-99', stock: 0, fromCache: true });
    });

    it('should automatically retry transient service failures when retry is configured', async () => {
      const registry = createServiceRegistry();
      let attempts = 0;

      registry.register('weather.get', defineService({
        retry: {
          retries: 3,
          delay: 5,
        },
        handler: async () => {
          attempts++;
          if (attempts < 3) {
            const err = new Error('Upstream timeout');
            err.code = 'ETIMEDOUT';
            throw err;
          }
          return { temp: 22, condition: 'Sunny' };
        },
      }));

      const res = await registry.call('weather.get');
      expect(res).toEqual({ temp: 22, condition: 'Sunny' });
      expect(attempts).toBe(3);
    });

    it('should expose ctx.breaker and ctx.retry inside service handlers', async () => {
      const registry = createServiceRegistry();

      registry.register('resilient.worker', defineService({
        handler: async (input, ctx) => {
          expect(typeof ctx.breaker).toBe('function');
          expect(typeof ctx.retry).toBe('function');

          const customBreaker = ctx.breaker('custom-resource');
          expect(customBreaker).toBeDefined();

          const retriedVal = await ctx.retry(async (attempt) => `attempt_${attempt}`, { retries: 1 });
          return { ok: true, retriedVal };
        },
      }));

      const result = await registry.call('resilient.worker');
      expect(result).toEqual({ ok: true, retriedVal: 'attempt_1' });
    });
  });

  describe('Webspresso Server & App Integration', () => {
    it('should expose app.breakers, app.getBreaker, and req.breaker/req.retry', () => {
      const { app } = createApp({ rootDir: process.cwd() });

      expect(app.breakers).toBeDefined();
      expect(typeof app.getBreaker).toBe('function');

      const breaker = app.getBreaker('test-route-breaker', { failureThreshold: 5 });
      expect(breaker.name).toBe('test-route-breaker');
      expect(breaker.failureThreshold).toBe(5);
    });
  });
});

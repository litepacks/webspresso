import { describe, it, expect, afterEach } from 'vitest';

const {
  CircuitBreaker,
  CircuitBreakerRegistry,
  STATE_CLOSED,
  STATE_OPEN,
  STATE_HALF_OPEN,
  CircuitBreakerOpenError,
  CircuitBreakerTimeoutError,
  retry,
  withRetry,
  isTransientError,
  calculateBackoffDelay,
} = require('../../../core/resilience');

describe('Resilience Stress Lab', () => {
  const registries = [];

  afterEach(() => {
    while (registries.length > 0) {
      registries.pop().clear();
    }
  });

  it('1. handles 500 concurrent calls through CircuitBreaker with state transitions CLOSED -> OPEN -> HALF_OPEN -> CLOSED', async () => {
    const transitions = [];
    const breaker = new CircuitBreaker({
      name: 'payment-gateway',
      failureThreshold: 5,
      successThreshold: 3,
      halfOpenMaxCalls: 3,
      resetTimeout: 250,
      onStateChange: (from, to) => transitions.push(`${from}->${to}`),
    });

    expect(breaker.state).toBe(STATE_CLOSED);

    // Trigger 5 consecutive failures to trip the circuit
    for (let i = 0; i < 5; i++) {
      await expect(
        breaker.execute(async () => {
          const err = new Error(`upstream 503 #${i}`);
          err.statusCode = 503;
          throw err;
        }),
      ).rejects.toThrow('upstream 503');
    }

    expect(breaker.state).toBe(STATE_OPEN);
    expect(breaker.isOpen).toBe(true);

    // 200 concurrent calls while OPEN must fast-fail with CircuitBreakerOpenError
    const openResults = await Promise.allSettled(
      Array.from({ length: 200 }, () => breaker.execute(async () => 'should-not-run')),
    );
    expect(openResults.every((r) => r.status === 'rejected' && r.reason instanceof CircuitBreakerOpenError)).toBe(true);
    expect(breaker.metrics.rejectedCalls).toBe(200);

    // Wait for resetTimeout to allow HALF_OPEN transition
    await new Promise((r) => setTimeout(r, 280));

    // Fire 10 concurrent trial calls: halfOpenMaxCalls=3 allows 3 trial calls, rejects 7 extras
    let executedTrials = 0;
    const trialResults = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        breaker.execute(async () => {
          executedTrials += 1;
          await new Promise((r) => setTimeout(r, 10));
          return 'ok';
        }),
      ),
    );

    const fulfilled = trialResults.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBe(3);
    expect(executedTrials).toBe(3);
    expect(breaker.state).toBe(STATE_CLOSED);
    expect(transitions).toEqual([
      `${STATE_CLOSED}->${STATE_OPEN}`,
      `${STATE_OPEN}->${STATE_HALF_OPEN}`,
      `${STATE_HALF_OPEN}->${STATE_CLOSED}`,
    ]);

    // Burst 250 successful calls in CLOSED state
    const closedBurst = await Promise.all(
      Array.from({ length: 250 }, (_, i) => breaker.execute(async () => i * 2)),
    );
    expect(closedBurst[249]).toBe(498);
    expect(breaker.metrics.successfulCalls).toBe(253);
  });

  it('2. enforces per-call timeouts, fallback execution, and 4xx non-failure classification', async () => {
    const breaker = new CircuitBreaker({
      name: 'slow-service',
      failureThreshold: 3,
      timeout: 25,
      fallback: (err, arg) => `fallback:${err.name}:${arg}`,
    });

    // Slow call triggers CircuitBreakerTimeoutError -> caught by fallback
    const fb1 = await breaker.execute(async () => {
      await new Promise((r) => setTimeout(r, 80));
      return 'late';
    }, 'req-1');
    expect(fb1).toBe('fallback:CircuitBreakerTimeoutError:req-1');
    expect(breaker.metrics.timedOutCalls).toBe(1);
    expect(breaker.metrics.fallbackCalls).toBe(1);

    // 404 client error is NOT counted as a circuit failure
    const clientErrBreaker = new CircuitBreaker({ failureThreshold: 2 });
    for (let i = 0; i < 10; i++) {
      await expect(
        clientErrBreaker.execute(async () => {
          const e = new Error('Not Found');
          e.statusCode = 404;
          throw e;
        }),
      ).rejects.toThrow('Not Found');
    }
    expect(clientErrBreaker.state).toBe(STATE_CLOSED);
    expect(clientErrBreaker.consecutiveFailures).toBe(0);

    // Without fallback, timeout rejects with CircuitBreakerTimeoutError
    const noFbBreaker = new CircuitBreaker({ timeout: 15, failureThreshold: 5 });
    await expect(
      noFbBreaker.execute(async () => {
        await new Promise((r) => setTimeout(r, 60));
      }),
    ).rejects.toBeInstanceOf(CircuitBreakerTimeoutError);
  });

  it('3. executes exponential backoff retry engine across 50 concurrent flaky tasks and AbortSignal', async () => {
    expect(isTransientError({ code: 'ECONNRESET' })).toBe(true);
    expect(isTransientError({ statusCode: 429 })).toBe(true);
    expect(isTransientError({ statusCode: 400 })).toBe(false);
    expect(calculateBackoffDelay(3, 10, 50, 2, false)).toBe(40);
    expect(calculateBackoffDelay(5, 10, 50, 2, false)).toBe(50);

    // 50 concurrent tasks that fail twice with ECONNRESET and succeed on 3rd attempt
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, idx) => {
        let attempts = 0;
        const wrapped = withRetry(
          async (v) => {
            attempts += 1;
            if (attempts < 3) {
              const err = new Error('reset');
              err.code = 'ECONNRESET';
              throw err;
            }
            return `${v}-${attempts}`;
          },
          { retries: 3, minTimeout: 2, maxTimeout: 10, jitter: true },
        );
        return wrapped(`job-${idx}`);
      }),
    );
    expect(results).toHaveLength(50);
    expect(results[0]).toBe('job-0-3');
    expect(results[49]).toBe('job-49-3');

    // Non-transient 400 error aborts retry immediately
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls += 1;
          const err = new Error('Bad Request');
          err.statusCode = 400;
          throw err;
        },
        { retries: 5, minTimeout: 5 },
      ),
    ).rejects.toThrow('Bad Request');
    expect(calls).toBe(1);

    // AbortSignal cancels in-flight retry sleep
    const ac = new AbortController();
    setTimeout(() => ac.abort(new Error('Cancelled by caller')), 10);
    await expect(
      retry(
        async () => {
          const e = new Error('transient');
          e.code = 'ETIMEDOUT';
          throw e;
        },
        { retries: 5, minTimeout: 200, signal: ac.signal },
      ),
    ).rejects.toThrow('Cancelled by caller');
  });

  it('4. manages 100 named breakers in CircuitBreakerRegistry with bulk stats and resetAll()', async () => {
    const registry = new CircuitBreakerRegistry();
    registries.push(registry);

    for (let i = 0; i < 100; i++) {
      const b = registry.getBreaker(`svc-${i}`, { failureThreshold: 1 });
      if (i % 2 === 0) {
        await expect(b.execute(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
      } else {
        await b.execute(async () => 'ok');
      }
    }

    expect(registry.getAllBreakers()).toHaveLength(100);
    expect(registry.hasBreaker('svc-42')).toBe(true);

    const stats = registry.getStats();
    expect(stats['svc-0'].state).toBe(STATE_OPEN);
    expect(stats['svc-1'].state).toBe(STATE_CLOSED);

    registry.resetAll();
    const afterReset = registry.getStats();
    expect(afterReset['svc-0'].state).toBe(STATE_CLOSED);
  });
});

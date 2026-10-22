const {
  wait,
  sleep,
  deferredPromise,
  createDeferred,
  waitForCondition,
  waitFor,
  withTimeout,
} = require('../utils/async');

describe('Test Utilities - Async & Polling (Step 4)', () => {
  describe('wait and sleep', () => {
    it('pauses execution for the specified milliseconds', async () => {
      const start = Date.now();
      await wait(30);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(25);
    });

    it('sleep is an alias for wait and handles 0 or invalid values gracefully', async () => {
      await expect(sleep(0)).resolves.toBeUndefined();
      await expect(sleep(-10)).resolves.toBeUndefined();
      await expect(sleep(null)).resolves.toBeUndefined();
    });
  });

  describe('deferredPromise and createDeferred', () => {
    it('resolves when resolve handle is called', async () => {
      const { promise, resolve } = deferredPromise();
      setTimeout(() => resolve('success'), 10);
      const res = await promise;
      expect(res).toBe('success');
    });

    it('rejects when reject handle is called', async () => {
      const { promise, reject } = createDeferred();
      setTimeout(() => reject(new Error('failure')), 10);
      await expect(promise).rejects.toThrow('failure');
    });
  });

  describe('waitForCondition', () => {
    it('resolves once predicate returns a truthy value', async () => {
      let counter = 0;
      setTimeout(() => { counter = 5; }, 30);

      const result = await waitForCondition(() => counter >= 5 && 'done', {
        timeout: 500,
        interval: 10,
      });

      expect(result).toBe('done');
    });

    it('throws when timeout is reached', async () => {
      await expect(
        waitForCondition(() => false, {
          timeout: 50,
          interval: 10,
          message: 'condition never met',
        })
      ).rejects.toThrow('condition never met');
    });

    it('tolerates errors inside predicate while polling', async () => {
      let attempts = 0;
      const res = await waitForCondition(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error('transient_error');
        }
        return 'passed';
      }, { timeout: 300, interval: 10 });

      expect(res).toBe('passed');
    });
  });

  describe('waitFor', () => {
    it('retries assertion until it succeeds without throwing', async () => {
      let value = 0;
      setTimeout(() => { value = 42; }, 30);

      await waitFor(() => {
        expect(value).toBe(42);
      }, { timeout: 500, interval: 10 });

      expect(value).toBe(42);
    });

    it('throws the last assertion error when timeout is reached', async () => {
      await expect(
        waitFor(() => {
          expect(1).toBe(2);
        }, { timeout: 50, interval: 10 })
      ).rejects.toThrow();
    });
  });

  describe('withTimeout', () => {
    it('resolves with the promise value if resolved before timeout', async () => {
      const fastPromise = wait(10).then(() => 'quick');
      const result = await withTimeout(fastPromise, 200);
      expect(result).toBe('quick');
    });

    it('rejects with timeout error if promise exceeds deadline', async () => {
      const slowPromise = wait(150).then(() => 'too slow');
      await expect(withTimeout(slowPromise, 40, 'deadline exceeded')).rejects.toThrow('deadline exceeded');
    });
  });
});

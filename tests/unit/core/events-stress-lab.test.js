'use strict';

/**
 * Webspresso - Core Events Stress Lab
 * Stress-tests priority ordering, wildcard/once pruning, async/serial/waterfall dispatch
 * under partial failures, Signal sender filtering, waitFor() races, and zero-leak listener churn.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createEventDispatcher,
  defineSignal,
  loadListeners,
} = require('../../../core/events');

describe('Core Events Stress Lab (Dispatcher, Wildcards, Signals, Waterfall, Churn)', () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('1. enforces priority ordering, wildcard matching, and once-listener pruning across 500 emissions', () => {
    const dispatcher = createEventDispatcher({ maxListeners: 500 });
    const trace = [];
    let onceCount = 0;
    let anyCount = 0;

    dispatcher.on('order.created', () => trace.push('low'), { priority: 1 });
    dispatcher.on('order.created', () => trace.push('high'), { priority: 100 });
    dispatcher.on('order.*', () => trace.push('wild-mid'), { priority: 50 });
    dispatcher.once('order.created', () => {
      onceCount++;
      trace.push('once-top');
    }, { priority: 200 });
    dispatcher.onAny(() => {
      anyCount++;
    });

    // Register 100 extra exact listeners and immediately unsubscribe half
    const unsubs = [];
    for (let i = 0; i < 100; i++) {
      unsubs.push(dispatcher.on(`bulk.evt.${i % 10}`, () => {}));
    }
    for (let i = 0; i < 50; i++) {
      unsubs[i]();
    }

    // First emit triggers once-top -> high -> wild-mid -> low
    dispatcher.emit('order.created', { id: 1 });
    expect(trace).toEqual(['once-top', 'high', 'wild-mid', 'low']);
    expect(onceCount).toBe(1);

    // Remaining 499 emits must NOT re-trigger once-top
    for (let i = 2; i <= 500; i++) {
      trace.length = 0;
      dispatcher.emit('order.created', { id: i });
      expect(trace).toEqual(['high', 'wild-mid', 'low']);
    }

    expect(onceCount).toBe(1);
    expect(anyCount).toBe(500);
    expect(dispatcher.listenerCount('order.created')).toBe(4); // high, wild-mid, low, onAny
  });

  it('2. isolates listener failures in emitAsync(), preserves serial order in emitSerial(), and chains emitWaterfall()', async () => {
    const dispatcher = createEventDispatcher({
      logger: { error: () => {}, warn: () => {}, log: () => {} },
    });

    // emitAsync with mixed succeeding and failing async handlers
    for (let i = 0; i < 20; i++) {
      dispatcher.on('job.run', async (payload) => {
        await new Promise((r) => setTimeout(r, (20 - i) % 5));
        if (i % 4 === 0) {
          throw new Error(`listener-fail-${i}`);
        }
        return payload.base + i;
      }, { priority: i });
    }

    const asyncResults = await dispatcher.emitAsync('job.run', { base: 100 });
    expect(asyncResults).toHaveLength(20);
    const fulfilled = asyncResults.filter((r) => r.status === 'fulfilled');
    const rejected = asyncResults.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(15);
    expect(rejected).toHaveLength(5);

    // emitSerial must execute strictly in descending priority order without overlap
    const serialOrder = [];
    let inFlight = 0;
    let maxConcurrency = 0;
    for (let p = 1; p <= 10; p++) {
      dispatcher.on('pipe.serial', async () => {
        inFlight++;
        maxConcurrency = Math.max(maxConcurrency, inFlight);
        await new Promise((r) => setTimeout(r, (11 - p) % 3));
        serialOrder.push(p);
        inFlight--;
        return p;
      }, { priority: p });
    }

    const serialResults = await dispatcher.emitSerial('pipe.serial', {});
    expect(maxConcurrency).toBe(1);
    expect(serialOrder).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(serialResults).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);

    // emitWaterfall chains return value across 8 stages
    for (let s = 1; s <= 8; s++) {
      dispatcher.on('pipe.water', async (val) => val + s, { priority: 100 - s });
    }
    const finalVal = await dispatcher.emitWaterfall('pipe.water', 0);
    expect(finalVal).toBe(36); // 1+2+3+4+5+6+7+8
  });

  it('3. enforces Django-style Signal sender filtering and handles concurrent waitFor() races & timeouts', async () => {
    const dispatcher = createEventDispatcher();
    const invoicePaid = defineSignal('invoice.paid', dispatcher);

    class StripeGateway {}
    class PolarGateway {}

    let stripeHits = 0;
    let polarHits = 0;
    let allHits = 0;

    invoicePaid.connect(() => { stripeHits++; }, { sender: StripeGateway });
    invoicePaid.connect(() => { polarHits++; }, { sender: PolarGateway });
    invoicePaid.connect(() => { allHits++; });

    // Burst 100 signals alternating senders
    const sends = [];
    for (let i = 0; i < 100; i++) {
      const sender = i % 2 === 0 ? StripeGateway : PolarGateway;
      sends.push(invoicePaid.sendAsync({ amount: i }, { sender }));
    }
    await Promise.all(sends);

    expect(stripeHits).toBe(50);
    expect(polarHits).toBe(50);
    expect(allHits).toBe(100);

    // Concurrent waitFor() race: 10 matching waiters + 5 timing-out waiters
    const matchingWaiters = Array.from({ length: 10 }, (_, idx) =>
      invoicePaid.waitFor({
        timeout: 500,
        filter: (data) => data.batch === idx,
      })
    );
    const timeoutWaiters = Array.from({ length: 5 }, () =>
      invoicePaid.waitFor({
        timeout: 25,
        filter: (data) => data.neverMatches === true,
      })
    );

    // Emit matching events
    for (let idx = 0; idx < 10; idx++) {
      invoicePaid.send({ batch: idx });
    }

    const resolved = await Promise.all(matchingWaiters);
    expect(resolved.map((r) => r.data.batch)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const timeoutOutcomes = await Promise.allSettled(timeoutWaiters);
    for (const outcome of timeoutOutcomes) {
      expect(outcome.status).toBe('rejected');
    }
  });

  it('4. bridges wildcard events to queue via listenAndQueue() and loads listeners from disk', async () => {
    const dispatchedJobs = [];
    const mockQueue = {
      dispatch: async (jobName, payload, opts) => {
        dispatchedJobs.push({ jobName, payload, opts });
      },
    };

    const dispatcher = createEventDispatcher({ queue: mockQueue });
    dispatcher.listenAndQueue('billing.*', 'billing.process', { priority: 'high' });

    for (let i = 0; i < 40; i++) {
      await dispatcher.emitAsync(`billing.${i % 2 === 0 ? 'charged' : 'refunded'}`, { id: i });
    }

    expect(dispatchedJobs).toHaveLength(40);
    expect(dispatchedJobs[0].jobName).toBe('billing.process');
    expect(dispatchedJobs[0].opts).toEqual({ priority: 'high' });

    // Disk discovery test
    const listenersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-events-stress-'));
    tempDirs.push(listenersDir);

    const eventsIndexPath = JSON.stringify(path.resolve(__dirname, '../../../core/events'));
    fs.writeFileSync(
      path.join(listenersDir, 'audit.js'),
      `const { defineListener } = require(${eventsIndexPath});
module.exports = defineListener('user.signup', async (data) => { data.seen = true; });
`
    );

    const loaded = loadListeners(listenersDir, dispatcher);
    expect(loaded.length).toBeGreaterThanOrEqual(1);
    const payload = { userId: 7 };
    await dispatcher.emitAsync('user.signup', payload);
    expect(payload.seen).toBe(true);
  });

  it('5. leaves zero dangling listeners across 1,000 subscribe/emit/unsubscribe churn cycles', () => {
    const dispatcher = createEventDispatcher({ maxListeners: 2000 });

    for (let i = 0; i < 1000; i++) {
      const offExact = dispatcher.on(`churn.${i % 25}`, () => {});
      const offWild = dispatcher.on(`churn.${i % 5}.*`, () => {});
      const offAny = dispatcher.onAny(() => {});

      dispatcher.emit(`churn.${i % 25}`, { i });

      offExact();
      offWild();
      offAny();
    }

    expect(dispatcher.exactListeners.size).toBe(0);
    expect(dispatcher.wildcardListeners).toHaveLength(0);
    expect(dispatcher.anyListeners).toHaveLength(0);
    expect(dispatcher.eventNames()).toHaveLength(0);
  });
});

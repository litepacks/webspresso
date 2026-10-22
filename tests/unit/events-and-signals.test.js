import { createTempDir, cleanupDir } from '../utils';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import {
  EventDispatcher,
  createEventDispatcher,
  Signal,
  defineSignal,
  defineListener,
  loadListeners,
  createApp,
} from '../../index.js';

describe('Decoupled Events & Signals System (AdonisJS Events & Django Signals-inspired)', () => {
  let dispatcher;

  beforeEach(() => {
    dispatcher = createEventDispatcher();
  });

  afterEach(() => {
    dispatcher.clear();
  });

  describe('EventDispatcher - Synchronous & Lifecycle', () => {
    it('registers listener and receives emitted data with unsubscribe function', () => {
      const calls = [];
      const unsub = dispatcher.on('user.registered', (data, meta) => {
        calls.push({ data, meta });
      });

      const fired1 = dispatcher.emit('user.registered', { id: 1, name: 'Alice' });
      expect(fired1).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0].data).toEqual({ id: 1, name: 'Alice' });
      expect(calls[0].meta.event).toBe('user.registered');

      // Unsubscribe
      unsub();
      const fired2 = dispatcher.emit('user.registered', { id: 2 });
      expect(fired2).toBe(false);
      expect(calls).toHaveLength(1);
    });

    it('handles once() listeners correctly', () => {
      const calls = [];
      dispatcher.once('order.paid', (data) => calls.push(data));

      dispatcher.emit('order.paid', { id: 101 });
      dispatcher.emit('order.paid', { id: 102 });

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ id: 101 });
    });

    it('respects listener execution priority', () => {
      const order = [];
      dispatcher.on('run', () => order.push('low'), { priority: -10 });
      dispatcher.on('run', () => order.push('high'), { priority: 100 });
      dispatcher.on('run', () => order.push('default'), { priority: 0 });

      dispatcher.emit('run');
      expect(order).toEqual(['high', 'default', 'low']);
    });

    it('supports custom event class instances with eventName property', () => {
      class UserSignupEvent {
        constructor(user) {
          this.eventName = 'user.signup';
          this.user = user;
        }
      }

      let received = null;
      dispatcher.on('user.signup', (event) => {
        received = event.user;
      });

      dispatcher.emit(new UserSignupEvent({ email: 'bob@example.com' }));
      expect(received).toEqual({ email: 'bob@example.com' });
    });
  });

  describe('Wildcard Pattern Matching & onAny (AdonisJS-style)', () => {
    it('matches wildcard segments (order.* vs user.*)', () => {
      const received = [];
      dispatcher.on('order.*', (data, meta) => {
        received.push(meta.event);
      });

      dispatcher.emit('order.created', { id: 1 });
      dispatcher.emit('order.cancelled', { id: 2 });
      dispatcher.emit('user.created', { id: 3 });

      expect(received).toEqual(['order.created', 'order.cancelled']);
    });

    it('matches multi-level wildcards (** or *)', () => {
      const received = [];
      dispatcher.on('system.**', (data, meta) => {
        received.push(meta.event);
      });

      dispatcher.emit('system.cache.flush');
      dispatcher.emit('system.auth.login.failed');
      dispatcher.emit('app.started');

      expect(received).toEqual(['system.cache.flush', 'system.auth.login.failed']);
    });

    it('catches all events with onAny()', () => {
      const all = [];
      dispatcher.onAny((event, data) => {
        all.push({ event, data });
      });

      dispatcher.emit('ping', 1);
      dispatcher.emit('pong', 2);

      expect(all).toHaveLength(2);
      expect(all[0]).toEqual({ event: 'ping', data: 1 });
      expect(all[1]).toEqual({ event: 'pong', data: 2 });
    });
  });

  describe('Async Emission Modes (emitAsync, emitSerial, emitWaterfall)', () => {
    it('emitAsync runs listeners in parallel and returns settled results', async () => {
      dispatcher.on('compute', async (x) => x * 2);
      dispatcher.on('compute', async (x) => x * 3);

      const results = await dispatcher.emitAsync('compute', 10);
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ status: 'fulfilled', value: 20 });
      expect(results[1]).toEqual({ status: 'fulfilled', value: 30 });
    });

    it('emitSerial runs async listeners in sequence', async () => {
      const timeline = [];
      dispatcher.on('step', async () => {
        await new Promise((r) => setTimeout(r, 1));
        timeline.push('first');
        return 1;
      });
      dispatcher.on('step', async () => {
        timeline.push('second');
        return 2;
      });

      const res = await dispatcher.emitSerial('step');
      expect(timeline).toEqual(['first', 'second']);
      expect(res).toEqual([1, 2]);
    });

    it('emitWaterfall pipelines transformed values through listeners', async () => {
      dispatcher.on('format', (text) => text.trim());
      dispatcher.on('format', (text) => text.toLowerCase());
      dispatcher.on('format', (text) => `[${text}]`);

      const final = await dispatcher.emitWaterfall('format', '  HELLO WORLD  ');
      expect(final).toBe('[hello world]');
    });
  });

  describe('Django-Style Signals & Sender Filtering', () => {
    it('filters execution by sender class/string', () => {
      const calls = [];
      dispatcher.on('model:saved', (record) => calls.push(record), { sender: 'Order' });

      // Emitted with different sender
      dispatcher.emit('model:saved', { id: 1 }, { sender: 'Product' });
      expect(calls).toHaveLength(0);

      // Emitted with matching sender
      dispatcher.emit('model:saved', { id: 2 }, { sender: 'Order' });
      expect(calls).toEqual([{ id: 2 }]);
    });

    it('works with declarative defineSignal()', async () => {
      const orderPlaced = defineSignal('order_placed', dispatcher);
      const orders = [];

      orderPlaced.connect((data) => orders.push(data.orderId), { sender: 'Checkout' });

      orderPlaced.send({ orderId: 'ORD-999' }, { sender: 'Checkout' });
      expect(orders).toEqual(['ORD-999']);

      // Disconnect
      orderPlaced.disconnect();
    });
  });

  describe('Queue Bridge (listenAndQueue)', () => {
    it('dispatches to background queue when event is emitted', () => {
      const mockQueue = {
        dispatch: vi.fn(),
      };
      dispatcher.setQueue(mockQueue);

      dispatcher.listenAndQueue('user.created', 'send-welcome-email', { attempts: 5 });
      dispatcher.emit('user.created', { email: 'welcome@test.com' });

      expect(mockQueue.dispatch).toHaveBeenCalledWith(
        'send-welcome-email',
        { email: 'welcome@test.com' },
        { attempts: 5 }
      );
    });
  });

  describe('Listener File Discovery (loadListeners)', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = createTempDir('webspresso-listeners');
    });

    afterEach(() => {
      cleanupDir(tmpDir);
    });

    it('loads listeners exported as objects or functions', () => {
      const listenerCode = `
        module.exports = {
          event: 'invoice.generated',
          handle: (data) => data.invoiceId,
        };
      `;
      fs.writeFileSync(path.join(tmpDir, 'invoice.js'), listenerCode);

      const loaded = loadListeners(tmpDir, dispatcher);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].event).toBe('invoice.generated');

      let result = null;
      dispatcher.on('invoice.generated', (data) => {
        result = data.invoiceId;
      });
      dispatcher.emit('invoice.generated', { invoiceId: 'INV-42' });
      expect(result).toBe('INV-42');
    });
  });

  describe('Webspresso Server Integration', () => {
    let appObj;
    let tempDir;

    beforeAll(() => {
      tempDir = createTempDir('webspresso-app-events');
      fs.mkdirSync(path.join(tempDir, 'pages', 'api'), { recursive: true });

      // Create an API route testing req.events
      fs.writeFileSync(
        path.join(tempDir, 'pages', 'api', 'notify.post.js'),
        `
        module.exports = {
          async handler(req, res) {
            req.events.emit('api.called', req.body);
            return res.json({ ok: true });
          }
        };
        `
      );

      appObj = createApp({
        rootDir: tempDir,
        pagesDir: path.join(tempDir, 'pages'),
        silent: true,
        helmet: false,
        compression: false,
        cache: false,
        healthCheck: false,
        metrics: false,
        lazyRoutes: true,
      });
    });

    afterAll(async () => {
      if (appObj?.shutdownManager) {
        await appObj.shutdownManager.close('test');
      }
      cleanupDir(tempDir);
    });

    it('exposes app.events, req.events, and drains on shutdown', async () => {
      expect(appObj.events).toBeDefined();
      expect(appObj.app.events).toBe(appObj.events);

      const received = [];
      appObj.events.on('api.called', (body) => {
        received.push(body);
      });

      const res = await request(appObj.app)
        .post('/api/notify')
        .send({ message: 'Hello from API!' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(received).toEqual([{ message: 'Hello from API!' }]);

      // Shutdown clears dispatcher listeners
      await appObj.shutdownManager.close('test');
      expect(appObj.events.listenerCount()).toBe(0);
    });
  });
});

/**
 * Unit tests for Webspresso ORM Model Events System
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import EventEmitter from 'events';
import {
  ModelEvents,
  ModelEventsClass,
  createEventContext,
  Hooks,
  HookCancellationError,
} from '../../../core/orm/events';

describe('ModelEvents & Lifecycle Signals System', () => {
  let bus;

  beforeEach(() => {
    bus = new ModelEventsClass();
  });

  afterEach(() => {
    bus.removeAllListeners();
  });

  describe('createEventContext & HookCancellationError', () => {
    it('creates context with cancel function and tracks reason', () => {
      const trx = { id: 'trx_123' };
      const ctx = createEventContext('User', 'beforeCreate', trx);

      expect(ctx.model).toBe('User');
      expect(ctx.operation).toBe('beforeCreate');
      expect(ctx.trx).toBe(trx);
      expect(ctx.isCancelled).toBe(false);
      expect(ctx.cancelReason).toBeNull();

      ctx.cancel('Email must be unique');
      expect(ctx.isCancelled).toBe(true);
      expect(ctx.cancelReason).toBe('Email must be unique');
    });

    it('instantiates HookCancellationError with details', () => {
      const err = new HookCancellationError('Aborted by hook', 'User', 'beforeDelete');
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('HookCancellationError');
      expect(err.model).toBe('User');
      expect(err.hook).toBe('beforeDelete');
      expect(err.reason).toBe('Aborted by hook');
    });
  });

  describe('Listeners & Registration', () => {
    it('throws when listener callback is not a function', () => {
      expect(() => bus.on('User.beforeCreate', null)).toThrow('Callback must be a function');
      expect(() => bus.on('User.beforeCreate', 'not-a-fn')).toThrow('Callback must be a function');
    });

    it('registers and removes listeners with off and returned unsubscribe function', () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();

      const unsub1 = bus.on('User.afterCreate', fn1);
      bus.on('User.afterCreate', fn2);

      expect(bus.listenerCount('User.afterCreate')).toBe(2);
      expect(bus.hasListeners('User', 'afterCreate')).toBe(true);

      unsub1();
      expect(bus.listenerCount('User.afterCreate')).toBe(1);

      const removed = bus.off('User.afterCreate', fn2);
      expect(removed).toBe(true);
      expect(bus.listenerCount('User.afterCreate')).toBe(0);
      expect(bus.hasListeners('User', 'afterCreate')).toBe(false);

      expect(bus.off('User.afterCreate', fn2)).toBe(false);
    });

    it('once listener triggers only on first emission and unbinds', async () => {
      const fn = vi.fn();
      bus.once('User.afterSave', fn);

      expect(bus.listenerCount('User.afterSave')).toBe(1);

      await bus.emitAsync('User', 'afterSave', { id: 1 });
      expect(fn).toHaveBeenCalledTimes(1);
      expect(bus.listenerCount('User.afterSave')).toBe(0);

      await bus.emitAsync('User', 'afterSave', { id: 2 });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('listenScoped unregisters listener when target emits finish or close', () => {
      const target = new EventEmitter();
      const fn = vi.fn();

      bus.listenScoped('Post.beforeCreate', fn, target);
      expect(bus.listenerCount('Post.beforeCreate')).toBe(1);

      target.emit('finish');
      expect(bus.listenerCount('Post.beforeCreate')).toBe(0);

      const target2 = new EventEmitter();
      bus.listenScoped('Post.beforeCreate', fn, target2);
      expect(bus.listenerCount('Post.beforeCreate')).toBe(1);

      target2.emit('close');
      expect(bus.listenerCount('Post.beforeCreate')).toBe(0);
    });

    it('removeAllListeners clears specific event or all events', () => {
      bus.on('A.hook', () => {});
      bus.on('A.hook', () => {});
      bus.on('B.hook', () => {});

      expect(bus.listenerCount()).toBe(3);

      bus.removeAllListeners('A.hook');
      expect(bus.listenerCount('A.hook')).toBe(0);
      expect(bus.listenerCount('B.hook')).toBe(1);

      bus.removeAllListeners();
      expect(bus.listenerCount()).toBe(0);
      expect(bus.eventNames()).toEqual([]);
    });

    it('validates setMaxListeners and warns when threshold exceeded', () => {
      expect(() => bus.setMaxListeners(-1)).toThrow(TypeError);
      expect(() => bus.setMaxListeners('invalid')).toThrow(TypeError);

      bus.setMaxListeners(2);
      expect(bus.getMaxListeners()).toBe(2);

      const emitWarningSpy = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});

      bus.on('Test.event', () => {});
      bus.on('Test.event', () => {});
      expect(emitWarningSpy).not.toHaveBeenCalled();

      bus.on('Test.event', () => {});
      expect(emitWarningSpy).toHaveBeenCalledWith(
        expect.stringContaining('Possible ModelEvents memory leak detected'),
        'MaxListenersExceededWarning'
      );

      emitWarningSpy.mockRestore();
    });
  });

  describe('Wildcard Resolution & Matching', () => {
    it('matches exact, model wildcard, hook wildcard, and all wildcard', () => {
      const l1 = vi.fn(); // User.beforeCreate
      const l2 = vi.fn(); // *.beforeCreate
      const l3 = vi.fn(); // User.*
      const l4 = vi.fn(); // *.*

      bus.on('User.beforeCreate', l1);
      bus.on('*.beforeCreate', l2);
      bus.on('User.*', l3);
      bus.on('*.*', l4);

      const matches = bus.getMatchingListeners('User', 'beforeCreate');
      expect(matches).toContain(l1);
      expect(matches).toContain(l2);
      expect(matches).toContain(l3);
      expect(matches).toContain(l4);
      expect(matches.length).toBe(4);

      const otherMatches = bus.getMatchingListeners('Product', 'beforeCreate');
      expect(otherMatches).not.toContain(l1);
      expect(otherMatches).toContain(l2);
      expect(otherMatches).not.toContain(l3);
      expect(otherMatches).toContain(l4);

      expect(bus.hasListeners('Product', 'beforeCreate')).toBe(true);
      expect(bus.hasListeners('NonExistent', 'unknownHook')).toBe(true); // Because *.* is registered
    });

    it('returns empty array when no listeners match', () => {
      expect(bus.getMatchingListeners('User', 'afterDelete')).toEqual([]);
      expect(bus.hasListeners('User', 'afterDelete')).toBe(false);
    });
  });

  describe('Event Emission (Sync & Async)', () => {
    it('emit executes all matching listeners synchronously without throwing on listener failure', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const l1 = vi.fn();
      const l2 = vi.fn().mockImplementation(() => {
        throw new Error('Boom');
      });
      const l3 = vi.fn();

      bus.on('User.afterCreate', l1);
      bus.on('User.afterCreate', l2);
      bus.on('User.afterCreate', l3);

      const ctx = bus.emit('User', 'afterCreate', { id: 10 });

      expect(l1).toHaveBeenCalledWith({ id: 10 }, ctx);
      expect(l2).toHaveBeenCalledWith({ id: 10 }, ctx);
      expect(l3).toHaveBeenCalledWith({ id: 10 }, ctx);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('emitAsync waits for async listeners and halts on cancellation', async () => {
      const trace = [];

      bus.on('Order.beforeCreate', async (data, ctx) => {
        await new Promise((r) => setTimeout(r, 10));
        trace.push('step1');
        ctx.cancel('Stock depleted');
      });

      bus.on('Order.beforeCreate', async () => {
        trace.push('step2-should-not-run');
      });

      const ctx = await bus.emitAsync('Order', 'beforeCreate', { items: [] });
      expect(trace).toEqual(['step1']);
      expect(ctx.isCancelled).toBe(true);
      expect(ctx.cancelReason).toBe('Stock depleted');
    });

    it('emitAsync cancels operation if before hook listener throws', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      bus.on('Order.beforeCreate', () => {
        throw new Error('Database check failed');
      });

      const ctx = await bus.emitAsync('Order', 'beforeCreate', {});
      expect(ctx.isCancelled).toBe(true);
      expect(ctx.cancelReason).toBe('Database check failed');

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Hooks enum & Singleton ModelEvents', () => {
    it('exports all standard lifecycle hooks', () => {
      expect(Hooks.BEFORE_CREATE).toBe('beforeCreate');
      expect(Hooks.AFTER_CREATE).toBe('afterCreate');
      expect(Hooks.BEFORE_UPDATE).toBe('beforeUpdate');
      expect(Hooks.AFTER_UPDATE).toBe('afterUpdate');
      expect(Hooks.BEFORE_DELETE).toBe('beforeDelete');
      expect(Hooks.AFTER_DELETE).toBe('afterDelete');
      expect(Hooks.BEFORE_RESTORE).toBe('beforeRestore');
      expect(Hooks.AFTER_RESTORE).toBe('afterRestore');
      expect(Hooks.BEFORE_FIND).toBe('beforeFind');
      expect(Hooks.AFTER_FIND).toBe('afterFind');
      expect(Hooks.BEFORE_VALIDATION).toBe('beforeValidation');
      expect(Hooks.AFTER_VALIDATION).toBe('afterValidation');
    });

    it('provides default singleton ModelEvents instance', () => {
      expect(ModelEvents).toBeInstanceOf(ModelEventsClass);
    });
  });
});

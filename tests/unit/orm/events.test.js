/**
 * ORM Events/Signals System Unit Tests
 */

const {
  ModelEvents,
  ModelEventsClass,
  createEventContext,
  Hooks,
  HookCancellationError,
} = require('../../../core/orm/events');

describe('ORM Events System', () => {
  beforeEach(() => {
    // Clear all listeners before each test
    ModelEvents.removeAllListeners();
  });

  describe('ModelEvents', () => {
    describe('on()', () => {
      it('should register a listener', () => {
        const callback = vi.fn();
        ModelEvents.on('User.beforeCreate', callback);

        expect(ModelEvents.listenerCount('User.beforeCreate')).toBe(1);
      });

      it('should return unsubscribe function', () => {
        const callback = vi.fn();
        const unsubscribe = ModelEvents.on('User.beforeCreate', callback);

        expect(typeof unsubscribe).toBe('function');
        unsubscribe();
        expect(ModelEvents.listenerCount('User.beforeCreate')).toBe(0);
      });

      it('should throw if callback is not a function', () => {
        expect(() => ModelEvents.on('User.beforeCreate', 'not a function')).toThrow(
          'Callback must be a function'
        );
      });

      it('should allow multiple listeners for same event', () => {
        const callback1 = vi.fn();
        const callback2 = vi.fn();

        ModelEvents.on('User.beforeCreate', callback1);
        ModelEvents.on('User.beforeCreate', callback2);

        expect(ModelEvents.listenerCount('User.beforeCreate')).toBe(2);
      });
    });

    describe('once()', () => {
      it('should register a one-time listener', async () => {
        const callback = vi.fn();
        ModelEvents.once('User.afterCreate', callback);

        await ModelEvents.emitAsync('User', 'afterCreate', { id: 1 });
        await ModelEvents.emitAsync('User', 'afterCreate', { id: 2 });

        expect(callback).toHaveBeenCalledTimes(1);
      });
    });

    describe('off()', () => {
      it('should remove a specific listener', () => {
        const callback = vi.fn();
        ModelEvents.on('User.beforeCreate', callback);
        ModelEvents.off('User.beforeCreate', callback);

        expect(ModelEvents.listenerCount('User.beforeCreate')).toBe(0);
      });

      it('should return false if listener not found', () => {
        const callback = vi.fn();
        const result = ModelEvents.off('User.beforeCreate', callback);

        expect(result).toBe(false);
      });
    });

    describe('removeAllListeners()', () => {
      it('should remove all listeners for specific event', () => {
        ModelEvents.on('User.beforeCreate', vi.fn());
        ModelEvents.on('User.beforeCreate', vi.fn());
        ModelEvents.on('User.afterCreate', vi.fn());

        ModelEvents.removeAllListeners('User.beforeCreate');

        expect(ModelEvents.listenerCount('User.beforeCreate')).toBe(0);
        expect(ModelEvents.listenerCount('User.afterCreate')).toBe(1);
      });

      it('should remove all listeners when no event specified', () => {
        ModelEvents.on('User.beforeCreate', vi.fn());
        ModelEvents.on('Post.afterUpdate', vi.fn());

        ModelEvents.removeAllListeners();

        expect(ModelEvents.listenerCount()).toBe(0);
      });
    });

    describe('emit()', () => {
      it('should call all listeners with data and context', () => {
        const callback = vi.fn();
        ModelEvents.on('User.afterCreate', callback);

        const data = { id: 1, name: 'Test' };
        ModelEvents.emit('User', 'afterCreate', data);

        expect(callback).toHaveBeenCalledWith(data, expect.any(Object));
      });

      it('should pass context with model and operation', () => {
        let receivedContext;
        ModelEvents.on('User.afterCreate', (data, ctx) => {
          receivedContext = ctx;
        });

        ModelEvents.emit('User', 'afterCreate', { id: 1 });

        expect(receivedContext.model).toBe('User');
        expect(receivedContext.operation).toBe('afterCreate');
      });

      it('should not throw if listener errors', () => {
        ModelEvents.on('User.afterCreate', () => {
          throw new Error('Test error');
        });

        expect(() => {
          ModelEvents.emit('User', 'afterCreate', { id: 1 });
        }).not.toThrow();
      });
    });

    describe('emitAsync()', () => {
      it('should await async listeners', async () => {
        const order = [];
        ModelEvents.on('User.beforeCreate', async () => {
          await new Promise((r) => setTimeout(r, 10));
          order.push(1);
        });
        ModelEvents.on('User.beforeCreate', () => {
          order.push(2);
        });

        await ModelEvents.emitAsync('User', 'beforeCreate', {});

        expect(order).toEqual([1, 2]);
      });

      it('should stop processing if cancelled', async () => {
        const callback1 = vi.fn((data, ctx) => ctx.cancel('Cancelled'));
        const callback2 = vi.fn();

        ModelEvents.on('User.beforeCreate', callback1);
        ModelEvents.on('User.beforeCreate', callback2);

        const ctx = await ModelEvents.emitAsync('User', 'beforeCreate', {});

        expect(callback1).toHaveBeenCalled();
        expect(callback2).not.toHaveBeenCalled();
        expect(ctx.isCancelled).toBe(true);
        expect(ctx.cancelReason).toBe('Cancelled');
      });

      it('should cancel on listener error for before hooks', async () => {
        ModelEvents.on('User.beforeCreate', () => {
          throw new Error('Validation failed');
        });

        const ctx = await ModelEvents.emitAsync('User', 'beforeCreate', {});

        expect(ctx.isCancelled).toBe(true);
        expect(ctx.cancelReason).toBe('Validation failed');
      });
    });

    describe('Wildcard Listeners', () => {
      it('should match *.hook pattern', () => {
        const callback = vi.fn();
        ModelEvents.on('*.beforeCreate', callback);

        ModelEvents.emit('User', 'beforeCreate', { id: 1 });
        ModelEvents.emit('Post', 'beforeCreate', { id: 2 });

        expect(callback).toHaveBeenCalledTimes(2);
      });

      it('should match Model.* pattern', () => {
        const callback = vi.fn();
        ModelEvents.on('User.*', callback);

        ModelEvents.emit('User', 'beforeCreate', { id: 1 });
        ModelEvents.emit('User', 'afterUpdate', { id: 1 });
        ModelEvents.emit('Post', 'beforeCreate', { id: 2 });

        expect(callback).toHaveBeenCalledTimes(2);
      });

      it('should match *.* pattern (all events)', () => {
        const callback = vi.fn();
        ModelEvents.on('*.*', callback);

        ModelEvents.emit('User', 'beforeCreate', { id: 1 });
        ModelEvents.emit('Post', 'afterDelete', { id: 2 });

        expect(callback).toHaveBeenCalledTimes(2);
      });

      it('should call both specific and wildcard listeners', () => {
        const specificCallback = vi.fn();
        const wildcardCallback = vi.fn();

        ModelEvents.on('User.beforeCreate', specificCallback);
        ModelEvents.on('*.beforeCreate', wildcardCallback);

        ModelEvents.emit('User', 'beforeCreate', { id: 1 });

        expect(specificCallback).toHaveBeenCalledTimes(1);
        expect(wildcardCallback).toHaveBeenCalledTimes(1);
      });
    });

    describe('hasListeners()', () => {
      it('should return true if listeners exist', () => {
        ModelEvents.on('User.beforeCreate', vi.fn());

        expect(ModelEvents.hasListeners('User', 'beforeCreate')).toBe(true);
      });

      it('should return true if wildcard listeners match', () => {
        ModelEvents.on('*.beforeCreate', vi.fn());

        expect(ModelEvents.hasListeners('User', 'beforeCreate')).toBe(true);
      });

      it('should return false if no listeners', () => {
        expect(ModelEvents.hasListeners('User', 'beforeCreate')).toBe(false);
      });
    });

    describe('eventNames()', () => {
      it('should return all registered event names', () => {
        ModelEvents.on('User.beforeCreate', vi.fn());
        ModelEvents.on('Post.afterUpdate', vi.fn());

        const names = ModelEvents.eventNames();

        expect(names).toContain('User.beforeCreate');
        expect(names).toContain('Post.afterUpdate');
      });
    });
  });

  describe('createEventContext()', () => {
    it('should create context with model and operation', () => {
      const ctx = createEventContext('User', 'create');

      expect(ctx.model).toBe('User');
      expect(ctx.operation).toBe('create');
      expect(ctx.isCancelled).toBe(false);
      expect(ctx.cancelReason).toBeNull();
    });

    it('should have cancel function', () => {
      const ctx = createEventContext('User', 'create');

      ctx.cancel('Test reason');

      expect(ctx.isCancelled).toBe(true);
      expect(ctx.cancelReason).toBe('Test reason');
    });

    it('should include transaction if provided', () => {
      const mockTrx = { isTransaction: true };
      const ctx = createEventContext('User', 'create', mockTrx);

      expect(ctx.trx).toBe(mockTrx);
    });
  });

  describe('Hooks enum', () => {
    it('should have all expected hooks', () => {
      expect(Hooks.BEFORE_VALIDATION).toBe('beforeValidation');
      expect(Hooks.AFTER_VALIDATION).toBe('afterValidation');
      expect(Hooks.BEFORE_SAVE).toBe('beforeSave');
      expect(Hooks.AFTER_SAVE).toBe('afterSave');
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
    });
  });

  describe('HookCancellationError', () => {
    it('should be an Error', () => {
      const error = new HookCancellationError('Test', 'User', 'beforeCreate');

      expect(error).toBeInstanceOf(Error);
    });

    it('should have name, model, hook, and reason', () => {
      const error = new HookCancellationError('Test reason', 'User', 'beforeCreate');

      expect(error.name).toBe('HookCancellationError');
      expect(error.model).toBe('User');
      expect(error.hook).toBe('beforeCreate');
      expect(error.reason).toBe('Test reason');
      expect(error.message).toBe('Test reason');
    });
  });

  describe('Multiple ModelEventsClass Instances', () => {
    it('should be independent', () => {
      const events1 = new ModelEventsClass();
      const events2 = new ModelEventsClass();

      events1.on('User.beforeCreate', vi.fn());

      expect(events1.listenerCount('User.beforeCreate')).toBe(1);
      expect(events2.listenerCount('User.beforeCreate')).toBe(0);
    });
  });
});

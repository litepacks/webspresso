const { ModelEventsClass } = require('../../core/orm/events');

describe('ModelEvents Memory Leak Detection & Management', () => {
  it('should allow getting and setting maxListeners', () => {
    const events = new ModelEventsClass();
    expect(events.getMaxListeners()).toBe(50);

    events.setMaxListeners(10);
    expect(events.getMaxListeners()).toBe(10);

    expect(() => events.setMaxListeners(-1)).toThrow(TypeError);
  });

  it('should emit a warning when listener count exceeds maxListeners', () => {
    const events = new ModelEventsClass();
    events.setMaxListeners(3);

    const warnings = [];
    const origEmitWarning = process.emitWarning;
    process.emitWarning = (msg, type) => {
      warnings.push({ msg, type });
    };

    try {
      events.on('User.beforeCreate', () => {});
      events.on('User.beforeCreate', () => {});
      events.on('User.beforeCreate', () => {});
      expect(warnings.length).toBe(0);

      // 4th listener exceeds limit of 3
      events.on('User.beforeCreate', () => {});
      expect(warnings.length).toBe(1);
      expect(warnings[0].type).toBe('MaxListenersExceededWarning');
      expect(warnings[0].msg).toContain("Possible ModelEvents memory leak detected. 4 'User.beforeCreate' listeners added");
    } finally {
      process.emitWarning = origEmitWarning;
    }
  });

  it('should automatically cleanup scoped listeners when lifecycle target finishes or closes', () => {
    const events = new ModelEventsClass();

    const mockRes = {
      handlers: {},
      once(event, fn) {
        this.handlers[event] = fn;
      },
      emitFinish() {
        if (this.handlers['finish']) this.handlers['finish']();
      },
    };

    events.listenScoped('Post.afterCreate', () => {}, mockRes);
    expect(events.listenerCount('Post.afterCreate')).toBe(1);

    mockRes.emitFinish();
    expect(events.listenerCount('Post.afterCreate')).toBe(0);
  });

  it('should delete empty event sets from listeners Map on off()', () => {
    const events = new ModelEventsClass();
    const fn = () => {};

    events.on('Order.beforeSave', fn);
    expect(events.listeners.has('Order.beforeSave')).toBe(true);

    events.off('Order.beforeSave', fn);
    expect(events.listeners.has('Order.beforeSave')).toBe(false);
  });
});

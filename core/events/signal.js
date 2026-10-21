/**
 * Webspresso Events - Django-Style Signals Subsystem
 * Declarative Signal objects with sender filtering, connect, disconnect, and send methods.
 * @module core/events/signal
 */

/**
 * Signal class representing a named event channel (Django-inspired)
 */
class Signal {
  /**
   * @param {string} name - Signal identifier name (e.g. 'order_placed', 'user_registered')
   * @param {import('./dispatcher').EventDispatcher} dispatcher
   */
  constructor(name, dispatcher) {
    if (!name || typeof name !== 'string') {
      throw new TypeError('Signal name must be a non-empty string');
    }
    this.name = name;
    this.dispatcher = dispatcher;
  }

  /**
   * Connect a receiver/listener to this signal
   * @param {Function} receiver - (data, meta) => any
   * @param {Object} [options]
   * @param {any} [options.sender] - Filter by specific sender (class, object, or string)
   * @param {number} [options.priority=0] - Priority order
   * @param {boolean} [options.once=false] - Fire only once
   * @returns {Function} Disconnect function
   */
  connect(receiver, options = {}) {
    return this.dispatcher.on(this.name, receiver, options);
  }

  /**
   * Disconnect a receiver from this signal
   * @param {Function} receiver
   * @returns {this}
   */
  disconnect(receiver) {
    this.dispatcher.off(this.name, receiver);
    return this;
  }

  /**
   * Send the signal (synchronous / fire-and-forget)
   * @param {any} [data] - Signal payload
   * @param {Object} [options] - Options ({ sender })
   * @returns {boolean} Whether any receivers were invoked
   */
  send(data, options = {}) {
    return this.dispatcher.emit(this.name, data, options);
  }

  /**
   * Send the signal asynchronously in parallel
   * @param {any} [data]
   * @param {Object} [options]
   * @returns {Promise<Array<{ status: 'fulfilled'|'rejected', value?: any, reason?: any }>>}
   */
  async sendAsync(data, options = {}) {
    return this.dispatcher.emitAsync(this.name, data, options);
  }

  /**
   * Send the signal asynchronously in series (one receiver at a time)
   * @param {any} [data]
   * @param {Object} [options]
   * @returns {Promise<any[]>}
   */
  async sendSerial(data, options = {}) {
    return this.dispatcher.emitSerial(this.name, data, options);
  }

  /**
   * Alias for sendAsync
   */
  async dispatch(data, options = {}) {
    return this.sendAsync(data, options);
  }
}

/**
 * Define a named Signal
 * @param {string} name
 * @param {import('./dispatcher').EventDispatcher} [dispatcher]
 * @returns {Signal}
 */
function defineSignal(name, dispatcher) {
  const { defaultDispatcher } = require('./index');
  const targetDispatcher = dispatcher || defaultDispatcher;
  return new Signal(name, targetDispatcher);
}

module.exports = {
  Signal,
  defineSignal,
};

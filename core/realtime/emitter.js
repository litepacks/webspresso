/**
 * Lightweight, zero-dependency Event Emitter
 * @module core/realtime/emitter
 */

class EventEmitter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event
   * 
   * @param {string} event
   * @param {Function} handler
   * @returns {() => void} Unsubscribe function
   */
  on(event, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError(`Event handler for "${event}" must be a function`);
    }
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);

    return () => this.off(event, handler);
  }

  /**
   * Subscribe to an event once
   * 
   * @param {string} event
   * @param {Function} handler
   * @returns {() => void} Unsubscribe function
   */
  once(event, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError(`Event handler for "${event}" must be a function`);
    }
    const wrapper = (...args) => {
      this.off(event, wrapper);
      handler(...args);
    };
    return this.on(event, wrapper);
  }

  /**
   * Unsubscribe from an event
   * 
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    const set = this._listeners.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        this._listeners.delete(event);
      }
    }
  }

  /**
   * Emit an event to all subscribers
   * 
   * @param {string} event
   * @param  {...any} args
   */
  emit(event, ...args) {
    const set = this._listeners.get(event);
    if (!set || set.size === 0) return;

    // Iterate over shallow copy to allow listeners to modify set during execution
    const handlers = Array.from(set);
    for (const handler of handlers) {
      try {
        handler(...args);
      } catch (err) {
        if (event !== 'error' && this._listeners.has('error')) {
          this.emit('error', err);
        } else {
          console.error(`[realtime] Error in event listener for "${event}":`, err);
        }
      }
    }
  }

  /**
   * Clear all registered listeners
   */
  clear() {
    this._listeners.clear();
  }
}

module.exports = { EventEmitter };

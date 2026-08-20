/**
 * Webspresso ORM - Events/Signals System
 * Django-style signal system for model lifecycle events
 * @module core/orm/events
 */

/**
 * Event context passed to listeners
 * @typedef {Object} EventContext
 * @property {string} model - Model name
 * @property {string} operation - Operation type (create, update, delete, etc.)
 * @property {Function} cancel - Function to cancel the operation
 * @property {boolean} isCancelled - Whether the operation is cancelled
 * @property {string|null} cancelReason - Reason for cancellation
 * @property {import('knex').Knex.Transaction|null} trx - Transaction if in one
 */

const EMPTY_ARRAY = Object.freeze([]);

function cancelContext(reason = 'Operation cancelled') {
  this.isCancelled = true;
  this.cancelReason = reason;
}

/**
 * Create a cancellation context for before hooks
 * @param {string} model - Model name
 * @param {string} operation - Operation type
 * @param {import('knex').Knex.Transaction|null} [trx=null] - Transaction
 * @returns {EventContext}
 */
function createEventContext(model, operation, trx = null) {
  return {
    model,
    operation,
    trx,
    isCancelled: false,
    cancelReason: null,
    cancel: cancelContext,
  };
}

/**
 * ModelEvents - Global event bus for ORM lifecycle events
 * Singleton class that manages event listeners and emission
 */
class ModelEventsClass {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
  }

  /**
   * Register an event listener
   * @param {string} event - Event name (e.g., 'User.beforeCreate', '*.afterSave')
   * @param {Function} callback - Callback function (data, context) => void | Promise<void>
   * @returns {Function} Unsubscribe function
   */
  on(event, callback) {
    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }

    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);

    // Return unsubscribe function
    return () => this.off(event, callback);
  }

  /**
   * Register a one-time event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  once(event, callback) {
    const wrapper = async (data, context) => {
      this.off(event, wrapper);
      return callback(data, context);
    };
    return this.on(event, wrapper);
  }

  /**
   * Remove an event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function to remove
   * @returns {boolean} Whether the listener was removed
   */
  off(event, callback) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      return listeners.delete(callback);
    }
    return false;
  }

  /**
   * Remove all listeners for an event or all events
   * @param {string} [event] - Event name (optional, removes all if not provided)
   */
  removeAllListeners(event) {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get all listeners matching an event (including wildcards)
   * @param {string} model - Model name
   * @param {string} hook - Hook name (e.g., 'beforeCreate')
   * @returns {Function[]} Array of matching listeners
   */
  getMatchingListeners(model, hook) {
    if (this.listeners.size === 0) {
      return EMPTY_ARRAY;
    }

    const listeners = [];
    const specificEvent = `${model}.${hook}`;
    const wildcardModel = `*.${hook}`;
    const wildcardHook = `${model}.*`;
    const wildcardAll = '*.*';

    // Check specific event
    const sList = this.listeners.get(specificEvent);
    if (sList) {
      listeners.push(...sList);
    }

    // Check wildcard model (*.beforeCreate)
    const wmList = this.listeners.get(wildcardModel);
    if (wmList) {
      listeners.push(...wmList);
    }

    // Check wildcard hook (User.*)
    const whList = this.listeners.get(wildcardHook);
    if (whList) {
      listeners.push(...whList);
    }

    // Check full wildcard (*.*)
    const waList = this.listeners.get(wildcardAll);
    if (waList) {
      listeners.push(...waList);
    }

    return listeners.length > 0 ? listeners : EMPTY_ARRAY;
  }

  /**
   * Fast boolean check whether any listener matches
   * @param {string} model - Model name
   * @param {string} hook - Hook name
   * @returns {boolean}
   */
  hasListeners(model, hook) {
    if (this.listeners.size === 0) return false;
    const l = this.listeners;
    return (
      l.has(`${model}.${hook}`) ||
      l.has(`*.${hook}`) ||
      l.has(`${model}.*`) ||
      l.has('*.*')
    );
  }

  /**
   * Emit an event synchronously (for after hooks)
   * @param {string} model - Model name
   * @param {string} hook - Hook name
   * @param {Object} data - Event data
   * @param {EventContext} [context] - Event context
   */
  emit(model, hook, data, context) {
    const listeners = this.getMatchingListeners(model, hook);
    if (listeners.length === 0) return;
    const ctx = context || createEventContext(model, hook);

    for (const listener of listeners) {
      try {
        listener(data, ctx);
      } catch (error) {
        console.error(`Error in ${model}.${hook} listener:`, error);
      }
    }

    return ctx;
  }

  /**
   * Emit an event asynchronously (for before hooks that may cancel)
   * @param {string} model - Model name
   * @param {string} hook - Hook name
   * @param {Object} data - Event data
   * @param {EventContext} [context] - Event context
   * @returns {Promise<EventContext>}
   */
  async emitAsync(model, hook, data, context) {
    const listeners = this.getMatchingListeners(model, hook);
    const ctx = context || createEventContext(model, hook);
    if (listeners.length === 0) return ctx;

    for (const listener of listeners) {
      if (ctx.isCancelled) break;

      try {
        const result = listener(data, ctx);
        if (result instanceof Promise) {
          await result;
        }
      } catch (error) {
        console.error(`Error in ${model}.${hook} listener:`, error);
        // If a before hook throws, treat it as cancellation
        if (hook.startsWith('before')) {
          ctx.cancel(error.message || 'Listener threw an error');
        }
      }
    }

    return ctx;
  }

  /**
   * Check if there are any listeners for an event
   * @param {string} model - Model name
   * @param {string} hook - Hook name
   * @returns {boolean}
   */
  hasListeners(model, hook) {
    return this.getMatchingListeners(model, hook).length > 0;
  }

  /**
   * Get listener count for an event
   * @param {string} [event] - Specific event (optional)
   * @returns {number}
   */
  listenerCount(event) {
    if (event) {
      const listeners = this.listeners.get(event);
      return listeners ? listeners.size : 0;
    }
    let count = 0;
    for (const listeners of this.listeners.values()) {
      count += listeners.size;
    }
    return count;
  }

  /**
   * Get all registered event names
   * @returns {string[]}
   */
  eventNames() {
    return Array.from(this.listeners.keys());
  }
}

// Singleton instance
const ModelEvents = new ModelEventsClass();

/**
 * Hook names enum
 */
const Hooks = {
  BEFORE_VALIDATION: 'beforeValidation',
  AFTER_VALIDATION: 'afterValidation',
  BEFORE_SAVE: 'beforeSave',
  AFTER_SAVE: 'afterSave',
  BEFORE_CREATE: 'beforeCreate',
  AFTER_CREATE: 'afterCreate',
  BEFORE_UPDATE: 'beforeUpdate',
  AFTER_UPDATE: 'afterUpdate',
  BEFORE_DELETE: 'beforeDelete',
  AFTER_DELETE: 'afterDelete',
  BEFORE_RESTORE: 'beforeRestore',
  AFTER_RESTORE: 'afterRestore',
  BEFORE_FIND: 'beforeFind',
  AFTER_FIND: 'afterFind',
};

/**
 * Cancellation error for when a hook cancels an operation
 */
class HookCancellationError extends Error {
  constructor(reason, model, hook) {
    super(reason);
    this.name = 'HookCancellationError';
    this.model = model;
    this.hook = hook;
    this.reason = reason;
  }
}

module.exports = {
  ModelEvents,
  ModelEventsClass,
  createEventContext,
  Hooks,
  HookCancellationError,
};

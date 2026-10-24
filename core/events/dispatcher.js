/**
 * Webspresso Events - Decoupled Event & Signals Dispatcher (AdonisJS Events & Django Signals-inspired)
 * Zero-dependency event dispatcher supporting sync, async parallel, serial, waterfall,
 * wildcard pattern matching, Django-style sender filtering, and background queue bridging.
 * @module core/events/dispatcher
 */

const EventEmitter = require('events');
const { globToRegExp } = require('../utils/regex');

/**
 * Convert a glob/wildcard pattern (e.g. 'order.*', 'order.**', '*') into a RegExp
 * @param {string} pattern
 * @returns {RegExp}
 */
const patternRegexCache = new Map();

function patternToRegExp(pattern) {
  if (pattern === '*' || pattern === '**') {
    return /^.*$/;
  }
  const cached = patternRegexCache.get(pattern);
  if (cached !== undefined) return cached;

  const reg = globToRegExp(pattern, { separator: '.' });
  if (patternRegexCache.size < 500) {
    patternRegexCache.set(pattern, reg);
  }
  return reg;
}

/**
 * Match sender against filter
 * @param {any} expectedSender
 * @param {any} actualSender
 * @returns {boolean}
 */
function matchesSender(expectedSender, actualSender) {
  if (expectedSender === undefined || expectedSender === null) {
    return true; // No sender filter applied
  }
  if (actualSender === undefined || actualSender === null) {
    return false; // Filter requested but no sender provided
  }
  if (expectedSender === actualSender) {
    return true;
  }
  // If sender is string or object with name (e.g. Model class or name)
  const expName = typeof expectedSender === 'function' ? expectedSender.name : (expectedSender.name || String(expectedSender));
  const actName = typeof actualSender === 'function' ? actualSender.name : (actualSender.name || String(actualSender));
  return expName.toLowerCase() === actName.toLowerCase();
}

/**
 * EventDispatcher - Enterprise Event & Signal Dispatcher
 */
class EventDispatcher extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {any} [options.queue] - Optional Webspresso QueueManager instance for bridging
   * @param {number} [options.maxListeners=50]
   * @param {any} [options.logger=console]
   */
  constructor(options = {}) {
    super();
    this.maxListeners = options.maxListeners || 50;
    this.setMaxListeners(this.maxListeners);

    this.queue = options.queue || null;
    this.logger = options.logger || console;

    /** @type {Map<string, Array<{ id: number, handler: Function, once: boolean, sender?: any, priority: number }>>} */
    this.exactListeners = new Map();

    /** @type {Array<{ id: number, pattern: string, regex: RegExp, handler: Function, once: boolean, sender?: any, priority: number }>} */
    this.wildcardListeners = [];

    /** @type {Array<{ id: number, handler: Function, once: boolean, priority: number }>} */
    this.anyListeners = [];

    this._idCounter = 0;
  }

  /**
   * Register an event listener
   * @param {string} event - Event name or wildcard pattern (e.g. 'order.created', 'order.*')
   * @param {Function} handler - Listener function (data, meta) => any
   * @param {Object} [options]
   * @param {any} [options.sender] - Django-style sender filter
   * @param {number} [options.priority=0] - Execution priority (higher runs first)
   * @param {boolean} [options.once=false] - Whether to fire only once
   * @returns {Function} Unsubscribe function
   */
  on(event, handler, options = {}) {
    if (typeof event !== 'string' || !event) {
      throw new TypeError('Event name must be a non-empty string');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('Handler must be a function');
    }

    const id = ++this._idCounter;
    const priority = typeof options.priority === 'number' ? options.priority : 0;
    const once = Boolean(options.once);
    const sender = options.sender ?? null;

    const listenerRecord = { id, handler, once, sender, priority };

    if (event.includes('*') || event.includes('?')) {
      this.wildcardListeners.push({
        ...listenerRecord,
        pattern: event,
        regex: patternToRegExp(event),
      });
    } else {
      if (!this.exactListeners.has(event)) {
        this.exactListeners.set(event, []);
      }
      this.exactListeners.get(event).push(listenerRecord);
    }

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  /**
   * Register a one-time event listener
   * @param {string} event
   * @param {Function} handler
   * @param {Object} [options]
   * @returns {Function} Unsubscribe function
   */
  once(event, handler, options = {}) {
    return this.on(event, handler, { ...options, once: true });
  }

  /**
   * Remove an event listener
   * @param {string} event
   * @param {Function} handler
   * @returns {this}
   */
  off(event, handler) {
    if (typeof event !== 'string' || typeof handler !== 'function') {
      return this;
    }

    if (event.includes('*') || event.includes('?')) {
      this.wildcardListeners = this.wildcardListeners.filter(
        (l) => !(l.pattern === event && l.handler === handler)
      );
    } else if (this.exactListeners.has(event)) {
      const list = this.exactListeners.get(event).filter((l) => l.handler !== handler);
      if (list.length === 0) {
        this.exactListeners.delete(event);
      } else {
        this.exactListeners.set(event, list);
      }
    }

    return this;
  }

  /**
   * Catch-all listener for every event
   * @param {Function} handler - (eventName, data, meta) => any
   * @param {Object} [options]
   * @returns {Function} Unsubscribe function
   */
  onAny(handler, options = {}) {
    if (typeof handler !== 'function') {
      throw new TypeError('Handler must be a function');
    }
    const id = ++this._idCounter;
    const priority = typeof options.priority === 'number' ? options.priority : 0;
    const once = Boolean(options.once);

    const record = { id, handler, once, priority };
    this.anyListeners.push(record);

    return () => {
      this.anyListeners = this.anyListeners.filter((l) => l.id !== id);
    };
  }

  /**
   * Collect matched listeners sorted by priority
   * @protected
   * @param {string} event
   * @param {any} [sender]
   * @returns {Array<{ handler: Function, isAny: boolean, remove: Function }>}
   */
  _getMatchedListeners(event, sender = null) {
    const matched = [];

    // 1. Exact listeners
    if (this.exactListeners.has(event)) {
      const list = this.exactListeners.get(event);
      let hasOnce = false;
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (matchesSender(item.sender, sender)) {
          matched.push({
            priority: item.priority,
            handler: item.handler,
            isAny: false,
            remove: () => {
              const current = this.exactListeners.get(event) || [];
              this.exactListeners.set(event, current.filter((l) => l.id !== item.id));
            },
            once: item.once,
          });
        }
        if (item.once) {
          hasOnce = true;
        }
      }
      if (hasOnce) {
        this.exactListeners.set(event, list.filter((l) => !l.once));
      }
    }

    // 2. Wildcard listeners
    if (this.wildcardListeners.length > 0) {
      let hasOnce = false;
      for (let i = 0; i < this.wildcardListeners.length; i++) {
        const item = this.wildcardListeners[i];
        if (item.regex.test(event) && matchesSender(item.sender, sender)) {
          matched.push({
            priority: item.priority,
            handler: item.handler,
            isAny: false,
            remove: () => {
              this.wildcardListeners = this.wildcardListeners.filter((l) => l.id !== item.id);
            },
            once: item.once,
          });
          if (item.once) {
            hasOnce = true;
          }
        }
      }
      if (hasOnce) {
        this.wildcardListeners = this.wildcardListeners.filter((l) => !l.once);
      }
    }

    // 3. Any listeners
    if (this.anyListeners.length > 0) {
      let hasOnce = false;
      for (let i = 0; i < this.anyListeners.length; i++) {
        const item = this.anyListeners[i];
        matched.push({
          priority: item.priority,
          handler: item.handler,
          isAny: true,
          remove: () => {
            this.anyListeners = this.anyListeners.filter((l) => l.id !== item.id);
          },
          once: item.once,
        });
        if (item.once) {
          hasOnce = true;
        }
      }
      if (hasOnce) {
        this.anyListeners = this.anyListeners.filter((l) => !l.once);
      }
    }

    // Sort by priority descending (higher numbers first)
    if (matched.length > 1) {
      matched.sort((a, b) => b.priority - a.priority);
    }

    return matched;
  }

  /**
   * Parse event argument (supports event class instance)
   * @protected
   */
  _parseEmitArgs(eventOrInstance, data, options) {
    if (eventOrInstance && typeof eventOrInstance === 'object' && eventOrInstance.eventName) {
      return {
        event: eventOrInstance.eventName,
        data: eventOrInstance,
        options: data || {},
      };
    }
    return {
      event: String(eventOrInstance),
      data,
      options: options || {},
    };
  }

  /**
   * Synchronous / fire-and-forget emit
   * @param {string|Object} eventOrInstance - Event name or Event class instance
   * @param {any} [data] - Event payload
   * @param {Object} [options] - Options ({ sender })
   * @returns {boolean} Whether any listeners were invoked
   */
  emit(eventOrInstance, data, options = {}) {
    const parsed = this._parseEmitArgs(eventOrInstance, data, options);
    const { event, data: payload, options: opts } = parsed;
    const sender = opts.sender ?? null;

    const listeners = this._getMatchedListeners(event, sender);
    if (listeners.length === 0) {
      return false;
    }

    const meta = { event, sender, timestamp: Date.now() };

    for (const listener of listeners) {
      try {
        if (listener.isAny) {
          listener.handler(event, payload, meta);
        } else {
          listener.handler(payload, meta);
        }
      } catch (err) {
        // Emit error on dispatcher or log
        if (this.listenerCount('error') > 0) {
          super.emit('error', err);
        } else if (this.logger && typeof this.logger.error === 'function') {
          this.logger.error(`[EventDispatcher] Error in listener for event "${event}":`, err);
        }
      }
    }

    return true;
  }

  /**
   * Asynchronous parallel emit (AdonisJS-style)
   * Invokes all matching listeners concurrently with Promise.allSettled
   * @param {string|Object} eventOrInstance
   * @param {any} [data]
   * @param {Object} [options]
   * @returns {Promise<Array<{ status: 'fulfilled'|'rejected', value?: any, reason?: any }>>}
   */
  async emitAsync(eventOrInstance, data, options = {}) {
    const parsed = this._parseEmitArgs(eventOrInstance, data, options);
    const { event, data: payload, options: opts } = parsed;
    const sender = opts.sender ?? null;

    const listeners = this._getMatchedListeners(event, sender);
    if (listeners.length === 0) {
      return [];
    }

    const meta = { event, sender, timestamp: Date.now() };

    const promises = listeners.map(async (listener) => {
      try {
        if (listener.isAny) {
          return await listener.handler(event, payload, meta);
        }
        return await listener.handler(payload, meta);
      } catch (err) {
        if (this.listenerCount('error') > 0) {
          super.emit('error', err);
        } else if (this.logger && typeof this.logger.error === 'function') {
          this.logger.error(`[EventDispatcher] Error in async listener for event "${event}":`, err);
        }
        throw err;
      }
    });

    return Promise.allSettled(promises);
  }

  /**
   * Alias for emitAsync
   */
  async emitParallel(eventOrInstance, data, options = {}) {
    return this.emitAsync(eventOrInstance, data, options);
  }

  /**
   * Alias for emitAsync
   */
  async dispatch(eventOrInstance, data, options = {}) {
    return this.emitAsync(eventOrInstance, data, options);
  }

  /**
   * Asynchronous sequential emit (one after another in priority order)
   * @param {string|Object} eventOrInstance
   * @param {any} [data]
   * @param {Object} [options]
   * @returns {Promise<any[]>} Array of return values
   */
  async emitSerial(eventOrInstance, data, options = {}) {
    const parsed = this._parseEmitArgs(eventOrInstance, data, options);
    const { event, data: payload, options: opts } = parsed;
    const sender = opts.sender ?? null;

    const listeners = this._getMatchedListeners(event, sender);
    if (listeners.length === 0) {
      return [];
    }

    const meta = { event, sender, timestamp: Date.now() };
    const results = [];

    for (const listener of listeners) {
      try {
        const res = listener.isAny
          ? await listener.handler(event, payload, meta)
          : await listener.handler(payload, meta);
        results.push(res);
      } catch (err) {
        if (this.listenerCount('error') > 0) {
          super.emit('error', err);
        } else if (this.logger && typeof this.logger.error === 'function') {
          this.logger.error(`[EventDispatcher] Error in serial listener for event "${event}":`, err);
        }
        throw err;
      }
    }

    return results;
  }

  /**
   * Waterfall sequential emit: Each listener receives the output of the previous listener
   * @param {string|Object} eventOrInstance
   * @param {any} initialData
   * @param {Object} [options]
   * @returns {Promise<any>} Final transformed data
   */
  async emitWaterfall(eventOrInstance, initialData, options = {}) {
    const parsed = this._parseEmitArgs(eventOrInstance, initialData, options);
    const { event, data: payload, options: opts } = parsed;
    const sender = opts.sender ?? null;

    const listeners = this._getMatchedListeners(event, sender);
    if (listeners.length === 0) {
      return payload;
    }

    const meta = { event, sender, timestamp: Date.now() };
    let currentData = payload;

    for (const listener of listeners) {
      try {
        const res = listener.isAny
          ? await listener.handler(event, currentData, meta)
          : await listener.handler(currentData, meta);

        if (res !== undefined) {
          currentData = res;
        }
      } catch (err) {
        if (this.listenerCount('error') > 0) {
          super.emit('error', err);
        } else if (this.logger && typeof this.logger.error === 'function') {
          this.logger.error(`[EventDispatcher] Error in waterfall listener for event "${event}":`, err);
        }
        throw err;
      }
    }

    return currentData;
  }

  /**
   * Asynchronously wait for a matching event to be emitted
   * @param {string} event - Event name or pattern
   * @param {Object|number|Function} [optionsOrTimeout=5000] - Timeout in ms, predicate, or options
   * @param {number} [optionsOrTimeout.timeout=5000] - Timeout in ms (0 for indefinite)
   * @param {Function} [optionsOrTimeout.filter] - Predicate (data, meta) => boolean
   * @param {AbortSignal} [optionsOrTimeout.signal] - AbortSignal for cancellation
   * @param {any} [optionsOrTimeout.sender] - Filter by sender
   * @returns {Promise<{ data: any, meta: Object }>}
   */
  waitFor(event, optionsOrTimeout = {}) {
    let timeoutMs = 5000;
    let filter = null;
    let signal = null;
    let sender = undefined;

    if (typeof optionsOrTimeout === 'number') {
      timeoutMs = optionsOrTimeout;
    } else if (typeof optionsOrTimeout === 'function') {
      filter = optionsOrTimeout;
    } else if (typeof optionsOrTimeout === 'object' && optionsOrTimeout !== null) {
      if (optionsOrTimeout.timeout !== undefined) timeoutMs = optionsOrTimeout.timeout;
      if (typeof optionsOrTimeout.filter === 'function') filter = optionsOrTimeout.filter;
      if (optionsOrTimeout.signal) signal = optionsOrTimeout.signal;
      if (optionsOrTimeout.sender !== undefined) sender = optionsOrTimeout.sender;
    }

    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        return reject(new Error(`waitFor('${event}') aborted before execution`));
      }

      let timeoutTimer = null;
      let unsubscribe = null;
      let abortHandler = null;

      const cleanup = () => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        if (typeof unsubscribe === 'function') {
          unsubscribe();
          unsubscribe = null;
        }
        if (signal && abortHandler) {
          signal.removeEventListener('abort', abortHandler);
          abortHandler = null;
        }
      };

      if (timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          cleanup();
          reject(new Error(`Timeout of ${timeoutMs}ms exceeded while waiting for event '${event}'`));
        }, timeoutMs);
        if (timeoutTimer && typeof timeoutTimer.unref === 'function') {
          timeoutTimer.unref();
        }
      }

      if (signal) {
        abortHandler = () => {
          cleanup();
          reject(new Error(`waitFor('${event}') was aborted`));
        };
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      const handler = (data, meta) => {
        try {
          if (filter && !filter(data, meta)) {
            return;
          }
          cleanup();
          resolve({ data, meta });
        } catch (err) {
          cleanup();
          reject(err);
        }
      };

      unsubscribe = this.on(event, handler, { sender });
    });
  }

  /**
   * Set or update background queue manager for job dispatching
   * @param {any} queueManager
   * @returns {this}
   */
  setQueue(queueManager) {
    this.queue = queueManager;
    return this;
  }

  /**
   * Bridge an event to a background queue job (Adonis / Laravel style)
   * When event is fired, automatically dispatches to `queue.dispatch(jobName, data, queueOptions)`
   * @param {string} event - Event name
   * @param {string} jobName - Queue job name
   * @param {Object} [queueOptions] - Dispatch options (delay, priority, retries, etc.)
   * @returns {Function} Unsubscribe function
   */
  listenAndQueue(event, jobName, queueOptions = {}) {
    return this.on(event, (data) => {
      if (!this.queue || typeof this.queue.dispatch !== 'function') {
        const err = new Error(
          `[EventDispatcher] Cannot queue job '${jobName}' for event '${event}'. No QueueManager is attached.`
        );
        if (this.listenerCount('error') > 0) {
          super.emit('error', err);
        } else if (this.logger && typeof this.logger.error === 'function') {
          this.logger.error(err.message);
        }
        return Promise.reject(err);
      }
      const dispatchPromise = this.queue.dispatch(jobName, data, queueOptions);
      if (dispatchPromise && typeof dispatchPromise.catch === 'function') {
        dispatchPromise.catch((dispatchErr) => {
          if (this.listenerCount('error') > 0) {
            super.emit('error', dispatchErr);
          } else if (this.logger && typeof this.logger.error === 'function') {
            this.logger.error(`[EventDispatcher] Failed to dispatch queued job '${jobName}':`, dispatchErr);
          }
        });
      }
      return dispatchPromise;
    });
  }

  /**
   * Bridge Django-style ORM lifecycle events (ModelEvents) into application dispatcher
   * Emits 'model:created', 'model:updated', 'model:deleted'
   * @param {import('../orm/events').ModelEventsClass} [modelEvents]
   * @returns {Function} Detach function
   */
  bridgeOrm(modelEvents) {
    if (!modelEvents || typeof modelEvents.on !== 'function') {
      return () => {};
    }

    const unsubs = [
      modelEvents.on('*.afterCreate', (record, ctx) => {
        this.emit('model:created', record, { sender: ctx.model, trx: ctx.trx });
        this.emit(`${ctx.model.toLowerCase()}:created`, record, { sender: ctx.model, trx: ctx.trx });
      }),
      modelEvents.on('*.afterUpdate', (record, ctx) => {
        this.emit('model:updated', record, { sender: ctx.model, trx: ctx.trx });
        this.emit(`${ctx.model.toLowerCase()}:updated`, record, { sender: ctx.model, trx: ctx.trx });
      }),
      modelEvents.on('*.afterDelete', (record, ctx) => {
        this.emit('model:deleted', record, { sender: ctx.model, trx: ctx.trx });
        this.emit(`${ctx.model.toLowerCase()}:deleted`, record, { sender: ctx.model, trx: ctx.trx });
      }),
    ];

    return () => {
      for (const unsub of unsubs) {
        if (typeof unsub === 'function') unsub();
      }
    };
  }

  /**
   * Get all registered event names and wildcard patterns
   * @returns {string[]}
   */
  eventNames() {
    const exact = Array.from(this.exactListeners.keys());
    const wildcards = this.wildcardListeners.map((w) => w.pattern);
    return Array.from(new Set([...exact, ...wildcards]));
  }

  /**
   * Get count of listeners for a given event name
   * @param {string} [event]
   * @returns {number}
   */
  listenerCount(event) {
    if (!event) {
      let count = 0;
      for (const list of this.exactListeners.values()) count += list.length;
      count += this.wildcardListeners.length;
      count += this.anyListeners.length;
      return count;
    }

    let count = (this.exactListeners.get(event) || []).length;
    for (const w of this.wildcardListeners) {
      if (w.regex.test(event)) count++;
    }
    count += this.anyListeners.length;
    return count;
  }

  /**
   * Remove all listeners
   * @param {string} [event]
   * @returns {this}
   */
  removeAllListeners(event) {
    if (event) {
      this.exactListeners.delete(event);
      this.wildcardListeners = this.wildcardListeners.filter((w) => w.pattern !== event);
    } else {
      this.exactListeners.clear();
      this.wildcardListeners = [];
      this.anyListeners = [];
    }
    return this;
  }

  /**
   * Reset / clear dispatcher state
   */
  clear() {
    this.removeAllListeners();
  }
}

/**
 * Factory to create a new EventDispatcher
 * @param {Object} [options]
 * @returns {EventDispatcher}
 */
function createEventDispatcher(options = {}) {
  return new EventDispatcher(options);
}

module.exports = {
  EventDispatcher,
  createEventDispatcher,
  patternToRegExp,
  matchesSender,
};

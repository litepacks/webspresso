/**
 * ShutdownManager
 * Framework-independent lifecycle coordinator for graceful shutdown, forced connection termination,
 * application shutdown hooks, and plugin cleanup disposers.
 * @module core/shutdown/shutdown-manager
 */

const { parseDurationMs } = require('../utils/time');

class ShutdownManager {
  /**
   * @param {Object} [options]
   * @param {boolean} [options.enabled=true] - Enable shutdown management
   * @param {'graceful'|'force'} [options.mode='graceful'] - Shutdown mode ('graceful' or 'force')
   * @param {number} [options.timeout=10000] - Graceful timeout in milliseconds before forcing close
   * @param {string[]} [options.signals=['SIGINT', 'SIGTERM']] - Process signals to listen for
   * @param {Object|null} [options.logger=console] - Logger instance (or null to disable logs)
   * @param {boolean} [options.exitOnSignal=true] - Whether to call process.exit when triggered by a process signal
   */
  constructor(options = {}) {
    this.options = {
      enabled: options.enabled !== false,
      mode: options.mode === 'force' ? 'force' : 'graceful',
      timeout: options.timeout !== undefined ? parseDurationMs(options.timeout, 10_000) : 10_000,
      signals: Array.isArray(options.signals) ? options.signals : ['SIGINT', 'SIGTERM'],
      logger: options.logger === null ? null : (options.logger || console),
      exitOnSignal: options.exitOnSignal !== false,
    };

    this.isShuttingDown = false;
    this.isClosed = false;

    /** @type {Array<Function>} */
    this._hooks = [];

    /** @type {Array<{ name: string, fn: Function }>} */
    this._disposers = [];

    /** @type {Array<{ close: () => Promise<void>, forceClose?: () => void, closeIdleConnections?: () => void }>} */
    this._adapters = [];

    /** @type {Promise<void>|null} */
    this._shutdownPromise = null;

    /** @type {Map<string, Function>} */
    this._signalListeners = new Map();
  }

  get mode() {
    return this.options.mode;
  }

  set mode(value) {
    this.options.mode = value === 'force' ? 'force' : 'graceful';
  }

  get timeout() {
    return this.options.timeout;
  }

  set timeout(value) {
    if (value !== undefined && value !== null) {
      this.options.timeout = parseDurationMs(value, this.options.timeout);
    }
  }

  /**
   * Safe logger helper
   * @param {'info'|'warn'|'error'|'debug'} level
   * @param {string} message
   * @param {unknown} [extra]
   */
  _log(level, message, extra) {
    const logger = this.options.logger;
    if (!logger) return;

    const formatted = `[webspresso] ${message}`;
    if (typeof logger[level] === 'function') {
      if (extra !== undefined) {
        logger[level](formatted, extra);
      } else {
        logger[level](formatted);
      }
    } else if (typeof logger.log === 'function') {
      if (extra !== undefined) {
        logger.log(formatted, extra);
      } else {
        logger.log(formatted);
      }
    }
  }

  /**
   * Register an application shutdown hook
   * @param {Function} fn - Sync or async callback
   * @returns {this}
   */
  onShutdown(fn) {
    if (typeof fn === 'function') {
      this._hooks.push(fn);
    }
    return this;
  }

  /**
   * Register a shutdown hook (alias for onShutdown)
   * @param {Function} fn
   * @returns {this}
   */
  register(fn) {
    return this.onShutdown(fn);
  }

  /**
   * Register a plugin disposer / cleanup function
   * @param {string|Function} nameOrFn - Plugin name or disposer function
   * @param {Function} [maybeFn] - Disposer function if name is provided
   * @returns {this}
   */
  registerDisposer(nameOrFn, maybeFn) {
    let name = 'plugin';
    let fn = nameOrFn;

    if (typeof nameOrFn === 'string' && typeof maybeFn === 'function') {
      name = nameOrFn;
      fn = maybeFn;
    }

    if (typeof fn === 'function') {
      this._disposers.push({ name, fn });
    }
    return this;
  }

  /**
   * Register a server adapter (e.g. NodeHttpAdapter)
   * @param {{ close: () => Promise<void>, forceClose?: () => void, closeIdleConnections?: () => void }} adapter
   * @returns {this}
   */
  registerAdapter(adapter) {
    if (adapter && typeof adapter.close === 'function') {
      this._adapters.push(adapter);
    }
    return this;
  }

  /**
   * Attach signal listeners (SIGINT, SIGTERM) to the Node.js process
   * @returns {this}
   */
  enableShutdownHooks() {
    if (!this.options.enabled || typeof process === 'undefined' || typeof process.on !== 'function') {
      return this;
    }

    for (const signal of this.options.signals) {
      if (!this._signalListeners.has(signal)) {
        const listener = async () => {
          this._log('info', `${signal} received`);
          try {
            await this.close(signal);
            if (this.options.exitOnSignal) {
              process.exit(0);
            }
          } catch (err) {
            this._log('error', `Shutdown failed following ${signal}:`, err);
            if (this.options.exitOnSignal) {
              process.exit(1);
            }
          }
        };

        this._signalListeners.set(signal, listener);
        process.on(signal, listener);
      }
    }

    return this;
  }

  /**
   * Detach signal listeners from process
   * @returns {this}
   */
  disableShutdownHooks() {
    if (typeof process === 'undefined' || typeof process.removeListener !== 'function') {
      return this;
    }

    for (const [signal, listener] of this._signalListeners.entries()) {
      process.removeListener(signal, listener);
    }
    this._signalListeners.clear();
    return this;
  }

  /**
   * Execute the shutdown lifecycle pipeline.
   * Idempotent: safe to call multiple times concurrently or sequentially.
   * Note: manual calls to `close()` never call `process.exit()`.
   * @param {string} [reason='manual']
   * @returns {Promise<void>}
   */
  async close(reason = 'manual') {
    if (this.isClosed) {
      return;
    }

    if (this._shutdownPromise) {
      return this._shutdownPromise;
    }

    this._shutdownPromise = (async () => {
      this.isShuttingDown = true;
      const isForce = this.options.mode === 'force';
      const modeLabel = isForce ? 'force' : 'graceful';

      this._log('info', `Starting ${modeLabel} shutdown (reason: ${reason})`);

      const totalTimeout = isForce ? 0 : Math.max(0, this.options.timeout);
      const startTime = Date.now();
      const deadline = totalTimeout > 0 ? startTime + totalTimeout : 0;

      const getRemainingTime = () => {
        if (deadline === 0) return 0;
        return Math.max(0, deadline - Date.now());
      };

      // 1. Run plugin disposers in reverse registration order (terminates SSE streams, WebSockets, devReload clients, and workers)
      if (this._disposers.length > 0) {
        this._log('info', `Disposing ${this._disposers.length} plugins`);
        const reverseDisposers = this._disposers.slice().reverse();
        for (let i = 0; i < reverseDisposers.length; i++) {
          const { name, fn } = reverseDisposers[i];
          const remainingDisposers = reverseDisposers.length - i;
          const remainingMs = getRemainingTime();

          if (isForce || (deadline > 0 && remainingMs <= 0)) {
            try {
              const res = fn();
              if (res && typeof res.then === 'function') {
                await Promise.race([
                  Promise.resolve(res),
                  new Promise(r => {
                    const t = setTimeout(r, 50);
                    if (typeof t.unref === 'function') t.unref();
                  })
                ]);
              }
            } catch (err) {
              this._log('error', `Error in plugin disposer "${name}":`, err);
            }
            continue;
          }

          const perDisposerTimeout = Math.min(
            remainingMs,
            Math.max(100, Math.floor(remainingMs / (remainingDisposers + 1)))
          );

          let timer = null;
          const timeoutPromise = new Promise((resolve) => {
            timer = setTimeout(() => {
              this._log('warn', `Plugin disposer "${name}" timed out after ${perDisposerTimeout}ms`);
              resolve();
            }, perDisposerTimeout);
            if (typeof timer.unref === 'function') timer.unref();
          });

          try {
            await Promise.race([
              Promise.resolve().then(() => fn()),
              timeoutPromise
            ]);
          } catch (err) {
            this._log('error', `Error in plugin disposer "${name}":`, err);
          } finally {
            if (timer) clearTimeout(timer);
          }
        }
      }

      // 2. Close HTTP server adapters (gracefully drain in-flight HTTP requests)
      if (this._adapters.length > 0) {
        this._log('info', 'Closing HTTP server');

        for (const adapter of this._adapters) {
          const remainingMs = getRemainingTime();

          if (isForce || (deadline > 0 && remainingMs <= 0)) {
            // Force mode or deadline expired: immediately forceClose
            try {
              if (typeof adapter.forceClose === 'function') {
                adapter.forceClose();
              }
              const closeRes = adapter.close();
              if (closeRes && typeof closeRes.then === 'function') {
                await Promise.race([
                  Promise.resolve(closeRes),
                  new Promise(r => {
                    const t = setTimeout(r, 25);
                    if (typeof t.unref === 'function') t.unref();
                  })
                ]);
              }
            } catch (err) {
              this._log('error', 'Error force closing adapter:', err);
            }
          } else {
            // Graceful mode: close idle connections, close server, and force close on timeout
            try {
              if (typeof adapter.closeIdleConnections === 'function') {
                adapter.closeIdleConnections();
              }
            } catch (e) {}

            let timer = null;
            const closePromise = adapter.close();

            if (deadline > 0) {
              const adapterTimeout = getRemainingTime();
              const timeoutPromise = new Promise((resolve) => {
                timer = setTimeout(() => {
                  this._log('warn', `Graceful shutdown timed out with ${adapterTimeout}ms remaining budget`);
                  this._log('info', 'Force closing active connections');
                  try {
                    if (typeof adapter.forceClose === 'function') {
                      adapter.forceClose();
                    }
                  } catch (err) {
                    this._log('error', 'Error force closing connections after timeout:', err);
                  }
                  resolve();
                }, adapterTimeout);

                if (typeof timer.unref === 'function') {
                  timer.unref();
                }
              });

              await Promise.race([closePromise, timeoutPromise]);
            } else {
              await closePromise;
            }

            if (timer) {
              clearTimeout(timer);
            }

            // Prevent unhandled rejection without blocking shutdown if timeout won
            closePromise.catch(() => {});
          }
        }
      }

      // 3. Run application shutdown hooks (app.onShutdown)
      if (this._hooks.length > 0) {
        this._log('info', `Running ${this._hooks.length} shutdown hooks`);
        for (let i = 0; i < this._hooks.length; i++) {
          const hook = this._hooks[i];
          const remainingHooks = this._hooks.length - i;
          const remainingMs = getRemainingTime();

          if (isForce || (deadline > 0 && remainingMs <= 0)) {
            try {
              const res = hook();
              if (res && typeof res.then === 'function') {
                await Promise.race([
                  Promise.resolve(res),
                  new Promise(r => {
                    const t = setTimeout(r, 50);
                    if (typeof t.unref === 'function') t.unref();
                  })
                ]);
              }
            } catch (err) {
              this._log('error', 'Error in shutdown hook:', err);
            }
            continue;
          }

          const perHookTimeout = Math.min(
            remainingMs,
            Math.max(100, Math.floor(remainingMs / (remainingHooks + 1)))
          );

          let timer = null;
          const timeoutPromise = new Promise((resolve) => {
            timer = setTimeout(() => {
              this._log('warn', `Shutdown hook timed out after ${perHookTimeout}ms`);
              resolve();
            }, perHookTimeout);
            if (typeof timer.unref === 'function') timer.unref();
          });

          try {
            await Promise.race([
              Promise.resolve().then(() => hook()),
              timeoutPromise
            ]);
          } catch (err) {
            this._log('error', 'Error in shutdown hook:', err);
          } finally {
            if (timer) clearTimeout(timer);
          }
        }
      }

      // 4. Detach signal hooks from process
      this.disableShutdownHooks();

      this.isClosed = true;
      this._log('info', 'Shutdown completed');
    })();

    return this._shutdownPromise;
  }
}

module.exports = {
  ShutdownManager,
};

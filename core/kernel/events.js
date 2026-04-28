/**
 * Application event bus: sync dispatch vs async publish.
 * @module core/kernel/events
 */

/**
 * @typedef {'orm' | 'auth' | 'route' | 'plugin' | 'system'} EventSource
 */

/**
 * @typedef {Object} EventMeta
 * @property {string} [requestId]
 * @property {string} [userId]
 * @property {EventSource} source
 * @property {Date} createdAt
 */

/**
 * @typedef {Object} KernelEventContext
 * @property {any} payload
 * @property {EventMeta} meta
 */

const { randomUUID } = require('crypto');

/**
 * @param {any} payload
 * @param {{ source: EventSource, requestId?: string, userId?: string }} meta
 * @returns {KernelEventContext}
 */
function buildContext(payload, meta) {
  return {
    payload,
    meta: {
      source: meta.source,
      requestId: meta.requestId,
      userId: meta.userId,
      createdAt: new Date(),
    },
  };
}

/**
 * @returns {{ dispatch: Function, publish: Function, on: Function, off: Function, buildContext: typeof buildContext }}
 */
function createEventBus() {
  /** @type {Map<string, Array<(ctx: KernelEventContext) => any>>} */
  const listeners = new Map();

  /**
   * @param {string} eventName
   * @param {(ctx: KernelEventContext) => any} handler
   */
  function on(eventName, handler) {
    if (!listeners.has(eventName)) {
      listeners.set(eventName, []);
    }
    listeners.get(eventName).push(handler);
  }

  /**
   * @param {string} eventName
   * @param {(ctx: KernelEventContext) => any} handler
   */
  function off(eventName, handler) {
    const list = listeners.get(eventName);
    if (!list) return;
    const i = list.indexOf(handler);
    if (i !== -1) list.splice(i, 1);
  }

  /**
   * @param {string} eventName
   * @param {KernelEventContext} ctx
   */
  async function dispatch(eventName, ctx) {
    const list = listeners.get(eventName) || [];
    let last;
    for (const fn of list) {
      last = await fn(ctx);
    }
    return last;
  }

  /**
   * @param {string} eventName
   * @param {KernelEventContext} ctx
   */
  async function publish(eventName, ctx) {
    const list = listeners.get(eventName) || [];
    await Promise.all(list.map((fn) => Promise.resolve(fn(ctx))));
  }

  return { dispatch, publish, on, off, buildContext };
}

module.exports = {
  createEventBus,
  buildContext,
  randomUUID,
};

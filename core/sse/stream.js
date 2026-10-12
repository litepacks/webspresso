/**
 * Server-Sent Events (SSE) Streaming Engine for Webspresso
 * Provides high-performance, zero-dependency HTTP response streaming for real-time events and LLM outputs.
 * @module core/sse/stream
 */

'use strict';

const EventEmitter = require('events');

/**
 * Format an SSE frame according to the W3C / WHATWG Server-Sent Events specification.
 *
 * @param {any} [data] - The data payload (string, object, buffer, etc.)
 * @param {string} [event] - Optional event name
 * @param {string|number} [id] - Optional event ID
 * @param {number} [retry] - Optional client reconnection retry time in ms
 * @returns {string} Formatted SSE frame
 */
function formatSseFrame(data, event, id, retry) {
  let frame = '';

  if (id !== undefined && id !== null) {
    frame += `id: ${String(id).replace(/[\r\n]/g, '')}\n`;
  }

  if (event !== undefined && event !== null && event !== '') {
    frame += `event: ${String(event).replace(/[\r\n]/g, '')}\n`;
  }

  if (retry !== undefined && retry !== null && Number.isFinite(Number(retry))) {
    frame += `retry: ${Math.floor(Number(retry))}\n`;
  }

  if (data !== undefined && data !== null) {
    const text = typeof data === 'object' && !Buffer.isBuffer(data)
      ? JSON.stringify(data)
      : String(data);

    const lines = text.split(/\r\n|\r|\n/);
    for (const line of lines) {
      frame += `data: ${line}\n`;
    }
  }

  frame += '\n';
  return frame;
}

/**
 * Controller for an active Server-Sent Events HTTP connection.
 * @extends EventEmitter
 */
class ServerSentEventsStream extends EventEmitter {
  /**
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @param {Object} [options]
   * @param {number} [options.status=200] - HTTP status code
   * @param {Record<string, string>} [options.headers] - Additional custom HTTP headers
   * @param {number|boolean} [options.heartbeat=15000] - Heartbeat interval in ms (or false/0 to disable)
   * @param {string} [options.heartbeatComment='ping'] - Comment string for heartbeat
   * @param {number} [options.retry] - Initial reconnection retry time in ms sent to client
   */
  constructor(req, res, options = {}) {
    super();

    this.req = req;
    this.res = res;
    this.options = options;

    this.isOpen = true;
    this.isClosed = false;
    this._heartbeatTimer = null;
    this._cleanupBound = this._handleClose.bind(this);

    this._init();
  }

  /**
   * Initialize headers, socket optimizations, and heartbeat.
   * @private
   */
  _init() {
    // 1. Opt out of HTTP compression (zlib buffering breaks streaming)
    if (typeof this.res.compress === 'function') {
      this.res.compress(false);
    }

    // 2. Socket-level optimizations for long-lived real-time streams
    const socket = this.req.socket;
    if (socket) {
      if (typeof socket.setTimeout === 'function') socket.setTimeout(0);
      if (typeof socket.setNoDelay === 'function') socket.setNoDelay(true);
      if (typeof socket.setKeepAlive === 'function') socket.setKeepAlive(true);
    }

    // 3. Write SSE headers if not already sent
    if (!this.res.headersSent) {
      const status = this.options.status || 200;
      const customHeaders = this.options.headers || {};
      const headers = {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...customHeaders,
      };

      if (typeof this.res.writeHead === 'function') {
        this.res.writeHead(status, headers);
      } else {
        for (const [key, value] of Object.entries(headers)) {
          this.res.setHeader(key, value);
        }
        this.res.statusCode = status;
      }
    }

    if (typeof this.res.flushHeaders === 'function') {
      this.res.flushHeaders();
    }

    // 4. Send initial retry configuration if provided
    if (this.options.retry && Number.isFinite(Number(this.options.retry))) {
      this.retry(this.options.retry);
    }

    // 5. Setup periodic heartbeat (defaults to 15s)
    const heartbeatMs = this.options.heartbeat === false || this.options.heartbeat === 0
      ? 0
      : (typeof this.options.heartbeat === 'number' && this.options.heartbeat > 0
          ? this.options.heartbeat
          : 15000);

    if (heartbeatMs > 0) {
      const commentText = this.options.heartbeatComment || 'ping';
      this._heartbeatTimer = setInterval(() => {
        if (!this.isOpen || this.isClosed) {
          this._stopHeartbeat();
          return;
        }
        this.comment(commentText);
      }, heartbeatMs);

      if (typeof this._heartbeatTimer.unref === 'function') {
        this._heartbeatTimer.unref();
      }
    }

    // 6. Listen for connection close from either client or server
    this.req.on('close', this._cleanupBound);
    this.res.on('close', this._cleanupBound);
    this.res.on('finish', this._cleanupBound);
    this.res.on('error', this._cleanupBound);
  }

  /**
   * Stop the heartbeat interval.
   * @private
   */
  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  /**
   * Handle socket/connection termination.
   * @private
   */
  _handleClose() {
    if (this.isClosed) return;
    this.isOpen = false;
    this.isClosed = true;

    this._stopHeartbeat();

    this.req.removeListener('close', this._cleanupBound);
    this.res.removeListener('close', this._cleanupBound);
    this.res.removeListener('finish', this._cleanupBound);
    this.res.removeListener('error', this._cleanupBound);

    this.emit('close');
  }

  /**
   * Flush response buffer if available.
   * @private
   */
  _flush() {
    if (typeof this.res.flush === 'function') {
      try {
        this.res.flush();
      } catch (_) {}
    }
  }

  /**
   * Send an SSE event to the client.
   * Supports both sse.send(data, event, id) and sse.send({ data, event, id, retry }).
   * Handles backpressure if the underlying socket buffer fills.
   *
   * @param {any} payloadOrData - Data payload or event object ({ data, event, id, retry })
   * @param {string} [event] - Event type name
   * @param {string|number} [id] - Event ID
   * @returns {Promise<boolean>} Resolves to true when written, false if stream is closed
   */
  async send(payloadOrData, event, id) {
    if (!this.isOpen || this.isClosed || this.res.destroyed || this.res.writableEnded) {
      return false;
    }

    let data;
    let eventName = event;
    let eventId = id;
    let retryMs;

    if (
      payloadOrData !== null &&
      typeof payloadOrData === 'object' &&
      !Buffer.isBuffer(payloadOrData) &&
      ('data' in payloadOrData || 'event' in payloadOrData || 'id' in payloadOrData || 'retry' in payloadOrData)
    ) {
      data = payloadOrData.data;
      eventName = payloadOrData.event !== undefined ? payloadOrData.event : event;
      eventId = payloadOrData.id !== undefined ? payloadOrData.id : id;
      retryMs = payloadOrData.retry;
    } else {
      data = payloadOrData;
    }

    const frame = formatSseFrame(data, eventName, eventId, retryMs);

    return new Promise((resolve) => {
      try {
        const canContinue = this.res.write(frame);
        this._flush();

        if (!canContinue && !this.res.destroyed && !this.res.writableEnded) {
          this.res.once('drain', () => resolve(true));
        } else {
          resolve(true);
        }
      } catch (err) {
        this._handleClose();
        resolve(false);
      }
    });
  }

  /**
   * Write an SSE comment (useful for keepalive or debugging).
   * Format: `: <text>\n\n`
   *
   * @param {string} text - Comment text
   * @returns {boolean} Whether comment was successfully queued
   */
  comment(text) {
    if (!this.isOpen || this.isClosed || this.res.destroyed || this.res.writableEnded) {
      return false;
    }

    try {
      const sanitized = String(text || '').replace(/[\r\n]/g, ' ');
      this.res.write(`: ${sanitized}\n\n`);
      this._flush();
      return true;
    } catch (_) {
      this._handleClose();
      return false;
    }
  }

  /**
   * Send a heartbeat comment to maintain proxy connections.
   *
   * @param {string} [comment='ping'] - Comment string
   * @returns {boolean}
   */
  heartbeat(comment = 'ping') {
    return this.comment(comment);
  }

  /**
   * Tell the client to change its reconnection retry interval.
   *
   * @param {number} ms - Retry interval in milliseconds
   * @returns {boolean}
   */
  retry(ms) {
    if (!this.isOpen || this.isClosed || this.res.destroyed || this.res.writableEnded) {
      return false;
    }

    try {
      const parsed = Math.floor(Number(ms));
      if (!Number.isFinite(parsed) || parsed < 0) return false;
      this.res.write(`retry: ${parsed}\n\n`);
      this._flush();
      return true;
    } catch (_) {
      this._handleClose();
      return false;
    }
  }

  /**
   * Pipe an async iterable, generator, or readable stream directly into the SSE stream.
   * Supports optional mapping function for transforming chunks.
   *
   * @param {AsyncIterable<any>|Iterable<any>|import('stream').Readable} source
   * @param {Function} [mapFn] - Optional transformer (chunk) => transformedChunk or { data, event, id }
   * @returns {Promise<void>}
   */
  async pipe(source, mapFn) {
    if (!source) return;

    try {
      for await (const rawChunk of source) {
        if (!this.isOpen || this.isClosed) break;

        let chunk = typeof mapFn === 'function' ? mapFn(rawChunk) : rawChunk;
        if (chunk === undefined || chunk === null) continue;

        await this.send(chunk);
      }
    } catch (err) {
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Stream output from an async generator function and automatically close the connection when done.
   *
   * @param {Function} generatorFn - Async generator function (stream) => AsyncGenerator
   * @returns {Promise<void>}
   */
  async stream(generatorFn) {
    if (typeof generatorFn !== 'function') {
      throw new TypeError('sse.stream() expects a function or async generator function');
    }

    try {
      const iterator = generatorFn(this);
      if (iterator && typeof iterator[Symbol.asyncIterator] === 'function') {
        await this.pipe(iterator);
      } else if (iterator && typeof iterator[Symbol.iterator] === 'function') {
        await this.pipe(iterator);
      } else if (iterator && typeof iterator.then === 'function') {
        await iterator;
      }
    } finally {
      this.close();
    }
  }

  /**
   * Close the SSE stream and terminate the HTTP response.
   */
  close() {
    if (this.isClosed) return;
    this.isOpen = false;
    this.isClosed = true;

    this._stopHeartbeat();

    try {
      if (!this.res.writableEnded && !this.res.destroyed) {
        this.res.end();
      }
    } catch (_) {}

    this._handleClose();
  }
}

/**
 * Creates or attaches an SSE stream to an HTTP response.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {any} [sourceOrOptions] - Async iterable, generator function, or options object
 * @param {Object} [maybeOptions] - Options when first argument is a stream or generator
 * @returns {ServerSentEventsStream|Promise<void>}
 */
function createSseStream(req, res, sourceOrOptions, maybeOptions) {
  let source = null;
  let options = {};

  if (sourceOrOptions) {
    if (
      typeof sourceOrOptions[Symbol.asyncIterator] === 'function' ||
      (typeof sourceOrOptions[Symbol.iterator] === 'function' &&
        typeof sourceOrOptions !== 'string' &&
        !Buffer.isBuffer(sourceOrOptions)) ||
      typeof sourceOrOptions.pipe === 'function' ||
      typeof sourceOrOptions === 'function'
    ) {
      source = sourceOrOptions;
      options = maybeOptions || {};
    } else if (typeof sourceOrOptions === 'object') {
      options = sourceOrOptions;
    }
  }

  // Reuse existing SSE stream instance on this response if already initialized
  let sseInstance = res._sseStream;
  if (!sseInstance) {
    sseInstance = new ServerSentEventsStream(req, res, options);
    res._sseStream = sseInstance;
  }

  if (source) {
    if (typeof source === 'function') {
      return sseInstance.stream(source);
    }
    return sseInstance.pipe(source, options.map);
  }

  return sseInstance;
}

module.exports = {
  ServerSentEventsStream,
  createSseStream,
  formatSseFrame,
};

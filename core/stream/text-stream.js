'use strict';

/**
 * High-performance, zero-dependency Text and NDJSON streaming engine for Webspresso
 * Designed for LLM, AI tokens, and real-time chunked HTTP responses
 * @module core/stream/text-stream
 */

const EventEmitter = require('events');

/**
 * Controller for an active chunked text or JSON stream
 * @extends EventEmitter
 */
class TextStreamController extends EventEmitter {
  /**
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @param {Object} [options]
   * @param {number} [options.status=200]
   * @param {string} [options.contentType='text/plain; charset=utf-8']
   * @param {Record<string, string>} [options.headers]
   * @param {boolean} [options.ndjson=false]
   */
  constructor(req, res, options = {}) {
    super();

    this.req = req;
    this.res = res;
    this.options = options;
    this.ndjson = options.ndjson === true;

    this.isOpen = true;
    this.isClosed = false;
    this._cleanupBound = this._handleClose.bind(this);

    this._init();
  }

  /**
   * Initialize socket settings and HTTP response headers
   * @private
   */
  _init() {
    // 1. Opt out of compression (zlib buffers chunks and breaks LLM real-time streaming)
    if (typeof this.res.compress === 'function') {
      this.res.compress(false);
    }

    // 2. Optimize socket for streaming
    const socket = this.req ? this.req.socket : null;
    if (socket) {
      if (typeof socket.setTimeout === 'function') socket.setTimeout(0);
      if (typeof socket.setNoDelay === 'function') socket.setNoDelay(true);
      if (typeof socket.setKeepAlive === 'function') socket.setKeepAlive(true);
    }

    // 3. Write chunked streaming headers
    if (!this.res.headersSent) {
      const status = this.options.status || 200;
      const contentType = this.ndjson
        ? (this.options.contentType || 'application/x-ndjson; charset=utf-8')
        : (this.options.contentType || 'text/plain; charset=utf-8');

      const customHeaders = this.options.headers || {};
      const headers = {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
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

    // 4. Listen for disconnect / termination
    if (this.req) {
      this.req.on('close', this._cleanupBound);
    }
    this.res.on('close', this._cleanupBound);
    this.res.on('finish', this._cleanupBound);
    this.res.on('error', this._cleanupBound);
  }

  /**
   * Internal termination handler
   * @private
   */
  _handleClose() {
    if (this.isClosed) return;
    this.isOpen = false;
    this.isClosed = true;

    if (this.req) {
      this.req.removeListener('close', this._cleanupBound);
    }
    this.res.removeListener('close', this._cleanupBound);
    this.res.removeListener('finish', this._cleanupBound);
    this.res.removeListener('error', this._cleanupBound);

    this.emit('close');
  }

  /**
   * Flush response buffer if supported by platform/adapter
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
   * Write a text chunk or JSON object to the client
   * Handles backpressure if buffer fills
   * @param {string|Buffer|Object} chunk
   * @returns {Promise<boolean>} True when flushed or queued
   */
  async write(chunk) {
    if (!this.isOpen || this.isClosed || this.res.destroyed || this.res.writableEnded) {
      return false;
    }

    let payload;
    if (this.ndjson) {
      if (typeof chunk === 'string') {
        payload = chunk.endsWith('\n') ? chunk : `${chunk}\n`;
      } else {
        payload = `${JSON.stringify(chunk)}\n`;
      }
    } else {
      if (typeof chunk === 'object' && !Buffer.isBuffer(chunk)) {
        payload = JSON.stringify(chunk);
      } else {
        payload = String(chunk);
      }
    }

    return new Promise((resolve) => {
      try {
        const canContinue = this.res.write(payload);
        this._flush();

        if (!canContinue && !this.res.destroyed && !this.res.writableEnded) {
          this.res.once('drain', () => resolve(true));
        } else {
          resolve(true);
        }
      } catch (_) {
        this._handleClose();
        resolve(false);
      }
    });
  }

  /**
   * Pipes an async iterable, generator, or stream into this HTTP response
   * @param {AsyncIterable<any>|Iterable<any>|import('stream').Readable} source
   * @param {Function} [transform] - Optional transformer function
   * @returns {Promise<void>}
   */
  async pipe(source, transform) {
    if (!source) return;

    try {
      for await (const rawChunk of source) {
        if (!this.isOpen || this.isClosed) break;

        const chunk = typeof transform === 'function' ? transform(rawChunk) : rawChunk;
        if (chunk === undefined || chunk === null) continue;

        await this.write(chunk);
      }
    } catch (err) {
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Streams output from a generator or runner callback and closes the response on finish
   * @param {Function} runnerFn
   * @returns {Promise<void>}
   */
  async stream(runnerFn) {
    if (typeof runnerFn !== 'function') {
      throw new TypeError('stream() expects a function or generator');
    }

    try {
      const res = runnerFn(this);
      if (res && typeof res[Symbol.asyncIterator] === 'function') {
        await this.pipe(res);
      } else if (res && typeof res[Symbol.iterator] === 'function') {
        await this.pipe(res);
      } else if (res && typeof res.then === 'function') {
        await res;
      }
    } finally {
      this.close();
    }
  }

  /**
   * Close the stream and terminate the HTTP response
   */
  close() {
    if (this.isClosed) return;
    this.isOpen = false;
    this.isClosed = true;

    try {
      if (!this.res.writableEnded && !this.res.destroyed) {
        this.res.end();
      }
    } catch (_) {}

    this._handleClose();
  }

  /**
   * Alias for close()
   */
  end() {
    this.close();
  }
}

/**
 * Streams plain text (e.g. LLM / AI tokens, markdown) to the HTTP response
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {AsyncIterable<any>|Function|Object} sourceOrCallback
 * @param {Object} [maybeOptions]
 * @returns {TextStreamController|Promise<void>}
 */
function streamText(req, res, sourceOrCallback, maybeOptions = {}) {
  let source = null;
  let options = {};

  if (typeof sourceOrCallback === 'function' || (sourceOrCallback && typeof sourceOrCallback[Symbol.asyncIterator] === 'function') || (sourceOrCallback && typeof sourceOrCallback.pipe === 'function')) {
    source = sourceOrCallback;
    options = maybeOptions || {};
  } else if (sourceOrCallback && typeof sourceOrCallback === 'object') {
    options = sourceOrCallback;
  }

  const controller = new TextStreamController(req, res, { ...options, ndjson: false });

  if (source) {
    if (typeof source === 'function') {
      return controller.stream(source);
    }
    return controller.pipe(source, options.map).finally(() => controller.close());
  }

  return controller;
}

/**
 * Streams newline-delimited JSON (NDJSON) objects to the HTTP response
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {AsyncIterable<any>|Function|Object} sourceOrCallback
 * @param {Object} [maybeOptions]
 * @returns {TextStreamController|Promise<void>}
 */
function streamJson(req, res, sourceOrCallback, maybeOptions = {}) {
  let source = null;
  let options = {};

  if (typeof sourceOrCallback === 'function' || (sourceOrCallback && typeof sourceOrCallback[Symbol.asyncIterator] === 'function') || (sourceOrCallback && typeof sourceOrCallback.pipe === 'function')) {
    source = sourceOrCallback;
    options = maybeOptions || {};
  } else if (sourceOrCallback && typeof sourceOrCallback === 'object') {
    options = sourceOrCallback;
  }

  const controller = new TextStreamController(req, res, { ...options, ndjson: true });

  if (source) {
    if (typeof source === 'function') {
      return controller.stream(source);
    }
    return controller.pipe(source, options.map).finally(() => controller.close());
  }

  return controller;
}

module.exports = {
  TextStreamController,
  streamText,
  streamJson,
};

/**
 * Unit Tests for Server-Sent Events (SSE) Streaming (core/sse)
 */

const express = require('express');
const request = require('supertest');
const {
  ServerSentEventsStream,
  createSseStream,
  formatSseFrame,
} = require('../../../core/sse');
const { createApp } = require('../../../src/server');
const { defineApi } = require('../../../src/api/define-api');

describe('Server-Sent Events (SSE) Engine', () => {
  describe('formatSseFrame', () => {
    it('formats simple string data', () => {
      const frame = formatSseFrame('Hello World');
      expect(frame).toBe('data: Hello World\n\n');
    });

    it('formats multiline string data correctly per SSE specification', () => {
      const frame = formatSseFrame('Line 1\nLine 2\r\nLine 3');
      expect(frame).toBe('data: Line 1\ndata: Line 2\ndata: Line 3\n\n');
    });

    it('formats JSON object data', () => {
      const frame = formatSseFrame({ token: 'abc', count: 42 });
      expect(frame).toBe('data: {"token":"abc","count":42}\n\n');
    });

    it('includes event name and id', () => {
      const frame = formatSseFrame('update', 'statusChange', 101);
      expect(frame).toContain('id: 101\n');
      expect(frame).toContain('event: statusChange\n');
      expect(frame).toContain('data: update\n\n');
    });

    it('includes retry directive when provided', () => {
      const frame = formatSseFrame('payload', 'tick', 'id-1', 3000);
      expect(frame).toContain('retry: 3000\n');
    });

    it('sanitizes CRLF from event names and IDs to prevent header/event injection', () => {
      const frame = formatSseFrame('clean', 'event\nName', 'id\rValue');
      expect(frame).toContain('id: idValue\n');
      expect(frame).toContain('event: eventName\n');
      expect(frame).not.toContain('event: event\n');
    });
  });

  describe('ServerSentEventsStream Controller', () => {
    it('initializes SSE connection with standard headers and opts out of compression', async () => {
      const app = express();
      let compressed = true;

      app.use('/stream', (req, res) => {
        res.compress = (enable) => { compressed = enable; };
        const sse = createSseStream(req, res, { heartbeat: false });

        expect(compressed).toBe(false);
        expect(sse.isOpen).toBe(true);
        expect(sse.isClosed).toBe(false);

        sse.send('first event');
        sse.close();
      });

      const res = await request(app)
        .get('/stream')
        .expect('Content-Type', /text\/event-stream/)
        .expect('Cache-Control', 'no-cache, no-transform')
        .expect('Connection', 'keep-alive')
        .expect('X-Accel-Buffering', 'no')
        .expect(200);

      expect(res.text).toBe('data: first event\n\n');
    });

    it('supports custom status and custom headers', async () => {
      const app = express();
      app.use('/custom', (req, res) => {
        const sse = createSseStream(req, res, {
          status: 201,
          headers: { 'X-Custom-Stream': 'active' },
          heartbeat: false,
        });
        sse.send('custom header test');
        sse.close();
      });

      const res = await request(app)
        .get('/custom')
        .expect(201)
        .expect('X-Custom-Stream', 'active');

      expect(res.text).toContain('data: custom header test\n\n');
    });

    it('sends comments and retry directives', async () => {
      const app = express();
      app.use('/stream', (req, res) => {
        const sse = createSseStream(req, res, { retry: 2500, heartbeat: false });
        sse.comment('diagnostic message');
        sse.heartbeat('keepalive-ping');
        sse.send({ ok: true });
        sse.close();
      });

      const res = await request(app)
        .get('/stream')
        .expect(200);

      expect(res.text).toContain('retry: 2500\n\n');
      expect(res.text).toContain(': diagnostic message\n\n');
      expect(res.text).toContain(': keepalive-ping\n\n');
      expect(res.text).toContain('data: {"ok":true}\n\n');
    });

    it('safely handles writes after close without throwing', () => {
      let closed = false;
      const mockReq = new (require('events').EventEmitter)();
      const mockRes = new (require('events').EventEmitter)();
      mockRes.headersSent = true;
      mockRes.write = vi.fn().mockReturnValue(true);
      mockRes.end = vi.fn().mockImplementation(() => { closed = true; });

      const sse = new ServerSentEventsStream(mockReq, mockRes, { heartbeat: false });
      expect(sse.isOpen).toBe(true);

      sse.close();
      expect(sse.isOpen).toBe(false);
      expect(sse.isClosed).toBe(true);

      expect(sse.comment('should fail')).toBe(false);
      expect(sse.retry(1000)).toBe(false);
      return sse.send('after close').then((success) => {
        expect(success).toBe(false);
      });
    });

    it('emits close and stops heartbeat when client disconnects', async () => {
      vi.useFakeTimers();
      const mockReq = new (require('events').EventEmitter)();
      const mockRes = new (require('events').EventEmitter)();
      mockRes.headersSent = true;
      mockRes.write = vi.fn().mockReturnValue(true);
      mockRes.end = vi.fn();

      const sse = new ServerSentEventsStream(mockReq, mockRes, { heartbeat: 5000 });
      const closeSpy = vi.fn();
      sse.on('close', closeSpy);

      // Heartbeat triggers comment
      vi.advanceTimersByTime(5000);
      expect(mockRes.write).toHaveBeenCalledWith(': ping\n\n');

      // Client drops socket
      mockReq.emit('close');

      expect(sse.isOpen).toBe(false);
      expect(sse.isClosed).toBe(true);
      expect(closeSpy).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it('safely initializes when req is null or undefined', () => {
      const mockRes = new (require('events').EventEmitter)();
      mockRes.headersSent = true;
      mockRes.write = vi.fn().mockReturnValue(true);
      mockRes.end = vi.fn();

      const sse = new ServerSentEventsStream(null, mockRes, { heartbeat: false });
      expect(sse.isOpen).toBe(true);
      expect(sse.req).toBeNull();
      sse.close();
      expect(sse.isOpen).toBe(false);
    });

    it('resolves false and cleans up listeners when connection closes during backpressure', async () => {
      const mockReq = new (require('events').EventEmitter)();
      const mockRes = new (require('events').EventEmitter)();
      mockRes.headersSent = true;
      mockRes.write = vi.fn().mockReturnValue(false);
      mockRes.end = vi.fn();

      const sse = new ServerSentEventsStream(mockReq, mockRes, { heartbeat: false });
      const sendPromise = sse.send({ test: 'backpressure' });

      // Client closes connection before drain occurs
      mockRes.emit('close');

      const result = await sendPromise;
      expect(result).toBe(false);
      expect(mockRes.listenerCount('drain')).toBe(0);
      expect(mockRes.listenerCount('close')).toBe(0);
    });
  });

  describe('Piping & Async Generator Streaming', () => {
    it('pipes an async iterable directly into the stream with mapping', async () => {
      async function* generateTokens() {
        yield 'Hello';
        yield ' ';
        yield 'World';
        yield '!';
      }

      const app = express();
      app.use('/pipe', async (req, res) => {
        const sse = createSseStream(req, res, { heartbeat: false });
        await sse.pipe(generateTokens(), (token) => ({ event: 'token', data: { text: token } }));
        sse.close();
      });

      const res = await request(app)
        .get('/pipe')
        .expect(200);

      expect(res.text).toContain('event: token\ndata: {"text":"Hello"}\n\n');
      expect(res.text).toContain('event: token\ndata: {"text":"World"}\n\n');
    });

    it('streams an async generator and auto-closes via sse.stream()', async () => {
      const app = express();
      app.use('/stream-fn', async (req, res) => {
        const sse = createSseStream(req, res, { heartbeat: false });
        await sse.stream(async function* () {
          yield { step: 1 };
          yield { step: 2 };
        });
      });

      const res = await request(app)
        .get('/stream-fn')
        .expect(200);

      expect(res.text).toBe('data: {"step":1}\n\ndata: {"step":2}\n\n');
    });

    it('streams via 1-liner res.sse(asyncGenerator)', async () => {
      const app = express();
      app.get('/oneliner', async (req, res) => {
        await createSseStream(req, res, async function* () {
          yield 'one';
          yield 'two';
        }, { heartbeat: false });
      });

      const res = await request(app)
        .get('/oneliner')
        .expect(200);

      expect(res.text).toBe('data: one\n\ndata: two\n\n');
    });
  });

  describe('Webspresso createApp & defineApi Integration', () => {
    it('decorates res.sse() on requests in Webspresso server', async () => {
      const { app } = createApp({
        pagesDir: './tests/fixtures/empty-pages',
        viewsDir: './tests/fixtures/views',
      });

      app.get('/api/test-sse', (req, res) => {
        expect(typeof res.sse).toBe('function');
        const sse = res.sse({ heartbeat: false });
        sse.send({ greeting: 'from Webspresso createApp' });
        sse.close();
      });

      const response = await request(app)
        .get('/api/test-sse')
        .expect('Content-Type', /text\/event-stream/)
        .expect(200);

      expect(response.text).toContain('data: {"greeting":"from Webspresso createApp"}\n\n');
    });

    it('exposes sse in defineApi context and streams LLM-style token chunks', async () => {
      const { app } = createApp({
        pagesDir: './tests/fixtures/empty-pages',
        viewsDir: './tests/fixtures/views',
      });

      const endpoint = defineApi({
        handler: async (req, res, { sse }) => {
          expect(typeof sse).toBe('function');
          const stream = sse({ heartbeat: false });

          await stream.send({ delta: 'The ' });
          await stream.send({ delta: 'answer ' });
          await stream.send({ delta: 'is 42.' });
          stream.close();
        },
      });

      // Mount route using defineApi handler
      app.get('/api/ai-chat', (req, res, next) => endpoint.handler(req, res, { ...req.ctx, sse: res.sse }));

      const response = await request(app)
        .get('/api/ai-chat')
        .expect('Content-Type', /text\/event-stream/)
        .expect(200);

      expect(response.text).toBe(
        'data: {"delta":"The "}\n\ndata: {"delta":"answer "}\n\ndata: {"delta":"is 42."}\n\n'
      );
    });

    it('supports object syntax send({ event, data, id, retry })', async () => {
      const { app } = createApp({
        pagesDir: './tests/fixtures/empty-pages',
        viewsDir: './tests/fixtures/views',
      });

      app.get('/api/custom-event-obj', async (req, res) => {
        const sse = res.sse({ heartbeat: false });
        await sse.send({
          event: 'message',
          id: 'chunk-1',
          data: { content: 'AI reasoning token' },
        });
        sse.close();
      });

      const response = await request(app)
        .get('/api/custom-event-obj')
        .expect(200);

      expect(response.text).toBe(
        'id: chunk-1\nevent: message\ndata: {"content":"AI reasoning token"}\n\n'
      );
    });
  });
});

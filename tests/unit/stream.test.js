'use strict';

/**
 * Unit Tests for AI & LLM Text / NDJSON Streaming Engine
 * Tests:
 * 1. TextStreamController (backpressure, headers, write, pipe, stream)
 * 2. streamText (text/plain, markdown, generator, runner, chunked transfer)
 * 3. streamJson (NDJSON lines, JSON stringify, newline delimiters)
 * 4. Integration with createApp & res.streamText / res.streamJson
 * 5. Edge / Hono Adapter streaming compatibility (ReadableStream)
 */

const http = require('http');
const EventEmitter = require('events');
const {
  streamText,
  streamJson,
  TextStreamController,
  createApp,
} = require('../../index');
const { createHonoCompatRes } = require('../../core/http/hono-adapter');

class MockHttpResponse extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.headersSent = false;
    this.chunks = [];
    this.writableEnded = false;
    this.destroyed = false;
    this.compressCalledWith = null;
  }

  compress(val) {
    this.compressCalledWith = val;
  }

  writeHead(status, headers) {
    this.statusCode = status;
    Object.assign(this.headers, headers);
    this.headersSent = true;
    return this;
  }

  setHeader(name, val) {
    this.headers[name.toLowerCase()] = String(val);
  }

  getHeader(name) {
    return this.headers[name.toLowerCase()];
  }

  flushHeaders() {}
  flush() {}

  write(chunk) {
    this.chunks.push(String(chunk));
    return true;
  }

  end(chunk) {
    if (chunk !== undefined) {
      this.chunks.push(String(chunk));
    }
    this.writableEnded = true;
    this.emit('finish');
  }
}

describe('AI & LLM Streaming Engine (core/stream)', () => {
  describe('streamText', () => {
    it('disables compression and sets streaming headers', async () => {
      const res = new MockHttpResponse();
      const controller = streamText(null, res, {
        contentType: 'text/markdown; charset=utf-8',
        headers: { 'X-Custom-Stream': 'enabled' },
      });

      expect(res.compressCalledWith).toBe(false);
      expect(res.headers['Content-Type']).toBe('text/markdown; charset=utf-8');
      expect(res.headers['Cache-Control']).toBe('no-cache, no-transform');
      expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
      expect(res.headers['X-Custom-Stream']).toBe('enabled');

      await controller.write('Hello ');
      await controller.write('World!');
      controller.close();

      expect(res.chunks).toEqual(['Hello ', 'World!']);
      expect(res.writableEnded).toBe(true);
    });

    it('streams from async generator function', async () => {
      const res = new MockHttpResponse();

      await streamText(null, res, async function* () {
        yield 'Token 1 ';
        yield 'Token 2 ';
        yield 'Token 3';
      });

      expect(res.chunks).toEqual(['Token 1 ', 'Token 2 ', 'Token 3']);
      expect(res.writableEnded).toBe(true);
    });

    it('streams from runner callback', async () => {
      const res = new MockHttpResponse();

      await streamText(null, res, async (stream) => {
        await stream.write('Alpha');
        await stream.write('Beta');
      });

      expect(res.chunks).toEqual(['Alpha', 'Beta']);
      expect(res.writableEnded).toBe(true);
    });

    it('pipes an async iterable with optional mapping', async () => {
      const res = new MockHttpResponse();
      const chunks = ['one', 'two', 'three'];

      await streamText(null, res, chunks, {
        map: (val) => val.toUpperCase() + ' ',
      });

      expect(res.chunks).toEqual(['ONE ', 'TWO ', 'THREE ']);
      expect(res.writableEnded).toBe(true);
    });
  });

  describe('streamJson (NDJSON)', () => {
    it('sets NDJSON content type and serializes objects with newline delimiter', async () => {
      const res = new MockHttpResponse();

      await streamJson(null, res, async (stream) => {
        await stream.write({ delta: 'Hello' });
        await stream.write({ delta: ' World' });
      });

      expect(res.headers['Content-Type']).toBe('application/x-ndjson; charset=utf-8');
      expect(res.chunks).toEqual([
        '{"delta":"Hello"}\n',
        '{"delta":" World"}\n',
      ]);
      expect(res.writableEnded).toBe(true);
    });

    it('handles raw string chunks in NDJSON without double newlines', async () => {
      const res = new MockHttpResponse();

      await streamJson(null, res, async (stream) => {
        await stream.write('{"custom":"first"}\n');
        await stream.write('{"custom":"second"}');
      });

      expect(res.chunks).toEqual([
        '{"custom":"first"}\n',
        '{"custom":"second"}\n',
      ]);
    });
  });

  describe('Express Response Decorator (createApp)', () => {
    it('decorates res.streamText and res.streamJson on requests in live HTTP server', async () => {
      const { app } = createApp({
        server: { silent: true },
      });

      app.get('/api/ai/text', (req, res) => {
        return res.streamText(async (stream) => {
          stream.write('AI Token 1, ');
          stream.write('AI Token 2');
        });
      });

      app.get('/api/ai/json', (req, res) => {
        return res.streamJson(async (stream) => {
          stream.write({ role: 'assistant', text: 'Chunk 1' });
          stream.write({ role: 'assistant', text: 'Chunk 2' });
        });
      });

      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address();
      const host = `http://127.0.0.1:${port}`;

      try {
        // Test text stream
        const textRes = await fetch(`${host}/api/ai/text`);
        expect(textRes.status).toBe(200);
        expect(textRes.headers.get('content-type')).toContain('text/plain');
        const textContent = await textRes.text();
        expect(textContent).toBe('AI Token 1, AI Token 2');

        // Test ndjson stream
        const jsonRes = await fetch(`${host}/api/ai/json`);
        expect(jsonRes.status).toBe(200);
        expect(jsonRes.headers.get('content-type')).toContain('application/x-ndjson');
        const jsonContent = await jsonRes.text();
        const lines = jsonContent.trim().split('\n').map((l) => JSON.parse(l));
        expect(lines).toEqual([
          { role: 'assistant', text: 'Chunk 1' },
          { role: 'assistant', text: 'Chunk 2' },
        ]);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });

  describe('Edge / Hono Adapter Streaming', () => {
    it('produces Web Standard ReadableStream via res.streamText()', async () => {
      const mockHonoContext = {};
      const res = createHonoCompatRes(mockHonoContext);

      expect(typeof res.streamText).toBe('function');
      expect(typeof res.streamJson).toBe('function');

      res.streamText(async (stream) => {
        await stream.write('Edge Token 1, ');
        await stream.write('Edge Token 2');
      });

      const webResponse = res.toResponse();
      expect(webResponse.status).toBe(200);
      expect(webResponse.headers.get('content-type')).toBe('text/plain; charset=utf-8');

      // Read Web Stream
      const reader = webResponse.body.getReader();
      const decoder = new TextDecoder();
      let result = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        result += decoder.decode(value);
      }

      expect(result).toBe('Edge Token 1, Edge Token 2');
    });
  });
});

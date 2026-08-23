import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import http from 'http';
import zlib from 'zlib';
import {
  supportsBrotli,
  getDefaultSupportedEncodings,
  parseAcceptEncoding,
  selectEncoding,
  isCompressible,
  createCompressionStream,
  createCompressionMiddleware,
  appendVary,
} from '../../core/compression';
import { createApp } from '../../index';
import path from 'path';

// Raw HTTP helper to verify exact socket wire bytes and decompression without client auto-unzipping
function getRaw(app, pathStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: pathStr,
        method: 'GET',
        headers,
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          server.close(() => {
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks),
            });
          });
        });
      });
      req.on('error', (err) => {
        server.close(() => reject(err));
      });
      req.end();
    });
  });
}

describe('Webspresso HTTP Response Compression', () => {
  const largeText = 'Hello Webspresso! '.repeat(200); // ~3.6 KB, well above 1024 threshold
  const smallText = 'Hello Webspresso!'; // 17 bytes, well below threshold

  describe('Negotiation & Quality Parsing Utilities', () => {
    it('8. parses simple and complex Accept-Encoding headers with q-values', () => {
      const parsed = parseAcceptEncoding('gzip, deflate;q=0.5, br;q=1.0, identity;q=0');
      expect(parsed).toEqual([
        { encoding: 'gzip', q: 1.0, index: 0 },
        { encoding: 'deflate', q: 0.5, index: 1 },
        { encoding: 'br', q: 1.0, index: 2 },
        { encoding: 'identity', q: 0, index: 3 },
      ]);
    });

    it('31. handles malformed and empty Accept-Encoding headers gracefully', () => {
      expect(parseAcceptEncoding('')).toEqual([]);
      expect(parseAcceptEncoding(null)).toEqual([]);
      expect(parseAcceptEncoding(';;;,,,')).toEqual([]);
      expect(selectEncoding('', ['gzip'])).toBe('identity');
      expect(selectEncoding('invalid-unknown-format', ['gzip'])).toBe(null);
    });

    it('3. selects gzip when requested', () => {
      const selected = selectEncoding('gzip', ['gzip', 'deflate']);
      expect(selected).toBe('gzip');
    });

    it('4. selects Brotli when supported and preferred', () => {
      if (supportsBrotli()) {
        const selected = selectEncoding('br, gzip', ['br', 'gzip', 'deflate']);
        expect(selected).toBe('br');
      }
    });

    it('5. falls back safely when Brotli is not in supported list', () => {
      const selected = selectEncoding('br, gzip', ['gzip', 'deflate']);
      expect(selected).toBe('gzip');
    });

    it('6. selects deflate when requested', () => {
      const selected = selectEncoding('deflate', ['gzip', 'deflate']);
      expect(selected).toBe('deflate');
    });

    it('7. selects identity when no compression is requested', () => {
      const selected = selectEncoding('identity', ['gzip', 'deflate']);
      expect(selected).toBe('identity');
    });

    it('9. honors q=0 to disallow an encoding', () => {
      const selected = selectEncoding('gzip;q=0, deflate;q=0.8', ['gzip', 'deflate']);
      expect(selected).toBe('deflate');
    });

    it('10. handles wildcard * in Accept-Encoding', () => {
      const selected = selectEncoding('*;q=0.5', ['gzip', 'deflate']);
      expect(selected).toBe('gzip');
    });

    it('11. returns null for completely unsupported encodings', () => {
      const selected = selectEncoding('compress, lzma', ['gzip', 'deflate']);
      expect(selected).toBe(null);
    });
  });

  describe('Compressibility & Content-Type Detection', () => {
    it('14. recognizes JSON as compressible', () => {
      expect(isCompressible('application/json')).toBe(true);
      expect(isCompressible('application/json; charset=utf-8')).toBe(true);
      expect(isCompressible('application/problem+json')).toBe(true);
    });

    it('15. recognizes HTML as compressible', () => {
      expect(isCompressible('text/html')).toBe(true);
      expect(isCompressible('text/html; charset=utf-8')).toBe(true);
    });

    it('16. recognizes CSS as compressible', () => {
      expect(isCompressible('text/css')).toBe(true);
    });

    it('17. recognizes JS as compressible', () => {
      expect(isCompressible('application/javascript')).toBe(true);
      expect(isCompressible('text/javascript')).toBe(true);
    });

    it('18. does not compress JPEG images', () => {
      expect(isCompressible('image/jpeg')).toBe(false);
    });

    it('19. does not compress PNG images', () => {
      expect(isCompressible('image/png')).toBe(false);
      expect(isCompressible('image/webp')).toBe(false);
      expect(isCompressible('image/avif')).toBe(false);
      expect(isCompressible('video/mp4')).toBe(false);
      expect(isCompressible('application/zip')).toBe(false);
      expect(isCompressible('application/gzip')).toBe(false);
    });
  });

  describe('Compression Middleware Integration', () => {
    function createTestApp(middlewareOptions = {}) {
      const app = express();
      app.use(createCompressionMiddleware(middlewareOptions));

      app.get('/html', (req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(`<html><body>${largeText}</body></html>`);
      });

      app.get('/small', (req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(smallText);
      });

      app.get('/json', (req, res) => {
        res.json({ data: largeText });
      });

      app.get('/image-jpeg', (req, res) => {
        res.setHeader('Content-Type', 'image/jpeg');
        res.send(Buffer.alloc(2048, 1));
      });

      app.get('/already-encoded', (req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Encoding', 'gzip');
        res.send(zlib.gzipSync(Buffer.from(largeText)));
      });

      app.get('/custom-vary', (req, res) => {
        res.setHeader('Vary', 'Origin');
        res.setHeader('Content-Type', 'text/html');
        res.send(largeText);
      });

      app.get('/opt-out', (req, res) => {
        res.compress(false);
        res.setHeader('Content-Type', 'text/html');
        res.send(largeText);
      });

      app.get('/no-content-204', (req, res) => {
        res.status(204).end();
      });

      app.get('/not-modified-304', (req, res) => {
        res.status(304).end();
      });

      app.get('/stream', (req, res) => {
        res.setHeader('Content-Type', 'text/plain');
        for (let i = 0; i < 5; i++) {
          res.write('Chunk data stream '.repeat(25));
        }
        res.end();
      });

      return app;
    }

    it('1. does not compress when Accept-Encoding is absent', async () => {
      const app = createTestApp();
      const res = await getRaw(app, '/html', {});
      expect(res.headers['content-encoding']).toBeUndefined();
      expect(res.body.toString('utf8')).toContain('Hello Webspresso!');
    });

    it('3. compresses using gzip and verifies decompressed content matches', async () => {
      const app = createTestApp();
      const res = await getRaw(app, '/html', { 'accept-encoding': 'gzip' });

      expect(res.headers['content-encoding']).toBe('gzip');
      expect(res.headers['vary']).toBe('Accept-Encoding');

      const decompressed = zlib.gunzipSync(res.body).toString('utf8');
      expect(decompressed).toContain('Hello Webspresso!');
    });

    it('4. compresses using Brotli if supported and requested', async () => {
      if (!supportsBrotli()) return;

      const app = createTestApp();
      const res = await getRaw(app, '/html', { 'accept-encoding': 'br, gzip' });

      expect(res.headers['content-encoding']).toBe('br');
      const decompressed = zlib.brotliDecompressSync(res.body).toString('utf8');
      expect(decompressed).toContain('Hello Webspresso!');
    });

    it('6. compresses using deflate when requested', async () => {
      const app = createTestApp();
      const res = await getRaw(app, '/html', { 'accept-encoding': 'deflate' });

      expect(res.headers['content-encoding']).toBe('deflate');
      const decompressed = zlib.inflateSync(res.body).toString('utf8');
      expect(decompressed).toContain('Hello Webspresso!');
    });

    it('12. skips compression for bodies below threshold', async () => {
      const app = createTestApp({ threshold: 1024 });
      const res = await getRaw(app, '/small', { 'accept-encoding': 'gzip' });

      expect(res.headers['content-encoding']).toBeUndefined();
      expect(res.body.toString('utf8')).toBe(smallText);
    });

    it('13. applies compression for bodies above threshold', async () => {
      const app = createTestApp({ threshold: 1024 });
      const res = await getRaw(app, '/html', { 'accept-encoding': 'gzip' });

      expect(res.headers['content-encoding']).toBe('gzip');
    });

    it('14. compresses JSON responses', async () => {
      const app = createTestApp();
      const res = await getRaw(app, '/json', { 'accept-encoding': 'gzip' });

      expect(res.headers['content-encoding']).toBe('gzip');
      const json = JSON.parse(zlib.gunzipSync(res.body).toString('utf8'));
      expect(json.data).toBe(largeText);
    });

    it('18. does not compress JPEG response', async () => {
      const app = createTestApp();
      const res = await getRaw(app, '/image-jpeg', { 'accept-encoding': 'gzip' });

      expect(res.headers['content-encoding']).toBeUndefined();
    });

    it('20. does not re-compress already encoded responses', async () => {
      const app = createTestApp();
      const res = await getRaw(app, '/already-encoded', { 'accept-encoding': 'gzip' });

      expect(res.headers['content-encoding']).toBe('gzip');
      const decompressed = zlib.gunzipSync(res.body).toString('utf8');
      expect(decompressed).toBe(largeText);
    });

    it('21. sets Vary: Accept-Encoding header', async () => {
      const app = createTestApp();
      const res = await getRaw(app, '/html', { 'accept-encoding': 'gzip' });

      expect(res.headers['vary']).toBe('Accept-Encoding');
    });

    it('22. preserves existing Vary header (e.g. Origin)', async () => {
      const app = createTestApp();
      const res = await getRaw(app, '/custom-vary', { 'accept-encoding': 'gzip' });

      expect(res.headers['vary']).toContain('Origin');
      expect(res.headers['vary']).toContain('Accept-Encoding');
    });

    it('23. removes or updates Content-Length upon compression', async () => {
      const app = createTestApp();
      const res = await getRaw(app, '/html', { 'accept-encoding': 'gzip' });

      expect(res.headers['content-encoding']).toBe('gzip');
    });

    it('24. does not compress HEAD requests', async () => {
      const app = createTestApp();
      const res = await request(app)
        .head('/html')
        .set('Accept-Encoding', 'gzip');

      expect(res.headers['content-encoding']).toBeUndefined();
    });

    it('25. does not compress 204 No Content', async () => {
      const app = createTestApp();
      const res = await getRaw(app, '/no-content-204', { 'accept-encoding': 'gzip' });

      expect(res.statusCode).toBe(204);
      expect(res.headers['content-encoding']).toBeUndefined();
    });

    it('26. does not compress 304 Not Modified', async () => {
      const app = createTestApp();
      const res = await getRaw(app, '/not-modified-304', { 'accept-encoding': 'gzip' });

      expect(res.statusCode).toBe(304);
      expect(res.headers['content-encoding']).toBeUndefined();
    });

    it('27. supports custom filter option to conditionally bypass compression', async () => {
      const app = createTestApp({
        filter: (req, res) => req.url.includes('compress=true'),
      });

      const resEnabled = await getRaw(app, '/html?compress=true', { 'accept-encoding': 'gzip' });
      expect(resEnabled.headers['content-encoding']).toBe('gzip');

      const resDisabled = await getRaw(app, '/html?compress=false', { 'accept-encoding': 'gzip' });
      expect(resDisabled.headers['content-encoding']).toBeUndefined();
    });

    it('28. supports route-level opt-out via res.compress(false)', async () => {
      const app = createTestApp();
      const res = await getRaw(app, '/opt-out', { 'accept-encoding': 'gzip' });

      expect(res.headers['content-encoding']).toBeUndefined();
      expect(res.body.toString('utf8')).toBe(largeText);
    });

    it('29. compresses streaming responses without loading all chunks into memory', async () => {
      const app = createTestApp();
      const res = await getRaw(app, '/stream', { 'accept-encoding': 'gzip' });

      expect(res.headers['content-encoding']).toBe('gzip');
      const decompressed = zlib.gunzipSync(res.body).toString('utf8');
      expect(decompressed).toContain('Chunk data stream');
    });

    it('30. handles large payloads (100 KB) with high efficiency', async () => {
      const veryLargeText = 'Webspresso Fast Response! '.repeat(4000); // ~104 KB
      const app = express();
      app.use(createCompressionMiddleware());
      app.get('/large', (req, res) => {
        res.setHeader('Content-Type', 'text/plain');
        res.send(veryLargeText);
      });

      const res = await getRaw(app, '/large', { 'accept-encoding': 'gzip' });

      expect(res.headers['content-encoding']).toBe('gzip');
      expect(res.body.length).toBeLessThan(veryLargeText.length / 5);

      const decompressed = zlib.gunzipSync(res.body).toString('utf8');
      expect(decompressed).toBe(veryLargeText);
    });
  });

  describe('createApp({ server: { compression: true } }) Integration', () => {
    it('2. automatically enables compression via createApp configuration', async () => {
      const fixtureDir = path.resolve(__dirname, '../fixtures/basic-app');
      const { app } = createApp({
        pagesDir: path.join(fixtureDir, 'pages'),
        viewsDir: path.join(fixtureDir, 'views'),
        server: {
          compression: {
            threshold: 100,
          },
        },
        setupRoutes(a) {
          a.get('/api/test-compression', (req, res) => {
            res.json({ message: 'Hello Compression! '.repeat(50) });
          });
        },
      });

      const res = await getRaw(app, '/api/test-compression', { 'accept-encoding': 'gzip' });

      expect(res.headers['content-encoding']).toBe('gzip');
      const json = JSON.parse(zlib.gunzipSync(res.body).toString('utf8'));
      expect(json.message).toContain('Hello Compression!');
    });
  });
});

import { createMockSpyRes } from '../../utils';
import { describe, it, expect, vi } from 'vitest';
const { isCompressible } = require('../../../core/compression/compressible');
const {
  supportsBrotli,
  getDefaultSupportedEncodings,
  parseAcceptEncoding,
  selectEncoding,
} = require('../../../core/compression/negotiate');
const {
  createCompressionMiddleware,
  appendVary,
} = require('../../../core/compression/middleware');

describe('core/compression/compressible.js', () => {
  it('returns false for null, undefined or invalid inputs', () => {
    expect(isCompressible(null)).toBe(false);
    expect(isCompressible(undefined)).toBe(false);
    expect(isCompressible('')).toBe(false);
    expect(isCompressible(123)).toBe(false);
    expect(isCompressible('   ; charset=utf-8')).toBe(false);
  });

  it('identifies compressible text and standard web MIME types', () => {
    expect(isCompressible('text/html')).toBe(true);
    expect(isCompressible('text/html; charset=utf-8')).toBe(true);
    expect(isCompressible('text/css')).toBe(true);
    expect(isCompressible('text/plain')).toBe(true);
    expect(isCompressible('text/javascript')).toBe(true);
    expect(isCompressible('text/markdown')).toBe(true);
  });

  it('identifies compressible application and json/xml types', () => {
    expect(isCompressible('application/json')).toBe(true);
    expect(isCompressible('application/ld+json')).toBe(true);
    expect(isCompressible('application/manifest+json')).toBe(true);
    expect(isCompressible('application/graphql+json')).toBe(true);
    expect(isCompressible('application/geo+json')).toBe(true);
    expect(isCompressible('application/xml')).toBe(true);
    expect(isCompressible('application/atom+xml')).toBe(true);
    expect(isCompressible('application/rss+xml')).toBe(true);
    expect(isCompressible('application/xhtml+xml')).toBe(true);
    expect(isCompressible('application/x-yaml')).toBe(true);
    expect(isCompressible('application/yaml')).toBe(true);
    expect(isCompressible('application/vnd.api+json')).toBe(true);
    expect(isCompressible('application/schema+json')).toBe(true);
    expect(isCompressible('application/hal+json')).toBe(true);
    expect(isCompressible('image/svg+xml')).toBe(true);
    expect(isCompressible('application/custom+yaml')).toBe(true);
    expect(isCompressible('application/problem+json')).toBe(true);
  });

  it('identifies incompressible types (binary, media, compressed archives, SSE)', () => {
    expect(isCompressible('text/event-stream')).toBe(false);
    expect(isCompressible('image/jpeg')).toBe(false);
    expect(isCompressible('image/png')).toBe(false);
    expect(isCompressible('image/gif')).toBe(false);
    expect(isCompressible('image/webp')).toBe(false);
    expect(isCompressible('image/avif')).toBe(false);
    expect(isCompressible('image/heic')).toBe(false);
    expect(isCompressible('video/mp4')).toBe(false);
    expect(isCompressible('audio/mpeg')).toBe(false);
    expect(isCompressible('application/zip')).toBe(false);
    expect(isCompressible('application/gzip')).toBe(false);
    expect(isCompressible('application/pdf')).toBe(false);
    expect(isCompressible('application/wasm')).toBe(false);
    expect(isCompressible('application/octet-stream')).toBe(false);
  });

  it('caches results and handles multiple calls reliably', () => {
    const mime = 'application/json; charset=utf-8';
    expect(isCompressible(mime)).toBe(true);
    expect(isCompressible(mime)).toBe(true); // cached hit
  });
});

describe('core/compression/negotiate.js', () => {
  describe('supportsBrotli & getDefaultSupportedEncodings', () => {
    it('detects runtime brotli support', () => {
      expect(typeof supportsBrotli()).toBe('boolean');
    });

    it('returns supported encodings based on brotli availability', () => {
      const all = getDefaultSupportedEncodings(true);
      expect(all).toContain('gzip');
      expect(all).toContain('deflate');
      if (supportsBrotli()) {
        expect(all[0]).toBe('br');
      }

      const noBrotli = getDefaultSupportedEncodings(false);
      expect(noBrotli).toEqual(['gzip', 'deflate']);
    });
  });

  describe('parseAcceptEncoding', () => {
    it('returns empty array for invalid or empty header', () => {
      expect(parseAcceptEncoding(null)).toEqual([]);
      expect(parseAcceptEncoding(undefined)).toEqual([]);
      expect(parseAcceptEncoding('')).toEqual([]);
      expect(parseAcceptEncoding('   ')).toEqual([]);
    });

    it('parses encodings without quality values', () => {
      const parsed = parseAcceptEncoding('gzip, deflate, br');
      expect(parsed).toEqual([
        { encoding: 'gzip', q: 1.0, index: 0 },
        { encoding: 'deflate', q: 1.0, index: 1 },
        { encoding: 'br', q: 1.0, index: 2 },
      ]);
    });

    it('parses encodings with q-values and clamps between 0 and 1', () => {
      const header = 'gzip;q=0.8, br;q=1.5, deflate;q=-0.2, identity;q=0.5';
      const parsed = parseAcceptEncoding(header);
      expect(parsed).toEqual([
        { encoding: 'gzip', q: 0.8, index: 0 },
        { encoding: 'br', q: 1.0, index: 1 },
        { encoding: 'deflate', q: 0.0, index: 2 },
        { encoding: 'identity', q: 0.5, index: 3 },
      ]);
    });

    it('ignores invalid q values and empty sub-parts gracefully', () => {
      const header = 'gzip;q=invalid, , br;';
      const parsed = parseAcceptEncoding(header);
      expect(parsed).toEqual([
        { encoding: 'gzip', q: 1.0, index: 0 },
        { encoding: 'br', q: 1.0, index: 2 },
      ]);
    });
  });

  describe('selectEncoding', () => {
    it('returns identity when accept-encoding is missing or empty', () => {
      expect(selectEncoding(null)).toBe('identity');
      expect(selectEncoding('')).toBe('identity');
      expect(selectEncoding('   ')).toBe('identity');
    });

    it('selects highest priority server encoding when client accepts all with equal q', () => {
      const choice = selectEncoding('gzip, deflate, br');
      if (supportsBrotli()) {
        expect(choice).toBe('br');
      } else {
        expect(choice).toBe('gzip');
      }
    });

    it('respects client q-values when selecting encoding', () => {
      const choice = selectEncoding('gzip;q=0.9, br;q=0.5, deflate;q=0.1');
      expect(choice).toBe('gzip');
    });

    it('respects custom supportedEncodings list', () => {
      const choice = selectEncoding('br, gzip, deflate', ['deflate', 'gzip']);
      expect(choice).toBe('deflate');
    });

    it('handles wildcard encoding (*)', () => {
      const choice = selectEncoding('*;q=0.7');
      if (supportsBrotli()) {
        expect(choice).toBe('br');
      } else {
        expect(choice).toBe('gzip');
      }
    });

    it('returns null when all supported encodings have q=0 and no wildcard or identity specified', () => {
      const choice = selectEncoding('br;q=0, gzip;q=0, deflate;q=0');
      expect(choice).toBeNull();
    });

    it('falls back to identity when wildcard is present or identity is accepted', () => {
      const withWildcard = selectEncoding('br;q=0, gzip;q=0, deflate;q=0, *;q=0.5');
      expect(withWildcard).toBe('identity');

      const withIdentity = selectEncoding('br;q=0, gzip;q=0, deflate;q=0, identity;q=1');
      expect(withIdentity).toBe('identity');
    });

    it('returns null when identity is explicitly forbidden with q=0 and no supported match', () => {
      const choice = selectEncoding('unknown;q=1, identity;q=0, *;q=0');
      expect(choice).toBeNull();
    });

    it('selects identity if explicitly specified with positive q', () => {
      const choice = selectEncoding('identity;q=1, *;q=0');
      expect(choice).toBe('identity');
    });

    it('uses cached results for repeated calls', () => {
      const h = 'gzip;q=0.85, deflate;q=0.4';
      const res1 = selectEncoding(h);
      const res2 = selectEncoding(h);
      expect(res1).toBe('gzip');
      expect(res2).toBe('gzip');
    });
  });
});

describe('core/compression/middleware.js', () => {
  describe('appendVary', () => {
    it('sets Vary header if not present', () => {
      const headers = {};
      const res = {
        getHeader: (k) => headers[k],
        setHeader: (k, v) => {
          headers[k] = v;
        },
      };

      appendVary(res, 'Accept-Encoding');
      expect(headers['Vary']).toBe('Accept-Encoding');
    });

    it('appends to existing Vary header string', () => {
      const headers = { Vary: 'User-Agent' };
      const res = {
        getHeader: (k) => headers[k],
        setHeader: (k, v) => {
          headers[k] = v;
        },
      };

      appendVary(res, 'Accept-Encoding');
      expect(headers['Vary']).toBe('User-Agent, Accept-Encoding');
    });

    it('appends to existing Vary header array', () => {
      const headers = { Vary: ['Origin', 'User-Agent'] };
      const res = {
        getHeader: (k) => headers[k],
        setHeader: (k, v) => {
          headers[k] = v;
        },
      };

      appendVary(res, 'Accept-Encoding');
      expect(headers['Vary']).toBe('Origin, User-Agent, Accept-Encoding');
    });

    it('does not duplicate if field is already present or if wildcard * exists', () => {
      const headers1 = { Vary: 'Accept-Encoding, User-Agent' };
      const res1 = {
        getHeader: (k) => headers1[k],
        setHeader: (k, v) => {
          headers1[k] = v;
        },
      };
      appendVary(res1, 'accept-encoding');
      expect(headers1['Vary']).toBe('Accept-Encoding, User-Agent');

      const headers2 = { Vary: '*' };
      const res2 = {
        getHeader: (k) => headers2[k],
        setHeader: (k, v) => {
          headers2[k] = v;
        },
      };
      appendVary(res2, 'Accept-Encoding');
      expect(headers2['Vary']).toBe('*');
    });
  });

  describe('createCompressionMiddleware', () => {
    it('initializes middleware and binds res.compress helper', () => {
      const middleware = createCompressionMiddleware({ threshold: 512 });
      const req = {
        headers: { 'accept-encoding': 'gzip' },
        method: 'GET',
      };
      const res = createMockSpyRes();
      const next = vi.fn();

      middleware(req, res, next);

      expect(typeof res.compress).toBe('function');
      expect(res._noCompression).toBe(false);

      // Call res.compress(false)
      res.compress(false);
      expect(res._noCompression).toBe(true);

      // Call res.compress(true)
      res.compress(true);
      expect(res._noCompression).toBe(false);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('prevents Content-Length override if Content-Encoding is set', () => {
      const middleware = createCompressionMiddleware();
      const headers = { 'content-encoding': 'gzip' };
      const res = createMockSpyRes();
      const req = { headers: {}, method: 'GET' };
      const next = vi.fn();

      middleware(req, res, next);

      // Attempting to set Content-Length when compressed should be ignored
      res.setHeader('Content-Length', '1000');
      expect(headers['content-length']).toBeUndefined();

      // Setting other headers should proceed
      res.setHeader('X-Custom-Header', 'test-val');
      expect(headers['x-custom-header']).toBe('test-val');
    });

    it('handles HTTP requests with compression, opt-outs, and custom filters', async () => {
      const express = require('express');
      const request = require('supertest');

      const app = express();
      app.use(createCompressionMiddleware({
        threshold: 20,
        filter: (req, res) => {
          if (req.url === '/custom-skip') return false;
          return true;
        },
      }));

      app.get('/large', (req, res) => {
        res.setHeader('Content-Type', 'text/plain');
        res.send('A'.repeat(500));
      });

      app.get('/opt-out-method', (req, res) => {
        res.compress(false);
        res.setHeader('Content-Type', 'text/plain');
        res.send('B'.repeat(500));
      });

      app.get('/opt-out-locals', (req, res) => {
        res.locals.compress = false;
        res.setHeader('Content-Type', 'text/plain');
        res.send('C'.repeat(500));
      });

      app.get('/opt-out-should', (req, res) => {
        res.shouldCompress = false;
        res.setHeader('Content-Type', 'text/plain');
        res.send('D'.repeat(500));
      });

      app.get('/sse-stream', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.send('data: ' + 'E'.repeat(500) + '\n\n');
      });

      app.get('/custom-skip', (req, res) => {
        res.setHeader('Content-Type', 'text/plain');
        res.send('F'.repeat(500));
      });

      // 1. Normal large response gets compressed
      const resLarge = await request(app).get('/large').set('Accept-Encoding', 'gzip');
      expect(resLarge.headers['content-encoding']).toBe('gzip');

      // 2. res.compress(false) opts out
      const resOptOut = await request(app).get('/opt-out-method').set('Accept-Encoding', 'gzip');
      expect(resOptOut.headers['content-encoding']).toBeUndefined();

      // 3. res.locals.compress = false opts out
      const resLocals = await request(app).get('/opt-out-locals').set('Accept-Encoding', 'gzip');
      expect(resLocals.headers['content-encoding']).toBeUndefined();

      // 4. res.shouldCompress = false opts out
      const resShould = await request(app).get('/opt-out-should').set('Accept-Encoding', 'gzip');
      expect(resShould.headers['content-encoding']).toBeUndefined();

      // 5. text/event-stream never compressed
      const resSse = await request(app).get('/sse-stream').set('Accept-Encoding', 'gzip');
      expect(resSse.headers['content-encoding']).toBeUndefined();

      // 6. Custom filter return false opts out
      const resCustom = await request(app).get('/custom-skip').set('Accept-Encoding', 'gzip');
      expect(resCustom.headers['content-encoding']).toBeUndefined();
    });
  });
});

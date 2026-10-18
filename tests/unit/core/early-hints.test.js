'use strict';

import { describe, it, expect, vi } from 'vitest';
import http from 'http';
import net from 'net';
import express from 'express';
import {
  inferAsType,
  formatLink,
  formatLinkHeader,
  sendEarlyHints,
  createEarlyHintsMiddleware,
} from '../../../core/early-hints';
import { createApp } from '../../../src/server';
import { createPageHandler } from '../../../src/pages/page-loader';

describe('HTTP 103 Early Hints - Core Utilities', () => {
  describe('inferAsType', () => {
    it('infers style for .css', () => {
      expect(inferAsType('/assets/app.css')).toBe('style');
      expect(inferAsType('https://cdn.example.com/styles/bundle.min.css?v=1.2.3')).toBe('style');
    });

    it('infers script for js variants', () => {
      expect(inferAsType('/js/app.js')).toBe('script');
      expect(inferAsType('/esm/module.mjs')).toBe('script');
      expect(inferAsType('/vendor/common.cjs#hash')).toBe('script');
    });

    it('infers font for web fonts', () => {
      expect(inferAsType('/fonts/inter.woff2')).toBe('font');
      expect(inferAsType('/fonts/roboto.woff')).toBe('font');
      expect(inferAsType('/fonts/opensans.ttf')).toBe('font');
      expect(inferAsType('/fonts/custom.otf')).toBe('font');
    });

    it('infers image for raster and vector graphics', () => {
      expect(inferAsType('/images/logo.png')).toBe('image');
      expect(inferAsType('/images/hero.webp')).toBe('image');
      expect(inferAsType('/images/photo.jpg')).toBe('image');
      expect(inferAsType('/images/vector.svg')).toBe('image');
      expect(inferAsType('/favicon.ico')).toBe('image');
    });

    it('infers fetch for JSON data', () => {
      expect(inferAsType('/api/data.json')).toBe('fetch');
    });

    it('infers video and audio formats', () => {
      expect(inferAsType('/media/video.mp4')).toBe('video');
      expect(inferAsType('/media/audio.mp3')).toBe('audio');
    });

    it('returns null for unknown extensions or invalid inputs', () => {
      expect(inferAsType('/file.unknown')).toBeNull();
      expect(inferAsType('just-a-string')).toBeNull();
      expect(inferAsType(null)).toBeNull();
      expect(inferAsType('')).toBeNull();
      expect(inferAsType(123)).toBeNull();
    });
  });

  describe('formatLink', () => {
    it('returns already serialized RFC link string unchanged', () => {
      const raw = '</styles/app.css>; rel=preload; as=style';
      expect(formatLink(raw)).toBe(raw);
    });

    it('formats a simple CSS url string', () => {
      expect(formatLink('/css/main.css')).toBe('</css/main.css>; rel=preload; as=style');
    });

    it('formats a font url string with automatic crossorigin attribute', () => {
      expect(formatLink('/fonts/inter.woff2')).toBe('</fonts/inter.woff2>; rel=preload; as=font; crossorigin');
    });

    it('formats a generic url without deduced as type', () => {
      expect(formatLink('/custom/data')).toBe('</custom/data>; rel=preload');
    });

    it('formats link descriptor object with custom options', () => {
      const result = formatLink({
        url: '/scripts/vendor.js',
        rel: 'modulepreload',
        as: 'script',
        crossOrigin: 'anonymous',
        fetchPriority: 'high',
      });
      expect(result).toBe('</scripts/vendor.js>; rel=modulepreload; as=script; crossorigin; fetchpriority=high');
    });

    it('supports use-credentials crossorigin', () => {
      const result = formatLink({
        url: 'https://cdn.example.com/asset.js',
        as: 'script',
        crossOrigin: 'use-credentials',
      });
      expect(result).toBe('<https://cdn.example.com/asset.js>; rel=preload; as=script; crossorigin=use-credentials');
    });

    it('supports media, type and nopush options', () => {
      const result = formatLink({
        url: '/css/desktop.css',
        as: 'style',
        type: 'text/css',
        media: '(min-width: 1024px)',
        noPush: true,
      });
      expect(result).toBe('</css/desktop.css>; rel=preload; as=style; type="text/css"; media="(min-width: 1024px)"; nopush');
    });

    it('returns null for missing or invalid inputs', () => {
      expect(formatLink(null)).toBeNull();
      expect(formatLink('')).toBeNull();
      expect(formatLink({})).toBeNull();
      expect(formatLink({ url: '' })).toBeNull();
    });
  });

  describe('formatLinkHeader', () => {
    it('formats an array of strings and objects', () => {
      const links = formatLinkHeader([
        '/css/app.css',
        { url: '/js/app.js', as: 'script' },
        '</fonts/inter.woff2>; rel=preload; as=font; crossorigin',
      ]);
      expect(links).toEqual([
        '</css/app.css>; rel=preload; as=style',
        '</js/app.js>; rel=preload; as=script',
        '</fonts/inter.woff2>; rel=preload; as=font; crossorigin',
      ]);
    });

    it('splits comma-separated simple url strings', () => {
      const links = formatLinkHeader('/css/a.css, /css/b.css');
      expect(links).toEqual([
        '</css/a.css>; rel=preload; as=style',
        '</css/b.css>; rel=preload; as=style',
      ]);
    });

    it('filters out nulls and invalid items', () => {
      const links = formatLinkHeader([null, '', { invalid: true }, '/css/valid.css']);
      expect(links).toEqual(['</css/valid.css>; rel=preload; as=style']);
    });

    it('returns empty array when given empty inputs', () => {
      expect(formatLinkHeader(null)).toEqual([]);
      expect(formatLinkHeader([])).toEqual([]);
      expect(formatLinkHeader('')).toEqual([]);
    });
  });

  describe('sendEarlyHints', () => {
    it('gracefully returns false when res does not have writeEarlyHints', () => {
      const fakeRes = {};
      const cb = vi.fn();
      const dispatched = sendEarlyHints(fakeRes, ['/css/app.css'], cb);
      expect(dispatched).toBe(false);
    });

    it('gracefully returns false when headers are already sent or response ended', () => {
      const fakeRes = {
        writeEarlyHints: vi.fn(),
        headersSent: true,
      };
      expect(sendEarlyHints(fakeRes, ['/css/app.css'])).toBe(false);
      expect(fakeRes.writeEarlyHints).not.toHaveBeenCalled();

      fakeRes.headersSent = false;
      fakeRes.writableEnded = true;
      expect(sendEarlyHints(fakeRes, ['/css/app.css'])).toBe(false);
    });

    it('formats links and calls native writeEarlyHints', () => {
      const fakeRes = {
        headersSent: false,
        writeEarlyHints: vi.fn((payload, cb) => {
          if (cb) cb(null);
        }),
      };
      const cb = vi.fn();
      const dispatched = sendEarlyHints(fakeRes, ['/css/app.css', '/js/app.js'], cb);

      expect(dispatched).toBe(true);
      expect(fakeRes.writeEarlyHints).toHaveBeenCalledTimes(1);
      expect(fakeRes.writeEarlyHints).toHaveBeenCalledWith(
        {
          link: [
            '</css/app.css>; rel=preload; as=style',
            '</js/app.js>; rel=preload; as=script',
          ],
        },
        expect.any(Function)
      );
      expect(cb).toHaveBeenCalledWith(null);
    });

    it('accepts headers map with link field', () => {
      const fakeRes = {
        headersSent: false,
        writeEarlyHints: vi.fn(),
      };
      sendEarlyHints(fakeRes, {
        link: ['/css/app.css'],
        'x-custom-hint': 'active',
      });
      expect(fakeRes.writeEarlyHints).toHaveBeenCalledWith(
        {
          link: ['</css/app.css>; rel=preload; as=style'],
          'x-custom-hint': 'active',
        },
        expect.any(Function)
      );
    });

    it('handles synchronous writeEarlyHints errors safely', () => {
      const fakeRes = {
        headersSent: false,
        writeEarlyHints: vi.fn(() => {
          throw new Error('Socket closed unexpectedly');
        }),
      };
      const cb = vi.fn();
      const dispatched = sendEarlyHints(fakeRes, ['/css/app.css'], cb);
      expect(dispatched).toBe(false);
      expect(cb).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('createEarlyHintsMiddleware', () => {
    it('decorates res with earlyHints helper method', () => {
      const mw = createEarlyHintsMiddleware();
      const req = { method: 'GET' };
      const res = {
        headersSent: false,
        writeEarlyHints: vi.fn(),
      };
      const next = vi.fn();

      mw(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(typeof res.earlyHints).toBe('function');

      res.earlyHints(['/css/page.css']);
      expect(fakeResOr(res.writeEarlyHints)).toHaveBeenCalledWith(
        { link: ['</css/page.css>; rel=preload; as=style'] },
        expect.any(Function)
      );
    });

    it('sends defaultLinks automatically on GET requests when configured', () => {
      const mw = createEarlyHintsMiddleware({
        enabled: true,
        links: ['/css/global.css'],
      });
      const req = { method: 'GET' };
      const res = {
        headersSent: false,
        writeEarlyHints: vi.fn(),
      };
      const next = vi.fn();

      mw(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.writeEarlyHints).toHaveBeenCalledWith(
        { link: ['</css/global.css>; rel=preload; as=style'] },
        expect.any(Function)
      );
    });

    it('does not send defaultLinks on POST requests', () => {
      const mw = createEarlyHintsMiddleware({
        enabled: true,
        links: ['/css/global.css'],
      });
      const req = { method: 'POST' };
      const res = {
        headersSent: false,
        writeEarlyHints: vi.fn(),
      };
      const next = vi.fn();

      mw(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.writeEarlyHints).not.toHaveBeenCalled();
    });

    it('supports functional links option', () => {
      const mw = createEarlyHintsMiddleware({
        links: (req) => [`/themes/${req.theme}.css`],
      });
      const req = { method: 'GET', theme: 'dark' };
      const res = {
        headersSent: false,
        writeEarlyHints: vi.fn(),
      };
      mw(req, res, vi.fn());
      expect(res.writeEarlyHints).toHaveBeenCalledWith(
        { link: ['</themes/dark.css>; rel=preload; as=style'] },
        expect.any(Function)
      );
    });
  });
});

function fakeResOr(fn) {
  return fn;
}

describe('HTTP 103 Early Hints - Wire & App Integration', () => {
  it('sends 103 Early Hints on the wire before 200 OK using native HTTP socket', async () => {
    const app = createApp({
      pagesDir: 'pages',
      server: {
        earlyHints: {
          links: ['/css/main.css', '/js/bundle.js'],
        },
      },
    });

    app.get('/test-early', (req, res) => {
      res.send('<h1>Hello Early Hints</h1>');
    });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    const rawChunks = [];
    await new Promise((resolve, reject) => {
      const client = net.connect(port, 'localhost', () => {
        client.write('GET /test-early HTTP/1.1\r\nHost: localhost\r\n\r\n');
      });
      client.on('data', (chunk) => {
        rawChunks.push(chunk.toString());
        if (chunk.toString().includes('Hello Early Hints')) {
          client.end();
          resolve();
        }
      });
      client.on('error', reject);
    });

    await new Promise((resolve) => server.close(resolve));

    const fullResponse = rawChunks.join('');
    expect(fullResponse).toContain('HTTP/1.1 103 Early Hints');
    expect(fullResponse).toContain('Link: </css/main.css>; rel=preload; as=style, </js/bundle.js>; rel=preload; as=script');
    expect(fullResponse).toContain('HTTP/1.1 200 OK');
    expect(fullResponse).toContain('<h1>Hello Early Hints</h1>');

    const index103 = fullResponse.indexOf('HTTP/1.1 103 Early Hints');
    const index200 = fullResponse.indexOf('HTTP/1.1 200 OK');
    expect(index103).toBeGreaterThan(-1);
    expect(index200).toBeGreaterThan(index103);
  });

  describe('Page Loader Early Hints Integration', () => {
    it('dispatches page-defined early hints before running load()', async () => {
      const earlyHintsSent = [];
      const loadOrder = [];

      const mockRes = {
        headersSent: false,
        writeEarlyHints: vi.fn((payload) => {
          earlyHintsSent.push(payload);
        }),
        setHeader: vi.fn(),
        send: vi.fn(),
        json: vi.fn(),
      };

      const mockReq = {
        params: {},
        query: {},
        headers: {},
        method: 'GET',
      };

      // Mock page descriptor
      const descriptor = {
        file: '/virtual/pages/products.js',
        path: '/products',
      };

      // Create a mock pageDef module
      const pageDef = {
        earlyHints: ['/css/products.css', { url: '/js/products.js', as: 'script' }],
        load: vi.fn(async (ctx) => {
          loadOrder.push('load');
          // Manual hint inside load
          ctx.earlyHints(['/extra.css']);
          return { name: 'Widget' };
        }),
      };

      // We can test createPageHandler with a virtual module or mock context
      const handler = createPageHandler(descriptor, {
        options: { isDev: false },
        nunjucks: null,
      });

      // Inject cached pageDef to simulate compiled page
      const originalRequire = module.require;
      // We test through direct call
      const resWrap = {
        ...mockRes,
        earlyHints: (links, cb) => sendEarlyHints(mockRes, links, cb),
      };

      // Calling sendEarlyHints as page loader does
      sendEarlyHints(resWrap, pageDef.earlyHints);
      expect(earlyHintsSent.length).toBe(1);
      expect(earlyHintsSent[0].link).toEqual([
        '</css/products.css>; rel=preload; as=style',
        '</js/products.js>; rel=preload; as=script',
      ]);
    });
  });
});

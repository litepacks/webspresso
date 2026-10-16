/**
 * Extended Scenarios & Edge Cases for SSR Streaming & Chunked Transfer
 * (core/ssr/stream.js)
 */

const { EventEmitter } = require('events');
const nunjucks = require('nunjucks');
const { createHtmlStream, renderStream } = require('../../../core/ssr/stream');

describe.sequential('SSR Streaming Scenarios & Edge Cases', () => {
  let env;

  beforeAll(() => {
    const templates = {
      'page.njk': '<main><div data-stream-target="feed"></div><div data-stream-target="sidebar"></div></main>',
      'simple.njk': '<h1>Hello {{ name }}</h1>',
      'loading-global.njk': '<div class="skeleton">Loading content...</div>',
      'loading-feed.njk': '<div class="feed-spinner">Loading your feed...</div>',
      'feed-item.njk': '<div class="feed">{{ feed.title }}</div>',
      'layout-outer.njk': '<div class="outer">{% block content %}{{ content | safe }}{% endblock %}</div>',
      'layout-inner.njk': '<div class="inner">{% block content %}{{ content | safe }}{% endblock %}</div>',
    };

    const loader = {
      async: false,
      getSource: (name) => {
        if (templates[name]) {
          return { src: templates[name], path: name, noCache: true };
        }
        return null;
      },
    };

    env = new nunjucks.Environment(loader, { autoescape: true });
  });

  describe('createHtmlStream validation & initialization', () => {
    it('throws error when options.env is missing', () => {
      expect(() => createHtmlStream({})).toThrow('createHtmlStream requires a valid Nunjucks environment');
    });

    it('renders and wraps cascading layouts when no deferred keys are passed', async () => {
      const stream = createHtmlStream({
        env,
        templatePath: 'simple.njk',
        context: { name: 'Cascading' },
        layouts: [
          { layoutRelPath: 'layout-inner.njk' },
          { layoutRelPath: 'layout-outer.njk' },
        ],
      });

      let html = '';
      for await (const chunk of stream) {
        html += chunk.toString();
      }

      expect(html).toContain('<div class="outer">');
      expect(html).toContain('<div class="inner">');
      expect(html).toContain('<h1>Hello Cascading</h1>');
    });
  });

  describe('Slot loading skeletons & template replacement', () => {
    it('populates global loading skeleton in empty stream targets', async () => {
      const stream = createHtmlStream({
        env,
        templatePath: 'page.njk',
        loadingTemplate: 'loading-global.njk',
        defer: {
          feed: Promise.resolve({ title: 'Top Story' }),
        },
      });

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk.toString());
      }

      // Initial shell should have global skeleton injected in the targets
      expect(chunks[0]).toContain('<div class="skeleton">Loading content...</div>');
    });

    it('supports slot-specific loading templates overriding global skeleton', async () => {
      const stream = createHtmlStream({
        env,
        templatePath: 'page.njk',
        loadingTemplate: 'loading-global.njk',
        defer: {
          feed: {
            promise: Promise.resolve({ title: 'Slot News' }),
            loadingTemplate: 'loading-feed.njk',
            template: 'feed-item.njk',
          },
        },
      });

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk.toString());
      }

      // Shell chunk should contain slot-specific skeleton
      expect(chunks[0]).toContain('<div class="feed-spinner">Loading your feed...</div>');
      // Second chunk should contain rendered template
      const full = chunks.join('');
      expect(full).toContain('<div class="feed">Slot News</div>');
    });

    it('wraps shell with cascading layouts when defer is present', async () => {
      const stream = createHtmlStream({
        env,
        templatePath: 'page.njk',
        layouts: [{ layoutRelPath: 'layout-outer.njk' }],
        defer: {
          feed: Promise.resolve('raw-feed-data'),
        },
      });

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk.toString());
      }

      expect(chunks[0]).toContain('<div class="outer">');
      expect(chunks[0]).toContain('<main>');
      const full = chunks.join('');
      expect(full).toContain('raw-feed-data');
    });
  });

  describe('Nonce resolution & stream lifecycle', () => {
    it('resolves nonce from context.cspNonce or context.nonce when optionNonce is omitted', async () => {
      const stream = createHtmlStream({
        env,
        templatePath: 'page.njk',
        context: { cspNonce: 'nonce-from-context-csp' },
        defer: {
          feed: Promise.resolve('data-feed'),
        },
      });

      let full = '';
      for await (const chunk of stream) {
        full += chunk.toString();
      }

      expect(full).toContain('<script nonce="nonce-from-context-csp">');
    });

    it('handles stream destruction before deferred promises resolve', async () => {
      let triggerSlow;
      const slowPromise = new Promise((resolve) => {
        triggerSlow = resolve;
      });

      const stream = createHtmlStream({
        env,
        templatePath: 'page.njk',
        defer: {
          feed: slowPromise,
        },
      });

      // Read initial shell
      const initialChunk = await new Promise((resolve) => {
        stream.once('data', resolve);
      });
      expect(initialChunk.toString()).toContain('<main>');

      // Destroy stream
      stream.destroy();
      expect(stream.destroyed).toBe(true);

      // Resolve slow promise after destroy - must not crash or push to destroyed stream
      triggerSlow({ title: 'Ignored' });
      await new Promise((r) => setTimeout(r, 20));
    });

    it('handles slot rejection after stream is destroyed without unhandled rejection', async () => {
      let rejectSlow;
      const slowPromise = new Promise((_, reject) => {
        rejectSlow = reject;
      });

      const stream = createHtmlStream({
        env,
        templatePath: 'page.njk',
        defer: {
          feed: slowPromise,
        },
      });

      await new Promise((resolve) => {
        stream.once('data', resolve);
      });

      stream.destroy();
      expect(stream.destroyed).toBe(true);

      // Rejection occurs after destruction
      rejectSlow(new Error('Backend offline'));
      await new Promise((r) => setTimeout(r, 20));
    });
  });

  describe('renderStream function contract & error propagation', () => {
    it('rejects when options.env is not provided', async () => {
      const mockRes = new EventEmitter();
      mockRes.headersSent = false;
      await expect(renderStream(mockRes, 'page.njk')).rejects.toThrow(
        'renderStream requires a valid Nunjucks environment'
      );
    });

    it('rejects when res.headersSent is already true', async () => {
      const mockRes = new EventEmitter();
      mockRes.headersSent = true;
      await expect(renderStream(mockRes, 'page.njk', {}, { env })).rejects.toThrow(
        'Cannot render stream: headers already sent'
      );
    });

    it('calls res.flushHeaders() and sets correct status and chunked headers', async () => {
      let flushCalled = false;
      const headers = {};
      let statusCode = 0;
      const writtenChunks = [];

      const mockRes = new EventEmitter();
      mockRes.headersSent = false;
      mockRes.status = (code) => {
        statusCode = code;
        return mockRes;
      };
      mockRes.setHeader = (key, val) => {
        headers[key] = val;
        return mockRes;
      };
      mockRes.flushHeaders = () => {
        flushCalled = true;
      };
      mockRes.write = (chunk) => {
        writtenChunks.push(chunk.toString());
        return true;
      };
      mockRes.end = () => {};

      await renderStream(mockRes, 'simple.njk', { name: 'Express' }, {
        env,
        status: 404,
        flushImmediately: true,
      });

      expect(statusCode).toBe(404);
      expect(headers['Content-Type']).toBe('text/html; charset=utf-8');
      expect(headers['Transfer-Encoding']).toBe('chunked');
      expect(flushCalled).toBe(true);
      expect(writtenChunks.join('')).toContain('Hello Express');
    });

    it('resolves nonce from res.locals.cspNonce and res.locals.nonce', async () => {
      const writtenChunks = [];
      const mockRes = new EventEmitter();
      mockRes.headersSent = false;
      mockRes.locals = { cspNonce: 'res-local-csp' };
      mockRes.status = () => mockRes;
      mockRes.setHeader = () => mockRes;
      mockRes.write = (c) => writtenChunks.push(c.toString());
      mockRes.end = () => {};

      await renderStream(mockRes, 'page.njk', {}, {
        env,
        defer: { feed: Promise.resolve('ok') },
      });

      const full = writtenChunks.join('');
      expect(full).toContain('<script nonce="res-local-csp">');
    });

    it('handles stream error when headersSent is true by writing comment and ending', async () => {
      const writtenChunks = [];
      let ended = false;

      const mockRes = new EventEmitter();
      mockRes.headersSent = false;
      mockRes.status = () => {
        mockRes.headersSent = true;
        return mockRes;
      };
      mockRes.setHeader = () => {
        mockRes.headersSent = true;
        return mockRes;
      };
      mockRes.flushHeaders = () => {
        mockRes.headersSent = true;
      };
      mockRes.write = (c) => writtenChunks.push(c.toString());
      mockRes.end = () => { ended = true; };

      // Pass a non-existent template to cause stream creation/render failure
      await expect(
        renderStream(mockRes, 'non-existent-template.njk', {}, { env })
      ).rejects.toThrow();

      expect(ended).toBe(true);
      expect(writtenChunks.some((c) => c.includes('Streaming Error:'))).toBe(true);
    });

    it('handles res error event gracefully', async () => {
      const mockRes = new EventEmitter();
      mockRes.headersSent = false;
      mockRes.status = () => mockRes;
      mockRes.setHeader = () => mockRes;
      mockRes.write = () => true;
      mockRes.end = () => {};

      const renderPromise = renderStream(mockRes, 'page.njk', {}, {
        env,
        defer: {
          feed: new Promise((r) => setTimeout(r, 200)),
        },
      });

      const socketErr = new Error('ECONNRESET');
      mockRes.emit('error', socketErr);

      await expect(renderPromise).rejects.toThrow('ECONNRESET');
    });
  });
});

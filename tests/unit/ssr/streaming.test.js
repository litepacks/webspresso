/**
 * Unit Tests for SSR Streaming & Chunked Transfer (core/ssr/stream.js)
 */

const nunjucks = require('nunjucks');
const express = require('express');
const request = require('supertest');
const { createHtmlStream, renderStream } = require('../../../core/ssr');

describe('SSR Streaming & Chunked Transfer', () => {
  let env;

  beforeAll(() => {
    const templates = {
      'simple.njk': '<html><body><h1>Hello {{ name }}</h1></body></html>',
      'deferred.njk': '<html><head><title>Streaming</title></head><body><header>Nav</header><div data-stream-target="products">Loading products...</div><footer>Footer</footer></body></html>',
      'product-list.njk': '<ul>{% for p in products %}<li>{{ p.name }} - ${{ p.price }}</li>{% endfor %}</ul>',
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

  it('creates readable HTML stream for standard template', async () => {
    const stream = createHtmlStream({
      env,
      templatePath: 'simple.njk',
      context: { name: 'Webspresso' },
    });

    let result = '';
    for await (const chunk of stream) {
      result += chunk.toString();
    }

    expect(result).toBe('<html><body><h1>Hello Webspresso</h1></body></html>');
  });

  it('streams shell first and then deferred data slot chunks', async () => {
    const deferredProducts = new Promise((resolve) => {
      setTimeout(() => {
        resolve([
          { name: 'Laptop', price: 999 },
          { name: 'Keyboard', price: 99 },
        ]);
      }, 50);
    });

    const stream = createHtmlStream({
      env,
      templatePath: 'deferred.njk',
      context: {},
      defer: {
        products: {
          promise: deferredProducts,
          template: 'product-list.njk',
        },
      },
    });

    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk.toString());
    }

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // First chunk contains shell HTML
    expect(chunks[0]).toContain('<title>Streaming</title>');
    expect(chunks[0]).toContain('Loading products...');

    // Second chunk contains the rendered slot template & injection script
    const combined = chunks.join('');
    expect(combined).toContain('data-stream-slot="products"');
    expect(combined).toContain('Laptop - $999');
    expect(combined).toContain('Keyboard - $99');
  });

  it('renders stream through Express response with chunked headers', async () => {
    const app = express();

    app.get('/stream-test', async (req, res) => {
      await renderStream(res, 'simple.njk', { name: 'Streamer' }, { env });
    });

    const res = await request(app)
      .get('/stream-test')
      .expect(200)
      .expect('Content-Type', /text\/html/);

    expect(res.headers['transfer-encoding']).toBe('chunked');
    expect(res.text).toBe('<html><body><h1>Hello Streamer</h1></body></html>');
  });

  it('handles mid-stream deferred slot rejection gracefully', async () => {
    const rejectedPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('Database query timed out'));
      }, 20);
    });

    const stream = createHtmlStream({
      env,
      templatePath: 'deferred.njk',
      context: {},
      defer: {
        products: rejectedPromise,
      },
    });

    let result = '';
    for await (const chunk of stream) {
      result += chunk.toString();
    }

    expect(result).toContain('<title>Streaming</title>');
    expect(result).toContain('Slot Error (products): Database query timed out');
  });
});

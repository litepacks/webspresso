'use strict';

/**
 * Unit Tests for API Documentation Plugin (Scalar & Swagger UI)
 * Tests dynamic OpenAPI 3 generation, Scalar UI rendering, Swagger UI rendering,
 * and compatibility with both Express and Hono adapters.
 */

const {
  apiDocsPlugin,
  swaggerPlugin,
  buildScalarUiHtml,
  buildSwaggerUiHtml,
  createApp,
  defineApi,
} = require('../../index');

describe('API Docs Plugin - HTML Builders', () => {
  it('builds valid Scalar API reference HTML with configuration', () => {
    const html = buildScalarUiHtml('/api/openapi.json', {
      title: 'My Custom API Docs',
      theme: 'purple',
      darkMode: true,
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>My Custom API Docs</title>');
    expect(html).toContain('@scalar/api-reference');
    expect(html).toContain('/api/openapi.json');
    expect(html).toContain('"theme":"purple"');
  });

  it('builds valid Swagger UI HTML with spec URL', () => {
    const html = buildSwaggerUiHtml('/api/openapi.json', {
      title: 'Swagger Explorer',
      docExpansion: 'full',
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Swagger Explorer</title>');
    expect(html).toContain('swagger-ui-bundle.js');
    expect(html).toContain('/api/openapi.json');
    expect(html).toContain('"full"');
  });
});

describe('API Docs Plugin - Endpoints & Route Mounting', () => {
  it('mounts OpenAPI JSON and Scalar UI endpoints on an Express application', async () => {
    const app = createApp({
      server: { port: 0 },
      plugins: [
        apiDocsPlugin({
          path: '/api/docs',
          jsonPath: '/api/openapi.json',
          title: 'Store API',
          ui: 'scalar',
          enabled: true,
        }),
      ],
    });

    // 1. Fetch OpenAPI JSON specification
    const resJson = await app.inject({
      method: 'GET',
      url: '/api/openapi.json',
    });

    expect(resJson.statusCode).toBe(200);
    const spec = JSON.parse(resJson.body);
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('Store API');

    // 2. Fetch Scalar Documentation UI HTML
    const resHtml = await app.inject({
      method: 'GET',
      url: '/api/docs',
    });

    expect(resHtml.statusCode).toBe(200);
    expect(resHtml.headers['content-type']).toContain('text/html');
    expect(resHtml.body).toContain('<title>Store API - API Reference</title>');
    expect(resHtml.body).toContain('@scalar/api-reference');
  });

  it('mounts Swagger UI when ui: "swagger" is specified', async () => {
    const app = createApp({
      server: { port: 0 },
      plugins: [
        swaggerPlugin({
          path: '/api/swagger',
          jsonPath: '/api/spec.json',
          title: 'Legacy Swagger API',
          ui: 'swagger',
          enabled: true,
        }),
      ],
    });

    const resHtml = await app.inject({
      method: 'GET',
      url: '/api/swagger',
    });

    expect(resHtml.statusCode).toBe(200);
    expect(resHtml.headers['content-type']).toContain('text/html');
    expect(resHtml.body).toContain('swagger-ui-bundle.js');
  });

  it('works seamlessly on Hono adapter with res.type("html")', async () => {
    const app = createApp({
      adapter: 'hono',
      plugins: [
        apiDocsPlugin({
          path: '/docs',
          jsonPath: '/openapi.json',
          title: 'Edge Hono API',
          ui: 'scalar',
          enabled: true,
        }),
      ],
    });

    // Test through app.handle (Standard Web Request / Fetch API)
    const req = new Request('http://localhost/docs', {
      method: 'GET',
    });

    const res = await app.handle(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');

    const html = await res.text();
    expect(html).toContain('Edge Hono API');
    expect(html).toContain('@scalar/api-reference');
  });
});

'use strict';

const path = require('path');
const fs = require('fs');
const request = require('supertest');
const { createApp } = require('../../../src/server');
const { swaggerPlugin, openapiPlugin, apiDocsPlugin, buildScalarUiHtml, buildSwaggerUiHtml } = require('../../../plugins/swagger');
const { buildOpenApiDocument } = require('../../../core/openapi/build-from-api-routes');
const { Command } = require('commander');
const { registerCommand: registerOpenapiCommand } = require('../../../bin/commands/openapi');

const FIXTURES_PAGES = path.join(__dirname, '..', '..', 'fixtures', 'pages');
const FIXTURES_VIEWS = path.join(__dirname, '..', '..', 'fixtures', 'views');

describe('Swagger & Scalar Plugin Enhancements', () => {
  it('should generate valid Scalar UI HTML containing @scalar/api-reference', () => {
    const html = buildScalarUiHtml('/_swagger/openapi.json', {
      title: 'My Custom API',
      theme: 'purple',
      darkMode: true,
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>My Custom API</title>');
    expect(html).toContain('@scalar/api-reference');
    expect(html).toContain('"theme":"purple"');
    expect(html).toContain('"url":"/_swagger/openapi.json"');
  });

  it('should serve Scalar UI at root when ui: "scalar" is configured', async () => {
    const plugin = swaggerPlugin({
      enabled: true,
      ui: 'scalar',
      theme: 'moon',
    });
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      plugins: [plugin],
    });

    const res = await request(app).get('/_swagger').expect(200);
    expect(res.text).toContain('@scalar/api-reference');
    expect(res.text).toContain('"theme":"moon"');
  });

  it('should provide both /scalar and /swagger endpoints regardless of default ui', async () => {
    const plugin = swaggerPlugin({
      enabled: true,
      ui: 'swagger',
    });
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      plugins: [plugin],
    });

    // Default is Swagger
    const rootRes = await request(app).get('/_swagger').expect(200);
    expect(rootRes.text).toContain('swagger-ui');

    // /scalar serves Scalar
    const scalarRes = await request(app).get('/_swagger/scalar').expect(200);
    expect(scalarRes.text).toContain('@scalar/api-reference');

    // /swagger serves Swagger
    const swaggerRes = await request(app).get('/_swagger/swagger').expect(200);
    expect(swaggerRes.text).toContain('swagger-ui');
  });

  it('should export openapiPlugin and apiDocsPlugin aliases identically to swaggerPlugin', () => {
    expect(openapiPlugin).toBe(swaggerPlugin);
    expect(apiDocsPlugin).toBe(swaggerPlugin);
  });

  it('should auto-infer tags, summaries, and parameters from modern discovered routes', () => {
    const mockRoutes = [
      {
        type: 'api',
        method: 'get',
        path: '/api/users',
      },
      {
        type: 'api',
        method: 'get',
        path: '/api/users/:id',
        middleware: ['jwt'],
      },
      {
        type: 'api',
        method: 'post',
        path: '/api/users',
        middleware: ['auth'],
      },
      {
        type: 'api',
        method: 'delete',
        path: '/api/products/[slug]',
      },
    ];

    const doc = buildOpenApiDocument({
      pagesDir: FIXTURES_PAGES,
      routes: mockRoutes,
      info: { title: 'Test API', version: '1.0.0' },
    });

    // Path normalization: colon and bracket param converted to {param}
    expect(doc.paths['/api/users']).toBeDefined();
    expect(doc.paths['/api/users/{id}']).toBeDefined();
    expect(doc.paths['/api/products/{slug}']).toBeDefined();

    // Summary and tag inference
    const listUsers = doc.paths['/api/users'].get;
    expect(listUsers.summary).toBe('List users');
    expect(listUsers.tags).toEqual(['users']);

    const getUser = doc.paths['/api/users/{id}'].get;
    expect(getUser.summary).toBe('Get users by ID');
    expect(getUser.tags).toEqual(['users']);
    expect(getUser.security).toEqual([{ bearerAuth: [] }]);

    const createUser = doc.paths['/api/users'].post;
    expect(createUser.summary).toBe('Create users');
    expect(createUser.tags).toEqual(['users']);
    expect(createUser.security).toEqual([{ sessionAuth: [] }]);

    const deleteProduct = doc.paths['/api/products/{slug}'].delete;
    expect(deleteProduct.summary).toBe('Delete products');
    expect(deleteProduct.tags).toEqual(['products']);

    // Security schemes in components
    expect(doc.components.securitySchemes.bearerAuth).toBeDefined();
    expect(doc.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
    expect(doc.components.securitySchemes.sessionAuth).toBeDefined();
    expect(doc.components.securitySchemes.sessionAuth.type).toBe('apiKey');
  });

  it('should auto-register in admin panel when admin-panel plugin is present', () => {
    let registeredModule = null;
    const mockAdminApi = {
      registerModule(mod) {
        registeredModule = mod;
      },
    };

    const mockCtx = {
      routes: [],
      options: {},
      addRoute: vi.fn(),
      usePlugin: vi.fn((name) => {
        if (name === 'admin-panel') return mockAdminApi;
        return null;
      }),
    };

    const plugin = swaggerPlugin({
      enabled: true,
      admin: true,
      adminTitle: 'REST Documentation',
    });

    plugin.onRoutesReady(mockCtx);

    expect(registeredModule).not.toBeNull();
    expect(registeredModule.id).toBe('api-docs');
    expect(registeredModule.title).toBe('REST Documentation');
    expect(registeredModule.pages[0].path).toBe('/api-docs');
    expect(registeredModule.pages[0].component).toContain('REST Documentation');
    expect(registeredModule.pages[0].component).toContain('/_swagger/openapi.json');
    expect(registeredModule.menu[0].label).toBe('REST Documentation');
  });

  it('should not register in admin panel if admin: false is passed', () => {
    let registeredModule = null;
    const mockAdminApi = {
      registerModule(mod) {
        registeredModule = mod;
      },
    };

    const mockCtx = {
      routes: [],
      options: {},
      addRoute: vi.fn(),
      usePlugin: vi.fn((name) => {
        if (name === 'admin-panel') return mockAdminApi;
        return null;
      }),
    };

    const plugin = swaggerPlugin({
      enabled: true,
      admin: false,
    });

    plugin.onRoutesReady(mockCtx);

    expect(registeredModule).toBeNull();
  });

  describe('CLI openapi command', () => {
    const tempOutFile = path.join(__dirname, 'test-openapi-out.json');

    afterEach(() => {
      if (fs.existsSync(tempOutFile)) {
        fs.unlinkSync(tempOutFile);
      }
    });

    it('should generate specification to file via CLI command', async () => {
      const program = new Command();
      registerOpenapiCommand(program);

      const logs = [];
      const originalLog = console.log;
      console.log = (msg) => logs.push(msg);

      try {
        await program.parseAsync([
          'node',
          'webspresso',
          'openapi',
          '--root',
          path.resolve(__dirname, '..', '..'),
          '--pages',
          path.relative(path.resolve(__dirname, '..', '..'), FIXTURES_PAGES),
          '--out',
          tempOutFile,
          '--title',
          'CLI Generated Spec',
        ]);
      } finally {
        console.log = originalLog;
      }

      expect(fs.existsSync(tempOutFile)).toBe(true);
      const content = JSON.parse(fs.readFileSync(tempOutFile, 'utf8'));
      expect(content.openapi).toMatch(/^3\.0\./);
      expect(content.info.title).toBe('CLI Generated Spec');
      expect(content.paths['/api/health']).toBeDefined();
    });
  });
});

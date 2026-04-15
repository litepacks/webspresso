/**
 * Swagger / OpenAPI plugin integration tests
 */

const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/server');
const swaggerPlugin = require('../../plugins/swagger');
const { zdb, defineModel, clearRegistry } = require('../../core/orm');

const FIXTURES_PAGES = path.join(__dirname, '..', 'fixtures', 'pages');
const FIXTURES_VIEWS = path.join(__dirname, '..', 'fixtures', 'views');

describe('Swagger Plugin Integration', () => {
  function setupApp(pluginOpts = {}) {
    const plugin = swaggerPlugin({ enabled: true, ...pluginOpts });
    const result = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      plugins: [plugin],
    });
    return result.app;
  }

  it('should expose OpenAPI JSON with paths from pages/api', async () => {
    const app = setupApp();

    const res = await request(app).get('/_swagger/openapi.json').expect(200);

    expect(res.body.openapi).toMatch(/^3\.0\./);
    expect(res.body.info.title).toBeDefined();
    expect(res.body.paths['/api/health']).toBeDefined();
    expect(res.body.paths['/api/health'].get).toBeDefined();
    expect(res.body.paths['/api/echo'].post).toBeDefined();
  });

  it('should include Zod body schema for routes that export schema()', async () => {
    const app = setupApp();

    const res = await request(app).get('/_swagger/openapi.json').expect(200);

    const post = res.body.paths['/api/doc-demo'].post;
    expect(post).toBeDefined();
    expect(post.requestBody.content['application/json'].schema.properties.title).toEqual({
      type: 'string',
    });
    expect(post.responses['200'].content['application/json'].schema.properties.ok).toEqual({
      type: 'boolean',
    });
  });

  it('should serve Swagger UI HTML', async () => {
    const app = setupApp();

    const res = await request(app).get('/_swagger').expect(200);

    expect(res.text).toContain('swagger-ui');
    expect(res.text).toContain('/_swagger/openapi.json');
  });

  it('should respect custom path option', async () => {
    const plugin = swaggerPlugin({ enabled: true, path: '/docs' });
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      plugins: [plugin],
    });

    await request(app).get('/docs/openapi.json').expect(200);
    const html = await request(app).get('/docs').expect(200);
    expect(html.text).toContain('/docs/openapi.json');
  });

  it('should return 403 when authorize returns false', async () => {
    const app = setupApp({
      authorize: () => false,
    });

    await request(app).get('/_swagger/openapi.json').expect(403);
    await request(app).get('/_swagger').expect(403);
  });

  it('should merge ORM components when includeOrmSchemas is true', async () => {
    clearRegistry();
    defineModel({
      name: 'SwaggerDocUser',
      table: 'swagger_doc_users',
      schema: zdb.schema({
        id: zdb.id(),
        name: zdb.string(),
      }),
    });

    const plugin = swaggerPlugin({
      enabled: true,
      includeOrmSchemas: true,
    });
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      plugins: [plugin],
    });

    const res = await request(app).get('/_swagger/openapi.json').expect(200);

    expect(res.body.components.schemas.SwaggerDocUser).toBeDefined();
    expect(res.body.components.schemas.SwaggerDocUserInput).toBeDefined();
    expect(res.body.paths['/api/health']).toBeDefined();

    clearRegistry();
  });
});

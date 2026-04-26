/**
 * @vitest-environment node
 */

const path = require('path');
const {
  expressPathToOpenApi,
  buildOpenApiDocument,
} = require('../../../core/openapi/build-from-api-routes');

const FIXTURES_PAGES = path.join(__dirname, '..', '..', 'fixtures', 'pages');

describe('build-from-api-routes', () => {
  describe('expressPathToOpenApi', () => {
    it('maps Express params to OpenAPI', () => {
      expect(expressPathToOpenApi('/users/:id')).toBe('/users/{id}');
      expect(expressPathToOpenApi('/a/:x/b/:y')).toBe('/a/{x}/b/{y}');
    });

    it('maps catch-all star to wildcard placeholder', () => {
      expect(expressPathToOpenApi('/files/*')).toBe('/files/{wildcard}');
    });
  });

  describe('buildOpenApiDocument', () => {
    it('requires pagesDir', () => {
      expect(() => buildOpenApiDocument({ routes: [] })).toThrow('pagesDir is required');
    });

    it('builds paths from api routes', () => {
      const doc = buildOpenApiDocument({
        pagesDir: FIXTURES_PAGES,
        routes: [
          { type: 'api', method: 'get', pattern: '/api/test', file: 'api/test.get.js' },
        ],
      });
      expect(doc.openapi).toMatch(/^3\.0\./);
      expect(doc.paths['/api/test'].get).toBeDefined();
      expect(doc.paths['/api/test'].get.summary).toContain('GET');
    });

    it('includes requestBody and response content when route exports Zod schema', () => {
      const doc = buildOpenApiDocument({
        pagesDir: FIXTURES_PAGES,
        routes: [
          { type: 'api', method: 'post', pattern: '/api/doc-demo', file: 'api/doc-demo.post.js' },
        ],
      });
      const op = doc.paths['/api/doc-demo'].post;
      expect(op.requestBody.content['application/json']).toBeDefined();
      expect(op.responses['200'].content['application/json']).toBeDefined();
    });

    it('ignores ssr route metadata and only emits api paths', () => {
      const doc = buildOpenApiDocument({
        pagesDir: FIXTURES_PAGES,
        routes: [
          { type: 'api', method: 'get', pattern: '/api/test', file: 'api/test.get.js' },
          { type: 'ssr', method: 'get', pattern: '/x', file: 'x' },
        ],
      });
      expect(doc.paths['/api/test'].get).toBeDefined();
      expect(Object.keys(doc.paths).length).toBe(1);
    });

    it('skips non-api routes', () => {
      const doc = buildOpenApiDocument({
        pagesDir: FIXTURES_PAGES,
        routes: [{ type: 'ssr', method: 'get', pattern: '/about', file: 'about.njk' }],
      });
      expect(Object.keys(doc.paths).length).toBe(0);
    });

    it('omits ORM schemas when includeOrmSchemas is false', () => {
      const doc = buildOpenApiDocument({
        pagesDir: FIXTURES_PAGES,
        routes: [],
        includeOrmSchemas: false,
      });
      expect(doc.components.schemas).toEqual({});
    });

    it('sets components.schemas when includeOrmSchemas is true', () => {
      const doc = buildOpenApiDocument({
        pagesDir: FIXTURES_PAGES,
        routes: [],
        includeOrmSchemas: true,
      });
      expect(doc.components.schemas).toBeDefined();
      expect(typeof doc.components.schemas).toBe('object');
    });

    it('skips routes whose file does not exist', () => {
      const doc = buildOpenApiDocument({
        pagesDir: FIXTURES_PAGES,
        routes: [
          { type: 'api', method: 'get', pattern: '/nope', file: 'api/missing-route.get.js' },
        ],
      });
      expect(doc.paths).toEqual({});
    });
  });
});

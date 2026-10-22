const {
  createTempDir,
  cleanupDir
} = require('../utils');

'use strict';

const fs = require('fs');
const path = require('path');
const {
  pathToSegments,
  extractRouteTypes,
  generateClientCode,
  generateClient,
  createWebspressoClient,
  WebspressoClientError,
} = require('../../src/dev/client-gen');
const { z } = require('../../core/validation');

describe('Webspresso Client Generator Engine', () => {
  describe('pathToSegments()', () => {
    it('should split path patterns into clean segments', () => {
      expect(pathToSegments('/api/notes/:id')).toEqual(['api', 'notes', ':id']);
      expect(pathToSegments('api/users/profile/')).toEqual(['api', 'users', 'profile']);
      expect(pathToSegments('///api///items///')).toEqual(['api', 'items']);
      expect(pathToSegments('')).toEqual([]);
      expect(pathToSegments('/')).toEqual([]);
    });
  });

  describe('extractRouteTypes()', () => {
    let tmpDir;
    beforeEach(() => {
      tmpDir = createTempDir('client-gen-test');
    });
    afterEach(() => {
      cleanupDir(tmpDir);
    });

    it('should extract body, query, and params types from route definition', () => {
      const routeFile = path.join(tmpDir, 'test-route.js');
      fs.writeFileSync(
        routeFile,
        `
        const { z } = require('${path.resolve(__dirname, '../../core/validation')}');
        module.exports = {
          schema: () => ({
            body: z.object({
              title: z.string(),
              count: z.number().optional(),
              tags: z.array(z.string()),
              status: z.enum(['draft', 'published']),
            }),
            query: z.object({ search: z.string().optional(), limit: z.number().default(10) }),
            params: z.object({ id: z.string() })
          }),
          response: {
            200: z.object({ id: z.string(), ok: z.boolean() })
          },
          handler: async (req, res) => res.json({ ok: true })
        };
        `,
        'utf8'
      );

      const types = extractRouteTypes(routeFile);
      expect(types.bodyType).toContain('title: string;');
      expect(types.bodyType).toContain('count?: number;');
      expect(types.bodyType).toContain('tags: Array<string>;');
      expect(types.bodyType).toContain("status: 'draft' | 'published';");
      expect(types.queryType).toContain('search?: string;');
      expect(types.paramsType).toContain('id: string;');
      expect(types.responseType).toContain('ok: boolean;');
    });

    it('should return default types when no schema is present', () => {
      const routeFile = path.join(tmpDir, 'empty-route.js');
      fs.writeFileSync(routeFile, 'module.exports = { handler: () => {} };', 'utf8');

      const types = extractRouteTypes(routeFile);
      expect(types.bodyType).toBe('unknown');
      expect(types.queryType).toBe('Record<string, unknown>');
      expect(types.paramsType).toBe('Record<string, string>');
      expect(types.responseType).toBe('any');
    });

    it('should handle non-existent file gracefully', () => {
      const types = extractRouteTypes('/path/does/not/exist.js');
      expect(types.bodyType).toBe('unknown');
      expect(types.queryType).toBe('Record<string, unknown>');
    });
  });

  describe('generateClientCode() & generateClient()', () => {
    let tmpDir;
    beforeEach(() => {
      tmpDir = createTempDir('client-gen-full');
    });
    afterEach(() => {
      cleanupDir(tmpDir);
    });

    it('should generate valid client code and write output file', () => {
      const pagesDir = path.join(tmpDir, 'pages');
      const apiDir = path.join(pagesDir, 'api');
      fs.mkdirSync(apiDir, { recursive: true });

      fs.writeFileSync(
        path.join(apiDir, 'notes.get.js'),
        `
        const { z } = require('${path.resolve(__dirname, '../../core/validation')}');
        module.exports = {
          schema: () => ({
            query: z.object({ limit: z.number().optional() })
          }),
          handler: (req, res) => res.json([])
        };
        `,
        'utf8'
      );

      const outFile = path.join(tmpDir, 'client.ts');
      const result = generateClient({
        rootDir: tmpDir,
        pagesDir: 'pages',
        outFile,
        baseUrl: 'https://api.example.com',
      });

      expect(result.outFile).toBe(outFile);
      expect(result.routesCount).toBe(1);
      expect(fs.existsSync(outFile)).toBe(true);

      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('createWebspressoClient');
      expect(content).toContain('WebspressoClientError');
      expect(content).toContain('https://api.example.com');
      expect(content).toContain('export interface Route_0_Req');
    });
  });

  describe('Runtime createWebspressoClient Proxy Execution', () => {
    it('throws error when no fetch is provided and global fetch is missing', () => {
      expect(() => {
        createWebspressoClient({ fetch: null, baseUrl: 'http://localhost' });
      }).toThrow();
    });

    it('executes GET request with query parameters and dynamic segments', async () => {
      let capturedUrl = '';
      let capturedOpts = null;

      const mockFetch = async (url, opts) => {
        capturedUrl = url;
        capturedOpts = opts;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => [{ id: '1', title: 'Test Note' }],
        };
      };

      const client = createWebspressoClient({
        baseUrl: 'https://api.webspresso.io/',
        fetch: mockFetch,
      });

      const res = await client.api.notes.get({
        query: { limit: 10, search: 'hello world', active: true, tag: ['news', 'tech'], ignoreNull: null },
      });

      expect(res).toEqual([{ id: '1', title: 'Test Note' }]);
      expect(capturedOpts.method).toBe('GET');
      expect(capturedUrl).toContain('https://api.webspresso.io/api/notes?');
      expect(capturedUrl).toContain('limit=10');
      expect(capturedUrl).toContain('search=hello+world');
      expect(capturedUrl).toContain('active=true');
      expect(capturedUrl).toContain('tag=news&tag=tech');
      expect(capturedUrl).not.toContain('ignoreNull');
    });

    it('executes dynamic function call paths: client.api.notes("123").comments("456").get()', async () => {
      let capturedUrl = '';

      const mockFetch = async (url) => {
        capturedUrl = url;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ id: '456', text: 'Comment' }),
        };
      };

      const client = createWebspressoClient({
        baseUrl: 'https://api.example.com',
        fetch: mockFetch,
      });

      await client.api.notes('note_123').comments('comm_456').get();
      expect(capturedUrl).toBe('https://api.example.com/api/notes/note_123/comments/comm_456');
    });

    it('substitutes :param and [param] in paths and encodes URI components', async () => {
      let capturedUrl = '';

      const mockFetch = async (url) => {
        capturedUrl = url;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ success: true }),
        };
      };

      const client = createWebspressoClient({
        baseUrl: 'https://api.example.com',
        fetch: mockFetch,
      });

      await client.api.users(':userId').get({
        params: { userId: 'alice smith' },
      });
      expect(capturedUrl).toBe('https://api.example.com/api/users/alice%20smith');
    });

    it('executes POST, PUT, PATCH, DELETE with JSON payloads and headers', async () => {
      let capturedMethod = '';
      let capturedBody = '';
      let capturedHeaders = null;

      const mockFetch = async (url, opts) => {
        capturedMethod = opts.method;
        capturedBody = opts.body;
        capturedHeaders = opts.headers;
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ id: 'new_id' }),
        };
      };

      const client = createWebspressoClient({
        baseUrl: 'https://api.example.com',
        headers: { 'X-App-Version': '1.0.0' },
        getToken: async () => 'mock_jwt_token',
        fetch: mockFetch,
      });

      // POST
      await client.api.notes.post({
        body: { title: 'Created' },
        headers: { 'X-Request-Id': 'req_xyz' },
      });

      expect(capturedMethod).toBe('POST');
      expect(JSON.parse(capturedBody)).toEqual({ title: 'Created' });
      expect(capturedHeaders['Authorization']).toBe('Bearer mock_jwt_token');
      expect(capturedHeaders['X-App-Version']).toBe('1.0.0');
      expect(capturedHeaders['X-Request-Id']).toBe('req_xyz');
      expect(capturedHeaders['Content-Type']).toBe('application/json');

      // DELETE
      await client.api.notes('note_1').delete();
      expect(capturedMethod).toBe('DELETE');
    });

    it('supports dynamic async headers function', async () => {
      let capturedHeaders = null;

      const mockFetch = async (url, opts) => {
        capturedHeaders = opts.headers;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({}),
        };
      };

      const client = createWebspressoClient({
        baseUrl: 'https://api.example.com',
        headers: async () => ({ 'X-Dynamic-Key': 'dyn_123' }),
        fetch: mockFetch,
      });

      await client.api.test.get();
      expect(capturedHeaders['X-Dynamic-Key']).toBe('dyn_123');
    });

    it('passes AbortSignal to fetch options', async () => {
      let capturedSignal = null;
      const controller = new AbortController();

      const mockFetch = async (url, opts) => {
        capturedSignal = opts.signal;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({}),
        };
      };

      const client = createWebspressoClient({
        fetch: mockFetch,
      });

      await client.api.test.get({ signal: controller.signal });
      expect(capturedSignal).toBe(controller.signal);
    });

    it('throws WebspressoClientError on HTTP 4xx/5xx with parsed JSON error', async () => {
      const mockFetch = async () => ({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'Invalid email address', field: 'email' }),
      });

      const client = createWebspressoClient({ fetch: mockFetch });

      await expect(client.api.register.post({ body: {} })).rejects.toThrow(WebspressoClientError);

      try {
        await client.api.register.post({ body: {} });
      } catch (err) {
        expect(err.name).toBe('WebspressoClientError');
        expect(err.status).toBe(422);
        expect(err.message).toBe('Invalid email address');
        expect(err.data).toEqual({ error: 'Invalid email address', field: 'email' });
      }
    });

    it('throws WebspressoClientError on plain text error responses', async () => {
      const mockFetch = async () => ({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: async () => 'Upstream service timeout',
      });

      const client = createWebspressoClient({ fetch: mockFetch });

      try {
        await client.api.upstream.get();
      } catch (err) {
        expect(err.status).toBe(502);
        expect(err.message).toBe('Bad Gateway');
        expect(err.data).toBe('Upstream service timeout');
      }
    });
  });
});

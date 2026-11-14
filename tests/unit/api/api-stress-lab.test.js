'use strict';

/**
 * Webspresso - Src API Stress Lab
 * Stress-tests 100 concurrent schema-validated API requests, field-validation mode
 * (x-webspresso-validate-fields) without running mutation handler, dev hot-reload, and validation i18n.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { defineApi } = require('../../../src/api/define-api');
const { createApiHandler } = require('../../../src/api/api-loader');
const { translateValidationIssues } = require('../../../src/api/validation-i18n');

function httpRequest(port, method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let parsed = raw;
          try { parsed = JSON.parse(raw); } catch (_) {}
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('Src API Stress Lab (Concurrency, Schema Validation, Field Validation, Hot-Reload, i18n)', () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('1. handles 100 concurrent API requests with Zod body/params/query/headers validation without cross-leakage', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-api-stress-'));
    tempDirs.push(tmpDir);

    const defineApiPath = JSON.stringify(path.resolve(__dirname, '../../../src/api/define-api'));
    const routeFile = path.join(tmpDir, 'orders.post.js');

    fs.writeFileSync(
      routeFile,
      `const { defineApi } = require(${defineApiPath});
module.exports = defineApi({
  schema: ({ z }) => ({
    params: z.object({ orgId: z.string().min(1) }),
    query: z.object({ dryRun: z.enum(['true', 'false']).optional() }),
    headers: z.object({ 'x-client-seq': z.string().min(1) }),
    body: z.object({ sku: z.string().min(2), qty: z.number().int().positive() }),
  }),
  handler: async (req, ctx) => {
    await new Promise((r) => setTimeout(r, req.input.body.qty % 4));
    const svcRes = await ctx.service('echo.seq', { seq: req.input.headers['x-client-seq'] });
    return {
      orgId: req.input.params.orgId,
      sku: req.input.body.sku,
      qty: req.input.body.qty,
      dryRun: req.input.query.dryRun || 'false',
      svcSeq: svcRes.seq,
    };
  },
});
`
    );

    const app = express();
    app.use(express.json());
    app.post(
      '/api/:orgId/orders',
      createApiHandler(
        { file: routeFile, path: '/api/:orgId/orders', method: 'POST', type: 'api', source: 'pages/api/[orgId]/orders.post.js' },
        {
          isDev: false,
          serviceRegistry: {
            call: async (_name, input) => ({ seq: input.seq }),
          },
        }
      )
    );
    app.use((err, _req, res, _next) => {
      const status = err.statusCode || err.status || (err.name === 'ZodError' ? 400 : 500);
      res.status(status).json({ error: err.name || 'Error', message: err.message });
    });

    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;

    try {
      const requests = [];
      for (let i = 0; i < 100; i++) {
        const isValid = i % 4 !== 0;
        const body = isValid ? { sku: `SKU-${i}`, qty: i + 1 } : { sku: 'X', qty: -5 };
        requests.push(
          httpRequest(port, 'POST', `/api/org-${i}/orders?dryRun=${i % 2 === 0 ? 'true' : 'false'}`, {
            headers: { 'x-client-seq': `seq-${i}` },
            body,
          }).then((res) => ({ i, isValid, res }))
        );
      }

      const settled = await Promise.all(requests);
      for (const item of settled) {
        if (item.isValid) {
          expect(item.res.status).toBe(200);
          expect(item.res.body).toEqual({
            orgId: `org-${item.i}`,
            sku: `SKU-${item.i}`,
            qty: item.i + 1,
            dryRun: item.i % 2 === 0 ? 'true' : 'false',
            svcSeq: `seq-${item.i}`,
          });
        } else {
          expect(item.res.status).toBeGreaterThanOrEqual(400);
          expect(item.res.status).toBeLessThan(500);
        }
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('2. runs validateFields + validate hook without executing mutation handler under concurrent calls', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-api-fieldval-'));
    tempDirs.push(tmpDir);

    const defineApiPath = JSON.stringify(path.resolve(__dirname, '../../../src/api/define-api'));
    const routeFile = path.join(tmpDir, 'register.post.js');

    let mutationExecutions = 0;
    global.__apiStressMutationCount = () => { mutationExecutions++; };

    fs.writeFileSync(
      routeFile,
      `const { defineApi } = require(${defineApiPath});
module.exports = defineApi({
  validateFields: ['email', 'username'],
  schema: ({ z }) => ({
    body: z.object({
      email: z.string().email(),
      username: z.string().min(3),
    }),
  }),
  validate: async (ctx) => {
    const errors = {};
    if (ctx.req.body?.username === 'taken_user') {
      errors.username = 'Already taken';
    }
    return errors;
  },
  handler: async () => {
    global.__apiStressMutationCount();
    return { created: true };
  },
});
`
    );

    const app = express();
    app.use(express.json());
    app.post(
      '/api/register',
      createApiHandler(
        { file: routeFile, path: '/api/register', method: 'POST', type: 'api' },
        { isDev: false }
      )
    );
    app.use((err, _req, res, _next) => {
      res.status(err.statusCode || 400).json({ error: err.message });
    });

    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;

    try {
      const checks = await Promise.all([
        httpRequest(port, 'POST', '/api/register', {
          headers: { 'x-webspresso-validate-fields': 'email' },
          body: { email: 'not-an-email', username: 'ok_user' },
        }),
        httpRequest(port, 'POST', '/api/register', {
          headers: { 'x-webspresso-validate-fields': 'username' },
          body: { email: 'ada@example.com', username: 'taken_user' },
        }),
        httpRequest(port, 'POST', '/api/register', {
          headers: { 'x-webspresso-validate-fields': 'email,username' },
          body: { email: 'ada@example.com', username: 'fresh_user' },
        }),
      ]);

      expect(mutationExecutions).toBe(0);
      expect(checks[0].status).toBe(200);
      expect(checks[0].body.valid).toBe(false);
      expect(checks[0].body.errors.email).toBeTruthy();

      expect(checks[1].status).toBe(200);
      expect(checks[1].body.valid).toBe(false);
      expect(checks[1].body.errors.username).toBe('Already taken');

      expect(checks[2].status).toBe(200);
      expect(checks[2].body.valid).toBe(true);
    } finally {
      delete global.__apiStressMutationCount;
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('3. hot-reloads API modules across 12 dev-mode requests and returns 404 for non-route helper files', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-api-hot-'));
    tempDirs.push(tmpDir);

    const defineApiPath = JSON.stringify(path.resolve(__dirname, '../../../src/api/define-api'));
    const hotFile = path.join(tmpDir, 'version.get.js');
    const helperFile = path.join(tmpDir, 'helper.js');
    fs.writeFileSync(helperFile, `module.exports = { util: () => 42 };`);

    const app = express();
    app.get('/api/version', createApiHandler({ file: hotFile, path: '/api/version', method: 'GET', type: 'api', source: 'pages/api/version.get.js' }, { isDev: true }));
    app.get('/api/helper', createApiHandler({ file: helperFile, path: '/api/helper', method: 'GET', type: 'api', source: 'pages/api/helper.js' }, { isDev: false }));
    app.use((_req, res) => res.status(404).json({ notFound: true }));

    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;

    try {
      for (let v = 1; v <= 12; v++) {
        fs.writeFileSync(
          hotFile,
          `const { defineApi } = require(${defineApiPath});
module.exports = defineApi({ handler: async () => ({ v: ${v} }) });
`
        );
        const res = await httpRequest(port, 'GET', '/api/version');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ v });
      }

      const helperRes = await httpRequest(port, 'GET', '/api/helper');
      expect(helperRes.status).toBe(404);
      expect(helperRes.body).toEqual({ notFound: true });
      expect(defineApi(() => ({ ok: true })).__isWebspressoApi).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('4. translates Zod validation issues cleanly across 200 locale burst iterations', () => {
    const sampleIssues = [
      { code: 'too_small', minimum: 3, type: 'string', inclusive: true, path: ['username'], message: 'String must contain at least 3 character(s)' },
      { code: 'invalid_type', expected: 'number', received: 'string', path: ['qty'], message: 'Expected number, received string' },
    ];

    for (let i = 0; i < 200; i++) {
      const translated = translateValidationIssues(sampleIssues, {
        locale: i % 2 === 0 ? 'tr' : 'en',
      });
      expect(Array.isArray(translated)).toBe(true);
      expect(translated).toHaveLength(2);
      expect(typeof translated[0].message).toBe('string');
      expect(translated[0].message.length).toBeGreaterThan(0);
    }
  });
});

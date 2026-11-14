'use strict';

/**
 * Webspresso - Src Pages Stress Lab
 * Stress-tests 80 concurrent SSR requests across definePage/companion-.njk/standalone-.njk,
 * dev-mode hot-reload mutations, module middleware precedence, and error enrichment.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const nunjucks = require('nunjucks');
const { definePage } = require('../../../src/pages/define-page');
const { createPageHandler, resolveMiddlewaresWithModule } = require('../../../src/pages/page-loader');

function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

describe('Src Pages Stress Lab (Concurrent SSR, Hot-Reload, Middleware Precedence, Error Safety)', () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('1. serves 80 concurrent SSR requests across definePage, companion .njk, and standalone .njk without data leakage', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-pages-stress-'));
    tempDirs.push(tmpDir);

    const definePagePath = JSON.stringify(path.resolve(__dirname, '../../../src/pages/define-page'));

    // 1. Pure JS definePage
    const jsPageFile = path.join(tmpDir, 'item.js');
    fs.writeFileSync(
      jsPageFile,
      `const { definePage } = require(${definePagePath});
module.exports = definePage({
  load: async (ctx) => {
    await new Promise((r) => setTimeout(r, Number(ctx.params.id) % 5));
    return { itemId: ctx.params.id };
  },
  head: (data) => ({ title: 'Item-' + data.itemId }),
  render: (data, head) => '<html><title>' + (head?.title || '') + '</title><body>JS:' + data.itemId + '</body></html>',
});
`
    );

    // 2. Companion .js + .njk
    const njkCompanionJs = path.join(tmpDir, 'profile.js');
    const njkCompanionTpl = path.join(tmpDir, 'profile.njk');
    fs.writeFileSync(
      njkCompanionJs,
      `const { definePage } = require(${definePagePath});
module.exports = definePage({
  load: async (ctx) => {
    await new Promise((r) => setTimeout(r, Number(ctx.params.id) % 4));
    return { profileId: ctx.params.id };
  },
});
`
    );
    fs.writeFileSync(njkCompanionTpl, '<div data-profile="{{ profileId }}">NJK:{{ profileId }}</div>');

    // 3. Standalone .njk
    const standaloneNjk = path.join(tmpDir, 'static.njk');
    fs.writeFileSync(standaloneNjk, '<main>STATIC_OK</main>');

    const njkEnv = nunjucks.configure(tmpDir, { autoescape: true });
    const app = express();
    const ctx = { nunjucks: njkEnv, middlewares: {}, isDev: false };

    app.get('/page-js/:id', createPageHandler({ file: jsPageFile, path: '/page-js/:id', method: 'GET', type: 'page' }, ctx));
    app.get('/page-njk/:id', createPageHandler({ file: njkCompanionJs, path: '/page-njk/:id', method: 'GET', type: 'page' }, ctx));
    app.get('/standalone', createPageHandler({ file: standaloneNjk, path: '/standalone', method: 'GET', type: 'page' }, ctx));

    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;

    try {
      const requests = [];
      for (let i = 0; i < 80; i++) {
        const mod = i % 3;
        if (mod === 0) {
          requests.push(httpGet(port, `/page-js/${i}`).then((r) => ({ mod, i, r })));
        } else if (mod === 1) {
          requests.push(httpGet(port, `/page-njk/${i}`).then((r) => ({ mod, i, r })));
        } else {
          requests.push(httpGet(port, '/standalone').then((r) => ({ mod, i, r })));
        }
      }

      const responses = await Promise.all(requests);
      for (const item of responses) {
        expect(item.r.status).toBe(200);
        if (item.mod === 0) {
          expect(item.r.body).toContain(`JS:${item.i}`);
        } else if (item.mod === 1) {
          expect(item.r.body).toContain(`NJK:${item.i}`);
        } else {
          expect(item.r.body).toContain('STATIC_OK');
        }
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('2. hot-reloads mutated definePage modules across 12 consecutive requests in dev mode', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-pages-hot-'));
    tempDirs.push(tmpDir);

    const definePagePath = JSON.stringify(path.resolve(__dirname, '../../../src/pages/define-page'));
    const hotFile = path.join(tmpDir, 'hot.js');

    const app = express();
    app.get(
      '/hot',
      createPageHandler(
        { file: hotFile, path: '/hot', method: 'GET', type: 'page' },
        { middlewares: {}, isDev: true }
      )
    );

    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;

    try {
      for (let v = 1; v <= 12; v++) {
        fs.writeFileSync(
          hotFile,
          `const { definePage } = require(${definePagePath});
module.exports = definePage({
  load: async () => ({ version: ${v} }),
  render: (data) => 'ver:' + data.version,
});
`
        );
        const res = await httpGet(port, '/hot');
        expect(res.status).toBe(200);
        expect(res.body).toBe(`ver:${v}`);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('3. enforces module-level middleware precedence, early-return short-circuit, and error enrichment', async () => {
    const globalAuth = (req, _res, next) => { req.authSource = 'global'; next(); };
    const moduleAuth = (req, _res, next) => { req.authSource = 'module'; next(); };

    const resolved = resolveMiddlewaresWithModule(['auth'], { auth: globalAuth }, { auth: moduleAuth });
    const fakeReq = {};
    resolved[0](fakeReq, {}, () => {});
    expect(fakeReq.authSource).toBe('module');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-pages-err-'));
    tempDirs.push(tmpDir);

    const definePagePath = JSON.stringify(path.resolve(__dirname, '../../../src/pages/define-page'));
    const guardedFile = path.join(tmpDir, 'guarded.js');
    fs.writeFileSync(
      guardedFile,
      `const { definePage } = require(${definePagePath});
module.exports = definePage({
  middleware: ['blockIfFlag'],
  load: async (ctx) => {
    if (ctx.query.fail === '1') {
      throw new Error('loader-exploded');
    }
    return { ok: true };
  },
  render: () => 'ALLOWED',
});
`
    );

    const app = express();
    app.get(
      '/guarded',
      createPageHandler(
        { file: guardedFile, path: '/guarded', method: 'GET', type: 'page', source: 'pages/guarded.js' },
        {
          isDev: false,
          middlewares: {
            blockIfFlag: (req, res, next) => {
              if (req.query.block === '1') {
                return res.status(403).send('BLOCKED_BY_MW');
              }
              return next();
            },
          },
        }
      )
    );
    app.use((err, _req, res, _next) => {
      res.status(500).json({ message: err.message, hasRouteMeta: Boolean(err.route || err.path || err.source) });
    });

    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;

    try {
      const [allowed, blocked, failed] = await Promise.all([
        httpGet(port, '/guarded'),
        httpGet(port, '/guarded?block=1'),
        httpGet(port, '/guarded?fail=1'),
      ]);

      expect(allowed.status).toBe(200);
      expect(allowed.body).toBe('ALLOWED');
      expect(blocked.status).toBe(403);
      expect(blocked.body).toBe('BLOCKED_BY_MW');
      expect(failed.status).toBe(500);
      expect(JSON.parse(failed.body).message).toBe('loader-exploded');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('4. forwards syntax/require failures in broken page modules cleanly to Express error handler', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-pages-broken-'));
    tempDirs.push(tmpDir);

    const brokenFile = path.join(tmpDir, 'broken.js');
    fs.writeFileSync(brokenFile, `throw new Error('module-boot-crash');`);

    const app = express();
    app.get(
      '/broken',
      createPageHandler({ file: brokenFile, path: '/broken', method: 'GET', type: 'page' }, { isDev: false })
    );
    app.use((err, _req, res, _next) => {
      res.status(500).send(err.message);
    });

    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;

    try {
      const res = await httpGet(port, '/broken');
      expect(res.status).toBe(500);
      expect(res.body).toBe('module-boot-crash');
      expect(definePage(() => ({ ok: true })).__isWebspressoPage).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});


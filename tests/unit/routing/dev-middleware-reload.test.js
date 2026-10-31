const fs = require('fs');
const path = require('path');
const os = require('os');
const request = require('supertest');
const { createApp } = require('../../../src/server');

describe('Dev Mode Middleware Reload (src/file-router.js)', () => {
  let tempPagesDir;
  let tempViewsDir;
  let app;

  beforeEach(() => {
    tempPagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-dev-mw-pages-'));
    tempViewsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-dev-mw-views-'));
    fs.mkdirSync(path.join(tempPagesDir, 'api'), { recursive: true });
    // Routes are discovered at startup, so version 1 of the route must exist before createApp()
    fs.writeFileSync(
      path.join(tempPagesDir, 'api', 'test.get.js'),
      `module.exports = {
        middleware: ['mw1'],
        handler: (req, res) => res.json({ mw: req.appliedMw || [] }),
      };`
    );

    const mw1 = (req, res, next) => {
      req.appliedMw = req.appliedMw || [];
      req.appliedMw.push('mw1');
      next();
    };

    const mw2 = (req, res, next) => {
      req.appliedMw = req.appliedMw || [];
      req.appliedMw.push('mw2');
      next();
    };

    const result = createApp({
      pagesDir: tempPagesDir,
      viewsDir: tempViewsDir,
      isDev: true,
      cache: false,
      logging: false,
      middlewares: {
        mw1,
        mw2,
      },
    });
    app = result.app;
  });

  afterEach(() => {
    try {
      fs.rmSync(tempPagesDir, { recursive: true, force: true });
      fs.rmSync(tempViewsDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('should re-resolve route middleware when file is updated in dev mode', async () => {
    const routeFile = path.join(tempPagesDir, 'api', 'test.get.js');

    // Version 1: only mw1
    fs.writeFileSync(
      routeFile,
      `module.exports = {
        middleware: ['mw1'],
        handler: (req, res) => res.json({ mw: req.appliedMw || [] }),
      };`
    );

    const res1 = await request(app).get('/api/test');
    expect(res1.status).toBe(200);
    expect(res1.body.mw).toEqual(['mw1']);

    // Ensure mtime changes on disk
    const futureTime = (Date.now() + 2000) / 1000;
    fs.writeFileSync(
      routeFile,
      `module.exports = {
        middleware: ['mw1', 'mw2'],
        handler: (req, res) => res.json({ mw: req.appliedMw || [] }),
      };`
    );
    fs.utimesSync(routeFile, futureTime, futureTime);

    // Version 2: should pick up mw1 AND mw2 without server restart
    const res2 = await request(app).get('/api/test');
    expect(res2.status).toBe(200);
    expect(res2.body.mw).toEqual(['mw1', 'mw2']);
  });
});

'use strict';

/**
 * Webspresso Static Site Exporter & Prerendering Engine
 * Prerenders SSR pages into static HTML files for zero-cost hosting on Cloudflare Pages, S3, etc.
 * @module core/export/exporter
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { discoverExportRoutes } = require('./discovery');

/**
 * Copies directory contents recursively
 * @param {string} src
 * @param {string} dest
 */
function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Determines output file path for a URL
 * @param {string} urlPath
 * @param {string} outDir
 * @param {boolean} [cleanUrls=true]
 * @returns {string}
 */
function urlToFilePath(urlPath, outDir, cleanUrls = true) {
  const cleanPath = urlPath.replace(/[?#].*$/, '');

  if (cleanPath === '/' || cleanPath === '') {
    return path.join(outDir, 'index.html');
  }

  // Standalone 404 handler
  if (cleanPath === '/404' || cleanPath === '/404.html') {
    return path.join(outDir, '404.html');
  }

  // Strip leading slash
  const rel = cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath;

  if (cleanUrls) {
    return path.join(outDir, rel, 'index.html');
  }

  if (rel.endsWith('.html')) {
    return path.join(outDir, rel);
  }

  return path.join(outDir, `${rel}.html`);
}

/**
 * Generates sitemap.xml content for prerendered routes
 * @param {Array<string>} urls
 * @param {string} baseUrl
 * @returns {string}
 */
function generateSitemapXml(urls, baseUrl) {
  const base = baseUrl.replace(/\/+$/, '');
  const items = urls
    .filter((u) => u !== '/404')
    .map((url) => {
      const loc = `${base}${url === '/' ? '/' : url}`;
      return `  <url>\n    <loc>${loc}</loc>\n    <changefreq>daily</changefreq>\n  </url>`;
    });

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join('\n')}\n</urlset>\n`;
}

/**
 * Prerenders Webspresso application into static site files
 * @param {Object} options
 * @param {string} [options.cwd=process.cwd()] - Current working directory
 * @param {import('express').Express} [options.app] - Existing Express application instance
 * @param {Function} [options.createApp] - createApp factory function
 * @param {Object} [options.serverConfig={}] - Configuration passed to createApp if app not provided
 * @param {string} [options.pagesDir] - Pages directory (default: 'pages' in cwd)
 * @param {string} [options.publicDir] - Public static assets directory (default: 'public' in cwd)
 * @param {string} [options.outDir='dist'] - Output directory
 * @param {boolean} [options.clean=true] - Clean outDir before export
 * @param {boolean} [options.cleanUrls=true] - Generate /path/index.html instead of /path.html
 * @param {boolean} [options.copyAssets=true] - Copy public/ assets to outDir
 * @param {boolean} [options.sitemap=false] - Generate sitemap.xml
 * @param {string} [options.baseUrl=''] - Base URL for sitemap.xml
 * @param {number} [options.concurrency=5] - Parallel render requests
 * @param {Array<string>} [options.extraRoutes=[]] - Additional routes to render
 * @param {boolean} [options.silent=false] - Suppress log output
 * @param {Object} [options.db] - Database instance for static param generators
 * @returns {Promise<{ total: number, rendered: number, skipped: number, errors: Array<any>, outDir: string, durationMs: number }>}
 */
async function exportStaticSite(options = {}) {
  const startTime = Date.now();
  const cwd = path.resolve(options.cwd || process.cwd());
  const outDir = path.resolve(cwd, options.outDir || 'dist');
  const pagesDir = path.resolve(cwd, options.pagesDir || 'pages');
  const publicDir = path.resolve(cwd, options.publicDir || 'public');
  const clean = options.clean !== false;
  const cleanUrls = options.cleanUrls !== false;
  const copyAssets = options.copyAssets !== false;
  const sitemap = options.sitemap || Boolean(options.baseUrl);
  const baseUrl = options.baseUrl || 'https://example.com';
  const concurrency = Math.max(1, parseInt(options.concurrency, 10) || 5);
  const silent = options.silent === true;
  const extraRoutes = options.extraRoutes || [];

  const log = silent ? () => {} : console.log.bind(console);
  const logError = silent ? () => {} : console.error.bind(console);

  log(`\n🚀 Exporting static site to "${path.relative(cwd, outDir)}"...`);

  // 1. Prepare target directory
  if (clean && fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  // 2. Discover routes
  const discoveredRoutes = await discoverExportRoutes({
    pagesDir,
    db: options.db,
    extraRoutes,
  });

  if (discoveredRoutes.length === 0) {
    log('⚠️  No static renderable page routes discovered.');
    return {
      total: 0,
      rendered: 0,
      skipped: 0,
      errors: [],
      outDir,
      durationMs: Date.now() - startTime,
    };
  }

  log(`📄 Discovered ${discoveredRoutes.length} route(s) to prerender.`);

  // 3. Resolve or initialize Express Application
  let appInstance = options.app;
  let serverInstance = null;
  let appClose = null;

  if (!appInstance) {
    const createAppFn = options.createApp || require('../../src/server').createApp;
    const config = Object.assign(
      {
        cwd,
        pagesDir,
        publicDir,
        server: { silent: true },
      },
      options.serverConfig || {}
    );
    const created = createAppFn(config);
    appInstance = created.app || created;
    if (created.db && !options.db) {
      options.db = created.db;
    }
  }

  // 4. Start ephemeral HTTP listener
  serverInstance = http.createServer(appInstance);
  await new Promise((resolve, reject) => {
    serverInstance.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  const { port } = serverInstance.address();
  const hostUrl = `http://127.0.0.1:${port}`;

  const renderedUrls = [];
  const errors = [];
  let renderedCount = 0;

  try {
    // 5. Render routes with concurrency pool
    const queue = [...discoveredRoutes];
    const worker = async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;

        const targetUrl = `${hostUrl}${item.path}`;
        const destFile = urlToFilePath(item.path, outDir, cleanUrls);

        try {
          const res = await fetch(targetUrl, {
            headers: {
              'User-Agent': 'Webspresso-Static-Exporter',
              'Accept': 'text/html,application/xhtml+xml,application/xml,application/json,*/*',
            },
          });

          if (res.status >= 400 && !item.isNotFound && item.path !== '/404') {
            const errBody = await res.text();
            throw new Error(`HTTP ${res.status}: Failed to render "${item.path}". Response: ${errBody.slice(0, 100)}`);
          }

          const body = await res.text();
          fs.mkdirSync(path.dirname(destFile), { recursive: true });
          fs.writeFileSync(destFile, body, 'utf8');

          renderedUrls.push(item.path);
          renderedCount++;
          log(`  ✓ Prerendered: ${item.path} -> ${path.relative(outDir, destFile)}`);
        } catch (err) {
          logError(`  ❌ Error prerendering ${item.path}:`, err.message);
          errors.push({ path: item.path, error: err.message });
        }
      }
    };

    const workers = [];
    for (let i = 0; i < concurrency; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    // 6. Copy public assets if requested
    if (copyAssets && fs.existsSync(publicDir)) {
      log('📦 Copying public assets...');
      copyDirRecursive(publicDir, outDir);
      log(`  ✓ Assets copied from ${path.relative(cwd, publicDir)}/`);
    }

    // 7. Generate sitemap.xml if requested
    if (sitemap && renderedUrls.length > 0) {
      const sitemapPath = path.join(outDir, 'sitemap.xml');
      const xml = generateSitemapXml(renderedUrls, baseUrl);
      fs.writeFileSync(sitemapPath, xml, 'utf8');
      log(`  ✓ Generated: sitemap.xml (${renderedUrls.length} URLs)`);
    }
  } finally {
    // Graceful close of ephemeral server
    await new Promise((resolve) => {
      serverInstance.close(resolve);
    });
  }

  const durationMs = Date.now() - startTime;
  log(`\n✨ Static export complete in ${durationMs}ms: ${renderedCount}/${discoveredRoutes.length} pages rendered.\n`);

  return {
    total: discoveredRoutes.length,
    rendered: renderedCount,
    skipped: discoveredRoutes.length - renderedCount - errors.length,
    errors,
    outDir,
    durationMs,
  };
}

module.exports = {
  copyDirRecursive,
  urlToFilePath,
  generateSitemapXml,
  exportStaticSite,
};

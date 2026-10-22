import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import request from 'supertest';

import {
  filePathToRoute,
  isRouteGroupSegment,
  stripRouteGroups,
  AssetManager,
} from '../../../index';
import { parseFileRoute } from '../../../src/discovery/file-route-parser';
import { createApp } from '../../../src/server';

describe('Route Groups `(group)` Syntax', () => {
  describe('Helper Utilities', () => {
    it('isRouteGroupSegment identifies valid route groups', () => {
      expect(isRouteGroupSegment('(marketing)')).toBe(true);
      expect(isRouteGroupSegment('(auth)')).toBe(true);
      expect(isRouteGroupSegment('(admin-v2)')).toBe(true);
      expect(isRouteGroupSegment('(shop_123)')).toBe(true);
      expect(isRouteGroupSegment('(a)')).toBe(true);

      // Invalid route groups
      expect(isRouteGroupSegment('()')).toBe(false);
      expect(isRouteGroupSegment('(marketing')).toBe(false);
      expect(isRouteGroupSegment('marketing)')).toBe(false);
      expect(isRouteGroupSegment('marketing')).toBe(false);
      expect(isRouteGroupSegment('[id]')).toBe(false);
      expect(isRouteGroupSegment('[...slug]')).toBe(false);
      expect(isRouteGroupSegment('')).toBe(false);
      expect(isRouteGroupSegment(null)).toBe(false);
      expect(isRouteGroupSegment(undefined)).toBe(false);
      expect(isRouteGroupSegment(123)).toBe(false);
    });

    it('stripRouteGroups removes route group segments from paths', () => {
      expect(stripRouteGroups('(marketing)/about')).toBe('about');
      expect(stripRouteGroups('/(marketing)/about')).toBe('/about');
      expect(stripRouteGroups('/(auth)/login')).toBe('/login');
      expect(stripRouteGroups('/(shop)/(checkout)/cart')).toBe('/cart');
      expect(stripRouteGroups('api/(v1)/users')).toBe('api/users');
      expect(stripRouteGroups('/api/(v1)/users')).toBe('/api/users');
      expect(stripRouteGroups('(marketing)/index')).toBe('index');
      expect(stripRouteGroups('(marketing)')).toBe('');
      expect(stripRouteGroups('/(marketing)')).toBe('/');
      expect(stripRouteGroups('normal/path/without/groups')).toBe('normal/path/without/groups');
    });

    it('filePathToRoute converts route group file paths to clean public URL patterns', () => {
      expect(filePathToRoute('(marketing)/about.njk', '.njk')).toBe('/about');
      expect(filePathToRoute('(marketing)/index.njk', '.njk')).toBe('/');
      expect(filePathToRoute('(auth)/login.njk', '.njk')).toBe('/login');
      expect(filePathToRoute('(auth)/register.njk', '.njk')).toBe('/register');
      expect(filePathToRoute('(shop)/(checkout)/cart.njk', '.njk')).toBe('/cart');
      expect(filePathToRoute('(app)/dashboard/index.njk', '.njk')).toBe('/dashboard');
      expect(filePathToRoute('(app)/users/[id].njk', '.njk')).toBe('/users/:id');
      expect(filePathToRoute('(docs)/guide/[...slug].njk', '.njk')).toBe('/guide/*slug');
      expect(filePathToRoute('(marketing)/products/[category]/[id].njk', '.njk')).toBe('/products/:category/:id');
      expect(filePathToRoute('tools/(category)/[slug].njk', '.njk')).toBe('/tools/:slug');
      expect(filePathToRoute('(marketing)', '')).toBe('/');

      // Standard non-grouped paths remain fully intact
      expect(filePathToRoute('index.njk', '.njk')).toBe('/');
      expect(filePathToRoute('about.njk', '.njk')).toBe('/about');
      expect(filePathToRoute('about/index.njk', '.njk')).toBe('/about');
      expect(filePathToRoute('users/[id].njk', '.njk')).toBe('/users/:id');
    });

    it('parseFileRoute in discovery strips route groups', () => {
      expect(parseFileRoute('(marketing)/about.njk')).toMatchObject({
        path: '/about',
        method: 'GET',
        isValid: true,
      });

      expect(parseFileRoute('(marketing)/index.njk')).toMatchObject({
        path: '/',
        method: 'GET',
        isValid: true,
      });

      expect(parseFileRoute('(auth)/login.post.js')).toMatchObject({
        path: '/login',
        method: 'POST',
        isValid: true,
      });

      expect(parseFileRoute('(shop)/(checkout)/cart.get.js')).toMatchObject({
        path: '/cart',
        method: 'GET',
        isValid: true,
      });

      expect(parseFileRoute('(v1)/users/[id].get.js')).toMatchObject({
        path: '/users/:id',
        method: 'GET',
        isValid: true,
      });
    });

    it('AssetManager.getRouteAssetCandidates generates both group and clean asset names', () => {
      const am = new AssetManager();
      const candidates = am.getRouteAssetCandidates('(marketing)/about.njk', '/about');
      expect(candidates).toContain('(marketing)/about');
      expect(candidates).toContain('about');
    });
  });

  describe('Full-Stack HTTP Integration with Route Groups', () => {
    let tmpDir;
    let app;

    beforeAll(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-route-groups-'));
      const pagesDir = path.join(tmpDir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });

      // 1. Root layout and middleware
      fs.writeFileSync(
        path.join(pagesDir, '_layout.njk'),
        '<!DOCTYPE html><html><body><div id="root-layout">{{ content | safe }}</div></body></html>'
      );
      fs.writeFileSync(
        path.join(pagesDir, '_middleware.js'),
        'module.exports = (req, res, next) => { res.setHeader("X-Global", "ok"); next(); };'
      );

      // 2. (marketing) route group: layout, middleware, and pages
      const marketingDir = path.join(pagesDir, '(marketing)');
      fs.mkdirSync(marketingDir, { recursive: true });
      fs.writeFileSync(
        path.join(marketingDir, '_layout.njk'),
        '<header class="marketing-nav">Marketing Header</header><main class="marketing-main">{{ content | safe }}</main>'
      );
      fs.writeFileSync(
        path.join(marketingDir, '_middleware.js'),
        'module.exports = (req, res, next) => { res.setHeader("X-Group", "marketing"); next(); };'
      );
      fs.writeFileSync(
        path.join(marketingDir, 'index.njk'),
        '<h1>Marketing Home</h1><p>{{ welcomeMessage }}</p>'
      );
      fs.writeFileSync(
        path.join(marketingDir, 'index.js'),
        'module.exports = { load: async () => ({ welcomeMessage: "Hello World" }) };'
      );
      fs.writeFileSync(
        path.join(marketingDir, 'about.njk'),
        '<h1>About Marketing</h1>'
      );

      // 3. (auth) route group: layout, middleware, and pages
      const authDir = path.join(pagesDir, '(auth)');
      fs.mkdirSync(authDir, { recursive: true });
      fs.writeFileSync(
        path.join(authDir, '_layout.njk'),
        '<div class="auth-card">{{ content | safe }}</div>'
      );
      fs.writeFileSync(
        path.join(authDir, '_middleware.js'),
        'module.exports = (req, res, next) => { res.setHeader("X-Group", "auth"); next(); };'
      );
      fs.writeFileSync(
        path.join(authDir, 'login.njk'),
        '<h1>Login Screen</h1>'
      );
      fs.writeFileSync(
        path.join(authDir, 'register.njk'),
        '<h1>Register Screen</h1>'
      );

      // 4. Nested route group: (shop)/(checkout)/cart.njk
      const shopDir = path.join(pagesDir, '(shop)', '(checkout)');
      fs.mkdirSync(shopDir, { recursive: true });
      fs.writeFileSync(
        path.join(shopDir, 'cart.njk'),
        '<h1>Shopping Cart</h1>'
      );

      // 5. Dynamic route inside route group: (app)/users/[id].njk
      const appDir = path.join(pagesDir, '(app)', 'users');
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(
        path.join(appDir, '[id].njk'),
        '<h1>User Profile {{ userId }}</h1>'
      );
      fs.writeFileSync(
        path.join(appDir, '[id].js'),
        'module.exports = { load: async (req) => ({ userId: req.params.id }) };'
      );

      // 6. API route inside versioned group: pages/api/(v1)/items.get.js
      const apiV1Dir = path.join(pagesDir, 'api', '(v1)');
      fs.mkdirSync(apiV1Dir, { recursive: true });
      fs.writeFileSync(
        path.join(apiV1Dir, 'items.get.js'),
        'module.exports = { handler: async (req, res) => res.json({ items: ["pen", "notebook"] }) };'
      );

      // 7. API route inside group prefix: pages/(marketing)/api/newsletter.post.js
      const marketingApiDir = path.join(pagesDir, '(marketing)', 'api');
      fs.mkdirSync(marketingApiDir, { recursive: true });
      fs.writeFileSync(
        path.join(marketingApiDir, 'newsletter.post.js'),
        'module.exports = { handler: async (req, res) => res.status(201).json({ status: "subscribed" }) };'
      );

      const serverInstance = createApp({
        pagesDir: path.join(tmpDir, 'pages'),
        silent: true,
        server: { port: 0, shutdown: { enabled: false } },
        helmet: false,
        compression: false,
        cache: false,
        healthCheck: false,
        metrics: false,
        lazyRoutes: true,
      });
      app = serverInstance.app;
    });

    afterAll(() => {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('serves route group home page at / with marketing layout and middleware', async () => {

      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['x-global']).toBe('ok');
      expect(res.headers['x-group']).toBe('marketing');
      expect(res.text).toContain('<div id="root-layout">');
      expect(res.text).toContain('<header class="marketing-nav">Marketing Header</header>');
      expect(res.text).toContain('<h1>Marketing Home</h1>');
      expect(res.text).toContain('<p>Hello World</p>');
      expect(res.text).not.toContain('auth-card');
    });

    it('serves (marketing)/about.njk at clean URL /about with marketing layout', async () => {
      const res = await request(app).get('/about');
      expect(res.status).toBe(200);
      expect(res.headers['x-global']).toBe('ok');
      expect(res.headers['x-group']).toBe('marketing');
      expect(res.text).toContain('<div id="root-layout">');
      expect(res.text).toContain('<main class="marketing-main"><h1>About Marketing</h1></main>');
      expect(res.text).not.toContain('auth-card');
    });

    it('serves (auth)/login.njk at clean URL /login with auth layout and middleware, isolated from marketing', async () => {
      const res = await request(app).get('/login');
      expect(res.status).toBe(200);
      expect(res.headers['x-global']).toBe('ok');
      expect(res.headers['x-group']).toBe('auth');
      expect(res.text).toContain('<div id="root-layout">');
      expect(res.text).toContain('<div class="auth-card"><h1>Login Screen</h1></div>');
      expect(res.text).not.toContain('marketing-nav');
    });

    it('serves nested route groups (shop)/(checkout)/cart.njk at /cart', async () => {
      const res = await request(app).get('/cart');
      expect(res.status).toBe(200);
      expect(res.headers['x-global']).toBe('ok');
      expect(res.text).toContain('<div id="root-layout">');
      expect(res.text).toContain('<h1>Shopping Cart</h1>');
    });

    it('serves dynamic routes inside route groups (app)/users/[id].njk at /users/:id', async () => {
      const res = await request(app).get('/users/42');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<h1>User Profile 42</h1>');
    });

    it('serves API routes with route group segments: /api/items from api/(v1)/items.get.js', async () => {
      const res = await request(app).get('/api/items');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: ['pen', 'notebook'] });
    });

    it('serves API routes within parent route groups: /api/newsletter from (marketing)/api/newsletter.post.js', async () => {
      const res = await request(app).post('/api/newsletter');
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ status: 'subscribed' });
    });
  });
});

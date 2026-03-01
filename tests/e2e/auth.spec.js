/**
 * Auth System E2E Tests
 */

const { test, expect } = require('@playwright/test');
const express = require('express');
const { createApp } = require('../../src/server');
const { createAuth, hash, verify, createRememberTokensTable } = require('../../core/auth');
const { createDatabase, defineModel, clearRegistry, zdb } = require('../../core/orm');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Test server setup
let server;
let db;
let baseURL;
const PORT = 3099;

test.describe('Auth E2E Tests', () => {
  test.beforeAll(async () => {
    // Create temp directory for test files
    const tempDir = path.join(os.tmpdir(), 'webspresso-auth-e2e');
    const pagesDir = path.join(tempDir, 'pages');
    const viewsDir = path.join(tempDir, 'views');

    // Clean and create directories
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(pagesDir, { recursive: true });
    fs.mkdirSync(viewsDir, { recursive: true });

    // Create in-memory database
    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      models: path.join(tempDir, 'models'),
    });

    // Create tables
    await db.knex.schema.createTable('users', (table) => {
      table.bigIncrements('id').primary();
      table.string('email', 255).unique().notNullable();
      table.string('password', 255).notNullable();
      table.string('name', 255);
      table.string('role').defaultTo('user');
      table.timestamp('created_at');
      table.timestamp('updated_at');
    });

    await createRememberTokensTable(db.knex);

    // Define User model
    clearRegistry();
    defineModel({
      name: 'User',
      table: 'users',
      schema: zdb.schema({
        id: zdb.id(),
        email: zdb.string({ maxLength: 255 }),
        password: zdb.string({ maxLength: 255 }),
        name: zdb.string({ maxLength: 255, nullable: true }),
        role: zdb.string({ default: 'user' }),
        created_at: zdb.timestamp({ auto: 'create' }),
        updated_at: zdb.timestamp({ auto: 'update' }),
      }),
      scopes: { timestamps: true },
    });

    // Don't overwrite - getRepository will use model from defineModel via getModel()
    const UserRepo = db.getRepository('User');

    // Create test user
    const hashedPassword = await hash('testpassword123');
    await UserRepo.create({
      email: 'e2e@test.com',
      password: hashedPassword,
      name: 'E2E Test User',
      role: 'user',
    });

    // Create auth instance
    const auth = createAuth({
      findUserById: async (id) => await UserRepo.findById(id),
      findUserByCredentials: async (email, password) => {
        const user = await UserRepo.findOne({ email });
        if (user && await verify(password, user.password)) {
          return user;
        }
        return null;
      },
      rememberTokens: {
        create: async (userId, token, expiresAt) => {
          await db.knex('remember_tokens').insert({
            user_id: userId,
            token,
            expires_at: expiresAt,
            created_at: new Date(),
          });
        },
        find: async (token) => {
          return await db.knex('remember_tokens').where({ token }).first();
        },
        delete: async (token) => {
          await db.knex('remember_tokens').where({ token }).delete();
        },
        deleteAllForUser: async (userId) => {
          await db.knex('remember_tokens').where({ user_id: userId }).delete();
        },
      },
      session: {
        secret: 'e2e-test-secret-key-12345',
        resave: false,
        saveUninitialized: false,
      },
      routes: {
        login: '/login',
        redirectAfterLogin: '/dashboard',
      },
    });

    // Create layout template
    fs.writeFileSync(path.join(viewsDir, 'layout.njk'), `
<!DOCTYPE html>
<html>
<head>
  <title>{{ title or 'Auth Test' }}</title>
</head>
<body>
  {% block content %}{% endblock %}
</body>
</html>
    `);

    // Create login page
    fs.writeFileSync(path.join(pagesDir, 'login.njk'), `
{% extends "layout.njk" %}
{% block content %}
<h1>Login</h1>
{% if error %}
<div class="error" data-testid="error">{{ error }}</div>
{% endif %}
<form method="POST" action="/login">
  <input type="email" name="email" placeholder="Email" data-testid="email" />
  <input type="password" name="password" placeholder="Password" data-testid="password" />
  <label>
    <input type="checkbox" name="remember" value="on" data-testid="remember" />
    Remember me
  </label>
  <button type="submit" data-testid="submit">Login</button>
</form>
<p><a href="/">Home</a></p>
{% endblock %}
    `);

    // Create dashboard page
    fs.writeFileSync(path.join(pagesDir, 'dashboard.njk'), `
{% extends "layout.njk" %}
{% block content %}
<h1 data-testid="welcome">Welcome, {{ user.name }}</h1>
<p data-testid="email">{{ user.email }}</p>
<form method="POST" action="/logout">
  <button type="submit" data-testid="logout">Logout</button>
</form>
{% endblock %}
    `);

    // Create home page
    fs.writeFileSync(path.join(pagesDir, 'index.njk'), `
{% extends "layout.njk" %}
{% block content %}
<h1>Home</h1>
{% if user %}
<p data-testid="status">Logged in as {{ user.email }}</p>
<a href="/dashboard">Dashboard</a>
{% else %}
<p data-testid="status">Not logged in</p>
<a href="/login" data-testid="login-link">Login</a>
{% endif %}
{% endblock %}
    `);

    // Create app with routes
    const { app, authMiddleware } = createApp({
      pagesDir,
      viewsDir,
      auth,
    });

    // Login route
    app.get('/login', authMiddleware.requireGuest(), (req, res) => {
      res.render('login.njk', { title: 'Login' });
    });

    app.post('/login', async (req, res) => {
      const { email, password, remember } = req.body;
      const user = await req.auth.attempt(email, password, { remember: remember === 'on' });
      
      if (user) {
        return res.redirect('/dashboard');
      }
      
      res.render('login.njk', { title: 'Login', error: 'Invalid credentials' });
    });

    // Dashboard route (protected)
    app.get('/dashboard', authMiddleware.requireAuth(), (req, res) => {
      res.render('dashboard.njk', { title: 'Dashboard', user: req.user });
    });

    // Logout route
    app.post('/logout', async (req, res) => {
      await req.auth.logout();
      res.redirect('/');
    });

    // Home route
    app.get('/', (req, res) => {
      res.render('index.njk', { title: 'Home', user: req.user });
    });

    // Start server
    server = app.listen(PORT);
    baseURL = `http://localhost:${PORT}`;
  });

  test.afterAll(async () => {
    if (server) {
      server.close();
    }
    if (db) {
      await db.destroy();
    }
  });

  test('should show login page for guests', async ({ page }) => {
    await page.goto(`${baseURL}/login`);
    
    await expect(page.locator('h1')).toHaveText('Login');
    await expect(page.locator('[data-testid="email"]')).toBeVisible();
    await expect(page.locator('[data-testid="password"]')).toBeVisible();
  });

  test('should redirect to login when accessing protected page as guest', async ({ page }) => {
    await page.goto(`${baseURL}/dashboard`);
    
    // Should be redirected to login
    await expect(page).toHaveURL(`${baseURL}/login`);
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto(`${baseURL}/login`);
    
    await page.fill('[data-testid="email"]', 'wrong@email.com');
    await page.fill('[data-testid="password"]', 'wrongpassword');
    await page.click('[data-testid="submit"]');
    
    await expect(page.locator('[data-testid="error"]')).toHaveText('Invalid credentials');
  });

  test('should login successfully with valid credentials', async ({ page }) => {
    await page.goto(`${baseURL}/login`);
    
    await page.fill('[data-testid="email"]', 'e2e@test.com');
    await page.fill('[data-testid="password"]', 'testpassword123');
    await page.click('[data-testid="submit"]');
    
    // Should redirect to dashboard
    await expect(page).toHaveURL(`${baseURL}/dashboard`);
    await expect(page.locator('[data-testid="welcome"]')).toContainText('Welcome, E2E Test User');
  });

  test('should maintain session after login', async ({ page }) => {
    await page.goto(`${baseURL}/login`);
    
    // Login
    await page.fill('[data-testid="email"]', 'e2e@test.com');
    await page.fill('[data-testid="password"]', 'testpassword123');
    await page.click('[data-testid="submit"]');
    
    // Wait for redirect
    await expect(page).toHaveURL(`${baseURL}/dashboard`);
    
    // Navigate to home
    await page.goto(`${baseURL}/`);
    
    // Should show logged in status
    await expect(page.locator('[data-testid="status"]')).toContainText('Logged in as e2e@test.com');
  });

  test('should logout successfully', async ({ page }) => {
    // First login
    await page.goto(`${baseURL}/login`);
    await page.fill('[data-testid="email"]', 'e2e@test.com');
    await page.fill('[data-testid="password"]', 'testpassword123');
    await page.click('[data-testid="submit"]');
    
    await expect(page).toHaveURL(`${baseURL}/dashboard`);
    
    // Logout
    await page.click('[data-testid="logout"]');
    
    // Should redirect to home
    await expect(page).toHaveURL(`${baseURL}/`);
    
    // Should show not logged in
    await expect(page.locator('[data-testid="status"]')).toContainText('Not logged in');
  });

  test('should redirect authenticated users away from login page', async ({ page }) => {
    // Login first
    await page.goto(`${baseURL}/login`);
    await page.fill('[data-testid="email"]', 'e2e@test.com');
    await page.fill('[data-testid="password"]', 'testpassword123');
    await page.click('[data-testid="submit"]');
    
    await expect(page).toHaveURL(`${baseURL}/dashboard`);
    
    // Try to access login page
    await page.goto(`${baseURL}/login`);
    
    // Should be redirected to dashboard (guest route)
    await expect(page).toHaveURL(`${baseURL}/dashboard`);
  });

  test('should handle remember me checkbox', async ({ page }) => {
    await page.goto(`${baseURL}/login`);
    
    await page.fill('[data-testid="email"]', 'e2e@test.com');
    await page.fill('[data-testid="password"]', 'testpassword123');
    await page.check('[data-testid="remember"]');
    await page.click('[data-testid="submit"]');
    
    await expect(page).toHaveURL(`${baseURL}/dashboard`);
    
    // Check that remember_token cookie is set
    const cookies = await page.context().cookies();
    const rememberCookie = cookies.find(c => c.name === 'remember_token');
    expect(rememberCookie).toBeDefined();
  });
});

/**
 * End-to-End Integration Tests for Webspresso Security Shield Plugin
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import { createApp } from '../../src/server.js';
import { createDatabase } from '../../index.js';
import { adminPanelPlugin, securityPlugin } from '../../plugins/index.js';

describe.sequential('Security Shield Fullstack Integration', () => {
  let app;
  let db;
  let sharedCookie;

  beforeAll(async () => {
    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
      models: './tests/fixtures/models-empty',
    });

    await db.knex.schema.createTable('admin_users', (table) => {
      table.bigIncrements('id');
      table.string('email').unique();
      table.string('password');
      table.string('name');
      table.string('role').defaultTo('admin');
      table.boolean('active').defaultTo(true);
      table.timestamp('created_at');
      table.timestamp('updated_at');
    });

    const emptyPagesDir = path.join(__dirname, '../fixtures/empty-pages');

    const result = createApp({
      pagesDir: emptyPagesDir,
      viewsDir: './tests/fixtures/views',
      plugins: [
        adminPanelPlugin({ db }),
        securityPlugin({
          headers: {
            frameGuard: 'SAMEORIGIN',
            noSniff: true,
            hsts: false,
          },
          firewall: {
            whitelist: ['10.99.99.1'],
            autoBan: {
              enabled: true,
              threshold: 10,
              window: '1m',
              duration: '1h',
            },
          },
          honeypot: {
            honeypots: ['/.env', '/wp-admin'],
            detectTraversal: true,
            blockBadBots: true,
          },
          bruteForce: {
            routes: ['/_admin/api/auth/login'],
            maxAttempts: 3,
            lockout: '5m',
          },
          adminPanel: true,
        }),
      ],
    });

    app = result.app;

    // Seed admin staff user with pre-hashed password ('password123')
    await db.knex('admin_users').insert({
      email: 'admin@example.com',
      password: '$2b$04$Wuy3PNKivlnz5etS8gSaoeMqE7OUaMbnKcBRjSD0AxL.Qrd5hTAAK',
      name: 'Security Admin',
      role: 'admin',
      active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Authenticate admin staff
    const loginRes = await request(app)
      .post('/_admin/api/auth/login')
      .send({
        email: 'admin@example.com',
        password: 'password123',
      });

    expect(loginRes.status).toBe(200);
    sharedCookie = loginRes.headers['set-cookie'];
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('injects security headers and strips X-Powered-By on public routes', async () => {
    const res = await request(app).get('/_admin/login');
    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('traps honeypot access and returns stealth 404', async () => {
    const res = await request(app).get('/.env');
    expect(res.status).toBe(404);
  });

  it('blocks path traversal payloads with 403 Forbidden', async () => {
    const res = await request(app).get('/_admin/login?view=../../etc/passwd');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('provides security statistics through the Admin REST API', async () => {
    const res = await request(app)
      .get('/_admin/api/security/stats')
      .set('Cookie', sharedCookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.securityGrade).toBeDefined();
    expect(typeof res.body.activeBans).toBe('number');
  });

  it('runs automated security posture audit via Admin API', async () => {
    const res = await request(app)
      .get('/_admin/api/security/audit')
      .set('Cookie', sharedCookie);

    expect(res.status).toBe(200);
    expect(res.body.score).toBeGreaterThan(0);
    expect(Array.isArray(res.body.checks)).toBe(true);
    expect(res.body.checks.some(c => c.id === 'nosniff' && c.passed)).toBe(true);
  });

  it('allows staff to ban and unban an IP via Admin API', async () => {
    // 1. Ban IP
    const banRes = await request(app)
      .post('/_admin/api/security/ban')
      .set('Cookie', sharedCookie)
      .send({
        ip: '198.51.100.77',
        reason: 'Integration test abusive client',
        duration: '2h',
      });

    expect(banRes.status).toBe(201);
    expect(banRes.body.status).toBe('ok');
    expect(banRes.body.ban.ip).toBe('198.51.100.77');

    // 2. Query banned list
    const listRes = await request(app)
      .get('/_admin/api/security/banned')
      .set('Cookie', sharedCookie);

    expect(listRes.status).toBe(200);
    expect(listRes.body.items.some(i => i.ip === '198.51.100.77')).toBe(true);

    // 3. Unban IP
    const unbanRes = await request(app)
      .post('/_admin/api/security/unban')
      .set('Cookie', sharedCookie)
      .send({ ip: '198.51.100.77' });

    expect(unbanRes.status).toBe(200);
    expect(unbanRes.body.message).toContain('unbanned successfully');

    // 4. Confirm IP is unbanned
    const listAfter = await request(app)
      .get('/_admin/api/security/banned')
      .set('Cookie', sharedCookie);

    expect(listAfter.body.items.some(i => i.ip === '198.51.100.77')).toBe(false);
  });

  it('records incidents in the live threat feed', async () => {
    const incidentsRes = await request(app)
      .get('/_admin/api/security/incidents')
      .set('Cookie', sharedCookie);

    expect(incidentsRes.status).toBe(200);
    expect(Array.isArray(incidentsRes.body.items)).toBe(true);
    expect(incidentsRes.body.items.length).toBeGreaterThan(0);
  });
});

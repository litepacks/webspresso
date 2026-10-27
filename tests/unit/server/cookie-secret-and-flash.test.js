import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { createApp } from '../../../src/server';
import { createFlashMiddleware } from '../../../core/forms/flash';

describe('Cookie/Session Secret & Signed Flash Integration (Item #5)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('allows res.cookie({ signed: true }) and populates req.signedCookies via createApp({ secret })', async () => {
    const { app } = createApp({
      rootDir: process.cwd(),
      pages: 'tests/fixtures/pages-basic',
      secret: 'super-secure-cookie-secret-key-123',
    });

    app.get('/test-set-signed-cookie', (req, res) => {
      res.cookie('authToken', 'secret-session-token', { signed: true });
      res.json({ ok: true });
    });

    app.get('/test-read-signed-cookie', (req, res) => {
      res.json({
        signedVal: req.signedCookies?.authToken,
        unsignedVal: req.cookies?.authToken,
      });
    });

    const client = supertest(app);

    const setRes = await client.get('/test-set-signed-cookie').expect(200);
    const cookies = setRes.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toContain('authToken=s%3Asecret-session-token.');

    const readRes = await client
      .get('/test-read-signed-cookie')
      .set('Cookie', cookies)
      .expect(200);

    expect(readRes.body.signedVal).toBe('secret-session-token');
    expect(readRes.body.unsignedVal).toBeUndefined();
  });

  it('automatically signs and verifies cookie-based flash messages across redirects', async () => {
    const { app } = createApp({
      rootDir: process.cwd(),
      pages: 'tests/fixtures/pages-basic',
      secret: 'app-signing-secret-key-32-chars-long',
    });

    app.post('/test-flash-action', (req, res) => {
      res
        .withInput({ username: 'johndoe', password: 'must-be-redacted' })
        .withErrors({ email: 'Email is required' })
        .withFlash('status', 'Validation failed')
        .redirect('/test-flash-view');
    });

    app.get('/test-flash-view', (req, res) => {
      res.json({
        status: req.flash('status'),
        errors: req.flash('errors'),
        oldUsername: req.old('username'),
        oldPassword: req.old('password'),
      });
    });

    const client = supertest(app);

    const postRes = await client.post('/test-flash-action').expect(302);
    const cookies = postRes.headers['set-cookie'];
    expect(cookies).toBeDefined();
    // Cookie name is __ws_flash and signed with s: prefix
    expect(cookies[0]).toMatch(/__ws_flash=s%3A/);

    // Follow redirect with signed cookie
    const getRes = await client
      .get('/test-flash-view')
      .set('Cookie', cookies)
      .expect(200);

    expect(getRes.body.status).toBe('Validation failed');
    expect(getRes.body.errors.email).toEqual(['Email is required']);
    expect(getRes.body.oldUsername).toBe('johndoe');
    expect(getRes.body.oldPassword).toBeNull(); // password sanitized out
  });

  it('safely rejects and clears tampered signed flash cookies', async () => {
    const { app } = createApp({
      rootDir: process.cwd(),
      pages: 'tests/fixtures/pages-basic',
      secret: 'app-signing-secret-key-32-chars-long',
    });

    app.get('/test-flash-view', (req, res) => {
      res.json({
        allFlash: req.flash(),
        oldName: req.old('username'),
      });
    });

    const client = supertest(app);

    // Forged flash payload with an invalid/tampered HMAC signature
    const fakePayload = Buffer.from(JSON.stringify({ status: 'admin-granted' })).toString('base64url');
    const forgedCookie = `__ws_flash=s%3A${fakePayload}.invalidHMACsignature12345`;

    const res = await client
      .get('/test-flash-view')
      .set('Cookie', [forgedCookie])
      .expect(200);

    // Flash should be empty because signature was rejected
    expect(res.body.allFlash).toEqual({});
    expect(res.body.oldName).toBeNull();

    // Cookie must be cleared in response headers
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(setCookie[0]).toContain('__ws_flash=;');
  });

  it('picks up process.env.SESSION_SECRET when secret option is not provided', async () => {
    process.env.SESSION_SECRET = 'env-session-secret-fallback-value-32c';

    const { app } = createApp({
      rootDir: process.cwd(),
      pages: 'tests/fixtures/pages-basic',
    });

    app.get('/test-env-secret', (req, res) => {
      res.cookie('testCookie', 'testValue', { signed: true });
      res.json({ secretPresent: Boolean(req.secret) });
    });

    const client = supertest(app);
    const res = await client.get('/test-env-secret').expect(200);
    expect(res.body.secretPresent).toBe(true);

    const cookies = res.headers['set-cookie'];
    expect(cookies[0]).toMatch(/testCookie=s%3AtestValue\./);
  });
});

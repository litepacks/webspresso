/**
 * Unit Tests for CSRF Plugin (plugins/csrf)
 * Tests core cryptographic checks, ignore path matching, and middleware branches.
 */

import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import csrfPlugin from '../../../plugins/csrf/index';

describe('CSRF Protection Plugin (plugins/csrf)', () => {
  it('exercises CSRF ignore patterns: prefix, single-star glob, double-star glob, regex, and predicate function', () => {
    const plugin = csrfPlugin({
      cookie: true,
      ignorePaths: [
        '/api/public',
        '/api/*/webhook',
        '/downloads/**/files',
        /^\/internal\//,
        (req) => req.headers['x-bypass-csrf'] === 'true',
      ],
    });

    const app = { use: vi.fn(), post: vi.fn() };
    const middlewares = {};
    plugin.register({
      app,
      nunjucksEnv: { addGlobal: vi.fn() },
      middlewares,
      addHelper: vi.fn(),
    });

    const csrfMiddleware = middlewares.csrf();

    // 1. Prefix match
    let called = false;
    csrfMiddleware(
      { method: 'POST', path: '/api/public/login', headers: {} },
      { cookie: vi.fn() },
      () => { called = true; }
    );
    expect(called).toBe(true);

    // 2. Single-star glob match (/api/*/webhook)
    called = false;
    csrfMiddleware(
      { method: 'POST', path: '/api/v1/webhook', headers: {} },
      { cookie: vi.fn() },
      () => { called = true; }
    );
    expect(called).toBe(true);

    // 3. Double-star glob match (/downloads/**/files)
    called = false;
    csrfMiddleware(
      { method: 'POST', path: '/downloads/2026/oct/files', headers: {} },
      { cookie: vi.fn() },
      () => { called = true; }
    );
    expect(called).toBe(true);

    // 4. Regex match (/^\/internal\//)
    called = false;
    csrfMiddleware(
      { method: 'POST', path: '/internal/health', headers: {} },
      { cookie: vi.fn() },
      () => { called = true; }
    );
    expect(called).toBe(true);

    // 5. Predicate function match
    called = false;
    csrfMiddleware(
      { method: 'POST', path: '/anything', headers: { 'x-bypass-csrf': 'true' } },
      { cookie: vi.fn() },
      () => { called = true; }
    );
    expect(called).toBe(true);

    // 6. Non-matching path proceeds to CSRF validation and blocks without token
    let blocked = false;
    const resBlocked = {
      statusCode: 200,
      status(s) {
        this.statusCode = s;
        return this;
      },
      json(b) {
        if (this.statusCode === 403) blocked = true;
        return this;
      },
      cookie: vi.fn(),
    };
    csrfMiddleware(
      { method: 'POST', path: '/protected', headers: {}, cookies: {}, body: {} },
      resBlocked,
      () => {}
    );
    expect(blocked).toBe(true);
  });

  it('exercises signed cookies, cookie secrets, and custom error status/messages', () => {
    const plugin = csrfPlugin({
      cookie: {
        signed: true,
        secret: 'test-secret-key-1234567890',
        key: '_sec_csrf',
        maxAge: 3600000,
        secure: false,
      },
      errorMessage: 'Custom CSRF Failure',
      errorStatus: 418,
    });

    const middlewares = {};
    plugin.register({
      app: { use: vi.fn() },
      nunjucksEnv: { addGlobal: vi.fn() },
      middlewares,
      addHelper: vi.fn(),
    });

    const csrfMiddleware = middlewares.csrf();

    // Mismatched token returns custom status and message
    let jsonOutput = null;
    const req = {
      method: 'POST',
      path: '/submit',
      cookies: {},
      signedCookies: { _sec_csrf: 'token-in-cookie' },
      headers: { 'x-csrf-token': 'wrong-token' },
    };
    const res = {
      statusCode: 200,
      status(s) {
        this.statusCode = s;
        return this;
      },
      json(j) {
        jsonOutput = j;
        return this;
      },
      cookie: vi.fn(),
    };

    csrfMiddleware(req, res, () => {});
    expect(res.statusCode).toBe(418);
    expect(jsonOutput.error).toBe('Custom CSRF Failure');

    // Matching header token succeeds
    req.headers['x-csrf-token'] = 'token-in-cookie';
    let nextRan = false;
    csrfMiddleware(req, res, () => {
      nextRan = true;
    });
    expect(nextRan).toBe(true);
  });

  it('supports helper methods when called outside request lifecycle', () => {
    const plugin = csrfPlugin();
    let tokenHelper = null;
    let inputHelper = null;

    plugin.register({
      app: { use: vi.fn() },
      nunjucksEnv: { addGlobal: vi.fn() },
      middlewares: {},
      addHelper: (name, fn) => {
        if (name === 'csrfToken') tokenHelper = fn;
        if (name === 'csrfInput') inputHelper = fn;
      },
    });

    expect(typeof tokenHelper).toBe('function');
    expect(typeof inputHelper).toBe('function');

    // Calling outside request context returns empty string safely
    expect(tokenHelper()).toBe('');
    expect(inputHelper()).toBe('');
  });
});

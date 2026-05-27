/**
 * hono-sessions mount helper
 */

const { createCompatApp } = require('../../../src/http/compat-app');
const { mountAppSession } = require('../../../src/http/session');

describe('http/session', () => {
  it('loads hono-sessions from CommonJS (Node 18; ohash must resolve to CJS build)', () => {
    expect(() => require('hono-sessions')).not.toThrow();
    const mod = require('hono-sessions');
    expect(typeof mod.sessionMiddleware).toBe('function');
    expect(typeof mod.CookieStore).toBe('function');
  });

  it('requires session secret of at least 32 characters', () => {
    const app = createCompatApp();
    expect(() => mountAppSession(app, { secret: 'too-short' })).toThrow(/32 characters/);
  });

  it('mounts only once per app', () => {
    const app = createCompatApp();
    mountAppSession(app, { secret: 'a'.repeat(32) });
    expect(() => mountAppSession(app, { secret: 'b'.repeat(32) })).not.toThrow();
    expect(app._webspressoSessionInitialized).toBe(true);
  });
});

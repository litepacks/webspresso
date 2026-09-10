'use strict';

import { describe, it, expect } from 'vitest';

/**
 * Smoke-test published subpath exports (package.json "exports" map).
 * These paths are used in docs and consumer apps — must resolve without /index.js suffix.
 */
describe('package.json exports', () => {
  it('resolves webspresso/core/auth', () => {
    const auth = require('webspresso/core/auth');
    expect(typeof auth.createAuth).toBe('function');
    expect(typeof auth.hash).toBe('function');
  });

  it('resolves webspresso/core/auth/jwt subpath', () => {
    const jwt = require('webspresso/core/auth/jwt');
    expect(typeof jwt.signJwt).toBe('function');
  });

  it('resolves webspresso/core/orm', () => {
    const orm = require('webspresso/core/orm');
    expect(typeof orm.createDatabase).toBe('function');
  });

  it('resolves webspresso/plugins/polar and polar src subpaths', () => {
    const polarPlugin = require('webspresso/plugins/polar');
    expect(typeof polarPlugin).toBe('function');

    const webhooks = require('webspresso/plugins/polar/src/webhooks');
    expect(typeof webhooks.verifyPolarWebhook).toBe('function');
    expect(typeof webhooks.createWebhookRawBodyMiddleware).toBe('function');
  });

  it('resolves webspresso/plugins barrel', () => {
    const plugins = require('webspresso/plugins');
    expect(typeof plugins.polarPlugin).toBe('function');
    expect(typeof plugins.rateLimitPlugin).toBe('function');
  });
});

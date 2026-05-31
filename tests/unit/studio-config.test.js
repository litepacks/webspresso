/**
 * @vitest-environment node
 */

import { describe, it, expect, afterEach } from 'vitest';
import { resolveStudioConfig } from '../../plugins/studio/config.js';
import { createApp } from '../../src/server.js';

describe('resolveStudioConfig', () => {
  const origEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = origEnv;
  });

  it('defaults enabled in development', () => {
    process.env.NODE_ENV = 'development';
    const cfg = resolveStudioConfig(true, 'development');
    expect(cfg.enabled).toBe(true);
    expect(cfg.auth).toBe('dev-only');
  });

  it('defaults disabled in production', () => {
    process.env.NODE_ENV = 'production';
    const cfg = resolveStudioConfig(undefined, 'production');
    expect(cfg.enabled).toBe(false);
  });

  it('throws when production enabled without auth', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      resolveStudioConfig({ enabled: true, auth: 'none' }, 'production')
    ).toThrow(/production/i);
  });

  it('allows production with basic auth', () => {
    process.env.NODE_ENV = 'production';
    const cfg = resolveStudioConfig(
      {
        enabled: true,
        auth: 'basic',
        basicAuth: { user: 'dev', pass: 'secret' },
      },
      'production'
    );
    expect(cfg.enabled).toBe(true);
    expect(cfg.auth).toBe('basic');
  });
});

describe('createApp studio validation', () => {
  it('throws when production enabled without auth via createApp', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      createApp({
        pagesDir: './tests/fixtures/pages',
        viewsDir: './tests/fixtures/views',
        studio: { enabled: true, auth: 'dev-only' },
      })
    ).toThrow(/production/i);
  });
});

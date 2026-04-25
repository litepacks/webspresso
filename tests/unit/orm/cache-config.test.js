/**
 * ORM cache config normalization
 */
const { normalizeCacheConfig } = require('../../../core/orm/cache');

describe('normalizeCacheConfig', () => {
  it('returns null for undefined, null, false, enabled: false', () => {
    expect(normalizeCacheConfig(undefined)).toBeNull();
    expect(normalizeCacheConfig(null)).toBeNull();
    expect(normalizeCacheConfig(false)).toBeNull();
    expect(normalizeCacheConfig({ enabled: false })).toBeNull();
  });

  it('treats empty object { } as enabled with default auto', () => {
    const n = normalizeCacheConfig({});
    expect(n).toEqual(
      expect.objectContaining({
        enabled: true,
        defaultStrategy: 'auto',
        provider: null,
        memory: {},
      })
    );
  });

  it('normalizes true to auto + empty memory', () => {
    expect(normalizeCacheConfig(true)).toEqual({
      enabled: true,
      defaultStrategy: 'auto',
      provider: null,
      memory: {},
    });
  });

  it('defaultStrategy smart only when explicitly smart', () => {
    expect(normalizeCacheConfig({ enabled: true }).defaultStrategy).toBe('auto');
    expect(normalizeCacheConfig({ enabled: true, defaultStrategy: 'auto' }).defaultStrategy).toBe('auto');
    expect(normalizeCacheConfig({ enabled: true, defaultStrategy: 'nope' }).defaultStrategy).toBe('auto');
    expect(normalizeCacheConfig({ enabled: true, defaultStrategy: 'smart' }).defaultStrategy).toBe('smart');
  });

  it('passes through provider and memory', () => {
    const provider = { get: () => {} };
    const m = { maxEntries: 10 };
    expect(
      normalizeCacheConfig({
        enabled: true,
        defaultStrategy: 'smart',
        provider,
        memory: m,
      })
    ).toEqual({
      enabled: true,
      defaultStrategy: 'smart',
      provider,
      memory: m,
    });
  });
});

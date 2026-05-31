import { describe, it, expect } from 'vitest';
import { isSensitiveKey, maskEnvEntry, maskEnvObject } from '../../core/studio/secret-mask.js';

describe('studio secret-mask', () => {
  it('detects sensitive keys', () => {
    expect(isSensitiveKey('SESSION_SECRET')).toBe(true);
    expect(isSensitiveKey('DATABASE_URL')).toBe(true);
    expect(isSensitiveKey('PORT')).toBe(false);
  });

  it('masks secret values by default', () => {
    const e = maskEnvEntry('SESSION_SECRET', 'super-secret-value');
    expect(e.masked).toBe(true);
    expect(e.value).toBe('••••••••');
    expect(e.present).toBe(true);
  });

  it('hides non-secret values unless exposeEnv', () => {
    const hidden = maskEnvEntry('PORT', '3000', { exposeValues: false });
    expect(hidden.value).toBeUndefined();
    const shown = maskEnvEntry('PORT', '3000', { exposeValues: true });
    expect(shown.value).toBe('3000');
  });

  it('maskEnvObject sorts keys', () => {
    const list = maskEnvObject({ Z: '1', A: '2' });
    expect(list[0].key).toBe('A');
  });
});

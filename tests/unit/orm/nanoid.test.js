const { z } = require('zod');
const {
  generateNanoid,
  zodNanoid,
  extendZ,
  URL_ALPHABET,
} = require('../../../core/orm/utils/nanoid');

describe('generateNanoid', () => {
  it('should return default length 21', () => {
    const id = generateNanoid();
    expect(id).toHaveLength(21);
  });

  it('should respect custom size', () => {
    expect(generateNanoid(12)).toHaveLength(12);
    expect(generateNanoid(1)).toHaveLength(1);
  });

  it('should only use alphabet characters', () => {
    const id = generateNanoid(64);
    for (let i = 0; i < id.length; i++) {
      expect(URL_ALPHABET.includes(id[i])).toBe(true);
    }
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('should produce different values across calls', () => {
    const set = new Set();
    for (let i = 0; i < 50; i++) {
      set.add(generateNanoid(16));
    }
    expect(set.size).toBeGreaterThan(1);
  });
});

describe('zodNanoid', () => {
  it('should accept generateNanoid output', () => {
    const schema = zodNanoid(z);
    const id = generateNanoid();
    expect(() => schema.parse(id)).not.toThrow();
  });

  it('should reject wrong length', () => {
    const schema = zodNanoid(z, 21);
    expect(() => schema.parse('short')).toThrow();
  });

  it('should reject chars outside nanoid alphabet', () => {
    const schema = zodNanoid(z, 3);
    expect(() => schema.parse('!!!')).toThrow();
  });

  it('should accept custom size', () => {
    const schema = zodNanoid(z, 12);
    const id = generateNanoid(12);
    expect(schema.parse(id)).toBe(id);
  });
});

describe('extendZ (z.nanoid)', () => {
  const zx = extendZ(z);

  it('should not add nanoid to global z', () => {
    expect(z.nanoid).toBeUndefined();
  });

  it('should expose z.nanoid matching zodNanoid', () => {
    const id = generateNanoid();
    expect(zx.nanoid().parse(id)).toBe(id);
    expect(zx.nanoid(12).parse(generateNanoid(12))).toHaveLength(12);
    expect(zx.nanoid({ maxLength: 8 }).parse(generateNanoid(8))).toHaveLength(8);
  });

  it('should forward z.object and other z APIs', () => {
    const s = zx.object({ a: zx.string() });
    expect(s.parse({ a: 'x' })).toEqual({ a: 'x' });
  });
});

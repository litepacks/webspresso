const { generateNanoid, URL_ALPHABET } = require('../../../core/orm/utils/nanoid');

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

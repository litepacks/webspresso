/**
 * ORM memory cache provider unit tests
 */
const { createMemoryCacheProvider } = require('../../../core/orm/cache/memory-provider');

describe('createMemoryCacheProvider', () => {
  it('get/set and tag invalidation', () => {
    const p = createMemoryCacheProvider({ maxEntries: 100 });
    p.set('a', { x: 1 }, { tags: ['model:User', 'pk:User:1'] });
    p.set('b', { x: 2 }, { tags: ['model:User', 'q:User'] });
    expect(p.get('a')).toEqual({ x: 1 });
    p.invalidateTags(['pk:User:1']);
    expect(p.get('a')).toBeUndefined();
    expect(p.get('b')).toEqual({ x: 2 });
    p.invalidateTags(['q:User']);
    expect(p.get('b')).toBeUndefined();
  });

  it('clear removes all', () => {
    const p = createMemoryCacheProvider();
    p.set('k', 1, { tags: ['t1'] });
    p.clear();
    expect(p.get('k')).toBeUndefined();
    expect(p.getSizeStats().entries).toBe(0);
  });
});

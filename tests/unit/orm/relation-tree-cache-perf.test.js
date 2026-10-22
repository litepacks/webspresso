const {
  parseRelationTree,
  clearRelationTreeCache,
} = require('../../../core/orm');
const { getRelationTreeCacheKey } = require('../../../core/orm/eager-loader');

describe('Relation Tree Parser LRU Cache & Memoization', () => {
  beforeEach(() => {
    clearRelationTreeCache();
  });

  it('generates consistent cache keys for strings, string arrays, and objects', () => {
    expect(getRelationTreeCacheKey('author')).toBe('s:author');
    expect(getRelationTreeCacheKey(['author.profile', 'comments.author'])).toBe('a:author.profile|comments.author');
    expect(getRelationTreeCacheKey({ author: 'profile' })).toBe('o:{"author":"profile"}');
  });

  it('memoizes parsed relation trees for repeated queries', () => {
    const relations = ['author.profile', 'comments.author'];
    const tree1 = parseRelationTree(relations);
    const tree2 = parseRelationTree(relations);

    expect(Array.from(tree1.keys())).toEqual(Array.from(tree2.keys()));
    expect(tree1.get('author')).toEqual(tree2.get('author'));
    expect(tree1.get('comments')).toEqual(tree2.get('comments'));
  });

  it('protects cached relation tree from external mutation', () => {
    const relations = ['posts.tags', 'user.profile'];
    const tree1 = parseRelationTree(relations);

    // Mutate tree1
    tree1.get('posts').push('extra');
    tree1.set('injected', ['hacked']);

    // Next call should return clean unmutated tree
    const tree2 = parseRelationTree(relations);
    expect(tree2.get('posts')).toEqual(['tags']);
    expect(tree2.has('injected')).toBe(false);
  });

  it('supports passing a pre-parsed Map without re-parsing', () => {
    const rawTree = new Map([
      ['author', ['profile']],
      ['comments', []],
    ]);

    const result = parseRelationTree(rawTree);
    expect(result).toBeInstanceOf(Map);
    expect(Array.from(result.keys())).toEqual(['author', 'comments']);
    expect(result.get('author')).toEqual(['profile']);
  });

  it('respects LRU eviction limit under high cardinality of relation shapes', () => {
    for (let i = 0; i < 600; i++) {
      parseRelationTree([`model_${i}.relation`]);
    }
    // Most recent should hit cache
    const recentTree = parseRelationTree(['model_599.relation']);
    expect(recentTree.get('model_599')).toEqual(['relation']);
  });

  it('clearRelationTreeCache flushes cache properly', () => {
    parseRelationTree(['author.profile']);
    clearRelationTreeCache();
    // After clearing, parser should still operate cleanly
    const tree = parseRelationTree(['author.profile']);
    expect(tree.get('author')).toEqual(['profile']);
  });
});

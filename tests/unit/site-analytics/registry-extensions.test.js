/**
 * Admin Registry Extension Tests
 * Tests for the clientComponents feature added for plugin extensibility
 */
const { AdminRegistry } = require('../../../plugins/admin-panel/core/registry');

describe('AdminRegistry - Client Components', () => {
  let registry;

  beforeEach(() => {
    registry = new AdminRegistry();
  });

  it('should initialize with empty clientComponents Map', () => {
    expect(registry.clientComponents).toBeInstanceOf(Map);
    expect(registry.clientComponents.size).toBe(0);
  });

  it('should register a client component', () => {
    registry.registerClientComponent('my-page', 'window.MyPage = {};');
    expect(registry.clientComponents.has('my-page')).toBe(true);
    expect(registry.clientComponents.get('my-page')).toBe('window.MyPage = {};');
  });

  it('should return this for chaining', () => {
    const result = registry.registerClientComponent('p', 'code');
    expect(result).toBe(registry);
  });

  it('should overwrite existing component with same id', () => {
    registry.registerClientComponent('p', 'old code');
    registry.registerClientComponent('p', 'new code');
    expect(registry.clientComponents.get('p')).toBe('new code');
  });

  it('should concatenate multiple components via getClientComponents', () => {
    registry.registerClientComponent('a', '// component A');
    registry.registerClientComponent('b', '// component B');

    const result = registry.getClientComponents();
    expect(result).toContain('// component A');
    expect(result).toContain('// component B');
  });

  it('should return empty string when no components registered', () => {
    expect(registry.getClientComponents()).toBe('');
  });

  it('should include hasClientComponent in toClientConfig pages', () => {
    registry.registerPage('with-comp', { title: 'With', path: '/with' });
    registry.registerPage('without-comp', { title: 'Without', path: '/without' });
    registry.registerClientComponent('with-comp', 'code');

    const config = registry.toClientConfig();
    const withComp = config.pages.find(p => p.id === 'with-comp');
    const withoutComp = config.pages.find(p => p.id === 'without-comp');

    expect(withComp.hasClientComponent).toBe(true);
    expect(withoutComp.hasClientComponent).toBe(false);
  });

  it('should clear clientComponents on clear()', () => {
    registry.registerClientComponent('p', 'code');
    expect(registry.clientComponents.size).toBe(1);

    registry.clear();
    expect(registry.clientComponents.size).toBe(0);
  });
});

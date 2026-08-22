const { PluginManager } = require('../../src/plugin-manager');

describe('Plugin Lifecycle & Dependency Sorting', () => {
  let manager;
  let mockContext;

  beforeEach(() => {
    manager = new PluginManager();
    mockContext = {
      app: {},
      nunjucksEnv: {},
      options: {},
    };
  });

  it('should correctly sort plugins with array dependencies (topological sort)', () => {
    const executionOrder = [];

    const pluginC = {
      name: 'pluginC',
      dependencies: ['pluginB'],
      register() {
        executionOrder.push('pluginC');
      },
    };

    const pluginA = {
      name: 'pluginA',
      dependencies: [],
      register() {
        executionOrder.push('pluginA');
      },
    };

    const pluginB = {
      name: 'pluginB',
      dependencies: ['pluginA'],
      register() {
        executionOrder.push('pluginB');
      },
    };

    // Pass in reverse order: [C, B, A]
    manager.registerSync([pluginC, pluginB, pluginA], mockContext);

    expect(executionOrder).toEqual(['pluginA', 'pluginB', 'pluginC']);
  });

  it('should correctly sort plugins with object dependencies', () => {
    const executionOrder = [];

    const childPlugin = {
      name: 'child',
      version: '1.0.0',
      dependencies: { parent: '^1.0.0' },
      register() {
        executionOrder.push('child');
      },
    };

    const parentPlugin = {
      name: 'parent',
      version: '1.2.0',
      register() {
        executionOrder.push('parent');
      },
    };

    manager.registerSync([childPlugin, parentPlugin], mockContext);

    expect(executionOrder).toEqual(['parent', 'child']);
  });

  it('should isolate errors in plugin register() without breaking subsequent plugins', () => {
    const executed = [];

    const badPlugin = {
      name: 'badPlugin',
      register() {
        throw new Error('Register crashed!');
      },
    };

    const goodPlugin = {
      name: 'goodPlugin',
      register() {
        executed.push('goodPlugin');
      },
    };

    expect(() => {
      manager.registerSync([badPlugin, goodPlugin], mockContext);
    }).not.toThrow();

    expect(manager.plugins.has('badPlugin')).toBe(false);
    expect(manager.plugins.has('goodPlugin')).toBe(true);
    expect(executed).toEqual(['goodPlugin']);
  });
});

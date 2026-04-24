/**
 * Admin panel extension registry
 */
const { AdminRegistry, ExtensionType } = require('../../plugins/admin-panel/core/registry');

describe('AdminRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new AdminRegistry();
  });

  describe('registerPage', () => {
    it('registers a page and exposes it in toClientConfig', () => {
      registry.registerPage('reports', {
        title: 'Reports',
        path: '/reports',
        icon: 'chart',
      });
      const pages = registry.getPages();
      expect(pages).toHaveLength(1);
      expect(pages[0].id).toBe('reports');
      const client = registry.toClientConfig();
      expect(client.pages[0]).toMatchObject({
        id: 'reports',
        title: 'Reports',
        path: '/reports',
        hasClientComponent: false,
      });
    });

    it('throws when title or path missing', () => {
      expect(() => registry.registerPage('x', { title: 'T' })).toThrow(/requires title and path/);
      expect(() => registry.registerPage('x', { path: '/p' })).toThrow(/requires title and path/);
    });
  });

  describe('registerWidget', () => {
    it('throws without title', () => {
      expect(() => registry.registerWidget('w', { order: 1 })).toThrow(/requires title/);
    });

    it('sorts getWidgets by order', () => {
      registry.registerWidget('b', { title: 'B', order: 10 });
      registry.registerWidget('a', { title: 'A', order: 1 });
      const ids = registry.getWidgets().map((w) => w.id);
      expect(ids).toEqual(['a', 'b']);
    });
  });

  describe('registerAction / registerBulkAction', () => {
    it('throws without label or handler', () => {
      expect(() => registry.registerAction('a', { label: 'L' })).toThrow(/label and handler/);
      expect(() => registry.registerBulkAction('b', { label: 'L' })).toThrow(/label and handler/);
    });

    it('getActionsForModel respects models filter', () => {
      registry.registerAction('all', { label: 'All', handler: async () => {}, models: '*' });
      registry.registerAction('posts', { label: 'P', handler: async () => {}, models: ['Post'] });
      registry.registerAction('one', { label: 'O', handler: async () => {}, models: 'Product' });
      expect(registry.getActionsForModel('Post').map((a) => a.id)).toEqual(['all', 'posts']);
      expect(registry.getActionsForModel('Product').map((a) => a.id)).toEqual(['all', 'one']);
    });

    it('toClientConfig includes actions and bulkActions', () => {
      registry.registerAction('a1', {
        label: 'A',
        handler: async () => {},
        icon: 'plus',
        color: 'blue',
        models: ['X'],
        confirm: true,
        confirmMessage: 'Sure?',
      });
      registry.registerBulkAction('b1', {
        label: 'Bulk',
        handler: async () => {},
        confirm: false,
      });
      const c = registry.toClientConfig();
      expect(c.actions[0]).toMatchObject({
        id: 'a1',
        label: 'A',
        icon: 'plus',
        color: 'blue',
        models: ['X'],
        confirm: true,
        confirmMessage: 'Sure?',
      });
      expect(c.bulkActions[0]).toMatchObject({ id: 'b1', label: 'Bulk', confirm: false });
    });
  });

  describe('menu', () => {
    it('getMenu merges groups and ungrouped items', () => {
      registry.registerMenuGroup('g1', { label: 'Group', order: 1 });
      registry.registerMenuItem({ id: 'i1', label: 'Top', order: 0 });
      registry.registerMenuItem({ id: 'i2', label: 'In group', group: 'g1', order: 0 });
      const menu = registry.getMenu();
      expect(menu[0].id).toBe('i1');
      expect(menu[1].id).toBe('g1');
      expect(menu[1].items).toHaveLength(1);
      expect(menu[1].items[0].id).toBe('i2');
    });

    it('registerMenuItem throws without id/label', () => {
      expect(() => registry.registerMenuItem({ id: 'x' })).toThrow(/requires id and label/);
    });

    it('registerMenuGroup throws without label', () => {
      expect(() => registry.registerMenuGroup('g', {})).toThrow(/requires label/);
    });
  });

  describe('field renderer & client component', () => {
    it('registerFieldRenderer throws without display/edit', () => {
      expect(() => registry.registerFieldRenderer('x', { display: () => {} })).toThrow(
        /requires display and edit/,
      );
    });

    it('getClientComponents concatenates registered scripts', () => {
      registry.registerClientComponent('p1', 'window.x=1;');
      registry.registerClientComponent('p2', 'window.y=2;');
      expect(registry.getClientComponents()).toContain('window.x=1;');
      expect(registry.getClientComponents()).toContain('window.y=2;');
      const c = registry.toClientConfig();
      expect(c.pages).toEqual([]);
    });

    it('toClientConfig marks hasClientComponent when page id matches', () => {
      registry.registerPage('analytics', { title: 'A', path: '/analytics' });
      registry.registerClientComponent('analytics', '/* c */');
      const page = registry.toClientConfig().pages.find((p) => p.id === 'analytics');
      expect(page.hasClientComponent).toBe(true);
    });
  });

  describe('hooks', () => {
    it('registerHook creates new bucket and runHooks awaits callbacks', async () => {
      const calls = [];
      registry.registerHook('beforeCreate', async () => {
        calls.push(1);
      });
      registry.registerHook('beforeCreate', async () => {
        calls.push(2);
      });
      await registry.runHooks('beforeCreate', {});
      expect(calls).toEqual([1, 2]);
    });
  });

  describe('configure & userManagement', () => {
    it('configure merges settings including autoRefreshMs', () => {
      registry.configure({ title: 'X', autoRefreshMs: 30000 });
      expect(registry.settings.title).toBe('X');
      expect(registry.settings.autoRefreshMs).toBe(30000);
      expect(registry.toClientConfig().settings.autoRefreshMs).toBe(30000);
    });

    it('enableUserManagement sets defaults', () => {
      registry.enableUserManagement({ model: 'Account', fields: { email: 'mail' } });
      expect(registry.userManagement.enabled).toBe(true);
      expect(registry.userManagement.model).toBe('Account');
      expect(registry.userManagement.fields.email).toBe('mail');
      expect(registry.toClientConfig().userManagement.model).toBe('Account');
    });
  });

  describe('clear', () => {
    it('resets all collections', () => {
      registry.registerPage('p', { title: 'T', path: '/p' });
      registry.registerWidget('w', { title: 'W' });
      registry.registerHook('beforeCreate', () => {});
      registry.clear();
      expect(registry.getPages()).toHaveLength(0);
      expect(registry.getWidgets()).toHaveLength(0);
      expect(registry.hooks.beforeCreate).toEqual([]);
    });
  });

  it('ExtensionType constants', () => {
    expect(ExtensionType.PAGE).toBe('page');
    expect(ExtensionType.WIDGET).toBe('widget');
  });
});

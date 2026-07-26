const fs = require('fs');
const path = require('path');
const os = require('os');
const { registerModule, registerPageDir, loadPagesFromDir, formatClientComponent } = require('../../../plugins/admin-panel/core/admin-module');
const { AdminRegistry } = require('../../../plugins/admin-panel/core/registry');

function createMockDeps(registryOverride) {
  const registry = registryOverride || new AdminRegistry();
  const routes = [];

  return {
    registry,
    adminPath: '/_admin',
    ctx: {
      addRoute: (method, path, ...handlers) => {
        routes.push({ method, path, handlers });
      },
    },
    requireAuth: function requireAuth(req, res, next) { next(); },
    optionalAuth: function optionalAuth(req, res, next) { next(); },
    serveAdminPanel: function serveAdminPanel(req, res) { res.send('ok'); },
    _routes: routes,
  };
}

describe('admin-module file and folder custom pages', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-admin-pages-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('formatClientComponent', () => {
    it('should wrap plain Mithril component object code into window.__customPages assignment', () => {
      const input = `({ oninit() {}, view() { return m('div', 'Hello'); } })`;
      const output = formatClientComponent('test-page', input);
      expect(output).toContain('window.__customPages');
      expect(output).toContain('window.__customPages["test-page"] = ({ oninit() {}, view() { return m(\'div\', \'Hello\'); } })');
    });

    it('should strip module.exports = ', () => {
      const input = `module.exports = { view: () => 'hi' };`;
      const output = formatClientComponent('test-page', input);
      expect(output).toContain('window.__customPages["test-page"] = { view: () => \'hi\' }');
    });

    it('should pass through code if window.__customPages is already used', () => {
      const input = `window.__customPages['test-page'] = { view: () => 'hi' };`;
      const output = formatClientComponent('test-page', input);
      expect(output).toEqual(input);
    });
  });

  describe('componentFile in registerModule', () => {
    it('should read component code from file and register client component', () => {
      const compPath = path.join(tmpDir, 'my-component.js');
      fs.writeFileSync(compPath, `({ view: () => m('h1', 'My Custom Page') })`);

      const deps = createMockDeps();
      registerModule({
        id: 'test-mod',
        pages: [{
          id: 'custom-1',
          title: 'Custom 1',
          path: '/custom-1',
          componentFile: compPath,
          layout: true,
        }],
      }, deps);

      const page = deps.registry.pages.get('custom-1');
      expect(page).toBeDefined();
      expect(page.title).toBe('Custom 1');
      expect(page.layout).toBe(true);

      const clientCode = deps.registry.clientComponents.get('custom-1');
      expect(clientCode).toContain('window.__customPages["custom-1"] = ({ view: () => m(\'h1\', \'My Custom Page\') })');
    });

    it('should throw if componentFile does not exist', () => {
      const deps = createMockDeps();
      expect(() => {
        registerModule({
          id: 'test-mod',
          pages: [{
            id: 'missing',
            title: 'Missing',
            path: '/missing',
            componentFile: path.join(tmpDir, 'does-not-exist.js'),
          }],
        }, deps);
      }).toThrow(/componentFile not found/);
    });
  });

  describe('pagesDir in registerModule & registerPageDir', () => {
    it('should load pages and components from directory structure', () => {
      // Create folder products-create with page.json and component.js
      const pageFolder = path.join(tmpDir, 'products-create');
      fs.mkdirSync(pageFolder, { recursive: true });

      fs.writeFileSync(path.join(pageFolder, 'page.json'), JSON.stringify({
        id: 'products-create',
        title: 'Yeni Ürün Ekle',
        path: '/products-create',
        icon: 'plus',
        menu: {
          label: 'Yeni Ürün',
          order: 5,
        },
      }));

      fs.writeFileSync(path.join(pageFolder, 'component.js'), `({ view: () => m('div', 'Product Form') })`);

      const deps = createMockDeps();
      registerModule({
        id: 'products-module',
        pagesDir: tmpDir,
      }, deps);

      const page = deps.registry.pages.get('products-create');
      expect(page).toBeDefined();
      expect(page.title).toBe('Yeni Ürün Ekle');
      expect(page.path).toBe('/products-create');

      const menuItems = deps.registry.menuItems;
      const menuItem = menuItems.find(m => m.id === 'products-create');
      expect(menuItem).toBeDefined();
      expect(menuItem.label).toBe('Yeni Ürün');
      expect(menuItem.order).toBe(5);

      const clientCode = deps.registry.clientComponents.get('products-create');
      expect(clientCode).toContain('window.__customPages["products-create"]');
    });

    it('should support registerPageDir directly', () => {
      const pageFolder = path.join(tmpDir, 'reports');
      fs.mkdirSync(pageFolder, { recursive: true });

      fs.writeFileSync(path.join(pageFolder, 'config.json'), JSON.stringify({
        id: 'reports',
        title: 'Sales Reports',
        path: '/reports',
        icon: 'chart',
        menu: true,
      }));

      fs.writeFileSync(path.join(pageFolder, 'index.js'), `({ view: () => m('div', 'Reports') })`);

      const deps = createMockDeps();
      registerPageDir(tmpDir, deps);

      const page = deps.registry.pages.get('reports');
      expect(page).toBeDefined();
      expect(page.title).toBe('Sales Reports');

      const menuItem = deps.registry.menuItems.find(m => m.id === 'reports');
      expect(menuItem).toBeDefined();
      expect(menuItem.label).toBe('Sales Reports');
    });
  });
});

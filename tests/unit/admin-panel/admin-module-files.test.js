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
    it('should wrap plain Mithril component object code into window.__customPages assignment and try-catch', () => {
      const input = `({ oninit() {}, view() { return m('div', 'Hello'); } })`;
      const output = formatClientComponent('test-page', input);
      expect(output).toContain('try {');
      expect(output).toContain('window.__customPages');
      expect(output).toContain('window.__customPages["test-page"] = ({ oninit() {}, view() { return m(\'div\', \'Hello\'); } })');
      expect(output).toContain('catch (err)');
    });

    it('should strip module.exports = ', () => {
      const input = `module.exports = { view: () => 'hi' };`;
      const output = formatClientComponent('test-page', input);
      expect(output).toContain('window.__customPages["test-page"] = { view: () => \'hi\' }');
      expect(output).toContain('catch (err)');
    });

    it('should wrap in try-catch even if window.__customPages is already used', () => {
      const input = `window.__customPages['test-page'] = { view: () => 'hi' };`;
      const output = formatClientComponent('test-page', input);
      expect(output).toContain('try {');
      expect(output).toContain(input);
      expect(output).toContain('catch (err)');
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

    it('should load HTML pages from directory structure automatically', () => {
      const pageFolder = path.join(tmpDir, 'euix-page');
      fs.mkdirSync(pageFolder, { recursive: true });

      fs.writeFileSync(path.join(pageFolder, 'page.json'), JSON.stringify({
        id: 'euix-page',
        title: 'EUIX Docs',
        path: '/euix-page',
        icon: 'code',
      }));

      fs.writeFileSync(path.join(pageFolder, 'index.html'), `<!DOCTYPE html><html><body><h1>EUIX App</h1></body></html>`);

      const deps = createMockDeps();
      registerPageDir(tmpDir, deps);

      const page = deps.registry.pages.get('euix-page');
      expect(page).toBeDefined();
      expect(page.title).toBe('EUIX Docs');
      expect(page.html).toContain('<h1>EUIX App</h1>');

      const clientConfig = deps.registry.toClientConfig();
      const clientPage = clientConfig.pages.find(p => p.id === 'euix-page');
      expect(clientPage).toBeDefined();
      expect(clientPage.html).toContain('<h1>EUIX App</h1>');
    });
  });

  describe('url and custom HTML pages in registerModule', () => {
    it('should register URL page (e.g. EUIX) and serialize to client config', () => {
      const deps = createMockDeps();
      registerModule({
        id: 'euix-module',
        pages: [{
          id: 'euix',
          title: 'EUIX Framework',
          path: '/euix',
          url: 'https://litepacks.github.io/euix/',
        }],
      }, deps);

      const page = deps.registry.pages.get('euix');
      expect(page).toBeDefined();
      expect(page.url).toBe('https://litepacks.github.io/euix/');

      const clientConfig = deps.registry.toClientConfig();
      const clientPage = clientConfig.pages.find(p => p.id === 'euix');
      expect(clientPage.url).toBe('https://litepacks.github.io/euix/');
    });

    it('should register htmlFile and serialize HTML content to client config', () => {
      const htmlPath = path.join(tmpDir, 'custom.html');
      fs.writeFileSync(htmlPath, `<div id="app">Custom HTML Content</div>`);

      const deps = createMockDeps();
      registerModule({
        id: 'html-module',
        pages: [{
          id: 'custom-html',
          title: 'Custom HTML',
          path: '/custom-html',
          htmlFile: htmlPath,
        }],
      }, deps);

      const page = deps.registry.pages.get('custom-html');
      expect(page).toBeDefined();
      expect(page.html).toBe('<div id="app">Custom HTML Content</div>');

      const clientConfig = deps.registry.toClientConfig();
      const clientPage = clientConfig.pages.find(p => p.id === 'custom-html');
      expect(clientPage.html).toBe('<div id="app">Custom HTML Content</div>');
    });

    it('should throw if htmlFile does not exist', () => {
      const deps = createMockDeps();
      expect(() => {
        registerModule({
          id: 'test-mod',
          pages: [{
            id: 'missing-html',
            title: 'Missing HTML',
            path: '/missing-html',
            htmlFile: path.join(tmpDir, 'non-existent.html'),
          }],
        }, deps);
      }).toThrow(/htmlFile not found/);
    });

    it('should register scripts and styles in registerModule and produce correct HTML', () => {
      const deps = createMockDeps();
      registerModule({
        id: 'euix-engine-mod',
        scripts: [
          'https://unpkg.com/euixjs@latest/dist/EUIXEngine.umd.js',
          { src: 'https://example.com/custom.js', defer: true, position: 'body' }
        ],
        styles: [
          'https://example.com/custom.css',
          { code: 'body { background: #fff; }' }
        ],
      }, deps);

      expect(deps.registry.scripts).toHaveLength(2);
      expect(deps.registry.styles).toHaveLength(2);

      const stylesHtml = deps.registry.getStylesHtml();
      expect(stylesHtml).toContain('<link rel="stylesheet" href="https://example.com/custom.css">');
      expect(stylesHtml).toContain('<style>body { background: #fff; }</style>');

      const headScriptsHtml = deps.registry.getScriptsHtml('head');
      expect(headScriptsHtml).toContain('<script src="https://unpkg.com/euixjs@latest/dist/EUIXEngine.umd.js"></script>');

      const bodyScriptsHtml = deps.registry.getScriptsHtml('body');
      expect(bodyScriptsHtml).toContain('<script src="https://example.com/custom.js" defer></script>');
    });

    it('should generate custom page component code with m.trust for inline HTML rendering', () => {
      const { generateCustomPageComponent } = require('../../../plugins/admin-panel/modules/custom-pages');
      const code = generateCustomPageComponent();
      expect(code).toContain('m.trust(pageConfig.html)');
      expect(code).toContain('custom-html-container');
      expect(code).toContain('pageConfig.iframe');
    });
  });
});

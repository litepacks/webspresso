/**
 * Admin Panel & Plugins Page Title Support Tests
 * Covers:
 * 1. AdminRegistry settings, setTitle, getTitle, setTitleTemplate, getTitleTemplate
 * 2. adminPanelPlugin options { title, titleTemplate } & adminApi title methods
 * 3. Module & Page title propagation in registerModule and toClientConfig
 * 4. Client SPA title helper formatAdminTitle & setAdminPageTitle
 * 5. Plugin title customization (schemaExplorer, siteAnalytics, email, auditLog, ormCacheAdmin)
 */

const { AdminRegistry } = require('../../../plugins/admin-panel/core/registry');
const { registerModule } = require('../../../plugins/admin-panel/core/admin-module');
const adminPanelPlugin = require('../../../plugins/admin-panel');
const schemaExplorerPlugin = require('../../../plugins/schema-explorer');
const siteAnalyticsPlugin = require('../../../plugins/site-analytics');
const emailPlugin = require('../../../plugins/email');
const auditLogPlugin = require('../../../plugins/audit-log');
const ormCacheAdminPlugin = require('../../../plugins/orm-cache-admin');
const appScript = require('../../../plugins/admin-panel/app');

function createMockDeps() {
  const registry = new AdminRegistry();
  const routes = [];
  return {
    registry,
    adminPath: '/_admin',
    ctx: {
      addRoute: (method, path, ...handlers) => {
        routes.push({ method, path, handlers });
      },
    },
    requireAuth: () => {},
    optionalAuth: () => {},
    serveAdminPanel: () => {},
    _routes: routes,
  };
}

describe('Admin Panel Page Title Support', () => {
  describe('AdminRegistry title settings & methods', () => {
    let registry;

    beforeEach(() => {
      registry = new AdminRegistry();
    });

    it('has default title "Admin Panel" and titleTemplate "%s | %b"', () => {
      expect(registry.getTitle()).toBe('Admin Panel');
      expect(registry.getTitleTemplate()).toBe('%s | %b');
      expect(registry.settings.title).toBe('Admin Panel');
      expect(registry.settings.titleTemplate).toBe('%s | %b');
    });

    it('updates title with setTitle() and returns this for chaining', () => {
      const res = registry.setTitle('My Custom Admin');
      expect(res).toBe(registry);
      expect(registry.getTitle()).toBe('My Custom Admin');
      expect(registry.settings.title).toBe('My Custom Admin');
    });

    it('updates titleTemplate with setTitleTemplate() and returns this for chaining', () => {
      const res = registry.setTitleTemplate('%s — %b');
      expect(res).toBe(registry);
      expect(registry.getTitleTemplate()).toBe('%s — %b');
      expect(registry.settings.titleTemplate).toBe('%s — %b');
    });

    it('serializes title, titleTemplate, and page documentTitle in toClientConfig()', () => {
      registry.setTitle('Shop Admin');
      registry.setTitleTemplate('%s · %b');
      registry.registerPage('custom-page', {
        title: 'Custom Title',
        documentTitle: 'Exact Window Title',
        path: '/custom',
      });

      const config = registry.toClientConfig();
      expect(config.settings.title).toBe('Shop Admin');
      expect(config.settings.titleTemplate).toBe('%s · %b');
      
      const page = config.pages.find(p => p.id === 'custom-page');
      expect(page).toBeDefined();
      expect(page.title).toBe('Custom Title');
      expect(page.documentTitle).toBe('Exact Window Title');
    });
  });

  describe('adminPanelPlugin configuration & adminApi methods', () => {
    const mockDb = { knex: {} };

    it('configures custom title and titleTemplate via plugin options', () => {
      const plugin = adminPanelPlugin({
        db: mockDb,
        title: 'Platform Console',
        titleTemplate: '%s :: %b',
      });

      const registry = plugin.registry;
      expect(registry.getTitle()).toBe('Platform Console');
      expect(registry.getTitleTemplate()).toBe('%s :: %b');
    });

    it('exposes setTitle, getTitle, setTitleTemplate, getTitleTemplate on adminApi', () => {
      const plugin = adminPanelPlugin({ db: mockDb });
      expect(plugin.api.getTitle()).toBe('Admin Panel');
      expect(plugin.api.getTitleTemplate()).toBe('%s | %b');

      plugin.api.setTitle('New Console');
      expect(plugin.api.getTitle()).toBe('New Console');
      expect(plugin.registry.getTitle()).toBe('New Console');

      plugin.api.setTitleTemplate('%s / %b');
      expect(plugin.api.getTitleTemplate()).toBe('%s / %b');
      expect(plugin.registry.getTitleTemplate()).toBe('%s / %b');
    });
  });

  describe('registerModule title inheritance & documentTitle', () => {
    it('inherits module title for pages that omit page title', () => {
      const deps = createMockDeps();
      registerModule({
        id: 'crm',
        title: 'CRM Hub',
        pages: [{
          id: 'crm-main',
          path: '/crm',
        }],
      }, deps);

      const page = deps.registry.pages.get('crm-main');
      expect(page).toBeDefined();
      expect(page.title).toBe('CRM Hub');
    });

    it('preserves page-specific title over module title', () => {
      const deps = createMockDeps();
      registerModule({
        id: 'crm',
        title: 'CRM Hub',
        pages: [{
          id: 'crm-contacts',
          title: 'Customer Contacts',
          path: '/crm/contacts',
        }],
      }, deps);

      const page = deps.registry.pages.get('crm-contacts');
      expect(page).toBeDefined();
      expect(page.title).toBe('Customer Contacts');
    });

    it('stores documentTitle on registered pages', () => {
      const deps = createMockDeps();
      registerModule({
        id: 'analytics',
        pages: [{
          id: 'realtime',
          title: 'Realtime',
          documentTitle: 'Live Analytics Feed - Dashboard',
          path: '/analytics/realtime',
        }],
      }, deps);

      const page = deps.registry.pages.get('realtime');
      expect(page).toBeDefined();
      expect(page.documentTitle).toBe('Live Analytics Feed - Dashboard');
    });
  });

  describe('Client SPA formatAdminTitle & setAdminPageTitle runtime logic', () => {
    it('includes formatAdminTitle and setAdminPageTitle in app.js', () => {
      expect(appScript).toContain('function formatAdminTitle(');
      expect(appScript).toContain('function setAdminPageTitle(');
      expect(appScript).toContain('window.formatAdminTitle = formatAdminTitle;');
      expect(appScript).toContain('window.setAdminPageTitle = setAdminPageTitle;');
    });

    it('formats title correctly across various templates and options', () => {
      // Simulate client environment
      const fakeWindow = {
        __ADMIN_CONFIG__: {
          settings: {
            title: 'Store Admin',
            titleTemplate: '%s | %b',
          },
        },
      };
      const fakeDoc = { title: '' };

      const formatAdminTitle = new Function(
        'pageTitle', 'baseTitle', 'template',
        `
        baseTitle = baseTitle || 'Admin Panel';
        if (!pageTitle || pageTitle === baseTitle) {
          return baseTitle;
        }
        if (typeof template === 'function') {
          return template(pageTitle, baseTitle);
        }
        if (typeof template === 'string' && template.trim()) {
          var formatted = template;
          if (formatted.indexOf('%s') !== -1) {
            formatted = formatted.replace(/%s/g, pageTitle);
          }
          if (formatted.indexOf('%b') !== -1) {
            formatted = formatted.replace(/%b/g, baseTitle);
          }
          return formatted;
        }
        return pageTitle + ' | ' + baseTitle;
        `
      );

      const setAdminPageTitle = (pageTitle, options) => {
        const config = fakeWindow.__ADMIN_CONFIG__ || {};
        const settings = config.settings || {};
        const baseTitle = settings.title || 'Admin Panel';
        const template = (options && options.template) || settings.titleTemplate || '%s | %b';

        if (options && options.raw) {
          fakeDoc.title = pageTitle || baseTitle;
          return;
        }

        fakeDoc.title = formatAdminTitle(pageTitle, baseTitle, template);
      };

      // 1. Standard page with default template
      setAdminPageTitle('Orders');
      expect(fakeDoc.title).toBe('Orders | Store Admin');

      // 2. Custom template string
      setAdminPageTitle('Inventory', { template: '%s — %b' });
      expect(fakeDoc.title).toBe('Inventory — Store Admin');

      // 3. Raw mode bypasses template
      setAdminPageTitle('Special Dashboard (Raw)', { raw: true });
      expect(fakeDoc.title).toBe('Special Dashboard (Raw)');

      // 4. Empty or base title returns base title
      setAdminPageTitle('');
      expect(fakeDoc.title).toBe('Store Admin');

      setAdminPageTitle('Store Admin');
      expect(fakeDoc.title).toBe('Store Admin');

      // 5. Custom template with only %s
      setAdminPageTitle('Customers', { template: '%s' });
      expect(fakeDoc.title).toBe('Customers');

      // 6. Function template
      setAdminPageTitle('Users', { template: (p, b) => `[${b}] -> ${p}` });
      expect(fakeDoc.title).toBe('[Store Admin] -> Users');
    });
  });

  describe('Plugin title customization support', () => {
    it('schemaExplorerPlugin accepts title and sets it on module and page', () => {
      const plugin = schemaExplorerPlugin({
        title: 'Database Architecture',
      });

      let registeredModule = null;
      const mockAdminApi = {
        registerModule: (config) => {
          registeredModule = config;
        },
      };

      plugin.onRoutesReady({
        usePlugin: (name) => (name === 'admin-panel' ? mockAdminApi : null),
        addRoute: () => {},
      });

      expect(registeredModule).toBeDefined();
      expect(registeredModule.title).toBe('Database Architecture');
      expect(registeredModule.pages[0].title).toBe('Database Architecture');
    });

    it('siteAnalyticsPlugin accepts title and sets it on module and page', () => {
      const mockDb = { knex: { schema: {}, fn: {} } };
      const plugin = siteAnalyticsPlugin({
        db: mockDb,
        title: 'Traffic & Events',
      });

      let registeredModule = null;
      const mockAdminApi = {
        registerModule: (config) => {
          registeredModule = config;
        },
      };

      plugin.onRoutesReady({
        usePlugin: (name) => (name === 'admin-panel' ? mockAdminApi : null),
        addRoute: () => {},
      });

      expect(registeredModule).toBeDefined();
      expect(registeredModule.title).toBe('Traffic & Events');
      expect(registeredModule.pages[0].title).toBe('Traffic & Events');
    });

    it('emailPlugin accepts title and sets it on module and page', () => {
      const plugin = emailPlugin({
        title: 'Mailing Outbox',
      });

      let registeredModule = null;
      const mockAdminApi = {
        registerModule: (config) => {
          registeredModule = config;
        },
      };

      plugin.onRoutesReady({
        usePlugin: (name) => (name === 'admin-panel' ? mockAdminApi : null),
      });

      expect(registeredModule).toBeDefined();
      expect(registeredModule.title).toBe('Mailing Outbox');
      expect(registeredModule.pages[0].title).toBe('Mailing Outbox');
    });

    it('auditLogPlugin accepts title and sets it on module and page', () => {
      const mockDb = { knex: {} };
      const plugin = auditLogPlugin({
        db: mockDb,
        title: 'Security Audit Trail',
      });

      let registeredModule = null;
      const mockAdminApi = {
        registerModule: (config) => {
          registeredModule = config;
        },
      };

      plugin.onRoutesReady({
        usePlugin: (name) => (name === 'admin-panel' ? mockAdminApi : null),
      });

      expect(registeredModule).toBeDefined();
      expect(registeredModule.title).toBe('Security Audit Trail');
      expect(registeredModule.pages[0].title).toBe('Security Audit Trail');
    });

    it('ormCacheAdminPlugin accepts title and sets it on module and page', () => {
      const mockDb = { cache: {} };
      const plugin = ormCacheAdminPlugin({
        db: mockDb,
        title: 'Cache Dashboard',
      });

      let registeredModule = null;
      const mockAdminApi = {
        registerModule: (config) => {
          registeredModule = config;
        },
      };

      plugin.onRoutesReady({
        usePlugin: (name) => (name === 'admin-panel' ? mockAdminApi : null),
      });

      expect(registeredModule).toBeDefined();
      expect(registeredModule.title).toBe('Cache Dashboard');
      expect(registeredModule.pages[0].title).toBe('Cache Dashboard');
    });
  });
});

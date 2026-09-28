/**
 * Admin Panel Custom Page & Widget Developer Experience (Frontend DX) Tests
 * Covers:
 * 1. Live Reload / Dev Cache Invalidation (isDev) for componentFile and htmlFile
 * 2. Developer Error Boundary for custom pages (layout: true and layout: false)
 * 3. window.AdminUI reusable component library (StatCard, Card, Button, Badge, Modal, Tabs)
 * 4. Modern Toast & Confirm notification system (Admin.toast, Admin.confirm, ToastContainer, ConfirmModalContainer)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { AdminRegistry } = require('../../../plugins/admin-panel/core/registry');
const { registerModule } = require('../../../plugins/admin-panel/core/admin-module');
const { generateCustomPageComponent } = require('../../../plugins/admin-panel/modules/custom-pages');

describe('Admin Panel Custom Page & Widget DX (Task 4)', () => {
  let tmpDir;
  let originalEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-custom-dx-'));
    originalEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {}
  });

  // -------------------------------------------------------------
  // Helper functions for Mithril vnode assertions
  // -------------------------------------------------------------
  function getClasses(vnode) {
    if (!vnode || !vnode.attrs) return '';
    return (vnode.attrs.className || vnode.attrs.class || '') + '';
  }

  function getNodeText(node) {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (node.text) return node.text;
    if (node.children) {
      if (typeof node.children === 'string') return node.children;
      if (Array.isArray(node.children)) {
        return node.children.map(getNodeText).join('');
      }
    }
    return '';
  }

  // -------------------------------------------------------------
  // 1. Live Reload / Dev Cache Invalidation (isDev)
  // -------------------------------------------------------------
  describe('Live Reload / Dev Cache Invalidation', () => {
    it('dynamically re-reads modified componentFile in development mode without server restart', () => {
      process.env.NODE_ENV = 'development';
      const compPath = path.join(tmpDir, 'page-comp.js');
      fs.writeFileSync(compPath, 'module.exports = { view: () => m("div", "Initial v1") };', 'utf8');

      const registry = new AdminRegistry();
      const initialCode = 'try { window.__customPages["live-page"] = { view: () => m("div", "Initial v1") }; } catch(e){}';
      registry.registerClientComponent('live-page', initialCode, compPath);

      expect(registry.getClientComponents()).toContain('Initial v1');

      // Developer modifies component on disk
      fs.writeFileSync(compPath, 'module.exports = { view: () => m("div", "Updated v2 live!") };', 'utf8');

      // Next request to getClientComponents dynamically reflects disk changes
      const reloadedCode = registry.getClientComponents();
      expect(reloadedCode).toContain('Updated v2 live!');
      expect(reloadedCode).not.toContain('Initial v1');
    });

    it('serves in-memory cached component in production mode without reading disk again', () => {
      process.env.NODE_ENV = 'production';
      const compPath = path.join(tmpDir, 'prod-comp.js');
      fs.writeFileSync(compPath, 'module.exports = { view: () => m("div", "Production v1") };', 'utf8');

      const registry = new AdminRegistry();
      const initialCode = 'try { window.__customPages["prod-page"] = { view: () => m("div", "Production v1") }; } catch(e){}';
      registry.registerClientComponent('prod-page', initialCode, compPath);

      expect(registry.getClientComponents()).toContain('Production v1');

      // Developer modifies file on disk
      fs.writeFileSync(compPath, 'module.exports = { view: () => m("div", "Modified after start") };', 'utf8');

      // In production, cached version is kept for performance
      expect(registry.getClientComponents()).toContain('Production v1');
      expect(registry.getClientComponents()).not.toContain('Modified after start');
    });

    it('dynamically re-reads modified htmlFile in development mode for toClientConfig', () => {
      process.env.NODE_ENV = 'development';
      const htmlPath = path.join(tmpDir, 'custom.html');
      fs.writeFileSync(htmlPath, '<h1>Hello World v1</h1>', 'utf8');

      const registry = new AdminRegistry();
      registry.registerPage('html-page', {
        title: 'Custom HTML',
        path: '/custom-html',
        html: '<h1>Hello World v1</h1>',
        htmlFile: htmlPath,
      });

      let config = registry.toClientConfig();
      expect(config.pages[0].html).toBe('<h1>Hello World v1</h1>');

      // Developer modifies HTML on disk
      fs.writeFileSync(htmlPath, '<h1>Updated HTML v2</h1>', 'utf8');

      config = registry.toClientConfig();
      expect(config.pages[0].html).toBe('<h1>Updated HTML v2</h1>');
    });

    it('registerModule correctly binds componentFile for live reload', () => {
      process.env.NODE_ENV = 'development';
      const compPath = path.join(tmpDir, 'my-module-comp.js');
      fs.writeFileSync(compPath, 'module.exports = { view: () => m("h2", "Module Component v1") };', 'utf8');

      const registry = new AdminRegistry();
      const ctx = { addRoute: vi.fn() };
      const deps = {
        registry,
        adminPath: '/_admin',
        ctx,
        requireAuth: vi.fn(),
        optionalAuth: vi.fn(),
        serveAdminPanel: vi.fn(),
      };

      registerModule({
        id: 'test-module',
        pages: [
          {
            id: 'mod-page',
            title: 'Module Page',
            path: '/mod-page',
            componentFile: compPath,
          },
        ],
      }, deps);

      expect(registry.getClientComponents()).toContain('Module Component v1');

      // Edit file on disk
      fs.writeFileSync(compPath, 'module.exports = { view: () => m("h2", "Module Component v2 Live") };', 'utf8');
      expect(registry.getClientComponents()).toContain('Module Component v2 Live');
    });
  });

  // -------------------------------------------------------------
  // Setup Mithril VM Environment for Client Components Testing
  // -------------------------------------------------------------
  function setupMithrilVm() {
    const mCode = fs.readFileSync(
      path.join(__dirname, '../../../plugins/admin-panel/vendor/mithril.min.js'),
      'utf8'
    );
    const customPagesCode = generateCustomPageComponent();

    const sandbox = {
      window: {},
      console: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
      setTimeout,
      clearTimeout,
    };
    sandbox.window = sandbox;

    vm.createContext(sandbox);
    vm.runInContext(mCode, sandbox);
    vm.runInContext('var m = window.m;', sandbox);

    // Provide mock Layout and Breadcrumb in sandbox scope
    vm.runInContext('var Layout = { view: function(vnode) { return m("div.mock-layout", vnode.children); } };', sandbox);
    vm.runInContext('var Breadcrumb = { view: function() { return m("nav.mock-breadcrumb"); } };', sandbox);
    vm.runInContext('var Spinner = { view: function() { return m("div.spinner"); } };', sandbox);
    vm.runInContext('var RefreshIconButton = { view: function() { return m("button"); } };', sandbox);

    vm.runInContext(customPagesCode, sandbox);

    return sandbox;
  }

  // -------------------------------------------------------------
  // 2. Developer Error Boundary
  // -------------------------------------------------------------
  describe('Developer Error Boundary', () => {
    it('defines renderCustomPageError function that outputs rich error diagnostics', () => {
      const sandbox = setupMithrilVm();
      expect(typeof sandbox.window.renderCustomPageError).toBe('function');

      const page = { id: 'dashboard-widget', title: 'Dashboard Widget', path: '/widget', layout: true };
      const err = new Error('Syntax error or undefined variable in custom page');
      err.stack = 'Error: Syntax error\n    at CustomPage.view (component.js:12:5)';

      const errorVnode = sandbox.window.renderCustomPageError(page, err);
      expect(errorVnode).toBeDefined();

      // Wrapped in Layout
      expect(errorVnode.tag).toBe(sandbox.window.Layout);
      const card = errorVnode.children[1];
      expect(card.tag).toBe('div');

      // Verify presence of Error Boundary badge and Page ID
      const allText = getNodeText(card);
      expect(allText).toContain('Custom Page Component Error');
      expect(allText).toContain('dashboard-widget');
      expect(allText).toContain('Error Boundary');
      expect(allText).toContain('Syntax error or undefined variable');
      expect(allText).toContain('CustomPage.view');
      expect(allText).toContain('Back to Dashboard');
      expect(allText).toContain('Reload Page');
    });

    it('renders fullscreen error container when page.layout is false', () => {
      const sandbox = setupMithrilVm();
      const page = { id: 'canvas-page', title: 'Full Canvas', path: '/canvas', layout: false };
      const err = new TypeError('Cannot read properties of null');

      const errorVnode = sandbox.window.renderCustomPageError(page, err);
      expect(errorVnode.tag).toBe('div');
      expect(getClasses(errorVnode)).toContain('min-h-screen');
      expect(getClasses(errorVnode)).toContain('bg-slate-950');
      expect(getNodeText(errorVnode)).toContain('canvas-page');
    });

    it('createCustomPage catches render errors and returns Developer Error Boundary', () => {
      const sandbox = setupMithrilVm();
      const pageConfig = {
        id: 'buggy-page',
        title: 'Buggy Page',
        path: '/buggy',
        dataLoader: false,
        render: () => {
          throw new Error('Explosion during custom page render!');
        },
      };

      const comp = sandbox.window.createCustomPage(pageConfig);
      const vnode = {
        state: { data: { foo: 'bar' }, loading: false, error: null },
      };

      // Calling view should not throw, but return error boundary vnode
      let rendered;
      expect(() => {
        rendered = comp.view(vnode);
      }).not.toThrow();

      expect(rendered).toBeDefined();
      expect(rendered.tag).toBe(sandbox.window.Layout);
      expect(getNodeText(rendered)).toContain('Explosion during custom page render!');
    });
  });

  // -------------------------------------------------------------
  // 3. window.AdminUI Reusable Component Library
  // -------------------------------------------------------------
  describe('window.AdminUI Component Library', () => {
    let sandbox;

    beforeEach(() => {
      sandbox = setupMithrilVm();
    });

    it('exposes AdminUI on window with all 6 core components', () => {
      expect(sandbox.window.AdminUI).toBeDefined();
      expect(typeof sandbox.window.AdminUI.StatCard).toBe('object');
      expect(typeof sandbox.window.AdminUI.Card).toBe('object');
      expect(typeof sandbox.window.AdminUI.Button).toBe('object');
      expect(typeof sandbox.window.AdminUI.Badge).toBe('object');
      expect(typeof sandbox.window.AdminUI.Modal).toBe('object');
      expect(typeof sandbox.window.AdminUI.Tabs).toBe('object');
    });

    it('AdminUI.StatCard renders stat values, trend indicators, and icons', () => {
      const { StatCard } = sandbox.window.AdminUI;
      const vnode = StatCard.view({
        attrs: {
          title: 'Total Revenue',
          value: '$45,200',
          change: '+14.5%',
          trend: 'up',
          color: 'emerald',
          subtitle: 'vs previous 30 days',
        },
      });

      expect(vnode.tag).toBe('div');
      expect(getClasses(vnode)).toContain('rounded-xl');

      const cardText = getNodeText(vnode);
      expect(cardText).toContain('Total Revenue');
      expect(cardText).toContain('$45,200');
      expect(cardText).toContain('+14.5%');
      expect(cardText).toContain('↑');
      expect(cardText).toContain('vs previous 30 days');
    });

    it('AdminUI.Card renders title, subtitle, action slots, body, and footer', () => {
      const { Card } = sandbox.window.AdminUI;
      const actionBtn = sandbox.window.m('button', 'Export');
      const footerContent = sandbox.window.m('span', 'Last updated: 5m ago');

      const vnode = Card.view({
        attrs: {
          title: 'Active Campaigns',
          subtitle: 'Current marketing performance',
          actions: [actionBtn],
          footer: footerContent,
        },
        children: [sandbox.window.m('p', 'Card Body Content')],
      });

      expect(vnode.tag).toBe('div');
      expect(getClasses(vnode)).toContain('shadow-sm');

      const cardText = getNodeText(vnode);
      expect(cardText).toContain('Active Campaigns');
      expect(cardText).toContain('Current marketing performance');
      expect(cardText).toContain('Export');
      expect(cardText).toContain('Card Body Content');
      expect(cardText).toContain('Last updated: 5m ago');
    });

    it('AdminUI.Button renders variants, sizes, loading state, and handles onclick', () => {
      const { Button } = sandbox.window.AdminUI;
      const clickSpy = vi.fn();

      // Primary normal button
      const vnode1 = Button.view({
        attrs: {
          variant: 'danger',
          size: 'lg',
          onclick: clickSpy,
        },
        children: ['Delete Item'],
      });
      expect(vnode1.tag).toBe('button');
      expect(getClasses(vnode1)).toContain('bg-red-600');
      expect(getClasses(vnode1)).toContain('px-4.5');
      expect(vnode1.attrs.disabled).toBeFalsy();
      vnode1.attrs.onclick();
      expect(clickSpy).toHaveBeenCalled();

      // Loading button
      const vnodeLoading = Button.view({
        attrs: {
          variant: 'primary',
          loading: true,
        },
        children: ['Save'],
      });
      expect(vnodeLoading.attrs.disabled).toBe(true);
      expect(getClasses(vnodeLoading.children[0])).toContain('animate-spin');
    });

    it('AdminUI.Badge renders colored labels with optional status dots', () => {
      const { Badge } = sandbox.window.AdminUI;

      const vnode = Badge.view({
        attrs: {
          color: 'green',
          text: 'Published',
          dot: true,
          size: 'sm',
        },
      });

      expect(vnode.tag).toBe('span');
      expect(getClasses(vnode)).toContain('emerald');
      expect(getClasses(vnode)).toContain('rounded-full');
      expect(getNodeText(vnode)).toContain('Published');
    });

    it('AdminUI.Modal renders modal dialog overlay when isOpen is true and hides when false', () => {
      const { Modal } = sandbox.window.AdminUI;
      const closeSpy = vi.fn();
      const confirmSpy = vi.fn();

      // Closed modal
      expect(Modal.view({ attrs: { isOpen: false } })).toBeNull();

      // Open modal
      const vnode = Modal.view({
        attrs: {
          isOpen: true,
          title: 'Confirm Operation',
          onClose: closeSpy,
          onConfirm: confirmSpy,
          confirmText: 'Yes, proceed',
          confirmVariant: 'danger',
        },
        children: [sandbox.window.m('p', 'Modal Message')],
      });

      expect(vnode.tag).toBe('div');
      expect(getClasses(vnode)).toContain('fixed');

      // Backdrop click
      const backdrop = vnode.children[0];
      backdrop.attrs.onclick();
      expect(closeSpy).toHaveBeenCalled();

      // Dialog contents
      const modalText = getNodeText(vnode);
      expect(modalText).toContain('Confirm Operation');
      expect(modalText).toContain('Modal Message');
      expect(modalText).toContain('Yes, proceed');

      // Click confirm button
      const dialog = vnode.children[1];
      const footer = dialog.children[2];
      const confirmBtn = footer.children[1];
      confirmBtn.attrs.onclick();
      expect(confirmSpy).toHaveBeenCalled();
    });

    it('AdminUI.Tabs renders tab bar and triggers onChange callback', () => {
      const { Tabs } = sandbox.window.AdminUI;
      const changeSpy = vi.fn();

      const tabsList = [
        { id: 'overview', label: 'Overview' },
        { id: 'analytics', label: 'Analytics', badge: 5 },
        { id: 'settings', label: 'Settings' },
      ];

      const vnode = Tabs.view({
        attrs: {
          tabs: tabsList,
          active: 'analytics',
          onChange: changeSpy,
        },
      });

      expect(vnode.tag).toBe('div');
      const nav = vnode.children[0];
      expect(nav.children.length).toBe(3);

      // Active tab styling
      const activeTabBtn = nav.children[1];
      expect(getClasses(activeTabBtn)).toContain('border-blue-600');
      expect(getNodeText(activeTabBtn)).toContain('5');

      // Click on inactive tab
      const inactiveTabBtn = nav.children[2];
      inactiveTabBtn.attrs.onclick({ preventDefault: vi.fn() });
      expect(changeSpy).toHaveBeenCalledWith('settings');
    });
  });

  // -------------------------------------------------------------
  // 4. Modern Toast & Confirm Notification System
  // -------------------------------------------------------------
  describe('Admin.toast & Admin.confirm Notification System', () => {
    let sandbox;

    beforeEach(() => {
      sandbox = setupMithrilVm();
    });

    it('exposes Admin.toast with helper methods and manages toast stack', () => {
      const { Admin, toastState, ToastContainer } = sandbox.window;
      expect(Admin.toast).toBeDefined();
      expect(typeof Admin.toast.success).toBe('function');
      expect(typeof Admin.toast.error).toBe('function');
      expect(typeof Admin.toast.warning).toBe('function');
      expect(typeof Admin.toast.info).toBe('function');

      // Initially empty
      expect(ToastContainer.view()).toBeNull();

      // Add success toast
      const id1 = Admin.toast.success('Record created successfully!', { title: 'Success' });
      expect(toastState.items.length).toBe(1);
      expect(toastState.items[0].id).toBe(id1);
      expect(toastState.items[0].type).toBe('success');
      expect(toastState.items[0].message).toBe('Record created successfully!');
      expect(toastState.items[0].title).toBe('Success');

      // Add error toast
      const id2 = Admin.toast.error('Failed to connect to database');
      expect(toastState.items.length).toBe(2);

      // ToastContainer renders active toasts
      const containerVnode = ToastContainer.view();
      expect(containerVnode).toBeDefined();
      expect(containerVnode.tag).toBe('div');
      expect(containerVnode.children.length).toBe(2);

      const toastText = getNodeText(containerVnode);
      expect(toastText).toContain('Record created successfully!');
      expect(toastText).toContain('Failed to connect to database');

      // Remove specific toast
      Admin.toast.remove(id1);
      expect(toastState.items.length).toBe(1);
      expect(toastState.items[0].id).toBe(id2);

      // Clear all
      Admin.toast.clear();
      expect(toastState.items.length).toBe(0);
      expect(ToastContainer.view()).toBeNull();
    });

    it('Admin.confirm returns a Promise resolving to true on confirm and false on cancel', async () => {
      const { Admin, confirmState, ConfirmModalContainer } = sandbox.window;
      expect(typeof Admin.confirm).toBe('function');

      // Initially no confirm modal
      expect(ConfirmModalContainer.view()).toBeNull();

      // Trigger confirmation
      const confirmPromise = Admin.confirm({
        title: 'Delete User Account?',
        message: 'This action is irreversible.',
        confirmText: 'Delete Account',
        cancelText: 'Keep Account',
        danger: true,
      });

      // Confirm modal is now visible
      const modalVnode = ConfirmModalContainer.view();
      expect(modalVnode).toBeDefined();
      expect(modalVnode.tag).toBe('div');

      const modalText = getNodeText(modalVnode);
      expect(modalText).toContain('Delete User Account?');
      expect(modalText).toContain('This action is irreversible.');
      expect(modalText).toContain('Delete Account');
      expect(modalText).toContain('Keep Account');

      // Simulate clicking Confirm
      confirmState.close(true);

      const result = await confirmPromise;
      expect(result).toBe(true);
      expect(ConfirmModalContainer.view()).toBeNull();
    });

    it('Admin.confirm resolves to false when dismissed or cancelled', async () => {
      const { Admin, confirmState } = sandbox.window;

      const cancelPromise = Admin.confirm('Are you sure?');
      confirmState.close(false);

      const result = await cancelPromise;
      expect(result).toBe(false);
    });

    it('window.Admin aggregates ui, toast, confirm, api, and state', () => {
      const { Admin, AdminUI } = sandbox.window;
      expect(Admin.ui).toBe(AdminUI);
      expect(typeof Admin.toast).toBe('function');
      expect(typeof Admin.confirm).toBe('function');
    });
  });
});

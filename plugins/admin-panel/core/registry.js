/**
 * Admin Panel Extension Registry
 * Central registry for admin panel extensions (pages, widgets, actions, menu items)
 * @module plugins/admin-panel/core/registry
 */

/**
 * Extension types
 */
const ExtensionType = {
  PAGE: 'page',
  WIDGET: 'widget',
  ACTION: 'action',
  MENU_ITEM: 'menu_item',
  MENU_GROUP: 'menu_group',
  FIELD_RENDERER: 'field_renderer',
  BULK_ACTION: 'bulk_action',
};

/**
 * Admin Panel Registry
 * Manages all extensions and configurations
 */
class AdminRegistry {
  constructor() {
    // Pages: custom admin pages
    this.pages = new Map();
    
    // Widgets: dashboard widgets
    this.widgets = new Map();
    
    // Actions: model-level actions (buttons)
    this.actions = new Map();
    
    // Bulk actions: multi-select actions
    this.bulkActions = new Map();
    
    // Menu items: sidebar menu items
    this.menuItems = [];
    
    // Menu groups: grouped menu items
    this.menuGroups = new Map();
    
    // Field renderers: custom field display/edit components
    this.fieldRenderers = new Map();

    // Client components: JS code strings for custom page rendering
    this.clientComponents = new Map();
    
    // Hooks: lifecycle hooks
    this.hooks = {
      beforeCreate: [],
      afterCreate: [],
      beforeUpdate: [],
      afterUpdate: [],
      beforeDelete: [],
      afterDelete: [],
      onRecordView: [],
      onDashboardLoad: [],
    };
    
    // Settings
    this.settings = {
      title: 'Admin Panel',
      logo: null,
      primaryColor: '#3B82F6',
      perPage: 20,
      dateFormat: 'YYYY-MM-DD',
      timeFormat: 'HH:mm',
      uploadUrl: null,
    };
    
    // User management config
    this.userManagement = {
      enabled: false,
      model: null,
      fields: {},
    };
  }

  /**
   * Register a custom page
   * @param {string} id - Unique page ID
   * @param {Object} config - Page configuration
   * @param {string} config.title - Page title
   * @param {string} config.path - Route path (e.g., '/users')
   * @param {string} [config.icon] - Menu icon
   * @param {Function} config.component - Mithril component factory
   * @param {Function} [config.handler] - Server-side handler (optional)
   * @param {string} [config.permission] - Required permission
   */
  registerPage(id, config) {
    if (!config.title || !config.path) {
      throw new Error(`Page "${id}" requires title and path`);
    }
    
    this.pages.set(id, {
      id,
      ...config,
      type: ExtensionType.PAGE,
    });
    
    return this;
  }

  /**
   * Register a dashboard widget
   * @param {string} id - Unique widget ID
   * @param {Object} config - Widget configuration
   * @param {string} config.title - Widget title
   * @param {string} [config.size='md'] - Widget size (sm, md, lg, xl, full)
   * @param {number} [config.order=0] - Display order
   * @param {Function} config.component - Mithril component factory
   * @param {Function} [config.dataLoader] - Async data loader function
   * @param {string} [config.permission] - Required permission
   */
  registerWidget(id, config) {
    if (!config.title) {
      throw new Error(`Widget "${id}" requires title`);
    }
    
    this.widgets.set(id, {
      id,
      size: 'md',
      order: 0,
      ...config,
      type: ExtensionType.WIDGET,
    });
    
    return this;
  }

  /**
   * Register a model action (single record)
   * @param {string} id - Unique action ID
   * @param {Object} config - Action configuration
   * @param {string} config.label - Button label
   * @param {string} [config.icon] - Button icon
   * @param {string} [config.color='gray'] - Button color
   * @param {string|string[]} [config.models] - Target models (or '*' for all)
   * @param {Function} config.handler - Action handler (record, model) => Promise
   * @param {Function} [config.visible] - Visibility check (record, model) => boolean
   * @param {boolean} [config.confirm=false] - Require confirmation
   * @param {string} [config.confirmMessage] - Confirmation message
   */
  registerAction(id, config) {
    if (!config.label || !config.handler) {
      throw new Error(`Action "${id}" requires label and handler`);
    }
    
    this.actions.set(id, {
      id,
      color: 'gray',
      models: '*',
      confirm: false,
      ...config,
      type: ExtensionType.ACTION,
    });
    
    return this;
  }

  /**
   * Register a bulk action (multi-select)
   * @param {string} id - Unique action ID
   * @param {Object} config - Action configuration
   * @param {string} config.label - Button label
   * @param {string} [config.icon] - Button icon
   * @param {string} [config.color='gray'] - Button color
   * @param {string|string[]} [config.models] - Target models (or '*' for all)
   * @param {Function} config.handler - Action handler (records, model) => Promise
   * @param {boolean} [config.confirm=true] - Require confirmation
   * @param {string} [config.confirmMessage] - Confirmation message
   */
  registerBulkAction(id, config) {
    if (!config.label || !config.handler) {
      throw new Error(`Bulk action "${id}" requires label and handler`);
    }
    
    this.bulkActions.set(id, {
      id,
      color: 'gray',
      models: '*',
      confirm: true,
      ...config,
      type: ExtensionType.BULK_ACTION,
    });
    
    return this;
  }

  /**
   * Register a menu item
   * @param {Object} config - Menu item configuration
   * @param {string} config.id - Unique ID
   * @param {string} config.label - Display label
   * @param {string} [config.path] - Route path
   * @param {string} [config.icon] - Icon
   * @param {string} [config.group] - Group ID (for grouping)
   * @param {number} [config.order=0] - Display order
   * @param {string} [config.permission] - Required permission
   * @param {string} [config.badge] - Badge text
   * @param {Function} [config.badgeLoader] - Async badge value loader
   */
  registerMenuItem(config) {
    if (!config.id || !config.label) {
      throw new Error('Menu item requires id and label');
    }
    
    this.menuItems.push({
      order: 0,
      ...config,
      type: ExtensionType.MENU_ITEM,
    });
    
    // Sort by order
    this.menuItems.sort((a, b) => a.order - b.order);
    
    return this;
  }

  /**
   * Register a menu group
   * @param {string} id - Group ID
   * @param {Object} config - Group configuration
   * @param {string} config.label - Group label
   * @param {string} [config.icon] - Group icon
   * @param {number} [config.order=0] - Display order
   * @param {boolean} [config.collapsible=true] - Can collapse
   */
  registerMenuGroup(id, config) {
    if (!config.label) {
      throw new Error(`Menu group "${id}" requires label`);
    }
    
    this.menuGroups.set(id, {
      id,
      order: 0,
      collapsible: true,
      ...config,
      type: ExtensionType.MENU_GROUP,
    });
    
    return this;
  }

  /**
   * Register a custom field renderer
   * @param {string} type - Field type (e.g., 'color', 'rating', 'file')
   * @param {Object} config - Renderer configuration
   * @param {Function} config.display - Display component (value, record) => vnode
   * @param {Function} config.edit - Edit component (value, onChange, field) => vnode
   */
  registerFieldRenderer(type, config) {
    if (!config.display || !config.edit) {
      throw new Error(`Field renderer "${type}" requires display and edit functions`);
    }
    
    this.fieldRenderers.set(type, {
      type,
      ...config,
    });
    
    return this;
  }

  /**
   * Register a client-side component for a custom page
   * @param {string} pageId - Page ID (must match a registered page)
   * @param {string} jsCode - JavaScript code string that defines the component.
   *   The code should assign a Mithril component to window.__customPages[pageId].
   */
  registerClientComponent(pageId, jsCode) {
    this.clientComponents.set(pageId, jsCode);
    return this;
  }

  /**
   * Get all client component code strings concatenated
   */
  getClientComponents() {
    return Array.from(this.clientComponents.values()).join('\n');
  }

  /**
   * Register a hook
   * @param {string} hookName - Hook name
   * @param {Function} callback - Hook callback
   */
  registerHook(hookName, callback) {
    if (!this.hooks[hookName]) {
      this.hooks[hookName] = [];
    }
    this.hooks[hookName].push(callback);
    return this;
  }

  /**
   * Run hooks
   * @param {string} hookName - Hook name
   * @param {*} context - Hook context/data
   */
  async runHooks(hookName, context) {
    const hooks = this.hooks[hookName] || [];
    for (const hook of hooks) {
      await hook(context);
    }
  }

  /**
   * Configure settings
   * @param {Object} settings - Settings object
   */
  configure(settings) {
    this.settings = { ...this.settings, ...settings };
    return this;
  }

  /**
   * Enable user management
   * @param {Object} config - User management configuration
   * @param {Object} config.model - User model name
   * @param {Object} [config.fields] - Field mappings
   */
  enableUserManagement(config) {
    this.userManagement = {
      enabled: true,
      model: config.model || 'User',
      fields: {
        email: 'email',
        password: 'password',
        name: 'name',
        role: 'role',
        active: 'active',
        ...config.fields,
      },
    };
    return this;
  }

  /**
   * Get all pages
   */
  getPages() {
    return Array.from(this.pages.values());
  }

  /**
   * Get all widgets sorted by order
   */
  getWidgets() {
    return Array.from(this.widgets.values()).sort((a, b) => a.order - b.order);
  }

  /**
   * Get actions for a model
   */
  getActionsForModel(modelName) {
    return Array.from(this.actions.values()).filter(action => {
      if (action.models === '*') return true;
      if (Array.isArray(action.models)) return action.models.includes(modelName);
      return action.models === modelName;
    });
  }

  /**
   * Get bulk actions for a model
   */
  getBulkActionsForModel(modelName) {
    return Array.from(this.bulkActions.values()).filter(action => {
      if (action.models === '*') return true;
      if (Array.isArray(action.models)) return action.models.includes(modelName);
      return action.models === modelName;
    });
  }

  /**
   * Get organized menu (groups + items)
   */
  getMenu() {
    const groups = Array.from(this.menuGroups.values()).sort((a, b) => a.order - b.order);
    const ungroupedItems = this.menuItems.filter(item => !item.group);
    
    // Build menu structure
    const menu = [];
    
    // Add ungrouped items first
    menu.push(...ungroupedItems);
    
    // Add groups with their items
    for (const group of groups) {
      const groupItems = this.menuItems.filter(item => item.group === group.id);
      menu.push({
        ...group,
        items: groupItems,
      });
    }
    
    return menu;
  }

  /**
   * Serialize registry for client-side
   */
  toClientConfig() {
    return {
      settings: this.settings,
      pages: this.getPages().map(p => ({
        id: p.id,
        title: p.title,
        path: p.path,
        icon: p.icon,
        permission: p.permission,
        hasClientComponent: this.clientComponents.has(p.id),
      })),
      widgets: this.getWidgets().map(w => ({
        id: w.id,
        title: w.title,
        size: w.size,
        order: w.order,
        permission: w.permission,
      })),
      actions: Array.from(this.actions.values()).map(a => ({
        id: a.id,
        label: a.label,
        icon: a.icon,
        color: a.color,
        models: a.models,
        confirm: a.confirm,
        confirmMessage: a.confirmMessage,
      })),
      bulkActions: Array.from(this.bulkActions.values()).map(a => ({
        id: a.id,
        label: a.label,
        icon: a.icon,
        color: a.color,
        models: a.models,
        confirm: a.confirm,
        confirmMessage: a.confirmMessage,
      })),
      menu: this.getMenu(),
      userManagement: this.userManagement,
    };
  }

  /**
   * Clear all registrations (for testing)
   */
  clear() {
    this.pages.clear();
    this.widgets.clear();
    this.actions.clear();
    this.bulkActions.clear();
    this.menuItems = [];
    this.menuGroups.clear();
    this.fieldRenderers.clear();
    this.clientComponents.clear();
    Object.keys(this.hooks).forEach(k => this.hooks[k] = []);
  }
}

// Default instance
const defaultRegistry = new AdminRegistry();

module.exports = {
  AdminRegistry,
  ExtensionType,
  defaultRegistry,
};

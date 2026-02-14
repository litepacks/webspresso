/**
 * Admin Panel Registry Unit Tests
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AdminRegistry, ExtensionType } from '../../plugins/admin-panel/core/registry.js';

describe('AdminRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new AdminRegistry();
  });

  describe('Pages', () => {
    it('should register a page', () => {
      registry.registerPage('test-page', {
        title: 'Test Page',
        path: '/test',
        icon: 'test',
      });

      const pages = registry.getPages();
      expect(pages).toHaveLength(1);
      expect(pages[0].id).toBe('test-page');
      expect(pages[0].title).toBe('Test Page');
      expect(pages[0].path).toBe('/test');
      expect(pages[0].type).toBe(ExtensionType.PAGE);
    });

    it('should throw if page is missing title', () => {
      expect(() => {
        registry.registerPage('test-page', { path: '/test' });
      }).toThrow('Page "test-page" requires title and path');
    });

    it('should throw if page is missing path', () => {
      expect(() => {
        registry.registerPage('test-page', { title: 'Test' });
      }).toThrow('Page "test-page" requires title and path');
    });
  });

  describe('Widgets', () => {
    it('should register a widget', () => {
      registry.registerWidget('test-widget', {
        title: 'Test Widget',
        size: 'lg',
        order: 5,
      });

      const widgets = registry.getWidgets();
      expect(widgets).toHaveLength(1);
      expect(widgets[0].id).toBe('test-widget');
      expect(widgets[0].size).toBe('lg');
      expect(widgets[0].order).toBe(5);
    });

    it('should use default size and order', () => {
      registry.registerWidget('test-widget', {
        title: 'Test Widget',
      });

      const widgets = registry.getWidgets();
      expect(widgets[0].size).toBe('md');
      expect(widgets[0].order).toBe(0);
    });

    it('should sort widgets by order', () => {
      registry.registerWidget('widget-c', { title: 'C', order: 30 });
      registry.registerWidget('widget-a', { title: 'A', order: 10 });
      registry.registerWidget('widget-b', { title: 'B', order: 20 });

      const widgets = registry.getWidgets();
      expect(widgets[0].id).toBe('widget-a');
      expect(widgets[1].id).toBe('widget-b');
      expect(widgets[2].id).toBe('widget-c');
    });
  });

  describe('Actions', () => {
    it('should register an action', () => {
      registry.registerAction('test-action', {
        label: 'Test Action',
        handler: () => {},
        models: 'User',
      });

      const actions = registry.getActionsForModel('User');
      expect(actions).toHaveLength(1);
      expect(actions[0].label).toBe('Test Action');
    });

    it('should filter actions by model', () => {
      registry.registerAction('user-action', {
        label: 'User Action',
        handler: () => {},
        models: 'User',
      });
      registry.registerAction('post-action', {
        label: 'Post Action',
        handler: () => {},
        models: 'Post',
      });
      registry.registerAction('global-action', {
        label: 'Global Action',
        handler: () => {},
        models: '*',
      });

      const userActions = registry.getActionsForModel('User');
      expect(userActions).toHaveLength(2); // user-action + global-action

      const postActions = registry.getActionsForModel('Post');
      expect(postActions).toHaveLength(2); // post-action + global-action
    });

    it('should support array of models', () => {
      registry.registerAction('multi-action', {
        label: 'Multi Action',
        handler: () => {},
        models: ['User', 'Post'],
      });

      expect(registry.getActionsForModel('User')).toHaveLength(1);
      expect(registry.getActionsForModel('Post')).toHaveLength(1);
      expect(registry.getActionsForModel('Comment')).toHaveLength(0);
    });
  });

  describe('Bulk Actions', () => {
    it('should register a bulk action', () => {
      registry.registerBulkAction('bulk-delete', {
        label: 'Delete All',
        handler: () => {},
      });

      const actions = registry.getBulkActionsForModel('User');
      expect(actions).toHaveLength(1);
      expect(actions[0].confirm).toBe(true); // Default
    });
  });

  describe('Menu Items', () => {
    it('should register menu item', () => {
      registry.registerMenuItem({
        id: 'test-item',
        label: 'Test Item',
        path: '/test',
        order: 10,
      });

      const menu = registry.getMenu();
      expect(menu).toHaveLength(1);
      expect(menu[0].id).toBe('test-item');
    });

    it('should sort menu items by order', () => {
      registry.registerMenuItem({ id: 'c', label: 'C', path: '/c', order: 30 });
      registry.registerMenuItem({ id: 'a', label: 'A', path: '/a', order: 10 });
      registry.registerMenuItem({ id: 'b', label: 'B', path: '/b', order: 20 });

      const menu = registry.getMenu();
      expect(menu[0].id).toBe('a');
      expect(menu[1].id).toBe('b');
      expect(menu[2].id).toBe('c');
    });
  });

  describe('Menu Groups', () => {
    it('should register menu group with items', () => {
      registry.registerMenuGroup('content', {
        label: 'Content',
        order: 0,
      });

      registry.registerMenuItem({
        id: 'posts',
        label: 'Posts',
        path: '/posts',
        group: 'content',
      });

      registry.registerMenuItem({
        id: 'pages',
        label: 'Pages',
        path: '/pages',
        group: 'content',
      });

      const menu = registry.getMenu();
      const contentGroup = menu.find(m => m.id === 'content');
      expect(contentGroup).toBeDefined();
      expect(contentGroup.items).toHaveLength(2);
    });
  });

  describe('Field Renderers', () => {
    it('should register field renderer', () => {
      registry.registerFieldRenderer('color', {
        display: () => 'display',
        edit: () => 'edit',
      });

      expect(registry.fieldRenderers.has('color')).toBe(true);
    });

    it('should throw if display or edit is missing', () => {
      expect(() => {
        registry.registerFieldRenderer('color', { display: () => {} });
      }).toThrow();
    });
  });

  describe('Hooks', () => {
    it('should register and run hooks', async () => {
      let called = false;
      registry.registerHook('beforeCreate', () => {
        called = true;
      });

      await registry.runHooks('beforeCreate', {});
      expect(called).toBe(true);
    });

    it('should run multiple hooks in order', async () => {
      const order = [];
      registry.registerHook('beforeCreate', () => order.push(1));
      registry.registerHook('beforeCreate', () => order.push(2));
      registry.registerHook('beforeCreate', () => order.push(3));

      await registry.runHooks('beforeCreate', {});
      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe('Settings', () => {
    it('should configure settings', () => {
      registry.configure({
        title: 'My Admin',
        primaryColor: '#FF0000',
        perPage: 50,
      });

      expect(registry.settings.title).toBe('My Admin');
      expect(registry.settings.primaryColor).toBe('#FF0000');
      expect(registry.settings.perPage).toBe(50);
    });

    it('should merge with existing settings', () => {
      registry.configure({ title: 'Admin 1' });
      registry.configure({ perPage: 25 });

      expect(registry.settings.title).toBe('Admin 1');
      expect(registry.settings.perPage).toBe(25);
    });
  });

  describe('User Management', () => {
    it('should enable user management', () => {
      registry.enableUserManagement({
        model: 'Account',
        fields: { email: 'user_email' },
      });

      expect(registry.userManagement.enabled).toBe(true);
      expect(registry.userManagement.model).toBe('Account');
      expect(registry.userManagement.fields.email).toBe('user_email');
      expect(registry.userManagement.fields.password).toBe('password'); // Default
    });
  });

  describe('Client Config', () => {
    it('should serialize config for client', () => {
      registry.configure({ title: 'Test Admin' });
      registry.registerWidget('stats', { title: 'Stats' });
      registry.registerPage('settings', { title: 'Settings', path: '/settings' });

      const config = registry.toClientConfig();

      expect(config.settings.title).toBe('Test Admin');
      expect(config.widgets).toHaveLength(1);
      expect(config.pages).toHaveLength(1);
      expect(config.pages[0].id).toBe('settings');
    });
  });

  describe('Clear', () => {
    it('should clear all registrations', () => {
      registry.registerPage('page', { title: 'Page', path: '/page' });
      registry.registerWidget('widget', { title: 'Widget' });
      registry.registerMenuItem({ id: 'item', label: 'Item', path: '/item' });

      registry.clear();

      expect(registry.getPages()).toHaveLength(0);
      expect(registry.getWidgets()).toHaveLength(0);
      expect(registry.getMenu()).toHaveLength(0);
    });
  });
});

/**
 * Unit tests for File Manager Plugin Definition & Lifecycle Integration
 * @vitest-environment node
 */

import { describe, it, expect, vi } from 'vitest';
import fileManagerPlugin, { core, security } from '../../../plugins/file-manager/index';

describe('File Manager Plugin Definition', () => {
  it('exports plugin factory and core/security modules', () => {
    expect(typeof fileManagerPlugin).toBe('function');
    expect(core).toBeDefined();
    expect(security).toBeDefined();
    expect(fileManagerPlugin.core).toBe(core);
    expect(fileManagerPlugin.security).toBe(security);
  });

  it('creates plugin with default configuration and metadata', () => {
    const plugin = fileManagerPlugin();
    expect(plugin.name).toBe('file-manager');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.dependencies).toEqual({ 'admin-panel': '*' });
    expect(plugin.api).toBeDefined();
    expect(plugin.api.security).toBe(security);
    expect(typeof plugin.register).toBe('function');
    expect(typeof plugin.onRoutesReady).toBe('function');
  });

  it('supports lazy plugin wrapper when lazy option is enabled', () => {
    const plugin = fileManagerPlugin({ lazy: true });
    expect(plugin.name).toBe('file-manager');
    expect(plugin.isLazy).toBe(true);
    expect(typeof plugin.register).toBe('function');
  });

  it('registers services in serviceRegistry on register hook', () => {
    const registeredServices = {};
    const mockServiceRegistry = {
      has: (name) => name in registeredServices,
      register: (name, def) => {
        registeredServices[name] = def;
      },
    };

    const plugin = fileManagerPlugin();
    plugin.register({
      app: {
        serviceRegistry: mockServiceRegistry,
      },
    });

    expect(registeredServices['fileManager.list']).toBeDefined();
    expect(registeredServices['fileManager.upload']).toBeDefined();
    expect(registeredServices['fileManager.delete']).toBeDefined();
    expect(registeredServices['fileManager.mkdir']).toBeDefined();
  });

  it('warns and gracefully returns if admin-panel plugin is missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugin = fileManagerPlugin();

    const ctx = {
      usePlugin: vi.fn().mockReturnValue(null),
    };

    plugin.onRoutesReady(ctx);
    expect(ctx.usePlugin).toHaveBeenCalledWith('admin-panel');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('admin-panel plugin not found'));
    warnSpy.mockRestore();
  });

  it('configures admin registry and registers admin module with pages by default', () => {
    const plugin = fileManagerPlugin({
      apiPrefix: '/custom-files',
      publicBasePath: '/custom-uploads',
      pageTitle: 'Media Manager',
      menuLabel: 'Media',
      menuOrder: 15,
    });

    const configuredSettings = {};
    let clientComponentRegistered = null;
    let registeredModule = null;

    const mockRegistry = {
      configure: (cfg) => {
        Object.assign(configuredSettings, cfg);
      },
      registerClientComponent: (name, code) => {
        clientComponentRegistered = { name, code };
      },
    };

    const mockAdminApi = {
      getRegistry: () => mockRegistry,
      registerModule: (mod) => {
        registeredModule = mod;
      },
    };

    const ctx = {
      usePlugin: vi.fn().mockReturnValue(mockAdminApi),
    };

    plugin.onRoutesReady(ctx);

    expect(configuredSettings.fileManager).toEqual({
      enabled: true,
      apiPrefix: '/custom-files',
      publicBasePath: '/custom-uploads',
      pageTitle: 'Media Manager',
    });
    expect(clientComponentRegistered.name).toBe('files');
    expect(typeof clientComponentRegistered.code).toBe('string');

    expect(registeredModule.id).toBe('files');
    expect(registeredModule.pages).toHaveLength(1);
    expect(registeredModule.pages[0].title).toBe('Media Manager');
    expect(registeredModule.pages[0].path).toBe('/files');
    expect(registeredModule.menu).toHaveLength(1);
    expect(registeredModule.menu[0].label).toBe('Media');
    expect(registeredModule.menu[0].order).toBe(15);

    expect(registeredModule.api.prefix).toBe('/custom-files');
    expect(registeredModule.api.routes).toHaveLength(14); // core CRUD + image/content editing, batch ops, ZIP, storage stats
    const routeMethods = registeredModule.api.routes.map((r) => `${r.method.toUpperCase()} ${r.path}`);
    expect(routeMethods).toContain('GET ');
    expect(routeMethods).toContain('POST /mkdir');
    expect(routeMethods).toContain('POST /rename');
    expect(routeMethods).toContain('POST /move');
    expect(routeMethods).toContain('POST /delete');
    expect(routeMethods).toContain('POST /upload');
    expect(routeMethods).toEqual(expect.arrayContaining([
      'POST /save-image', 'GET /content', 'POST /save-content', 'POST /batch-delete',
      'POST /batch-move', 'GET /download-zip', 'POST /download-zip', 'GET /storage-stats',
    ]));
  });

  it('omits admin page and menu when includePage is false', () => {
    const plugin = fileManagerPlugin({ includePage: false });

    let registeredModule = null;
    const mockAdminApi = {
      getRegistry: () => null,
      registerModule: (mod) => {
        registeredModule = mod;
      },
    };

    const ctx = {
      usePlugin: vi.fn().mockReturnValue(mockAdminApi),
    };

    plugin.onRoutesReady(ctx);

    expect(registeredModule.pages).toHaveLength(0);
    expect(registeredModule.menu).toHaveLength(0);
    expect(registeredModule.api.routes.length).toBeGreaterThan(0);
  });
});

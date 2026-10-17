/**
 * Unit tests for MCP Plugin Definition & Lifecycle Integration
 * @vitest-environment node
 */

import { describe, it, expect, vi } from 'vitest';
import {
  mcpPlugin,
  McpServer,
  createMcpServer,
  createMcpAuthMiddleware,
  createBuiltinPrompts,
} from '../../../plugins/mcp/index';

describe('MCP Plugin Definition', () => {
  it('exports MCP factory functions and utilities', () => {
    expect(typeof mcpPlugin).toBe('function');
    expect(McpServer).toBeDefined();
    expect(typeof createMcpServer).toBe('function');
    expect(typeof createMcpAuthMiddleware).toBe('function');
    expect(typeof createBuiltinPrompts).toBe('function');

    const srv = createMcpServer({ name: 'test-srv' });
    expect(srv).toBeInstanceOf(McpServer);
  });

  it('creates plugin with default configuration and api delegates', () => {
    const plugin = mcpPlugin();
    expect(plugin.name).toBe('mcp');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.dependencies).toEqual([]);
    expect(plugin.api).toBeDefined();
    expect(plugin.api.getServer()).toBeNull();

    // Calling delegates before server instance exists should not throw
    expect(plugin.api.registerTool({ name: 'dummy' })).toBeNull();
    expect(plugin.api.registerResource({ uri: 'dummy' })).toBeNull();
    expect(plugin.api.registerPrompt({ name: 'dummy' })).toBeNull();
  });

  it('does nothing on register and onRoutesReady when enabled is false', () => {
    const plugin = mcpPlugin({ enabled: false });
    const ctx = {
      app: {},
      usePlugin: vi.fn(),
    };

    plugin.register(ctx);
    expect(plugin.api.getServer()).toBeNull();
    expect(ctx.mcp).toBeUndefined();

    plugin.onRoutesReady(ctx);
    expect(plugin.api.getServer()).toBeNull();
  });

  it('initializes McpServer, extra tools, resources, and builtin prompts on register hook', () => {
    const customTool = {
      name: 'ping_tool',
      description: 'Ping',
      parameters: { type: 'object', properties: {} },
      handler: vi.fn().mockResolvedValue({ status: 'pong' }),
    };

    const customResource = {
      uri: 'custom://schema',
      name: 'Custom Schema',
      handler: vi.fn().mockResolvedValue({ text: '{}' }),
    };

    const customTemplate = {
      uriTemplate: 'custom://users/{id}',
      name: 'User Template',
      handler: vi.fn().mockResolvedValue({ text: 'user' }),
    };

    const customPrompt = {
      name: 'review_prompt',
      description: 'Review code',
      handler: vi.fn().mockReturnValue({ messages: [] }),
    };

    const plugin = mcpPlugin({
      name: 'my-custom-mcp',
      version: '2.0.0',
      instructions: 'You are an assistant',
      tools: [customTool],
      resources: [customResource, customTemplate],
      prompts: [customPrompt],
    });

    const ctx = {
      app: { id: 'test-app' },
    };

    plugin.register(ctx);

    const server = plugin.api.getServer();
    expect(server).toBeInstanceOf(McpServer);
    expect(server.name).toBe('my-custom-mcp');
    expect(server.version).toBe('2.0.0');
    expect(server.instructions).toBe('You are an assistant');

    // Context mcp export
    expect(ctx.mcp).toBeDefined();
    expect(ctx.mcp.server).toBe(server);

    // Verify extra tool registration
    expect(server.tools.has('ping_tool')).toBe(true);

    // Test API registerTool/Resource/Prompt delegates
    plugin.api.registerTool({
      name: 'api_tool',
      description: 'Added via API',
      parameters: { type: 'object', properties: {} },
      handler: vi.fn(),
    });
    expect(server.tools.has('api_tool')).toBe(true);
  });

  it('bridges services, ORM models, system resources, and mounts SSE transport in onRoutesReady', () => {
    const plugin = mcpPlugin({
      path: '/custom_mcp',
      discovery: false, // Disable directory scan in unit test
      auth: { token: 'secret-token-123' },
      services: { readOnly: true },
      orm: { readOnly: true },
      system: true,
    });

    const mockApp = {
      routes: [],
      get: vi.fn(),
      post: vi.fn(),
      use: vi.fn(),
    };

    const mockServiceRegistry = {
      list: vi.fn().mockReturnValue(['user.find']),
      get: vi.fn().mockReturnValue({
        name: 'user.find',
        description: 'Find user',
        schema: null,
        handler: vi.fn(),
      }),
    };

    const mockDb = {
      models: new Map(),
      getRepository: vi.fn(),
    };

    const ctx = {
      app: mockApp,
      db: mockDb,
      options: {
        serviceRegistry: mockServiceRegistry,
      },
      routes: [{ method: 'get', path: '/api/test' }],
    };

    plugin.register(ctx);
    plugin.onRoutesReady(ctx);

    const server = plugin.api.getServer();
    expect(server.context.db).toBe(mockDb);
    expect(server.context.serviceRegistry).toBe(mockServiceRegistry);

    // Verify transport routes mounted on Express app
    expect(mockApp.get).toHaveBeenCalledWith('/custom_mcp/sse', expect.any(Function), expect.any(Function));
    expect(mockApp.post).toHaveBeenCalledWith('/custom_mcp/messages', expect.any(Function), expect.any(Function));
  });
});

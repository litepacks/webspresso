const { z } = require('zod');
const { ServiceRegistry } = require('../../../src/services/registry');
const {
  createServiceTools,
  serviceNameToToolName,
  toolNameToServiceName,
  isMutationService,
} = require('../../../plugins/mcp/providers/services');

describe('MCP Services Provider', () => {
  let registry;

  beforeEach(() => {
    registry = new ServiceRegistry();

    // Register a query service
    registry.register('user.get', {
      description: 'Fetch user details by ID',
      schema: z.object({
        id: z.number().int().positive(),
      }),
      handler: async ({ id }) => {
        return { id, name: 'Alice', email: 'alice@example.com' };
      },
    });

    // Register a mutation service
    registry.register('user.create', {
      description: 'Register a new user',
      schema: z.object({
        name: z.string().min(2),
        email: z.string().email(),
      }),
      handler: async ({ name, email }) => {
        return { id: 99, name, email };
      },
    });

    // Register an internal service
    registry.register('system.cache.clear', {
      description: 'Clear system cache',
      handler: async () => ({ cleared: true }),
    });
  });

  it('should convert service names to valid MCP tool names', () => {
    expect(serviceNameToToolName('user.get')).toBe('service__user__get');
    expect(serviceNameToToolName('billing.invoice.generate')).toBe('service__billing__invoice__generate');
    expect(toolNameToServiceName('service__user__get')).toBe('user.get');
  });

  it('should detect mutation services accurately', () => {
    expect(isMutationService('user.create')).toBe(true);
    expect(isMutationService('order.delete')).toBe(true);
    expect(isMutationService('user.get')).toBe(false);
    expect(isMutationService('catalog.list')).toBe(false);
  });

  it('should convert registered services to MCP tools with JSON Schema input', () => {
    const tools = createServiceTools({ registry });
    expect(tools.length).toBe(3);

    const userGetTool = tools.find((t) => t.name === 'service__user__get');
    expect(userGetTool).toBeDefined();
    expect(userGetTool.description).toContain('Fetch user details by ID');
    expect(userGetTool.inputSchema.properties.id.type).toBe('integer');

    const userCreateTool = tools.find((t) => t.name === 'service__user__create');
    expect(userCreateTool).toBeDefined();
    expect(userCreateTool.inputSchema.properties.email.type).toBe('string');
  });

  it('should execute service through tool handler', async () => {
    const tools = createServiceTools({ registry });
    const userGetTool = tools.find((t) => t.name === 'service__user__get');

    const result = await userGetTool.handler({ id: 10 }, {});
    expect(result).toEqual({ id: 10, name: 'Alice', email: 'alice@example.com' });
  });

  it('should filter out mutations when readOnly is enabled', () => {
    const tools = createServiceTools({ registry, readOnly: true });
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain('service__user__get');
    expect(toolNames).not.toContain('service__user__create');
    expect(toolNames).not.toContain('service__system__cache__clear');
  });

  it('should respect include and exclude patterns', () => {
    const tools = createServiceTools({
      registry,
      include: ['user.*'],
      exclude: ['user.create'],
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toEqual(['service__user__get']);
  });
});

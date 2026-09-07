const { McpServer, PROTOCOL_VERSION, ERROR_CODES } = require('../../../plugins/mcp/server');

describe('MCP Server Engine (JSON-RPC 2.0)', () => {
  let server;

  beforeEach(() => {
    server = new McpServer({
      name: 'test-mcp',
      version: '1.2.3',
      instructions: 'Test instructions',
    });
  });

  describe('Initialization & Lifecycle', () => {
    it('should handle initialize request and return protocol version and capabilities', async () => {
      const initMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          clientInfo: { name: 'antigravity-test', version: '1.0' },
        },
      };

      const res = await server.handleMessage(initMessage);
      expect(res.jsonrpc).toBe('2.0');
      expect(res.id).toBe(1);
      expect(res.result.protocolVersion).toBe(PROTOCOL_VERSION);
      expect(res.result.serverInfo).toEqual({
        name: 'test-mcp',
        version: '1.2.3',
      });
      expect(res.result.capabilities.tools).toBeDefined();
      expect(res.result.capabilities.resources).toBeDefined();
      expect(res.result.capabilities.prompts).toBeDefined();
      expect(res.result.instructions).toBe('Test instructions');
      expect(server.clientInfo).toEqual({ name: 'antigravity-test', version: '1.0' });
    });

    it('should handle notifications/initialized without response', async () => {
      const notifyMessage = {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      };

      const res = await server.handleMessage(notifyMessage);
      expect(res).toBeNull();
      expect(server.isInitialized).toBe(true);
    });

    it('should handle ping request', async () => {
      const pingMessage = {
        jsonrpc: '2.0',
        id: 'req-ping',
        method: 'ping',
      };

      const res = await server.handleMessage(pingMessage);
      expect(res).toEqual({
        jsonrpc: '2.0',
        id: 'req-ping',
        result: {},
      });
    });
  });

  describe('Tools Handling', () => {
    beforeEach(() => {
      server.registerTool({
        name: 'calculator_add',
        description: 'Add two numbers',
        inputSchema: {
          type: 'object',
          properties: {
            a: { type: 'number' },
            b: { type: 'number' },
          },
          required: ['a', 'b'],
        },
        handler: async ({ a, b }) => {
          return { sum: a + b };
        },
      });

      server.registerTool({
        name: 'throw_error',
        description: 'Throws an error',
        handler: async () => {
          throw new Error('Database locked');
        },
      });
    });

    it('should list registered tools via tools/list', async () => {
      const res = await server.handleMessage({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/list',
      });

      expect(res.result.tools).toHaveLength(2);
      expect(res.result.tools[0]).toEqual({
        name: 'calculator_add',
        description: 'Add two numbers',
        inputSchema: {
          type: 'object',
          properties: {
            a: { type: 'number' },
            b: { type: 'number' },
          },
          required: ['a', 'b'],
        },
      });
    });

    it('should execute tool via tools/call and return structured MCP content', async () => {
      const res = await server.handleMessage({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'calculator_add',
          arguments: { a: 5, b: 7 },
        },
      });

      expect(res.id).toBe(11);
      expect(res.result.isError).toBe(false);
      expect(res.result.content).toHaveLength(1);
      expect(res.result.content[0].type).toBe('text');
      const parsed = JSON.parse(res.result.content[0].text);
      expect(parsed).toEqual({ sum: 12 });
    });

    it('should gracefully handle tool execution errors with isError: true', async () => {
      const res = await server.handleMessage({
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'throw_error',
        },
      });

      expect(res.id).toBe(12);
      expect(res.result.isError).toBe(true);
      expect(res.result.content[0].text).toContain('Database locked');
    });

    it('should return error if tool does not exist', async () => {
      const res = await server.handleMessage({
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: {
          name: 'non_existent_tool',
        },
      });

      expect(res.result.isError).toBe(true);
      expect(res.result.content[0].text).toContain('Tool "non_existent_tool" not found');
    });
  });

  describe('Resources Handling', () => {
    beforeEach(() => {
      server.registerResource({
        uri: 'webspresso://info',
        name: 'System Info',
        description: 'Basic system info',
        handler: async () => ({ version: '1.0', framework: 'Webspresso' }),
      });

      server.registerResourceTemplate({
        uriTemplate: 'webspresso://user/{id}',
        name: 'User Resource',
        handler: async (uri, params) => ({ userId: params.id, name: `User ${params.id}` }),
      });
    });

    it('should list static resources via resources/list', async () => {
      const res = await server.handleMessage({
        jsonrpc: '2.0',
        id: 20,
        method: 'resources/list',
      });

      expect(res.result.resources).toHaveLength(1);
      expect(res.result.resources[0].uri).toBe('webspresso://info');
    });

    it('should list resource templates via resources/templates/list', async () => {
      const res = await server.handleMessage({
        jsonrpc: '2.0',
        id: 21,
        method: 'resources/templates/list',
      });

      expect(res.result.resourceTemplates).toHaveLength(1);
      expect(res.result.resourceTemplates[0].uriTemplate).toBe('webspresso://user/{id}');
    });

    it('should read static resource via resources/read', async () => {
      const res = await server.handleMessage({
        jsonrpc: '2.0',
        id: 22,
        method: 'resources/read',
        params: { uri: 'webspresso://info' },
      });

      expect(res.result.contents).toHaveLength(1);
      expect(res.result.contents[0].uri).toBe('webspresso://info');
      const data = JSON.parse(res.result.contents[0].text);
      expect(data).toEqual({ version: '1.0', framework: 'Webspresso' });
    });

    it('should read template resource via resources/read matching uri pattern', async () => {
      const res = await server.handleMessage({
        jsonrpc: '2.0',
        id: 23,
        method: 'resources/read',
        params: { uri: 'webspresso://user/42' },
      });

      expect(res.result.contents).toHaveLength(1);
      const data = JSON.parse(res.result.contents[0].text);
      expect(data).toEqual({ userId: '42', name: 'User 42' });
    });

    it('should return error for unmapped resource uri', async () => {
      const res = await server.handleMessage({
        jsonrpc: '2.0',
        id: 24,
        method: 'resources/read',
        params: { uri: 'webspresso://unknown' },
      });

      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    });
  });

  describe('Prompts Handling', () => {
    beforeEach(() => {
      server.registerPrompt({
        name: 'test_prompt',
        description: 'Test prompt template',
        arguments: [{ name: 'feature', required: true }],
        handler: async ({ feature }) => {
          return `Please implement ${feature}.`;
        },
      });
    });

    it('should list prompts via prompts/list', async () => {
      const res = await server.handleMessage({
        jsonrpc: '2.0',
        id: 30,
        method: 'prompts/list',
      });

      expect(res.result.prompts).toHaveLength(1);
      expect(res.result.prompts[0].name).toBe('test_prompt');
    });

    it('should retrieve prompt messages via prompts/get', async () => {
      const res = await server.handleMessage({
        jsonrpc: '2.0',
        id: 31,
        method: 'prompts/get',
        params: {
          name: 'test_prompt',
          arguments: { feature: 'auth-tokens' },
        },
      });

      expect(res.result.description).toBe('Test prompt template');
      expect(res.result.messages[0].content.text).toBe('Please implement auth-tokens.');
    });
  });

  describe('Error Cases', () => {
    it('should return METHOD_NOT_FOUND for unsupported methods', async () => {
      const res = await server.handleMessage({
        jsonrpc: '2.0',
        id: 40,
        method: 'invalid/method',
      });

      expect(res.error.code).toBe(ERROR_CODES.METHOD_NOT_FOUND);
    });

    it('should return INVALID_REQUEST for non-object messages', async () => {
      const res = await server.handleMessage('not-an-object');
      expect(res.error.code).toBe(ERROR_CODES.INVALID_REQUEST);
    });
  });
});

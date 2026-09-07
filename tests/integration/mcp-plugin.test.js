const http = require('http');
const request = require('supertest');
const { z } = require('zod');
const { createApp, createDatabase, defineModel, zdb, clearRegistry } = require('../../index');
const { createServiceRegistry } = require('../../src/services');
const { mcpPlugin } = require('../../plugins/mcp');

describe('MCP Plugin Full Integration', () => {
  let app;
  let db;
  let serviceRegistry;

  beforeEach(async () => {
    clearRegistry();

    // 1. Setup in-memory DB
    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      models: './tests/fixtures/models-empty',
    });

    const Item = defineModel({
      name: 'Item',
      table: 'items',
      schema: z.object({
        id: zdb.id(),
        name: z.string().min(1),
        price: z.number().default(0),
      }),
      admin: { enabled: true },
    });
    db.registerModel(Item);

    await db.knex.schema.createTable('items', (table) => {
      table.bigIncrements('id');
      table.string('name');
      table.decimal('price').defaultTo(0);
    });

    const itemRepo = db.getRepository('Item');
    await itemRepo.create({ name: 'Laptop', price: 999.99 });

    // 2. Setup Service Registry
    serviceRegistry = createServiceRegistry({ autoLoad: false });
    serviceRegistry.register('math.multiply', {
      description: 'Multiply two numbers together',
      schema: z.object({
        x: z.number(),
        y: z.number(),
      }),
      handler: async ({ x, y }) => ({ result: x * y }),
    });

    // 3. Create Webspresso app with mcpPlugin
    const serverInstance = createApp({
      pagesDir: './tests/fixtures/pages-empty',
      db,
      serviceRegistry,
      plugins: [
        mcpPlugin({
          path: '/_mcp',
          auth: {
            token: 'test-secret-token',
          },
          services: {
            role: 'admin',
          },
          orm: {
            readOnly: false,
          },
        }),
      ],
    });

    app = serverInstance.app;
  });

  afterEach(async () => {
    if (db && db.destroy) {
      await db.destroy();
    }
  });

  it('should reject unauthorized requests when token is configured', async () => {
    const res = await request(app)
      .post('/_mcp')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'ping',
      });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toContain('Unauthorized');
  });

  it('should execute direct JSON-RPC initialize and ping requests with valid token', async () => {
    // 1. Initialize
    const initRes = await request(app)
      .post('/_mcp')
      .set('Authorization', 'Bearer test-secret-token')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05' },
      });

    expect(initRes.status).toBe(200);
    expect(initRes.body.result.serverInfo.name).toBe('webspresso-mcp');
    expect(initRes.body.result.capabilities.tools).toBeDefined();

    // 2. Ping
    const pingRes = await request(app)
      .post('/_mcp')
      .set('Authorization', 'Bearer test-secret-token')
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'ping',
      });

    expect(pingRes.status).toBe(200);
    expect(pingRes.body.result).toEqual({});
  });

  it('should list tools and execute service tool via POST /_mcp', async () => {
    // 1. tools/list
    const listRes = await request(app)
      .post('/_mcp')
      .set('Authorization', 'Bearer test-secret-token')
      .send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
      });

    expect(listRes.status).toBe(200);
    const tools = listRes.body.result.tools;
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain('service__math__multiply');
    expect(toolNames).toContain('orm_find');
    expect(toolNames).toContain('orm_create');

    // 2. tools/call service__math__multiply
    const callRes = await request(app)
      .post('/_mcp')
      .set('Authorization', 'Bearer test-secret-token')
      .send({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'service__math__multiply',
          arguments: { x: 7, y: 6 },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result.isError).toBe(false);
    const resultObj = JSON.parse(callRes.body.result.content[0].text);
    expect(resultObj).toEqual({ result: 42 });
  });

  it('should execute ORM tool to query database via POST /_mcp', async () => {
    const callRes = await request(app)
      .post('/_mcp')
      .set('Authorization', 'Bearer test-secret-token')
      .send({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'orm_find',
          arguments: { model: 'Item', where: { name: 'Laptop' } },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result.isError).toBe(false);
    const resultObj = JSON.parse(callRes.body.result.content[0].text);
    expect(resultObj.data).toHaveLength(1);
    expect(resultObj.data[0].name).toBe('Laptop');
  });

  it('should read resources via POST /_mcp', async () => {
    const readRes = await request(app)
      .post('/_mcp')
      .set('Authorization', 'Bearer test-secret-token')
      .send({
        jsonrpc: '2.0',
        id: 6,
        method: 'resources/read',
        params: { uri: 'webspresso://models' },
      });

    expect(readRes.status).toBe(200);
    const contents = readRes.body.result.contents;
    expect(contents).toHaveLength(1);
    const models = JSON.parse(contents[0].text);
    expect(models.some((m) => m.name === 'Item')).toBe(true);
  });

  it('should initiate SSE connection and send messages', async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    let clientReq;
    const sessionId = await new Promise((resolve, reject) => {
      clientReq = http.get(`http://127.0.0.1:${port}/_mcp/sse?token=test-secret-token`, (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('text/event-stream');

        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          if (buffer.includes('event: endpoint')) {
            const match = buffer.match(/sessionId=([a-zA-Z0-9-]+)/);
            if (match) {
              resolve(match[1]);
            }
          }
        });
      });
      clientReq.on('error', reject);
    });

    expect(sessionId).toBeDefined();

    // 2. POST /_mcp/messages?sessionId=...
    const postRes = await request(app)
      .post(`/_mcp/messages?sessionId=${sessionId}&token=test-secret-token`)
      .send({
        jsonrpc: '2.0',
        id: 7,
        method: 'ping',
      });

    expect(postRes.status).toBe(202);
    expect(postRes.text).toBe('Accepted');

    clientReq.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
});

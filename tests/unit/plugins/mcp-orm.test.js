const { z } = require('zod');
const { createDatabase, defineModel, zdb, clearRegistry } = require('../../../index');
const { createOrmTools, createOrmResources, describeModel } = require('../../../plugins/mcp/providers/orm');

describe('MCP ORM Provider', () => {
  let db;

  beforeEach(async () => {
    clearRegistry();
    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      models: './tests/fixtures/models-empty',
    });

    const Article = defineModel({
      name: 'Article',
      table: 'articles',
      schema: z.object({
        id: zdb.id(),
        title: z.string().min(1),
        views: z.number().default(0),
        published: z.boolean().default(true),
      }),
      relations: {
        author: { type: 'belongsTo', model: () => 'User', foreignKey: 'authorId' },
      },
      admin: { enabled: true },
    });

    db.registerModel(Article);

    await db.knex.schema.createTable('articles', (table) => {
      table.bigIncrements('id');
      table.string('title');
      table.integer('views').defaultTo(0);
      table.boolean('published').defaultTo(true);
      table.integer('authorId').nullable();
    });

    // Seed a record
    const repo = db.getRepository('Article');
    await repo.create({ title: 'First Post', views: 42, published: true });
  });

  afterEach(async () => {
    if (db && db.destroy) {
      await db.destroy();
    }
  });

  it('should describe an ORM model accurately', () => {
    const articleModel = db.getModel('Article');
    const desc = describeModel(articleModel);

    expect(desc.name).toBe('Article');
    expect(desc.table).toBe('articles');
    expect(desc.primaryKey).toBe('id');
    expect(desc.columns.title).toBeDefined();
    expect(desc.relations.author).toEqual({
      type: 'belongsTo',
      targetModel: 'User',
      foreignKey: 'authorId',
    });
  });

  it('should create ORM tools and execute queries', async () => {
    const tools = createOrmTools({ db });
    const findTool = tools.find((t) => t.name === 'orm_find');
    const findByIdTool = tools.find((t) => t.name === 'orm_findById');
    const describeTool = tools.find((t) => t.name === 'orm_describe_model');

    expect(findTool).toBeDefined();
    expect(findByIdTool).toBeDefined();
    expect(describeTool).toBeDefined();

    // 1. orm_describe_model
    const descResult = await describeTool.handler({ model: 'Article' });
    expect(descResult.name).toBe('Article');

    // 2. orm_find
    const findResult = await findTool.handler({ model: 'Article', where: { title: 'First Post' } });
    expect(findResult.data).toHaveLength(1);
    expect(findResult.data[0].title).toBe('First Post');

    // 3. orm_findById
    const findByIdResult = await findByIdTool.handler({ model: 'Article', id: 1 });
    expect(findByIdResult.found).toBe(true);
    expect(findByIdResult.record.title).toBe('First Post');
  });

  it('should execute create, update, and delete mutations when readOnly is false', async () => {
    const tools = createOrmTools({ db, readOnly: false });
    const createTool = tools.find((t) => t.name === 'orm_create');
    const updateTool = tools.find((t) => t.name === 'orm_update');
    const deleteTool = tools.find((t) => t.name === 'orm_delete');

    expect(createTool).toBeDefined();
    expect(updateTool).toBeDefined();
    expect(deleteTool).toBeDefined();

    // Create
    const created = await createTool.handler({
      model: 'Article',
      data: { title: 'Second Post', views: 100 },
    });
    expect(created.success).toBe(true);
    expect(created.record.title).toBe('Second Post');

    // Update
    const updated = await updateTool.handler({
      model: 'Article',
      id: created.record.id,
      data: { views: 105 },
    });
    expect(updated.success).toBe(true);
    expect(updated.record.views).toBe(105);

    // Delete
    const deleted = await deleteTool.handler({
      model: 'Article',
      id: created.record.id,
    });
    expect(deleted.success).toBe(true);
  });

  it('should exclude create, update, delete when readOnly is true', () => {
    const tools = createOrmTools({ db, readOnly: true });
    const names = tools.map((t) => t.name);

    expect(names).toContain('orm_describe_model');
    expect(names).toContain('orm_find');
    expect(names).toContain('orm_findById');
    expect(names).not.toContain('orm_create');
    expect(names).not.toContain('orm_update');
    expect(names).not.toContain('orm_delete');
  });

  it('should provide webspresso://models and webspresso://schema resources', async () => {
    const { resources, templates } = createOrmResources({ db });
    const modelsRes = resources.find((r) => r.uri === 'webspresso://models');
    const schemaRes = resources.find((r) => r.uri === 'webspresso://schema');

    expect(modelsRes).toBeDefined();
    expect(schemaRes).toBeDefined();

    const modelsData = await modelsRes.handler();
    expect(Array.isArray(modelsData)).toBe(true);
    expect(modelsData.some((m) => m.name === 'Article')).toBe(true);

    const schemaData = await schemaRes.handler();
    expect(schemaData.Article).toBeDefined();
    expect(schemaData.Article.table).toBe('articles');

    // Template
    const modelTemplate = templates.find((t) => t.uriTemplate === 'webspresso://models/{model}');
    const articleDetail = await modelTemplate.handler('webspresso://models/Article', { model: 'Article' });
    expect(articleDetail.name).toBe('Article');
  });
});

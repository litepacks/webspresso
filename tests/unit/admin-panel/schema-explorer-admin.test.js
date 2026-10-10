/**
 * Schema Explorer Admin Panel Integration & Relations Graph Tests
 */

const { z } = require('zod');
const { zdb, defineModel, clearRegistry } = require('../../../core/orm');
const schemaExplorerPlugin = require('../../../plugins/schema-explorer');
const {
  extractAllRelationships,
  enrichModelsWithGraph,
  generateMermaidErDiagram,
} = require('../../../plugins/schema-explorer/relations-graph');
const {
  generateSchemaExplorerAdminComponent,
} = require('../../../plugins/schema-explorer/admin-component');

describe('Schema Explorer Admin & Relations Graph', () => {
  beforeEach(() => {
    clearRegistry();
  });

  describe('Relations Graph Extraction', () => {
    it('should extract explicit ORM relations', () => {
      const Author = defineModel({
        name: 'Author',
        table: 'authors',
        schema: z.object({ id: zdb.id(), name: zdb.string() }),
      });

      const Post = defineModel({
        name: 'Post',
        table: 'posts',
        schema: z.object({
          id: zdb.id(),
          title: zdb.string(),
          author_id: zdb.foreignKey('authors'),
        }),
        relations: {
          author: { type: 'belongsTo', model: () => Author, foreignKey: 'author_id' },
        },
      });

      const plugin = schemaExplorerPlugin();
      const rawModels = plugin.api.getModels();
      const rels = extractAllRelationships(rawModels);

      expect(rels).toHaveLength(1);
      expect(rels[0]).toMatchObject({
        sourceModel: 'Post',
        sourceTable: 'posts',
        targetModel: 'Author',
        targetTable: 'authors',
        type: 'belongsTo',
        name: 'author',
        foreignKey: 'author_id',
        localKey: 'id',
      });
    });

    it('should infer relations from column references when explicit relation is missing', () => {
      defineModel({
        name: 'Category',
        table: 'categories',
        schema: z.object({ id: zdb.id(), title: zdb.string() }),
      });

      defineModel({
        name: 'Product',
        table: 'products',
        schema: z.object({
          id: zdb.id(),
          category_id: zdb.foreignKey('categories'),
        }),
      });

      const plugin = schemaExplorerPlugin();
      const rawModels = plugin.api.getModels();
      const rels = extractAllRelationships(rawModels);

      expect(rels).toHaveLength(1);
      expect(rels[0]).toMatchObject({
        sourceModel: 'Product',
        sourceTable: 'products',
        targetModel: 'Category',
        targetTable: 'categories',
        type: 'belongsTo',
        foreignKey: 'category_id',
        inferred: true,
      });
    });

    it('should enrich models with incoming and outgoing relations', () => {
      const User = defineModel({
        name: 'User',
        table: 'users',
        schema: z.object({ id: zdb.id(), email: zdb.string() }),
      });

      defineModel({
        name: 'Comment',
        table: 'comments',
        schema: z.object({
          id: zdb.id(),
          body: zdb.string(),
          user_id: zdb.foreignKey('users'),
        }),
        relations: {
          user: { type: 'belongsTo', model: () => User, foreignKey: 'user_id' },
        },
      });

      const plugin = schemaExplorerPlugin();
      const enriched = plugin.api.getEnrichedModels();

      const userModel = enriched.find(m => m.name === 'User');
      const commentModel = enriched.find(m => m.name === 'Comment');

      expect(userModel.incomingRelations).toHaveLength(1);
      expect(userModel.incomingRelations[0].sourceModel).toBe('Comment');
      expect(userModel.connectedModels).toContain('Comment');

      expect(commentModel.outgoingRelations).toHaveLength(1);
      expect(commentModel.outgoingRelations[0].targetModel).toBe('User');
      expect(commentModel.connectedModels).toContain('User');
    });

    it('should generate valid Mermaid ER diagram code', () => {
      const User = defineModel({
        name: 'User',
        table: 'users',
        schema: z.object({
          id: zdb.id(),
          email: zdb.string({ unique: true }),
        }),
      });

      defineModel({
        name: 'Article',
        table: 'articles',
        schema: z.object({
          id: zdb.id(),
          title: zdb.string(),
          user_id: zdb.foreignKey('users'),
        }),
        relations: {
          author: { type: 'belongsTo', model: () => User, foreignKey: 'user_id' },
        },
      });

      const plugin = schemaExplorerPlugin();
      const mermaid = plugin.api.getMermaid();

      expect(mermaid).toContain('erDiagram');
      expect(mermaid).toContain('User {');
      expect(mermaid).toContain('id PK');
      expect(mermaid).toContain('email UK');
      expect(mermaid).toContain('Article {');
      expect(mermaid).toContain('user_id FK');
      expect(mermaid).toContain('Article }o--|| User : "author"');
    });
  });

  describe('Admin Panel Module Registration', () => {
    it('should register module into admin-panel when available', () => {
      let registeredConfig = null;

      const mockAdminApi = {
        getAdminPath: () => '/_admin',
        registerModule: (config) => {
          registeredConfig = config;
        },
      };

      const ctx = {
        usePlugin: (name) => {
          if (name === 'admin-panel') return mockAdminApi;
          return null;
        },
        addRoute: () => {},
      };

      const plugin = schemaExplorerPlugin({
        admin: true,
        adminPath: '/database-schema',
        menuLabel: 'Database Schema',
        menuIcon: 'server',
        menuOrder: 42,
      });

      plugin.onRoutesReady(ctx);

      expect(registeredConfig).toBeDefined();
      expect(registeredConfig.id).toBe('schema-explorer');
      expect(registeredConfig.pages).toHaveLength(1);
      expect(registeredConfig.pages[0].title).toBe('Database Schema');
      expect(registeredConfig.pages[0].path).toBe('/database-schema');
      expect(registeredConfig.pages[0].icon).toBe('server');
      expect(registeredConfig.pages[0].component).toContain('SchemaExplorerPage');

      expect(registeredConfig.menu).toHaveLength(1);
      expect(registeredConfig.menu[0].label).toBe('Database Schema');
      expect(registeredConfig.menu[0].path).toBe('/database-schema');
      expect(registeredConfig.menu[0].order).toBe(42);

      expect(registeredConfig.api).toBeDefined();
      expect(registeredConfig.api.prefix).toBe('/schema');
      expect(registeredConfig.api.routes.length).toBeGreaterThanOrEqual(4);
    });

    it('should not register admin module when admin option is false', () => {
      let called = false;

      const mockAdminApi = {
        registerModule: () => { called = true; },
      };

      const ctx = {
        usePlugin: (name) => (name === 'admin-panel' ? mockAdminApi : null),
        addRoute: () => {},
      };

      const plugin = schemaExplorerPlugin({ admin: false });
      plugin.onRoutesReady(ctx);

      expect(called).toBe(false);
    });

    it('should handle admin API endpoints returning schema data and relations', async () => {
      const Company = defineModel({
        name: 'Company',
        table: 'companies',
        schema: z.object({ id: zdb.id(), name: zdb.string() }),
      });

      defineModel({
        name: 'Employee',
        table: 'employees',
        schema: z.object({
          id: zdb.id(),
          company_id: zdb.foreignKey('companies'),
        }),
        relations: {
          company: { type: 'belongsTo', model: () => Company, foreignKey: 'company_id' },
        },
      });

      let registeredConfig = null;
      const ctx = {
        usePlugin: () => ({
          registerModule: (config) => { registeredConfig = config; },
        }),
        addRoute: () => {},
      };

      const plugin = schemaExplorerPlugin();
      plugin.onRoutesReady(ctx);

      const routes = registeredConfig.api.routes;
      const rootRoute = routes.find(r => r.path === '');
      const relationsRoute = routes.find(r => r.path === '/relations');
      const mermaidRoute = routes.find(r => r.path === '/mermaid');
      const singleModelRoute = routes.find(r => r.path === '/models/:modelName');

      expect(rootRoute).toBeDefined();
      expect(relationsRoute).toBeDefined();
      expect(mermaidRoute).toBeDefined();
      expect(singleModelRoute).toBeDefined();

      // Test rootRoute handler
      let rootJson = null;
      await rootRoute.handler({}, {
        json: (val) => { rootJson = val; },
      });

      expect(rootJson.meta.modelCount).toBe(2);
      expect(rootJson.meta.relationCount).toBe(1);
      expect(rootJson.relationships).toHaveLength(1);
      expect(rootJson.mermaid).toContain('erDiagram');

      // Test relationsRoute handler
      let relationsJson = null;
      await relationsRoute.handler({}, {
        json: (val) => { relationsJson = val; },
      });
      expect(relationsJson.relationships).toHaveLength(1);
      expect(relationsJson.relationships[0].sourceModel).toBe('Employee');

      // Test mermaidRoute handler
      let mermaidJson = null;
      await mermaidRoute.handler({}, {
        json: (val) => { mermaidJson = val; },
      });
      expect(mermaidJson.mermaid).toContain('Employee }o--|| Company');

      // Test singleModelRoute handler
      let modelJson = null;
      await singleModelRoute.handler({ params: { modelName: 'Employee' } }, {
        json: (val) => { modelJson = val; },
      });
      expect(modelJson.model.name).toBe('Employee');
      expect(modelJson.model.outgoingRelations).toHaveLength(1);
    });

    it('generateSchemaExplorerAdminComponent should return valid client script', () => {
      const code = generateSchemaExplorerAdminComponent({ apiPrefix: '/schema' });
      expect(code).toContain('window.__customPages');
      expect(code).toContain('window.__customPages[\'schema-explorer\'] = SchemaExplorerPage');
      expect(code).toContain('Database Schema & Relations Explorer');
      expect(code).toContain('Mermaid');
    });
  });
});

const { z } = require('zod');
const { defineModel, clearRegistry, getModel, resolveRelationModel } = require('../../core/orm/model');
const { applySoftDeleteScope, applyTenantScope, createScopeContext } = require('../../core/orm/scopes');
const { createSchemaHelpers } = require('../../core/orm/schema-helpers');

describe('ORM Edge Cases & Model Relations', () => {
  const zdb = createSchemaHelpers(z);

  beforeEach(() => {
    clearRegistry();
  });

  afterEach(() => {
    clearRegistry();
  });

  it('should support string model names in defineModel relations and resolve them lazily', () => {
    // Define Post referencing User by string name before User is defined
    const Post = defineModel({
      name: 'Post',
      table: 'posts',
      schema: z.object({
        id: zdb.id(),
        title: zdb.string(),
        author_id: zdb.integer(),
      }),
      relations: {
        author: {
          type: 'belongsTo',
          model: () => 'User', // Lazy string model name reference
          foreignKey: 'author_id',
        },
      },
    });

    // Now define User model
    const User = defineModel({
      name: 'User',
      table: 'users',
      schema: z.object({
        id: zdb.id(),
        name: zdb.string(),
      }),
      relations: {
        posts: {
          type: 'hasMany',
          model: () => Post, // Function reference
          foreignKey: 'author_id',
        },
      },
    });

    const resolvedAuthorModel = resolveRelationModel(Post.relations.author);
    expect(resolvedAuthorModel).toBeDefined();
    expect(resolvedAuthorModel.name).toBe('User');

    const resolvedPostsModel = resolveRelationModel(User.relations.posts);
    expect(resolvedPostsModel).toBeDefined();
    expect(resolvedPostsModel.name).toBe('Post');
  });

  it('should apply soft delete scopes correctly', () => {
    const mockQb = {
      whereNull: vi.fn().mockReturnThis(),
      whereNotNull: vi.fn().mockReturnThis(),
    };

    const modelWithSoftDelete = {
      name: 'Article',
      table: 'articles',
      scopes: { softDelete: true },
    };

    // Default scope (not deleted)
    applySoftDeleteScope(mockQb, createScopeContext(), modelWithSoftDelete);
    expect(mockQb.whereNull).toHaveBeenCalledWith('deleted_at');

    // onlyTrashed
    const onlyTrashedCtx = createScopeContext({ onlyTrashed: true });
    applySoftDeleteScope(mockQb, onlyTrashedCtx, modelWithSoftDelete);
    expect(mockQb.whereNotNull).toHaveBeenCalledWith('deleted_at');
  });

  it('should apply tenant scope correctly', () => {
    const mockQb = {
      where: vi.fn().mockReturnThis(),
    };

    const modelWithTenant = {
      name: 'Order',
      table: 'orders',
      scopes: { tenant: 'tenant_id' },
    };

    const tenantCtx = createScopeContext({ tenantId: 42 });
    applyTenantScope(mockQb, tenantCtx, modelWithTenant);
    expect(mockQb.where).toHaveBeenCalledWith('tenant_id', 42);
  });
});

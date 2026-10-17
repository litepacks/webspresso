/**
 * Unit tests for Webspresso ORM Model Definition and Registry
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import {
  defineModel,
  getModel,
  getAllModels,
  hasModel,
  clearRegistry,
  unregisterModel,
  resolveModelName,
  resolveRelationModel,
  getRelationKeys,
  isCascadeEnabled,
} from '../../../core/orm/model';

const { ModelEvents } = require('../../../core/orm/events');

describe('ORM Model Definition & Registry', () => {
  beforeEach(() => {
    clearRegistry();
    ModelEvents.removeAllListeners();
  });

  afterEach(() => {
    clearRegistry();
    ModelEvents.removeAllListeners();
  });

  describe('defineModel validation & normalization', () => {
    it('throws error when name, table, or schema is missing/invalid', () => {
      expect(() => defineModel({})).toThrow(/Model name is required/);
      expect(() => defineModel({ name: 'User' })).toThrow(/Model table is required/);
      expect(() => defineModel({ name: 'User', table: 'users' })).toThrow(/Model schema is required/);
      expect(() => defineModel({ name: 'User', table: 'users', schema: {} })).toThrow(/Model schema is required/);
    });

    it('throws error when defining duplicate model name', () => {
      const schema = z.object({ id: z.number() });
      defineModel({ name: 'Post', table: 'posts', schema });
      expect(() => defineModel({ name: 'Post', table: 'posts_v2', schema })).toThrow(
        'Model "Post" is already defined'
      );
    });

    it('finalizes custom schema types if _finalize method is present', () => {
      const mockCustomType = {
        _finalize: vi.fn().mockReturnValue(z.string()),
      };
      const schema = z.object({
        slug: mockCustomType,
      });

      defineModel({ name: 'Page', table: 'pages', schema });
      expect(mockCustomType._finalize).toHaveBeenCalled();
    });

    it('validates relation definitions thoroughly', () => {
      const schema = z.object({ id: z.number() });

      // Invalid relation type
      expect(() =>
        defineModel({
          name: 'Order',
          table: 'orders',
          schema,
          relations: {
            customer: { type: 'manyToMany' },
          },
        })
      ).toThrow(/Invalid relation type "manyToMany"/);

      // Missing model function
      expect(() =>
        defineModel({
          name: 'Order',
          table: 'orders',
          schema,
          relations: {
            customer: { type: 'belongsTo', model: 'NotAFunc' },
          },
        })
      ).toThrow(/must have a model function/);

      // Missing foreignKey
      expect(() =>
        defineModel({
          name: 'Order',
          table: 'orders',
          schema,
          relations: {
            customer: { type: 'belongsTo', model: () => null },
          },
        })
      ).toThrow(/must have a foreignKey string/);

      // Invalid cascade type
      expect(() =>
        defineModel({
          name: 'Order',
          table: 'orders',
          schema,
          relations: {
            customer: {
              type: 'belongsTo',
              model: () => null,
              foreignKey: 'customer_id',
              cascade: 12345,
            },
          },
        })
      ).toThrow(/Invalid cascade option/);
    });

    it('normalizes admin and rest configurations and registers hooks', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const onSpy = vi.spyOn(ModelEvents, 'on');
      const beforeCreateHook = vi.fn();

      const schema = z.object({ id: z.number(), title: z.string() });
      const model = defineModel({
        name: 'Article',
        table: 'articles',
        schema,
        admin: {
          enabled: true,
          label: 'Articles Admin',
          menuGroup: 'Content',
          menuOrder: 5,
          readOnly: false,
          searchFields: ['title'],
        },
        rest: {
          enabled: true,
          path: '/api/v1/articles/',
          allowInclude: ['author', 123],
        },
        hooks: {
          beforeCreate: beforeCreateHook,
          unknownHook: () => {},
          afterCreate: 'not-a-function',
        },
      });

      expect(model.admin.enabled).toBe(true);
      expect(model.admin.label).toBe('Articles Admin');
      expect(model.admin.group).toBe('Content');
      expect(model.admin.menuOrder).toBe(5);
      expect(model.rest.enabled).toBe(true);
      expect(model.rest.path).toBe('api/v1/articles'); // trimmed slashes
      expect(model.rest.allowInclude).toEqual(['author']); // filtered non-strings

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown hook "unknownHook"'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('must be a function'));

      // Check registered hook
      expect(onSpy).toHaveBeenCalledWith('Article.beforeCreate', beforeCreateHook);

      warnSpy.mockRestore();
      onSpy.mockRestore();
    });
  });

  describe('Registry Operations & Model Resolution', () => {
    it('getModel, getAllModels, hasModel, and unregisterModel work accurately', () => {
      const schema = z.object({ id: z.number() });
      const userModel = defineModel({ name: 'User', table: 'users', schema });

      expect(hasModel('User')).toBe(true);
      expect(hasModel('NonExistent')).toBe(false);
      expect(getModel('User')).toBe(userModel);

      const all = getAllModels();
      expect(all.size).toBe(1);
      expect(all.get('User')).toBe(userModel);

      const deleted = unregisterModel('User');
      expect(deleted).toBe(true);
      expect(hasModel('User')).toBe(false);
      expect(getModel('User')).toBeUndefined();
    });

    it('resolveModelName resolves strings, objects, and valueOf', () => {
      expect(resolveModelName('User')).toBe('User');
      expect(resolveModelName({ name: 'Admin' })).toBe('Admin');
      expect(resolveModelName({ modelName: 'Role' })).toBe('Role');
      expect(resolveModelName({ model: 'Permission' })).toBe('Permission');
      expect(resolveModelName({ valueOf: () => 'CustomObj' })).toBe('CustomObj');
      expect(resolveModelName(null)).toBe('');
      expect(resolveModelName(undefined)).toBe('');
    });

    it('resolveRelationModel handles lazy functions, model names, and throws on invalid reference', () => {
      const schema = z.object({ id: z.number() });
      const authorModel = defineModel({ name: 'Author', table: 'authors', schema });

      // Model via lazy function
      expect(resolveRelationModel({ model: () => authorModel })).toBe(authorModel);

      // Model via string name
      expect(resolveRelationModel({ model: () => 'Author' })).toBe(authorModel);

      // Invalid reference throws
      expect(() => resolveRelationModel({ model: () => 'GhostModel' })).toThrow(
        'Invalid relation model reference'
      );
    });

    it('getRelationKeys returns localKey, foreignKey, and relatedModel', () => {
      const schema = z.object({ id: z.number(), authorId: z.number() });
      const authorModel = defineModel({
        name: 'Author',
        table: 'authors',
        schema: z.object({ id: z.number() }),
      });

      const bookModel = defineModel({
        name: 'Book',
        table: 'books',
        schema,
        relations: {
          author: {
            type: 'belongsTo',
            model: () => authorModel,
            foreignKey: 'authorId',
          },
        },
      });

      const keys = getRelationKeys(bookModel, 'author');
      expect(keys.localKey).toBe('id');
      expect(keys.foreignKey).toBe('authorId');
      expect(keys.relatedModel).toBe(authorModel);

      expect(() => getRelationKeys(bookModel, 'publisher')).toThrow(
        'Relation "publisher" not found on model "Book"'
      );
    });
  });

  describe('isCascadeEnabled', () => {
    it('evaluates boolean cascade', () => {
      expect(isCascadeEnabled(null, 'delete')).toBe(false);
      expect(isCascadeEnabled({}, 'delete')).toBe(false);
      expect(isCascadeEnabled({ cascade: false }, 'delete')).toBe(false);
      expect(isCascadeEnabled({ cascade: true }, 'delete')).toBe(true);
      expect(isCascadeEnabled({ cascade: true }, 'restore')).toBe(true);
    });

    it('evaluates string cascade ("all", "delete", "restore")', () => {
      expect(isCascadeEnabled({ cascade: 'all' }, 'delete')).toBe(true);
      expect(isCascadeEnabled({ cascade: 'ALL' }, 'restore')).toBe(true);
      expect(isCascadeEnabled({ cascade: 'delete' }, 'delete')).toBe(true);
      expect(isCascadeEnabled({ cascade: 'delete' }, 'restore')).toBe(false);
    });

    it('evaluates array cascade', () => {
      expect(isCascadeEnabled({ cascade: ['delete'] }, 'delete')).toBe(true);
      expect(isCascadeEnabled({ cascade: ['delete'] }, 'restore')).toBe(false);
      expect(isCascadeEnabled({ cascade: ['restore', 'delete'] }, 'restore')).toBe(true);
    });

    it('evaluates object cascade', () => {
      expect(isCascadeEnabled({ cascade: { delete: true } }, 'delete')).toBe(true);
      expect(isCascadeEnabled({ cascade: { delete: true } }, 'restore')).toBe(false);
      expect(isCascadeEnabled({ cascade: { restore: true } }, 'restore')).toBe(true);
    });
  });
});

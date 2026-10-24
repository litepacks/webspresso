'use strict';

/**
 * Unit tests for z and zdb unification across Webspresso ORM
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const root = require('../../../index');
const orm = require('../../../core/orm');
const { defineModel, clearRegistry, zdb, z, zod } = orm;

describe('z and zdb ORM Unification', () => {
  beforeEach(() => {
    clearRegistry();
  });

  afterEach(() => {
    clearRegistry();
  });

  describe('Exports & Accessors', () => {
    it('exports z and zod from both root index and core/orm', () => {
      expect(root.z).toBeDefined();
      expect(root.zod).toBeDefined();
      expect(orm.z).toBeDefined();
      expect(orm.zod).toBeDefined();
      expect(root.z).toBe(orm.z);
      expect(root.zod).toBe(orm.zod);
      expect(typeof root.z.string).toBe('function');
      expect(typeof root.z.object).toBe('function');
    });

    it('exposes z and zod on the zdb helper instance', () => {
      expect(zdb.z).toBeDefined();
      expect(zdb.zod).toBeDefined();
      expect(zdb.z).toBe(z);
      expect(zdb.zod).toBe(z);
      expect(typeof zdb.z.enum).toBe('function');
      expect(typeof zdb.z.union).toBe('function');
    });
  });

  describe('zdb Schema Helpers Aliases', () => {
    it('provides zdb.number() as an expressive numeric helper', () => {
      expect(typeof zdb.number).toBe('function');
      const numField = zdb.number({ nullable: true });
      const meta = numField._finalize();
      expect(meta.description).toContain('"type":"float"');
      expect(meta.parse(42.5)).toBe(42.5);
    });

    it('provides zdb.email() as a pre-validated string helper', () => {
      expect(typeof zdb.email).toBe('function');
      const emailField = zdb.email();
      const meta = emailField._finalize();
      expect(meta.description).toContain('"type":"string"');
      expect(meta.parse('user@example.com')).toBe('user@example.com');
      expect(() => meta.parse('invalid-email')).toThrow();
    });
  });

  describe('Functional Model Schema Definition', () => {
    it('supports defineModel with functional schema ({ zdb, z }) => ({ ... })', () => {
      const User = defineModel({
        name: 'UserUnified',
        table: 'users_unified',
        schema: ({ zdb, z }) => ({
          id: zdb.id(),
          name: zdb.string().min(2),
          email: zdb.email(),
          balance: zdb.number(),
          role: z.enum(['admin', 'member', 'guest']),
        }),
      });

      expect(User).toBeDefined();
      expect(User.name).toBe('UserUnified');
      expect(User.columns.has('id')).toBe(true);
      expect(User.columns.get('id').primary).toBe(true);
      expect(User.columns.get('name').type).toBe('string');
      expect(User.columns.get('email').type).toBe('string');
      expect(User.columns.get('balance').type).toBe('float');
      expect(User.columns.get('role').type).toBe('enum');
      expect(User.columns.get('role').enumValues).toEqual(['admin', 'member', 'guest']);
    });

    it('supports defineModel with functional schema returning zdb.schema or z.object', () => {
      const Item = defineModel({
        name: 'ItemUnified',
        table: 'items_unified',
        schema: ({ zdb, z }) => z.object({
          id: zdb.id(),
          title: zdb.string(),
          count: z.number().int(),
        }),
      });

      expect(Item).toBeDefined();
      expect(Item.columns.has('id')).toBe(true);
      expect(Item.columns.has('title')).toBe(true);
      expect(Item.columns.has('count')).toBe(true);
      expect(Item.columns.get('count').type).toBe('integer');
    });
  });

  describe('Raw Zod Fallback Inference in extractColumnsFromSchema', () => {
    it('infers metadata for raw Zod schemas without dropping columns', () => {
      const rawZodModel = defineModel({
        name: 'RawModel',
        table: 'raw_models',
        schema: {
          id: zdb.id(),
          title: z.string(),
          views: z.number().int(),
          rating: z.number(),
          isPublished: z.boolean(),
          publishedAt: z.date().optional(),
          category: z.enum(['tech', 'news']),
          metadata: z.record(z.any()),
        },
      });

      expect(rawZodModel.columns.size).toBe(8);
      expect(rawZodModel.columns.get('id').primary).toBe(true);
      expect(rawZodModel.columns.get('title')).toEqual({ type: 'string', maxLength: 255, nullable: false });
      expect(rawZodModel.columns.get('views')).toEqual({ type: 'integer', nullable: false });
      expect(rawZodModel.columns.get('rating')).toEqual({ type: 'float', nullable: false });
      expect(rawZodModel.columns.get('isPublished')).toEqual({ type: 'boolean', nullable: false });
      expect(rawZodModel.columns.get('publishedAt')).toEqual({ type: 'timestamp', nullable: true });
      expect(rawZodModel.columns.get('category')).toEqual({ type: 'enum', enumValues: ['tech', 'news'], nullable: false });
      expect(rawZodModel.columns.get('metadata')).toEqual({ type: 'json', nullable: false });
    });
  });
});

/**
 * Unit tests for OpenAPI ORM Schemas Generator & Type Mapper
 * @vitest-environment node
 */

import { describe, it, expect, vi } from 'vitest';
import {
  generateOrmOpenApiSchemas,
  columnToOpenApiType,
} from '../../../core/openapi/orm-components';
import * as modelMod from '../../../core/orm/model';

describe('OpenAPI ORM Components & Column Type Mapping', () => {
  describe('columnToOpenApiType', () => {
    it('maps integer and bigint types with formats', () => {
      expect(columnToOpenApiType({ type: 'integer' })).toEqual({ type: 'integer' });
      expect(columnToOpenApiType({ type: 'bigint' })).toEqual({ type: 'integer', format: 'int64' });
    });

    it('maps float and decimal types with formats', () => {
      expect(columnToOpenApiType({ type: 'float' })).toEqual({ type: 'number' });
      expect(columnToOpenApiType({ type: 'decimal' })).toEqual({ type: 'number', format: 'double' });
    });

    it('maps boolean type', () => {
      expect(columnToOpenApiType({ type: 'boolean' })).toEqual({ type: 'boolean' });
    });

    it('maps date, datetime, and timestamp types', () => {
      expect(columnToOpenApiType({ type: 'date' })).toEqual({ type: 'string', format: 'date' });
      expect(columnToOpenApiType({ type: 'datetime' })).toEqual({ type: 'string', format: 'date-time' });
      expect(columnToOpenApiType({ type: 'timestamp' })).toEqual({ type: 'string', format: 'date-time' });
    });

    it('maps uuid and nanoid types with optional maxLength', () => {
      expect(columnToOpenApiType({ type: 'uuid' })).toEqual({ type: 'string', format: 'uuid' });
      expect(columnToOpenApiType({ type: 'nanoid', maxLength: 21 })).toEqual({
        type: 'string',
        maxLength: 21,
      });
    });

    it('maps json type to object', () => {
      expect(columnToOpenApiType({ type: 'json' })).toEqual({ type: 'object' });
    });

    it('maps enum type with enumValues array', () => {
      expect(columnToOpenApiType({ type: 'enum', enumValues: ['draft', 'published', 'archived'] })).toEqual({
        type: 'string',
        enum: ['draft', 'published', 'archived'],
      });
      expect(columnToOpenApiType({ type: 'enum' })).toEqual({
        type: 'string',
      });
    });

    it('maps string and text types with maxLength', () => {
      expect(columnToOpenApiType({ type: 'string', maxLength: 100 })).toEqual({
        type: 'string',
        maxLength: 100,
      });
      expect(columnToOpenApiType({ type: 'text' })).toEqual({ type: 'string' });
      expect(columnToOpenApiType({ type: 'unknown_type' })).toEqual({ type: 'string' });
    });

    it('applies nullable and default attributes', () => {
      const result = columnToOpenApiType({
        type: 'string',
        nullable: true,
        default: 'active',
      });
      expect(result).toEqual({
        type: 'string',
        nullable: true,
        default: 'active',
      });
    });
  });

  describe('generateOrmOpenApiSchemas', () => {
    it('generates model and modelInput schemas from registered models', () => {
      const mockColumns = new Map([
        [
          'id',
          {
            type: 'integer',
            autoIncrement: true,
            nullable: false,
          },
        ],
        [
          'title',
          {
            type: 'string',
            maxLength: 255,
            nullable: false,
          },
        ],
        [
          'content',
          {
            type: 'text',
            nullable: true,
          },
        ],
        [
          'status',
          {
            type: 'enum',
            enumValues: ['draft', 'active'],
            nullable: false,
            default: 'draft',
          },
        ],
      ]);

      const mockModels = new Map([
        [
          'Post',
          {
            name: 'Post',
            columns: mockColumns,
          },
        ],
        [
          'SecretLog',
          {
            name: 'SecretLog',
            columns: new Map(),
          },
        ],
      ]);

      const schemas = generateOrmOpenApiSchemas({ models: mockModels, exclude: ['SecretLog'] });

      expect(schemas.SecretLog).toBeUndefined();
      expect(schemas.Post).toBeDefined();
      expect(schemas.Post.type).toBe('object');
      expect(schemas.Post.properties.id).toEqual({ type: 'integer' });
      expect(schemas.Post.properties.title).toEqual({ type: 'string', maxLength: 255 });
      expect(schemas.Post.properties.content).toEqual({ type: 'string', nullable: true });
      expect(schemas.Post.required).toContain('title');
      expect(schemas.Post.required).not.toContain('id'); // autoIncrement
      expect(schemas.Post.required).not.toContain('status'); // default defined

      // Input schema should omit autoIncrement/auto fields
      expect(schemas.PostInput).toBeDefined();
      expect(schemas.PostInput.properties.id).toBeUndefined();
      expect(schemas.PostInput.properties.title).toBeDefined();
      expect(schemas.PostInput.required).toEqual(['title']);
    });

    it('handles models without columns gracefully', () => {
      const mockModels = new Map([
        [
          'EmptyModel',
          {
            name: 'EmptyModel',
          },
        ],
      ]);

      const schemas = generateOrmOpenApiSchemas({ models: mockModels });

      expect(schemas.EmptyModel).toEqual({
        type: 'object',
        properties: {},
        required: undefined,
      });
      expect(schemas.EmptyModelInput).toEqual({
        type: 'object',
        properties: {},
        required: undefined,
      });
    });
  });
});

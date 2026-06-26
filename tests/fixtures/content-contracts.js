/**
 * API response contracts for contentPlugin — shared by contract tests.
 * @module tests/fixtures/content-contracts
 */

import { expect } from 'vitest';
import { FIELD_TYPES } from '../../core/content/field-types.js';

export const CONTENT_FIELD_TYPES = [...FIELD_TYPES];

/**
 * @param {unknown} value
 * @param {string} label
 */
function expectString(value, label) {
  expect(typeof value, `${label} should be string`).toBe('string');
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function expectNullableString(value, label) {
  if (value !== null && value !== undefined) {
    expectString(value, label);
  }
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function expectTimestampLike(value, label) {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    expect(value.length, `${label} string`).toBeGreaterThan(0);
    return;
  }
  if (typeof value === 'number') {
    expect(value, `${label} number`).toBeGreaterThan(0);
    return;
  }
  expect.fail(`${label} should be string or number timestamp`);
}

/**
 * @param {unknown} body
 * @param {Object} [options]
 * @param {boolean} [options.allowRedirect=false]
 */
export function assertErrorContract(body, options = {}) {
  expect(body).toBeTypeOf('object');
  expect(body).toHaveProperty('error');
  expectString(body.error, 'error');
  const keys = Object.keys(body).sort();
  if (options.allowRedirect) {
    expect(keys).toEqual(['error', 'redirect']);
  } else {
    expect(keys).toEqual(['error']);
  }
}

/**
 * @param {unknown} field
 */
export function assertFieldDefinitionContract(field) {
  expect(field).toBeTypeOf('object');
  expect(field).toHaveProperty('name');
  expect(field).toHaveProperty('type');
  expectString(field.name, 'field.name');
  expectString(field.type, 'field.type');
  expect(CONTENT_FIELD_TYPES).toContain(field.type);
  if (field.label !== undefined) expectString(field.label, 'field.label');
  if (field.required !== undefined) expect(typeof field.required).toBe('boolean');
  if (field.type === 'select') {
    expect(Array.isArray(field.options)).toBe(true);
    expect(field.options.length).toBeGreaterThan(0);
  }
  if (field.type === 'repeater') {
    expect(Array.isArray(field.fields)).toBe(true);
    field.fields.forEach(assertFieldDefinitionContract);
  }
}

/**
 * @param {unknown} schema
 */
export function assertContentTypeSchemaContract(schema) {
  expect(schema).toBeTypeOf('object');
  expect(schema).toHaveProperty('fields');
  expect(Array.isArray(schema.fields)).toBe(true);
  schema.fields.forEach(assertFieldDefinitionContract);
}

/**
 * @param {unknown} row
 */
export function assertContentTypeRecordContract(row) {
  expect(row).toBeTypeOf('object');
  expect(row).toHaveProperty('id');
  expect(row).toHaveProperty('slug');
  expect(row).toHaveProperty('name');
  expect(row).toHaveProperty('schema');
  expect(typeof row.id).toBe('number');
  expectString(row.slug, 'slug');
  expectString(row.name, 'name');
  assertContentTypeSchemaContract(row.schema);
  if (row.description !== undefined) expectNullableString(row.description, 'description');
  if (row.created_at !== undefined) expectTimestampLike(row.created_at, 'created_at');
  if (row.updated_at !== undefined) expectTimestampLike(row.updated_at, 'updated_at');
}

/**
 * @param {unknown} row
 */
export function assertContentEntryRecordContract(row) {
  expect(row).toBeTypeOf('object');
  expect(row).toHaveProperty('id');
  expect(row).toHaveProperty('content_type_id');
  expect(row).toHaveProperty('slug');
  expect(row).toHaveProperty('data');
  expect(row).toHaveProperty('status');
  expect(typeof row.id).toBe('number');
  expect(typeof row.content_type_id).toBe('number');
  expectString(row.slug, 'slug');
  expect(['published', 'draft']).toContain(row.status);
  expect(row.data).toBeTypeOf('object');
  if (row.revision !== undefined) expect(typeof row.revision).toBe('number');
}

/**
 * @param {unknown} body — admin list envelope
 */
export function assertAdminListEnvelopeContract(body) {
  expect(body).toBeTypeOf('object');
  expect(body).toHaveProperty('data');
  expect(Array.isArray(body.data)).toBe(true);
}

/**
 * @param {unknown} body — admin single resource envelope
 */
export function assertAdminDataEnvelopeContract(body) {
  expect(body).toBeTypeOf('object');
  expect(body).toHaveProperty('data');
  expect(body.data).toBeTypeOf('object');
}

/**
 * @param {unknown} body
 */
export function assertAdminSuccessContract(body) {
  expect(body).toEqual({ success: true });
}

/**
 * @param {unknown} body — GET /api/content/:type/:slug
 */
export function assertPublicEntryContract(body) {
  expect(body).toBeTypeOf('object');
  expect(body).toHaveProperty('type');
  expect(body).toHaveProperty('slug');
  expect(body).toHaveProperty('data');
  expect(body).toHaveProperty('meta');
  expectString(body.type, 'type');
  expectString(body.slug, 'slug');
  expect(body.data).toBeTypeOf('object');

  const meta = body.meta;
  expect(meta).toBeTypeOf('object');
  expect(meta).toHaveProperty('id');
  expect(meta).toHaveProperty('slug');
  expect(meta).toHaveProperty('status');
  expect(meta).toHaveProperty('typeSlug');
  expect(meta).toHaveProperty('contentTypeId');
  expect(typeof meta.id).toBe('number');
  expect(meta.status).toBe('published');
  expect(meta.typeSlug).toBe(body.type);
  expect(meta.slug).toBe(body.slug);
  if (meta.updatedAt !== undefined) {
    expectTimestampLike(meta.updatedAt, 'meta.updatedAt');
  }
}

/**
 * @param {unknown} body — GET .../types/:slug/schema
 */
export function assertTypeSchemaResponseContract(body) {
  assertAdminDataEnvelopeContract(body);
  expect(body.data).toHaveProperty('slug');
  expect(body.data).toHaveProperty('name');
  expect(body.data).toHaveProperty('schema');
  assertContentTypeSchemaContract(body.data.schema);
}

/**
 * @param {unknown} body — GET .../entries/:id
 */
export function assertEntryWithTypeContract(body) {
  assertAdminDataEnvelopeContract(body);
  assertContentEntryRecordContract(body.data);
  if (body.type) assertContentTypeRecordContract(body.type);
}

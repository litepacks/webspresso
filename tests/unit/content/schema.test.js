/**
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import {
  parseContentTypeSchema,
  validateEntryData,
  isValidSlug,
} from '../../../core/content/index.js';

describe('content schema', () => {
  it('validates slugs', () => {
    expect(isValidSlug('hero')).toBe(true);
    expect(isValidSlug('faq-block')).toBe(true);
    expect(isValidSlug('Bad Slug')).toBe(false);
  });

  it('parses a content type schema', () => {
    const schema = parseContentTypeSchema({
      fields: [
        { name: 'headline', type: 'text', required: true },
        { name: 'body', type: 'rich-text' },
        {
          name: 'items',
          type: 'repeater',
          fields: [
            { name: 'q', type: 'text' },
            { name: 'a', type: 'textarea' },
          ],
        },
      ],
    });
    expect(schema.fields).toHaveLength(3);
  });

  it('rejects duplicate field names', () => {
    expect(() =>
      parseContentTypeSchema({
        fields: [
          { name: 'title', type: 'text' },
          { name: 'title', type: 'text' },
        ],
      })
    ).toThrow(/Duplicate/);
  });

  it('validates entry data against schema', () => {
    const schema = parseContentTypeSchema({
      fields: [
        { name: 'headline', type: 'text', required: true },
        { name: 'count', type: 'number' },
        { name: 'active', type: 'boolean' },
      ],
    });

    const data = validateEntryData(schema, {
      headline: 'Hello',
      count: 3,
      active: true,
    });

    expect(data).toEqual({
      headline: 'Hello',
      count: 3,
      active: true,
    });
  });

  it('requires fields marked required', () => {
    const schema = parseContentTypeSchema({
      fields: [{ name: 'headline', type: 'text', required: true }],
    });

    expect(() => validateEntryData(schema, {})).toThrow(/required/);
  });

  it('rejects select without options', () => {
    expect(() =>
      parseContentTypeSchema({
        fields: [{ name: 'color', type: 'select' }],
      })
    ).toThrow(/options/);
  });

  it('rejects repeater without nested fields', () => {
    expect(() =>
      parseContentTypeSchema({
        fields: [{ name: 'items', type: 'repeater', fields: [] }],
      })
    ).toThrow(/nested fields/);
  });

  it('rejects invalid field type in schema', () => {
    expect(() =>
      parseContentTypeSchema({
        fields: [{ name: 'x', type: 'invalid' }],
      })
    ).toThrow();
  });
});

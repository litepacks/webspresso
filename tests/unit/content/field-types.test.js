/**
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import sanitizeHtml from 'sanitize-html';
import {
  normalizeFieldValue,
  normalizeEntryData,
  isValidFieldType,
  FIELD_TYPES,
} from '../../../core/content/field-types.js';

describe('content field types', () => {
  it('exports all planned field types', () => {
    expect([...FIELD_TYPES].sort()).toEqual([
      'boolean',
      'date',
      'image',
      'number',
      'repeater',
      'rich-text',
      'select',
      'text',
      'textarea',
      'url',
    ]);
  });

  it('validates field type names', () => {
    expect(isValidFieldType('text')).toBe(true);
    expect(isValidFieldType('unknown')).toBe(false);
  });

  it('normalizes number from string', () => {
    expect(normalizeFieldValue('42', { name: 'n', type: 'number' })).toBe(42);
  });

  it('normalizes boolean from string', () => {
    expect(normalizeFieldValue('true', { name: 'b', type: 'boolean' })).toBe(true);
    expect(normalizeFieldValue('0', { name: 'b', type: 'boolean' })).toBe(false);
  });

  it('validates url format', () => {
    expect(() =>
      normalizeFieldValue('not-a-url', { name: 'u', type: 'url', required: true })
    ).toThrow(/valid URL/);
    expect(normalizeFieldValue('https://example.com', { name: 'u', type: 'url' }))
      .toBe('https://example.com');
  });

  it('validates date as YYYY-MM-DD', () => {
    expect(normalizeFieldValue('2026-06-25', { name: 'd', type: 'date' })).toBe('2026-06-25');
    expect(() =>
      normalizeFieldValue('25/06/2026', { name: 'd', type: 'date' })
    ).toThrow(/valid date/);
  });

  it('validates select options', () => {
    expect(() =>
      normalizeFieldValue('c', {
        name: 's',
        type: 'select',
        options: ['a', 'b'],
      })
    ).toThrow(/one of/);
  });

  it('normalizes repeater nested objects', () => {
    const result = normalizeEntryData(
      { items: [{ q: 'Q', a: 'A' }] },
      [{
        name: 'items',
        type: 'repeater',
        fields: [
          { name: 'q', type: 'text' },
          { name: 'a', type: 'textarea' },
        ],
      }]
    );
    expect(result.items).toEqual([{ q: 'Q', a: 'A' }]);
  });

  it('sanitizes rich-text when hook provided', () => {
    const sanitized = normalizeFieldValue('<script>x</script><p>ok</p>', {
      name: 'body',
      type: 'rich-text',
    }, {
      sanitizeRichHtml: (html) => sanitizeHtml(html),
    });
    expect(sanitized).toBe('<p>ok</p>');
  });
});

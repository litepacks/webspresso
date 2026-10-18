'use strict';

import { describe, it, expect } from 'vitest';
const {
  safeJsonParse,
  safeJsonStringify,
  isValidJson,
} = require('../../../core/utils/json');
const webspresso = require('../../../index');
const { utils } = require('../../../src/helpers');

describe('JSON Utilities (core/utils/json)', () => {
  describe('safeJsonParse', () => {
    it('parses valid JSON object strings correctly', () => {
      const parsed = safeJsonParse('{"a": 1, "b": "hello", "c": true}');
      expect(parsed).toEqual({ a: 1, b: 'hello', c: true });
    });

    it('parses valid JSON array strings correctly', () => {
      const parsed = safeJsonParse('[1, "two", false]');
      expect(parsed).toEqual([1, 'two', false]);
    });

    it('parses valid JSON primitive strings', () => {
      expect(safeJsonParse('123')).toBe(123);
      expect(safeJsonParse('true')).toBe(true);
      expect(safeJsonParse('"hello"')).toBe('hello');
    });

    it('returns fallback on null, undefined, or empty string', () => {
      expect(safeJsonParse(null)).toBeNull();
      expect(safeJsonParse(undefined)).toBeNull();
      expect(safeJsonParse('')).toBeNull();
      expect(safeJsonParse(null, {})).toEqual({});
      expect(safeJsonParse(undefined, [])).toEqual([]);
      expect(safeJsonParse('', 'fallback')).toBe('fallback');
    });

    it('returns non-string objects and arrays directly as-is', () => {
      const obj = { foo: 'bar' };
      const arr = [1, 2, 3];
      expect(safeJsonParse(obj)).toBe(obj);
      expect(safeJsonParse(arr)).toBe(arr);
      expect(safeJsonParse(456)).toBe(456);
      expect(safeJsonParse(true)).toBe(true);
    });

    it('returns fallback value on invalid JSON syntax without throwing', () => {
      expect(safeJsonParse('{invalid}', null)).toBeNull();
      expect(safeJsonParse('{bad json', { default: true })).toEqual({ default: true });
      expect(safeJsonParse('unexpected token', [])).toEqual([]);
    });

    it('supports custom reviver functions', () => {
      const json = '{"date": "2026-10-18T00:00:00.000Z"}';
      const parsed = safeJsonParse(json, null, (key, value) => {
        if (key === 'date') return new Date(value);
        return value;
      });
      expect(parsed.date).toBeInstanceOf(Date);
      expect(parsed.date.toISOString()).toBe('2026-10-18T00:00:00.000Z');
    });
  });

  describe('safeJsonStringify', () => {
    it('serializes plain objects and arrays to JSON', () => {
      expect(safeJsonStringify({ a: 1, b: 'test' })).toBe('{"a":1,"b":"test"}');
      expect(safeJsonStringify([1, 2, 3])).toBe('[1,2,3]');
      expect(safeJsonStringify('hello')).toBe('"hello"');
      expect(safeJsonStringify(123)).toBe('123');
    });

    it('applies indentation when space parameter is specified', () => {
      const res = safeJsonStringify({ a: 1 }, 2);
      expect(res).toBe('{\n  "a": 1\n}');
    });

    it('handles undefined with fallback value', () => {
      expect(safeJsonStringify(undefined)).toBe('');
      expect(safeJsonStringify(undefined, null, '{}')).toBe('{}');
    });

    it('safely serializes objects with BigInt properties', () => {
      const data = { id: 1, big: 9007199254740991n };
      const res = safeJsonStringify(data);
      expect(res).toBe('{"id":1,"big":"9007199254740991"}');
    });

    it('safely handles circular references without throwing', () => {
      const circularObj = { name: 'root' };
      circularObj.self = circularObj;
      const res = safeJsonStringify(circularObj);
      expect(res).toContain('"name":"root"');
      expect(res).toContain('"self":"[Circular]"');
    });
  });

  describe('isValidJson', () => {
    it('returns true for valid JSON strings', () => {
      expect(isValidJson('{"a": 1}')).toBe(true);
      expect(isValidJson('[1, 2, 3]')).toBe(true);
      expect(isValidJson('"valid string"')).toBe(true);
      expect(isValidJson('123')).toBe(true);
      expect(isValidJson('true')).toBe(true);
      expect(isValidJson('null')).toBe(true);
    });

    it('returns false for invalid JSON strings', () => {
      expect(isValidJson('{bad: json}')).toBe(false);
      expect(isValidJson('undefined')).toBe(false);
      expect(isValidJson('')).toBe(false);
      expect(isValidJson('   ')).toBe(false);
    });

    it('returns false for non-string types', () => {
      expect(isValidJson(null)).toBe(false);
      expect(isValidJson(undefined)).toBe(false);
      expect(isValidJson({ a: 1 })).toBe(false);
      expect(isValidJson([1, 2])).toBe(false);
      expect(isValidJson(123)).toBe(false);
    });
  });

  describe('Root and Helper re-exports', () => {
    it('re-exports functions on main index.js module', () => {
      expect(typeof webspresso.safeJsonParse).toBe('function');
      expect(typeof webspresso.safeJsonStringify).toBe('function');
      expect(typeof webspresso.isValidJson).toBe('function');
      expect(webspresso.safeJsonParse('{"ok":true}')).toEqual({ ok: true });
      expect(webspresso.safeJsonStringify({ ok: true })).toBe('{"ok":true}');
      expect(webspresso.isValidJson('{"ok":true}')).toBe(true);
    });

    it('re-exports functions on utils in helpers.js', () => {
      expect(typeof utils.safeJsonParse).toBe('function');
      expect(typeof utils.safeJsonStringify).toBe('function');
      expect(typeof utils.isValidJson).toBe('function');
      expect(utils.safeJsonParse('{"ok":true}')).toEqual({ ok: true });
      expect(utils.safeJsonStringify({ ok: true })).toBe('{"ok":true}');
      expect(utils.isValidJson('{"ok":true}')).toBe(true);
    });
  });
});

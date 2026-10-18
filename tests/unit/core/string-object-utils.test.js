'use strict';

import { describe, it, expect } from 'vitest';
const {
  toCamelCase,
  snakeToCamel,
  toSnakeCase,
  camelToSnake,
  toKebabCase,
  toPascalCase,
} = require('../../../core/utils/string');
const {
  ensureArray,
  pick,
  omit,
  deepClone,
} = require('../../../core/utils/object');
const arrayUtils = require('../../../core/utils/array');
const webspresso = require('../../../index');
const { utils } = require('../../../src/helpers');

describe('String & Object Utilities', () => {
  describe('core/utils/string', () => {
    describe('toCamelCase & snakeToCamel', () => {
      it('converts kebab-case to camelCase', () => {
        expect(toCamelCase('order-items')).toBe('orderItems');
        expect(toCamelCase('get-by-id')).toBe('getById');
        expect(toCamelCase('multi-segment-path-name')).toBe('multiSegmentPathName');
      });

      it('converts snake_case to camelCase', () => {
        expect(toCamelCase('get_by_id')).toBe('getById');
        expect(toCamelCase('user_profile_data')).toBe('userProfileData');
        expect(toCamelCase('first_name_test')).toBe('firstNameTest');
        expect(toCamelCase('foo_bar_baz')).toBe('fooBarBaz');
      });

      it('handles mixed spaces and separators', () => {
        expect(toCamelCase('hello world')).toBe('helloWorld');
        expect(toCamelCase('hello_world-test')).toBe('helloWorldTest');
      });

      it('handles numeric segments', () => {
        expect(toCamelCase('item_1_name')).toBe('item1Name');
      });

      it('handles leading and trailing separators', () => {
        expect(toCamelCase('-order-items-')).toBe('orderItems');
        expect(toCamelCase('__foo_bar__')).toBe('fooBar');
      });

      it('leaves simple or already camelCase strings intact', () => {
        expect(toCamelCase('simple')).toBe('simple');
        expect(toCamelCase('fooBar')).toBe('fooBar');
      });

      it('handles falsy or non-string inputs gracefully', () => {
        expect(toCamelCase('')).toBe('');
        expect(toCamelCase(null)).toBe('');
        expect(toCamelCase(undefined)).toBe('');
        expect(toCamelCase(123)).toBe('');
      });

      it('verifies snakeToCamel alias behaves identically', () => {
        expect(snakeToCamel('first_name_test')).toBe('firstNameTest');
        expect(snakeToCamel('foo_bar_baz')).toBe('fooBarBaz');
      });
    });

    describe('toSnakeCase & camelToSnake', () => {
      it('converts camelCase to snake_case', () => {
        expect(toSnakeCase('fooBarBaz')).toBe('foo_bar_baz');
        expect(toSnakeCase('orderItems')).toBe('order_items');
        expect(toSnakeCase('firstNameTest')).toBe('first_name_test');
      });

      it('converts kebab-case to snake_case', () => {
        expect(toSnakeCase('foo-bar-baz')).toBe('foo_bar_baz');
        expect(toSnakeCase('order-items')).toBe('order_items');
      });

      it('converts PascalCase to snake_case', () => {
        expect(toSnakeCase('FooBar')).toBe('foo_bar');
        expect(toSnakeCase('OrderItems')).toBe('order_items');
      });

      it('handles edge cases', () => {
        expect(toSnakeCase('')).toBe('');
        expect(toSnakeCase(null)).toBe('');
        expect(toSnakeCase(undefined)).toBe('');
      });

      it('verifies camelToSnake alias behaves identically', () => {
        expect(camelToSnake('fooBarBaz')).toBe('foo_bar_baz');
      });
    });

    describe('toKebabCase', () => {
      it('converts camelCase and snake_case to kebab-case', () => {
        expect(toKebabCase('orderItems')).toBe('order-items');
        expect(toKebabCase('foo_bar_baz')).toBe('foo-bar-baz');
        expect(toKebabCase('OrderItems')).toBe('order-items');
      });

      it('handles falsy input', () => {
        expect(toKebabCase('')).toBe('');
        expect(toKebabCase(null)).toBe('');
        expect(toKebabCase(undefined)).toBe('');
      });
    });

    describe('toPascalCase', () => {
      it('converts kebab-case and snake_case to PascalCase', () => {
        expect(toPascalCase('order-items')).toBe('OrderItems');
        expect(toPascalCase('foo_bar_baz')).toBe('FooBarBaz');
        expect(toPascalCase('user')).toBe('User');
      });

      it('handles falsy input', () => {
        expect(toPascalCase('')).toBe('');
        expect(toPascalCase(null)).toBe('');
        expect(toPascalCase(undefined)).toBe('');
      });
    });
  });

  describe('core/utils/object', () => {
    describe('ensureArray', () => {
      it('returns empty array for null and undefined', () => {
        expect(ensureArray(null)).toEqual([]);
        expect(ensureArray(undefined)).toEqual([]);
      });

      it('returns existing array as-is', () => {
        const arr = [1, 2, 3];
        expect(ensureArray(arr)).toBe(arr);
      });

      it('wraps non-array values in array', () => {
        expect(ensureArray('foo')).toEqual(['foo']);
        expect(ensureArray(123)).toEqual([123]);
        const obj = { a: 1 };
        expect(ensureArray(obj)).toEqual([obj]);
      });
    });

    describe('pick', () => {
      it('picks specified keys from object', () => {
        const src = { a: 1, b: 2, c: 3 };
        expect(pick(src, ['a', 'c'])).toEqual({ a: 1, c: 3 });
      });

      it('supports single string key', () => {
        const src = { a: 1, b: 2 };
        expect(pick(src, 'a')).toEqual({ a: 1 });
      });

      it('handles missing keys and non-object inputs', () => {
        expect(pick({ a: 1 }, ['b', 'c'])).toEqual({});
        expect(pick(null, ['a'])).toEqual({});
        expect(pick(undefined, ['a'])).toEqual({});
      });
    });

    describe('omit', () => {
      it('omits specified keys from object', () => {
        const src = { a: 1, b: 2, c: 3 };
        expect(omit(src, ['b'])).toEqual({ a: 1, c: 3 });
      });

      it('supports single string key', () => {
        const src = { a: 1, b: 2, c: 3 };
        expect(omit(src, 'b')).toEqual({ a: 1, c: 3 });
      });

      it('handles non-object inputs', () => {
        expect(omit(null, ['a'])).toEqual({});
        expect(omit(undefined, ['a'])).toEqual({});
      });
    });

    describe('deepClone', () => {
      it('clones nested objects and arrays', () => {
        const src = { a: 1, b: { c: [1, 2] } };
        const cloned = deepClone(src);
        expect(cloned).toEqual(src);
        expect(cloned).not.toBe(src);
        expect(cloned.b).not.toBe(src.b);
        expect(cloned.b.c).not.toBe(src.b.c);
      });

      it('clones Date instances', () => {
        const d = new Date('2026-10-18T00:00:00.000Z');
        const cloned = deepClone({ d });
        expect(cloned.d).toBeInstanceOf(Date);
        expect(cloned.d).not.toBe(d);
        expect(cloned.d.getTime()).toBe(d.getTime());
      });

      it('returns primitives as-is', () => {
        expect(deepClone(null)).toBeNull();
        expect(deepClone(undefined)).toBeUndefined();
        expect(deepClone(123)).toBe(123);
        expect(deepClone('test')).toBe('test');
        expect(deepClone(true)).toBe(true);
      });

      it('prevents prototype pollution', () => {
        const malicious = JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"evil": true}, "safe": "val"}');
        const cloned = deepClone(malicious);
        expect(cloned.safe).toBe('val');
        expect(({}).polluted).toBeUndefined();
      });
    });
  });

  describe('core/utils/array', () => {
    it('re-exports ensureArray', () => {
      expect(typeof arrayUtils.ensureArray).toBe('function');
      expect(arrayUtils.ensureArray('test')).toEqual(['test']);
    });
  });

  describe('Root and Helper re-exports', () => {
    it('re-exports utilities on main index.js module', () => {
      expect(typeof webspresso.toCamelCase).toBe('function');
      expect(typeof webspresso.snakeToCamel).toBe('function');
      expect(typeof webspresso.toSnakeCase).toBe('function');
      expect(typeof webspresso.camelToSnake).toBe('function');
      expect(typeof webspresso.toKebabCase).toBe('function');
      expect(typeof webspresso.toPascalCase).toBe('function');
      expect(typeof webspresso.ensureArray).toBe('function');
      expect(typeof webspresso.pick).toBe('function');
      expect(typeof webspresso.omit).toBe('function');
      expect(typeof webspresso.deepClone).toBe('function');

      expect(webspresso.toCamelCase('foo-bar')).toBe('fooBar');
      expect(webspresso.toSnakeCase('fooBar')).toBe('foo_bar');
      expect(webspresso.ensureArray('val')).toEqual(['val']);
      expect(webspresso.pick({ a: 1, b: 2 }, 'a')).toEqual({ a: 1 });
    });

    it('re-exports utilities on helpers.js utils', () => {
      expect(typeof utils.toCamelCase).toBe('function');
      expect(typeof utils.snakeToCamel).toBe('function');
      expect(typeof utils.toSnakeCase).toBe('function');
      expect(typeof utils.camelToSnake).toBe('function');
      expect(typeof utils.toKebabCase).toBe('function');
      expect(typeof utils.toPascalCase).toBe('function');
      expect(typeof utils.ensureArray).toBe('function');
      expect(typeof utils.pick).toBe('function');
      expect(typeof utils.omit).toBe('function');
      expect(typeof utils.deepClone).toBe('function');

      expect(utils.toCamelCase('foo-bar')).toBe('fooBar');
      expect(utils.toSnakeCase('fooBar')).toBe('foo_bar');
      expect(utils.ensureArray('val')).toEqual(['val']);
    });
  });
});

/**
 * Tests for Field Renderers safe date parsing and formatting
 */

const fs = require('fs');
const path = require('path');

// Mock Mithril m function signature: m(selector, attrs, children) or m(selector, children)
const mockM = (tag, attrsOrChildren, ...children) => {
  let attrs = {};
  let childList = [];
  if (attrsOrChildren && typeof attrsOrChildren === 'object' && !Array.isArray(attrsOrChildren)) {
    attrs = attrsOrChildren;
    childList = children.flat();
  } else if (attrsOrChildren !== undefined) {
    childList = [attrsOrChildren, ...children].flat();
  }
  return { tag, attrs, children: childList };
};

global.m = mockM;

const basicRenderers = require('../../../plugins/admin-panel/field-renderers/basic');

describe('Field Renderers - Safe Date Handling', () => {
  describe('basic field renderers', () => {
    it('DateField handles valid date value correctly', () => {
      const vnode = { attrs: { name: 'created_at', value: '2026-08-12T12:00:00.000Z' } };
      const res = basicRenderers.DateField.view(vnode);
      expect(res).toBeDefined();
      const input = res.children[1];
      expect(input.attrs.value).toBe('2026-08-12');
    });

    it('DateField handles invalid date value without throwing RangeError', () => {
      const invalidValues = ['invalid-date', '0000-00-00 00:00:00', 'abc', {}, NaN];
      for (const val of invalidValues) {
        const vnode = { attrs: { name: 'created_at', value: val } };
        expect(() => {
          const res = basicRenderers.DateField.view(vnode);
          expect(res.children[1].attrs.value).toBe('');
        }).not.toThrow();
      }
    });

    it('DateTimeField handles valid datetime value correctly', () => {
      const vnode = { attrs: { name: 'created_at', value: '2026-08-12T15:30:00.000Z' } };
      const res = basicRenderers.DateTimeField.view(vnode);
      expect(res).toBeDefined();
      const input = res.children[1];
      expect(input.attrs.value).toBe('2026-08-12T15:30');
    });

    it('DateTimeField handles invalid date value without throwing RangeError', () => {
      const invalidValues = ['invalid-date', '0000-00-00 00:00:00', 'abc', {}, NaN];
      for (const val of invalidValues) {
        const vnode = { attrs: { name: 'created_at', value: val } };
        expect(() => {
          const res = basicRenderers.DateTimeField.view(vnode);
          expect(res.children[1].attrs.value).toBe('');
        }).not.toThrow();
      }
    });
  });

  describe('SPA 04-field-renderers.js part', () => {
    let FieldRenderers;
    beforeAll(() => {
      const fileContent = fs.readFileSync(
        path.join(__dirname, '../../../plugins/admin-panel/client/parts/04-field-renderers.js'),
        'utf8'
      );
      const formatColumnLabel = (str) => str;
      const api = {};
      const evalFn = new Function('m', 'formatColumnLabel', 'api', fileContent + '\nreturn FieldRenderers;');
      FieldRenderers = evalFn(mockM, formatColumnLabel, api);
    });

    it('date renderer handles valid date correctly', () => {
      const col = { name: 'birthdate' };
      const vnode = FieldRenderers.date(col, '2026-08-12T12:00:00.000Z', () => {}, false);
      const input = vnode.children[1];
      expect(input.attrs.value).toBe('2026-08-12');
    });

    it('date renderer handles invalid dates without throwing', () => {
      const col = { name: 'birthdate' };
      const invalidValues = ['invalid-date', '0000-00-00 00:00:00', 'abc', {}, NaN];
      for (const val of invalidValues) {
        expect(() => {
          const vnode = FieldRenderers.date(col, val, () => {}, false);
          expect(vnode.children[1].attrs.value).toBe('');
        }).not.toThrow();
      }
    });

    it('datetime renderer handles valid datetime correctly', () => {
      const col = { name: 'event_time' };
      const vnode = FieldRenderers.datetime(col, '2026-08-12T15:30:00.000Z', () => {}, false);
      const input = vnode.children[1];
      expect(input.attrs.value).toBe('2026-08-12T15:30');
    });

    it('datetime renderer handles invalid datetimes without throwing', () => {
      const col = { name: 'event_time' };
      const invalidValues = ['invalid-date', '0000-00-00 00:00:00', 'abc', {}, NaN];
      for (const val of invalidValues) {
        expect(() => {
          const vnode = FieldRenderers.datetime(col, val, () => {}, false);
          expect(vnode.children[1].attrs.value).toBe('');
        }).not.toThrow();
      }
    });
  });
});

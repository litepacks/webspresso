import { describe, it, expect } from 'vitest';
import { escapeHtml, unescapeHtml } from '../../../core/utils/html';
import coreUtils from '../../../core/utils';
import { utils } from '../../../src/helpers';
import webspresso from '../../../index';

describe('Zero-Dependency HTML Utilities (core/utils/html)', () => {
  it('exports escapeHtml and unescapeHtml across core, core/utils index, helpers.utils, and root webspresso', () => {
    expect(typeof escapeHtml).toBe('function');
    expect(typeof unescapeHtml).toBe('function');
    expect(typeof coreUtils.escapeHtml).toBe('function');
    expect(typeof coreUtils.unescapeHtml).toBe('function');
    expect(typeof utils.escapeHtml).toBe('function');
    expect(typeof utils.unescapeHtml).toBe('function');
    expect(typeof webspresso.escapeHtml).toBe('function');
    expect(typeof webspresso.unescapeHtml).toBe('function');
  });

  it('escapes standard HTML special characters (&, <, >, ", \')', () => {
    expect(escapeHtml('<script>alert("XSS & attack")</script>')).toBe(
      '&lt;script&gt;alert(&quot;XSS &amp; attack&quot;)&lt;/script&gt;'
    );
    expect(escapeHtml("John's car")).toBe('John&#39;s car');
    expect(escapeHtml('<b>"&"</b>')).toBe('&lt;b&gt;&quot;&amp;&quot;&lt;/b&gt;');
  });

  it('safely handles empty, null, and undefined values', () => {
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('converts non-string inputs to string before escaping', () => {
    expect(escapeHtml(12345)).toBe('12345');
    expect(escapeHtml(0)).toBe('0');
    expect(escapeHtml(false)).toBe('false');
    expect(escapeHtml(true)).toBe('true');
  });

  it('fast-paths strings without special characters', () => {
    const safeStr = 'Plain text without any special HTML characters 12345';
    expect(escapeHtml(safeStr)).toBe(safeStr);
  });

  it('unescapes HTML entities back to characters', () => {
    expect(
      unescapeHtml('&lt;script&gt;alert(&quot;XSS &amp; attack&quot;)&lt;/script&gt;')
    ).toBe('<script>alert("XSS & attack")</script>');
    expect(unescapeHtml('John&#39;s car')).toBe("John's car");
    expect(unescapeHtml('John&#039;s car')).toBe("John's car");
    expect(unescapeHtml('John&#x27;s car')).toBe("John's car");
    expect(unescapeHtml('')).toBe('');
    expect(unescapeHtml(null)).toBe('');
    expect(unescapeHtml(undefined)).toBe('');
    expect(unescapeHtml(12345)).toBe('12345');
    expect(unescapeHtml(0)).toBe('0');
    expect(unescapeHtml(false)).toBe('false');
  });

  it('works seamlessly through utils and webspresso exports', () => {
    expect(utils.escapeHtml('<div>Hello</div>')).toBe('&lt;div&gt;Hello&lt;/div&gt;');
    expect(utils.unescapeHtml('&lt;div&gt;Hello&lt;/div&gt;')).toBe('<div>Hello</div>');
    expect(webspresso.escapeHtml('<span>Test</span>')).toBe('&lt;span&gt;Test&lt;/span&gt;');
    expect(webspresso.unescapeHtml('&lt;span&gt;Test&lt;/span&gt;')).toBe('<span>Test</span>');
  });
});

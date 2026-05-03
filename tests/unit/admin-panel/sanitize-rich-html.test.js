/**
 * @vitest-environment node
 */

const { sanitizeRichHtml } = require('../../../plugins/admin-panel/lib/sanitize-rich-html');

describe('sanitizeRichHtml', () => {
  it('passes through null and undefined', () => {
    expect(sanitizeRichHtml(null)).toBe(null);
    expect(sanitizeRichHtml(undefined)).toBe(undefined);
  });

  it('passes through non-string values unchanged', () => {
    expect(sanitizeRichHtml(42)).toBe(42);
    expect(sanitizeRichHtml({ x: 1 })).toEqual({ x: 1 });
  });

  it('removes script tags and keeps safe markup', () => {
    const dirty = '<p>Hello</p><script>alert(1)</script><strong>x</strong>';
    const clean = sanitizeRichHtml(dirty);
    expect(clean).not.toMatch(/script/i);
    expect(clean).toContain('Hello');
    expect(clean).toContain('<strong>');
  });

  it('removes iframe and event-handler injection', () => {
    const dirty =
      '<p onclick="evil()">a</p><iframe src="https://evil.test"></iframe><img src=x onerror=alert(1)>';
    const clean = sanitizeRichHtml(dirty);
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).not.toMatch(/iframe/i);
    expect(clean).not.toMatch(/onerror/i);
    expect(clean).not.toMatch(/<img/i);
  });

  it('drops javascript: and data: href on anchors', () => {
    expect(sanitizeRichHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
    expect(sanitizeRichHtml('<a href="data:text/html,<svg>">x</a>')).not.toContain('data:');
    expect(sanitizeRichHtml('<a href="https://example.com">ok</a>')).toContain('https://example.com');
  });

  it('allows mailto and relative links', () => {
    expect(sanitizeRichHtml('<a href="mailto:a@b.co">m</a>')).toContain('mailto:a@b.co');
    expect(sanitizeRichHtml('<a href="/path?q=1">r</a>')).toContain('href="/path?q=1"');
  });

  it('preserves Quill-oriented lists and headings', () => {
    const html = '<h2 class="ql-align-center">T</h2><ul><li class="ql-indent-1">i</li></ul>';
    const clean = sanitizeRichHtml(html);
    expect(clean).toContain('<h2');
    expect(clean).toContain('ql-align-center');
    expect(clean).toContain('<ul>');
    expect(clean).toContain('ql-indent-1');
  });

  it('strips unknown tags such as svg/math', () => {
    const clean = sanitizeRichHtml('<p>a</p><svg><script xlink:href="//x"/></svg>');
    expect(clean).not.toMatch(/svg/i);
    expect(clean).toContain('<p>');
  });
});

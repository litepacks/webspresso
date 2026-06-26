/**
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { escapeHtml, wrapEditable, wrapEntryBlock } from '../../../core/content/renderer.js';

describe('content renderer', () => {
  it('escapeHtml neutralizes special characters', () => {
    expect(escapeHtml('<b>"&"</b>')).toBe('&lt;b&gt;&quot;&amp;&quot;&lt;/b&gt;');
    expect(escapeHtml(null)).toBe('');
  });

  it('wrapEditable returns plain text for public users', () => {
    expect(
      wrapEditable('Title', { entryId: 1, typeSlug: 'hero', field: 'title', isAdmin: false })
    ).toBe('Title');
  });

  it('wrapEditable escapes value for admin when not safeHtml', () => {
    const html = wrapEditable('<img>', {
      entryId: 1,
      typeSlug: 'hero',
      field: 'title',
      isAdmin: true,
    });
    expect(html).toContain('&lt;img&gt;');
    expect(html).toContain('class="ws-content-editable"');
  });

  it('wrapEntryBlock adds label from meta', () => {
    const html = wrapEntryBlock('<p>x</p>', {
      entryId: 3,
      typeSlug: 'faq',
      label: 'FAQ Block',
      isAdmin: true,
    });
    expect(html).toContain('data-ws-content-label="FAQ Block"');
  });
});

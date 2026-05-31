import { describe, it, expect } from 'vitest';
import { parseMarkdownContent, buildExcerpt } from '../../core/content/parse';
import { resolveSlug } from '../../core/content/slug';

describe('content parse', () => {
  it('parses frontmatter and markdown to html', () => {
    const raw = `---
title: Test Post
description: A test
tags: [a, b]
---

# Heading

Paragraph with **bold**.`;
    const result = parseMarkdownContent(raw);
    expect(result.fm.title).toBe('Test Post');
    expect(result.body).toContain('# Heading');
    expect(result.html).toContain('<h1');
    expect(result.html).toContain('bold');
    expect(result.excerpt.length).toBeGreaterThan(0);
    expect(result.excerpt.length).toBeLessThanOrEqual(161);
  });

  it('builds excerpt from plain text', () => {
    const ex = buildExcerpt('word '.repeat(50));
    expect(ex.endsWith('…')).toBe(true);
  });

  it('resolves slug priority', () => {
    expect(resolveSlug({ frontmatterSlug: 'custom', fileBaseName: 'file', title: 'T' })).toBe('custom');
    expect(resolveSlug({ fileBaseName: 'my-post', title: 'Title' })).toBe('my-post');
    expect(resolveSlug({ fileBaseName: 'index', title: 'Hello World!' })).toBe('hello-world');
  });
});

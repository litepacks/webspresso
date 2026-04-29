/**
 * Unit tests: src/njk-frontmatter.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  parseNjkFrontmatter,
  frontmatterToPatches,
  loadNjkRouteTemplate,
  clearNjkFrontmatterCaches,
  extractFrontmatterBlock,
} = require('../../src/njk-frontmatter');

describe('njk-frontmatter.js', () => {
  afterEach(() => {
    clearNjkFrontmatterCaches();
  });

  describe('extractFrontmatterBlock', () => {
    it('does not match when --- is not at start', () => {
      const r = extractFrontmatterBlock('x\n---\na: 1\n---\n');
      expect(r.extracted).toBe(false);
    });
  });

  describe('parseNjkFrontmatter', () => {
    it('returns full body when no frontmatter', () => {
      const raw = '{% extends "layout.njk" %}\n';
      const { body, fm, hasDelimiter } = parseNjkFrontmatter(raw);
      expect(hasDelimiter).toBe(false);
      expect(fm).toBeNull();
      expect(body).toContain('extends');
    });

    it('parses YAML map and strips block from body', () => {
      const raw = `---
title: Hello
description: World
---
{% extends "layout.njk" %}`;
      const { body, fm, hasDelimiter } = parseNjkFrontmatter(raw);
      expect(hasDelimiter).toBe(true);
      expect(body.trim().startsWith('{%')).toBe(true);
      expect(fm).toMatchObject({
        title: 'Hello',
        description: 'World',
      });
    });

    it('supports nested meta merged with flat keys', () => {
      const raw = `---
meta:
  description: Nested desc
description: Overlay
---
{# x #}`;
      const { fm } = parseNjkFrontmatter(raw);
      const patches = frontmatterToPatches(fm);
      expect(patches.metaPatch.description).toBe('Overlay');
    });

    it('strips BOM before matching', () => {
      const raw = '\uFEFF---\na: 1\n---\nh';
      const { body, fm } = parseNjkFrontmatter(raw);
      expect(body).toBe('h');
      expect(fm).toMatchObject({ a: 1 });
    });

    it('parses empty yaml as empty fm object', () => {
      const raw = '---\n\n---\nba';
      const { body, fm, hasDelimiter } = parseNjkFrontmatter(raw);
      expect(hasDelimiter).toBe(true);
      expect(fm).toEqual({});
      expect(body).toContain('ba');
    });
  });

  describe('frontmatterToPatches', () => {
    it('copies data into dataPatch only when object-shaped', () => {
      expect(
        frontmatterToPatches({
          data: { x: 1 },
        })
      ).toEqual({
        metaPatch: {},
        dataPatch: { x: 1 },
      });
    });
  });

  describe('loadNjkRouteTemplate', () => {
    it('loads from filesystem and merges patches (cold prod cache)', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-fm-'));
      const fp = path.join(dir, 'p.njk');
      fs.writeFileSync(
        fp,
        `---
title: T
---
{% extends "layout.njk" %}`,
        'utf8'
      );
      clearNjkFrontmatterCaches();

      try {
        const first = loadNjkRouteTemplate(fp, false);
        expect(first.useStringRender).toBe(true);
        expect(first.metaPatch.title).toBe('T');

        fs.writeFileSync(
          fp,
          `---
title: Updated
---
x`,
          'utf8'
        );

        const secondCold = loadNjkRouteTemplate(fp, false);
        expect(secondCold.metaPatch.title).toBe('T');
      } finally {
        fs.unlinkSync(fp);
        fs.rmdirSync(dir);
      }
    });

    it('invalidate dev cache when mtime changes', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-fm-dev-'));
      const fp = path.join(dir, 'q.njk');
      fs.writeFileSync(
        fp,
        `---
title: Old
---
a`,
        'utf8'
      );
      clearNjkFrontmatterCaches();

      try {
        const a = loadNjkRouteTemplate(fp, true);
        expect(a.metaPatch.title).toBe('Old');

        fs.writeFileSync(
          fp,
          `---
title: New
---
b`,
          'utf8'
        );

        const b = loadNjkRouteTemplate(fp, true);
        expect(b.metaPatch.title).toBe('New');
      } finally {
        fs.unlinkSync(fp);
        fs.rmdirSync(dir);
      }
    });
  });
});

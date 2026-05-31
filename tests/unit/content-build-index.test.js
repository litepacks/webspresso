import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { buildContentIndexPhase } from '../../core/build/phases/02b-content-index';

describe('buildContentIndexPhase', () => {
  it('returns null when no content config', () => {
    const out = buildContentIndexPhase({ cwd: process.cwd(), config: {} });
    expect(out).toBeNull();
  });

  it('builds index items from content dir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-build-content-'));
    const contentDir = path.join(dir, 'content', 'blog');
    fs.mkdirSync(contentDir, { recursive: true });
    fs.writeFileSync(
      path.join(contentDir, 'post.md'),
      '---\ntitle: Build Post\ndate: "2026-01-01"\n---\n\nHello build'
    );
    const out = buildContentIndexPhase(
      { cwd: dir, config: { content: { enabled: true, dir: 'content' } } },
      { content: { enabled: true, dir: 'content' } }
    );
    expect(out?.items?.length).toBe(1);
    expect(out.items[0].title).toBe('Build Post');
  });
});

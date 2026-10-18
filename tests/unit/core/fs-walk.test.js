import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { walkDirectory, walkDirectoryDetailed, DEFAULT_TEST_SUFFIXES } from '../../../core/utils/fs';
import walkReexport from '../../../core/utils/walk';
import { utils, walkDirectory as indexWalkDirectory, walkDirectoryDetailed as indexWalkDetailed } from '../../../index';

describe('core/utils/fs - Directory Walking & Discovery', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-walk-test-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns empty array when directory does not exist or is invalid', () => {
    expect(walkDirectory(null)).toEqual([]);
    expect(walkDirectory(undefined)).toEqual([]);
    expect(walkDirectory('')).toEqual([]);
    expect(walkDirectory(path.join(tempDir, 'nonexistent'))).toEqual([]);
    expect(walkDirectoryDetailed(path.join(tempDir, 'nonexistent'))).toEqual([]);
  });

  it('returns empty array when directory is empty', () => {
    expect(walkDirectory(tempDir)).toEqual([]);
    expect(walkDirectoryDetailed(tempDir)).toEqual([]);
  });

  it('scans flat directory and returns absolute paths', () => {
    fs.writeFileSync(path.join(tempDir, 'file1.js'), '// file 1');
    fs.writeFileSync(path.join(tempDir, 'file2.js'), '// file 2');

    const files = walkDirectory(tempDir);
    expect(files).toHaveLength(2);
    expect(files).toContain(path.join(tempDir, 'file1.js'));
    expect(files).toContain(path.join(tempDir, 'file2.js'));
  });

  it('scans nested directories recursively by default', () => {
    const subDir1 = path.join(tempDir, 'sub1');
    const subDir2 = path.join(tempDir, 'sub1', 'sub2');
    fs.mkdirSync(subDir2, { recursive: true });

    fs.writeFileSync(path.join(tempDir, 'root.js'), '// root');
    fs.writeFileSync(path.join(subDir1, 'nested1.js'), '// nested 1');
    fs.writeFileSync(path.join(subDir2, 'nested2.js'), '// nested 2');

    const files = walkDirectory(tempDir);
    expect(files).toHaveLength(3);
    expect(files).toContain(path.join(tempDir, 'root.js'));
    expect(files).toContain(path.join(subDir1, 'nested1.js'));
    expect(files).toContain(path.join(subDir2, 'nested2.js'));
  });

  it('honors recursive: false by scanning only top-level files', () => {
    const subDir = path.join(tempDir, 'sub');
    fs.mkdirSync(subDir);

    fs.writeFileSync(path.join(tempDir, 'root.js'), '// root');
    fs.writeFileSync(path.join(subDir, 'nested.js'), '// nested');

    const files = walkDirectory(tempDir, { recursive: false });
    expect(files).toHaveLength(1);
    expect(files).toEqual([path.join(tempDir, 'root.js')]);
  });

  it('filters files by extensions (case-insensitive, with or without leading dot)', () => {
    fs.writeFileSync(path.join(tempDir, 'a.js'), '');
    fs.writeFileSync(path.join(tempDir, 'b.CJS'), '');
    fs.writeFileSync(path.join(tempDir, 'c.json'), '');
    fs.writeFileSync(path.join(tempDir, 'd.txt'), '');

    const jsFiles = walkDirectory(tempDir, { extensions: ['.js', 'cjs'] });
    expect(jsFiles).toHaveLength(2);
    expect(jsFiles).toContain(path.join(tempDir, 'a.js'));
    expect(jsFiles).toContain(path.join(tempDir, 'b.CJS'));

    const jsonFiles = walkDirectory(tempDir, { extensions: ['.json'] });
    expect(jsonFiles).toHaveLength(1);
    expect(jsonFiles).toContain(path.join(tempDir, 'c.json'));
  });

  it('ignores test files and declaration files by default', () => {
    fs.writeFileSync(path.join(tempDir, 'service.js'), '');
    fs.writeFileSync(path.join(tempDir, 'service.test.js'), '');
    fs.writeFileSync(path.join(tempDir, 'service.spec.js'), '');
    fs.writeFileSync(path.join(tempDir, 'types.d.ts'), '');

    const files = walkDirectory(tempDir);
    expect(files).toHaveLength(1);
    expect(files).toEqual([path.join(tempDir, 'service.js')]);
  });

  it('includes test files when ignoreTests: false is set', () => {
    fs.writeFileSync(path.join(tempDir, 'service.js'), '');
    fs.writeFileSync(path.join(tempDir, 'service.test.js'), '');

    const files = walkDirectory(tempDir, { ignoreTests: false });
    expect(files).toHaveLength(2);
  });

  it('ignores prefixes like . and _ by default for files and directories', () => {
    const hiddenDir = path.join(tempDir, '.hidden');
    const privateDir = path.join(tempDir, '_private');
    fs.mkdirSync(hiddenDir);
    fs.mkdirSync(privateDir);

    fs.writeFileSync(path.join(hiddenDir, 'hidden.js'), '');
    fs.writeFileSync(path.join(privateDir, 'internal.js'), '');
    fs.writeFileSync(path.join(tempDir, '.env.js'), '');
    fs.writeFileSync(path.join(tempDir, '_helper.js'), '');
    fs.writeFileSync(path.join(tempDir, 'public.js'), '');

    const files = walkDirectory(tempDir);
    expect(files).toHaveLength(1);
    expect(files).toEqual([path.join(tempDir, 'public.js')]);
  });

  it('ignores specified exact names like node_modules', () => {
    const nmDir = path.join(tempDir, 'node_modules');
    fs.mkdirSync(nmDir);
    fs.writeFileSync(path.join(nmDir, 'pkg.js'), '');
    fs.writeFileSync(path.join(tempDir, 'app.js'), '');

    const files = walkDirectory(tempDir);
    expect(files).toHaveLength(1);
    expect(files).toEqual([path.join(tempDir, 'app.js')]);
  });

  it('supports custom filter callback', () => {
    fs.writeFileSync(path.join(tempDir, 'include-me.js'), '');
    fs.writeFileSync(path.join(tempDir, 'skip-me.js'), '');

    const files = walkDirectory(tempDir, {
      filter: (fullPath, dirent) => dirent.name.includes('include'),
    });
    expect(files).toHaveLength(1);
    expect(files).toEqual([path.join(tempDir, 'include-me.js')]);
  });

  it('walkDirectoryDetailed returns structured items with normalized relative paths', () => {
    const sub = path.join(tempDir, 'nested', 'deep');
    fs.mkdirSync(sub, { recursive: true });

    fs.writeFileSync(path.join(tempDir, 'index.html'), '<html>');
    fs.writeFileSync(path.join(sub, 'card.njk'), '<div>card</div>');

    const items = walkDirectoryDetailed(tempDir, {
      extensions: ['.njk', '.html'],
      ignorePrefixes: ['.'],
    });

    expect(items).toHaveLength(2);

    const htmlItem = items.find(i => i.name === 'index.html');
    expect(htmlItem).toBeDefined();
    expect(htmlItem.absolutePath).toBe(path.join(tempDir, 'index.html'));
    expect(htmlItem.relativePath).toBe('index.html');
    expect(htmlItem.ext).toBe('.html');

    const njkItem = items.find(i => i.name === 'card.njk');
    expect(njkItem).toBeDefined();
    expect(njkItem.absolutePath).toBe(path.join(sub, 'card.njk'));
    expect(njkItem.relativePath).toBe('nested/deep/card.njk');
    expect(njkItem.ext).toBe('.njk');
  });

  it('provides direct and index re-exports consistently', () => {
    expect(typeof walkReexport).toBe('function');
    expect(typeof walkReexport.walkDirectory).toBe('function');
    expect(typeof walkReexport.walkDirectoryDetailed).toBe('function');

    expect(typeof indexWalkDirectory).toBe('function');
    expect(typeof indexWalkDetailed).toBe('function');

    expect(typeof utils.walkDirectory).toBe('function');
    expect(typeof utils.walkDirectoryDetailed).toBe('function');

    expect(Array.isArray(DEFAULT_TEST_SUFFIXES)).toBe(true);
  });
});

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scaffoldAgentsFiles } from '../../../bin/commands/agents-init.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('agents:init command', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-agents-test-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('scaffolds complete agent suite into target project', () => {
    const result = scaffoldAgentsFiles(tempDir);

    expect(result.installed).toContain('AGENTS.md');
    expect(result.installed).toContain('CLAUDE.md');
    expect(result.installed).toContain('.cursorrules');
    expect(result.installed.some((f) => f.startsWith('.agents/'))).toBe(true);

    expect(fs.existsSync(path.join(tempDir, 'AGENTS.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'CLAUDE.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.cursorrules'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.agents', 'ROUTING.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.agents', 'ORM.md'))).toBe(true);
  });

  it('skips existing files when force is false', () => {
    // Initial run
    scaffoldAgentsFiles(tempDir);

    // Modify a file
    const customContent = '# My Custom Agents File';
    fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), customContent, 'utf8');

    // Second run without force
    const secondResult = scaffoldAgentsFiles(tempDir, { force: false });
    expect(secondResult.skipped).toContain('AGENTS.md');
    expect(fs.readFileSync(path.join(tempDir, 'AGENTS.md'), 'utf8')).toBe(customContent);
  });

  it('overwrites existing files when force is true', () => {
    // Initial run
    scaffoldAgentsFiles(tempDir);

    // Modify a file
    fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), '# Old content', 'utf8');

    // Run with force: true
    const forceResult = scaffoldAgentsFiles(tempDir, { force: true });
    expect(forceResult.installed).toContain('AGENTS.md');
    expect(fs.readFileSync(path.join(tempDir, 'AGENTS.md'), 'utf8')).not.toBe('# Old content');
  });

  it('respects --no-claude, --no-cursor, and --no-guides options', () => {
    const result = scaffoldAgentsFiles(tempDir, {
      claude: false,
      cursor: false,
      guides: false,
    });

    expect(result.installed).toContain('AGENTS.md');
    expect(fs.existsSync(path.join(tempDir, 'AGENTS.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'CLAUDE.md'))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, '.cursorrules'))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, '.agents'))).toBe(false);
  });
});

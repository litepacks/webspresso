/**
 * `webspresso start` must honour the platform-provided PORT (Cloud Run, Render, Heroku)
 * instead of overwriting it with the 7331 default.
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Command } = require('commander');
const { registerCommand: registerStart } = require('../../bin/commands/start');

describe('webspresso start port resolution', () => {
  let tmpDir;
  let origCwd;
  let savedEnv;

  beforeEach(() => {
    origCwd = process.cwd();
    savedEnv = { PORT: process.env.PORT, NODE_ENV: process.env.NODE_ENV };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-start-'));
    // server.js records the PORT it sees instead of listening
    fs.writeFileSync(path.join(tmpDir, 'server.js'), 'globalThis.__startPort = process.env.PORT;\n');
    process.chdir(tmpDir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete globalThis.__startPort;
    vi.restoreAllMocks();
  });

  function runStart(args = []) {
    const serverPath = path.join(fs.realpathSync(tmpDir), 'server.js');
    delete require.cache[serverPath];
    const program = new Command();
    program.exitOverride();
    registerStart(program);
    program.parse(['node', 'webspresso', 'start', ...args]);
    return globalThis.__startPort;
  }

  it('uses PORT from the environment when --port is not given', () => {
    process.env.PORT = '8080';
    expect(runStart()).toBe('8080');
    expect(process.env.NODE_ENV).toBe('production');
  });

  it('lets --port override the environment', () => {
    process.env.PORT = '8080';
    expect(runStart(['--port', '9090'])).toBe('9090');
  });

  it('falls back to 7331 when neither is set', () => {
    delete process.env.PORT;
    expect(runStart()).toBe('7331');
  });
});

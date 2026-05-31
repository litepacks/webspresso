/**
 * Doctor command extended checks
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

const CLI = path.join(process.cwd(), 'bin/webspresso.js');

function runDoctor(cwd, args = []) {
  return execFileSync(process.execPath, [CLI, 'doctor', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
  });
}

describe('webspresso doctor', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-doctor-'));
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({
        name: 'doctor-test',
        dependencies: { webspresso: '0.1.0-alpha.0' },
      })
    );
    fs.mkdirSync(path.join(tmp, 'pages'));
    fs.writeFileSync(path.join(tmp, 'server.js'), 'module.exports = {};');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reports missing webspresso dependency', () => {
    const noDep = path.join(tmp, 'no-dep');
    fs.mkdirSync(noDep, { recursive: true });
    fs.writeFileSync(path.join(noDep, 'package.json'), JSON.stringify({ name: 'x' }));
    fs.mkdirSync(path.join(noDep, 'pages'));
    fs.writeFileSync(path.join(noDep, 'server.js'), '');
    const out = runDoctor(noDep);
    expect(out).toMatch(/webspresso not listed/i);
  });

  it('warns on short SESSION_SECRET when admin plugin referenced', () => {
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'config/app.js'),
      `const { adminPanelPlugin } = require('webspresso/plugins');
module.exports = () => ({ plugins: [adminPanelPlugin({ path: '/_admin' })] });`
    );
    fs.writeFileSync(path.join(tmp, '.env'), 'SESSION_SECRET=short\n');
    const out = runDoctor(tmp);
    expect(out).toMatch(/shorter than 32|SESSION_SECRET/i);
  });

  it('passes with adequate SESSION_SECRET', () => {
    fs.writeFileSync(
      path.join(tmp, '.env'),
      'SESSION_SECRET=' + 'a'.repeat(40) + '\n'
    );
    const out = runDoctor(tmp);
    expect(out).toMatch(/SESSION_SECRET.*OK|length OK/i);
  });
});

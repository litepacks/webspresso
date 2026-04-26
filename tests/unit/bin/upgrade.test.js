/**
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import {
  detectPackageManager,
  findWebspressoDep,
} from '../../../bin/commands/upgrade.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('upgrade command helpers', () => {
  it('detectPackageManager prefers pnpm / yarn lockfiles', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-up-'));
    try {
      expect(detectPackageManager(dir)).toBe('npm');
      fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
      expect(detectPackageManager(dir)).toBe('yarn');
      fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
      expect(detectPackageManager(dir)).toBe('pnpm');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('findWebspressoDep resolves prod vs dev', () => {
    expect(
      findWebspressoDep({
        dependencies: { webspresso: '^1.0.0' },
      })
    ).toEqual({ specifier: '^1.0.0', saveDev: false });
    expect(
      findWebspressoDep({
        devDependencies: { webspresso: '0.0.1' },
      })
    ).toEqual({ specifier: '0.0.1', saveDev: true });
    expect(findWebspressoDep({ dependencies: {} })).toBeNull();
  });
});

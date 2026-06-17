/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const promptMock = vi.fn();

vi.mock('inquirer', () => ({
  default: { prompt: promptMock },
}));

describe('admin:password command', () => {
  beforeEach(() => {
    promptMock.mockReset();
  });

  it('uses masked inquirer prompt for interactive password entry', async () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../../../bin/commands/admin-password.js'),
      'utf8'
    );

    expect(source).toContain("require('../../core/auth/hash')");
    expect(source).toContain("type: 'password'");
    expect(source).toContain("mask: '*'");
    expect(source).not.toMatch(/\bbcrypt\.hash\b/);
  });
});

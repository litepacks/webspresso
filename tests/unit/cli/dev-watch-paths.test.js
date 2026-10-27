const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildWatchArgs } = require('../../../bin/commands/dev');

describe('Dev Command buildWatchArgs', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-dev-watch-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('should include core and newly supported watch directories when they exist', () => {
    // Create directories
    fs.mkdirSync(path.join(tempDir, 'pages'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'models'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'services'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'jobs'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'listeners'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'modules'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'migrations'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, '.env'), 'PORT=7331\n');

    const args = buildWatchArgs(tempDir);

    expect(args[0]).toBe('--watch');
    expect(args).toContain('--watch-path=./pages');
    expect(args).toContain('--watch-path=./models');
    expect(args).toContain('--watch-path=./services');
    expect(args).toContain('--watch-path=./jobs');
    expect(args).toContain('--watch-path=./listeners');
    expect(args).toContain('--watch-path=./modules');
    expect(args).toContain('--watch-path=./plugins');
    expect(args).toContain('--watch-path=./migrations');
    expect(args).toContain('--watch-path=./.env');
    expect(args[args.length - 1]).toBe('server.js');
  });

  it('should omit directories that do not exist', () => {
    fs.mkdirSync(path.join(tempDir, 'pages'), { recursive: true });

    const args = buildWatchArgs(tempDir);

    expect(args).toContain('--watch-path=./pages');
    expect(args).not.toContain('--watch-path=./jobs');
    expect(args).not.toContain('--watch-path=./listeners');
    expect(args).not.toContain('--watch-path=./modules');
    expect(args).not.toContain('--watch-path=./plugins');
    expect(args[args.length - 1]).toBe('server.js');
  });
});

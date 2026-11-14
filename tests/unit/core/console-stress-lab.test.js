'use strict';

/**
 * Webspresso - Core Console Stress Lab
 * Stress-tests concurrent VM evaluations, sandbox isolation, hot-reload require-cache invalidation,
 * interactive REPL dot commands, and teardown idempotency under load.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const {
  buildConsoleContext,
  evaluateInConsole,
  startConsole,
  isValidIdentifier,
  clearRequireCacheForDir,
} = require('../../../core/console');
const { createDatabase, defineModel, zdb } = require('../../../core/orm');
const { createFeatureFlagManager } = require('../../../core/flags');

function makeTempAppDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-console-stress-'));
}

function cleanupDir(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('Core Console Stress Lab (VM Eval, Hot Reload, REPL Stream)', () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      cleanupDir(tempDirs.pop());
    }
  });

  it('1. handles 40 concurrent evaluateInConsole() calls with sandbox isolation and error containment', async () => {
    const rootDir = makeTempAppDir();
    tempDirs.push(rootDir);

    const tasks = [];
    for (let i = 0; i < 40; i++) {
      const mod = i % 5;
      if (mod === 0) {
        tasks.push(
          evaluateInConsole(`const isolated_${i} = ${i} * 3;\nawait Promise.resolve(isolated_${i} + 1);`, {
            rootDir,
            env: 'test',
            useColors: false,
          }).then((res) => ({ kind: 'async', i, res }))
        );
      } else if (mod === 1) {
        tasks.push(
          evaluateInConsole(`(${i} + 10);;;`, {
            rootDir,
            env: 'test',
            useColors: false,
          }).then((res) => ({ kind: 'expr', i, res }))
        );
      } else if (mod === 2) {
        // Attempt to pollute sandbox global; must NOT leak to other evaluations
        tasks.push(
          evaluateInConsole(`var leakedVar = ${i};\ntypeof leakedVar === 'number' ? leakedVar : -1`, {
            rootDir,
            env: 'test',
            useColors: false,
          }).then((res) => ({ kind: 'leak-writer', i, res }))
        );
      } else if (mod === 3) {
        // Circular object inspection must not crash util.inspect
        tasks.push(
          evaluateInConsole(`const c = { id: ${i} };\nc.self = c;\nc`, {
            rootDir,
            env: 'test',
            useColors: false,
          }).then((res) => ({ kind: 'circular', i, res }))
        );
      } else {
        // Intentional syntax or runtime error must be captured cleanly
        const code = i % 2 === 0 ? 'const broken = ;' : `throw new Error("boom-${i}")`;
        tasks.push(
          evaluateInConsole(code, {
            rootDir,
            env: 'test',
            useColors: false,
          }).then((res) => ({ kind: 'error', i, res }))
        );
      }
    }

    const results = await Promise.all(tasks);
    expect(results).toHaveLength(40);

    for (const item of results) {
      if (item.kind === 'async') {
        expect(item.res.error).toBeUndefined();
        expect(item.res.result).toBe(item.i * 3 + 1);
      } else if (item.kind === 'expr') {
        expect(item.res.error).toBeUndefined();
        expect(item.res.result).toBe(item.i + 10);
      } else if (item.kind === 'leak-writer') {
        expect(item.res.error).toBeUndefined();
        expect(item.res.result).toBe(item.i);
      } else if (item.kind === 'circular') {
        expect(item.res.error).toBeUndefined();
        expect(item.res.result.id).toBe(item.i);
        expect(item.res.output).toContain('[Circular');
      } else if (item.kind === 'error') {
        expect(item.res.error).toBeTruthy();
        expect(typeof item.res.error.message).toBe('string');
        expect(item.res.output).toBeNull();
      }
    }

    // Verify sandbox isolation after storm
    const probe = await evaluateInConsole(`typeof leakedVar`, {
      rootDir,
      env: 'test',
      useColors: false,
    });
    expect(probe.error).toBeUndefined();
    expect(probe.result).toBe('undefined');
  });

  it('2. hot-reloads mutated and newly added services across 15 consecutive reload() cycles', async () => {
    const rootDir = makeTempAppDir();
    tempDirs.push(rootDir);

    const servicesDir = path.join(rootDir, 'services');
    fs.mkdirSync(servicesDir, { recursive: true });

    const pingFile = path.join(servicesDir, 'ping.js');
    fs.writeFileSync(
      pingFile,
      `const { defineService } = require(${JSON.stringify(path.resolve(__dirname, '../../../src/services'))});
module.exports = defineService({
  handler: async () => ({ version: 1 }),
});
`
    );

    const { context, teardown } = await buildConsoleContext({
      rootDir,
      env: 'test',
    });

    try {
      expect(await context.service('ping')).toEqual({ version: 1 });

      for (let v = 2; v <= 15; v++) {
        fs.writeFileSync(
          pingFile,
          `const { defineService } = require(${JSON.stringify(path.resolve(__dirname, '../../../src/services'))});
module.exports = defineService({
  handler: async () => ({ version: ${v} }),
});
`
        );

        if (v === 8) {
          fs.writeFileSync(
            path.join(servicesDir, 'echo.js'),
            `const { defineService } = require(${JSON.stringify(path.resolve(__dirname, '../../../src/services'))});
module.exports = defineService({
  handler: async ({ input }) => ({ echoed: input?.msg || 'ok' }),
});
`
          );
        }

        const reloadSummary = await context.reload();
        expect(reloadSummary.services).toContain('ping');
        expect(await context.service('ping')).toEqual({ version: v });

        if (v >= 8) {
          expect(reloadSummary.services).toContain('echo');
          expect(await context.service('echo', { msg: `step-${v}` })).toEqual({ echoed: `step-${v}` });
        }
      }
    } finally {
      await teardown();
    }
  });

  it('3. drives a full REPL session through .models, .services, .routes, .flags, .reload, and .exit', async () => {
    const rootDir = makeTempAppDir();
    tempDirs.push(rootDir);

    // Create minimal app structure for .routes and .services
    fs.mkdirSync(path.join(rootDir, 'pages', 'api'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'services'), { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, 'pages', 'api', 'status.get.js'),
      `module.exports = { handler: async (req, res) => res.json({ ok: true }) };`
    );
    fs.writeFileSync(
      path.join(rootDir, 'services', 'health.js'),
      `const { defineService } = require(${JSON.stringify(path.resolve(__dirname, '../../../src/services'))});
module.exports = defineService({ description: 'Health check', handler: async () => ({ ok: true }) });
`
    );

    const testDb = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });
    const StressConsoleModel = defineModel({
      name: 'StressConsoleModel',
      table: 'stress_console_models',
      schema: { id: zdb.id(), title: zdb.string() },
    });
    testDb.registerModel(StressConsoleModel);

    const flags = createFeatureFlagManager({
      flags: { canary_checkout: { enabled: true, rollout: 25 } },
    });

    const input = new PassThrough();
    const output = new PassThrough();
    output.isTTY = true;

    let capturedOutput = '';
    output.on('data', (chunk) => {
      capturedOutput += chunk.toString();
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      capturedOutput += `${args.join(' ')}\n`;
    });

    const { replServer, meta } = await startConsole({
      rootDir,
      db: testDb,
      flags,
      env: 'test',
      input,
      output,
      useColors: false,
      history: false,
      banner: true,
    });

    try {
      expect(meta.modelNames).toContain('StressConsoleModel');
      expect(capturedOutput).toContain('Webspresso Interactive Console');

      const exitPromise = new Promise((resolve) => {
        replServer.once('exit', resolve);
      });

      // Dispatch burst of dot commands and expression evaluation
      input.write('.models\n');
      input.write('.services\n');
      input.write('.routes\n');
      input.write('.flags\n');
      input.write('.reload\n');
      input.write('await service("health")\n');
      input.write('.exit\n');

      await exitPromise;
      // Allow async .reload / exit handlers to settle
      await new Promise((r) => setTimeout(r, 30));

      expect(capturedOutput).toContain('StressConsoleModel');
      expect(capturedOutput).toContain('health');
      expect(capturedOutput).toContain('/api/status');
      expect(capturedOutput).toContain('canary_checkout');
      expect(capturedOutput).toContain('Reloading models and services');
    } finally {
      logSpy.mockRestore();
      if (testDb.knex) await testDb.knex.destroy();
    }
  });

  it('4. handles invalid identifiers, missing require-cache dirs, and unwritable history paths safely', async () => {
    const rootDir = makeTempAppDir();
    tempDirs.push(rootDir);

    // Non-existent dir should be a safe no-op
    expect(() => clearRequireCacheForDir(path.join(rootDir, 'does-not-exist'))).not.toThrow();

    // Identifier validation stress across edge cases
    const validNames = ['A', '_x', '$y', 'OrderItem2', 'CamelCase_123'];
    const invalidNames = ['', '1abc', 'my-model', 'a b', 'foo.bar', 'x+y', 'return;'];
    for (const name of validNames) expect(isValidIdentifier(name)).toBe(true);
    for (const name of invalidNames) expect(isValidIdentifier(name)).toBe(false);

    // startConsole with an unwritable/missing nested history path must not throw
    const input = new PassThrough();
    const output = new PassThrough();
    const { replServer, teardown } = await startConsole({
      rootDir,
      env: 'test',
      input,
      output,
      useColors: false,
      banner: false,
      history: true,
      historyPath: path.join(rootDir, 'nonexistent-parent', 'sub', '.history'),
    });

    await new Promise((r) => setTimeout(r, 20));
    const exitPromise = new Promise((resolve) => replServer.once('exit', resolve));
    replServer.close();
    await exitPromise;
    await teardown();
  });
});

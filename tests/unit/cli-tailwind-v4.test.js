const {
  createTempDir,
  cleanupDir
} = require('../utils');
/**
 * Unit & Integration tests for Tailwind CSS v4 support & migration
 */

const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { registerCommand: registerAddTailwind } = require('../../bin/commands/add-tailwind');
const { registerCommand: registerNew } = require('../../bin/commands/new');
const { registerCommand: registerDoctor } = require('../../bin/commands/doctor');

class ProcessExitError extends Error {
  constructor(code) {
    super(`Process exited with code ${code}`);
    this.exitCode = code;
  }
}

function tokenizeCliLine(line) {
  const tokens = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if ((c === '"' || c === "'") && (!inQuotes || quoteChar === c)) {
      inQuotes = !inQuotes;
      quoteChar = inQuotes ? c : '';
    } else if (c === ' ' && !inQuotes) {
      if (current.length) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += c;
    }
  }
  if (current.length) tokens.push(current);
  return tokens;
}

async function runCli(registerFn, args, options = {}) {
  const argParts = Array.isArray(args) ? [...args] : tokenizeCliLine(args);
  const origCwd = process.cwd();
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;
  const origExit = process.exit;

  let stdout = '';
  let stderr = '';

  console.log = (...msgs) => {
    stdout += msgs.map((m) => (typeof m === 'object' ? JSON.stringify(m) : String(m))).join(' ') + '\n';
  };
  console.error = (...msgs) => {
    stderr += msgs.map((m) => (typeof m === 'object' ? JSON.stringify(m) : String(m))).join(' ') + '\n';
  };
  console.warn = (...msgs) => {
    stdout += msgs.map((m) => (typeof m === 'object' ? JSON.stringify(m) : String(m))).join(' ') + '\n';
  };

  process.exit = (code = 0) => {
    throw new ProcessExitError(code);
  };

  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: (str) => { stdout += str; },
    writeErr: (str) => { stderr += str; },
  });

  registerFn(program);

  let exitCode = 0;
  try {
    if (options.cwd) {
      process.chdir(options.cwd);
    }
    await program.parseAsync(['node', 'webspresso', ...argParts]);
  } catch (err) {
    if (err instanceof ProcessExitError) {
      exitCode = err.exitCode;
    } else if (err && err.exitCode !== undefined) {
      exitCode = err.exitCode;
    } else {
      exitCode = 1;
      stderr += (err?.message || String(err)) + '\n';
    }
  } finally {
    process.chdir(origCwd);
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
    process.exit = origExit;
  }

  return {
    stdout: `${stdout}${stderr}`,
    stderr,
    exitCode,
  };
}

describe('Tailwind CSS v4 CLI Integration', () => {
  let testRoot;

  beforeEach(() => {
    testRoot = createTempDir('webspresso-tw4-test');
  });

  afterEach(() => {
    try {
      cleanupDir(testRoot);
    } catch (_) {}
  });

  it('add tailwind --v4 configures Tailwind v4 Oxide engine with zero postcss config', async () => {
    const projectDir = path.join(testRoot, 'my-v4-app');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
      name: 'my-v4-app',
      version: '1.0.0',
      scripts: {
        dev: 'node server.js',
        start: 'node server.js',
      },
    }, null, 2));

    const result = await runCli(registerAddTailwind, 'add tailwind --v4', { cwd: projectDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Tailwind CSS v4');

    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    expect(pkg.devDependencies['@tailwindcss/cli']).toBeDefined();
    expect(pkg.devDependencies['tailwindcss']).toBeDefined();
    expect(pkg.devDependencies['postcss']).toBeUndefined();
    expect(pkg.devDependencies['autoprefixer']).toBeUndefined();

    expect(pkg.scripts['build:css']).toContain('@tailwindcss/cli');
    expect(pkg.scripts['watch:css']).toContain('@tailwindcss/cli');

    // Input CSS check
    const inputCss = fs.readFileSync(path.join(projectDir, 'src', 'input.css'), 'utf8');
    expect(inputCss).toContain('@import "tailwindcss";');
    expect(inputCss).toContain('@source "../pages/**/*.{njk,js}";');

    // Configs should NOT exist for v4
    expect(fs.existsSync(path.join(projectDir, 'postcss.config.js'))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, 'tailwind.config.js'))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, 'public', 'css', 'style.css'))).toBe(true);
  });

  it('upgrades existing Tailwind v3 project to v4 via --upgrade', async () => {
    const projectDir = path.join(testRoot, 'upgrade-app');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });

    // Setup legacy v3 project
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
      name: 'upgrade-app',
      devDependencies: {
        tailwindcss: '^3.4.1',
        postcss: '^8.4.35',
        autoprefixer: '^10.4.17',
      },
      scripts: {
        'build:css': 'tailwindcss -i ./src/input.css -o ./public/css/style.css',
      },
    }, null, 2));
    fs.writeFileSync(path.join(projectDir, 'postcss.config.js'), 'module.exports = {};');
    fs.writeFileSync(path.join(projectDir, 'tailwind.config.js'), 'module.exports = {};');
    fs.writeFileSync(path.join(projectDir, 'src', 'input.css'), '@tailwind base;\n@tailwind utilities;\n');

    const result = await runCli(registerAddTailwind, 'add tailwind --upgrade', { cwd: projectDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Tailwind CSS v4');

    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    expect(pkg.devDependencies['@tailwindcss/cli']).toBeDefined();
    expect(pkg.devDependencies['postcss']).toBeUndefined();
    expect(pkg.devDependencies['autoprefixer']).toBeUndefined();

    expect(fs.existsSync(path.join(projectDir, 'postcss.config.js'))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, 'tailwind.config.js.backup'))).toBe(true);

    const inputCss = fs.readFileSync(path.join(projectDir, 'src', 'input.css'), 'utf8');
    expect(inputCss).toContain('@import "tailwindcss";');
  });

  it('scaffolds new project with Tailwind v4 via new <name> --tailwind-v4', async () => {
    const projectName = 'new-tw4-project';
    const result = await runCli(registerNew, `new ${projectName} --yes --tailwind-v4`, { cwd: testRoot });
    expect(result.exitCode).toBe(0);

    const projectDir = path.join(testRoot, projectName);
    expect(fs.existsSync(projectDir)).toBe(true);

    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    expect(pkg.devDependencies['@tailwindcss/cli']).toBeDefined();
    expect(pkg.devDependencies['tailwindcss']).toBeDefined();
    expect(pkg.devDependencies['postcss']).toBeUndefined();
    expect(pkg.devDependencies['autoprefixer']).toBeUndefined();

    const inputCss = fs.readFileSync(path.join(projectDir, 'src', 'input.css'), 'utf8');
    expect(inputCss).toContain('@import "tailwindcss";');
  });

  it('webspresso doctor detects Tailwind v4 in project', async () => {
    const projectDir = path.join(testRoot, 'doctor-app');
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'public', 'css'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'server.js'), '// server');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'doctor-app' }));
    fs.writeFileSync(path.join(projectDir, 'src', 'input.css'), '@import "tailwindcss";\n');
    fs.writeFileSync(path.join(projectDir, 'public', 'css', 'style.css'), '/* css */');

    const result = await runCli(registerDoctor, 'doctor', { cwd: projectDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Tailwind CSS v4 detected');
    expect(result.stdout).toContain('Oxide engine');
  });
});

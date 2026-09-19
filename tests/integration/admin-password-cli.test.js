/**
 * Admin Password CLI Tests
 */

const fs = require('fs');
const path = require('path');
const knex = require('knex');
const { Command } = require('commander');
const { hash, verify } = require('../../core/auth/hash');
const { registerCommand: registerAdminPassword } = require('../../bin/commands/admin-password');

const TEST_DIR = path.join(__dirname, '../fixtures/admin-password-cli');
const DB_FILE = path.join(TEST_DIR, 'test.db');
const CONFIG_FILE = path.join(TEST_DIR, 'webspresso.db.js');

class ProcessExitError extends Error {
  constructor(code) {
    super(`Process exited with code ${code}`);
    this.exitCode = code;
  }
}

async function runCliInProcess(args, options = {}) {
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

  registerAdminPassword(program);

  let exitCode = 0;
  try {
    if (options.cwd) {
      process.chdir(options.cwd);
    }
    const argList = Array.isArray(args) ? args : [args];
    await program.parseAsync(['node', 'webspresso', ...argList]);
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
    stdout,
    stderr,
    status: exitCode,
  };
}

describe('admin:password CLI', () => {
  let db;

  beforeAll(async () => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }

    if (fs.existsSync(DB_FILE)) {
      fs.unlinkSync(DB_FILE);
    }

    fs.writeFileSync(
      CONFIG_FILE,
      `module.exports = {
  client: 'better-sqlite3',
  connection: {
    filename: ${JSON.stringify(DB_FILE)},
  },
  useNullAsDefault: true,
};
`
    );

    db = knex({
      client: 'better-sqlite3',
      connection: { filename: DB_FILE },
      useNullAsDefault: true,
    });

    await db.schema.createTable('admin_users', (table) => {
      table.bigIncrements('id');
      table.string('email').unique();
      table.string('password');
      table.string('name');
      table.string('role').defaultTo('admin');
      table.boolean('active').defaultTo(true);
      table.timestamp('created_at');
      table.timestamp('updated_at');
    });

    const hashedPassword = await hash('oldpass123', 4);
    await db('admin_users').insert({
      email: 'admin@example.com',
      password: hashedPassword,
      name: 'Admin User',
      role: 'admin',
      active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should show help for admin:password', async () => {
    const result = await runCliInProcess(['admin:password', '--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Reset admin user password');
    expect(result.stdout).toContain('-e, --email');
    expect(result.stdout).toContain('-p, --password');
  });

  it('should update password with -e and -p flags using core/auth/hash', async () => {
    const result = await runCliInProcess([
      'admin:password',
      '-c',
      CONFIG_FILE,
      '-e',
      'admin@example.com',
      '-p',
      'newpass456',
    ]);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(0);
    expect(output).toContain('Password updated successfully');
    expect(output).not.toContain('bcrypt is not defined');

    const user = await db('admin_users').where({ email: 'admin@example.com' }).first();
    expect(await verify('newpass456', user.password)).toBe(true);
    expect(await verify('oldpass123', user.password)).toBe(false);
  });

  it('should reject password shorter than 6 characters', async () => {
    const result = await runCliInProcess([
      'admin:password',
      '-c',
      CONFIG_FILE,
      '-e',
      'admin@example.com',
      '-p',
      '12345',
    ]);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain('Password must be at least 6 characters');
  });

  it('should fail when admin user email is not found', async () => {
    const result = await runCliInProcess([
      'admin:password',
      '-c',
      CONFIG_FILE,
      '-e',
      'missing@example.com',
      '-p',
      'newpass456',
    ]);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain('not found');
    expect(output).toContain('admin@example.com');
  });

  it('should fail when admin_users table does not exist', async () => {
    const noTableDir = path.join(TEST_DIR, 'no-table');
    const noTableDb = path.join(noTableDir, 'empty.db');
    const noTableConfig = path.join(noTableDir, 'webspresso.db.js');

    fs.mkdirSync(noTableDir, { recursive: true });
    fs.writeFileSync(
      noTableConfig,
      `module.exports = {
  client: 'better-sqlite3',
  connection: { filename: ${JSON.stringify(noTableDb)} },
  useNullAsDefault: true,
};
`
    );

    const result = await runCliInProcess(
      [
        'admin:password',
        '-c',
        noTableConfig,
        '-e',
        'admin@example.com',
        '-p',
        'newpass456',
      ],
      { cwd: noTableDir }
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain('admin_users table does not exist');

    fs.rmSync(noTableDir, { recursive: true, force: true });
  });

  it('should list admin users', async () => {
    const result = await runCliInProcess(['admin:list', '-c', CONFIG_FILE]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Admin Users');
    expect(result.stdout).toContain('admin@example.com');
    expect(result.stdout).toContain('Admin User');
  });
});

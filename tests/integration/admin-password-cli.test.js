/**
 * Admin Password CLI Tests
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const knex = require('knex');
const { hash, verify } = require('../../core/auth/hash');

const CLI_PATH = path.join(__dirname, '../../bin/webspresso.js');
const TEST_DIR = path.join(__dirname, '../fixtures/admin-password-cli');
const DB_FILE = path.join(TEST_DIR, 'test.db');
const CONFIG_FILE = path.join(TEST_DIR, 'webspresso.db.js');

function runCli(subcommand, args = []) {
  return spawnSync(process.execPath, [CLI_PATH, subcommand, ...args], {
    cwd: TEST_DIR,
    encoding: 'utf8',
  });
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

    const hashedPassword = await hash('oldpass123', 10);
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

  it('should show help for admin:password', () => {
    const result = spawnSync(process.execPath, [CLI_PATH, 'admin:password', '--help'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Reset admin user password');
    expect(result.stdout).toContain('-e, --email');
    expect(result.stdout).toContain('-p, --password');
  });

  it('should update password with -e and -p flags using core/auth/hash', async () => {
    const result = runCli('admin:password', [
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

  it('should reject password shorter than 6 characters', () => {
    const result = runCli('admin:password', [
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

  it('should fail when admin user email is not found', () => {
    const result = runCli('admin:password', [
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

  it('should fail when admin_users table does not exist', () => {
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

    const result = spawnSync(
      process.execPath,
      [
        CLI_PATH,
        'admin:password',
        '-c',
        noTableConfig,
        '-e',
        'admin@example.com',
        '-p',
        'newpass456',
      ],
      { cwd: noTableDir, encoding: 'utf8' }
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain('admin_users table does not exist');

    fs.rmSync(noTableDir, { recursive: true, force: true });
  });
});

describe('admin:list CLI', () => {
  const listDir = path.join(TEST_DIR, 'list');
  const listDb = path.join(listDir, 'list.db');
  const listConfig = path.join(listDir, 'webspresso.db.js');

  beforeAll(async () => {
    fs.mkdirSync(listDir, { recursive: true });
    if (fs.existsSync(listDb)) {
      fs.unlinkSync(listDb);
    }

    fs.writeFileSync(
      listConfig,
      `module.exports = {
  client: 'better-sqlite3',
  connection: { filename: ${JSON.stringify(listDb)} },
  useNullAsDefault: true,
};
`
    );

    const db = knex({
      client: 'better-sqlite3',
      connection: { filename: listDb },
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

    await db('admin_users').insert({
      email: 'admin@example.com',
      password: 'hashed',
      name: 'Admin User',
      role: 'admin',
      active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await db.destroy();
  });

  afterAll(() => {
    if (fs.existsSync(listDir)) {
      fs.rmSync(listDir, { recursive: true, force: true });
    }
  });

  it('should list admin users', () => {
    const result = spawnSync(
      process.execPath,
      [CLI_PATH, 'admin:list', '-c', listConfig],
      { cwd: listDir, encoding: 'utf8' }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Admin Users');
    expect(result.stdout).toContain('admin@example.com');
    expect(result.stdout).toContain('Admin User');
  });
});

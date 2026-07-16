/**
 * Email plugin unit tests
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import nodemailer from 'nodemailer';
import { interpolate, renderSource } from '../../plugins/email/render.js';
import { TemplateRegistry } from '../../plugins/email/template-registry.js';
import { createEmailService } from '../../plugins/email/service.js';
import { wireAuthEmails } from '../../plugins/email/auth-bridge.js';
import { createAuth } from '../../core/auth/index.js';
import { createAuthTokensTable } from '../../core/auth/tokens.js';

describe('email render', () => {
  it('interpolates nested keys', () => {
    expect(interpolate('Hi {{user.name}}', { user: { name: 'Ali' } })).toBe('Hi Ali');
  });

  it('compiles minimal MJML', async () => {
    const result = await renderSource({
      mjml: '<mjml><mj-body><mj-section><mj-column><mj-text>Hi {{name}}</mj-text></mj-column></mj-section></mj-body></mjml>',
    }, { name: 'Test' });
    expect(result.html).toContain('Hi Test');
  });

  it('accepts inline MJML string without filesystem', async () => {
    const inline = '<mjml><mj-body><mj-text>Edge {{name}}</mj-text></mj-body></mjml>';
    const result = await renderSource(inline, { name: 'OK' });
    expect(result.html).toContain('Edge OK');
  });

  it('throws clear error for file paths when fs unavailable', async () => {
    const fsEnv = require('../../plugins/email/fs-env');
    const spy = vi.spyOn(fsEnv, 'isFilesystemAvailable').mockReturnValue(false);
    const readSpy = vi.spyOn(fsEnv, 'readFileUtf8').mockReturnValue(null);

    await expect(renderSource('./emails/welcome.mjml', {})).rejects.toThrow(/edge runtimes/i);

    spy.mockRestore();
    readSpy.mockRestore();
  });
});

describe('TemplateRegistry', () => {
  it('loads from map and overrides by register', () => {
    const registry = new TemplateRegistry();
    registry.loadFromMap({ hello: { html: '<p>{{name}}</p>' } });
    registry.register('hello', { html: '<p>Override {{name}}</p>' });
    expect(registry.get('hello').source.html).toContain('Override');
    expect(registry.list()).toHaveLength(1);
  });

  it('loadFromDir warns and skips when fs unavailable', () => {
    const fsEnv = require('../../plugins/email/fs-env');
    const spy = vi.spyOn(fsEnv, 'listMjmlBasenamesInDir').mockReturnValue(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const registry = new TemplateRegistry();
    const count = registry.loadFromDir('./emails');
    expect(count).toBe(0);
    expect(warn).toHaveBeenCalled();

    spy.mockRestore();
    warn.mockRestore();
  });

  it('loads templates from build manifest chunks', () => {
    const registry = new TemplateRegistry();
    const count = registry.loadFromManifest({
      welcome: { mjml: '<mjml><mj-body><mj-text>Hi {{name}}</mj-text></mj-body></mjml>' },
    });
    expect(count).toBe(1);
    expect(registry.has('welcome')).toBe(true);
  });

  it('loads mjml files from directory on Node.js', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-email-'));
    fs.writeFileSync(path.join(dir, 'notice.mjml'), '<mjml><mj-body><mj-text>Notice</mj-text></mj-body></mjml>');
    const registry = new TemplateRegistry();
    const count = registry.loadFromDir(dir);
    expect(count).toBe(1);
    expect(registry.has('notice')).toBe(true);
    expect(registry.get('notice').kind).toBe('inline');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('EmailService', () => {
  let transport;

  beforeEach(() => {
    transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
  });

  it('sends html via template registry', async () => {
    const registry = new TemplateRegistry();
    registry.register('plain', { html: '<p>Hello {{name}}</p>' });

    const service = createEmailService({
      registry,
      transportOptions: { transport },
      defaults: { from: 'test@example.com' },
    });

    const result = await service.sendTemplate('plain', {
      to: 'user@example.com',
      subject: 'Hi',
      data: { name: 'World' },
    });

    expect(result.ok).toBe(true);
    expect(result.messageId).toBeTruthy();
  });

  it('logs to sqlite when knex provided', async () => {
    const { default: knexFactory } = await import('knex');
    const knex = knexFactory({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });

    await knex.schema.createTable('email_logs', (table) => {
      table.increments('id');
      table.string('to');
      table.string('cc');
      table.string('bcc');
      table.string('subject');
      table.string('template_id');
      table.string('from');
      table.string('status');
      table.string('message_id');
      table.text('error');
      table.timestamp('created_at');
    });

    const registry = new TemplateRegistry();
    registry.register('t', { html: '<p>x</p>' });

    const service = createEmailService({
      registry,
      transportOptions: { transport },
      defaults: { from: 'test@example.com' },
      knex,
      logToDb: true,
      tableName: 'email_logs',
    });

    await service.sendTemplate('t', { to: 'a@b.com', subject: 'S' });
    const rows = await knex('email_logs').select('*');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('sent');
    await knex.destroy();
  });
});

describe('auth email bridge', () => {
  it('wires password reset notification', async () => {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const registry = new TemplateRegistry();
    const sent = [];

    const emailService = createEmailService({
      registry,
      transportOptions: { transport },
      defaults: { from: 'noreply@test.com' },
    });

    const originalSend = emailService.sendTemplate.bind(emailService);
    emailService.sendTemplate = async (...args) => {
      sent.push(args);
      return originalSend(...args);
    };

    const auth = createAuth({
      findUserById: async () => null,
      findUserByCredentials: async () => null,
      findUserByIdentifier: async () => ({ id: 1, email: 'user@test.com', name: 'User' }),
      updateUser: async () => ({}),
      session: { secret: 'test-secret-key-32chars-minimum!!' },
      authTokens: {
        create: async () => {},
        find: async () => null,
        delete: async () => {},
        deleteAllForUser: async () => {},
      },
    });

    wireAuthEmails(auth, emailService, registry, {
      enabled: true,
      baseUrl: 'http://localhost:3000',
      passwordReset: { enabled: true, template: 'auth-password-reset', subject: 'Reset' },
      emailVerification: { enabled: false },
      welcome: { enabled: false },
    }, null);

    await auth.requestPasswordReset('user@test.com');
    expect(sent.length).toBe(1);
    expect(sent[0][0]).toBe('auth-password-reset');
    expect(sent[0][1].to).toBe('user@test.com');
  });
});

describe('createAuthTokensTable', () => {
  it('creates auth_tokens when missing', async () => {
    const { default: knexFactory } = await import('knex');
    const knex = knexFactory({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });

    await createAuthTokensTable(knex);
    const exists = await knex.schema.hasTable('auth_tokens');
    expect(exists).toBe(true);
    await knex.destroy();
  });
});

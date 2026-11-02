import { createTempDir, cleanupDir } from '../../utils';
/**
 * Email plugin unit tests
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import knexFactory from 'knex';
import { interpolate, renderSource } from '../../../plugins/email/render.js';
import { TemplateRegistry } from '../../../plugins/email/template-registry.js';
import { createEmailService } from '../../../plugins/email/service.js';
import { wireAuthEmails } from '../../../plugins/email/auth-bridge.js';
import { createAuth } from '../../../core/auth/index.js';
import { createAuthTokensTable } from '../../../core/auth/tokens.js';

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
    const fsEnv = require('../../../plugins/email/fs-env');
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
    const fsEnv = require('../../../plugins/email/fs-env');
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
    const dir = createTempDir('ws-email');
    fs.writeFileSync(path.join(dir, 'notice.mjml'), '<mjml><mj-body><mj-text>Notice</mj-text></mj-body></mjml>');
    const registry = new TemplateRegistry();
    const count = registry.loadFromDir(dir);
    expect(count).toBe(1);
    expect(registry.has('notice')).toBe(true);
    expect(registry.get('notice').kind).toBe('inline');
    cleanupDir(dir);
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

describe('EmailService & API Handlers Enhancements', () => {
  let knex;
  let transport;
  let registry;
  let service;

  beforeEach(async () => {
    knex = knexFactory({
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

    transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    registry = new TemplateRegistry();
    registry.register('welcome', { html: '<p>Welcome {{name}}</p>' });

    service = createEmailService({
      registry,
      transportOptions: { transport },
      defaults: { from: 'support@example.com' },
      knex,
      logToDb: true,
      tableName: 'email_logs',
    });
  });

  afterEach(async () => {
    await knex.destroy();
  });

  it('searches logs by recipient, subject, or template and retrieves by ID', async () => {
    await service.send({ to: 'alice@example.com', subject: 'Invoice #101', html: '<p>Hi</p>' });
    await service.send({ to: 'bob@example.com', subject: 'Password Reset', html: '<p>Hi</p>' });

    const searchAlice = await service.queryLogs({ search: 'alice', includeTotal: true });
    expect(searchAlice.data).toHaveLength(1);
    expect(searchAlice.data[0].to).toBe('alice@example.com');
    expect(searchAlice.meta.total).toBe(1);

    const searchInvoice = await service.queryLogs({ search: 'Invoice', includeTotal: true });
    expect(searchInvoice.data).toHaveLength(1);
    expect(searchInvoice.data[0].subject).toBe('Invoice #101');

    const singleLog = await service.getLogById(searchAlice.data[0].id);
    expect(singleLog).toBeTruthy();
    expect(singleLog.to).toBe('alice@example.com');
  });

  it('resends an existing email log and creates a new log entry', async () => {
    await service.sendTemplate('welcome', {
      to: 'charlie@example.com',
      subject: 'Welcome to Webspresso',
      data: { name: 'Charlie' },
    });

    const initialLogs = await service.queryLogs();
    expect(initialLogs).toHaveLength(1);

    const resendResult = await service.resendLog(initialLogs[0].id, {
      subject: 'Welcome to Webspresso (Resent)',
    });

    expect(resendResult.ok).toBe(true);
    const updatedLogs = await service.queryLogs();
    expect(updatedLogs).toHaveLength(2);
    expect(updatedLogs[0].subject).toBe('Welcome to Webspresso (Resent)');
  });

  it('exposes getLogHandler, resendHandler, and enriched templates via api handlers', async () => {
    const { createEmailApiHandlers } = require('../../../plugins/email/api-handlers');
    const handlers = createEmailApiHandlers({
      emailService: service,
      registry,
      knex,
      tableName: 'email_logs',
    });

    // Send one log to inspect
    await service.send({ to: 'test@domain.com', subject: 'Test Subject', html: '<p>Body</p>' });
    const logs = await service.queryLogs();
    const testId = logs[0].id;

    // Test getLogHandler
    let getResult = null;
    await handlers.getLogHandler(
      { params: { id: testId } },
      { json: (data) => { getResult = data; }, status: () => ({ json: vi.fn() }) }
    );
    expect(getResult.ok).toBe(true);
    expect(getResult.data.to).toBe('test@domain.com');

    // Test resendHandler
    let resendResult = null;
    await handlers.resendHandler(
      { body: { id: testId, subject: 'Resent Test Subject' } },
      { json: (data) => { resendResult = data; }, status: () => ({ json: vi.fn() }) }
    );
    expect(resendResult.ok).toBe(true);

    // Test templatesHandler with sampleData
    let templatesResult = null;
    await handlers.templatesHandler({}, { json: (data) => { templatesResult = data; } });
    expect(templatesResult.data).toHaveLength(1);
    expect(templatesResult.data[0].id).toBe('welcome');
    expect(templatesResult.data[0].sampleData).toBeDefined();
  });

  it('generates valid client-side Mithril component JavaScript', () => {
    const { generateEmailComponent } = require('../../../plugins/email/admin-component');
    const js = generateEmailComponent({ apiPrefix: '/_admin/api/email' });
    expect(typeof js).toBe('string');
    expect(js).toContain("var API = '/_admin/api/email'");
    expect(js).toContain("previewDevice === 'mobile'");
    expect(js).toContain("previewDevice === 'desktop'");
    expect(js).toContain('/retry');
    expect(() => new Function(js)).not.toThrow(); // syntax check only (the component needs a browser)
  });
});


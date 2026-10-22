import { cleanupDir } from '../utils';
/**
 * Mailable & Developer Mail Preview Unit Tests (AdonisJS & Django-inspired)
 * - Declarative Mailable classes
 * - Pluggable email transports (Memory, Console, File)
 * - Mailer service & event emissions
 * - Email plugin integration with Mailable and outbox tracking
 * - Dev Mail Preview UI & REST endpoints (/_webspresso/mail-preview)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  Mailable,
  createMailer,
  Mailer,
  MemoryTransport,
  ConsoleTransport,
  FileTransport,
  resolveTransport,
} from '../../core/mail/index.js';
import { emailPlugin } from '../../plugins/email/index.js';
import { createMailPreviewHandlers } from '../../plugins/email/preview-handler.js';
import { createDatabase } from '../../core/orm/index.js';
import { createApp } from '../../src/server.js';
import request from 'supertest';

// Sample Mailable Subclass
class WelcomeEmail extends Mailable {
  constructor(user) {
    super();
    this.user = user;
  }

  build() {
    this.to(this.user.email, this.user.name)
      .from('team@webspresso.dev', 'Webspresso Team')
      .subject(`Welcome aboard, ${this.user.name}!`)
      .html(`<h1>Welcome, ${this.user.name}!</h1><p>Your plan is ${this.user.plan}.</p>`)
      .data('user', this.user)
      .header('X-Campaign', 'welcome-onboarding');
  }
}

class InvoiceEmail extends Mailable {
  template = 'invoice';

  constructor(order) {
    super();
    this.order = order;
  }

  prepare() {
    this.to(this.order.customerEmail)
      .subject(`Invoice #${this.order.id}`)
      .view({ order: this.order });
  }
}

describe('Mailable & Email Enhancements (Item #6)', () => {
  describe('Declarative Mailable Class', () => {
    it('constructs message fluently and serializes via toMessage()', () => {
      const mail = new Mailable();
      mail.to('john@example.com', 'John')
        .from('noreply@example.com', 'Admin')
        .replyTo('support@example.com')
        .cc(['audit@example.com'])
        .bcc('archive@example.com')
        .subject('Account Notice')
        .html('<p>Hello</p>')
        .text('Hello')
        .data('key', 'value')
        .attach({ filename: 'terms.pdf', content: 'fake' })
        .header('X-Custom-ID', '12345');

      const msg = mail.toMessage();

      expect(msg.to).toEqual({ address: 'john@example.com', name: 'John' });
      expect(msg.from).toEqual({ address: 'noreply@example.com', name: 'Admin' });
      expect(msg.replyTo).toBe('support@example.com');
      expect(msg.cc).toEqual(['audit@example.com']);
      expect(msg.bcc).toEqual(['archive@example.com']);
      expect(msg.subject).toBe('Account Notice');
      expect(msg.html).toBe('<p>Hello</p>');
      expect(msg.text).toBe('Hello');
      expect(msg.data).toEqual({ key: 'value' });
      expect(msg.attachments).toHaveLength(1);
      expect(msg.headers).toEqual({ 'X-Custom-ID': '12345' });
    });

    it('executes subclass build() lifecycle and extracts class properties', () => {
      const user = { name: 'Alice', email: 'alice@example.com', plan: 'Pro' };
      const mail = new WelcomeEmail(user);
      const msg = mail.toMessage();

      expect(msg.to).toEqual({ address: 'alice@example.com', name: 'Alice' });
      expect(msg.from).toEqual({ address: 'team@webspresso.dev', name: 'Webspresso Team' });
      expect(msg.subject).toBe('Welcome aboard, Alice!');
      expect(msg.html).toContain('Your plan is Pro.');
      expect(msg.data.user).toBe(user);
      expect(msg.headers['X-Campaign']).toBe('welcome-onboarding');
    });

    it('supports template view mapping and prepare() hook', () => {
      const order = { id: 'INV-99', customerEmail: 'bob@example.com', total: 150 };
      const mail = new InvoiceEmail(order);
      const msg = mail.toMessage();

      expect(msg.template).toBe('invoice');
      expect(msg.to).toBe('bob@example.com');
      expect(msg.subject).toBe('Invoice #INV-99');
      expect(msg.data.order).toEqual(order);
    });
  });

  describe('Email Transports (Django & AdonisJS Backends)', () => {
    it('MemoryTransport records sent emails in inspectable outbox', async () => {
      const memory = new MemoryTransport();
      expect(memory.getOutbox()).toHaveLength(0);

      const res = await memory.sendMail({
        to: 'test@example.com',
        subject: 'Memory Test',
        text: 'Testing in memory',
      });

      expect(res.messageId).toBeDefined();
      expect(memory.getOutbox()).toHaveLength(1);
      expect(memory.lastMessage().subject).toBe('Memory Test');

      const found = memory.findById(res.messageId);
      expect(found).toBeDefined();
      expect(found.to).toBe('test@example.com');

      memory.clearOutbox();
      expect(memory.getOutbox()).toHaveLength(0);
      expect(memory.lastMessage()).toBeNull();
    });

    it('ConsoleTransport logs formatted email details to custom logger', async () => {
      const logs = [];
      const mockLogger = { log: (msg) => logs.push(msg) };
      const consoleTransport = new ConsoleTransport({ logger: mockLogger });

      const res = await consoleTransport.sendMail({
        from: 'system@example.com',
        to: 'user@example.com',
        subject: 'Console Alert',
        text: 'Server status OK',
      });

      expect(res.messageId).toBeDefined();
      expect(logs.some((l) => l.includes('CONSOLE TRANSPORT'))).toBe(true);
      expect(logs.some((l) => l.includes('Console Alert'))).toBe(true);
    });

    it('FileTransport writes email payload as JSON to local directory', async () => {
      const tmpDir = path.join(process.cwd(), '.cache', 'test-emails-' + Date.now());
      const fileTransport = new FileTransport({ dir: tmpDir });

      const res = await fileTransport.sendMail({
        to: 'file@example.com',
        subject: 'File Test',
        html: '<p>Saved to disk</p>',
      });

      expect(res.filePath).toBeDefined();
      expect(fs.existsSync(res.filePath)).toBe(true);

      const saved = JSON.parse(fs.readFileSync(res.filePath, 'utf-8'));
      expect(saved.to).toBe('file@example.com');
      expect(saved.subject).toBe('File Test');

      cleanupDir(tmpDir);
    });

    it('resolveTransport selects appropriate backend based on options and env', () => {
      expect(resolveTransport({ backend: 'memory' })).toBeInstanceOf(MemoryTransport);
      expect(resolveTransport({ memory: true })).toBeInstanceOf(MemoryTransport);
      expect(resolveTransport({ backend: 'console' })).toBeInstanceOf(ConsoleTransport);
      expect(resolveTransport({ console: true })).toBeInstanceOf(ConsoleTransport);
      expect(resolveTransport({ backend: 'file', dir: '/tmp/test' })).toBeInstanceOf(FileTransport);
    });
  });

  describe('Core Mailer Service (Mailer & createMailer)', () => {
    it('sends Mailable instance, emits mail:sent event, and tracks outbox', async () => {
      const events = { emit: vi.fn() };
      const mailer = createMailer({
        backend: 'memory',
        defaults: { from: 'core@webspresso.dev' },
        events,
      });

      const user = { name: 'Charlie', email: 'charlie@example.com', plan: 'Enterprise' };
      const email = new WelcomeEmail(user);

      const result = await mailer.send(email);
      expect(result.ok).toBe(true);
      expect(result.messageId).toBeDefined();

      expect(events.emit).toHaveBeenCalledWith('mail:sent', expect.objectContaining({
        message: expect.objectContaining({
          to: { address: 'charlie@example.com', name: 'Charlie' },
          subject: 'Welcome aboard, Charlie!',
        }),
      }));

      expect(mailer.getOutbox()).toHaveLength(1);
      expect(mailer.lastMessage().subject).toBe('Welcome aboard, Charlie!');
    });

    it('previews Mailable without sending and returns rendered structure', async () => {
      const mailer = createMailer({
        backend: 'memory',
        renderer: async (tpl, data) => ({
          html: `<h1>Rendered ${tpl} for ${data.order?.customerEmail}</h1>`,
          text: `Rendered ${tpl}`,
        }),
      });

      const order = { id: 'INV-10', customerEmail: 'david@example.com' };
      const invoice = new InvoiceEmail(order);

      const preview = await mailer.preview(invoice);
      expect(preview.subject).toBe('Invoice #INV-10');
      expect(preview.html).toContain('Rendered invoice for david@example.com');
      expect(preview.text).toBe('Rendered invoice');

      // Verify outbox remains empty on preview
      expect(mailer.getOutbox()).toHaveLength(0);
    });
  });

  describe('Email Plugin Integration & Dev Preview Route', () => {
    let db;

    beforeAll(() => {
      db = createDatabase({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
        cache: false,
      });
    });

    afterAll(async () => {
      if (db?.knex) await db.knex.destroy();
    });

    it('emailPlugin supports sending Mailable classes, outbox inspection and clearing', async () => {
      const email = emailPlugin({
        backend: 'memory',
        logToDb: false,
        templates: {
          welcome: '<mjml><mj-body><mj-section><mj-column><mj-text>Hi {{ user.name }}</mj-text></mj-column></mj-section></mj-body></mj-mjml>',
        },
      });

      expect(email.api.Mailable).toBe(Mailable);
      expect(email.api.getOutbox()).toHaveLength(0);

      // Send a WelcomeEmail
      const user = { name: 'Elena', email: 'elena@example.com', plan: 'Starter' };
      const welcome = new WelcomeEmail(user);

      const res = await email.api.send(welcome);
      expect(res.ok).toBe(true);

      const outbox = email.api.getOutbox();
      expect(outbox).toHaveLength(1);
      expect(outbox[0].subject).toBe('Welcome aboard, Elena!');

      // Send raw template
      await email.api.sendTemplate('welcome', {
        to: 'frank@example.com',
        subject: 'MJML Welcome',
        data: { user: { name: 'Frank' } },
      });

      expect(email.api.getOutbox()).toHaveLength(2);
      expect(email.api.lastMessage().subject).toBe('MJML Welcome');

      email.api.clearOutbox();
      expect(email.api.getOutbox()).toHaveLength(0);
    });

    it('mounts Dev Mail Preview (/_webspresso/mail-preview) endpoints in development', async () => {
      const email = emailPlugin({
        backend: 'memory',
        logToDb: false,
        devInbox: true,
        previewPath: '/_webspresso/mail-preview',
      });

      // Send 1 email into memory outbox
      await email.api.send({
        to: 'tester@example.com',
        subject: 'Hello Dev Preview',
        html: '<h2>Hello Dev!</h2>',
        text: 'Hello Dev!',
      });

      const fixturesDir = path.join(__dirname, '../fixtures');
      const { app } = createApp({
        pagesDir: path.join(fixturesDir, 'empty-pages'),
        viewsDir: path.join(fixturesDir, 'views'),
        cache: false,
        lazyRoutes: true,
        db,
        plugins: [email],
      });

      // 1. GET /_webspresso/mail-preview (HTML UI)
      const resUi = await request(app)
        .get('/_webspresso/mail-preview')
        .expect(200);

      expect(resUi.headers['content-type']).toContain('text/html');
      expect(resUi.text).toContain('Mail Preview & Dev Inbox');
      expect(resUi.text).toContain('Hello Dev Preview');

      // 2. GET /_webspresso/mail-preview/api/messages (JSON API)
      const resList = await request(app)
        .get('/_webspresso/mail-preview/api/messages')
        .expect(200);

      expect(resList.body.success).toBe(true);
      expect(resList.body.count).toBe(1);
      expect(resList.body.messages[0].subject).toBe('Hello Dev Preview');
      const messageId = resList.body.messages[0].id;

      // 3. GET /_webspresso/mail-preview/api/messages/:id (Single message JSON)
      const resMsg = await request(app)
        .get(`/_webspresso/mail-preview/api/messages/${messageId}`)
        .expect(200);

      expect(resMsg.body.message.to).toBe('tester@example.com');

      // 4. GET /_webspresso/mail-preview/api/messages/:id/html (Iframe HTML)
      const resHtml = await request(app)
        .get(`/_webspresso/mail-preview/api/messages/${messageId}/html`)
        .expect(200);

      expect(resHtml.text).toContain('<h2>Hello Dev!</h2>');

      // 5. POST /_webspresso/mail-preview/api/clear (Clear outbox)
      await request(app)
        .post('/_webspresso/mail-preview/api/clear')
        .expect(200);

      expect(email.api.getOutbox()).toHaveLength(0);
    });

    it('injects req.mailer into request handlers and app context', async () => {
      const email = emailPlugin({
        backend: 'memory',
        logToDb: false,
      });

      const fixturesDir = path.join(__dirname, '../fixtures');
      const { app } = createApp({
        pagesDir: path.join(fixturesDir, 'empty-pages'),
        viewsDir: path.join(fixturesDir, 'views'),
        cache: false,
        lazyRoutes: true,
        db,
        plugins: [email],
        setupRoutes(router) {
          router.get('/test-mailer-route', async (req, res) => {
            if (!req.mailer) {
              return res.status(500).json({ error: 'req.mailer missing' });
            }
            const sent = await req.mailer.send({
              to: 'req-test@example.com',
              subject: 'From Route',
              text: 'Working!',
            });
            res.json({ success: true, messageId: sent.messageId });
          });
        },
      });

      const res = await request(app)
        .get('/test-mailer-route')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(email.api.getOutbox()).toHaveLength(1);
      expect(email.api.lastMessage().to).toBe('req-test@example.com');
    });
  });
});

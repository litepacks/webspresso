const { TemplateRegistry } = require('../../plugins/email/template-registry');
const { createEmailService } = require('../../plugins/email/service');
const { createServiceRegistry } = require('../../src/services');
const { createMailServices } = require('../../src/services/builtins/mail');
const { createApp } = require('../../src/server');
const { emailPlugin } = require('../../plugins/email');

describe('Built-in Mail Services (mail.*)', () => {
  let registry;
  let emailService;
  let services;
  let sentMessages = [];

  const mockTransport = {
    sendMail: async (opts) => {
      sentMessages.push(opts);
      return { messageId: '<msg-123@webspresso.local>', response: '250 OK' };
    },
    verify: async () => true,
  };

  beforeEach(() => {
    sentMessages = [];
    registry = new TemplateRegistry();
    registry.register('welcome', '<mjml><mj-body><mj-section><mj-column><mj-text>Welcome {{ name }}</mj-text></mj-column></mj-section></mj-body></mj-style></mjml>');

    emailService = createEmailService({
      registry,
      transportOptions: { transport: mockTransport },
      defaults: { from: 'noreply@webspresso.local' },
    });

    services = createServiceRegistry();
    const mailMap = createMailServices({ emailService, registry });
    for (const [name, def] of Object.entries(mailMap)) {
      services.register(name, def);
    }
  });

  describe('mail.send', () => {
    it('should send plain HTML email using mock transport', async () => {
      const result = await services.call('mail.send', {
        to: 'user@example.com',
        subject: 'Hello World',
        html: '<p>This is a test</p>',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('<msg-123@webspresso.local>');
      expect(result.to).toBe('user@example.com');
      expect(result.subject).toBe('Hello World');

      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].to).toBe('user@example.com');
      expect(sentMessages[0].subject).toBe('Hello World');
      expect(sentMessages[0].html).toBe('<p>This is a test</p>');
    });

    it('should validate email format and reject invalid recipient', async () => {
      await expect(
        services.call('mail.send', {
          to: 'not-an-email',
          subject: 'Test',
          text: 'Hello',
        })
      ).rejects.toThrow();
    });
  });

  describe('mail.send-templated', () => {
    it('should render MJML template with data and send email', async () => {
      const result = await services.call('mail.send-templated', {
        template: 'welcome',
        to: 'newuser@example.com',
        subject: 'Welcome to Webspresso',
        data: { name: 'Alice' },
      });

      expect(result.success).toBe(true);
      expect(result.template).toBe('welcome');

      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].to).toBe('newuser@example.com');
      expect(sentMessages[0].html).toContain('Welcome Alice');
    });
  });

  describe('mail.preview', () => {
    it('should preview registered MJML template without sending email', async () => {
      const preview = await services.call('mail.preview', {
        template: 'welcome',
        data: { name: 'Bob' },
      });

      expect(preview.html).toBeDefined();
      expect(preview.html).toContain('Welcome Bob');
      expect(sentMessages).toHaveLength(0); // Did not send
    });

    it('should throw validation error if neither template nor mjml is provided', async () => {
      await expect(
        services.call('mail.preview', {
          data: { foo: 'bar' },
        })
      ).rejects.toThrow();
    });
  });

  describe('emailPlugin automatic registration', () => {
    it('should auto-register mail.* services into serviceRegistry when emailPlugin is used in createApp', async () => {
      const path = require('path');
      const { app } = createApp({
        pagesDir: path.join(__dirname, '../fixtures/pages'),
        plugins: [
          emailPlugin({
            transport: mockTransport,
            templates: {
              test: '<mjml><mj-body><mj-text>Test</mj-text></mj-body></mjml>',
            },
          }),
        ],
      });

      expect(app.serviceRegistry.has('mail.send')).toBe(true);
      expect(app.serviceRegistry.has('mail.send-templated')).toBe(true);
      expect(app.serviceRegistry.has('mail.preview')).toBe(true);
      expect(app.serviceRegistry.has('mail.query-logs')).toBe(true);

      const res = await app.serviceRegistry.call('mail.send', {
        to: 'auto@example.com',
        subject: 'Auto Registered',
        text: 'Working!',
      });

      expect(res.success).toBe(true);
      expect(res.to).toBe('auto@example.com');
    });
  });

  describe('mail.* edge cases & branch coverage', () => {
    it('should throw when emailService is missing in createMailServices', () => {
      expect(() => createMailServices({})).toThrow('emailService instance is required');
    });

    it('should handle mail.send and mail.send-templated failure', async () => {
      const failingEmailService = {
        send: async () => {
          throw new Error('SMTP connection timed out');
        },
      };
      const failingRegistry = createServiceRegistry();
      const map = createMailServices({ emailService: failingEmailService });
      for (const [n, d] of Object.entries(map)) failingRegistry.register(n, d);

      await expect(
        failingRegistry.call('mail.send', { to: 'a@b.com', subject: 'fail', text: 'hi' })
      ).rejects.toThrow('Failed to send email: SMTP connection timed out');

      await expect(
        failingRegistry.call('mail.send-templated', { to: 'a@b.com', subject: 'fail', template: 'welcome' })
      ).rejects.toThrow('Failed to send templated email: SMTP connection timed out');
    });

    it('should preview raw MJML strings without registered template', async () => {
      const preview = await services.call('mail.preview', {
        mjml: '<mjml><mj-body><mj-section><mj-column><mj-text>Hello {{ place }}</mj-text></mj-column></mj-section></mj-body></mjml>',
        data: { place: 'World' },
      });
      expect(preview.html).toContain('Hello World');
    });

    it('should handle mail.query-logs with and without queryLogs method', async () => {
      // 1. Without queryLogs
      const res = await services.call('mail.query-logs', {}, { auth: { user: { role: 'admin' } } });
      expect(res).toEqual({ logs: [], total: 0 });

      // 2. With queryLogs
      const customEmailService = {
        send: async () => ({ messageId: '1' }),
        queryLogs: async (query) => [{ id: 1, to: 'user@example.com', status: 'sent' }],
      };
      const customRegistry = createServiceRegistry();
      const map = createMailServices({ emailService: customEmailService });
      for (const [n, d] of Object.entries(map)) customRegistry.register(n, d);

      const logsRes = await customRegistry.call('mail.query-logs', { to: 'user@example.com' }, { auth: { user: { role: 'admin' } } });
      expect(logsRes.total).toBe(1);
      expect(logsRes.logs[0].id).toBe(1);
    });
  });
});

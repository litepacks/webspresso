/**
 * Built-in Mail & Notification Services
 * @module src/services/builtins/mail
 */

const { z } = require('zod');
const { ValidationError, NotFoundError } = require('../../../core/errors');

/**
 * Create built-in mail services map
 * @param {Object} options
 * @param {Object} options.emailService - Instance created by createEmailService
 * @param {Object} [options.registry] - TemplateRegistry instance
 * @param {Object} [options.db] - Database or knex instance
 * @param {string} [options.tableName='email_logs']
 * @returns {Record<string, Object>}
 */
function createMailServices(options = {}) {
  const { emailService, registry, db, tableName = 'email_logs' } = options;

  if (!emailService) {
    throw new Error('emailService instance is required for createMailServices');
  }

  const emailSchema = z.string().email();
  const recipientSchema = z.union([emailSchema, z.array(emailSchema)]);

  return {
    'mail.send': {
      schema: z.object({
        to: recipientSchema,
        subject: z.string().min(1, 'Subject is required'),
        from: z.string().optional(),
        replyTo: z.string().optional(),
        cc: z.union([z.string(), z.array(z.string())]).optional(),
        bcc: z.union([z.string(), z.array(z.string())]).optional(),
        template: z.string().optional(),
        mjml: z.string().optional(),
        html: z.string().optional(),
        text: z.string().optional(),
        data: z.record(z.any()).optional().default({}),
        attachments: z.array(z.any()).optional(),
      }),
      async handler(input, ctx) {
        try {
          const result = await emailService.send(input);
          return {
            success: true,
            messageId: result.messageId,
            to: input.to,
            subject: input.subject,
          };
        } catch (err) {
          throw new Error(`Failed to send email: ${err.message}`);
        }
      },
    },

    'mail.send-templated': {
      schema: z.object({
        template: z.string().min(1, 'Template ID is required'),
        to: recipientSchema,
        subject: z.string().min(1, 'Subject is required'),
        data: z.record(z.any()).optional().default({}),
        from: z.string().optional(),
        replyTo: z.string().optional(),
        attachments: z.array(z.any()).optional(),
      }),
      async handler(input, ctx) {
        const { template, ...rest } = input;
        try {
          const result = await emailService.send({
            template,
            ...rest,
          });
          return {
            success: true,
            messageId: result.messageId,
            template,
            to: input.to,
          };
        } catch (err) {
          throw new Error(`Failed to send templated email: ${err.message}`);
        }
      },
    },

    'mail.preview': {
      schema: z.object({
        template: z.string().optional(),
        mjml: z.string().optional(),
        data: z.record(z.any()).optional().default({}),
      }),
      async handler(input, ctx) {
        const { template, mjml, data } = input;
        if (!template && !mjml) {
          throw new ValidationError('Either template or mjml must be provided for preview', [
            { field: 'template', message: 'Either template or mjml must be provided' },
          ]);
        }

        const previewOpts = template ? template : { mjml };
        const rendered = await emailService.preview(previewOpts, data);
        return {
          html: rendered.html,
          text: rendered.text,
          errors: rendered.errors || [],
        };
      },
    },

    'mail.query-logs': {
      schema: z.object({
        limit: z.number().int().positive().default(50),
        offset: z.number().int().nonnegative().default(0),
        status: z.enum(['sent', 'error']).optional(),
        to: z.string().optional(),
        template: z.string().optional(),
      }),
      auth: 'admin',
      async handler(input, ctx) {
        if (!emailService.queryLogs) {
          return { logs: [], total: 0 };
        }
        const logs = await emailService.queryLogs(input);
        return { logs, total: logs.length };
      },
    },
  };
}

module.exports = {
  createMailServices,
};

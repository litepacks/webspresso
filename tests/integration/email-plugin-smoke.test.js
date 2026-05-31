/**
 * Email plugin integration smoke — transport + template send
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import nodemailer from 'nodemailer';
import { TemplateRegistry } from '../../plugins/email/template-registry.js';
import { createEmailService } from '../../plugins/email/service.js';

describe('email plugin integration smoke', () => {
  it('sends mail via json transport with MJML template', async () => {
    const registry = new TemplateRegistry();
    registry.register('smoke', {
      mjml: '<mjml><mj-body><mj-text>Hello {{name}}</mj-text></mj-body></mjml>',
      subject: 'Smoke {{name}}',
    });

    const transport = nodemailer.createTransport({ jsonTransport: true });
    const service = createEmailService({
      registry,
      transportOptions: { transport },
      defaults: { from: 'test@example.com' },
    });

    const result = await service.send({
      to: 'user@example.com',
      subject: 'Smoke test',
      template: 'smoke',
      data: { name: 'Webspresso' },
    });

    expect(result.ok).toBe(true);
    expect(result.messageId).toBeTruthy();
  });
});

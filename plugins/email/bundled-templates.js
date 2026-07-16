/**
 * Built-in auth email templates (inline MJML — no filesystem reads)
 * Source copies for editing: plugins/email/templates/*.mjml (sync to this file manually)
 * @module plugins/email/bundled-templates
 */

/** @type {Record<string, { mjml: string }>} */
const BUNDLED_AUTH_TEMPLATES = {
  'auth-password-reset': {
    mjml: `<mjml>
  <mj-body background-color="#f4f4f5">
    <mj-section background-color="#ffffff" padding="32px 24px">
      <mj-column>
        <mj-text font-size="20px" font-weight="600" color="#18181b">Reset your password</mj-text>
        <mj-text color="#52525b">Hi {{name}},</mj-text>
        <mj-text color="#52525b">We received a request to reset your password. Click the button below to choose a new one.</mj-text>
        <mj-button background-color="#2563eb" href="{{resetUrl}}">Reset password</mj-button>
        <mj-text color="#71717a" font-size="12px">If you did not request this, you can safely ignore this email.</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`,
  },
  'auth-email-verify': {
    mjml: `<mjml>
  <mj-body background-color="#f4f4f5">
    <mj-section background-color="#ffffff" padding="32px 24px">
      <mj-column>
        <mj-text font-size="20px" font-weight="600" color="#18181b">Verify your email</mj-text>
        <mj-text color="#52525b">Hi {{name}},</mj-text>
        <mj-text color="#52525b">Please confirm your email address by clicking the button below.</mj-text>
        <mj-button background-color="#2563eb" href="{{verifyUrl}}">Verify email</mj-button>
        <mj-text color="#71717a" font-size="12px">If you did not create an account, you can ignore this message.</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`,
  },
  'auth-welcome': {
    mjml: `<mjml>
  <mj-body background-color="#f4f4f5">
    <mj-section background-color="#ffffff" padding="32px 24px">
      <mj-column>
        <mj-text font-size="20px" font-weight="600" color="#18181b">Welcome</mj-text>
        <mj-text color="#52525b">Hi {{name}},</mj-text>
        <mj-text color="#52525b">Thanks for joining us. Your account is ready.</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`,
  },
};

/**
 * @param {import('./template-registry').TemplateRegistry} registry
 */
function registerBundledAuthTemplates(registry) {
  for (const [id, source] of Object.entries(BUNDLED_AUTH_TEMPLATES)) {
    if (!registry.has(id)) {
      registry.register(id, source, 'inline');
    }
  }
}

module.exports = {
  BUNDLED_AUTH_TEMPLATES,
  registerBundledAuthTemplates,
};

# Webspresso Email Plugin Guide (`plugins/email`)

The `emailPlugin` provides responsive email template compilation (using MJML), Nodemailer transport management, database delivery audit logs, auth email integration (password reset / email verification), and an interactive Admin Panel management UI.

---

## 1. Overview & Setup

```js
import { createApp } from 'webspresso';
import { emailPlugin } from 'webspresso/plugins/email';

const email = emailPlugin({
  db,
  smtp: {
    host: 'smtp.mailtrap.io',
    port: 2525,
    auth: { user: 'username', pass: 'password' },
  },
  defaults: {
    from: 'Webspresso App <noreply@example.com>',
  },
  templatesDir: './emails',
  logToDb: true,
  includeAdminPage: true,
});

const { app } = createApp({
  db,
  plugins: [email],
});
```

---

## 2. Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `db` | `Object` | `null` | Knex database instance (for logging emails to DB) |
| `transport` | `Object` | `null` | Pre-configured Nodemailer transport instance |
| `smtp` | `Object` | `null` | SMTP configuration object `{ host, port, auth }` |
| `defaults` | `Object` | `{}` | Default email headers (`from`, `replyTo`) |
| `templatesDir` | `string` | `null` | Path to directory containing `.mjml` templates |
| `templates` | `Object` | `{}` | In-memory map of MJML template strings |
| `logToDb` | `boolean` | `true` | Log sent emails to database |
| `tableName` | `string` | `'email_logs'` | Table name used for email logs |
| `includeAdminPage` | `boolean` | `true` | Mount Email management UI inside Admin Panel (`/_admin/email`) |
| `authEmails` | `Object` | `null` | Auth email bridge configuration |

---

## 3. Template Management & MJML Compilation

Place `.mjml` templates inside `templatesDir` (e.g. `emails/welcome.mjml`):

```xml
<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text font-size="20px">Welcome, {{ name }}!</mj-text>
        <mj-button href="{{ activationUrl }}">Activate Account</mj-button>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
```

Templates are dynamically compiled to responsive HTML with Nunjucks variable interpolation.

---

## 4. Plugin API (`emailPlugin().api`)

The plugin exports helper methods under `.api`:

```js
const { api: emailApi } = email;

// 1. Send compiled MJML template
await emailApi.sendTemplate('welcome', {
  to: 'user@example.com',
  subject: 'Welcome to Webspresso!',
  data: { name: 'Ahmet', activationUrl: 'https://example.com/activate' },
});

// 2. Direct raw email sending
await emailApi.send({
  to: 'user@example.com',
  subject: 'Hello',
  html: '<p>Direct HTML</p>',
});

// 3. Render HTML preview without sending
const { html, subject } = await emailApi.preview('welcome', { name: 'Ahmet' });

// 4. Register in-memory MJML template string dynamically
emailApi.registerTemplate('notification', '<mjml><mj-body>...</mj-body></mjml>');

// 5. Connection test & log management
const isReady = await emailApi.verifyConnection();
const logs = await emailApi.queryLogs({ status: 'sent', limit: 20 });
await emailApi.purgeLogs({ olderThan: '30d' });
```

---

## 5. Auth Email Bridge (`authEmails`)

Automatically wires password reset and email verification flows with `AuthManager`:

```js
const email = emailPlugin({
  db,
  auth,
  authEmails: {
    enabled: true,
    resetPassword: {
      template: 'reset-password',
      subject: 'Reset your password',
      tokenExpiresIn: '1h',
    },
    emailVerification: {
      template: 'verify-email',
      subject: 'Verify your email address',
    },
  },
});
```

---

## 6. Admin Panel UI & Database Logs

When `includeAdminPage: true` and `adminPanelPlugin` are present, an interactive Email Management module is mounted at `/_admin/email`:

- **Live Template Preview**: Select any MJML template, edit mock JSON data, and preview rendered responsive HTML.
- **Test Sender**: Send test emails directly from the Admin Panel to verify SMTP configuration.
- **Audit Logs Inspector**: Filter sent email logs by status (`sent`, `failed`), view error tracebacks, and purge historic logs.
- **Database Schema**: Log entries are stored in `email_logs` table (`id`, `to_email`, `subject`, `template_name`, `status`, `error`, `created_at`).

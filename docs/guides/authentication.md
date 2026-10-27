---
title: Authentication
description: Session cookies for SSR and JWT refresh tokens for API routes with quickAuth and createAuth.
---

# Dual Authentication Guide

> **Goal:** Secure your Webspresso application with stateful Session Cookies for SSR pages and stateless HS256 JWT tokens with refresh rotation for REST APIs.

---

## 1. Dual Auth Overview

Webspresso provides a built-in dual authentication system (`core/auth/`):

- **Stateful Session Auth**: Designed for browser users navigating server-rendered `.njk` pages with secure `HttpOnly` cookies.
- **Stateless JWT Auth**: Designed for mobile apps, external clients, and SPA frontend frameworks calling `pages/api/*` endpoints.

---

## 2. Setting Up Session Authentication

Configure `createAuth` in `server.js`:

```javascript
const { createApp } = require('webspresso');
const { createAuth } = require('webspresso/core/auth');

const auth = createAuth({
  secret: process.env.SESSION_SECRET || 'super-secret-key-at-least-32-chars',
  session: {
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  },
});

const { app } = createApp({
  auth,
  pagesDir: path.join(__dirname, 'pages'),
  viewsDir: path.join(__dirname, 'views'),
});
```

### Logging In & Out in Route Handlers

```javascript
// pages/api/auth/login.post.js
module.exports = {
  async handler(req, res) {
    const { email, password } = req.body;
    
    // Verify credentials with your service
    const user = await req.service('user.verify-password', { email, password });
    
    // Establish session
    req.session.user = { id: user.id, email: user.email, role: user.role };
    
    res.json({ success: true, user: req.session.user });
  },
};
```

---

## 3. Setting Up Stateless JWT Authentication

Generate and verify HMAC-SHA256 tokens using the native crypto JWT core:

```javascript
const { signJwt, verifyJwt } = require('webspresso/core/auth/jwt');

// Sign token (15-minute access token)
const token = signJwt(
  { userId: user.id, role: user.role },
  process.env.JWT_SECRET,
  { expiresIn: '15m' }
);
```

### Protecting API Routes with JWT Middleware

Use the built-in `jwt` middleware in your API route definition:

```javascript
// pages/api/account/profile.get.js
module.exports = {
  middleware: ['jwt'], // Requires valid Authorization: Bearer <token>

  async handler(req, res) {
    // req.auth contains the decoded JWT payload
    res.json({
      userId: req.auth.userId,
      role: req.auth.role,
    });
  },
};
```

---

## 4. Policy Guards & RBAC

Protect sensitive endpoints with declarative role requirements:

```javascript
// In page loaders or API routes
const { requireRole } = require('webspresso/core/auth');

module.exports = {
  middleware: [requireRole(['admin', 'editor'])],

  async load({ req }) {
    return { adminData: 'confidential' };
  },
};
```

---

## 5. Active Devices & Remote Session Revocation

Webspresso provides built-in device tracking and remote session revocation (`webspresso/core/auth`):

```javascript
const { quickAuth, createUserSessionsTable } = require('webspresso/core/auth');

// Migration: create user_sessions table
await createUserSessionsTable(db.knex);

// Enable session tracking
const auth = quickAuth({
  db,
  sessionTracking: true,
});
```

### Listing Active Sessions & Devices
```javascript
// pages/api/auth/sessions.get.js
const { defineApi } = require('webspresso');

module.exports = defineApi({
  middleware: ['auth'],
  async handler(req, res) {
    const sessions = await req.auth.sessions();
    // Returns: [{ session_id, ip_address, browser: 'Chrome 128', os: 'macOS 14', device: 'desktop', last_active_at, is_current: true }]
    return res.json({ ok: true, sessions });
  },
});
```

### Revoking a Remote Session
```javascript
// pages/api/auth/sessions/revoke.post.js
const { defineApi } = require('webspresso');

module.exports = defineApi({
  middleware: ['auth'],
  schema: ({ z }) => ({
    body: z.object({
      sessionId: z.string().optional(),
      allOthers: z.boolean().optional(),
    }),
  }),
  async handler(req, res) {
    const { sessionId, allOthers } = req.input.body;

    if (allOthers) {
      const count = await req.auth.revokeOtherSessions();
      return res.json({ ok: true, revokedCount: count });
    }

    await req.auth.revokeSession(sessionId);
    return res.json({ ok: true });
  },
});
```

---

## 6. Two-Factor Authentication (2FA / TOTP) & QR Code

Webspresso includes a zero-dependency RFC 6238 TOTP engine with built-in Base32 encoding and native SVG QR Code generation for Google Authenticator, 1Password, and Apple Passwords:

```javascript
const { totp } = require('webspresso/core/auth');
```

### 6.1 Initiating 2FA Setup
```javascript
// pages/api/auth/2fa/setup.post.js
const { defineApi } = require('webspresso');
const { totp } = require('webspresso/core/auth');

module.exports = defineApi({
  middleware: ['auth'],
  async handler(req, res) {
    const user = req.user;

    // Generate secret, otpauth:// URI, SVG QR Code, and recovery codes in one call
    const setup = totp.createTotpSetup({
      accountName: user.email,
      issuer: 'MyWebspressoApp',
      recoveryCodeCount: 8,
    });

    // Store unconfirmed secret temporarily in user profile or session
    await req.db.getRepository('User').update(user.id, {
      temp_totp_secret: setup.secret,
    });

    return res.json({
      secret: setup.secret,
      qrSvg: setup.qrSvg,         // Inline SVG for template rendering
      qrDataUri: setup.qrDataUri, // data:image/svg+xml;base64,... URI
      recoveryCodes: setup.recoveryCodes,
    });
  },
});
```

### 6.2 Verifying and Confirming 2FA
```javascript
// pages/api/auth/2fa/confirm.post.js
const { defineApi } = require('webspresso');
const { totp } = require('webspresso/core/auth');

module.exports = defineApi({
  middleware: ['auth'],
  schema: ({ z }) => ({
    body: z.object({
      token: z.string().length(6),
    }),
  }),
  async handler(req, res) {
    const { token } = req.input.body;
    const user = await req.db.getRepository('User').findById(req.user.id);

    const isValid = totp.verifyTotp(token, user.temp_totp_secret, { window: 1 });
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid 6-digit code. Please try again.' });
    }

    // Activate 2FA
    await req.db.getRepository('User').update(user.id, {
      totp_secret: user.temp_totp_secret,
      temp_totp_secret: null,
      two_factor_enabled: true,
    });

    return res.json({ success: true, message: '2FA successfully activated!' });
  },
});
```

---

## 7. Passwordless Magic Links

Webspresso supports secure, single-use, HMAC-SHA256 signed magic login links (`core/auth/magic-link`):

### 7.1 Requesting a Magic Link
```javascript
// pages/api/auth/magic-link.post.js
const { defineApi } = require('webspresso');

module.exports = defineApi({
  schema: ({ z }) => ({
    body: z.object({ email: z.string().email() }),
  }),
  async handler(req, res) {
    const { email } = req.input.body;
    const user = await req.db.getRepository('User').findOne({ email });

    if (user) {
      // Creates a cryptographically signed one-time link (expires in 15 minutes)
      const { magicLinkUrl, token } = await req.auth.requestMagicLink(email, {
        expiresMinutes: 15,
      });

      // Dispatch welcome email using built-in mailer
      await req.service('mail.send', {
        to: email,
        subject: 'Sign in to your account',
        html: `<p>Click here to sign in: <a href="${magicLinkUrl}">${magicLinkUrl}</a></p>`,
      });
    }

    // Always return success to prevent user enumeration
    return res.json({ message: 'If an account exists, a sign-in link has been sent.' });
  },
});
```

### 7.2 Verifying the Magic Link
```javascript
// pages/api/auth/magic-link/verify.get.js
const { defineApi } = require('webspresso');

module.exports = defineApi({
  schema: ({ z }) => ({
    query: z.object({ token: z.string() }),
  }),
  async handler(req, res) {
    const { token } = req.input.query;

    const user = await req.auth.verifyMagicLink(token);
    if (!user) {
      return res.redirect('/login?error=invalid_or_expired_link');
    }

    // Establish browser session and redirect to dashboard
    req.session.user = { id: user.id, email: user.email, role: user.role };
    return res.redirect('/dashboard');
  },
});
```

---

## 8. Authorization Policies & Gates (`can` / `cannot`)

Inspired by Laravel Gates and Django Permissions, Webspresso provides declarative authorization logic:

```javascript
const { definePolicy, defineGate, can, cannot, authorize } = require('webspresso/core/auth');

// Define a simple gate
defineGate('admin-access', (user) => {
  return user && user.role === 'admin';
});

// Define a resource policy
definePolicy('Post', {
  view: (user, post) => post.is_published || (user && user.id === post.author_id),
  update: (user, post) => user && (user.id === post.author_id || user.role === 'admin'),
  delete: (user, post) => user && (user.id === post.author_id || user.role === 'superadmin'),
});
```

### Checking Permissions in Handlers & Views
```javascript
// Inside API route handler
const post = await req.db.getRepository('Post').findById(id);

if (!req.can('update', post)) {
  throw new ForbiddenError('You do not have permission to edit this post.');
}
```

```nunjucks
{# Inside Nunjucks template #}
{% if fsy.can('update', post) %}
  <a href="/posts/{{ post.id }}/edit" class="btn btn-sm btn-primary">Edit Post</a>
{% endif %}

{% if fsy.can('admin-access') %}
  <a href="/_admin" class="btn btn-secondary">Admin Console</a>
{% endif %}
```


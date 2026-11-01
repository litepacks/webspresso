# Webspresso Dual Authentication Architecture

[← Back to AGENTS.md](.agents/AGENTS.md)

---

## 1. Overview

Webspresso provides a built-in **Dual Authentication** system (`webspresso/core/auth` — resolved via package exports, no `/index.js` suffix required):
- **Stateful Session + Cookie**: Used for browser SSR routes and Admin Panel (`/`, `/_admin`).
- **Stateless HS256 JWT + Refresh Tokens**: Used for REST APIs, Mobile Apps, and SPAs (`/api/*`).

---

## ⚠️ STRICT RULE: Use Native Dual Auth (NO External JWT/Passport Packages)

- **NEVER** install `jsonwebtoken`, `bcryptjs`, `passport`, or `express-session`.
- **ALWAYS** use Webspresso's native `req.auth` and `webspresso/core/auth`:
  - Session login: `await req.auth.attempt(email, password, { remember: true })`
  - Stateless JWT generation: `req.auth.generateUserToken(user)`
  - Refresh Tokens: `req.auth.generateRefreshToken(user)` / `req.auth.refreshAccessToken(token)`
  - Route Guards: `middleware: ['auth']` (web session) or `middleware: ['jwt']` (API Bearer token)

---

## 2. Token Generation & Rotation

- **Access Token**: Short-lived HS256 JWT token generated via `req.auth.generateUserToken(user, options)`. Default duration is `15m` (configurable).
- **Refresh Token**: Long-lived HS256 JWT token generated via `req.auth.generateRefreshToken(user, options)` with cryptographically unique `jti` nonces. Default duration is `30d` (configurable).
- **Token Rotation**: `req.auth.refreshAccessToken(refreshToken, { rotate: true })` verifies the refresh token and generates a new Access Token alongside a rotated Refresh Token pair.

---

## 3. Request-Bound Auth Helper (`req.auth`)

Attached to Express request during auth middleware execution:

| Method | Description |
|--------|-------------|
| `req.auth.attempt(identifier, password, { remember })` | Authenticate user with credentials and login |
| `req.auth.login(user, { remember })` | Log in user and establish session |
| `req.auth.logout({ everywhere })` | Log out user and destroy session |
| `req.auth.generateUserToken(user, options)` | Generate short-lived JWT Access Token |
| `req.auth.generateRefreshToken(user, options)` | Generate long-lived JWT Refresh Token |
| `req.auth.refreshAccessToken(refreshToken, options)` | Refresh access token & rotate refresh token |
| `req.auth.check()` / `req.auth.guest()` | Check if user is authenticated or guest |
| `req.auth.user()` / `req.auth.id()` | Get current user object or ID |
| `req.auth.sessions()` | List active sessions & device info for current user |
| `req.auth.revokeSession(sessionId)` | Revoke a specific session (remotely log out device) |
| `req.auth.revokeOtherSessions()` | Revoke all sessions except the current active session |
| `req.auth.revokeAllSessions(userId?)` | Revoke all active sessions (force logout from all devices) |

---

## 4. File-Based API Route Examples (`pages/api/*`)

### 4.1 Login & Token Generation (`pages/api/auth/login.post.js`)
```javascript
module.exports = {
  schema: ({ z }) => ({
    body: z.object({
      email: z.string().email(),
      password: z.string().min(1),
    }),
  }),
  async handler(req, res) {
    const { email, password } = req.input.body;
    const user = await req.auth.attempt(email, password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const accessToken = req.auth.generateUserToken(user);
    const refreshToken = req.auth.generateRefreshToken(user);

    return res.json({ accessToken, refreshToken, user: { id: user.id, email: user.email } });
  },
};
```

### 4.2 Token Refresh Endpoint (`pages/api/auth/refresh.post.js`)
```javascript
module.exports = {
  schema: ({ z }) => ({
    body: z.object({
      refreshToken: z.string(),
    }),
  }),
  async handler(req, res) {
    const { refreshToken } = req.input.body;
    try {
      const result = await req.auth.refreshAccessToken(refreshToken, { rotate: true });
      return res.json({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    } catch (err) {
      return res.status(401).json({ error: err.message });
    }
  },
};
```

### 4.3 Protected API Route (`pages/api/profile.get.js`)
```javascript
module.exports = {
  middleware: ['jwt'],
  async handler(req, res) {
    return res.json({ user: req.user, token: req.token });
  },
};
```

---

## 5. Built-in OAuth 2.0 & Social Login (`plugins/oauth`, `core/auth/oauth`)

Webspresso includes a built-in OAuth 2.0 client and plugin with RFC 7636 PKCE, HMAC-SHA256 signed anti-CSRF state tokens, profile normalization, and seamless Dual Auth integration:

### 5.1 Plugin Configuration
```javascript
const { createApp, oauthPlugin } = require('webspresso');

const app = createApp({
  plugins: [
    oauthPlugin({
      secret: process.env.SESSION_SECRET,
      providers: {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          // redirectUri is optional; auto-inferred from request host if omitted
        },
        github: {
          clientId: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET,
        },
      },
      // Optional hook to find or create the user in your database
      async findOrCreateUser({ provider, profile, tokens, db }) {
        let user = await db.getRepository('User').findOne({ email: profile.email });
        if (!user) {
          user = await db.getRepository('User').create({
            email: profile.email,
            name: profile.name,
            avatar_url: profile.avatarUrl,
          });
        }
        return user;
      },
      defaultReturnTo: '/dashboard',
    }),
  ],
});
```

### 5.2 Automatic Routes
- `GET /auth/:provider` (e.g. `/auth/google?returnTo=/dashboard`): Generates PKCE code challenge and HMAC-signed state token with embedded return URL, redirecting the browser to the provider's authorization page.
- `GET /auth/:provider/callback`: Validates anti-CSRF state, exchanges authorization code for tokens, fetches normalized profile, calls `findOrCreateUser`, automatically establishes session via `req.auth.login(user)`, and redirects to `returnTo` (only same-site paths like `/dashboard`, or origins listed in `allowedRedirectOrigins`; anything else falls back to `defaultReturnTo`). For API/mobile clients (`format=json` or `Accept: application/json`), returns `{ success: true, user, token }`.

### 5.3 Template Helper (`fsy.oauthUrl`)
In Nunjucks templates:
```html
<a href="{{ fsy.oauthUrl('google') }}" class="btn">Sign in with Google</a>
<a href="{{ fsy.oauthUrl('github', { returnTo: '/settings' }) }}" class="btn">Connect GitHub</a>
```

---

## 6. Built-in Two-Factor Authentication (2FA / TOTP)

Webspresso provides an enterprise-grade 2FA/TOTP suite adhering strictly to **RFC 6238 (TOTP)**, **RFC 4226 (HOTP)**, and **RFC 4648 (Base32)**. It requires NO external npm libraries and features offline SVG QR code generation to prevent leaking secret keys to third-party APIs.

### 6.1 Key Capabilities
- **RFC 6238 Time-Based OTP**: Standard 30s step, 6/8 digits, HMAC-SHA1/SHA256/SHA512.
- **Time Drift Tolerance**: Built-in clock drift window (`window: 1` verifies $t \pm 30s$) and detailed delta analysis.
- **Offline QR Code Generator**: Generates crisp vector SVG strings and data URIs directly in pure Node.js.
- **Single-Use Recovery Codes**: Cryptographically secure alphanumeric codes, SHA-256 hashed storage, and timing-safe single-use burning.
- **Session & Guard Integration**: `req.auth.verify2Fa()`, `req.auth.is2FaVerified()`, and `middleware: ['2fa']`.

### 6.2 Initializing 2FA Setup for a User
```javascript
const { totp } = require('webspresso');

// In an API route: POST /api/user/2fa/setup
module.exports = {
  middleware: ['auth'],
  async handler(req, res) {
    const setup = totp.createTotpSetup({
      user: req.user,
      issuer: 'My SaaS App',
      recoveryCodeCount: 8,
    });

    // 1. Temporarily save secret and hashed recovery codes to DB for confirmation
    await req.db.getRepository('User').update(req.user.id, {
      temp_totp_secret: setup.secret,
      temp_recovery_codes: JSON.stringify(setup.recoveryCodesHashed),
    });

    // 2. Return QR SVG and plaintext recovery codes for user to record
    return res.json({
      secret: setup.secret,
      qrSvg: setup.qrSvg,
      qrDataUri: setup.qrDataUri,
      recoveryCodes: setup.recoveryCodes,
    });
  },
};
```

### 6.3 Confirming 2FA Activation
```javascript
// In an API route: POST /api/user/2fa/confirm
module.exports = {
  middleware: ['auth'],
  schema: ({ z }) => ({
    body: z.object({ token: z.string().min(6).max(8) }),
  }),
  async handler(req, res) {
    const user = req.user;
    const { token } = req.input.body;

    const isValid = totp.verifyTotp(token, user.temp_totp_secret);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    // Activate 2FA on user record
    await req.db.getRepository('User').update(user.id, {
      two_factor_enabled: true,
      totp_secret: user.temp_totp_secret,
      recovery_codes: user.temp_recovery_codes,
      temp_totp_secret: null,
      temp_recovery_codes: null,
    });

    req.auth.set2FaVerified(true);
    return res.json({ success: true, message: '2FA enabled successfully' });
  },
};
```

### 6.4 2FA Login Flow & Guard Middleware
```javascript
// Step 1: Initial password login
const user = await req.auth.findUserByCredentials(email, password);
if (user.two_factor_enabled) {
  // Mark session as 2FA pending without full login
  req.auth.set2FaPending(user);
  return res.json({ require2Fa: true });
}
await req.auth.login(user);

// Step 2: 2FA Verification Endpoint (accepts 6-digit TOTP token OR recovery code)
const verification = req.auth.verify2Fa(tokenOrRecoveryCode, user);
if (verification.success) {
  if (verification.type === 'recovery_code') {
    // Burn used recovery code
    await req.db.getRepository('User').update(user.id, {
      recovery_codes: JSON.stringify(verification.remainingHashedCodes),
    });
  }
  await req.auth.login(user);
  req.auth.set2FaVerified(true);
  return res.json({ success: true });
}
```

### 6.5 Route Protection with `middleware: ['2fa']`
```javascript
// In pages/api/account/billing.get.js or pages/security/index.njk
module.exports = {
  middleware: ['auth', '2fa'], // Rejects unverified users with 403 or redirects to /2fa
  async handler(req, res) {
    return res.json({ secureData: true });
  },
};
```

---

## 7. Magic Link & Passwordless Authentication

Webspresso includes built-in, cryptographically secure **Magic Link / Passwordless Authentication**:
- **Single-Use Timed Tokens**: 32-byte cryptographically secure random tokens stored hashed (`SHA-256`) in the `auth_tokens` table (`type = 'magic_link'`) with a default 15-minute TTL.
- **Anti-Enumeration Protection**: `requestMagicLink` returns `{ sent: true, userFound: false }` for unknown emails by default so attackers cannot probe user existence.
- **Auto-Verification**: Successfully signing in via a magic link automatically marks `email_verified_at` if the user is not yet verified.
- **Dual Session & JWT Support**: Seamlessly establishes web sessions (`req.auth.login`) and/or issues JWT access/refresh token pairs.
- **Native Email Plugin Integration**: Built-in `auth-magic-link` MJML template, automated delivery via `plugins/email`'s `wireAuthEmails`, and pre-wired `/api/auth/magic-link` routes.

### 7.1 Setup in `quickAuth`
```javascript
const { quickAuth } = require('webspresso/core/auth');

const auth = quickAuth({
  db,
  userModel: 'User',
  identifierField: 'email',
  magicLink: true, // Automatically provisions Knex auth_tokens adapter
});
```

### 7.2 Requesting a Magic Link (`pages/api/auth/magic-link.post.js`)
```javascript
const { defineApi } = require('webspresso');

module.exports = defineApi({
  schema: ({ z }) => ({
    body: z.object({
      email: z.string().email(),
    }),
  }),
  async handler(req, res) {
    const { email } = req.input.body;

    // Dispatches email notification via plugins/email (if active)
    await req.auth.requestMagicLink(email, {
      tokenTtlMs: 15 * 60 * 1000, // 15 mins (default)
      path: '/auth/magic-link/verify',
    });

    return res.json({
      ok: true,
      message: 'If an account exists with this email, a sign-in link has been sent.',
    });
  },
});
```

### 7.3 Verifying & Logging In (`pages/api/auth/magic-link/verify.get.js`)
```javascript
const { defineApi } = require('webspresso');

module.exports = defineApi({
  schema: ({ z }) => ({
    query: z.object({
      token: z.string().min(1),
    }),
  }),
  async handler(req, res) {
    const { token } = req.input.query;

    // Verifies token, consumes it, marks email verified, logs into session and/or generates JWTs
    const result = await req.auth.loginWithMagicLink(token, {
      remember: true,
      jwt: false, // Set to true to receive accessToken and refreshToken
    });

    // For browser requests, redirect to dashboard:
    if (req.accepts('html')) {
      return res.redirect('/dashboard');
    }

    return res.json({ ok: true, user: result.user });
  },
});
```

### 7.4 Using Built-in Route Middlewares
You can also mount Webspresso's pre-configured Express middlewares directly:
```javascript
const {
  createMagicLinkRequestHandler,
  createMagicLinkVerifyMiddleware,
} = require('webspresso/core/auth');

// Request link: POST /auth/magic-link
app.post('/auth/magic-link', createMagicLinkRequestHandler(authManager));

// Verify & Login: GET /auth/magic-link/verify
app.get('/auth/magic-link/verify', createMagicLinkVerifyMiddleware(authManager, {
  redirectTo: '/dashboard',
  failureRedirect: '/login?error=invalid_magic_link',
  jwt: false,
}));
```

### 7.5 AuthManager Magic Link Events
`AuthManager` extends `EventEmitter`, allowing you to hook into magic link lifecycle events:
```javascript
authManager.on('magicLink:requested', ({ userId, email, expiresAt }) => {
  console.log(`Magic link requested for ${email}, expires at ${expiresAt}`);
});

authManager.on('magicLink:verified', ({ userId }) => {
  console.log(`User ${userId} signed in via magic link`);
});
```

---

## 8. Active Devices & Remote Session Revocation

Webspresso provides a built-in session management and device tracking system (`webspresso/core/auth`) allowing users to view all active logins, detect browser/OS/hardware types, and remotely revoke unwanted sessions.

### 8.1 Database Migration
Create the `user_sessions` table using the built-in migration helper:
```javascript
const { createUserSessionsTable } = require('webspresso/core/auth');

exports.up = async function(knex) {
  await createUserSessionsTable(knex);
};

exports.down = async function(knex) {
  const { dropUserSessionsTable } = require('webspresso/core/auth');
  await dropUserSessionsTable(knex);
};
```

Schema columns:
- `id`: Bigint primary key
- `session_id`: Unique Express session ID
- `user_id`: User ID reference
- `ip_address`: Proxy-safe client IP (`x-forwarded-for`, `x-real-ip`, or socket)
- `user_agent`: Raw User-Agent string
- `browser`: Detected browser and version (e.g. `Chrome 128`, `Safari 17`, `Firefox 125`, `Edge 122`)
- `os`: Detected operating system (e.g. `macOS 14`, `Windows 10/11`, `iOS 17.4`, `Android 14`, `Ubuntu Linux`)
- `device`: Device form factor (`desktop`, `mobile`, `tablet`, `bot`)
- `last_active_at`: Last seen timestamp (throttled to 60s by default to protect DB performance)
- `created_at`: Initial login timestamp

### 8.2 Enabling Session Tracking
Enable session tracking in `createAuth` or `quickAuth`:
```javascript
const { quickAuth } = require('webspresso/core/auth');

const auth = quickAuth({
  db,
  sessionTracking: true, // Automatically enables Knex session tracker and active session verification
});
```

Or manually with custom options:
```javascript
const { createAuth, createKnexSessionTracker } = require('webspresso/core/auth');

const auth = createAuth({
  db,
  sessionTracking: true,
  sessionTracker: createKnexSessionTracker(db),
  sessionTouchThrottleMs: 60000, // Touch session at most once per minute
  // ...other config
});
```

### 8.3 File-Based API Routes (`pages/api/*`)

#### List Active Devices (`pages/api/auth/sessions.get.js`)
```javascript
const { defineApi } = require('webspresso');

module.exports = defineApi({
  middleware: ['auth'],
  async handler(req, res) {
    // Returns array of active sessions with is_current flag for current device
    const sessions = await req.auth.sessions();
    return res.json({ ok: true, sessions });
  },
});
```

#### Revoke Session / Remote Logout (`pages/api/auth/sessions/revoke.post.js`)
```javascript
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
      // Revokes all sessions except current device
      const count = await req.auth.revokeOtherSessions();
      return res.json({ ok: true, revokedCount: count, message: 'All other sessions revoked' });
    }

    if (sessionId) {
      // Revokes specified session (logs out current user if it is the current session)
      await req.auth.revokeSession(sessionId);
      return res.json({ ok: true, message: 'Session revoked' });
    }

    return res.status(400).json({ error: 'sessionId or allOthers is required' });
  },
});
```

### 8.4 Automatic Invalidation in Middleware
When a session is revoked remotely, Webspresso's `authenticate` middleware automatically detects it on the next incoming request from that device:
- The revoked session is destroyed in `req.sessionStore`.
- `req.user` is set to `null`.
- Any subsequent `requireAuth` or `middleware: ['auth']` guard immediately redirects or rejects the request with `401 Unauthorized`.

### 8.5 Session Lifecycle Events
`AuthManager` emits EventEmitter events for monitoring and security audits:
```javascript
auth.on('session:created', ({ sessionId, userId, ip, browser, os, device }) => {
  console.log(`New session created for user ${userId} from ${device} (${browser} on ${os}) at ${ip}`);
});

auth.on('session:revoked', ({ sessionId, userId, revokedBy }) => {
  console.log(`Session ${sessionId} was revoked`);
});

auth.on('sessions:revoked_others', ({ userId, currentSessionId, count }) => {
  console.log(`User ${userId} revoked ${count} other sessions`);
});

auth.on('sessions:revoked_all', ({ userId, count }) => {
  console.log(`All ${count} sessions revoked for user ${userId}`);
});
```

---

## 9. Authorization & Policies (AdonisJS Bouncer & Django Permissions-inspired)

Webspresso provides an authorization layer combining AdonisJS Bouncer policies/gates with Django-style permission matrices and superuser bypass:

### 9.1 Defining Policies & Gates
Define domain policies and simple gates using `definePolicy` and `defineGate`:

```javascript
const { definePolicy, defineGate } = require('webspresso');

// 1. Resource Policy
definePolicy('Post', {
  view: (user, post) => true,
  update: (user, post) => user && (user.id === post.user_id || user.role === 'admin'),
  delete: (user, post) => user && user.role === 'admin',
});

// 2. Named Gate
defineGate('admin-only', (user) => Boolean(user && user.role === 'admin'));
```

### 9.2 Request Bouncer (`req.bouncer`)
Incoming requests automatically receive `req.bouncer` bound to `req.user`:

```javascript
// Inside API Route or Loader:
if (req.bouncer.allows('Post.update', post)) {
  // Authorized
}

if (req.bouncer.denies('admin-only')) {
  // Denied
}

// Throws ForbiddenError (403) or UnauthorizedError (401) on failure:
req.bouncer.authorize('Post.update', post);

// Inline rule check:
req.bouncer.authorize((user) => user.isVip);
```

### 9.3 Django Permissions Matrix & Superuser Bypass
Users with permissions arrays or superuser flags are evaluated automatically:
- `user.permissions = ['post.create', 'post.update']`
- Wildcards: `user.permissions = ['post.*']` or `['*']`
- Django Superuser: `user.isSuperuser = true` or `user.is_superuser = true` automatically bypasses all permission checks.
- Custom methods: `user.hasPerm(perm, resource)` or `user.hasPermission(...)`.

### 9.4 Nunjucks Template Helpers (`fsy.can`, `fsy.cannot`)
Check permissions directly in `.njk` templates:

```jinja
{% if fsy.can('Post.update', post) %}
  <a href="/posts/{{ post.id }}/edit" class="btn">Edit Post</a>
{% endif %}

{% if fsy.cannot('admin-only') %}
  <p class="text-muted">Admin access required</p>
{% endif %}
```




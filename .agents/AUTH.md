# Webspresso Dual Authentication Architecture

[← Back to AGENTS.md](.agents/AGENTS.md)

---

## 1. Overview

Webspresso provides a zero-dependency **Dual Authentication** system (`webspresso/core/auth` — resolved via package exports, no `/index.js` suffix required):
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

## 5. Zero-Dependency OAuth 2.0 & Social Login (`plugins/oauth`, `core/auth/oauth`)

Webspresso includes a built-in, zero-dependency OAuth 2.0 client and plugin with RFC 7636 PKCE, HMAC-SHA256 signed anti-CSRF state tokens, profile normalization, and seamless Dual Auth integration:

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
- `GET /auth/:provider/callback`: Validates anti-CSRF state, exchanges authorization code for tokens, fetches normalized profile, calls `findOrCreateUser`, automatically establishes session via `req.auth.login(user)`, and redirects to `returnTo`. For API/mobile clients (`format=json` or `Accept: application/json`), returns `{ success: true, user, token }`.

### 5.3 Template Helper (`fsy.oauthUrl`)
In Nunjucks templates:
```html
<a href="{{ fsy.oauthUrl('google') }}" class="btn">Sign in with Google</a>
<a href="{{ fsy.oauthUrl('github', { returnTo: '/settings' }) }}" class="btn">Connect GitHub</a>
```

---

## 6. Zero-Dependency Two-Factor Authentication (2FA / TOTP)

Webspresso provides an enterprise-grade, zero-dependency 2FA/TOTP suite adhering strictly to **RFC 6238 (TOTP)**, **RFC 4226 (HOTP)**, and **RFC 4648 (Base32)**. It requires NO external npm libraries and features offline SVG QR code generation to prevent leaking secret keys to third-party APIs.

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



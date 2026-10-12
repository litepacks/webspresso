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


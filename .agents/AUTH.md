# Webspresso Dual Authentication Architecture

[← Back to AGENTS.md](.agents/AGENTS.md)

---

## 1. Overview

Webspresso provides a zero-dependency **Dual Authentication** system (`webspresso/core/auth`):
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

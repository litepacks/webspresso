# Dual Authentication Guide

> **Goal:** Secure your Webspresso application with stateful Session Cookies for SSR pages and stateless HS256 JWT tokens with refresh rotation for REST APIs.

---

## 1. Dual Auth Overview

Webspresso provides a zero-dependency dual authentication system (`core/auth/`):

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

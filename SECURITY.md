# Security Policy

Webspresso is committed to providing a secure, lightweight Express SSR framework. We take the security of our framework, plugins, and the applications built with it seriously.

---

## 1. Supported Versions

We provide security updates and patches for the following versions of Webspresso:

| Version | Supported          | Security Maintenance |
| ------- | ------------------ | -------------------- |
| 0.0.x   | :white_check_mark: | Active (Current)     |
| < 0.0.80| :x:                | End of Life (EOL)    |

---

## 2. Reporting a Vulnerability

If you discover a security vulnerability in Webspresso, please report it responsibly. **Do not create public GitHub issues for security vulnerabilities.**

### Disclosure Process
1. **Email Report**: Send an email with full details to [iamaroott@gmail.com](mailto:iamaroott@gmail.com) (or through GitHub's Private Security Advisories).
2. **Include in Your Report**:
   - A clear description of the vulnerability and attack scenario.
   - Affected component(s) (e.g. Core, SSR Router, Admin Panel, JWT Auth, CSRF Plugin, etc.).
   - Step-by-step reproduction steps or a minimal proof-of-concept (PoC).
   - Potential impact and threat classification (e.g. XSS, SSRF, Prototype Pollution, Open Redirect).
   - Any proposed remediation or patches if available.

### Response Timelines
- **Initial Acknowledgment**: Within **48 hours**.
- **Assessment & Triage**: Within **5 business days**.
- **Fix & Advisory Publication**: Coordinated with the reporter before public disclosure.

---

## 3. Core Security Philosophy & Architecture

Webspresso follows the principle of **"Secure by default, configurable when necessary."**

```
┌─────────────────────────────────────────────────────────────┐
│                    HTTP Client Request                      │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                  Network & Proxy Boundary                   │
│   • Configurable `trust proxy` (disallow spoofed headers)   │
│   • Helmet Security Headers (HSTS, NoSniff, Frameguard, CSP)│
│   • Streaming Response Compression Thresholds               │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                  File Router & Middleware                   │
│   • Directory Traversal & Encoded Dot Filtering (%2e%2e)    │
│   • Global / Route-Level CSRF Protection (Timing-Safe)      │
│   • Zero-Dependency CORS & Basic Auth (CRLF Protected)      │
│   • Request Timeout Boundaries                              │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                  SSR, Auth & ORM Execution                  │
│   • Nunjucks HTML Autoescape + Script-Safe JSON Filter      │
│   • Dual Auth: Stateful Session & HS256 JWT Verification    │
│   • Isolated Staff Session for Admin Panel (/_admin)        │
│   • Prototype-Pollution Resistant Utilities (deepClone)     │
│   • Centralized Error Boundary (Production 500 Masking)     │
└─────────────────────────────────────────────────────────────┘
```

### Key Built-in Defenses
- **Zero-Dependency Security Core**: Cryptographic operations, JWT verification, CSRF hashing, and basic auth parsing rely exclusively on native Node.js standard libraries (`crypto`, `buffer`).
- **Timing-Attack Resistance**: All secret comparisons (HMAC signatures, basic auth credentials, CSRF tokens, password hashes) use `crypto.timingSafeEqual`.
- **SSR & Template Protection**: Nunjucks auto-escaping is active by default. The `json` filter serializes angle brackets (`<`, `>`) as unicode escape sequences to prevent `</script>` breakouts.
- **Admin Panel Isolation**: Admin panel authentication (`req.session.adminUser`) is strictly separated from front-facing public authentication (`req.user`). Column filter parameters are validated against model schemas to prevent injection.
- **Open Redirect Hardening**: Redirect rules validate target URLs against backslash traversal (`\\`, `/\`, `\/`) and dangerous URI schemes (`javascript:`, `data:`).
- **Information Leakage Prevention**: Production mode (`NODE_ENV=production`) automatically masks unhandled error stack traces and internal database connection details.

---

## 4. Developer Security Best Practices

When building applications with Webspresso, adhere to the following recommendations:

1. **Always Set `NODE_ENV=production`**:
   Ensure your deployment sets `NODE_ENV=production` to enable automatic Helmet headers, CSP enforcement, and error detail masking.

2. **Configure Reverse Proxy Settings**:
   - If running behind Nginx / Cloudflare / AWS ALB:
     ```js
     createApp({ trustProxy: 1 }); // or specific trusted subnet
     ```
   - If directly exposed to the internet without a reverse proxy:
     ```js
     createApp({ trustProxy: false });
     ```

3. **Strong Secrets & Key Rotation**:
   - Provide high-entropy secrets (at least 32 characters) for `session.secret` and JWT signing keys.
   - Never commit `.env` files containing production secrets to version control.

4. **CSRF Protection for Form Submissions**:
   Enable `csrfPlugin` for state-changing endpoints (POST, PUT, DELETE, PATCH).

5. **Sanitize Dynamic User Inputs**:
   Use `zdb` schema validators and avoid constructing raw SQL queries via `knex.raw()` with unsanitized user inputs.

---

## 5. Automated Security Testing

Webspresso includes an automated security test suite located in `tests/security/`. You can run these tests locally or in CI pipelines:

```bash
# Run security test suite
npm run test:security

# Run security suite and dependency audit
npm run security
```

---

## 6. Responsible Disclosure Hall of Fame

We gratefully acknowledge security researchers who help make Webspresso safer for everyone through coordinated vulnerability disclosure.

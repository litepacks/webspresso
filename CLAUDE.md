# Webspresso — Claude Code Assistant Guide

Webspresso is a lightweight, zero-dependency-sprawl full-stack Node.js SSR & API framework.

> [!IMPORTANT]
> **Authoritative Rules & Architecture**: Always follow [AGENTS.md](AGENTS.md) and the modular topic guides in [.agents/](.agents/AGENTS.md).
> **API & Types Ground Truth**: Inspect [index.d.ts](index.d.ts) for exact method signatures.

---

## ⚡ Essential Commands

```bash
# Run test suite (Node >= 20 required)
npm test
npx vitest run tests/unit/
npx vitest run tests/integration/
npx vitest run tests/security/

# Development & diagnostics
npm run dev
npx webspresso doctor
npx webspresso db:migrate
```

---

## 🛡️ Critical Architecture Rules

1. **100% File-Based Routing (NO `routes/` or `app.get()`)**:
   - All endpoints live in `pages/api/...` with HTTP method extensions:
     - `pages/api/notes.get.js` → `GET /api/notes`
     - `pages/api/notes.post.js` → `POST /api/notes`
     - `pages/api/notes/[id].get.js` → `GET /api/notes/:id`
     - `pages/api/notes/[id].delete.js` → `DELETE /api/notes/:id`
   - Contract: `module.exports = { schema: ({ z }) => ({ body, query, params }), middleware: ['auth'], handler: async (req, res) => ... }`

2. **Strict Repository Pattern (NO Raw `db('table')`)**:
   - Never run raw Knex queries (`req.db('table')`).
   - Always use `req.db.getRepository('ModelName')` to ensure schema validation, hooks, scopes, and query caching.

3. **Services Layer (NO `controllers/`)**:
   - Place business logic in `services/domain/action.js` and invoke via `ctx.service('domain.action', input)`.

4. **Zero-Dependency Native Dual Auth**:
   - Never install `jsonwebtoken`, `passport`, or `express-session`.
   - Use built-in `req.auth` and `webspresso/core/auth`.

5. **Semantic Exceptions & Page Loaders**:
   - Throw `NotFoundError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`.
   - For SSR pages (`pages/name.njk`), use companion loaders `pages/name.js` exporting `async function load({ req, res, db, ctx })`. Never call `res.render()` manually.

6. **Zero Regression Policy**:
   - Always run the relevant Vitest tests before declaring any task complete.

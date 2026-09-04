# Webspresso Coding Standards & Conventions

[← Back to AGENTS.md](.agents/AGENTS.md)

---

## 1. Core Policies

1. **Zero External Dependencies Policy**: Core framework functionality (Auth, JWT, CORS, Routing, Nunjucks helpers) must avoid unnecessary third-party npm dependencies. Rely strictly on native Node.js standard library modules (`crypto`, `path`, `fs`, `events`, `async_hooks`).
2. **Strict Signature & Schema Verification**: Always verify function signatures and object schemas by inspecting authoritative source files before calling or extending them.
3. **File & Component Separation**: Keep client-side components in clean standalone JS files (`component.js` / `componentFile`) rather than escaping inline template strings.
4. **Log & Traceback Inspection**: Base all bug fixes strictly on exact runtime error log tracebacks and empirical test output. Never swallow errors or return dummy fallbacks.
5. **No Superficial Symptom Patches**: Never resolve errors by masking symptoms or deleting failing unit tests. Always resolve the underlying contract breakage.
6. **Strict File-Based Routing Policy (NO Express `routes/` or `app.get()`)**:
   - **NEVER** create a `routes/` or `src/routes/` directory.
   - **NEVER** call `express.Router()`, `app.get()`, `app.post()`, or `app.use()` to register application API endpoints.
   - **ALWAYS** define API routes under `pages/api/...` with HTTP method extensions:
     - `GET /api/notes` → `pages/api/notes.get.js`
     - `POST /api/notes` → `pages/api/notes.post.js`
     - `GET /api/notes/:id` → `pages/api/notes/[id].get.js`
     - `DELETE /api/notes/:id` → `pages/api/notes/[id].delete.js`
   - Every file route module must export `{ schema, middleware, handler }` or an `async (req, res)` function. See [.agents/ROUTING.md](ROUTING.md) for full patterns.
7. **Strict Repository Pattern Policy (NO Raw `db('table')`)**:
   - **NEVER** write raw Knex table queries (`db('table')`, `req.db('table')`) in application code.
   - **ALWAYS** access database models through `db.getRepository('ModelName')` or `req.db.getRepository('ModelName')`.
   - Raw Knex queries bypass schema validation, lifecycle hooks, soft-deletes, multi-tenant scopes, hidden fields, and query caching. See [.agents/ORM.md](ORM.md) for full patterns.
8. **Services Layer Over Controllers (NO `controllers/`)**:
   - **NEVER** create a `controllers/` directory or write class-based controller singletons.
   - **ALWAYS** encapsulate multi-step business logic, domain mutations, and reusable operations inside `services/domain/action.js`.
   - Invoke services via `ctx.service('domain.action', input)` or `req.service('domain.action', input)`. This ensures declarative validation (`schema`), automatic ACID transaction propagation (`transaction: true`), and role guards (`auth`). See [.agents/SERVICES.md](SERVICES.md).
9. **Native Dual Auth Over External Packages (NO `jsonwebtoken` or `passport`)**:
   - **NEVER** install third-party auth packages like `jsonwebtoken`, `bcryptjs`, `passport`, or `express-session`.
   - **ALWAYS** use Webspresso's built-in zero-dependency Dual Authentication (`webspresso/core/auth` & `req.auth`). Use `req.auth.attempt()`, `req.auth.generateUserToken()`, and guards `middleware: ['auth']` (web session) or `middleware: ['jwt']` (stateless API Bearer). See [.agents/AUTH.md](AUTH.md).
10. **Page Data Loaders Over Manual `res.render()`**:
   - **NEVER** manually call `res.render('view.njk', { ... })` inside custom handlers for web pages.
   - **ALWAYS** declare SSR pages inside `pages/` (e.g. `pages/notes/[id].njk`) and provide server-side data via a companion loader in `pages/notes/[id].js` exporting `async function load({ req, res, db, ctx })`.
11. **Framework Exceptions Over Generic Errors**:
   - **NEVER** return manual error payloads like `return res.status(404).json(...)` inside services or loaders, and never throw generic `throw new Error('Not found')` for client-facing issues (which masks as a 500 error in production).
   - **ALWAYS** throw semantic framework exceptions: `NotFoundError` (404), `ValidationError` (422), `UnauthorizedError` (401), `ForbiddenError` (403), `BadRequestError` (400). Import them from `webspresso` or `webspresso/core/errors`. See [.agents/ERRORS.md](ERRORS.md).
12. **Background Queue Engine Over External BullMQ or `setTimeout`**:
   - **NEVER** install `bullmq` / `agenda` or use unmanaged `setTimeout()` / `setInterval()` for background or deferred tasks.
   - **ALWAYS** place background job handlers in `jobs/` (e.g. `jobs/email/send.js`) and dispatch them reliably using `req.queue.dispatch('email.send', payload)` or `ctx.queue.dispatch()`. See [.agents/QUEUE.md](QUEUE.md).

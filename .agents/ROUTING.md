# Webspresso File-Based Routing & API Routes

[← Back to AGENTS.md](AGENTS.md)

Webspresso is a full-stack Node.js framework powered by **100% File-Based Routing** (similar to Next.js App Router / Nuxt 3).

---

## ⚠️ STRICT ANTI-PATTERNS (DO NOT DO THIS)

### ❌ BAD vs ✅ GOOD Code Comparison

```javascript
// ❌ WRONG (Express / Legacy reflex — NEVER DO THIS)
// File: src/routes/users.js
const express = require('express');
const router = express.Router();
router.get('/users', async (req, res) => {
  const users = await db('users').select('*'); // Raw query bypasses ORM!
  res.json(users);
});
module.exports = router;

// ✅ CORRECT (Webspresso 100% File-Based Routing)
// File: pages/api/users.get.js
'use strict';
module.exports = {
  schema: ({ z }) => ({
    query: z.object({ limit: z.coerce.number().optional().default(20) }),
  }),
  middleware: ['auth'], // optional
  handler: async (req, res) => {
    const users = await req.db.getRepository('User').find(req.input.query);
    return res.json({ success: true, data: users });
  },
};
```

1. **NEVER create a `routes/` or `src/routes/` folder.**
2. **NEVER use `express.Router()` or `require('express').Router()`.**
3. **NEVER call `app.get()`, `app.post()`, `app.put()`, or `app.delete()` for application endpoints.**
4. **NEVER use `createApp({ setupRoutes: (app) => ... })` to mount domain/application routes.**
5. **ALL application routes MUST live inside the `pages/` directory.**

---

## 1. Directory Structure & URL Mapping

All routes are automatically discovered and registered from the `pages/` directory:

| File Path | HTTP Method | URL Route | Description |
| :--- | :--- | :--- | :--- |
| `pages/index.njk` | `GET` | `/` | Home page (SSR Nunjucks) |
| `pages/about.njk` | `GET` | `/about` | Static SSR page |
| `pages/notes/[id].njk` | `GET` | `/notes/:id` | Dynamic SSR route with param |
| `pages/(marketing)/about.njk` | `GET` | `/about` | Route Group page (omits `(marketing)`) |
| `pages/(auth)/login.njk` | `GET` | `/login` | Route Group with isolated layout & middleware |
| `pages/api/notes.get.js` | `GET` | `/api/notes` | List notes API endpoint |
| `pages/api/(v1)/notes.get.js` | `GET` | `/api/notes` | API route inside Route Group |
| `pages/api/notes.post.js` | `POST` | `/api/notes` | Create note API endpoint |
| `pages/api/notes/[id].get.js` | `GET` | `/api/notes/:id` | Get single note API endpoint |
| `pages/api/notes/[id].put.js` | `PUT` | `/api/notes/:id` | Update note API endpoint |
| `pages/api/notes/[id].delete.js` | `DELETE` | `/api/notes/:id` | Delete note API endpoint |

### Method Extension Suffixes
API route filenames **MUST** declare their HTTP method before the `.js` extension:
- `.get.js`
- `.post.js`
- `.put.js`
- `.patch.js`
- `.delete.js`

If no method suffix is provided (e.g. `pages/api/notes.js`), it defaults to `GET`.

---

## 2. Standard API Route Contract

Every API route module exports an object with optional `schema`, optional `middleware`, and a `handler` function:

```javascript
// pages/api/notes.post.js
'use strict';

module.exports = {
  // 1. Declarative Input Validation (Zod)
  schema: ({ z }) => ({
    body: z.object({
      title: z.string().min(1, 'Title is required').max(200),
      content: z.string().min(1, 'Content is required'),
      isPublic: z.boolean().optional().default(false),
    }),
  }),

  // 2. Named Middleware Guards (resolved from ctx.middlewares or global plugins)
  middleware: ['auth'], // e.g. 'auth', 'jwt', 'basicAuth', or inline (req, res, next) => ...

  // 3. Request Handler
  handler: async (req, res) => {
    // req.db: Injected database repository factory
    // req.service(): Injected service registry invocation helper
    // req.input.body: Type-safe, validated request payload
    // req.auth / req.session: Authenticated user session

    const noteRepo = req.db.getRepository('Note');
    const note = await noteRepo.create({
      ...req.input.body,
      userId: req.session?.user?.id || req.auth?.user?.id,
    });

    return res.status(201).json({
      success: true,
      data: note,
    });
  },
};
```

> [!IMPORTANT]
> **NEVER use raw Knex queries** like `req.db('notes')` in route handlers. **ALWAYS use repositories**: `req.db.getRepository('Note')`. This guarantees schema validation, lifecycle hooks, soft deletes, and query caching are respected.

### 2.1 Smart API Validation i18n & Error Translation

Webspresso features built-in **Smart Dual-Layer Auto-Translation** for Zod schema validation errors with **zero runtime overhead on valid requests**.

#### How It Works:
1. **Explicit Custom Keys**: Define dictionary translation keys directly inside Zod schemas (e.g. `z.string({ message: 'auth.email_required' })` or `z.string().min(5, 'auth.password_min')`).
2. **Dynamic Fallbacks**: If no explicit key is matched, the engine falls back to convention-based candidate keys:
   - `validation.fields.<field>.<code/type>` (e.g., `validation.fields.email.invalid_string`)
   - `validation.<code/type>` (e.g., `validation.too_small`, `validation.required`, `validation.invalid_string.email`)
   - `zod.<code/type>`
3. **Parameter Interpolation**: Dynamic schema parameters (e.g. `{{ min }}`, `{{ max }}`, `{{ expected }}`, `{{ received }}`) are automatically interpolated into translated messages or inline custom template strings.
4. **Context Injection**: `apiCtx` provides `{ locale, t, service, db, sse }` to route handlers for immediate localized responses.

#### Example Usage:

```json
// pages/locales/tr.json
{
  "auth": {
    "email_required": "Lütfen geçerli bir e-posta adresi giriniz"
  },
  "validation": {
    "required": "Bu alan zorunludur",
    "too_small": "En az {{ min }} karakter olmalıdır"
  }
}
```

```javascript
// pages/api/auth/register.post.js
'use strict';
const { defineApi } = require('webspresso');

module.exports = defineApi({
  schema: ({ z }) => ({
    body: z.object({
      // Explicit dictionary translation key
      email: z.string({ message: 'auth.email_required' }).email(),
      // Automatic fallback to validation.too_small with {{ min }} interpolation
      password: z.string().min(8),
    }),
  }),
  handler: async (req, res, { t, locale }) => {
    // req.locale and t() are injected into handler context
    return res.status(201).json({
      success: true,
      message: t('auth.registered_success', { email: req.input.body.email }),
    });
  },
});
```

Client requests sending `Accept-Language: tr` or query param `?lang=tr` will automatically receive fully localized validation errors in the 400 Bad Request response:
```json
{
  "error": "Validation failed",
  "issues": [
    {
      "field": "password",
      "code": "too_small",
      "key": "validation.too_small",
      "message": "En az 8 karakter olmalıdır"
    }
  ]
}
```

---

## 3. Dynamic Route Parameters (`[param]`)

Dynamic path segments use square brackets:

```javascript
// pages/api/notes/[id].get.js
'use strict';

module.exports = {
  schema: ({ z }) => ({
    params: z.object({
      id: z.string().min(1),
    }),
  }),

  handler: async (req, res) => {
    const { id } = req.params;
    const note = await req.db.getRepository('Note').findById(id);

    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }

    return res.json({ success: true, data: note });
  },
};
```

---

## 4. Route Groups `(group)` Syntax & Layout Isolation

Webspresso supports Next.js / Nuxt-style **Route Groups**. Any directory name wrapped in parentheses `(groupName)` is treated as an organizational group:
- **Clean Public URLs**: The parenthesized directory name is completely omitted from the generated URL path.
- **Layout & Middleware Isolation**: The directory hierarchy is preserved for cascading middleware (`_middleware.js`) and nested layouts (`_layout.njk`), allowing distinct shells and security guards without polluting public route URLs.
- **Nesting & Dynamic Route Support**: Route groups can be nested (e.g. `(shop)/(checkout)/cart.njk` → `/cart`), combined with dynamic segments (e.g. `(app)/users/[id].njk` → `/users/:id`), and applied to API routes (`pages/api/(v1)/items.get.js` → `/api/items` or `pages/(marketing)/api/newsletter.post.js` → `/api/newsletter`).

### 4.1 Route Group Structure Example

```
pages/
├── (marketing)/
│   ├── _layout.njk          # Marketing layout (Hero header, footer)
│   ├── _middleware.js       # Track analytics / marketing headers
│   ├── index.njk            -> GET /
│   ├── about.njk            -> GET /about
│   └── api/
│       └── newsletter.post.js -> POST /api/newsletter
├── (auth)/
│   ├── _layout.njk          # Centered card layout (no nav/footer)
│   ├── _middleware.js       # Guest-only guard (redirects authenticated users)
│   ├── login.njk            -> GET /login
│   └── register.njk         -> GET /register
└── (app)/
    ├── _layout.njk          # App shell layout with sidebar
    ├── _middleware.js       # Strict session auth guard
    └── dashboard.njk        -> GET /dashboard
```

### 4.2 Programmatic Utilities
Webspresso exports core helpers to inspect and transform route group paths:
```javascript
const { isRouteGroupSegment, stripRouteGroups } = require('webspresso');

isRouteGroupSegment('(marketing)'); // true
isRouteGroupSegment('about');       // false

stripRouteGroups('/(marketing)/about'); // '/about'
stripRouteGroups('/(shop)/(checkout)/cart'); // '/cart'
```

---

## 5. SSR Page Routes (`load()` Loader)

For server-rendered Nunjucks HTML pages, use `.njk` templates and companion `.js` loader files (or inline `async function load` in a `.js` file):

```javascript
// pages/notes/[id].js (Companion data loader for pages/notes/[id].njk)
'use strict';

module.exports = {
  // Runs server-side before rendering the template
  async load({ req, res, db, ctx }) {
    const note = await db.getRepository('Note').findById(req.params.id);
    if (!note) {
      return { status: 404, notFound: true };
    }

    return {
      note,
      title: note.title,
    };
  },
};
```

---

## 6. Module & File-Based Discovery (`src/pages`, `src/api`, `modules/{name}`)

Webspresso supports clean, domain-driven module discovery alongside root-level pages and APIs:

```txt
src/
  pages/                -> Global UI pages (definePage or Nunjucks)
    index.js            -> GET /
    about.js            -> GET /about
    docs/[...path].js   -> GET /docs/*path

  api/                  -> Global API endpoints (defineApi)
    health.get.js       -> GET /api/health
    users/[id].patch.js -> PATCH /api/users/:id

  modules/              -> Feature-driven modules
    auth/
      auth.module.js    -> defineModule({ name: 'auth', ... })
      pages/
        login.js        -> GET /auth/login
        register.js     -> GET /auth/register
      api/
        login.post.js   -> POST /api/auth/login
        me.get.js       -> GET /api/auth/me
      services/
        login.js        -> ctx.service('auth.login', input)
      middleware/
        auth-guard.js   -> module-local named middleware 'authGuard'
```

### 6.1 `definePage()` Contract
```javascript
const { definePage } = require('webspresso');

module.exports = definePage({
  middleware: ['authGuard'], // module or global middleware
  load: async (ctx) => {
    // ctx: { req, res, params, query, service, db, redirect, fsy, locale, t }
    if (!ctx.req.user) {
      return ctx.redirect('/auth/login', 302);
    }
    const profile = await ctx.service('user.profile', { id: ctx.req.user.id });
    return { profile };
  },
  head: (data) => ({
    title: `${data.profile.name}'s Profile`,
  }),
  render: (data, ctx) => `
    <main>
      <h1>${data.profile.name}</h1>
      <p>Email: ${data.profile.email}</p>
    </main>
  `,
});
```

### 6.2 `defineApi()` Contract
```javascript
const { defineApi, z } = require('webspresso');

module.exports = defineApi({
  description: 'Authenticate user and return session',
  tags: ['Auth'],
  middleware: ['rateLimit'],
  schema: {
    body: z.object({
      email: z.string().email(),
      password: z.string().min(8),
    }),
  },
  handler: async (req, res, ctx) => {
    // req.input.body contains validated payload
    const result = await ctx.service('auth.login', req.input.body);
    return res.json(result);
  },
});
```

### 6.3 `defineModule()` Contract
```javascript
const { defineModule } = require('webspresso');

module.exports = defineModule({
  name: 'auth',
  version: '1.0.0',
  pages: { prefix: '/auth' },       // default: /auth
  api: { prefix: '/api/auth' },     // default: /api/auth
  middlewares: {
    authGuard: (req, res, next) => {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      next();
    },
  },
});
```

### 6.4 Route Introspection (`app.routes.list()`)
Compiled routes are accessible at runtime for tooling, CLI inspection, and documentation:
```javascript
const routeList = app.routes.list();
// [
//   { method: 'GET', path: '/', type: 'page', source: 'src/pages/index.js' },
//   { method: 'POST', path: '/api/auth/login', type: 'api', module: 'auth', description: 'Authenticate user' }
// ]
```

### 6.5 Cold Start & High-Performance Routing Architecture

Webspresso incorporates multi-tier optimizations to ensure sub-millisecond cold starts in production and instant dev-server boot times:

#### 1. Single-Pass Unified Route Discovery (`discoverAppRoutes`)
Instead of performing multiple independent directory traversals, `discoverAppRoutes(rootDir, options)` discovers Page routes, API routes, and Route Groups in a single traversal pass:
```javascript
const { discoverAppRoutes } = require('webspresso');

const { routeTable, pageRoutes, apiRoutes } = discoverAppRoutes(__dirname);
```
Passing `discoveredRoutes` to `createApp({ discoveredRoutes })` skips internal discovery completely.

#### 2. Dev-Mode On-Demand (JIT) Route Evaluation (`lazyRoutes: true`)
In development (`NODE_ENV !== 'production'`), `lazyRoutes: true` is enabled by default:
- Route paths and HTTP methods are registered immediately with lightweight proxy handlers.
- Route handler modules (`pages/**/*.js` / `pages/api/**/*.js`) are required and evaluated **on-demand on the first incoming HTTP request**.
- Result: Dev server boots in ~15ms even in applications with hundreds of routes.
- Can be explicitly controlled via `createApp({ lazyRoutes: false })` to force eager evaluation.

#### 3. Production Ahead-of-Time (AOT) Route Manifest (`routes.manifest.json`)
For maximum production performance, compile your route table during the build step:
```bash
npx webspresso build
```
This generates `.webspresso/routes.manifest.json`. When `createApp({ routesManifest: true })` is used (or when `.webspresso/routes.manifest.json` exists in `NODE_ENV === 'production'`), Webspresso:
- Bypasses filesystem directory scanning (`pages/`) entirely.
- Bypasses regex path compilation and route sorting at boot.
- Instantly binds pre-sorted routes from the manifest.

### 6.6 Server-Sent Events (SSE) Streaming (`res.sse`)
For real-time event streaming and LLM token outputs, use the native `res.sse()` helper (or `{ sse }` from `ctx`):

```javascript
// File: pages/api/ai/chat.post.js
const { defineApi } = require('webspresso');

module.exports = defineApi({
  handler: async (req, res, { sse }) => {
    // 1. Controller mode with automatic keepalive & reconnection directives
    const stream = sse({ heartbeat: 15000, retry: 3000 });

    await stream.send({ delta: 'Hello ' });
    await stream.send({ event: 'delta', data: { text: 'world!' }, id: '1' });
    stream.close();

    // 2. OR stream an async generator / LLM stream directly:
    // return res.sse(async function*() {
    //   for await (const chunk of llmStream) {
    //     yield { token: chunk.text };
    //   }
    // });
  },
});
```

### 6.7 Cascading Middleware (`_middleware.js`) & Nested Layouts (`_layout.njk`)

Webspresso supports folder-level cascading middleware inheritance and nested layouts across directory trees:

#### 1. Cascading Middleware (`_middleware.js`)
Any directory under `pages/` can declare a `_middleware.js` file:
- **Execution Order**: Middlewares execute in top-down ancestral order (from root down to route leaf) before route handlers and route-specific middleware.
- **Early Termination**: If any middleware sends headers (e.g. `res.status(401).json(...)` or `res.redirect('/login')`), execution halts immediately and downstream middlewares/handlers are skipped.
- **Export Formats**: Standard Express middleware function `(req, res, next)`, async function, named middleware string/array `['auth', 'cors']`, or middleware tuples with options `[['rateLimit', { max: 100 }]]`.

```
pages/
├── _middleware.js            # Runs for ALL routes (adds global headers / request ID)
├── api/
│   └── admin/
│       ├── _middleware.js    # Protects all /api/admin/* endpoints
│       └── metrics.get.js    # Inherits root + admin middleware
└── dashboard/
    ├── _middleware.js        # Auth guard for /dashboard/* pages
    └── settings.njk
```

#### 2. Nested Layouts (`_layout.njk` & `_layout.js`)
Pages under `pages/` automatically inherit ancestor layouts:
- **Wrapping Order**: Child template is rendered first, then wrapped by layouts from innermost to outermost using `{{ content | safe }}`.
- **Layout Loaders (`_layout.js`)**: Companion `_layout.js` files can export `async function load(req, ctx)` to supply shared data (e.g., site title, navigation, breadcrumbs) in top-down order before the page loader runs.
- **Opt-Out**: A page can opt out of automatic layout wrapping by setting `layout: false` in its companion `.js` config/loader, or by explicitly using `{% extends "..." %}` in its Nunjucks template.

```html
{# pages/_layout.njk #}
<!DOCTYPE html>
<html>
<head><title>{{ siteTitle }}</title></head>
<body>
  <header>Global Nav</header>
  {{ content | safe }}
</body>
</html>
```

```html
{# pages/dashboard/_layout.njk #}
<div class="dashboard-shell">
  <aside>Dashboard Sidebar</aside>
  <main>{{ content | safe }}</main>
</div>
```

#### 3. Folder-Level Error Boundaries (`_error.njk` & `_error.js`)
When an exception occurs during SSR lifecycle execution (in `load()`, template rendering, hooks, or nested layout loaders):
- **Ancestral Discovery**: Webspresso searches up the directory hierarchy from the route's directory up to `pages/` for the nearest `_error.njk`.
- **Isolated Layout Preservation**: `_error.njk` is automatically wrapped inside the surrounding ancestor `_layout.njk` chain, keeping the UI intact (e.g. an error in `/dashboard/billing/invoices` renders the error card inside the dashboard sidebar and header).
- **Companion Loader (`_error.js`)**: Can export `load({ error, req, res, ctx, db })` to attach custom error data or report exceptions.
- **Status Code Propagation**: HTTP status is set to `error.status || error.statusCode || 500` (e.g., throwing `NotFoundError` returns HTTP 404).
- **Opt-Out**: Disable layout wrapping with `layout: false` in `_error.js` or frontmatter (`--- layout: false ---`).
- **Fallback**: If no `_error.njk` exists in any ancestor directory, execution falls through to the global Express error boundary (`app.setErrorHandler` / 500 page).

```html
{# pages/dashboard/_error.njk #}
<div class="p-6 bg-red-50 dark:bg-red-950/30 rounded-xl border border-red-200">
  <h2 class="text-xl font-bold text-red-700">Error {{ error.status }}</h2>
  <p class="text-red-600 mt-2">{{ error.message }}</p>
  {% if supportEmail %}<p class="mt-4 text-sm">Need help? Email {{ supportEmail }}</p>{% endif %}
</div>
```

#### 4. Folder-Level Loading Skeletons (`_loading.njk`)
In SSR streaming mode (`stream: true` or `renderStream`):
- **Automatic Discovery**: Discovers the nearest `_loading.njk` up the directory chain.
- **Auto-Populate Slots**: Any empty `<div data-stream-target="slotName"></div>` in the page template is automatically populated with the `_loading.njk` skeleton HTML in the initial flushed shell chunk!
- **Context Availability**: Exposed as `{{ loadingSkeleton | safe }}` and `{{ loadingHtml | safe }}` in the template context.
- **Layout Integration**: Cascading `_layout.njk` templates automatically wrap the streaming shell.

```html
{# pages/dashboard/_loading.njk #}
<div class="animate-pulse space-y-4">
  <div class="h-8 bg-slate-200 dark:bg-slate-800 rounded w-1/4"></div>
  <div class="h-32 bg-slate-200 dark:bg-slate-800 rounded"></div>
</div>
```

---

## 7. Form Handling, Flash Messages & Old Input (AdonisJS & Django-inspired)

For classic SSR forms (POST-Redirect-GET), Webspresso provides built-in flash data propagation and Django-style ModelForm rendering helpers.

### 7.1 Redirect with Old Input & Validation Errors
In your form submission handler (API or custom POST action):
```javascript
// pages/api/auth/register.post.js
module.exports = {
  handler: async (req, res) => {
    const { email, password } = req.body;
    
    if (!email.includes('@')) {
      return res
        .withInput() // Preserves req.body (sanitizes sensitive fields like password)
        .withErrors({ email: 'Please enter a valid email address' })
        .withFlash('warning', 'Please review the highlighted errors')
        .redirect('/register');
    }

    await req.service('user.create', { email, password });
    return res.withFlash('success', 'Account created! Please log in.').redirect('/login');
  }
};
```

### 7.2 Nunjucks Template Helpers (`fsy`)
In your Nunjucks templates (`pages/*.njk`):
```html
{% if fsy.hasFlash('success') %}
  <div class="alert alert-success">{{ fsy.flash('success') }}</div>
{% endif %}

<form method="POST" action="/api/auth/register">
  {{ fsy.csrf() | safe }}

  <!-- Manual field with old value and inline error -->
  <div class="mb-3">
    <label class="form-label">Email</label>
    <input type="email" name="email" 
           value="{{ fsy.old('email') }}" 
           class="form-control {% if fsy.hasError('email') %}is-invalid{% endif %}">
    {% if fsy.hasError('email') %}
      <div class="invalid-feedback">{{ fsy.error('email') }}</div>
    {% endif %}
  </div>

  <!-- Or use the Django-inspired field helper (one-liner) -->
  {{ fsy.field('email', { type: 'email', placeholder: 'you@example.com' }) | safe }}

  <button type="submit" class="btn btn-primary">Register</button>
</form>
```

### 7.3 Django ModelForm Helper (`fsy.formFor`)
Generate an entire HTML form from an ORM model definition with automatic widgets and validation error mapping:
```html
{# Automatically excludes id, created_at, updated_at and generates appropriate widgets #}
{{ fsy.formFor(req.db.getRepository('Article'), { action: '/articles', submitLabel: 'Publish' }) | safe }}
```

---

## 8. Summary Checklist for Agents

When a user asks to add or modify endpoints:
1. Identify the URL and method (e.g. `POST /api/auth/register` or `POST /auth/login`).
2. Create in `pages/api/...`, `src/api/...`, or `modules/{module}/api/...` with HTTP method extension (`.post.js`).
3. Use `defineApi()` or `{ schema, middleware, handler }`.
4. Use `req.db.getRepository(...)` or `ctx.service(...)`.
5. **NEVER touch `routes/` or create manual Express router files.**

# Project Structure

A standard Webspresso project generated with `webspresso new` follows a modular, predictable anatomy.

---

## High-Level Anatomy

```text
my-app/
├── config/                  # Environment loading & validation
│   ├── env.schema.js        # Zod validation schema for process.env
│   ├── load-env.js          # Cascading .env file loader
│   └── app.options.js       # Reusable createApp options configuration
│
├── pages/                   # File-based routing (SSR & API)
│   ├── _hooks.js            # Global lifecycle hooks (onRequest, onError)
│   ├── index.njk            # Home page template (GET /)
│   ├── index.js             # Home page data loader (load())
│   ├── about.njk            # Static page (GET /about)
│   ├── users/
│   │   ├── [id].njk         # Dynamic route (GET /users/:id)
│   │   └── [id].js          # Dynamic route loader
│   └── api/
│       ├── health.get.js    # JSON API endpoint (GET /api/health)
│       └── users.post.js    # JSON API endpoint (POST /api/users)
│
├── views/                   # Nunjucks layouts and shared partials
│   ├── layout.njk           # Primary application layout shell
│   └── partials/
│       ├── nav.njk          # Navigation bar
│       └── footer.njk       # Footer partial
│
├── services/                # Business logic & domain services
│   └── user/
│       ├── create.js        # Service: 'user.create'
│       └── get-by-id.js     # Service: 'user.get-by-id' / 'user.getById'
│
├── models/                  # Knex ORM Model definitions
│   └── User.js              # defineModel({ name: 'User', ... })
│
├── migrations/              # Knex database migrations
│   └── 20260828000000_init.js
│
├── public/                  # Static assets served at root
│   ├── css/
│   │   └── style.css        # Compiled Tailwind CSS
│   ├── js/
│   └── images/
│
├── tests/                   # Automated tests (Vitest)
│   └── unit/
│
├── .env.example             # Template for required environment variables
├── package.json             # Dependencies and scripts
├── server.js                # Express application entry point
├── tailwind.config.js       # Tailwind CSS configuration
└── webspresso.db.js         # Knex database connection configuration
```

---

## Directory Descriptions

### `config/`
- **`load-env.js`**: Loads environment files in cascading order: `.env` → `.env.local` → `.env.${NODE_ENV}` → `.env.${NODE_ENV}.local`.
- **`env.schema.js`**: Defines a strict Zod schema to validate required environment variables at process startup before the HTTP listener opens.

### `pages/`
- All `.njk` and `.js` files here automatically turn into URL routes.
- Subdirectories map directly to URL paths (e.g., `pages/blog/post.njk` → `/blog/post`).
- Dynamic segments use square brackets: `[id].njk` maps to `:id`. Catch-all segments use `[...slug].njk` mapping to `*`.
- The `api/` subdirectory handles JSON request and response payloads, using HTTP method suffixes in filenames (`.get.js`, `.post.js`, `.delete.js`).

### `views/`
- Contains layout wrappers and partial templates for Nunjucks rendering.
- Layouts define blocks (`{% block content %}{% endblock %}`) that page templates extend (`{% extends "views/layout.njk" %}`).

### `services/`
- Reusable domain logic.
- File paths automatically determine service names (e.g., `services/order/checkout.js` becomes `'order.checkout'`).
- Services support declarative Zod validation, authorization guards, automatic transaction propagation (`transaction: true`), and caching.

### `models/`
- Contains Knex ORM schema definitions created with `defineModel`.
- Models define table names, `zdb` column types, relations (`belongsTo`, `hasMany`), query scopes, and query complexity limits.

### `public/`
- Static files served by Express (images, compiled CSS, client JavaScript).
- Accessed in templates via the `fsy.asset('/css/style.css')` helper for automatic cache-busting and CDN resolution.

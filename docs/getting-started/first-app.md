# Creating Your First Application

> **Goal:** Build a complete Webspresso application with a server-rendered page, an API endpoint, and a service within 5 minutes.

---

## 1. Project Initialization

Create a new Webspresso project in a clean directory:

```bash
npx webspresso new quickstart-app --install
cd quickstart-app
```

The scaffolding creates a minimal, ready-to-run application structure with Tailwind CSS support preconfigured.

---

## 2. Server Entry Point (`server.js`)

Open `server.js`. This is where `createApp()` configures Express, Nunjucks, routing, and optional plugins:

```javascript
const path = require('path');
require('./config/load-env');
const { createApp } = require('webspresso');

const { app } = createApp({
  pagesDir: path.join(__dirname, 'pages'),
  viewsDir: path.join(__dirname, 'views'),
  publicDir: path.join(__dirname, 'public'),
  server: {
    shutdown: { enabled: true, timeout: 10000 },
    compression: true,
  },
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`);
});
```

---

## 3. Creating Your First SSR Page

Webspresso uses **file-based routing**. Any `.njk` file placed in the `pages/` directory automatically maps to a URL route.

Create `pages/index.njk`:

```html
{% extends "views/layout.njk" %}

{% block content %}
<main class="max-w-4xl mx-auto py-12 px-4">
  <div class="bg-white dark:bg-slate-800 shadow rounded-lg p-8">
    <h1 class="text-3xl font-bold text-slate-900 dark:text-white mb-4">
      {{ message }}
    </h1>
    <p class="text-slate-600 dark:text-slate-300 mb-6">
      Welcome to your new Webspresso application!
    </p>
    <div class="p-4 bg-slate-50 dark:bg-slate-700 rounded border border-slate-200 dark:border-slate-600">
      <span class="font-semibold">Server Time:</span> {{ timestamp }}
    </div>
  </div>
</main>
{% endblock %}
```

### Adding Server-Side Data (`load()`)

To fetch data on the server before rendering the template, export an `async function load()`:

Create or edit `pages/index.js` (or export directly alongside the template):

```javascript
module.exports = {
  async load({ req, res, ctx }) {
    return {
      message: 'Hello from Webspresso!',
      timestamp: new Date().toISOString(),
    };
  },
};
```

---

## 4. Creating a JSON API Endpoint

API routes are defined under `pages/api/` using HTTP method suffixes in the filename.

Create `pages/api/health.get.js`:

```javascript
module.exports = async function healthHandler(req, res) {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
};
```

This automatically mounts `GET /api/health`.

### Adding Zod Schema Validation

To validate request query parameters or request body, export a `schema` function:

Create `pages/api/greet.post.js`:

```javascript
module.exports = {
  schema({ z }) {
    return {
      body: z.object({
        name: z.string().min(2),
        email: z.string().email().optional(),
      }),
    };
  },

  async handler(req, res) {
    // req.input is typed and validated by Zod
    const { name, email } = req.input.body;
    res.json({
      greeting: `Hello, ${name}!`,
      sentTo: email || 'not provided',
    });
  },
};
```

---

## 5. Creating a Reusable Service

Webspresso provides a file-based Services layer for business logic.

Create `services/user/greet.js`:

```javascript
const { defineService } = require('webspresso');

module.exports = defineService({
  schema({ z }) {
    return {
      name: 'string',
    };
  },

  async handler(input, ctx) {
    return {
      message: `Welcome, ${input.name}!`,
    };
  },
});
```

Call this service from any route or SSR loader via `ctx.service()` or `req.service()`:

```javascript
const result = await req.service('user.greet', { name: 'Alice' });
```

---

## 6. Running the Development Server

Start the application with live reloading:

```bash
npm run dev
```

- Open **`http://localhost:3000`** in your browser to see your SSR page.
- Test the API: **`curl http://localhost:3000/api/health`**.

---

## Next Steps

- Review the **[Project Structure](project-structure.md)** guide.
- Read **[File-Based Routing](../guides/routing.md)** to learn about dynamic parameters and middleware.
- Learn about **[Database & ORM](../guides/database-and-orm.md)** to connect SQLite or PostgreSQL.

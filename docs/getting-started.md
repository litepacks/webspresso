# Getting started with Webspresso

Goal: a working app in about **15 minutes** — dev server, one page, one API, one model, migrations, and admin login.

**Prerequisites:** Node.js 18+, npm (or pnpm/yarn).

## 1. Create a project (about 2 minutes)

```bash
mkdir my-app && cd my-app
npm init -y
npm install webspresso dotenv zod better-sqlite3
npx webspresso new . --yes --install
```

Or create a new folder:

```bash
npx webspresso new my-app --yes --install
cd my-app
```

Copy environment file and set a session secret (required for admin auth later):

```bash
cp .env.example .env
```

Add to `.env` (32+ characters):

```env
SESSION_SECRET=change-me-to-a-long-random-string-at-least-32-chars
```

## 2. Verify installation

```bash
npx webspresso doctor --db --strict
```

Fix any reported errors before continuing.

## 3. First page (SSR route)

Create `pages/hello/index.njk`:

```html
{% extends "layout.njk" %}
{% block content %}
  <h1>Hello, Webspresso</h1>
  <p>Your first file-based route works.</p>
{% endblock %}
```

Start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000/hello](http://localhost:3000/hello).

## 4. First API endpoint

Create `pages/api/ping.get.js`:

```javascript
module.exports = async function get(req, res) {
  return res.json({ ok: true, message: 'pong', time: new Date().toISOString() });
};
```

Test: [http://localhost:3000/api/ping](http://localhost:3000/api/ping)

## 5. Database and first model (about 5 minutes)

If `webspresso new` did not add a database, create `webspresso.db.js`:

```javascript
module.exports = {
  development: {
    client: 'better-sqlite3',
    connection: { filename: './database.sqlite' },
    useNullAsDefault: true,
  },
};
```

Set in `.env`:

```env
DATABASE_URL=sqlite:./database.sqlite
```

Create `models/Post.js`:

```javascript
const { defineModel, zdb } = require('webspresso');

module.exports = defineModel({
  name: 'Post',
  table: 'posts',
  schema: zdb.schema({
    id: zdb.id(),
    title: zdb.string({ maxLength: 255 }),
    body: zdb.text({ nullable: true }),
    published: zdb.boolean({ default: false }),
    created_at: zdb.timestamp({ auto: 'create' }),
    updated_at: zdb.timestamp({ auto: 'update' }),
  }),
  admin: {
    enabled: true,
    label: 'Posts',
    icon: 'document',
  },
});
```

Update `config/app.js` to register the model (if not auto-loaded). Default scaffold uses `createDatabase(knexConfig)` which loads `./models`:

Ensure `models/` exists and restart dev server after changes.

Create migration and apply:

```bash
npx webspresso db:make create_posts
npx webspresso db:migrate
```

## 6. Admin panel (about 5 minutes)

Install bcrypt (admin passwords):

```bash
npm install bcrypt
```

Update `config/app.js` to add plugins and database (example — adjust paths to match your scaffold):

```javascript
const path = require('path');
const fs = require('fs');
const { parseEnv } = require('./env.schema');
const { adminPanelPlugin } = require('webspresso/plugins');

function getCreateAppOptions() {
  parseEnv();
  const rootDir = path.resolve(__dirname, '..');
  const options = {
    pagesDir: path.join(rootDir, 'pages'),
    viewsDir: path.join(rootDir, 'views'),
    publicDir: path.join(rootDir, 'public'),
    plugins: [],
  };
  const dbFile = path.join(rootDir, 'webspresso.db.js');
  if (fs.existsSync(dbFile)) {
    const { createDatabase } = require('webspresso');
    options.db = createDatabase(require(dbFile));
    options.plugins.push(
      adminPanelPlugin({
        db: options.db,
        path: '/_admin',
      })
    );
  }
  return options;
}

module.exports = getCreateAppOptions;
```

Run admin migrations and create first admin user:

```bash
npx webspresso admin:setup
```

Follow prompts (email + password). Open [http://localhost:3000/_admin](http://localhost:3000/_admin) and sign in.

You should see **Posts** in the sidebar and be able to create a record.

## 7. Checklist

| Step | URL / command | Expected |
|------|---------------|----------|
| Dev server | `npm run dev` | No startup errors |
| Page | `/hello` | HTML page |
| API | `/api/ping` | JSON `{ ok: true }` |
| Admin | `/_admin` | Login + Posts CRUD |
| Doctor | `webspresso doctor --db` | DB connection OK |

## Next steps

- [Production checklist](production-checklist.md)
- [Version upgrades](migrations/README.md)
- Full reference: [doc/index.html](../doc/index.html) and [README.md](../README.md)
- Example apps: [examples/blog](../examples/blog/), [examples/admin-panel](../examples/admin-panel/)

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Session secret is required` | Set `SESSION_SECRET` in `.env` (32+ chars) |
| Database config not found | Add `webspresso.db.js` or run `webspresso doctor` |
| Admin 404 | Ensure `adminPanelPlugin({ db })` is in `plugins` and `db` is passed to `createApp` |
| Model not in admin | `admin: { enabled: true }` on model; run migrations |

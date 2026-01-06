# Webspresso

A minimal, file-based SSR framework for Node.js with Nunjucks templating.

## Features

- **File-Based Routing**: Create pages by adding `.njk` files to a `pages/` directory
- **Dynamic Routes**: Use `[param]` for dynamic params and `[...rest]` for catch-all routes
- **API Endpoints**: Add `.js` files to `pages/api/` with method suffixes (e.g., `health.get.js`)
- **Schema Validation**: Zod-based request validation for body, params, and query
- **Built-in i18n**: JSON-based translations with automatic locale detection
- **Lifecycle Hooks**: Global and route-level hooks for request processing
- **Template Helpers**: Laravel-inspired helper functions available in templates
- **Plugin System**: Extensible architecture with version control and inter-plugin communication
- **Built-in Plugins**: Development dashboard, sitemap generator, analytics integration (Google, Yandex, Bing)

## Installation

```bash
npm install -g webspresso
# or
npm install webspresso
```

## Quick Start

### Using CLI (Recommended)

```bash
# Create a new project (Tailwind CSS included by default)
webspresso new my-app

# Navigate to project
cd my-app

# Install dependencies
npm install

# Build Tailwind CSS
npm run build:css

# Start development server (watches both CSS and server)
webspresso dev
# or
npm run dev
```

> **Note:** New projects include Tailwind CSS by default. Use `--no-tailwind` flag to skip it.

## CLI Commands

### `webspresso new <project-name>`

Create a new Webspresso project with Tailwind CSS (default).

```bash
webspresso new my-app

# Auto install dependencies and build CSS
webspresso new my-app --install

# Without Tailwind
webspresso new my-app --no-tailwind
```

Options:
- `-i, --install` - Auto run `npm install` and `npm run build:css`
- `--no-tailwind` - Skip Tailwind CSS setup

The project includes:
- Tailwind CSS with build process
- Optimized layout template with navigation and footer
- Responsive starter page
- i18n setup (en/tr)
- Development and production scripts

### `webspresso page`

Add a new page to your project (interactive prompt).

```bash
webspresso page
```

The CLI will ask you:
- Route path (e.g., `/about` or `/blog/post`)
- Whether to add a route config file
- Whether to add locale files

### `webspresso api`

Add a new API endpoint (interactive prompt).

```bash
webspresso api
```

The CLI will ask you:
- API route path (e.g., `/api/users` or `/api/users/[id]`)
- HTTP method (GET, POST, PUT, PATCH, DELETE)

### `webspresso dev`

Start development server with hot reload.

```bash
webspresso dev
# or with custom port
webspresso dev --port 3001
```

### `webspresso start`

Start production server.

```bash
webspresso start
# or with custom port
webspresso start --port 3000
```

### `webspresso add tailwind`

Add Tailwind CSS to your project with build process.

```bash
webspresso add tailwind
```

This command will:
- Install Tailwind CSS, PostCSS, and Autoprefixer as dev dependencies
- Create `tailwind.config.js` and `postcss.config.js`
- Create `src/input.css` with Tailwind directives
- Add build scripts to `package.json`
- Update your layout to use the built CSS instead of CDN
- Create `public/css/style.css` for the compiled output

After running this command:
```bash
npm install
npm run build:css      # Build CSS once
npm run watch:css      # Watch and rebuild CSS on changes
npm run dev            # Starts both CSS watch and dev server
```

## Project Structure

Create your app with this structure:

```
my-app/
├── pages/
│   ├── locales/          # Global i18n translations
│   │   ├── en.json
│   │   └── tr.json
│   ├── _hooks.js         # Global lifecycle hooks
│   ├── index.njk         # Home page (GET /)
│   ├── about/
│   │   ├── index.njk     # About page (GET /about)
│   │   └── locales/      # Route-specific translations
│   ├── tools/
│   │   ├── index.njk     # Tools list (GET /tools)
│   │   ├── index.js      # Route config with load()
│   │   ├── [slug].njk    # Dynamic tool page (GET /tools/:slug)
│   │   └── [slug].js     # Route config for dynamic page
│   └── api/
│       ├── health.get.js # GET /api/health
│       └── echo.post.js  # POST /api/echo
├── views/
│   └── layout.njk        # Base layout template
├── public/               # Static files
└── server.js
```

## API

### `createApp(options)`

Creates and configures the Express app.

**Options:**
- `pagesDir` (required): Path to pages directory
- `viewsDir` (optional): Path to views/layouts directory
- `publicDir` (optional): Path to public/static directory
- `logging` (optional): Enable request logging (default: true in development)
- `helmet` (optional): Helmet security configuration
  - `true` or `undefined`: Use default secure configuration
  - `false`: Disable Helmet
  - `Object`: Custom Helmet configuration (merged with defaults)
- `middlewares` (optional): Named middleware registry for routes

**Example with middlewares:**

```javascript
const { createApp } = require('webspresso');

const { app } = createApp({
  pagesDir: './pages',
  viewsDir: './views',
  middlewares: {
    auth: (req, res, next) => {
      if (!req.session?.user) {
        return res.redirect('/login');
      }
      next();
    },
    admin: (req, res, next) => {
      if (req.session?.user?.role !== 'admin') {
        return res.status(403).send('Forbidden');
      }
      next();
    },
    rateLimit: require('express-rate-limit')({ windowMs: 60000, max: 100 })
  }
});
```

Then use in route configs by name:

```javascript
// pages/admin/index.js
module.exports = {
  middleware: ['auth', 'admin'], // Use named middlewares
  load(req, ctx) { ... }
};

// pages/api/data.get.js
module.exports = {
  middleware: ['auth', 'rateLimit'],
  handler: (req, res) => res.json({ data: 'protected' })
};
```

**Custom Error Pages:**

```javascript
const { createApp } = require('webspresso');

const { app } = createApp({
  pagesDir: './pages',
  viewsDir: './views',
  errorPages: {
    // Option 1: Custom handler function
    notFound: (req, res) => {
      res.render('errors/404.njk', { url: req.url });
    },
    
    // Option 2: Template path (rendered with Nunjucks)
    serverError: 'errors/500.njk'
  }
});
```

Error templates receive these variables:
- `404.njk`: `{ url, method }`
- `500.njk`: `{ error, status, isDev }`

**Asset Management:**

Configure asset handling with versioning and manifest support:

```javascript
const { createApp } = require('webspresso');
const path = require('path');

const { app } = createApp({
  pagesDir: './pages',
  viewsDir: './views',
  publicDir: './public',
  assets: {
    // Option 1: Simple versioning (cache busting)
    version: '1.2.3',  // or process.env.APP_VERSION
    
    // Option 2: Manifest file (Vite, Webpack, etc.)
    manifestPath: path.join(__dirname, 'public/.vite/manifest.json'),
    
    // URL prefix for assets
    prefix: '/static'
  }
});
```

Use asset helpers in templates:

```njk
{# Using fsy helpers (auto-resolved) #}
<link rel="stylesheet" href="{{ fsy.asset('/css/style.css') }}">

{# Or generate full HTML tags #}
{{ fsy.css('/css/style.css') | safe }}
{{ fsy.js('/js/app.js', { defer: true, type: 'module' }) | safe }}
{{ fsy.img('/images/logo.png', 'Site Logo', { class: 'logo', loading: 'lazy' }) | safe }}
```

Asset helpers available in `fsy`:
- `asset(path)` - Returns versioned/manifest-resolved URL
- `css(href, attrs)` - Generates `<link>` tag
- `js(src, attrs)` - Generates `<script>` tag
- `img(src, alt, attrs)` - Generates `<img>` tag

**Manifest Support:**

Works with Vite and Webpack manifest formats:

```json
// Vite manifest format (.vite/manifest.json)
{
  "css/style.css": { "file": "assets/style-abc123.css" },
  "js/app.js": { "file": "assets/app-xyz789.js" }
}

// Webpack manifest format
{
  "/css/style.css": "/dist/style.abc123.css",
  "/js/app.js": "/dist/app.xyz789.js"
}
```

**Returns:** `{ app, nunjucksEnv, pluginManager }`

## Plugin System

Webspresso has a built-in plugin system with version control and dependency management.

### Using Plugins

```javascript
const { createApp } = require('webspresso');
const { sitemapPlugin, analyticsPlugin, dashboardPlugin } = require('webspresso/plugins');

const { app } = createApp({
  pagesDir: './pages',
  viewsDir: './views',
  plugins: [
    dashboardPlugin(),  // Dev dashboard at /_webspresso
    sitemapPlugin({
      hostname: 'https://example.com',
      exclude: ['/admin/*', '/api/*'],
      i18n: true,
      locales: ['en', 'tr']
    }),
    analyticsPlugin({
      google: {
        measurementId: 'G-XXXXXXXXXX',
        verificationCode: 'xxxxx'
      },
      yandex: {
        counterId: '12345678',
        verificationCode: 'xxxxx'
      },
      bing: {
        uetId: '12345678',
        verificationCode: 'xxxxx'
      }
    })
  ]
});
```

### Built-in Plugins

**Dashboard Plugin:**
- Development dashboard at `/_webspresso`
- Monitor all routes (SSR pages and API endpoints)
- View loaded plugins and configuration
- Filter and search routes
- Only active in development mode (disabled in production)

```javascript
const { dashboardPlugin } = require('webspresso/plugins');

const { app } = createApp({
  pagesDir: './pages',
  plugins: [
    dashboardPlugin()  // Available at /_webspresso in dev mode
  ]
});
```

Options:
- `path` - Custom dashboard path (default: `/_webspresso`)
- `enabled` - Force enable/disable (default: auto based on NODE_ENV)

**Sitemap Plugin:**
- Generates `/sitemap.xml` from routes automatically
- Excludes dynamic routes and API endpoints
- Supports i18n with hreflang tags
- Generates `/robots.txt`

**Analytics Plugin:**
- Google Analytics (GA4) and Google Ads
- Google Tag Manager
- Yandex.Metrika
- Microsoft/Bing UET
- Facebook Pixel
- Verification meta tags for all services

Template helpers from analytics plugin:

```njk
<head>
  {{ fsy.verificationTags() | safe }}
  {{ fsy.analyticsHead() | safe }}
</head>
<body>
  {{ fsy.analyticsBodyOpen() | safe }}
  ...
</body>
```

Individual helpers: `gtag()`, `gtm()`, `gtmNoscript()`, `yandexMetrika()`, `bingUET()`, `facebookPixel()`, `allAnalytics()`

### Creating Custom Plugins

```javascript
const myPlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  
  // Optional: depend on other plugins
  dependencies: {
    'analytics': '^1.0.0'
  },
  
  // Optional: expose API for other plugins
  api: {
    getData() { return this.data; }
  },
  
  // Called during registration
  register(ctx) {
    // Access Express app
    ctx.app.use((req, res, next) => next());
    
    // Add template helpers
    ctx.addHelper('myHelper', () => 'Hello!');
    
    // Add Nunjucks filters
    ctx.addFilter('myFilter', (val) => val.toUpperCase());
    
    // Use other plugins
    const analytics = ctx.usePlugin('analytics');
  },
  
  // Called after all routes are mounted
  onRoutesReady(ctx) {
    // Access route metadata
    console.log('Routes:', ctx.routes);
    
    // Add custom routes
    ctx.addRoute('get', '/my-route', (req, res) => {
      res.json({ hello: 'world' });
    });
  },
  
  // Called before server starts
  onReady(ctx) {
    console.log('Server ready!');
  }
};

// Use as factory function for configuration
function myPluginFactory(options = {}) {
  return {
    name: 'my-plugin',
    version: '1.0.0',
    _options: options,
    register(ctx) {
      // ctx.options contains the passed options
    }
  };
}
```

## File-Based Routing

### SSR Pages

Create `.njk` files in the `pages/` directory:

| File Path | Route |
|-----------|-------|
| `pages/index.njk` | `/` |
| `pages/about/index.njk` | `/about` |
| `pages/tools/[slug].njk` | `/tools/:slug` |
| `pages/docs/[...rest].njk` | `/docs/*` |

### API Routes

Create `.js` files in `pages/api/` with optional method suffixes:

| File Path | Route |
|-----------|-------|
| `pages/api/health.get.js` | `GET /api/health` |
| `pages/api/echo.post.js` | `POST /api/echo` |
| `pages/api/users/[id].get.js` | `GET /api/users/:id` |

**Basic API Handler:**

```javascript
// pages/api/health.get.js
module.exports = async function handler(req, res) {
  res.json({ status: 'ok' });
};
```

**With Schema Validation:**

```javascript
// pages/api/posts.post.js
module.exports = {
  schema: ({ z }) => ({
    body: z.object({
      title: z.string().min(3).max(100),
      content: z.string(),
      tags: z.array(z.string()).optional()
    }),
    query: z.object({
      draft: z.coerce.boolean().default(false)
    })
  }),

  async handler(req, res) {
    // Validated & parsed data available in req.input
    const { title, content, tags } = req.input.body;
    const { draft } = req.input.query;
    
    // Original req.body, req.query remain untouched
    res.json({ success: true, title, draft });
  }
};
```

**Schema Options:**

| Key | Description |
|-----|-------------|
| `body` | Validates `req.body` (POST/PUT/PATCH) |
| `params` | Validates route parameters (e.g., `:id`) |
| `query` | Validates query string parameters |
| `response` | Response schema (for documentation, not enforced) |

All schemas use [Zod](https://zod.dev) for validation. Invalid requests throw a `ZodError` which can be caught by error handlers.

**Dynamic Route with Params Validation:**

```javascript
// pages/api/users/[id].get.js
module.exports = {
  schema: ({ z }) => ({
    params: z.object({
      id: z.string().uuid()
    }),
    query: z.object({
      fields: z.string().optional()
    })
  }),

  async handler(req, res) {
    const { id } = req.input.params;  // Validated UUID
    const user = await getUser(id);
    res.json(user);
  }
};
```

### Route Config

Add a `.js` file alongside your `.njk` file to configure the route:

```javascript
// pages/tools/index.js
module.exports = {
  // Middleware for this route
  middleware: [(req, res, next) => next()],
  
  // Load data for SSR
  async load(req, ctx) {
    return { tools: await fetchTools() };
  },
  
  // Override meta tags
  meta(req, ctx) {
    return {
      title: 'Tools',
      description: 'Developer tools'
    };
  },
  
  // Route-level hooks
  hooks: {
    beforeLoad: async (ctx) => {},
    afterRender: async (ctx) => {}
  }
};
```

## i18n

### Global Translations

Add JSON files to `pages/locales/`:

```json
// pages/locales/en.json
{
  "nav": {
    "home": "Home",
    "about": "About"
  }
}
```

### Route-Specific Translations

Add a `locales/` folder inside any route directory to override global translations.

### Using Translations

In templates:

```nunjucks
<h1>{{ t('nav.home') }}</h1>
```

## Template Helpers

The `fsy` object is available in all templates:

```nunjucks
{# URL helpers #}
{{ fsy.url('/tools', { page: 1 }) }}
{{ fsy.fullUrl('/tools') }}
{{ fsy.route('/tools/:slug', { slug: 'test' }) }}

{# Request helpers #}
{{ fsy.q('page', 1) }}
{{ fsy.param('slug') }}
{{ fsy.hdr('User-Agent') }}

{# Utility helpers #}
{{ fsy.slugify('Hello World') }}
{{ fsy.truncate(text, 100) }}
{{ fsy.prettyBytes(1024) }}
{{ fsy.prettyMs(5000) }}

{# Environment #}
{% if fsy.isDev() %}Dev mode{% endif %}

{# SEO #}
{{ fsy.canonical() }}
{{ fsy.jsonld(schema) | safe }}
```

## Lifecycle Hooks

### Global Hooks

Create `pages/_hooks.js`:

```javascript
module.exports = {
  onRequest(ctx) {},
  beforeLoad(ctx) {},
  afterLoad(ctx) {},
  beforeRender(ctx) {},
  afterRender(ctx) {},
  onError(ctx, err) {}
};
```

### Hook Execution Order

1. Global `onRequest`
2. Route `onRequest`
3. Route `beforeMiddleware`
4. Route middleware
5. Route `afterMiddleware`
6. Route `beforeLoad`
7. Route `load()`
8. Route `afterLoad`
9. Route `beforeRender`
10. Nunjucks render
11. Route `afterRender`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Environment |
| `DEFAULT_LOCALE` | `en` | Default locale |
| `SUPPORTED_LOCALES` | `en` | Comma-separated locales |
| `BASE_URL` | `http://localhost:3000` | Base URL for canonical URLs |

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## License

MIT

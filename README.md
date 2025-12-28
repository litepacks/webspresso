# Webspresso

A minimal, file-based SSR framework for Node.js with Nunjucks templating.

## Features

- **File-Based Routing**: Create pages by adding `.njk` files to a `pages/` directory
- **Dynamic Routes**: Use `[param]` for dynamic params and `[...rest]` for catch-all routes
- **API Endpoints**: Add `.js` files to `pages/api/` with method suffixes (e.g., `health.get.js`)
- **Built-in i18n**: JSON-based translations with automatic locale detection
- **Lifecycle Hooks**: Global and route-level hooks for request processing
- **Template Helpers**: Laravel-inspired helper functions available in templates

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

**Returns:** `{ app, nunjucksEnv }`

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

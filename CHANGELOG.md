# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Site Analytics Plugin (New)
- **Self-hosted Analytics**: Privacy-first page view tracking with no external dependencies
- **Tracking Middleware**: Non-blocking Express middleware that records page views asynchronously
- **Bot Detection**: 40+ user-agent patterns (Googlebot, GPTBot, curl, Python, WhatsApp, etc.)
- **Country Detection**: Automatic country identification via CDN headers (Cloudflare, Vercel) with Accept-Language fallback
- **IP Hashing**: Privacy-first design - IP addresses are SHA-256 hashed before storage
- **Session Tracking**: Cookie-free visitor fingerprinting (IP + User-Agent hash) with 30-minute session windows
- **Auto-migration**: `analytics_page_views` table created automatically on first request
- **Admin Dashboard Page**: Full analytics page in the admin panel with:
  - Summary cards (views, visitors, unique pages, sessions)
  - Views over time chart (Chart.js line chart with daily breakdown)
  - Bot activity list with horizontal bar visualization
  - Top pages ranked by view count (scrollable, max-height container)
  - Recent activity feed with country flags and timestamps (scrollable, max-height container)
  - Country statistics with flag emojis and distribution bars
  - Date range filter (Last 7 / 30 / 90 days)
- **6 API Endpoints**: `/stats`, `/views-over-time`, `/top-pages`, `/bot-activity`, `/countries`, `/recent`
- **Database Agnostic**: Works with SQLite, PostgreSQL, and MySQL via Knex
- **Configurable**: `excludePaths`, `trackBots`, custom `tableName` options

#### Admin Panel Extensibility
- **Plugin API**: Admin panel now exposes `api` property for inter-plugin communication (`getRegistry()`, `getAdminPath()`, `serveAdminPanel`, `requireAuth`, `optionalAuth`)
- **Client Components**: New `registerClientComponent(pageId, jsCode)` method on registry for injecting custom Mithril.js page components from external plugins
- **Dynamic Page Routing**: Mithril.js router now automatically creates routes for custom pages registered via the registry
- **`hasClientComponent` Flag**: `toClientConfig()` includes `hasClientComponent` field for each page

#### Admin Module Registration System (New)
- **`registerModule(config)` API**: Declarative method on admin panel API for registering pages, menu items, API routes, widgets, and menu groups in a single call
- **Pages**: Register custom admin pages with optional Mithril.js client component code; SPA routes are created automatically
- **Menu Items & Groups**: Register sidebar menu items and collapsible groups
- **API Routes**: Define API endpoints with configurable prefix, HTTP methods, and per-route auth control (`auth: true/false`)
- **Widgets**: Register dashboard widgets with data loaders
- **Config Validation**: Clear error messages for missing or invalid configuration fields
- **Non-breaking**: Existing manual registry/route registration APIs remain fully supported; `registerModule` is a convenience layer on top
- **Site Analytics Refactored**: `site-analytics` plugin now uses `registerModule` internally, reducing ~20 lines of boilerplate to a single declarative config object

#### ctx.db - Database Access in Plugins and Pages
- **Plugin Context**: `ctx.db` available in `register(ctx)` and `onRoutesReady(ctx)` when `createApp({ db })` is used
- **Page load/meta**: `ctx.db` passed to `load(req, ctx)` and `meta(req, ctx)` in SSR route configs
- **No imports required**: Plugins and pages access the database through context without importing `createDatabase` or passing db in plugin options
- **Nullable**: `ctx.db` is `null` when db is not passed to createApp — check `if (ctx.db)` before use

#### Admin Panel - Mobile Responsive Sidebar
- **Hamburger Menu**: Mobile header with hamburger button for sidebar toggle on small screens
- **Slide-in Sidebar**: Sidebar slides in from the left with `translate-x` animation on mobile
- **Backdrop Overlay**: Semi-transparent dark overlay behind sidebar when open on mobile
- **Close Button**: X button in sidebar header for closing on mobile (visible only on `< lg`)
- **Auto-close on Navigation**: Sidebar automatically closes when a menu item is clicked
- **Responsive Layout**: Main content area uses `lg:ml-64` (desktop sidebar offset) and `pt-20` (mobile header offset) for proper responsive spacing
- **Z-index Layering**: Proper stacking order - mobile header (z-20), backdrop (z-30), sidebar (z-40)

#### Sitemap Plugin v2.0 - Dynamic Database Content
- **Dynamic Sources**: Generate sitemap URLs from database records using `dynamicSources` option
- **Model-based URLs**: Automatically fetch records from ORM models and generate URLs
- **Custom Query Support**: Use custom query functions for complex filtering and joins
- **URL Pattern Placeholders**: Support for `:param` and `[param]` style placeholders
- **Field Mapping**: Map URL placeholders to different database field names
- **Filter Function**: Filter which records appear in sitemap
- **Transform Function**: Transform records before URL generation
- **Caching**: Configurable cache with `cacheMaxAge` option (default: 5 minutes)
- **Cache Invalidation**: `api.invalidateCache()` method for manual cache clearing
- **New API Methods**: `addDynamicSource()`, `getDynamicSources()`, `invalidateCache()`
- **Per-source i18n Control**: Disable i18n for specific sources with `i18n: false`

#### Server Enhancements
- **Request Timeout**: Added `connect-timeout` middleware with configurable timeout (default: 30s)
- **Timeout Options**: `timeout` option in `createApp()` to configure or disable request timeout
- **Timeout Error Pages**: Custom 503 error page support via `errorPages.timeout`
- **Graceful Timeout Handling**: Proper request termination with `haltOnTimedout` helper

#### Script Injection System
- **ScriptInjector Class**: New class for managing dynamic content injection into templates
- **Head Injection**: `fsy.injectHead()` helper to inject content into `<head>` section
- **Body Injection**: `fsy.injectBody()` helper to inject content at end of `<body>`
- **Style Injection**: Inject CSS styles dynamically from plugins
- **Priority Sorting**: Content sorted by priority (higher priority first)
- **Plugin API**: `ctx.injectHead()`, `ctx.injectBody()`, `ctx.injectStyle()` methods for plugins

#### Dev Toolbar
- **Development Toolbar**: Fixed toolbar at bottom of page in development mode
- **Quick Links**: Default links to Dashboard, Admin Panel, Schema Explorer
- **Plugin Registration**: Plugins can register custom links via `ctx.registerDevLink()`
- **Hover Expand**: Toolbar expands on hover, minimized by default
- **Modern Design**: Dark theme with gradient background and smooth animations
- **Auto-hide in Production**: Toolbar automatically hidden in production mode

#### Admin Panel Filter Redesign
- **Descriptive Filter Operators**: Changed symbols (~, =, >, etc.) to readable text (Contains, Equals, Greater than)
- **Quick Filters Bar**: Search input and "All Filters" button above table
- **Filter Drawer**: Slide-in panel for advanced filtering options
- **Boolean Filter UI**: Radio buttons (Yes/No/Any) for boolean field filtering
- **Active Filters Display**: Badge-style display of currently applied filters

#### SEO Checker Plugin (New)
- **Client-side SEO Analysis**: Inspired by django-check-seo, performs 40+ SEO checks in browser
- **7 Check Categories**: Meta, Headings, Content, Links, Images, Structured Data, URL
- **Meta Checks**: Title/description length, canonical, viewport, robots, charset, language
- **Heading Checks**: H1 existence/uniqueness, heading hierarchy, non-empty headings
- **Content Checks**: Word count, paragraph structure, keyword usage and placement
- **Link Checks**: Internal/external links, nofollow analysis, anchor text quality
- **Image Checks**: Alt text, descriptive alt, dimensions, lazy loading
- **Structured Data Checks**: Open Graph, Twitter Card, JSON-LD, hreflang
- **URL Checks**: Length, depth, readability, HTTPS
- **Score Calculation**: Overall SEO score (0-100) based on weighted checks
- **Dev Toolbar Integration**: "SEO Check" button in dev toolbar
- **Floating Panel**: Beautiful dark-themed floating panel with category tabs
- **Configurable Settings**: Customize thresholds for title length, word count, etc.
- **Auto-disabled in Production**: Only active in development mode

### Fixed

#### ORM Boolean Field Handling
- **SQLite Boolean Coercion**: Fixed `z.boolean()` validation failing with SQLite's 0/1 values
- **String Boolean Support**: Added support for string values ('true', 'false', '0', '1')
- **Preprocess Integration**: Used `z.preprocess()` for automatic type conversion before validation

### Changed
- **Sitemap Plugin Version**: Bumped to 2.0.0 with breaking changes in dynamic URL handling

#### W-Runtime (Experimental)
- **Resumability**: Zero JavaScript execution on page load, islands hydrate lazily on first interaction
- **Event Delegation**: Only 3 global event listeners (click, input, submit) instead of N listeners per element
- **Lazy Hydration**: Islands hydrate only when needed, unused islands never load
- **Attribute-based bindings**: `w-root`, `w-model`, `w-text`, `w-show`, `w-hide`, `w-disabled`, `w-on:click`, `w-on:submit`
- **Backend-driven configuration**: Island state and actions defined server-side as JSON descriptors
- **Descriptor-based actions**: `apiCall` action type for declarative API calls
- **SSR-friendly**: Config embedded as JSON in HTML, initial values rendered server-side
- **Runtime API**: `w.resume()`, `w.init()`, `w.hydrate()`, `w.getStats()` methods
- **Performance**: ~6.6x faster Time to Interactive (TTI), ~20x less initial JS execution

#### Template Helpers
- **dayjs integration**: Added dayjs as a core dependency for date/time manipulation in templates
- **Date helpers**: `fsy.date()`, `fsy.dateFormat()`, `fsy.dateFromNow()`, `fsy.dateAgo()`, `fsy.dateUntil()`
- **Date comparison**: `fsy.dateIsBefore()`, `fsy.dateIsAfter()`, `fsy.dateIsSame()`
- **Date arithmetic**: `fsy.dateAdd()`, `fsy.dateSubtract()`, `fsy.dateDiff()`
- **Date utilities**: `fsy.dateStartOf()`, `fsy.dateEndOf()`
- **Full dayjs API**: Access full dayjs functionality via `fsy.date()` which returns a dayjs instance
- **Plugins included**: relativeTime, utc, timezone, customParseFormat

#### CLI Enhancements
- **Interactive project creation**: `webspresso new` command now accepts optional project name
- **Current directory installation**: Prompt to install in current directory when no project name provided
- **Project name validation**: Interactive prompts for project name when using current directory
- **Better error handling**: Warnings when current directory is not empty or already contains Webspresso project
- **Interactive installation flow**: After project creation, prompts to install dependencies and build CSS
- **Auto dev server start**: Option to automatically start development server after installation
- **CSS watch integration**: Dev server automatically includes `watch:css` when Tailwind is enabled
- **Seed CLI command**: `webspresso seed` command for existing projects to run database seeders
- **Seed setup option**: `--setup` flag to automatically create seed files if they don't exist
- **Automatic seed execution**: Seed command automatically loads models and generates fake data
- **Database selection**: Interactive prompt to select database (SQLite, PostgreSQL, MySQL) during project creation
- **Database driver installation**: Automatically adds appropriate database driver (`better-sqlite3`, `pg`, `mysql2`) to `package.json`
- **Database config generation**: Creates `webspresso.db.js` with proper configuration for selected database
- **Migrations directory**: Automatically creates `migrations/` directory when database is selected
- **Models directory**: Automatically creates `models/` directory when database is selected
- **Seed data generation**: Interactive prompt to generate seed data based on existing models
- **Automatic seed setup**: When seed is selected, adds `@faker-js/faker` dependency and creates `seeds/index.js` with auto-detection
- **Seed script**: Adds `npm run seed` command to `package.json` for easy seed execution
- **Smart model detection**: Seed script automatically loads all models from `models/` directory and generates fake data
- **DATABASE_URL in .env.example**: Adds appropriate `DATABASE_URL` template to `.env.example` based on selected database
- **Streamlined workflow**: `webspresso new` → database selection → seed setup → install → build → dev server (with CSS watch) in one flow
- **--install flag enhancement**: Now also prompts for dev server start (previously only installed dependencies)

#### Documentation
- **W-Runtime documentation**: Complete guide with examples, resumability explanation, and limitations
- **CLI documentation**: Updated `new` command documentation with interactive mode examples

#### Testing
- **W-Runtime unit tests**: 41 comprehensive tests covering path utilities, island hydration, action descriptors, and integration scenarios
- **CLI test updates**: Tests for interactive mode, optional parameters, and error handling

### Changed

- **CLI `new` command**: Project name parameter is now optional (`[project-name]` instead of `<project-name>`)
- **README**: Added W-Runtime section with resumability explanation and performance metrics

### Technical Details

#### W-Runtime Implementation
- **File**: `public/w-runtime.js` (~515 lines)
- **Resumability pattern**: Inspired by Qwik framework
- **Island cache**: WeakMap-based for garbage collection friendly storage
- **Event delegation**: Single global listener per event type with `closest()` traversal
- **State management**: Simple object-based state with path resolution (`state.a`, `state.user.name`)
- **Rerender strategy**: Full rerender on any state change (no dependency tracking in v0)

#### Performance Metrics
| Metric | Before (Hydration) | After (Resumability) | Improvement |
|--------|-------------------|---------------------|-------------|
| Time to Interactive | ~100ms | ~15ms | **6.6x faster** |
| Initial JS Execution | 40ms | 2ms | **20x faster** |
| Event Listeners | 50+ | 3 | **17x fewer** |
| Memory (10 islands) | ~500KB | ~50KB* | **10x less** |

*Only hydrated islands consume memory

## [0.0.7] - 2025-01-07

### Added
- File-based routing with dynamic routes (`[param]`, `[...rest]`)
- API endpoints with method suffixes (`.get.js`, `.post.js`, etc.)
- Zod-based request validation for body, params, and query
- Built-in i18n with JSON-based translations
- Lifecycle hooks (global and route-level)
- Template helpers (Laravel-inspired)
- Plugin system with version control
- Built-in plugins: dashboard, sitemap, analytics
- ORM with Knex integration
- Database migrations CLI commands
- Schema explorer plugin

### Changed
- Initial release structure

---

## Version History

- **0.0.7**: Core framework with routing, ORM, plugins
- **Unreleased**: W-Runtime (experimental), CLI improvements, site analytics plugin, admin panel extensibility

---

## Notes

- W-Runtime is in **experimental** stage. API may change without notice.
- Resumability requires SSR to render initial values in HTML for immediate display.
- Interactive CLI mode requires terminal input, automated testing is limited.

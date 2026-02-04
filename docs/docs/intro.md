---
sidebar_position: 1
---

# Introduction

Webspresso is a minimal, production-ready SSR (Server-Side Rendering) framework for Node.js with file-based routing, Nunjucks templating, built-in i18n, and comprehensive CLI tooling.

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
- **ORM**: Minimal, Eloquent-inspired ORM built on Knex with Zod schemas as the single source of truth

## Philosophy

Webspresso follows a "convention over configuration" approach, allowing you to build production-ready applications with minimal boilerplate. The framework is designed to be:

- **Simple**: File-based routing means no route configuration files
- **Flexible**: Plugin system allows extending functionality without modifying core
- **Type-Safe**: Zod schemas provide runtime validation and type inference
- **Developer-Friendly**: CLI tools automate common tasks and provide helpful scaffolding

## Quick Example

```javascript
// pages/index.njk
<h1>Welcome to {{ t('app.name') }}</h1>
<p>Current time: {{ fsy.date().format('YYYY-MM-DD HH:mm') }}</p>
```

```javascript
// pages/api/users.get.js
module.exports = {
  schema: ({ z }) => ({
    query: z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(10),
    }),
  }),
  
  async handler(req, res) {
    const { page, limit } = req.input.query;
    const users = await db.getRepository('User')
      .query()
      .paginate(page, limit);
    
    res.json(users);
  },
};
```

## What's Next?

- [Installation Guide](/getting-started/installation) - Get Webspresso installed
- [Quick Start](/getting-started/quick-start) - Create your first app
- [Project Structure](/getting-started/project-structure) - Understand the file layout

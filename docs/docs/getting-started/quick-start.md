---
sidebar_position: 2
---

# Quick Start

Create your first Webspresso application in minutes.

## Create a New Project

Use the CLI to scaffold a new project:

```bash
webspresso new my-app
```

This command will:

- Create a new directory with the project structure
- Set up Tailwind CSS (by default)
- Configure i18n with English and Turkish locales
- Create a basic layout and home page
- Set up development and production scripts

### Project Creation Options

```bash
# Create in current directory (interactive)
webspresso new

# Auto install dependencies and build CSS
webspresso new my-app --install

# Skip Tailwind CSS setup
webspresso new my-app --no-tailwind
```

### Interactive Setup

When you run `webspresso new` without arguments, you'll be prompted for:

1. **Install location**: Current directory or new directory
2. **Project name**: For `package.json`
3. **Database**: Choose SQLite, PostgreSQL, or MySQL (optional)
4. **Seed data**: Generate fake data for testing (optional)
5. **Dependencies**: Install npm packages automatically
6. **Dev server**: Start development server immediately

## Install Dependencies

If you didn't use `--install`, install dependencies manually:

```bash
cd my-app
npm install
```

## Build CSS (if using Tailwind)

If Tailwind CSS is included, build the CSS:

```bash
npm run build:css
```

## Start Development Server

Start the development server with hot reload:

```bash
webspresso dev
# or
npm run dev
```

The server will start at `http://localhost:3000` by default.

## Your First Page

Create a new page by adding a file to `pages/`:

```njk
{# pages/about/index.njk #}
{% extends "layout.njk" %}

{% block content %}
<h1>About Us</h1>
<p>This is the about page.</p>
{% endblock %}
```

The page will be available at `/about` automatically.

## Your First API Endpoint

Create an API endpoint:

```javascript
// pages/api/hello.get.js
module.exports = async function handler(req, res) {
  res.json({ message: 'Hello from Webspresso!' });
};
```

The endpoint will be available at `GET /api/hello`.

## Next Steps

- [Learn about project structure](/getting-started/project-structure)
- [Explore file-based routing](/routing/file-based-routing)
- [Set up database and ORM](/database/overview)

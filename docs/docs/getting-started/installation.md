---
sidebar_position: 1
---

# Installation

Install Webspresso globally to use the CLI, or locally in your project.

## Global Installation (Recommended)

Install Webspresso globally to use the CLI commands from anywhere:

```bash
npm install -g webspresso
```

After installation, verify it works:

```bash
webspresso --version
```

## Local Installation

You can also install Webspresso as a dependency in your project:

```bash
npm install webspresso
```

Then use it via `npx`:

```bash
npx webspresso new my-app
```

## Requirements

- **Node.js**: >= 18.0.0
- **npm**: >= 8.0.0 (or yarn/pnpm equivalent)

## Database Drivers (Optional)

If you plan to use the ORM, install the appropriate database driver as a peer dependency:

```bash
# PostgreSQL
npm install pg

# MySQL
npm install mysql2

# SQLite (recommended for development)
npm install better-sqlite3
```

## Next Steps

Once installed, you can:

- [Create a new project](/getting-started/quick-start) using `webspresso new`
- [Learn about project structure](/getting-started/project-structure)
- [Explore CLI commands](/cli/overview)

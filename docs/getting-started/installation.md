---
title: Installation
description: Node.js requirements, CLI setup, package installation, and optional database drivers.
---

# Installation & Setup

> **Target Audience:** New developers setting up Webspresso for the first time.  
> **Prerequisites:** Node.js 20 LTS or higher (`node -v`).

---

## 1. Prerequisites

Webspresso requires **Node.js 20 LTS or higher**. The native addons (`better-sqlite3`, `sharp`, `bcrypt`) and native streaming features are optimized for Node.js LTS releases.

Check your current Node.js version:

```bash
node -v
# Should output v20.x.x or higher
```

If you use `nvm` (Node Version Manager), switch to Node 20:

```bash
nvm use 20
# or if .nvmrc is present
nvm use
```

---

## 2. Quick Start with `npx` (Recommended)

You do not need to install Webspresso globally. You can scaffold a new project directly with `npx`:

```bash
npx webspresso new my-app --install
```

This interactive command:
1. Prompts for database driver selection (SQLite, PostgreSQL, MySQL, or None).
2. Generates the standard project directory structure.
3. Automatically runs `npm install` and compiles Tailwind CSS (`npm run build:css`).
4. Offers to start the development server immediately.

Navigate to your new project:

```bash
cd my-app
npm run dev
```

Your application is now running at **`http://localhost:7331`**.

---

## 3. Global CLI Installation

If you frequently create Webspresso applications or use the CLI management tools across multiple repositories:

```bash
# Using npm
npm install -g webspresso

# Using pnpm
pnpm add -g webspresso

# Using yarn
yarn global add webspresso
```

Verify the global installation:

```bash
webspresso --help
```

---

## 4. Manual Package Installation

If you are adding Webspresso to an existing Node.js project:

```bash
npm install webspresso
```

> **Note:** Express, Nunjucks, Knex, Zod, and Session management are built directly into Webspresso as bundled dependencies. You do not need to install them separately.

Add optional database drivers or features as needed for your project:

```bash
# For SQLite database support (local / embedded)
npm install better-sqlite3

# For PostgreSQL database support
npm install pg

# For MySQL database support
npm install mysql2

# For image processing in file uploads (optional)
npm install sharp
```

> **Authentication Note:** Session management (`req.session`), JWT tokens (`core/auth/jwt`), and access control (`req.auth`) are handled natively by Webspresso. You do **not** need to install `express-session`, `connect-sqlite3`, or `passport`.

---

## 5. TypeScript Support

Webspresso ships with first-class TypeScript definitions bundled directly in the package via `index.d.ts`. No external `@types/webspresso` package is required.

To use TypeScript in your application:

```bash
npm install --save-dev typescript @types/node @types/express
```

Import public contracts and types directly:

```typescript
import { createApp, defineModel, defineService, zdb, type WebspressoApplication } from 'webspresso';
```

---

## Next Steps

- Proceed to **[Creating Your First App](first-app.md)** to build your first SSR page and API endpoint.
- Explore the **[Project Structure](project-structure.md)** to understand how Webspresso organizes files.

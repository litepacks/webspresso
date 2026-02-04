---
sidebar_position: 2
---

# webspresso new

Create a new Webspresso project with Tailwind CSS (default).

## Usage

```bash
# Create in a new directory
webspresso new my-app

# Create in current directory (interactive)
webspresso new

# Auto install dependencies and build CSS
webspresso new my-app --install

# Without Tailwind
webspresso new my-app --no-tailwind
```

## Options

| Option | Description |
|--------|-------------|
| `-i, --install` | Auto run `npm install` and `npm run build:css` (non-interactive) |
| `--no-tailwind` | Skip Tailwind CSS setup |

## Interactive Mode

When run without arguments, `webspresso new` enters interactive mode:

1. **Install location**: Choose current directory or create new one
2. **Project name**: Enter name for `package.json`
3. **Database**: Select database (SQLite, PostgreSQL, MySQL) or skip
4. **Seed data**: Generate fake data for testing
5. **Dependencies**: Install npm packages automatically
6. **Dev server**: Start development server immediately

## What Gets Created

The command creates:

- Project structure with `pages/`, `views/`, `public/` directories
- Tailwind CSS configuration (unless `--no-tailwind`)
- i18n setup with English and Turkish locales
- Basic layout template (`views/layout.njk`)
- Home page (`pages/index.njk`)
- Development and production scripts in `package.json`

## Database Setup

If you choose to use a database:

- Appropriate driver is added to `package.json` (better-sqlite3, pg, or mysql2)
- `webspresso.db.js` config file is created
- `migrations/` directory is created
- `models/` directory is created
- `DATABASE_URL` is added to `.env.example`

## Seed Data

If you enable seed data generation:

- `@faker-js/faker` is added to dependencies
- `seeds/` directory is created with `seeds/index.js`
- `npm run seed` script is added to `package.json`

The seed script automatically detects models and generates fake data based on their schemas.

## Examples

```bash
# Quick start with auto-install
webspresso new my-blog --install

# Create without Tailwind
webspresso new my-api --no-tailwind

# Interactive setup
webspresso new
```

## Next Steps

After creating a project:

- [Add pages](/cli/page)
- [Start development server](/cli/dev-start)
- [Set up database](/database/overview)

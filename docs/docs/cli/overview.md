---
sidebar_position: 1
---

# CLI Commands Overview

Webspresso provides a comprehensive CLI for scaffolding projects, managing pages, and working with databases.

## Available Commands

| Command | Description |
|---------|-------------|
| `webspresso new` | Create a new project |
| `webspresso page` | Add a new page |
| `webspresso api` | Add a new API endpoint |
| `webspresso dev` | Start development server |
| `webspresso start` | Start production server |
| `webspresso add tailwind` | Add Tailwind CSS to project |
| `webspresso db:migrate` | Run pending migrations |
| `webspresso db:rollback` | Rollback migrations |
| `webspresso db:status` | Show migration status |
| `webspresso db:make` | Create a new migration |
| `webspresso seed` | Run database seeds |
| `webspresso admin:setup` | Set up admin panel |

## Getting Help

Get help for any command:

```bash
webspresso --help
webspresso new --help
webspresso db:migrate --help
```

## Next Steps

- [Create a new project](/cli/new)
- [Add pages and API routes](/cli/page)
- [Database commands](/database/migrations)

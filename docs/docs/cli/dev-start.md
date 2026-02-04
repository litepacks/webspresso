---
sidebar_position: 5
---

# webspresso dev & start

Start the development or production server.

## Development Server

```bash
webspresso dev
# or
webspresso dev --port 3001
```

### Features

- **Hot reload**: Automatically restarts on file changes
- **CSS watching**: Watches and rebuilds Tailwind CSS (if enabled)
- **Request logging**: Logs all incoming requests
- **Error details**: Shows detailed error messages

### Options

| Option | Description |
|--------|-------------|
| `--port <number>` | Custom port (default: 3000) |

## Production Server

```bash
webspresso start
# or
webspresso start --port 3000
```

### Features

- **Optimized**: No file watching or hot reload
- **Caching**: Route configs and templates are cached
- **Error handling**: Production-friendly error pages

### Options

| Option | Description |
|--------|-------------|
| `--port <number>` | Custom port (default: 3000) |

## Environment Variables

Both commands respect these environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Environment mode |
| `PORT` | `3000` | Server port |

## Examples

```bash
# Development on custom port
PORT=3001 webspresso dev

# Production
NODE_ENV=production webspresso start

# Using npm scripts
npm run dev
npm start
```

## Next Steps

- [Learn about project structure](/getting-started/project-structure)
- [Configure your app](/advanced/configuration)

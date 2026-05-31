# Debugging with Webspresso Studio

## Quick workflow

1. Start dev server: `npm run dev`
2. Open [http://localhost:3000/_webspresso](http://localhost:3000/_webspresso)
3. Check **Health** for DB/migrations
4. Use **Routes** to find handler files and auth/schema flags
5. Use **Plugins** for load failures or missing dependencies

## Route inspector

- **Type `api`**: `pages/api/*.js` handlers
- **Type `page`**: SSR `.njk` routes
- **Plugin-owned**: routes registered by plugins (`/_admin`, `/_swagger`, etc.)
- **Auth**: middleware list includes `auth`
- **Schema**: Zod validation on API handler export

Filter with query params on `/routes?method=get&type=api&auth=1`.

## Plugin inspector

Status badges:

- **loaded** — registered successfully
- **failed** — `register()` threw or dependency validation failed

Check **hooks** to see which lifecycle methods a plugin implements.

## Request timeline

When `studio.requestTimeline.enabled` (default in dev), the last 100 requests are stored in memory.

Interpretation:

- High **durationMs** — slow handler or template
- High **dbQueryCount** — N+1 or missing cache
- **status >= 500** — check server logs and **Logs** page

## Slow queries

Set `studio.slowQueryThresholdMs` (default 500). Future timeline entries can flag queries above this threshold when Knex query hooks are active.

## OpenAPI coverage

**OpenAPI** page shows schema coverage percentage. Low coverage means add Zod `schema` exports on API handlers or enable `swaggerPlugin`.

## When Studio is not enough

- Run `webspresso doctor --db --strict`
- Use `logging: true` on `createApp` for console request lines
- Production issues: never rely on Studio alone — use health probes and APM

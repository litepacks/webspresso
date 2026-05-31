# Studio security

## Defaults

| Environment | Studio | Auth |
|-------------|--------|------|
| development | on | `dev-only` (no extra gate) |
| test | off | — |
| production | off | — |

## Production rules

1. `studio.enabled: true` in production **requires** `auth: 'basic'` with `basicAuth` credentials.
2. `auth: 'none'` or `auth: 'dev-only'` in production causes **startup failure**.
3. Disabled Studio returns **404** for all paths under `studio.path` (not 403).

## Environment inspector

- Keys matching `SECRET`, `PASSWORD`, `TOKEN`, `KEY`, `CREDENTIAL`, `DATABASE_URL` are always masked.
- Non-secret values are hidden unless `studio.exposeEnv: true`.
- Prefer presence-only display in shared environments.

## Destructive actions

- Cache clear requires **POST** `/_webspresso/api/cache/clear`.
- GET on that path returns **405**.
- `studio.cacheActions` must be `true`.
- In production, send header `X-Studio-Confirm: 1` or body `{ confirm: 1 }`.

## Network

- Internal Studio APIs do not set CORS headers.
- Use same-origin access only (browser session on your dev machine or VPN).

## vs Admin panel

| | Studio `/_webspresso` | Admin `/_admin` |
|--|----------------------|-----------------|
| Audience | Developers | Operators / content |
| Production | Off by default | Explicit enable |
| Data mutation | No (inspect only) | CRUD |

# Changelog — `webspresso/plugins/polar`

## 1.0.0 — 2026-09-10

First production-ready release.

### Added

- Zero-dependency Polar SDK (`crypto` + `fetch`): webhook verification, API client, checkout, portal, Customer State sync
- Auto routes: webhook, checkout (GET/POST), portal, billing status JSON API
- Idempotent migration generator + `webspresso polar:migrate` CLI
- Configurable field mapping, tier/plan mapping, hooks (`onSubscriptionChange`)
- Optional `polarSyncMiddleware` for page-load tier refresh
- Nunjucks `dateLabel` filter + Date-safe `truncate` wrapper
- CSP helper (`polarCspDirectives`) for checkout form redirects
- Zod env schema export (`parseEnv`, `polarEnvSchema`)

### Production lessons encoded

| Issue | Fix |
|-------|-----|
| Checkout URL is often `https://polar.sh/checkout/polar_cst_*`, not only `buy.polar.sh` | `extractCheckoutUrlFromResponse` + `client_secret` builder |
| `https://polar.sh/purchases/subscriptions` → 404 | Blocked in URL validators |
| `subscription.created` with `incomplete` status | Fallback Customer State sync before granting Pro |
| Metadata may not propagate to subscription | `external_customer_id` required on checkout; multi-strategy user resolver |
| `polar_current_period_end` as Date breaks Nunjucks `truncate` | Always persist ISO strings; `dateLabel` + safe truncate |
| Checkout "already subscribed" API error | Pre-checkout `syncPolarBillingForUser` + early redirect |
| Webhook 401 | Standard Webhooks HMAC (`webhook-id`, `webhook-timestamp`, `whsec_` decode); document raw body requirement |
| Sandbox vs production OAT | `POLAR_SANDBOX=true` → `sandbox-api.polar.sh` |
| Empty metadata fields → Polar 422 | `buildCheckoutMetadata` omits blank values |
| Portal deprecated paths | Validate `/{org}/portal` only; fallback `POST /v1/customer-sessions/` |

### Migration notes for existing custom Polar integrations

- Remove local `utils/polar.js` and file routes under billing/webhook paths — plugin registers equivalent routes
- Run `webspresso polar:migrate` (or `plugin.api.generateMigration()`) once
- Mount `createWebhookRawBodyMiddleware('/api/v1/polar/webhook')` **before** `express.json()` in custom servers for strict signature verification
- Wire `hooks.onSubscriptionChange` if tier updates need side effects (limits, analytics, etc.)

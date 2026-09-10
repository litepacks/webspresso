# Polar.sh Billing Plugin for Webspresso

Production-ready Polar subscription billing for Webspresso. Zero extra dependencies (`crypto` + native `fetch` only).

## Quick start

### 1. Environment

Copy `plugins/polar/.env.example` → `.env`:

```bash
POLAR_ACCESS_TOKEN=polar_oat_...
POLAR_WEBHOOK_SECRET=whsec_...
POLAR_PRO_PRODUCT_ID=<product-uuid-not-price-id>
POLAR_ORG_SLUG=your-org
POLAR_SANDBOX=false
BASE_URL=https://example.com
```

### 2. Migration

```bash
webspresso polar:migrate
webspresso db:migrate
```

### 3. Plugin config (~3 lines)

```js
const { polarPlugin, rateLimitPlugin } = require('webspresso/plugins');
const { quickAuth } = require('webspresso/core/auth');

createApp({
  db,
  auth: quickAuth({ db, jwt: true }),
  plugins: [
    rateLimitPlugin(), // optional but recommended — polar applies per-route limits
    polarPlugin({
      db,
      userModel: 'User',
      plans: { pro_monthly: process.env.POLAR_PRO_PRODUCT_ID },
      tierMapping: { pro: ['pro_monthly'], free: [] },
    }),
  ],
});
```

That's it — routes, webhooks, checkout, portal, and status API are auto-mounted.

### 4. Polar Dashboard webhook

- **URL:** `https://your-domain.com/api/v1/polar/webhook`
- **Format:** Raw (not Slack/Discord)
- **Events:** `customer.state_changed`, `subscription.*`, `order.*`, `checkout.updated`

## Routes (defaults, all configurable)

| Method | Path | Auth | Behavior |
|--------|------|------|----------|
| POST | `/api/v1/polar/webhook` | HMAC signature | Process Polar events |
| GET/POST | `/settings/billing/checkout` | session/JWT | Sync → Polar checkout redirect |
| GET | `/settings/billing/portal` | session/JWT | Customer portal redirect |
| GET | `/api/v1/billing/status` | session/JWT | Sync + JSON billing status |

## Template usage

```njk
{% if user.tier == 'pro' %}
  <p>Pro until {{ user.polar_current_period_end | dateLabel }}</p>
  <a href="/settings/billing/portal">Manage subscription</a>
{% else %}
  <form method="post" action="/settings/billing/checkout">
    <button type="submit">Upgrade to Pro</button>
  </form>
{% endif %}
```

## SDK exports (`plugin.api` or direct imports)

```js
const polar = polarPlugin({ db });
polar.api.verifyPolarWebhook(raw, headers, secret);
polar.api.syncPolarBillingForUser(user, knex);
polar.api.getPolarCheckoutUrl({ user, plan: 'pro_monthly', baseUrl });
polar.api.handlePolarWebhookEvent(event, knex);
polar.api.generateMigration();
polar.api.parseEnv(process.env);
```

## Webhook raw body (production)

For strict HMAC verification, mount **before** `express.json()`:

```js
const { createWebhookRawBodyMiddleware } = require('webspresso/plugins/polar/src/webhooks');

app.use(createWebhookRawBodyMiddleware('/api/v1/polar/webhook'));
app.use(express.json());
```

Without this, the plugin falls back to `JSON.stringify(req.body)` (works for most cases; key order edge cases possible).

## Rate limiting

Enabled by default (`rateLimit: true`). Requires `rateLimitPlugin()` registered **before** `polarPlugin`:

| Route | Default |
|-------|---------|
| Webhook | 120 req/min (by IP) |
| Checkout | 5 req/min (by user) |
| Portal | 10 req/min (by user) |
| Status | 60 req/min (by user) |

```js
polarPlugin({ db, rateLimit: false }); // disable
polarPlugin({ db, rateLimit: { checkout: { limit: 3 } } }); // override
```

## Optional hooks

```js
polarPlugin({
  db,
  hooks: {
    onSubscriptionChange({ user, tier, polarStatus, subscription, knex, update }) {
      // Custom tier logic (default: updates users.* polar columns)
      return knex('users').where('id', user.id).update(update);
    },
  },
  syncMiddleware: {
    when: (req) => req.query.tab === 'billing',
  },
});
```

## CSP (Helmet)

```js
const { polarCspDirectives } = require('webspresso/plugins/polar/src/urls');

createApp({
  helmet: {
    contentSecurityPolicy: {
      directives: {
        ...polarCspDirectives(),
      },
    },
  },
});
```

Or rely on the plugin's built-in `csp` export (auto-merged by plugin manager).

## Non-goals (v1)

- Admin UI (use Polar dashboard)
- Multi-org / team seat billing
- `@polar-sh/sdk` dependency

---
title: Polar Billing
description: Polar.sh subscription billing — checkout, portal, webhooks, tier sync, and rate limits.
---

# Polar.sh Billing Plugin

> **Goal:** Add subscription billing (checkout, customer portal, webhooks, tier sync) to a Webspresso app with minimal configuration — zero extra npm dependencies beyond the framework.

---

## 1. Overview

`polarPlugin` integrates [Polar.sh](https://polar.sh) subscription billing:

- **Checkout** — redirect authenticated users to Polar hosted checkout
- **Customer portal** — manage/cancel subscriptions
- **Webhooks** — HMAC-verified event processing (`customer.state_changed`, `subscription.*`, `order.*`)
- **Customer State sync** — pull active subscription from Polar API (webhook delay fallback)
- **Tier columns** — idempotent migration for `tier`, `polar_*` fields on `users`

Implementation uses native Node.js only (`crypto` + `fetch`) — no `@polar-sh/sdk`.

---

## 2. Quick start

### 2.1 Environment variables

```bash
POLAR_ACCESS_TOKEN=polar_oat_...       # scopes: customers:read, subscriptions:read
POLAR_WEBHOOK_SECRET=whsec_...
POLAR_PRO_PRODUCT_ID=<product-uuid>    # Product UUID, not price ID
POLAR_ORG_SLUG=your-org
POLAR_SANDBOX=false
BASE_URL=https://example.com

# Optional hosted checkout fallback
POLAR_CHECKOUT_URL=https://buy.polar.sh/polar_cl_...
POLAR_PRO_PRICE_ID=...
```

See `plugins/polar/.env.example` for the full list.

### 2.2 Database migration

```bash
webspresso polar:migrate
webspresso db:migrate
```

Generates an idempotent migration adding:

| Column | Type | Default |
|--------|------|---------|
| `tier` | string | `'free'` |
| `polar_customer_id` | string | null |
| `polar_subscription_id` | string | null |
| `polar_status` | string | `'none'` |
| `polar_current_period_end` | string (ISO) | null |
| `polar_cancel_at_period_end` | boolean | `false` |

Field names are configurable via `fields` option (see §5).

### 2.3 Plugin registration

```javascript
const { createApp } = require('webspresso');
const { polarPlugin, rateLimitPlugin } = require('webspresso/plugins');
const { quickAuth } = require('webspresso/core/auth');

const { app } = createApp({
  db,
  auth: quickAuth({ db, jwt: true }),
  plugins: [
    rateLimitPlugin(), // required for polar route limiters (register before polarPlugin)
    polarPlugin({
      db,
      userModel: 'User',
      plans: {
        pro_monthly: process.env.POLAR_PRO_PRODUCT_ID,
      },
      tierMapping: {
        pro: ['pro_monthly'],
        free: [],
      },
    }),
  ],
});
```

Routes are mounted automatically — no manual `pages/api/` handlers required.

### 2.4 Polar Dashboard webhook

| Setting | Value |
|---------|-------|
| URL | `https://your-domain.com/api/v1/polar/webhook` |
| Format | **Raw** (not Slack/Discord) |
| Events | `customer.state_changed`, `subscription.*`, `order.*`, `checkout.updated` |

---

## 3. Auto-mounted routes

All paths are configurable via `routes`:

| Method | Default path | Auth | Behavior |
|--------|--------------|------|----------|
| `POST` | `/api/v1/polar/webhook` | HMAC signature | Process Polar webhook events |
| `GET` / `POST` | `/settings/billing/checkout` | session / JWT | Sync billing → redirect to checkout |
| `GET` | `/settings/billing/portal` | session / JWT | Redirect to customer portal |
| `GET` | `/api/v1/billing/status` | session / JWT | Sync + JSON billing status |

Redirect URLs (`success`, `return`, `already subscribed`) are set via `urls`:

```javascript
polarPlugin({
  db,
  urls: {
    success: '/settings?tab=billing&upgraded=1',
    return: '/settings?tab=billing',
    alreadySubscribed: '/settings?tab=billing&success=already_pro',
    login: '/login?error=required',
  },
});
```

---

## 4. Templates

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

The plugin registers Nunjucks filters:

- `dateLabel` — formats dates as `YYYY-MM-DD` (safe for billing period display)
- `truncate` — Date-aware wrapper (prevents substring errors on `Date` objects)

---

## 5. Configuration reference

```javascript
polarPlugin({
  db,                          // required — createApp({ db }) instance
  userModel: 'User',           // ORM model name
  userTable: 'users',          // override if table differs

  plans: {
    pro_monthly: '<product-uuid>',
    pro_yearly: '<product-uuid>',
  },
  tierMapping: {
    pro: ['pro_monthly', 'pro_yearly'],
    free: [],
  },
  proTierName: 'pro',          // tier string written on upgrade
  freeTierName: 'free',

  routes: {
    webhook: '/api/v1/polar/webhook',
    checkout: '/settings/billing/checkout',
    portal: '/settings/billing/portal',
    status: '/api/v1/billing/status',
  },

  fields: {
    tier: 'tier',
    polarCustomerId: 'polar_customer_id',
    polarSubscriptionId: 'polar_subscription_id',
    polarStatus: 'polar_status',
    polarCurrentPeriodEnd: 'polar_current_period_end',
    polarCancelAtPeriodEnd: 'polar_cancel_at_period_end',
    publicId: 'public_id',
    email: 'email',
    id: 'id',
  },

  syncBeforeCheckout: true,     // Polar API sync before checkout redirect (default true)

  hooks: {
    /** External tier tables: override checkout "already subscribed" check */
    async isPaidUser(user, knex, config) {
      const sub = await knex('subscriptions').where('user_id', user.id).first();
      return sub?.plan_tier === 'pro';
    },
    onSubscriptionChange({ user, tier, polarStatus, subscription, knex, update }) {
      // Custom side effects; default updates user row
      return knex('users').where('id', user.id).update(update);
    },
  },

  requireAuth: customMiddleware,  // override default session/JWT guard

  syncMiddleware: {
    when: (req) => req.query.tab === 'billing',  // page-load sync fallback
  },

  enabled: true,

  rateLimit: true,  // default — uses rateLimitPlugin when loaded; set false to disable
  // rateLimit: {
  //   checkout: { limit: 5, windowMs: 60_000 },
  //   portal: { limit: 10, windowMs: 60_000 },
  //   status: { limit: 60, windowMs: 60_000 },
  //   webhook: { limit: 120, windowMs: 60_000 },
  //   status: false, // disable per-route
  // },
});
```

---

## 6. Rate limiting

Polar routes apply per-route limiters when `rateLimitPlugin` is registered **before** `polarPlugin`:

| Route | Default limit | Key |
|-------|---------------|-----|
| Webhook | 120 / min | IP |
| Checkout | 5 / min | user id (or IP) |
| Portal | 10 / min | user id (or IP) |
| Status | 60 / min | user id (or IP) |

Requires peer dependency `express-rate-limit` (same as `rateLimitPlugin`).

Disable entirely: `polarPlugin({ rateLimit: false })`.

---

## 7. SDK (`plugin.api`)

Access programmatically via `ctx.usePlugin('polar')` or the factory return value:

```javascript
const polar = polarPlugin({ db });

polar.api.verifyPolarWebhook(rawPayload, headers, secret);
polar.api.syncPolarBillingForUser(user, knex);
polar.api.syncBillingForAppUser(user, knex, { hooks }); // dashboard loaders
polar.api.getPolarCheckoutUrl({ user, plan: 'pro_monthly', baseUrl });
polar.api.getPolarPortalUrl(user, baseUrl);
polar.api.handlePolarWebhookEvent(event, knex);
polar.api.resolveUserFromPolarData(data, knex);
polar.api.generateMigration({ tableName: 'users' });
polar.api.parseEnv(process.env);           // Zod-validated env
polar.api.polarCspDirectives();          // Helmet formAction helper
polar.api.createWebhookRawBodyMiddleware('/api/v1/polar/webhook');
polar.api.registerNunjucksFilters(nunjucksEnv);
```

---

## 8. Webhook raw body (production)

For strict HMAC verification, mount raw body capture **before** `express.json()`:

```javascript
const { createWebhookRawBodyMiddleware } = require('webspresso/plugins/polar/src/webhooks');

app.use(createWebhookRawBodyMiddleware('/api/v1/polar/webhook'));
app.use(express.json());
```

Without this, the handler falls back to `JSON.stringify(req.body)` after Express parsing. This works in most cases; key-order mismatches are possible under edge conditions.

---

## 9. CSP (Helmet)

`polarCspDirectives()` includes `'self'` plus Polar checkout domains so local forms (login, register, billing POST) are not blocked.

```javascript
const { mergePolarCspDirectives } = require('webspresso/plugins/polar/src/urls');

createApp({
  helmet: {
    contentSecurityPolicy: {
      directives: mergePolarCspDirectives({
        formAction: ["'self'"],
        scriptSrc: ["'self'"],
      }),
    },
  },
});
```

The plugin object also includes a `csp` property — the plugin manager **unions** sources per directive (does not replace your Helmet config).

---

## 10. CLI

### `webspresso polar:migrate`

Generates an idempotent Polar billing migration file.

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Database config file path |
| `-t, --table <name>` | User table name (default `users`) |
| `-o, --output <path>` | Custom output file path |

---

## 11. Production notes

| Scenario | Plugin behavior |
|----------|-----------------|
| Checkout URL is `https://polar.sh/checkout/polar_cst_*` | Supported via `client_secret` builder |
| `subscription.created` with `incomplete` status | Customer State sync before granting Pro |
| Metadata not copied to subscription | `external_customer_id` on checkout + multi-strategy user resolver |
| `polar_current_period_end` as Date breaks Nunjucks | Stored as ISO string; use `dateLabel` filter |
| Checkout "already subscribed" error | Pre-checkout sync + redirect if already Pro |
| Empty metadata fields | Omitted from checkout payload (Polar 422 prevention) |
| Sandbox vs production | `POLAR_SANDBOX=true` → `sandbox-api.polar.sh` |

---

## 12. Non-goals (v1)

- Admin UI for billing (use Polar dashboard)
- Multi-org / team seat management
- `@polar-sh/sdk` dependency

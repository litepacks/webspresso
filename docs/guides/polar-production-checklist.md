---
title: Polar Billing Production Checklist
description: Pre-launch checklist for Webspresso Polar.sh subscription billing — env, webhooks, rate limits, external tier tables, and CSP.
---

# Polar billing — production checklist

Use this before going live with `polarPlugin`. Each item maps to a common production failure from real integrations.

## Environment

- [ ] **`POLAR_PRO_PRODUCT_ID`** is a **product UUID** from Polar dashboard — not a price ID
- [ ] **`POLAR_ACCESS_TOKEN`** matches environment (production OAT vs sandbox)
- [ ] **`POLAR_WEBHOOK_SECRET`** is set (`whsec_…`) and matches Polar dashboard
- [ ] **`POLAR_ORG_SLUG`** matches your Polar organization slug (portal URLs)
- [ ] **`BASE_URL`** is the canonical public URL (checkout success/return redirects)
- [ ] **`POLAR_SANDBOX=false`** in production (or `sandbox: false` in plugin options)

## Plugin wiring

```javascript
const { polarPlugin, rateLimitPlugin } = require('webspresso/plugins');
const { quickAuth } = require('webspresso/core/auth');

createApp({
  db,
  auth: quickAuth({ db, jwt: true }),
  plugins: [
    rateLimitPlugin(),   // MUST be before polarPlugin
    polarPlugin({ db, plans, tierMapping }),
  ],
});
```

- [ ] **`rateLimitPlugin()` registered before `polarPlugin`** — otherwise Polar rate limiters are skipped (or use `rateLimit: false` intentionally)
- [ ] **`db` passed to `polarPlugin`** (or `createApp({ db })` so ctx.db is available)

## Webhook

- [ ] **Webhook URL** in Polar dashboard: `https://your-domain.com/api/v1/polar/webhook` (or your custom `routes.webhook`)
- [ ] **Raw body middleware** mounted **before** `express.json()` for strict HMAC:

```javascript
const { createWebhookRawBodyMiddleware } = require('webspresso/plugins/polar/src/webhooks');

app.use(createWebhookRawBodyMiddleware('/api/v1/polar/webhook'));
app.use(express.json());
```

- [ ] **Events enabled:** `customer.state_changed`, `subscription.*`, `order.*`, `checkout.updated`

## User ID & metadata

- [ ] **Primary key type:** checkout sends `metadata.user_id` as a **string** (supports nanoid/UUID, not only integers)
- [ ] **`public_id`** populated if you rely on `external_customer_id` fallback
- [ ] Run `webspresso polar:migrate` + `webspresso db:migrate` for Polar columns on `users`

## External subscription table (optional)

If paid tier lives outside `users.tier` (e.g. `subscriptions.plan_tier`):

- [ ] **`hooks.isPaidUser`** — checkout “already subscribed” check
- [ ] **`hooks.onSubscriptionChange`** — write webhooks to your app DB
- [ ] **`syncBeforeCheckout: false`** if Polar API sync would false-positive block checkout

```javascript
polarPlugin({
  db,
  syncBeforeCheckout: false,
  hooks: {
    async isPaidUser({ user, knex }) {
      const sub = await knex('subscriptions').where('user_id', user.id).first();
      return sub?.plan_tier === 'pro';
    },
    async onSubscriptionChange({ user, tier, knex, update }) {
      await knex('subscriptions').where('user_id', user.id).update({ plan_tier: tier });
      return knex('users').where('id', user.id).update(update);
    },
  },
});
```

Dashboard page-load sync:

```javascript
const polar = ctx.usePlugin('polar');
await polar.api.syncBillingForAppUser(user, knex, { hooks: { /* same as above */ } });
```

## Checkout UX

| Method | Use case |
|--------|----------|
| **POST** | HTML `<form method="post">` — requires `form-action` CSP to include `'self'` |
| **GET** | Simple `<a href="…">` links — no form submission, fewer CSP constraints |

Both routes run the same handler (sync → paid check → Polar redirect).

- [ ] **CSP `form-action`** includes `'self'` (built into `polarCspDirectives()`; use `mergePolarCspDirectives()` with Helmet)
- [ ] **Success/return URLs** configured via `urls.success`, `urls.return`, `urls.alreadySubscribed`

## Smoke tests (local)

```bash
node -e "require('webspresso/core/auth'); require('webspresso/plugins/polar/src/webhooks'); console.log('exports OK')"
npm test -- tests/unit/package-exports.test.js tests/integration/polar-production.test.js
```

## Related

- [Polar billing guide](./polar-billing.md)
- [Plugin ecosystem reference](../reference/plugins.md)
- [Plugin README (source)](https://github.com/litepacks/webspresso/blob/current/plugins/polar/README.md)

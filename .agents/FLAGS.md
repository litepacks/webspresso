# Feature Flags & Canary Traffic Splitter (`core/flags`)

Webspresso features an enterprise-grade, zero-dependency **Feature Flag & Canary Traffic Splitting Engine** in `core/flags/`. It enables gradual rollouts, multivariate A/B testing, user/role/domain targeting, and runtime overrides across Nunjucks SSR templates, API endpoints (`defineApi`), service layers, and Edge/Hono adapters.

---

## 🎯 Key Capabilities

1. **Sub-Microsecond Deterministic Bucketing**:
   - FNV-1a 32-bit hashing algorithm (`getBucket`) maps user identifiers to deterministic integer buckets `0 .. 99` across distributed nodes without network calls.
2. **Flexible Targeting Rules**:
   - **Boolean Toggles**: `enabled: true | false`.
   - **Canary Percentage Rollout**: `rollout: 10` (10% of traffic, consistent per user).
   - **Targeted Whitelists**: `users: ['user_123', 'admin@corp.com']`.
   - **Role-Based Targeting**: `roles: ['admin', 'beta_tester']`.
   - **Email Domain Targeting**: `emailDomains: ['acme.com']`.
   - **Multivariate A/B Variants**: `variants: [{ name: 'blue_button', weight: 50 }, { name: 'green_button', weight: 50 }]`.
   - **Custom Predicates**: `condition: (ctx) => ctx.plan === 'enterprise'`.
3. **Multi-Layer Integration**:
   - **Express / Hono Middleware**: Automatically injects `req.flags`, `req.hasFeature()`, and `req.getVariant()`.
   - **Nunjucks SSR Templates**: Access via `{{ fsy.hasFeature('new_ui') }}` and `{{ fsy.flag('theme') }}`.
   - **Declarative API Route Guard**: `defineApi({ flag: 'beta_feature' })` returns HTTP 404 (or configured status) if disabled.
   - **Environment Variable Overrides**: Instant runtime overrides via `FEATURE_<FLAG_NAME>=true|false`.

---

## 🚀 Quick Start

### 1. Application Configuration

```javascript
const { createApp } = require('webspresso');

const app = createApp({
  flags: {
    // 1. Simple toggle
    dark_mode: true,

    // 2. 20% Canary rollout
    new_checkout: {
      rollout: 20,
    },

    // 3. User & Role targeting
    ai_assistant: {
      roles: ['pro', 'admin'],
      users: ['vip_client_1'],
    },

    // 4. Multivariate A/B Test
    pricing_page_test: {
      variants: [
        { name: 'control', weight: 50 },
        { name: 'discount_banner', weight: 50 },
      ],
    },
  },
});
```

### 2. Nunjucks SSR Templates (`pages/*.njk`)

```nunjucks
{% if fsy.hasFeature('new_checkout') %}
  {% include "components/new-checkout.njk" %}
{% else %}
  {% include "components/legacy-checkout.njk" %}
{% endif %}

{% if fsy.flag('pricing_page_test') == 'discount_banner' %}
  <div class="banner">Special 20% Discount Applied!</div>
{% endif %}
```

### 3. File-Based API Endpoints (`pages/api/...`)

```javascript
const { defineApi } = require('webspresso');

module.exports = defineApi({
  // Automatically blocks request with HTTP 404 if flag is disabled
  flag: 'ai_assistant',
  handler: async (req, res, ctx) => {
    // Also accessible inside ctx or req
    const isVip = ctx.hasFeature('vip_access');
    return res.json({ success: true, isVip });
  },
});
```

### 4. Route Guard Middleware

```javascript
const { createFeatureFlagManager } = require('webspresso');

const flags = createFeatureFlagManager({
  flags: { secret_admin: { roles: ['admin'] } },
});

// Use as standalone route middleware
app.get('/admin/secret', flags.guard('secret_admin', { statusCode: 403 }), (req, res) => {
  res.send('Welcome, Admin!');
});
```

---

## ⚙️ Environment Overrides

Flags can be overridden at runtime without code deployment or restart:

```bash
# Enable flag
FEATURE_NEW_CHECKOUT=true npm start

# Disable flag
FEATURE_NEW_CHECKOUT=false npm start
```

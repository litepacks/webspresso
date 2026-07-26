# Webspresso — application kernel (event bus, flows, views)

This layer must **not** be confused with Express SSR. The package root **`createApp`** sets up file-based SSR; **`kernel.createApp`** is a lightweight in-process API with an event bus, optional view resolver, and flow registry.

## Name clash

| API | Purpose |
|-----|---------|
| `require('webspresso').createApp(...)` | SSR — `pages/`, Nunjucks, Express |
| `require('webspresso').kernel.createApp(...)` | Kernel — `events`, `registerPlugin`, `registerFlow`, `view` |

## Usage

```javascript
const { kernel } = require('webspresso');
const app = kernel.createApp({
  paths: {
    appViews: './views', // optional app override root
    themeViews: './themes/default',
  },
});
```

Module layout (source repo): [`core/kernel/`](../../../core/kernel/).

## Event bus

- **`events.dispatch(name, ctx)`** — Handlers for the same name run **sequentially** with `await`; `ctx` is mutable; errors stop the caller.
- **`events.publish(name, ctx)`** — Handlers run concurrently via **`Promise.all`** (side effects / “after” events).
- **`events.on(name, handler)`** / **`off`** — Subscribe / unsubscribe.
- **`events.buildContext(payload, { source, requestId?, userId? })`** → `{ payload, meta: { source, createdAt, … } }`; `source`: `'orm' | 'auth' | 'route' | 'plugin' | 'system'`.

Standalone bus: `kernel.createEventBus()`.

## Simulated repository (ORM lifecycle)

`kernel.BaseRepository` — in-memory store; events named by `resource`: `orm.<resource>.beforeCreate`, `afterCreate`, `beforeUpdate`, …

Implementation: [`core/kernel/base-repository.js`](../../../core/kernel/base-repository.js).

## Plugin shell

```javascript
const { kernel } = require('webspresso');
const myPlugin = kernel.definePlugin({
  name: 'my-plugin',
  events(app) {
    app.events.on('orm.post.afterCreate', async (ctx) => { /* ... */ });
  },
  views() {
    return {
      namespace: 'blog',
      layouts: {},
      pages: { home: '<h1>{{ title }}</h1>' },
      partials: {},
    };
  },
});
app.registerPlugin(myPlugin);
```

## View resolver

- Name shape: **`namespace::page`** (e.g. `blog::home`).
- Resolution order: app file overrides → theme file overrides → inline plugin templates.
- **`app.view.renderView('ns::id', data, { layout: 'ns::layoutName' })`**
- **`app.view.renderPartial(...)`**
- Minimal templates: `{{ field }}` interpolation.

## Flow

```javascript
app.registerFlow(
  kernel.defineFlow({
    trigger: 'orm.post.afterCreate',
    when: (ctx) => ctx.payload.record?.status === 'published',
    actions: [async (ctx, kernApp) => { /* run in order */ }],
  }),
);
```

## Demo

From the repo: `node core/kernel/run-demo.js` — plugin, flow, and view example.

## When to read this file

- Event-driven domain logic, “on afterCreate do X” automation.
- When you want this minimal kernel instead of SSR routes or Knex ORM `ModelEvents` alone.

Types: npm package **`index.d.ts`** (`kernel`, `KernelAppShell`, …).

HTML section: **[`doc/index.html#application-kernel`](../../../doc/index.html#application-kernel)**.

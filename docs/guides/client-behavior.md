# Client Behavior Layer, SSR Fragments & Typed Forms

Webspresso provides a lightweight, SSR-integrated, strongly-typed client behavior layer built on top of HTML, server fragments, and an isolated Datastar reactivity adapter (`core/client`).

---

## 1. Core Architectural Model

Webspresso's client layer follows a strict **HTML-first** ownership model:

1. **Server Produces HTML; Client Attaches Behavior**: Pages and fragments are rendered on the server with Nunjucks. The browser attaches scoped controllers and form handlers to the rendered DOM.
2. **Two Explicit Data Flows**:
   - **Server-Managed View (`defineFragment` + `invalidate`)**: Mutations (`POST`/`PATCH`/`DELETE`) return `apiResult(data, { invalidate: ['notes'] })`. The client automatically refreshes only the active fragments on the current page that depend on `'notes'` and patches the DOM in place while preserving focus, selection, dirty form drafts, and mounted controller state.
   - **Client-Managed Data (`defineController` + `api.*`)**: When client-side interactive UI needs JSON data directly, a controller explicitly calls `await api.get('/api/notes/stats')` and writes the response into its own isolated local `state`.
3. **Single Ownership Rule**:
   - Every DOM value is owned by **either** a server fragment **or** a client binding (`data-w-text`, `data-w-show`, `data-w-disabled`, `data-w-model`), **never both**.
   - During fragment DOM morphing, attributes/values owned by client bindings (`data-w-*`) or dirty user-edited form inputs are never overwritten by server HTML.

---

## 2. Client / Server File Separation & Naming

### 2.1 File Conventions
Client behavior files live alongside pages or views using `.client.ts` or `.client.js` suffixes:
- `pages/notes.client.ts` → Page-level controller (`notes`)
- `pages/settings/profile.client.ts` → Nested page controller (`settings--profile`)
- `views/components/dropdown.client.ts` → Reusable component controller (`dropdown`)

### 2.2 Strict Boundary Protection
- **Excluded from Server Routing**: `.client.js` and `.client.ts` files are automatically excluded from SSR page and API route registration (`isClientBrowserFile`).
- **Server Import Boundary Guard**: Client files cannot import server-only modules (`fs`, `net`, `tls`, `child_process`, `knex`, `core/orm`, `models/`, `services/`, or server page loaders). Both `webspresso build` and `webspresso doctor` verify this boundary at build/check time.
- **Deterministic Controller Naming & Collision Detection**: Controller names are derived deterministically from relative paths (`deriveControllerNameFromPath`). If two files resolve to the same controller name and neither declares an explicit `name` in `defineController({ name })`, the bundler and `webspresso doctor` fail with `CONTROLLER_NAME_COLLISION`.

---

## 3. Defining Controllers (`defineController`)

```ts
// pages/notes.client.ts
import { defineController } from 'webspresso/core/client';

export default defineController({
  state: () => ({
    filter: '',
    statsLoaded: false,
    totalNotes: 0,
  }),

  connect(ctx) {
    // Scoped DOM query (never crosses into nested child controllers)
    const searchInput = ctx.target('search');

    // Reactive effect cleaned up automatically when element disconnects
    ctx.effect(() => {
      if (ctx.state.filter.length > 0) {
        ctx.emit('notes:filter-change', { filter: ctx.state.filter });
      }
    });
  },

  actions: {
    async loadStats(ctx) {
      // Explicit API call writing into controller-local state
      const res = await ctx.api.get('/api/notes/stats');
      ctx.state.totalNotes = res.total;
      ctx.state.statsLoaded = true;
    },
  },
});
```

### 3.1 Supported HTML Binding Attributes
All reactive bindings are mediated through `core/client/adapter/datastar.js` using isolated per-instance signal namespaces (`__w_inst_<id>`):

| Attribute | Purpose | Example |
| :--- | :--- | :--- |
| `data-w-controller` | Mounts a controller instance on the element | `data-w-controller="notes"` |
| `data-w-target` | Marks a scoped child element for `ctx.target(name)` / `ctx.targets(name)` | `data-w-target="counter"` |
| `data-w-on:<event>` | Binds a DOM event to a controller action | `data-w-on:click="loadStats"` |
| `data-w-text` | Binds element `textContent` to controller state or computed getter | `data-w-text="totalNotes"` |
| `data-w-show` | Toggles element `hidden` state from a boolean state or computed path | `data-w-show="statsLoaded"` |
| `data-w-disabled` | Toggles `disabled` property/attribute from a boolean state or task signal | `data-w-disabled="tasks.stats.pending"` |
| `data-w-model` | Two-way binding between form control (`input`/`select`/`textarea`) and state | `data-w-model="draft.search"` |
| `data-w-form` | Binds native HTML `<form>` enhancement and validation lifecycle | `data-w-form="create-note"` |

### 3.2 Two-Way Binding (`data-w-model`) & Elimination of Direct DOM Manipulation
Controllers no longer query or mutate DOM elements directly (e.g. `target('input')?.value = ''`). Instead, use `data-w-model="path"`:
- **Nested Path Support**: Automatically resolves and updates nested objects (e.g. `draft.search`, `draft.status`).
- **Initial Value Ownership**: When `state` defines a value (including `null`, `0`, `false`, `''`), state owns it. If state is `undefined`, it seeds from the server-rendered DOM value.
- **Empty Number Handling**: Empty number inputs convert cleanly to `null`, never silent `0`.
- **IME Composition Guard**: Typing during IME composition (`compositionstart`) does not fire state updates until `compositionend`.
- **File Input Exclusion**: File inputs are excluded from programmatic value bindings for browser security.

### 3.3 Draft vs Applied Filter Pattern
Toolbars and search bars keep draft inputs decoupled from the active query:
```ts
export default defineController({
  state: () => ({
    draft: { search: '', status: 'all', priority: 'all' },
    applied: { search: '', status: 'all', priority: 'all' },
    page: 1,
  }),
  actions: {
    async applyFilters({ state, refresh }) {
      const next = { ...state.draft };
      const res = await refresh('list', { ...next, page: 1 });
      if (res && res.ok !== false) {
        state.applied = next;
        state.page = 1;
      }
    },
    async nextPage({ state, refresh }) {
      const next = state.page + 1;
      const res = await refresh('list', { ...state.applied, page: next });
      if (res && res.ok !== false) state.page = next;
    },
  },
});
```

### 3.4 Derived Values (`computed`)
Define readonly, reactive values derived from other state fields or tasks:
```ts
computed: {
  filterSummaryText: ({ state }) =>
    `Showing: ${state.applied.status} • Page ${state.page}`,
  hasInsights: ({ tasks }) => Boolean(tasks.insights?.data),
}
```
- **Read-Only**: Assigning to computed properties throws a `TypeError`.
- **Side-Effect Free**: Attempting to mutate state inside a computed getter throws an `Error`.
- **Instance Isolated**: Backed by Datastar signals scoped per controller instance.

### 3.5 Lifecycle-Bound Async Tasks (`tasks` / `ctx.task`)
Centralizes loading states, stale response guards, and abort controllers into a clean task:
```ts
tasks: {
  insights: ({ api }) => ({
    run: () => api.get('/api/todos/insights'),
    concurrency: 'latest', // 'latest' | 'drop' | 'queue'
  }),
},
actions: {
  async loadInsights({ tasks }) {
    await tasks.insights.run();
  },
}
```
- Provides reactive signals: `pending`, `data`, `error`, `stale`, `run()`, `cancel()`, `dispose()`.
- Easily bound in HTML: `data-w-disabled="tasks.insights.pending"`, `data-w-show="hasInsights"`.
- Older requests never prematurely reset `pending` of a newer running request.

### 3.6 Lifecycle & Automatic Cleanup
- **Instance Isolation**: Multiple instances of the same controller on a page have completely isolated `state` objects and signal namespaces.
- **No Stale Target Caching**: `ctx.target(name)` and `ctx.targets(name)` query the live DOM dynamically on each call and never return elements belonging to nested child controllers of the same type.
- **Automatic Teardown**: When a controller root is removed from the DOM, all `ctx.on()`, `ctx.effect()`, `ctx.interval()`, `ctx.timeout()`, `ctx.tasks`, and `ctx.signal()` resources are automatically disposed. Late async callbacks checking `ctx.isDisposed()` are prevented from mutating detached state.

---

## 4. Typed API Client & `.webspresso/api.d.ts`

### 4.1 Automatic Type Generation
`webspresso dev`, `webspresso build`, and `webspresso typegen` inspect `pages/api/**` routes defined with `defineApi({ schema, response, handler })` and generate `.webspresso/api.d.ts`:
- **Input vs Output Separation**: `z.coerce.number()` or `.default()` fields are optional/coercible on the client request input (`mode = 'input'`) while typed as parsed outputs on the server.
- **Wire Serialization (`WireSerialize<T>`)**: `Date` objects become ISO `string`s, `undefined` properties are omitted, and `BigInt`/`Map`/`Set` are flagged as unserializable unless transformed.
- **Raw & Streaming Escape Hatches**: Endpoints returning SSE, streams, downloads, or redirects use `api.raw(path, init)` or `api.stream(path, options)`.

### 4.2 Request Concurrency Policies & Error Classification
- **Concurrency Policies (`concurrency: 'latest' | 'drop' | 'queue' | 'parallel'`)**:
  - `'latest'` (default for `GET` / fragment refreshes with a `key`): Aborts any in-flight request with the same key when a newer request starts.
  - `'drop'`: Drops new requests while a request with the same `key` is already in flight.
  - `'queue'`: Serializes requests with the same `key` in FIFO order.
  - `'parallel'`: Runs all requests concurrently.
- **Zero Automatic Mutation Retries**: `POST`, `PUT`, `PATCH`, and `DELETE` requests are never automatically retried.
- **Error Classification (`ClientRequestError`)**:
  - `err.kind`: `'validation'` (400/422 with `fieldErrors`), `'http'` (4xx/5xx), `'network'` (offline/DNS), or `'canceled'` (`AbortController`).

---

## 5. Native HTML Forms (`data-w-form`)

Standard `<form action="/api/..." method="post" data-w-form="...">` elements work out of the box **even without a `.client.ts` file**.

### 5.1 Deterministic Form Coercion Rules
When `parseFormElement(form)` serializes a form:
1. **Disabled Controls**: Any control with `disabled` or inside a `<fieldset disabled>` (except inside its first `<legend>`) is excluded.
2. **Submitter Button**: Only the clicked submit button (`submitter.name` / `submitter.value`) is included; other submit buttons are excluded.
3. **Checkboxes**:
   - Single checkbox without `[]`: boolean (`true` if checked, `false` if unchecked) unless an explicit custom `value` attribute is set.
   - Checkbox group (`name="tags[]"` or multiple checkboxes sharing `name`): array of checked string values (`string[]`).
4. **Multi-Select (`<select multiple>`)**: Array of selected option values (`string[]`).
5. **Typed Scalar Inputs (`data-w-type` / `type="number"`)**:
   - Empty optional text/number input with `data-w-empty="null"` or `data-w-empty="undefined"` coerces to `null` or `undefined`.
   - `type="number"` or `data-w-type="number"` coerces numeric strings to `number` (`NaN`-safe).
6. **File Inputs (`<input type="file">`)**: Automatically switches submission payload to `FormData` when files are present.

### 5.2 Accessibility, Validation & Reset Semantics
- **Field Errors & Accessibility**: On HTTP 400/422 validation errors, `createFormHandle` populates `form.fieldErrors`, sets `aria-invalid="true"` and `aria-describedby` pointing to `[data-w-error-for="<field>"]`, and focuses the first invalid control.
- **Double-Submit Protection**: While a submission is in flight, `form.pending` is `true`, `data-w-pending="true"` is set on the `<form>`, and duplicate submits are blocked.
- **`reset()` vs `clear()`**:
  - `form.reset()` restores all controls to their initial server-rendered default values (`defaultValue` / `defaultChecked` / `defaultSelected`) or current baseline values and clears errors.
  - `form.clear()` empties all text, number, select, and checkbox controls to blank/unchecked state and clears errors.
- **Static Form Contract Checker**: `webspresso doctor` and `webspresso build` statically compare `<form action="/api/..." method="...">` field names in `.njk` templates against the target API route's `schema.body`/`schema.query`, reporting missing required fields, type mismatches, or dynamic `{{ ... }}` field names that cannot be verified statically.

### 5.3 Programmatic Form Management & Client-Driven Edit Flow
Forms retrieved via `ctx.forms.get('edit-todo')` provide a typed API:
- `form.fill(values, { baseline: false })`: Fills form controls and sets `form.dirty = true`.
- `form.fill(record, { baseline: true })`: Sets a new baseline (e.g. after fetching a record from an API endpoint), resets `form.dirty = false`, and clears previous errors.
- `form.setAction(url)` / `form.setRouteParams(params)`: Updates form target URL.
- `form.disabled = true`: Disables all form controls during async record loading.

#### Edit Flow Example:
```html
<button data-w-on:click="selectTodoForEdit" data-todo-id="{{ item.id }}">Edit</button>
```

```ts
async selectTodoForEdit({ state, forms, api }, _event, actionEl) {
  const id = actionEl.getAttribute('data-todo-id');
  if (!id) return;

  const form = forms.get('edit-todo');
  if (form.dirty && !window.confirm('Discard unsaved changes?')) return;

  // Fetch record with stale response guard ('latest')
  const todo = await api.get(`/api/todos/${id}`, { concurrency: 'latest' });
  if (!todo || form.dirty) return;

  form.setAction(`/api/todos/${todo.id}`);
  form.fill(todo, { baseline: true });
}
```

---

## 6. SSR Fragments, Invalidation & Error Semantics

### 6.1 Defining & Rendering Fragments
Fragments are declared in the page module (`pages/*.js`) using `defineFragment` and rendered in Nunjucks via `{{ fsy.fragment('name', input) }}`:

```js
// pages/notes.js
const { defineFragment } = require('webspresso');

module.exports = {
  fragments: {
    list: defineFragment({
      template: 'partials/notes-list.njk',
      dependsOn: ['notes'],
      schema: ({ z }) => ({
        search: z.string().default(''),
        page: z.coerce.number().int().min(1).default(1),
      }),
      async load({ req, db, ctx, input }) {
        // Request-scoped memoization shared across page load() and multiple fragments
        const stats = await ctx.memo('notes:stats', () =>
          db.getRepository('Note').count()
        );
        const items = await db.getRepository('Note').find({ search: input.search });
        return { items, stats, input };
      },
    }),
  },
  async load({ ctx }) {
    return { title: 'Notes' };
  },
};
```

### 6.2 Invalidation & Transaction Safety (`apiResult`)
API routes declare invalidated tags using `apiResult(data, { invalidate })` or `ctx.result(data, { invalidate })`:
- **Commit-Only Publication**: If the API handler or service runs inside an ORM transaction (`db.transaction()` or `transaction: true`), the `X-Webspresso-Invalidate` header is emitted **only after the transaction commits**. Rolled-back or failed mutations never emit invalidations.
- **Two-Phase Mutation vs Refresh Error Separation**:
  - Once the mutation HTTP request succeeds (`2xx`), `api.post()` / `form.submit()` resolves with `mutationSucceeded: true`.
  - If the subsequent `/__webspresso/fragments` refresh fails (e.g. transient network drop), the mutation is **never** marked as failed or re-posted. Instead, `onRefreshError` is notified and `fragments.retryFailed()` retries only the fragment refresh.

### 6.3 Initial Load & Refresh Cost Guarantees
- **Request-Scoped Memoization (`ctx.memo(key, fn)`)**: Shared queries executed during a single SSR render or a single batched `/__webspresso/fragments` request run only once per HTTP request and are garbage-collected immediately when the request ends.
- **Microtask Batching & In-Flight Coalescing**: Multiple `invalidate(['notes'])` calls in the same tick are coalesced into a single `POST /__webspresso/fragments` batch request. If new invalidations arrive while a refresh batch is already in flight, they are coalesced into a single follow-up refresh immediately after the in-flight request completes.
- **Parent/Child Deduplication**: If both a parent fragment and a nested child fragment are invalidated in the same batch, only the parent fragment is requested from the server (`deduplicateParentChildFragments`).
- **Zero-Match Skip**: If an API response invalidates tags that no active fragment on the current page depends on, zero network requests are made.

### 6.4 Multi-Fragment Pages: Architecture & Placement
A single page can host multiple SSR fragments, each responsible for an independent region of the screen (e.g. counters, data tables, sidebars, activity streams):

```js
// pages/dashboard.js
const { defineFragment } = require('webspresso');

module.exports = {
  fragments: {
    summary: defineFragment({
      template: 'partials/dashboard-summary.njk',
      dependsOn: ['orders', 'users'],
      async load({ db, ctx }) {
        const orderCount = await ctx.memo('count:orders', () => db.getRepository('Order').count());
        const userCount = await ctx.memo('count:users', () => db.getRepository('User').count());
        return { orderCount, userCount };
      },
    }),
    ordersList: defineFragment({
      template: 'partials/dashboard-orders.njk',
      dependsOn: ['orders'],
      schema: ({ z }) => ({ limit: z.coerce.number().default(10) }),
      async load({ db, input }) {
        const orders = await db.getRepository('Order').query().limit(input.limit).find();
        return { orders };
      },
    }),
    notifications: defineFragment({
      template: 'partials/dashboard-notifications.njk',
      dependsOn: ['notifications'],
      async load({ db, user }) {
        const unread = await db.getRepository('Notification').find({ userId: user.id, isRead: false });
        return { unread };
      },
    }),
  },
  async load() {
    return { title: 'Dashboard' };
  },
};
```

In the Nunjucks template (`pages/dashboard.njk`), fragments are rendered anywhere using `{{ fsy.fragment('name', input?, options?) }}`:

```html
{% extends "layout.njk" %}

{% block content %}
  <header>
    <h1>{{ title }}</h1>
    {{ fsy.fragment('summary') }}
  </header>

  <main class="grid grid-cols-3 gap-6">
    <div class="col-span-2">
      <!-- Passing input schema parameters -->
      {{ fsy.fragment('ordersList', { limit: 10 }) }}
    </div>

    <aside>
      <!-- Optional explicit instance ID if the same fragment appears multiple times -->
      {{ fsy.fragment('notifications', {}, { id: 'sidebar-notifications' }) }}
    </aside>
  </main>
{% endblock %}
```

#### Definition Name (`name`) vs Instance ID (`instanceId`)
- `data-w-fragment="name"` indicates the fragment definition to load on the server.
- `data-w-fragment-id="instanceId"` uniquely identifies the specific DOM element on the page.
- If omitted, Webspresso automatically assigns deterministic instance IDs (`name:default`, `name:1`, etc.).
- When the server returns refreshed HTML, each fragment updates its corresponding DOM container by `instanceId`.

### 6.5 Parent-Child (Nested) Fragments & Automatic Deduplication
Fragments can be nested inside one another (a parent fragment wrapping a child fragment):

```html
<!-- Parent Fragment -->
<div data-w-fragment="projectDetail" data-w-fragment-id="project-1" data-w-depends-on="tasks">
  <h2>Project Alpha</h2>

  <!-- Nested Child Fragment -->
  <div data-w-fragment="taskList" data-w-fragment-id="tasks-1" data-w-depends-on="tasks">
    <ul>...</ul>
  </div>
</div>
```

#### The `deduplicateParentChildFragments` Invariant
When a task mutation occurs and invalidates `'tasks'`:
1. Both `projectDetail` (parent) and `taskList` (child) match the invalidated tag.
2. Webspresso inspects the DOM hierarchy using `element.contains()`.
3. Because `taskList` is inside `projectDetail`'s DOM subtree, **Webspresso automatically strips the child from the outgoing batch request!**
4. Only `projectDetail` is requested from `POST /__webspresso/fragments`.
5. When the server re-renders `projectDetail`, its template inherently renders the fresh `taskList` inside it.
6. This eliminates redundant SQL queries, double payload transfers, and conflicting DOM patch races.

### 6.6 Inter-Fragment Communication Patterns
Fragments in Webspresso communicate across 4 distinct mechanisms depending on the scope of the interaction:

1. **Tag-Based Invalidation (`dependsOn` + `invalidate`)**:
   - The primary decoupling mechanism. Mutations return `apiResult(data, { invalidate: ['orders'] })`.
   - All active fragments declaring `dependsOn: ['orders']` refresh automatically in a single batched HTTP request.
2. **Server-Side Request-Scoped Memoization (`ctx.memo`)**:
   - When multiple sibling fragments refresh together, shared queries inside `load()` use `ctx.memo('key', fn)`.
   - The query executes once; subsequent fragments in the same batch receive the cached promise. The cache is destroyed immediately when the request finishes.
3. **Programmatic Controller Control (`ctx.refresh` & `ctx.fragment`)**:
   - A client controller can read another fragment's active input or trigger an explicit refresh with new parameters:
     ```ts
     // Read active input of another fragment
     const currentLimit = ctx.fragment('ordersList').input.limit;

     // Trigger explicit refresh with updated input and lifecycle callbacks
     await ctx.refresh('ordersList', { limit: currentLimit + 10 }, {
       onSuccess(res) {
         console.log('Orders refreshed:', res.refreshed);
       },
       onFailure(err) {
         console.error('Failed to load orders:', err.message);
       },
     });
     ```
   - Supports declarative callbacks (`onSuccess`, `onFailure`, `onError`, `onSettled`) or standard promise evaluation (`const res = await ctx.refresh(...)`). If `onFailure` is provided, rejection is suppressed by default so error states can be handled without `try/catch` boilerplate.
4. **Decoupled DOM CustomEvents (`ctx.emit` & `ctx.on`)**:
   - When a controller in Fragment A performs an action, it emits a standard DOM CustomEvent:
     ```ts
     // In CategorySidebar controller:
     ctx.emit('category:selected', { categoryId: el.dataset.id });
     ```
   - A controller in Fragment B listens and reacts:
     ```ts
     // In ProductGrid controller:
     connect(ctx) {
       return ctx.on(window, 'category:selected', (evt: CustomEvent) => {
         ctx.refresh('productsList', { categoryId: evt.detail.categoryId });
       });
     }
     ```

### 6.7 Single-Ownership Rule, Morphing & State Preservation
During fragment morphing (`morphDomTrees`), Webspresso guarantees smooth UX via the **Single-Ownership Rule**:
- **Dirty Inputs Never Overwritten**: Form fields being edited by the user are preserved and will not be overwritten by incoming server HTML.
- **Focus & Selection Retained**: Active element focus (`document.activeElement`) and text selection (`selectionStart`/`selectionEnd`) are maintained across DOM patches.
- **Controller Lifecycle Intact**: Controller instances, listeners, and Datastar reactive signals survive across fragment refreshes without unmounting or losing local client state.
- **Monotonic Version Tracking (`reqVersion`)**: Every fragment tracks a strictly increasing version counter. Out-of-order responses from slow network requests are discarded and never overwrite newer DOM state.

---

## 7. Asset Bundling, Build Pipeline & Production Serving

Webspresso provides a built-in production asset pipeline powered by `esbuild` with zero configuration required.

### 7.1 Development vs Production Runtime

| Environment | Asset Delivery | Bundler / Transpiler | Manifest & Caching |
| :--- | :--- | :--- | :--- |
| **Development** (`webspresso dev`) | Served directly via dev server | Incremental esbuild `context()` API with sub-millisecond rebuilds | Monitored by Dev Reload SSE (`devReloadHub`) for instant live reload |
| **Standalone Demo** (`examples/client-behavior`) | `http://localhost:3456/js/client-demo.js` | Built-in zero-dependency TypeScript transpiler in `server.js` | Single un-hashed bundle used **strictly** for the self-contained demo runner |
| **Production** (`webspresso build`) | Fingerprinted bundles in `public/dist/` | Production esbuild minification, tree-shaking, and content-hashing (`[dir]/[name].[hash].js`) | `public/dist/manifest.json` with immutable cache headers (`max-age=31536000, immutable`) |

> [!IMPORTANT]
> **Is `http://localhost:3456/js/client-demo.js` what runs in production?**
> **NO.** `client-demo.js` is solely an in-memory/standalone demo artifact located in `examples/client-behavior/server.js` to allow developers to test the Datastar client behavior demo immediately without installing `esbuild` or running a separate build step.
>
> In real production applications, client scripts and controllers are bundled, minified, fingerprinted, and resolved through `npx webspresso build`.

### 7.2 Production Build Workflow (`npx webspresso build`)

Running `npx webspresso build` (or `webspresso build:assets`) performs the following automated steps:

1. **Automatic Entrypoint Discovery (`src/bundle/index.js`)**:
   - Main entrypoints: `src/client/main.{js,ts}`, `src/client/index.{js,ts}`, `src/client/app.{js,ts}`
   - Page-level controllers: `pages/**/*.client.{js,ts,jsx,tsx}`, `src/pages/**/*.client.*`
   - Component controllers: `views/**/*.client.{js,ts,jsx,tsx}`, `src/views/**/*.client.*`
2. **Server Boundary Protection (`createServerBoundaryPlugin`)**:
   - Statically verifies and aborts the build if any client file attempts to import server-only modules:
     - Node builtins: `fs`, `fs/promises`, `child_process`, `net`, `tls`, `cluster`, `worker_threads`, `v8`, `vm`
     - Database & server packages: `knex`, `better-sqlite3`, `pg`, `mysql2`, `express`, `helmet`, `bcrypt`
     - Internal server paths: `core/orm/*`, `services/*`, `models/*`, `jobs/*`, `pages/api/*`, or server page loaders (`pages/*.js`)
3. **Fingerprinting & Content Hashing**:
   - Bundles are output to `public/dist/` with immutable content hashes:
     - `public/dist/main.8f2a1b.js`
     - `public/dist/pages/todos.3c9d4e.js`
4. **Manifest Generation (`public/dist/manifest.json`)**:
   ```json
   {
     "main.js": "/dist/main.8f2a1b.js",
     "pages/todos.js": "/dist/pages/todos.3c9d4e.js"
   }
   ```
5. **Nunjucks Asset Helpers (`fsy.js` / `fsy.asset`)**:
   - In layouts and page templates, reference assets using built-in helpers:
     ```html
     <!-- Base application client runtime -->
     <script type="module" src="{{ fsy.js('main.js') }}"></script>

     <!-- Page-specific controller bundle -->
     <script type="module" src="{{ fsy.asset('pages/todos.js') }}"></script>
     ```
   - In production, `fsy.js()` / `fsy.asset()` automatically maps `'main.js'` to `'/dist/main.8f2a1b.js'` from `manifest.json`.
   - In development, it resolves directly to `/js/main.js` or the dev bundler output.
6. **HTTP 103 Early Hints Acceleration**:
   - When Early Hints are enabled (`createApp({ earlyHints: true })`), Webspresso automatically sends `103 Early Hints` preloading headers (`Link: </dist/main.8f2a1b.js>; rel=preload; as=script`) while async server page loaders (`load()`) are still running in the background.
7. **External Bundler Integration (Vite / Webpack)**:
   - If your project already uses Vite, configure Webspresso to read Vite's manifest:
     ```javascript
     createApp({
       assets: {
         manifestPath: 'public/dist/.vite/manifest.json',
         prefix: '/dist/',
       },
     });
     ```

---

## 8. Bundle Size & Performance Benchmarks

Webspresso’s client layer (`core/client`) is designed to be **zero-dependency**, lightweight, and cacheable for instant First Contentful Paint (FCP) and Time to Interactive (TTI).

### 8.1 Runtime Size Breakdown

| Layer / Component | Minified Size | Gzip Compressed | Brotli Compressed (`br`) |
| :--- | :--- | :--- | :--- |
| **Datastar Signals & DOM Adapter** (`core/client/adapter/datastar.js`) | ~32 KB | **~10.8 KB** | **~9.4 KB** |
| **Typed Forms & Validation Engine** (`core/client/forms.js`) | ~16 KB | **~4.9 KB** | **~4.1 KB** |
| **Typed API Client & Concurrency Engine** (`core/client/api.js`) | ~15 KB | **~4.6 KB** | **~3.9 KB** |
| **Controller & Tasks Runtime** (`core/client/controller.js`) | ~14 KB | **~4.4 KB** | **~3.8 KB** |
| **SSR Fragment Reconciler & Batcher** (`core/client/fragments.js`) | ~10 KB | **~3.1 KB** | **~2.7 KB** |
| **Shared Micro-Utilities** (`core/client/utils.js`) | ~2 KB | **~0.8 KB** | **~0.7 KB** |
| **Lite Runtime** (`webspresso/client/lite`) | **~30 KB** | **~9.5 KB** | **~8.2 KB** |
| **Full Client Behavior Runtime** (`webspresso/core/client`) | **~75 KB** | **~26 KB** | **~21.8 KB** |

### 8.2 A-la-Carte Subpath Imports (Micro-Footprints)

Webspresso supports modular subpath imports through package exports so pages only load the capabilities they actually use:

```javascript
// 1. Lite Server-Driven Runtime (~8.2 KB Brotli)
// Ideal for landing pages, blogs, and marketing sites with SSR fragments and forms.
import { bootLiteClient } from 'webspresso/client/lite';
bootLiteClient();

// 2. Fragment-Only Reconciler (~2.7 KB Brotli)
// Pure DOM morpher and invalidation receiver for static/read-only SSR pages.
import { createFragmentCoordinator } from 'webspresso/client/fragments';

// 3. Form-Only Enhancement (~4.1 KB Brotli)
// For simple contact/signup forms without reactive signals.
import { createFormHandle } from 'webspresso/client/forms';

// 4. Full Reactive Controller Runtime (~21.8 KB Brotli)
// Complete suite: two-way binding, computed signals, tasks, forms, fragments.
import { bootClient, defineController } from 'webspresso/client';
bootClient();
```

### 8.3 Production Build Optimizations (`webspresso build`)

The production bundler applies zero-config compiler passes to strip unused developer code:
- **Automatic Dead-Code Elimination**: `define: { 'process.env.NODE_ENV': '"production"' }` removes dev-only warnings and disables debug rings.
- **Debugger Stubbing**: Unused `createClientDebugger` rings and payload serializers are replaced with a zero-allocation frozen no-op stub (`NOOP_DEBUGGER`).
- **Tree-Shaking & Dead-Branch Pruning**: `treeShaking: true` discards unreferenced controller or form helpers.
- **License Deduplication**: `legalComments: 'none'` prevents duplicated comment blocks across chunks.
- **Debugger Stripping**: `drop: ['debugger']` strips breakpoint traps from production bundles.

### 8.4 Comparison to Other Client Framework Stacks

```
Next.js Baseline Runtime      ████████████████████████████████ 85 KB (gzip)
React 19 + React-DOM + Router ██████████████████████ 58 KB (gzip)
Vue 3 Core Runtime            █████████████ 34 KB (gzip)
Webspresso Client Layer       █████████ 26 KB (gzip) / 21.8 KB (brotli)
Alpine.js Core                ██████ 15 KB (gzip)
```

> [!TIP]
> Unlike heavy SPA frameworks that require 50–100 KB of initial JavaScript before anything renders, Webspresso sends **100% pre-rendered server HTML**. The client bundle is non-blocking (`defer` / `type="module"`) and only attaches behavior. With HTTP 103 Early Hints enabled, modern browsers download the ~22 KB Brotli bundle concurrently while the server renders the HTML response.

---

## 9. Browser Compatibility & Standards

Webspresso's client layer relies exclusively on **W3C / WHATWG Standard Web APIs** without vendor lock-in or polyfill bloat.

### 9.1 Supported Browsers Matrix

| Browser | Minimum Version | Tested Baseline | Global Market Coverage |
| :--- | :--- | :--- | :--- |
| **Google Chrome / Chromium** | Chrome 80+ | Chrome 120+ | ✅ Supported (98%+) |
| **Apple Safari (macOS & iOS)** | Safari 14+ (iOS 14+) | Safari 17+ (iOS 17+) | ✅ Supported (98%+) |
| **Mozilla Firefox** | Firefox 78+ ESR / 80+ | Firefox 125+ | ✅ Supported (98%+) |
| **Microsoft Edge** | Edge 80+ (Chromium) | Edge 120+ | ✅ Supported (98%+) |
| **Opera, Brave, Vivaldi, Arc** | Chromium 80+ base | Latest | ✅ Supported (98%+) |
| **Samsung Internet** | Version 14.0+ | Latest | ✅ Supported (98%+) |
| **Internet Explorer 11** | ❌ Not Supported | — | EOL (Retired by Microsoft) |

*Global browser coverage exceeds **97.8%** of active internet traffic worldwide.*

### 9.2 Required Browser Capabilities

Webspresso uses native browser primitives supported across all modern evergreen engines since 2020:
- **`Proxy` (ES2015)**: Powers fine-grained reactive signals and readonly computed getters without dirty-checking or virtual DOM diffing.
- **`AbortController` & `AbortSignal`**: Controls request cancellation, `'latest'` concurrency policy, and automatic unmount cleanup.
- **`MutationObserver`**: Automatically discovers new `data-w-controller` elements injected via SSR fragment patches and cleans up disposed controllers.
- **`Fetch API` & `FormData`**: Handles JSON API endpoints, fragment batch requests, and multi-part file uploads.
- **`CustomEvent` & DOM Event Delegation**: Enables decoupled event emission (`ctx.emit()`) and action dispatching (`data-w-on:<event>`).
- **`HTMLTemplateElement`**: Provides safe, sandbox DOM tree parsing for morphing and fragment reconciliation.
- **`queueMicrotask`**: Batches multiple `invalidate()` signals within the same tick into a single batched fragment refresh request.

### 9.3 Progressive Enhancement & Graceful Degradation

Because Webspresso is fundamentally an **HTML-First SSR** framework:
- **JavaScript Disabled / Network Interruption**: If client JavaScript is disabled or fails to load, the page renders 100% usable HTML.
- **Standard Forms Fallback**: Standard `<form action="/api/..." method="post">` elements submit natively as standard browser POST requests.
- **Links & Navigation**: Hyperlinks navigate seamlessly via browser HTTP GET requests without requiring a client router.
- **No Blank White Screen (No Flash of Unstyled Content)**: The user sees meaningful content immediately on initial byte transfer, eliminating the white-screen penalty common to SPAs.

---

## 10. Explicitly Unsupported Behaviors (v1 Non-Goals)

To keep the runtime small, predictable, and debuggable, the following are **intentionally out of scope** in v1:
1. **No Full-Page Hydration or Props Serialization**: Server loader data is rendered to HTML on the server and is never serialized into a global `window.__INITIAL_STATE__` JSON blob.
2. **No Automatic Global Signal Store for API Responses**: API JSON responses are returned to the caller (`api.get()`) rather than automatically merged into a global signal store.
3. **No Second Virtual DOM or Client Template Engine**: HTML templates live exclusively in Nunjucks on the server; client bindings only toggle text, visibility, disabled state, and form values.
4. **No Automatic Client Query Cache or Optimistic UI**: Client state is local to its mounted controller instance, and mutations wait for server confirmation before refreshing fragments.
5. **No Client-Side SPA Router or Cross-Tab Broadcast Invalidation**: Page navigation uses standard HTTP/SSR routing, and `invalidate` refreshes fragments within the originating browser tab.

---

## 11. Using Alpine.js with Webspresso (Alternative & Migration Guide)

While Webspresso ships with its own zero-dependency, TypeScript-safe client behavior runtime (`core/client` with `defineController` and `defineFragment`), you can easily use **Alpine.js** in your Webspresso applications.

Webspresso does not force or bundle Alpine.js internally—allowing you to use any Alpine.js version, CDN, or bundler setup you prefer without framework bloat.

### 11.1 Step 1: Include Alpine.js in Your Layout Template

Add Alpine.js to your root layout (`views/layout.njk`) using a standard deferred `<script>` tag:

```html
<!-- views/layout.njk -->
<!DOCTYPE html>
<html lang="{{ locale }}">
<head>
  <meta charset="utf-8">
  <title>{{ meta.title or "My Webspresso App" }}</title>

  <!-- Prevent Flash of Unstyled Content (FOUC) while Alpine initializes -->
  <style>
    [x-cloak] { display: none !important; }
  </style>

  <!-- Load Alpine.js from CDN (or your local build via fsy.js / fsy.asset) -->
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
</head>
<body>
  <main>
    {% block content %}{% endblock %}
  </main>
</body>
</html>
```

### 11.2 Step 2: Writing Alpine Components

In your Nunjucks pages (`pages/*.njk`), use standard Alpine.js directives:

```html
<!-- pages/counter.njk -->
{% extends "views/layout.njk" %}

{% block content %}
<div class="p-6 max-w-sm mx-auto bg-white rounded-xl shadow-md" x-data="{ count: 0 }" x-cloak>
  <h2 class="text-xl font-bold mb-2">Alpine Counter</h2>
  <p class="text-gray-700">Current count: <span class="font-mono font-semibold" x-text="count"></span></p>
  
  <div class="mt-4 flex gap-2">
    <button @click="count++" class="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">Increment</button>
    <button @click="count = 0" class="px-3 py-1 bg-gray-200 text-gray-800 rounded hover:bg-gray-300">Reset</button>
  </div>
</div>
{% endblock %}
```

### 11.3 Step 3: Production CSP Configuration (Helmet)

> [!IMPORTANT]
> **Alpine evaluates directives (`x-data`, `x-text`, `@click`) using JavaScript function evaluation (`new AsyncFunction`)**, which standard production Content Security Policies (CSP) block by default.

If you are running in production with Helmet CSP enabled, add `'unsafe-eval'` and your CDN host (if using a CDN) to `scriptSrc`:

```javascript
// server.js or app.js
const { createApp } = require('webspresso');

const { app } = createApp({
  helmet: {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-eval'", // Required for Alpine.js directive evaluation
          "https://cdn.jsdelivr.net", // If loading Alpine from CDN
        ],
        styleSrc: ["'self'", "'unsafe-inline'"], // Needed for [x-cloak] style tag
      },
    },
  },
});
```

### 11.4 Step 4: Smooth Page Transitions with Swup

If you use Webspresso's Swup integration (`clientRuntime: { swup: true }`), Webspresso's Swup bootstrap automatically detects `window.Alpine` and calls `Alpine.initTree(document.querySelector('#swup'))` when page content is swapped (`content:replace`).

If you manage Swup manually, re-initialize Alpine on Swup transitions with:

```javascript
document.addEventListener('swup:enable', () => {
  window.__webspressoSwup?.hooks.on('content:replace', () => {
    if (window.Alpine && typeof window.Alpine.initTree === 'function') {
      window.Alpine.initTree(document.querySelector('#swup'));
    }
  });
});
```

### 11.5 Migrating from Legacy `clientRuntime: { alpine: true }`

Older versions of Webspresso included internal Alpine.js bundling via `clientRuntime: { alpine: true }`. To migrate without breaking changes:

1. **Update `createApp` configuration**: Remove `alpine: true` (or leave it as a no-op; it is safely ignored without throwing errors).
2. **Add the Alpine `<script>` tag** in `views/layout.njk` as shown in Section 11.1 above.
3. **Configure Helmet CSP** in `createApp({ helmet })` if deploying to production with a strict CSP.
4. **Remove `alpinejs`** from `package.json` if you were previously installing it solely as a Webspresso peer dependency.

---

## 12. Client Resilience & Fault Tolerance

Webspresso provides enterprise-grade client resilience primitives to ensure smooth user experiences over spotty network connections.

### 12.1 Fetch Request Timeouts
Set explicit timeouts on any API request to prevent hanging promises:
```ts
// Aborts request after 5000ms if server does not respond
const data = await ctx.api.get('/api/analytics', { timeout: 5000 });
```
When a timeout triggers, `ClientRequestError` is thrown with:
- `err.kind === 'timeout'`
- `err.isTimedOut === true`
- `err.status === 408`
- `err.code === 'REQUEST_TIMED_OUT'`

### 12.2 Idempotent Retry Engine
Automatically retry transient network failures and 5xx gateway errors on idempotent requests (`GET` and `HEAD`):
```ts
const stats = await ctx.api.get('/api/stats', {
  retry: {
    count: 3,                 // Maximum retry attempts
    delay: 300,               // Initial backoff delay (ms)
    maxDelay: 5000,           // Maximum backoff cap (ms)
    backoff: 'exponential',    // 'exponential' | 'linear'
    statusCodes: [408, 429, 502, 503, 504],
    onRetry: (err, attempt, delay) => {
      console.warn(`Retry attempt ${attempt} after ${delay}ms`);
    },
  },
});
```

> [!WARNING]
> **Mutation Safety Policy**: State-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`) are **never** retried automatically by default. This prevents duplicate side effects (e.g. charging a credit card multiple times). If an endpoint is proven idempotent, you may explicitly pass `retryMutations: true`.

### 12.3 Fragment Batch Refresh Timeout & Lifecycle Callbacks
All SSR fragment batch refreshes have a default timeout of 15,000ms. In addition, `refresh()` accepts a 3rd parameter options object supporting timeout, declarative lifecycle callbacks (`onSuccess`, `onFailure`, `onSettled`), and error handling controls:

```ts
await ctx.refresh('dashboard', { view: 'monthly' }, {
  timeout: 8000, // custom timeout in ms

  // Invoked on successful fragment fetch and morph
  onSuccess(res) {
    state.appliedView = 'monthly';
    state.lastUpdated = new Date().toLocaleTimeString();
  },

  // Invoked on network error, HTTP 5xx, or timeout (suppresses uncaught promise rejection by default)
  onFailure(err) {
    state.errorMessage = err.message;
    state.hasFailed = true;
  },

  // Always invoked after completion (whether succeeded or failed)
  onSettled(res, err) {
    state.isLoading = false;
  },

  // Set to true if you want the promise to reject even when onFailure is provided
  throwOnError: false,
});
```

#### Dual Paradigm: Callbacks vs Promise Await
Both styles work seamlessly and can even be combined:
```ts
// 1. Declarative Callback Style
await ctx.refresh('todos-list', nextFilters, {
  onSuccess() {
    state.applied = nextFilters;
    state.page = 1;
  },
});

// 2. Direct Promise & res.ok Inspection
const res = await ctx.refresh('todos-list', nextFilters);
if (res.ok) {
  state.applied = nextFilters;
  state.page = 1;
}
```

### 12.4 Declarative Expression Logic
Datastar attributes (`data-w-show`, `data-w-class`, `data-w-disabled`, etc.) support standard boolean logic operators (`&&`, `||`, `!`) and parenthesized grouping without `eval`:
```html
<div data-w-show="isLoaded && !hasError">Dashboard Ready</div>
<div data-w-show="status === 'active' || status === 'pending'">In Progress</div>
<div data-w-show="(role === 'admin' || role === 'owner') && isVerified">Restricted Actions</div>
```

### 12.5 Controller Error Boundaries
Catch and handle action throws, async rejections, and task errors with structured boundaries:
```ts
export default defineController({
  name: 'cart',

  // Definition-level error hook
  onError(err, ctx, meta) {
    console.error(`[${ctx.name}] Action ${meta.action} failed:`, err);
  },

  actions: {
    checkout({ api, lastError, clearError }) {
      clearError();
      return api.post('/api/checkout');
    },
  },
});
```
- **`ctx.lastError`**: Accessible inside actions and lifecycle hooks.
- **`ctx.clearError()`**: Resets `ctx.lastError`.
- **`ctx.onError(listener)`**: Dynamic listener with automatic disconnect cleanup.
- **`w-controller:error` DOM Event**: Bubbles up the DOM tree, allowing parent elements or global handlers to catch and report errors.

---

## 13. Client Storage & State Persistence (`core/client/storage`)

Webspresso provides a zero-dependency, namespace-isolated, quota-safe Client Storage API supporting `localStorage`, `sessionStorage`, and an in-memory `MemoryStorage` fallback for SSR and headless test environments.

### 13.1 StorageAdapter & Namespacing (`createClientStorage`)

Access storage via `createClientStorage` or the pre-configured `defaultStorage` singleton:

```ts
import { defaultStorage } from 'webspresso/client';

// Local storage with 'w:' prefix (e.g. 'w:theme')
defaultStorage.local.set('theme', 'dark');
const theme = defaultStorage.local.get('theme', 'light');

// Session storage
defaultStorage.session.set('wizard_step', 2);

// Controller-scoped storage (e.g. 'w:cart:items')
const cartStorage = defaultStorage.scoped('cart');
cartStorage.local.set('items', [{ id: 101, qty: 1 }]);
```

#### Key Safety Invariants:
- **Prefix Isolation**: All keys are prefixed with `w:` (or a custom prefix). Calling `adapter.clear()` **only removes keys belonging to its own namespace**, preserving third-party tokens and Google Analytics storage.
- **Safe JSON Serialization**: Complex objects, arrays, numbers, and booleans are serialized and deserialized automatically. If stored data is corrupted or plain text, it safely falls back to the raw string.
- **Quota & Permission Resilience**: If `localStorage` throws `QuotaExceededError` or is blocked by private browsing mode, calls return `false` or fallback defaults gracefully without crashing the UI.

### 13.2 Declarative Controller State Persistence (`persist`)

Controllers can declare which state properties automatically hydrate on mount and sync back to storage on mutation:

```ts
import { defineController } from 'webspresso/client';

export default defineController({
  name: 'product-filters',
  state: () => ({
    search: '',
    category: 'all',
    inStockOnly: false,
    resultsCount: 0, // untracked
  }),

  // Declarative persistence options
  persist: {
    keys: ['search', 'category', 'inStockOnly'],
    storage: 'local', // 'local' | 'session' | 'memory'
    debounce: 100,    // debounce storage writes (ms, default 50)
  },

  actions: {
    reset(ctx) {
      ctx.state.search = '';
      ctx.state.category = 'all';
      ctx.state.inStockOnly = false;
      ctx.clearPersistedState(); // cleans up stored record
    },
  },
});
```

- **Shorthand Syntax**:
  - `persist: ['search', 'category']` (persists to `local` storage by default).
  - `persist: 'session'` (persists all state keys to `session` storage).
- **Programmatic Context Storage**: Inside any action or lifecycle hook, access `ctx.storage.local`, `ctx.storage.session`, `ctx.storage.memory`, or `ctx.storage.global`.
- **Cleanup**: `ctx.clearPersistedState()` removes the controller's stored record from storage.

### 13.3 Form Draft Persistence (`data-w-persist-draft`)

Prevent accidental data loss when users refresh or navigate away from long forms:

```html
<form data-w-form="articleForm" data-w-persist-draft="local">
  <input type="text" name="title" required>
  <textarea name="content" rows="6"></textarea>

  <!-- Passwords and sensitive fields are automatically excluded -->
  <input type="password" name="current_password">

  <!-- Explicit opt-out for specific inputs -->
  <input type="text" name="captcha" data-w-no-draft="true">

  <button type="submit">Publish Article</button>
</form>
```

#### Behavior & Features:
1. **Auto-Restoration**: On form initialization, if a saved draft exists, values are populated into the form inputs and a bubbling `w-form:draft-restored` event is dispatched.
2. **Auto-Saving**: Any change or input event debounces and saves the form draft to `localStorage` or `sessionStorage`.
3. **Sensitive Field Exclusion**: Form draft persistence **strictly excludes**:
   - `input[type="password"]`
   - `input[type="file"]`
   - Inputs with `data-w-no-draft="true"` or `data-w-persist="false"`
4. **Auto-Clearing on Success**: Once the form successfully submits via `ctx.forms('articleForm').submit()`, the draft is automatically erased from storage.
5. **Programmatic Form Handle API**:
   ```ts
   const form = ctx.forms('articleForm');
   form.hasDraft;      // boolean
   form.saveDraft();   // manually trigger draft save
   form.restoreDraft();// manually re-apply draft
   form.clearDraft();  // clear stored draft
   ```

### 13.4 Fragment Input Persistence (`data-w-persist-input`)

Maintain filter state across page reloads or tab navigation by persisting fragment parameters:

```html
<div
  data-w-fragment="dashboardMetrics"
  data-w-persist-input="session"
  data-w-fragment-input='{"timeframe":"30d","currency":"USD"}'>
  <!-- Fragment HTML content -->
</div>
```

- When the page loads, if `data-w-fragment-input` is empty or defaults, the fragment coordinator checks storage and restores previously selected inputs (`timeframe`, `currency`).
- Whenever the fragment is refreshed via `ctx.refresh('dashboardMetrics', { timeframe: '90d' })`, the updated parameters are automatically saved to storage.
- Coordinator helpers:
  ```ts
  // Read stored parameters
  const saved = coordinator.getStoredInput('dashboardMetrics');

  // Clear stored parameters
  coordinator.clearStoredInput('dashboardMetrics');
  ```






# Client Behavior Layer, SSR Fragments & Typed Forms (`.agents/CLIENT.md`)

This guide covers Webspresso's Datastar-powered, SSR-integrated, strongly-typed client behavior layer (`core/client`), from interactive controllers to production asset bundling.

---

## 1. File Conventions & Boundaries

- **Co-Located Client Files**: Place browser behavior files alongside pages or views using `.client.ts` or `.client.js` (e.g. `pages/notes.client.ts`, `views/components/dropdown.client.ts`).
- **Route Exclusion**: `.client.js`, `.client.ts`, and `.d.ts` files are automatically excluded from SSR page and API route registration (`isClientBrowserFile`).
- **Server Import Boundary**: NEVER import server-only modules (`fs`, `knex`, `core/orm`, `models/`, `services/`, or server page loaders) inside `.client.*` files. `import type` is allowed in `.client.ts`.
- **Deterministic Controller Naming**:
  - `pages/notes.client.ts` → `notes`
  - `pages/settings/profile.client.ts` → `settings--profile`
  - `views/components/dropdown.client.ts` → `dropdown`
  - Duplicate resolved controller names without an explicit `defineController({ name })` fail at build/doctor time with `CONTROLLER_NAME_COLLISION`.

---

## 2. Two Explicit Data Flows & Single-Owner Rule

1. **Server-Managed View (`defineFragment` + `fsy.fragment` + `invalidate`)**:
   - Declare fragments in `pages/*.js` with `defineFragment({ template, dependsOn, schema, auth, middleware, load })`.
   - Render in Nunjucks via `{{ fsy.fragment('list', input) }}`.
   - Mutations return `apiResult(data, { invalidate: ['notes'] })` or `ctx.result(data, { invalidate: ['notes'] })`.
   - Invalidation headers (`X-Webspresso-Invalidate`) are emitted **only after successful execution and after ambient ORM transaction commit**.
2. **Client-Managed Data (`defineController` + `api.*`)**:
   - Explicitly call `await ctx.api.get('/api/notes/stats')` inside a controller action or lifecycle-bound task.
3. **Single Ownership Rule**:
   - A DOM value is owned by **either** a server fragment **or** a client binding (`data-w-text`, `data-w-show`, `data-w-disabled`, `data-w-model`), **never both**.
   - During fragment DOM morphing, attributes/values owned by client bindings (`data-w-*`) or dirty user-edited form inputs are preserved and never overwritten by server HTML.

---

## 2.1 Multi-Fragment Architecture & Inter-Fragment Communication

When multiple SSR fragments exist on a single page:

1. **Fragment Name vs Instance ID**:
   - `data-w-fragment="name"` indicates the fragment definition to invoke on the server.
   - `data-w-fragment-id="instanceId"` distinguishes distinct instances on the page (e.g. `list:default`, `list:sidebar`).
2. **Parent-Child Deduplication (`deduplicateParentChildFragments`)**:
   - If fragment B is nested inside fragment A's DOM subtree and both are invalidated by the same mutation tag, **fragment B is automatically dropped from the outgoing network request**.
   - Only fragment A is requested. Because rendering fragment A on the server inherently renders fragment B, this avoids duplicate SQL queries, dual network roundtrips, and conflicting DOM patch races.
3. **Communication Channels Between Fragments**:
   - **Tag Invalidation (`dependsOn`)**: Decoupled, multi-fragment refresh coalesced into a single `POST /__webspresso/fragments` HTTP call.
   - **Request Memoization (`ctx.memo`)**: Co-refreshed fragments share cached loaders/queries within the same request lifecycle.
   - **Programmatic Control (`ctx.refresh` / `ctx.fragment`)**: A controller can read another fragment's active input via `ctx.fragment('ordersList').input` or trigger a reload with new parameters: `await ctx.refresh('ordersList', { limit: 20 })`.
   - **DOM CustomEvents (`ctx.emit` / `ctx.on`)**: Controllers within sibling fragments communicate via decoupled custom events (e.g. `ctx.emit('category:selected', { id })` and `ctx.on(window, 'category:selected', ...)`).

---

## 3. Two-Way Data Binding (`data-w-model`)

Replace manual DOM reading/writing (`target('searchInput')?.value`, `input.value = ''`) with declarative `data-w-model="path"`:

```html
<input type="text" data-w-model="draft.search">

<select data-w-model="draft.status">
  <option value="all">All</option>
  <option value="active">Active</option>
</select>

<input type="number" data-w-model="draft.age">
<input type="checkbox" data-w-model="draft.agree">
<textarea data-w-model="draft.notes"></textarea>
```

### Invariants & Coercion Rules:
- **Nested Dot-Path Support**: Resolves and mutates nested state paths (`draft.search`, `filter.priority.level`).
- **Initial Value Ownership**: When controller `state` defines a value (including `null`, `false`, `0`, `''`), state is authoritative. Only if state is `undefined` will it seed from the server-rendered DOM value.
- **Empty Number Behavior**: Empty number inputs convert explicitly to `null`, never silent `0`.
- **IME / Composition Guard**: Typing during IME composition (`compositionstart`) does not fire model updates until `compositionend`.
- **File Input Exclusion**: File inputs are excluded from programmatic value bindings for browser security.
- **Loop Prevention**: Programmatic updates avoid infinite event/state loops.
- **`target()` API Preserved**: Keep `ctx.target(name)` and `ctx.targets(name)` strictly for focus, scrolling, layout measurement, and third-party widgets.

### 3.1 Enhanced Element `.data()` API (`actionEl` & `ctx.target`)
All action elements (`actionEl` passed as 3rd arg to actions) and targets (`ctx.target(name)`) provide a chainable, type-coerced `.data(key?, val?)` helper:
```ts
actions: {
  selectItem(ctx, event, actionEl) {
    // 1. Read with automatic primitive coercion (numbers, booleans, JSON)
    const id = actionEl.data('id');              // 42 (number)
    const active = actionEl.data('is-active');   // true (boolean)
    const activeCamel = actionEl.data('isActive'); // true (camelCase alias)

    // 2. Read all data attributes as an object
    const all = actionEl.data();                 // { id: 42, isActive: true }

    // 3. Chainable setter
    actionEl.data('status', 'selected');

    // 4. Also available on targets!
    ctx.target('badge').data('count', 10);
  },
}
```

---

## 4. Draft vs Applied Filter Pattern

For search/filter toolbars, maintain separate `draft` and `applied` states:

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
      await refresh('list', { ...next, page: 1 }, {
        onSuccess() {
          state.applied = next;
          state.page = 1;
        },
      });
    },
    async nextPage({ state, refresh }) {
      const next = state.page + 1;
      await refresh('list', { ...state.applied, page: next }, {
        onSuccess() {
          state.page = next;
        },
      });
    },
    async resetFilters({ state, refresh }) {
      const initial = { search: '', status: 'all', priority: 'all' };
      await refresh('list', { ...initial, page: 1 }, {
        onSuccess() {
          state.draft = { ...initial };
          state.applied = { ...initial };
          state.page = 1;
        },
      });
    },
  },
});
```
- Inputs bind to `draft.*`.
- Pagination refreshes strictly with `applied.*`.
- Failed refresh does not claim draft values as successfully displayed.
- Do not guess pagination bounds; rely on server-rendered pagination indicators.

---

## 5. Derived Values (`computed`)

Compute summary texts and display badges reactively without manual synchronization:

```ts
export default defineController({
  state: () => ({
    applied: { search: '', status: 'all' },
    page: 1,
  }),
  computed: {
    filterSummaryText: ({ state }) =>
      `Showing: ${state.applied.status} • Page ${state.page}`,
    isFirstPage: ({ state }) => state.page === 1,
  },
});
```

### Invariants:
- **Read-Only**: Attempting to assign `state.myComputed = 'foo'` throws a `TypeError`.
- **Reactive Tracking**: Backed by Datastar signals. When underlying state or task signal updates, computed values re-evaluate automatically.
- **Side-Effect Free**: Mutating state or initiating network requests inside a computed getter throws an `Error`.
- **No Name Collision**: Defining the same key in both `state` and `computed` throws during validation.
- **Instance Isolated**: Computed values of instance A never leak to instance B.
- **Lifecycle Cleanup**: Automatically cleaned up on controller unmount.

---

## 6. Typed Form Handle (`createFormHandle` / `ctx.forms`)

Enables programmatic form manipulation without direct element reading/writing:

```ts
const form = ctx.forms.get('edit-todo');

// 1. Programmatic fill
form.fill({ title: 'New title' }); // marks dirty = true, retains baseline

// 2. Baseline fill (loading record from API)
form.fill(todo, { baseline: true }); // sets new baseline, dirty = false, clears errors

// 3. Reset reverts to baseline
form.reset();

// 4. Update action endpoint and disabled state
form.setAction(`/api/todos/${todo.id}`);
form.disabled = true; // prevents submit while loading

// 5. Normalized values read
const values = form.read(); // or form.values
```

### Form Semantics:
- `fill(values)` by default modifies field values without changing baseline.
- `fill(record, { baseline: true })` designates the record as the new baseline, resets `dirty = false`, and clears previous validation errors.
- `reset()` reverts all controls back to the active baseline.
- `clear()` empties all controls to blank state.
- Form values are NOT duplicated into controller state.

---

## 7. Client-Driven Edit Record Selection

When selecting an item from a list to edit, embed only the record ID:

```html
<button data-w-on:click="selectTodoForEdit" data-todo-id="{{ item.id }}">Edit</button>
```

```ts
async selectTodoForEdit({ state, forms, api }, _event, actionEl) {
  const id = actionEl.getAttribute('data-todo-id');
  if (!id || !id.trim()) return;

  const form = forms.get('edit-todo');
  if (!form) return;

  // Protect user's unsaved draft
  if (form.dirty && !window.confirm('Discard unsaved draft?')) return;

  state.selectedTodoId = Number(id);

  // Fetch record with stale response guard ('latest')
  const todo = await api.get(`/api/todos/${id}`, { concurrency: 'latest' });
  if (!todo || form.dirty) return;

  form.setAction(`/api/todos/${todo.id}`);
  form.fill(todo, { baseline: true });
}
```
- Rapid selection A → B: `concurrency: 'latest'` ensures stale response from A is ignored.
- In-flight dirty guard: if user edits during fetch, the response will not overwrite dirty input.
- Endpoint action URL is updated via `form.setAction()`.

---

## 8. Lifecycle-Bound Async Tasks (`tasks`)

Centralize `loading`, `error`, `data`, stale response guards, and abort controllers into a declarative task:

```ts
export default defineController({
  tasks: {
    insights: ({ api }) => ({
      run: () => api.get('/api/todos/insights'),
      concurrency: 'latest', // 'latest' | 'drop' | 'queue' | 'parallel'
    }),
  },
  computed: {
    hasInsights: ({ tasks }) => Boolean(tasks.insights?.data),
    headline: ({ tasks }) => tasks.insights?.data?.headline || '',
  },
  actions: {
    async loadInsights({ tasks }) {
      await tasks.insights.run();
    },
  },
});
```

### Task Invariants:
- Exposes reactive signals: `pending`, `running`, `data`, `error`, `stale`, `run()`, `cancel()`, `dispose()`.
- HTML template binding: `data-w-disabled="tasks.insights.pending"`, `data-w-show="hasInsights"`.
- Older request completing never prematurely clears `pending` of a newer running request.
- Automatically disposed on controller unmount.

---

## 8.1 Vue-Style Reactive Watchers (`watch`)

Webspresso controllers support Vue-style reactive watchers with getter functions, dot-paths, array sources, and side-effect cleanups:

```ts
import { defineController, watch } from 'webspresso/client';

export default defineController({
  state: () => ({
    status: 'idle',
    race: { status: 'idle', count: 0 },
  }),

  connect({ state, watch }) {
    let frame = 0;
    function stop() {
      if (frame) cancelAnimationFrame(frame);
    }
    function step() { /* ... */ }

    // Matches Vue 3 watch semantics:
    watch(
      () => state.race.status === 'running',
      (running) => {
        stop();
        if (running) frame = requestAnimationFrame(step);
      },
      { immediate: true },
    );
  },

  // Declarative watcher definition option:
  watch: {
    'race.count': {
      handler(newCount, oldCount) {
        if (newCount >= 100) this.actions.finish();
      },
      immediate: true,
      deep: true,
    },
  },
});
```

### Watcher Capabilities:
- **Getter function source**: `() => state.property === value`
- **Dot-path source**: `'race.status'` or `'filters.category'`
- **Array of sources**: `[() => state.a, () => state.b]`
- **Callback**: `(newValue, oldValue, onCleanup) => void`
- **Side-effect cleanup**: `onCleanup(() => { /* abort, cancel */ })`
- **Options**: `{ immediate: true, deep: true, once: true }`
- **Untracked execution**: Accessing state inside the callback does not register unwanted dependencies
- **Lifecycle cleanup**: Automatically cleaned up on controller disconnect/destroy

---

## 9. Typed API Client & `.webspresso/api.d.ts`

- When route manifests are generated, `api.get('/api/todos/insights')` automatically derives its response type from `AppApiRouteMap`.
- Falls back safely to `unknown` escape hatch when dynamic.
- Client input schemas and server output schemas are strictly separated.
- `defineController` uses the non-inferable `NoInfer` pattern (`[TState][0]`) so action parameters destructure `{ state, forms, api, tasks }` with 100% type safety.

---

## 10. Asset Bundling & Production Deployment

### 10.1 Development vs Production Architecture

| Mode | Asset Delivery | Bundler / Transpiler | Manifest & Caching |
| :--- | :--- | :--- | :--- |
| **Dev Mode** | `webspresso dev` / `npm run dev` | esbuild `context()` API (or fallback) with sub-millisecond incremental rebuilds | Watched; live-reloaded via SSE (`devReloadHub`) |
| **Standalone Demo** | `http://localhost:3456/js/client-demo.js` | Built-in zero-dependency TypeScript transpiler in `server.js` | Single un-hashed bundle used **only** for the self-contained demo |
| **Production Build** | `webspresso build` (or `webspresso build:assets`) | Production esbuild minification, tree-shaking, content hashing (`[dir]/[name].[hash].js`) | `public/dist/manifest.json` with immutable cache headers |

> [!IMPORTANT]
> **Is `http://localhost:3456/js/client-demo.js` used in production?**
> **NO.** `client-demo.js` is strictly an example-specific helper (`examples/client-behavior/server.js`) designed to let the demo run independently with zero external build tools or pre-compilation steps.
> In a production Webspresso application, client behavior files are compiled into optimized, content-hashed bundles via `npx webspresso build`.

### 10.2 Production Build Workflow (`npx webspresso build`)

1. **Automatic Entrypoint Discovery (`src/bundle/index.js`)**:
   - Main entry: `src/client/main.{js,ts}` or `src/client/index.{js,ts}`
   - Page controllers: `pages/**/*.client.{js,ts,jsx,tsx}` or `src/pages/**/*.client.*`
   - Component controllers: `views/**/*.client.{js,ts,jsx,tsx}` or `src/views/**/*.client.*`
2. **Server Boundary Enforcement (`createServerBoundaryPlugin`)**:
   - Statically verifies and blocks any client code from importing server-only modules (`knex`, `better-sqlite3`, `express`, `services/*`, `models/*`, `core/orm/*`, or server page loaders).
3. **Content Hashing & Manifest Generation**:
   - Emits fingerprinted bundles into `public/dist/`:
     - `public/dist/main.8f2a1b.js`
     - `public/dist/pages/todos.3c9d4e.js`
   - Generates `public/dist/manifest.json`.
4. **Nunjucks Template Resolution**:
   - In layouts and templates, use built-in asset helpers:
     ```html
     <!-- Main application client runtime -->
     <script type="module" src="{{ fsy.js('main.js') }}"></script>

     <!-- Page-specific controller bundle -->
     <script type="module" src="{{ fsy.asset('pages/todos.js') }}"></script>
     ```
   - In production, `fsy.js()` / `fsy.asset()` automatically resolves the hashed file from `manifest.json`.
   - In development, it falls back to the unhashed file path.
5. **HTTP 103 Early Hints Integration**:
   - When Early Hints are enabled (`createApp({ earlyHints: true })`), Webspresso automatically emits `103 Early Hints` for the hashed client bundle before async SSR `load()` finishes, maximizing FCP and TTFB performance.
6. **Vite / External Bundler Support**:
   - If using Vite or Webpack, point Webspresso to the generated manifest:
     ```js
     createApp({
       assets: {
         manifestPath: 'public/dist/.vite/manifest.json',
         prefix: '/dist/',
       },
     });
     ```

---

## 11. Bundle Size & Browser Support Matrix

- **Runtime Size (Zero External Dependencies)**:
  - Full client runtime (`webspresso/core/client` = signals + forms + API client + SSR fragment reconciler + lifecycle tasks + two-way binding): **~26 KB Gzip** / **~21.8 KB Brotli** (~75 KB minified).
  - Lite client runtime (`webspresso/client/lite` = SSR fragments + native forms + API client, without reactive signals engine): **~9.5 KB Gzip** / **~8.2 KB Brotli** (~30 KB minified).
  - Datastar Signals & DOM Adapter alone: **~10.8 KB Gzip** / **~9.4 KB Brotli**.
- **A-la-Carte Subpath Exports**:
  - `webspresso/client` → Full suite (`bootClient`, `defineController`)
  - `webspresso/client/lite` → Micro-footprint server-driven runtime (`bootLiteClient`, `createFormHandle`, `invalidate`)
  - `webspresso/client/fragments` → Pure fragment coordinator and morphing
  - `webspresso/client/forms` → Native form enhancement and validation
- **Browser Compatibility**:
  - Chrome 80+, Safari 14+ (macOS & iOS), Firefox 78+ ESR / 80+, Edge 80+.
  - Global web traffic coverage: **>97.8%**.
  - Required primitives: `Proxy` (ES2015), `AbortController`, `MutationObserver`, `fetch`, `FormData`, `CustomEvent`, `template`.
  - IE11 is not supported (Proxy cannot be fully polyfilled).
- **Progressive Enhancement**:
  - Webspresso is 100% HTML-First SSR. If JS is disabled or fails to load, server HTML renders with 0ms delay, and standard HTML `<form>` submits continue working natively via HTTP POST.

---

## 12. Client Resilience & Error Boundaries

### 12.1 Fetch Request Timeout (`timeout`)
Prevent hanging network requests by specifying `timeout` (in milliseconds) on any `ctx.api` call:
```ts
// Aborts via AbortController after 5000ms if server does not respond
const data = await ctx.api.get('/api/reports/analytics', { timeout: 5000 });
```
When a timeout occurs, `ctx.api` throws a structured `ClientRequestError` with:
- `err.kind === 'timeout'`
- `err.isTimedOut === true`
- `err.status === 408`
- `err.code === 'REQUEST_TIMED_OUT'`

### 12.2 Idempotent Retry Engine (`retry`)
Safely retry transient failures on idempotent `GET` and `HEAD` requests:
```ts
// Retries up to 3 times with exponential backoff + randomized jitter
const stats = await ctx.api.get('/api/stats', {
  retry: {
    count: 3,
    delay: 300,        // base backoff delay (ms)
    maxDelay: 5000,    // maximum backoff delay (ms)
    backoff: 'exponential', // 'exponential' | 'linear'
    statusCodes: [408, 429, 502, 503, 504], // transient HTTP status codes
    onRetry: (err, attempt, delay) => {
      console.warn(`Retrying request (attempt ${attempt}) after ${delay}ms:`, err);
    },
  },
});
```
> [!IMPORTANT]
> **Strict Mutation Protection**: Mutations (`POST`, `PUT`, `PATCH`, `DELETE`) are **NEVER** retried automatically by default, even if `retry` is passed. Automatic retries on state-changing endpoints can duplicate side effects (e.g. charging a payment twice). To explicitly opt into retrying an idempotent mutation, pass `retryMutations: true`.
> Requests that are aborted, superseded by newer requests (`policy: 'latest'`), or dropped (`policy: 'drop'`) are **never** retried.

### 12.3 Fragment Batch Refresh Timeout & Lifecycle Callbacks
Fragment batch refreshes enforce a default timeout of 15,000ms. In addition, the 3rd parameter options object supports declarative lifecycle callbacks (`onSuccess`, `onFailure`, `onError`, `onSettled` / `onComplete`):
```ts
// Declarative callbacks with custom timeout
await ctx.refresh('feed', { page: 1 }, {
  timeout: 8000,
  onSuccess(res) {
    state.page = 1;
    console.log('Feed loaded:', res.refreshed);
  },
  onFailure(err) {
    state.errorMessage = err.message; // Suppresses uncaught rejection by default
  },
  onSettled(res, err) {
    state.loading = false;
  },
  throwOnError: false, // Set to true to re-throw after calling onFailure
});

// Or direct promise inspection
const res = await ctx.refresh('feed', { page: 1 });
if (res.ok) {
  state.page = 1;
}
```

### 12.4 Declarative Expression Logic (`&&`, `||`, Parentheses)
`data-w-show`, `data-w-class`, and other declarative Datastar attributes support logical operators with standard operator precedence and short-circuit evaluation:
```html
<!-- Logical AND with negation -->
<div data-w-show="isReady && !hasError">Ready to go!</div>

<!-- Logical OR with comparisons -->
<span data-w-show="status === 'active' || status === 'pending'">Processing</span>

<!-- Operator precedence & parenthesized grouping -->
<div data-w-show="(role === 'admin' || role === 'editor') && isVerified">Staff Access</div>

<!-- String literals with operator characters are preserved without false splits -->
<div data-w-show="category === 'Rock && Roll'">Music Category</div>
```

### 12.5 Controller Error Boundary (`onError` & `w-controller:error`)
Controllers provide isolated error boundaries for synchronous and asynchronous action throws and task failures:
```ts
export default defineController({
  name: 'profile-editor',
  state: () => ({ saving: false }),

  // 1. Definition-level error boundary
  onError(err, ctx, meta) {
    console.error(`[${ctx.name}] Error during ${meta.phase}:`, err);
    // ctx.lastError is automatically recorded
  },

  actions: {
    async save({ state, api, lastError, clearError }) {
      clearError(); // reset last error
      await api.post('/api/profile', { ... });
    },
  },
});
```
- **Context Access**: Read the most recent error via `ctx.lastError` and reset via `ctx.clearError()`.
- **Dynamic Listeners**: Attach dynamic listeners with `ctx.onError((err, meta) => void)` which automatically unregister on disconnect.
- **DOM Bubbling Event**: When an error occurs, `rootEl` dispatches a bubbling `w-controller:error` `CustomEvent` (`evt.detail = { error, controllerName, instanceId, action, phase }`) that can be caught at any container boundary or by global loggers.

---

## 13. Client Storage & State Persistence (`core/client/storage`)

Webspresso includes a zero-dependency, namespaced, quota-safe storage abstraction for offline resilience, form draft preservation, and state hydration.

### 13.1 Namespacing & Safety
- **Prefix Isolation**: All entries default to `w:` namespace (`w:<key>` or `w:<controller>:<key>`). Calling `adapter.clear()` only purges keys matching the adapter's prefix, never disturbing third-party browser storage.
- **Zero-Crash Resilience**: Catches `QuotaExceededError`, security/permission blocks, or corrupted JSON strings, falling back safely without unhandled exceptions.
- **SSR / Node.js Mocking**: In non-browser environments, seamlessly utilizes an in-memory `MemoryStorage` backend.

### 13.2 Declarative Controller State Persistence (`persist`)
```ts
export default defineController({
  name: 'filters',
  state: () => ({ search: '', category: 'all', page: 1 }),

  // Persist specific keys to localStorage with 50ms write debounce
  persist: {
    keys: ['search', 'category'],
    storage: 'local', // 'local' | 'session' | 'memory'
    debounce: 50,
  },

  actions: {
    reset(ctx) {
      ctx.state.search = '';
      ctx.state.category = 'all';
      ctx.clearPersistedState(); // Clears stored entry
    },
  },
});
```

### 13.3 Programmatic Context Storage (`ctx.storage`)
- `ctx.storage.local`: Scoped to `w:<controllerName>:` in `localStorage`.
- `ctx.storage.session`: Scoped to `w:<controllerName>:` in `sessionStorage`.
- `ctx.storage.memory`: In-memory volatile store.
- `ctx.storage.scoped(sub)`: Further nested sub-namespaces (e.g. `w:<controllerName>:<subprefix>:`).
- `ctx.storage.global`: Root application storage (`w:` prefix).

### 13.4 Form Draft Persistence (`data-w-persist-draft`)
```html
<form data-w-form="checkout" data-w-persist-draft="session">
  <input type="text" name="shipping_address">
  <!-- Sensitive fields are automatically excluded -->
  <input type="password" name="password">
  <input type="file" name="attachment">
  <input type="text" name="cvv" data-w-no-draft="true">
  <button type="submit">Submit</button>
</form>
```
- Restores draft on mount and emits bubbling `w-form:draft-restored` event.
- Excludes passwords, file inputs, and fields marked `data-w-no-draft="true"`.
- Clears draft automatically on successful submit.
- Programmatic API on form handle: `form.saveDraft()`, `form.restoreDraft()`, `form.clearDraft()`, `form.hasDraft`.

### 13.5 Fragment Input Persistence (`data-w-persist-input`)
```html
<div data-w-fragment="ordersList" data-w-persist-input="session">
  <!-- Contents -->
</div>
```
- Hydrates fragment input parameters from storage on initial mount if server HTML provides empty defaults.
- Updates storage automatically when fragment is refreshed with new inputs.
- Coordinator access: `coordinator.getStoredInput('ordersList')`, `coordinator.clearStoredInput('ordersList')`.




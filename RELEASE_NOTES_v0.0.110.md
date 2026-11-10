# Webspresso v0.0.110 Release Notes

**Release Date:** November 10, 2026  
**Tag:** `v0.0.110`

Webspresso v0.0.110 is a major feature, security, and developer experience release. This version introduces a Vue-style reactive `watch` API, a zero-dependency Client DevTools dock and inspector, a robust client state and storage persistence layer, enhanced DOM manipulation ergonomics with `.data()`, SSR fragment lifecycle hooks, and critical security patches across routing, query parsing, and rate limiting.

---

## 🚀 Key Highlights & New Features

### 1. Vue-Style Reactive `watch` API (`core/client`)
Webspresso now brings the familiarity and power of Vue 3's reactive `watch` API directly to server-rendered client behaviors.

- **Flexible Source Selection**: Watch a getter function `() => state.property`, a dot-delimited path string `'user.profile.name'`, the entire reactive state object, or an array of multiple sources `[() => a.val, () => b.val]`.
- **`onCleanup` Side-Effect Cancellation**: The watcher callback receives `(newValue, oldValue, onCleanup)`, allowing you to easily cancel in-flight HTTP requests via `AbortController`, clear animation frames, or clear timers when the observed dependency changes before completion.
- **Rich Configuration Options**:
  - `immediate: true`: Triggers the callback immediately upon creation with the initial value.
  - `deep: true`: Recursively tracks nested object mutations.
  - `once: true`: Automatically disposes and unwatches after the first trigger.
  - `flush`: Control execution timing (`'pre'`, `'post'`, or `'sync'`).
- **Untracked Callback Execution**: Callbacks run in an untracked reactive context, preventing infinite loops when mutating other state properties inside watcher handlers.
- **Teardown**: Calling the returned `stop()` function cleans up the listener immediately.

```typescript
import { defineController } from 'webspresso/client';

export default defineController({
  state: {
    status: 'idle',
    query: '',
    results: []
  },
  setup({ state, watch }) {
    // Watch search query with automatic debounce and request cancellation
    watch(
      () => state.query,
      async (newQuery, oldQuery, onCleanup) => {
        if (!newQuery.trim()) {
          state.results = [];
          return;
        }

        const controller = new AbortController();
        onCleanup(() => controller.abort());

        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(newQuery)}`, {
            signal: controller.signal
          });
          state.results = await res.json();
        } catch (err) {
          if (err.name !== 'AbortError') console.error(err);
        }
      },
      { immediate: false }
    );
  }
});
```

---

### 2. Client DevTools Dock & Inspector (`core/client/devtool`)
An interactive, zero-dependency visual debugging dock for local development (`isDev: true`), embedded entirely inside an isolated Shadow DOM to guarantee zero stylesheet leakage.

- **Floating Launcher Pill**: Discreet floating badge (`⚡ Webspresso`) at the bottom-right corner, toggled via mouse click or the `Alt + W` (`Option + W` on macOS) keyboard shortcut.
- **Controllers Tab**:
  - Inspect all mounted client controllers and their active reactive state trees.
  - View registered targets and action triggers.
  - Click **"Inspect in DOM"** to smoothly scroll to and highlight target elements with an animated pulse ring.
- **Fragments Tab**:
  - Inspect all active SSR fragments on the page and their associated DOM container nodes.
  - Trigger manual on-demand fragment re-renders directly from the dock.
  - Monitor fragment error boundary states and recovery fallbacks.
- **Network & Causal Chains Tab**:
  - Real-time event log tracking user actions, state mutations, and SSR fragment HTTP fetch requests.
  - Inspect response statuses, durations, and payload sizes.
- **Storage Tab**:
  - Live inspector for `localStorage` and `sessionStorage`.
  - Filter by `w:*` Webspresso namespaces with instant clear and refresh actions.
- **Webspresso Studio & Server Bridges**:
  - Direct quick-links to Webspresso DB Studio (`/_studio`), Mithril.js Admin Panel (`/_admin`), and Prometheus Telemetry (`/metrics`).
- **Redux DevTools Extension Integration**:
  - Automatically bridges into the browser's Redux DevTools extension (`window.__REDUX_DEVTOOLS_EXTENSION__`) when available, providing time-travel debugging and action history.
- **Programmatic Control**: Full runtime API exposed on `window.__WEBSPRESSO_DEVTOOLS__`.

---

### 3. Client Storage & State Persistence (`core/client/storage`)
Persistent state management without external dependencies:

- **Universal Storage Abstraction**: `createClientStorage({ prefix, driver, ttl })` supporting `localStorage`, `sessionStorage`, and in-memory fallbacks with optional TTL expiration.
- **Declarative Controller State Persistence**:
  ```javascript
  defineController({
    state: { theme: 'dark', sidebarOpen: true, counter: 0 },
    persist: {
      key: 'user-settings',
      storage: 'local', // 'local' | 'session' | CustomStorage
      pick: ['theme', 'sidebarOpen'] // select specific keys to persist
    }
  });
  ```
- **Form Draft Auto-Saving**: Automatically saves unsubmitted form inputs across page refreshes and browser crashes with automatic hydration on load and cleanup on successful submit:
  ```javascript
  defineForm({
    persist: { key: 'contact-draft', debounce: 300 }
  });
  ```
- **Fragment Storage Synchronization**: Synchronize URL search params and fragment loaders with local storage: `fragment.refresh(params, { syncWithStorage: 'filter' })`.

---

### 4. Enhanced DOM Ergonomics with `.data()`
A convenient, chainable jQuery-like data accessor directly available on event elements (`actionEl`) and controller targets (`targets`):

- **Getter**: `actionEl.data('priority')` reads `data-priority`, automatically parsing JSON values (e.g. `data-config='{"timeout":5000}'`) and converting kebab-case to camelCase.
- **Bulk Getter**: `actionEl.data()` returns an object with all parsed data attributes.
- **Setter**: `actionEl.data('status', 'active')` sets `data-status="active"`.

```javascript
actions: {
  handleClick({ actionEl }) {
    const priority = actionEl.data('priority'); // reads data-priority
    const metadata = actionEl.data('metadata'); // parses JSON automatically
    console.log('Clicked item:', priority, metadata);
  }
}
```

---

### 5. Fragment Refresh Lifecycle Hooks
The `fragment.refresh()` method now accepts an optional 3rd argument for rich lifecycle callbacks:

```javascript
await fragment.refresh(
  { category: 'tech' },
  {
    onSuccess({ data, res, fragment }) {
      console.log('Fragment refreshed successfully!', data);
    },
    onFailure({ error, res, fragment }) {
      console.warn('Failed to refresh fragment:', error);
    },
    onSettled({ ok, res, fragment }) {
      console.log('Refresh cycle finished, ok:', ok);
    }
  }
);
```

---

### 6. Client Runtime Resilience & Optimizations
- **Fetch Timeouts & Retries**: SSR fragment requests support configurable timeout limits (`timeout: 10000`) and exponential backoff retry attempts (`retry: 2`).
- **Inline Expression Directives**: Light, fast micro-expressions for `[w-show]`, `[w-class]`, `[w-text]`, and `[w-bind]`.
- **SSR Fragment Error Boundaries**: Graceful error UI fallback rendering with `onFragmentError` hooks.
- **Zero-Dependency Core**: Completely removed internal Alpine.js bundling in favor of native micro-signals while maintaining seamless optional manual Alpine.js bridge compatibility.

---

## 🛡️ Security Fixes & Hardening

This release addresses **19 GitHub CodeQL security alerts** and hardens framework boundaries:

1. **Polynomial Regular Expression Denial of Service (ReDoS)**:
   - Hardened file-based route matcher and path parameter parser against exponential backtracking using atomic grouping and input length bounds.
2. **Client-Side DOM Cross-Site Scripting (DOM XSS)**:
   - Enforced strict contextual sanitization and text escaping in dynamic HTML interpolation within client-side fragment injections and micro-expressions.
3. **Rate Limiter Proxy Spoofing**:
   - Normalized client IP parsing (IPv4-mapped IPv6 normalization) and enforced strict validation of `X-Forwarded-For` headers against configured trusted proxy subnets.
4. **Dependency Hardening (`qs`)**:
   - Upgraded `qs` from `^6.16.0` to `^6.17.1` to eliminate prototype pollution vulnerabilities.

---

## 📦 What's Changed / Commit Log

- `1305484` feat(client): add Client DevTools dock with controllers, fragments, storage, and studio bridges
- `aec5785` feat(client): add Vue-style reactive watch API with getters, options, and onCleanup
- `9870aec` fix(security): resolve code scanning alerts, redos, dom xss, rate limits, and qs vuln
- `ae715d8` feat(client): add chainable .data(key?, val?) helper to actionEl and targets
- `b281964` feat(client): add onSuccess, onFailure, and onSettled callbacks to fragment refresh
- `9299e53` feat(client): add storage adapter, controller state persistence, form drafts, and fragment input sync
- `021985c` feat(client): add fetch timeout, idempotent retries, expression logic, error boundaries, and multi-fragment docs
- `76a0db3` refactor(client): remove internal Alpine.js bundling and document manual integration
- `655c60d` chore(release): bump version to 0.0.110
- `c6c19c3` fix(ci): synchronize package-lock.json dependencies for npm ci
- `6a576ba` fix(ci): exclude browser-only devtool from test coverage and align thresholds

---

## 🚀 Upgrade Guide

```bash
npm install webspresso@0.0.110
```

No breaking changes are introduced in this release. All new features are strictly additive and backward-compatible.

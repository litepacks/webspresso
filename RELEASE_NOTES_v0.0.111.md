# Webspresso v0.0.111 Release Notes

**Release Date:** November 11, 2026  
**Tag:** `v0.0.111`

Webspresso v0.0.111 introduces Shared Lazy Client Services (`defineClientService`) with an Optional UI Host (`mountHost`), React Query-style Automatic Invalidation & Background Refetching across SSR fragments and controller tasks, Declarative Action & Task Busy States (`data-w-loading`, `data-w-loading-text`, `data-w-confirm`), and major Client Runtime bundle size and DOM synchronization optimizations.

---

## 🚀 Key Highlights & New Features

### 1. Shared Lazy Client Services & Optional UI Host (`core/client/services`, `core/client/host`)
Webspresso now provides a zero-bloat, lazy-loaded client service layer so applications can encapsulate reusable browser capabilities (toast notifications, confirmation modals, clipboard helpers, analytics, hotkeys) without adding UI widget opinions to core:

- **Lazy Singleton Initialization (`services.get(name)`)**: Services defined with `load: () => import(...)` are fetched and initialized only on first call. Concurrent `services.get('toast')` calls share the exact same in-flight promise.
- **Optional UI Host (`mountHost(name, options)`)**: Lazily creates or reuses `<div data-w-host="<name>">` on `document.body` outside SSR fragment morph regions so floating overlays survive fragment refreshes intact.
- **Zero-Manual-Typing TypeScript Inference**: Use `InferClientServicesMap<typeof services>` with `declare module 'webspresso' { interface AppClientServices ... }` for automatic end-to-end autocomplete in controllers and forms.

```typescript
import { bootClient, defineClientService, type InferClientServicesMap } from 'webspresso/client';

export const services = {
  toast: defineClientService({
    load: () => import('./services/toast'),
  }),
};

declare module 'webspresso' {
  interface AppClientServices extends InferClientServicesMap<typeof services> {}
}

bootClient({ services });
```

---

### 2. React Query-Style Automatic Invalidation & Background Refetching
SSR fragments (`defineFragment` / `[data-w-fragment]`), controller `tasks`, and `bootClient` now support automatic staleness tracking and background revalidation:

- **`staleTime`**: Duration (`number` ms or `'5s'`, `'1m'`) during which a rendered fragment or task result is considered fresh (default `0`).
- **`refetchOnWindowFocus`**: Automatically refreshes stale fragments/tasks when the user returns to the browser tab (`focus` / `visibilitychange`). Supports `true`, `false`, or `'always'`.
- **`refetchOnReconnect`**: Automatically refreshes stale fragments/tasks when network connectivity is restored (`online` event).
- **`refetchOnMount`** (alias `refetchOnVisit`): Refreshes when mounted or restored from `bfcache` (`pageshow`).
- **`refetchInterval` & `refetchIntervalInBackground`**: Periodic polling that automatically pauses when the tab is hidden unless `refetchIntervalInBackground: true` is enabled.

```html
<section
  data-w-fragment="todoList"
  data-w-stale-time="10s"
  data-w-refetch-on-focus="true"
  data-w-refetch-on-reconnect="true"
  data-w-refetch-interval="30s">
  {{ todoListHtml | safe }}
</section>
```

---

### 3. Declarative Action & Task Busy States (`data-w-loading`, `data-w-loading-text`, `data-w-confirm`)
Async controller actions and `<form data-w-form>` submissions now automatically manage element busy states and double-click protection:

- **Automatic Button Busy State & Double-Click Guard**: Triggering an async action automatically sets `data-w-busy="true"`, `aria-busy="true"`, and `disabled` on the action element, ignoring duplicate clicks until settled.
- **`data-w-loading-text` & `data-w-loading-class`**: Automatically swaps button text and toggles CSS classes while an async action or form submission is in flight.
- **`data-w-loading` & `data-w-loading-hide`**: Declaratively shows or hides spinner/status elements while any action/task (or a specific named action/task such as `data-w-loading="save"`) is running.
- **`data-w-confirm`**: Prompts confirmation before executing the bound controller action.
- **Reactive Context Helpers**: `ctx.isBusy` and `ctx.isActionBusy(actionName)` (plus `$busy` / `isBusy` in template expressions).

```html
<button
  data-w-click="save"
  data-w-confirm="Değişiklikleri kaydetmek istiyor musunuz?"
  data-w-loading-text="Kaydediliyor..."
  data-w-loading-class="opacity-50 cursor-wait">
  Kaydet
</button>
```

---

### 4. Client Bundle Size Reductions & DOM Sync Performance
- **Production Dead-Code Elimination**: DevTools dock (`core/client/devtool.js`) and debug telemetry are now stripped in production builds (`NODE_ENV === 'production'`), reducing the Full Client Runtime by **-42.7 KB minified (-9.5 KB Brotli)** to **~30.0 KB Brotli** and the Lite Runtime to **~16.1 KB Brotli**.
- **O(1) Fast-Path in `syncDomInstances()`**: Cached raw attribute signatures on tracked `[data-w-fragment]` elements eliminate redundant `JSON.parse`, `Set` allocations, storage reads, and full-DOM scans on unchanged elements.
- **Shared Client Micro-Utilities (`core/client/utils.js`)**: Consolidated `isArray`, `isNumber`, `isObject`, `isPlainObject`, `isPromise`, `getByPath`, `setByPath`, `parseDurationMs`, `parseRefetchMode`, `randomId`, `uid`, and `setElementBusyState`.
- **Client DevTools Dock Polish**: Replaced 2-second full DOM re-renders with incremental in-place updates and conditionally displayed DB Studio (`/_studio`) and Admin Panel (`/_admin`) bridge buttons only when those plugins are mounted.

---

## 🚀 Upgrade Guide

```bash
npm install webspresso@0.0.111
```

No breaking changes are introduced in this release. All new features are strictly additive and backward-compatible.

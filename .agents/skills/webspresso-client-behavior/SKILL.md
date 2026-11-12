---
name: webspresso-client-behavior
description: >-
  Build interactive client-side behavior, SSR fragments, typed forms, shared lazy client services,
  optional UI hosts, reactive watchers, namespaced storage, and React Query-style automatic
  invalidation in Webspresso. Use when writing .client.ts/.client.js controllers (defineController),
  defining server fragments (defineFragment), returning apiResult with invalidation tags, registering
  lazy client services (defineClientService, mountHost), or configuring staleTime/refetchOnWindowFocus.
---

# Webspresso Client Behavior, SSR Fragments & Shared Services Skill

Webspresso's client behavior layer (`core/client` / `webspresso/client`) follows a strict **HTML-First SSR** ownership model (~31.6 KB Brotli full runtime / ~16.9 KB Brotli lite runtime, zero external dependencies).

---

## 1. Two Explicit Data Flows & Single Ownership Rule

1. **Server-Managed View (`defineFragment` + `apiResult`)**:
   - Mutations (`POST`/`PATCH`/`DELETE`) return `apiResult(data, { invalidate: ['todos'] })`.
   - The client automatically coalesces and refreshes only active `[data-w-fragment]` regions on the current page matching `'todos'`, morphing the DOM in place while preserving focus, selection, dirty form drafts, mounted controller state, and `[data-w-host]` containers.
2. **Client-Managed Data (`defineController` + `ctx.api`)**:
   - Interactive UI calls `await ctx.api.get('/api/todos/stats')` and writes into isolated controller-local `state`.
3. **Single Ownership Invariant**:
   - Every DOM node/attribute is owned by **either** a server fragment **or** a client binding (`data-w-text`, `data-w-show`, `data-w-disabled`, `data-w-model`), **never both**.

---

## 2. SSR Fragments & Automatic Revalidation (`defineFragment`)

Declare fragments in companion page loaders (`pages/todos.js`):

```javascript
const { definePage, defineFragment } = require('webspresso');

module.exports = definePage({
  fragments: {
    todoList: defineFragment({
      tags: ['todos'],
      template: 'partials/todo-list.njk',
      // React Query-style automatic invalidation & background refetching:
      staleTime: '10s',              // Fresh window (ms or '500ms', '10s', '5m', '1h')
      refetchOnWindowFocus: true,    // Refetch on tab visibility/focus when stale (or 'always')
      refetchOnReconnect: true,      // Refetch when browser goes online
      refetchOnMount: false,         // Refetch on initial visit / bfcache pageshow
      refetchInterval: '30s',        // Periodic polling (paused when tab is hidden by default)
      refetchIntervalInBackground: false,
      schema: ({ z }) => ({
        status: z.enum(['all', 'open', 'done']).default('all'),
      }),
      load: async ({ input, db }) => {
        const items = await db.getRepository('Todo').find(
          input.status === 'all' ? {} : { done: input.status === 'done' }
        );
        return { items };
      },
    }),
  },
  load: async ({ fragments }) => ({
    todoListHtml: await fragments.todoList({ status: 'all' }),
  }),
});
```

Trigger invalidation from API endpoints (`pages/api/todos.post.js`):

```javascript
const { defineApi, apiResult } = require('webspresso');

module.exports = defineApi({
  schema: ({ z }) => ({
    body: z.object({ title: z.string().min(1) }),
  }),
  handler: async (req, res) => {
    const todo = await req.db.getRepository('Todo').create(req.input.body);
    return res.status(201).json(apiResult(todo, { invalidate: ['todos'] }));
  },
});
```

---

## 3. Client Controllers, Tasks & Watchers (`defineController`)

Place client controllers in `pages/*.client.ts` or `views/components/*.client.ts`:

```typescript
import { defineController } from 'webspresso/client';

export default defineController({
  name: 'todos',
  state: () => ({
    filter: 'all',
    search: '',
  }),
  computed: {
    hasActiveFilter: (s) => s.filter !== 'all' || s.search.trim().length > 0,
  },
  // Optional declarative state persistence to localStorage/sessionStorage
  persist: {
    keys: ['filter', 'search'],
    storage: 'local',
    debounce: 50,
  },
  // Lifecycle-aware async tasks with concurrency & auto-revalidation
  tasks: {
    insights: ({ api }) => ({
      policy: 'latest', // 'latest' | 'drop' | 'queue'
      staleTime: '15s',
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      run: ({ signal }) => api.get('/api/todos/insights', { signal }),
    }),
  },
  connect(ctx) {
    // Vue-style reactive watcher with cleanup
    ctx.watch(
      () => ctx.state.filter,
      async (nextFilter) => {
        await ctx.refresh('todoList', { status: nextFilter });
      }
    );

    // Form lifecycle hooks with access to shared services
    const createForm = ctx.forms('create-todo');
    if (createForm) {
      createForm.onSuccess(async (created, { form, services }) => {
        form.reset();
        const toast = await services.get('toast');
        toast.success(`Created "${created.title}"`);
      });
    }
  },
  actions: {
    async clearFilters({ state, refresh, services }) {
      state.filter = 'all';
      state.search = '';
      await refresh('todoList', { status: 'all' });
      const toast = await services.get('toast');
      toast.info('Filters reset');
    },
  },
});
```

### 3.1 Declarative Action & Task Busy States (`data-w-loading`, `data-w-loading-text`, `data-w-confirm`)
- **Automatic Button Busy State & Double-Click Guard**: When an async action is triggered via `data-w-click` / `data-w-on:*` (or a `<form data-w-form>` is submitted), the button automatically receives `data-w-busy="true"`, `aria-busy="true"`, and `disabled`, ignoring duplicate clicks while in flight.
- **`data-w-loading-text="Saving..."` & `data-w-loading-class="opacity-50"`**: Automatically swaps button text and toggles classes while busy, restoring original text/classes when settled.
- **`data-w-loading` / `data-w-loading-hide`**: Toggles visibility (`hidden` / `display: none`) while any action/task (or a specific named action/task like `data-w-loading="save"`) is running.
- **`data-w-confirm="Are you sure?"`**: Prompts confirmation before executing the bound action.
- **`ctx.isBusy` & `ctx.isActionBusy(name)`**: Reactive booleans on `ctx` (and `$busy` / `isBusy` in state expressions).

---

## 4. Shared Lazy Client Services & Optional UI Host (`defineClientService`)

Define reusable client capabilities (toast, confirm modal, clipboard, analytics) in application code without bloating core or initial bundles:

### 4.1 Service Implementation with Optional UI Host (`services/toast.ts`)
```typescript
import { defineClientService } from 'webspresso/client';

export default defineClientService({
  create({ mountHost, onCleanup }) {
    // Lazily mounts `<div data-w-host="toast">` outside fragment patch regions
    const host = mountHost('toast', { className: 'fixed bottom-4 right-4 z-50' });

    onCleanup(() => {
      // Custom teardown when runtime.destroy() is called
    });

    return {
      success(message: string) {
        const item = document.createElement('div');
        item.textContent = message;
        host.el.appendChild(item);
      },
      dismiss() {
        host.el.innerHTML = '';
      },
    };
  },
});
```

### 4.2 DOM-less Service Implementation (`services/clipboard.ts`)
```typescript
import { defineClientService } from 'webspresso/client';

export default defineClientService({
  create() {
    return {
      async copy(text: string): Promise<boolean> {
        await navigator.clipboard.writeText(text);
        return true;
      },
    };
  },
});
```

### 4.3 Registration & Automatic TypeScript Inference (`client/main.ts`)
```typescript
import { bootClient, defineClientService, type InferClientServicesMap } from 'webspresso/client';

export const services = {
  toast: defineClientService({ load: () => import('./services/toast') }),
  clipboard: defineClientService({ load: () => import('./services/clipboard') }),
};

declare module 'webspresso' {
  interface AppClientServices extends InferClientServicesMap<typeof services> {}
}

bootClient({
  services,
  staleTime: '5s',
  refetchOnWindowFocus: true,
});
```

---

## 5. Strict Client Boundary Rules

- **NEVER** import server-only modules (`fs`, `knex`, `core/orm`, `models/`, server `services/`) inside `.client.ts` / `.client.js` files.
- **NEVER** create a global client state store for server data or serialize full-page props into `window.__INITIAL_STATE__`.
- **NEVER** hardcode UI widget opinions (like toast/modal markup) into Webspresso core — use `defineClientService` and `mountHost` in application code.


import { defineController, watch } from '../../../core/client';

export default defineController({
  state: () => ({
    draft: {
      search: '',
      status: 'all',
      priority: 'all',
    },
    applied: {
      search: '',
      status: 'all',
      priority: 'all',
    },
    page: 1,
    selectedTodoId: 3 as number | null,
    loadingTodoId: null as number | null,
    manualDraftMode: false,
    labActiveControllers: '',
    labActiveFragments: '',
    labHostCount: 0,
    labRequestOrder: '',
    labPatchOrder: '',
    labAssertions: 'READY',
  }),

  computed: {
    draftSummaryText: ({ state }) => {
      const { search, status, priority } = state.draft;
      return `Draft: ${status}/${priority}${search ? ` • "${search}"` : ''}`;
    },
    filterSummaryText: ({ state }) => {
      const { search, status, priority } = state.applied;
      return `Filter: ${status}/${priority}${search ? ` • "${search}"` : ''} • Page ${state.page}`;
    },
    editingBadge: ({ state }) => {
      return state.selectedTodoId ? `Task #${state.selectedTodoId}` : 'No Task Selected';
    },
    isLoadingRecord: ({ state }) => state.loadingTodoId !== null,
    hasInsights: ({ tasks }) => Boolean(tasks.insights?.data),
    insightsHeadline: ({ tasks }) => tasks.insights?.data?.recommendation || '',
    insightsDetail: ({ tasks }) => {
      const data = tasks.insights?.data;
      if (!data) return '';
      return `Completion: ${data.percentCompleted}% (${data.completed}/${data.total}) • Top Category: ${data.topCategory}`;
    },
    insightsErrorText: ({ tasks }) => {
      const err = tasks.insights?.error as { message?: string } | null;
      return err && err.message ? err.message : '';
    },
  },

  tasks: {
    insights: ({ api }) => ({
      run: (category?: string) =>
        api.get('/api/todos/insights', category ? { query: { category } } : undefined),
      concurrency: 'latest',
      staleTime: '10s',
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    }),
  },

  connect({ forms, state, el }) {
    const createForm = forms.get('create-todo', {
      resetOnSuccess: true,
    });
    if (createForm) {
      createForm.onSuccess(async (_data, { services }) => {
        if (!services.has('toast')) return;
        const toast = await services.get('toast');
        toast.success('Task added.');
      });
    }

    const editForm = forms.get('edit-todo');
    if (editForm) {
      editForm.beforeSubmit(() => {
        // Prevent submitting to wrong record while a new record selection is in-flight
        if (state.loadingTodoId !== null) {
          return false;
        }
        return true;
      });
      editForm.onSuccess(async (_data, { services }) => {
        if (!services.has('toast')) return;
        const toast = await services.get('toast');
        toast.success('Draft saved.');
      });
    }

    // Sync initial telemetry if lab panel is present
    const doc = el?.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (doc) {
      const ctrlNodes = doc.querySelectorAll('[data-w-controller]');
      const fragNodes = doc.querySelectorAll('[data-w-fragment]');
      const hostNodes = doc.querySelectorAll('[data-w-host]');
      state.labActiveControllers = Array.from(ctrlNodes)
        .map((n) => n.getAttribute('data-w-controller'))
        .filter(Boolean)
        .join(', ');
      state.labActiveFragments = Array.from(fragNodes)
        .map((n) => n.getAttribute('data-w-fragment-id') || n.getAttribute('data-w-fragment'))
        .filter(Boolean)
        .join(', ');
      state.labHostCount = hostNodes.length;
    }

    // Vue-style reactive watcher: monitors selected task id and supports onCleanup
    watch(
      () => state.selectedTodoId,
      (newId, _oldId, onCleanup) => {
        let active = true;
        onCleanup(() => {
          active = false;
        });
        if (newId !== null && active) {
          // Track or highlight selected task selection
        }
      },
      { immediate: true }
    );

    return () => {
      if (createForm) createForm.clearErrors();
    };
  },

  actions: {
    async onSearchInput({ state, refresh }) {
      if (state.manualDraftMode) return;
      const next = { ...state.draft };
      await refresh('todos-list', {
        search: next.search,
        status: next.status,
        priority: next.priority,
        page: 1,
        limit: 4,
      }, {
        throwOnError: false,
        onSuccess() {
          state.applied = { ...next };
          state.page = 1;
        },
      });
    },

    async applyFilters({ state, refresh }) {
      const next = { ...state.draft };
      await refresh('todos-list', {
        search: next.search,
        status: next.status,
        priority: next.priority,
        page: 1,
        limit: 4,
      }, {
        throwOnError: false,
        onSuccess() {
          state.applied = { ...next };
          state.page = 1;
        },
      });
    },

    async setQuickStatus({ state, refresh }, _event, actionEl) {
      if (!actionEl) return;
      const nextStatus = actionEl.data('status') || 'all';
      state.draft.status = nextStatus;

      const next = { ...state.draft };
      await refresh('todos-list', {
        search: next.search,
        status: next.status,
        priority: next.priority,
        page: 1,
        limit: 4,
      }, {
        throwOnError: false,
        onSuccess() {
          state.applied = { ...next };
          state.page = 1;
        },
      });
    },

    async setQuickPriority({ state, refresh }, _event, actionEl) {
      if (!actionEl) return;
      const clicked = actionEl.data('priority') || 'all';
      const nextPriority = state.draft.priority === clicked ? 'all' : clicked;
      state.draft.priority = nextPriority;

      const next = { ...state.draft };
      await refresh('todos-list', {
        search: next.search,
        status: next.status,
        priority: next.priority,
        page: 1,
        limit: 4,
      }, {
        throwOnError: false,
        onSuccess() {
          state.applied = { ...next };
          state.page = 1;
        },
      });
    },

    async resetFilters({ state, refresh }) {
      const initial = { search: '', status: 'all', priority: 'all' };
      await refresh('todos-list', {
        search: '',
        status: 'all',
        priority: 'all',
        page: 1,
        limit: 4,
      }, {
        throwOnError: false,
        onSuccess() {
          state.draft = { ...initial };
          state.applied = { ...initial };
          state.page = 1;
        },
      });
    },

    async nextPage({ state, refresh }) {
      const nextPageNum = Number(state.page || 1) + 1;
      await refresh('todos-list', {
        search: state.applied.search,
        status: state.applied.status,
        priority: state.applied.priority,
        page: nextPageNum,
        limit: 4,
      }, {
        throwOnError: false,
        onSuccess() {
          state.page = nextPageNum;
        },
      });
    },

    async prevPage({ state, refresh }) {
      const prevPageNum = Math.max(1, Number(state.page || 1) - 1);
      await refresh('todos-list', {
        search: state.applied.search,
        status: state.applied.status,
        priority: state.applied.priority,
        page: prevPageNum,
        limit: 4,
      }, {
        throwOnError: false,
        onSuccess() {
          state.page = prevPageNum;
        },
      });
    },

    async selectTodoForEdit({ state, forms, api }, _event, actionEl) {
      if (!actionEl) return;
      const id = actionEl.data('todo-id');
      if (!id) return;
      const targetId = Number(id);

      const editForm = forms.get('edit-todo');
      if (!editForm) return;

      // Protect user's dirty draft if form currently has unsaved edits
      if (editForm.dirty) {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
          const discard = window.confirm('Discard unsaved draft in Draft Inspector?');
          if (!discard) return;
        }
      }

      const prevSelectedId = state.selectedTodoId;
      const revAtStart = editForm.inputRevision;
      state.selectedTodoId = targetId;
      state.loadingTodoId = targetId;

      try {
        // Client requests the record via typed GET with latest concurrency
        const todo = await api.get(`/api/todos/${targetId}`, {
          key: 'todos:edit-fetch',
          concurrency: 'latest',
        });

        if (!todo || typeof todo !== 'object') return;
        if (state.selectedTodoId !== targetId) return;

        // If user typed NEW changes into the form while the fetch was in flight, do not overwrite their in-flight edits
        if (editForm.inputRevision !== revAtStart) {
          return;
        }

        editForm.setDraftKey(`form_draft:edit-todo:todo-${todo.id}`, { restore: false });
        editForm.setAction(`/api/todos/${todo.id}`);
        editForm.fill(todo, { baseline: true });
      } catch (err: unknown) {
        const isCanceled = Boolean(
          err &&
            typeof err === 'object' &&
            ((err as { isCanceled?: boolean }).isCanceled === true ||
              (err as { name?: string }).name === 'AbortError')
        );
        if (!isCanceled && state.selectedTodoId === targetId) {
          state.selectedTodoId = prevSelectedId;
        }
        if (!isCanceled) {
          throw err;
        }
      } finally {
        if (state.loadingTodoId === targetId) {
          state.loadingTodoId = null;
        }
      }
    },

    resetDraftForm({ forms }) {
      const editForm = forms.get('edit-todo');
      if (editForm) {
        editForm.reset();
      }
    },

    async loadInsights({ tasks, services }, _event, actionEl) {
      const category = actionEl?.data<string>('category') || undefined;
      await tasks.insights.run(category);
      if (services.has('toast')) {
        const toast = await services.get('toast');
        toast.success('Insights updated.');
      }
    },

    async copyFilterSummary({ state, services }) {
      const { search, status, priority } = state.applied;
      const summary = `Filter: ${status}/${priority}${search ? ` • "${search}"` : ''} • Page ${state.page}`;
      const clipboard = await services.get('clipboard');
      await clipboard.copy(summary);
      if (services.has('toast')) {
        const toast = await services.get('toast');
        toast.success('Filter summary copied.');
      }
    },

    syncLabTelemetry({ state, el }) {
      const doc = el?.ownerDocument || (typeof document !== 'undefined' ? document : null);
      if (!doc) return;
      const ctrlNodes = doc.querySelectorAll('[data-w-controller]');
      const fragNodes = doc.querySelectorAll('[data-w-fragment]');
      const hostNodes = doc.querySelectorAll('[data-w-host]');
      state.labActiveControllers = Array.from(ctrlNodes)
        .map((n) => n.getAttribute('data-w-controller'))
        .filter(Boolean)
        .join(', ');
      state.labActiveFragments = Array.from(fragNodes)
        .map((n) => n.getAttribute('data-w-fragment-id') || n.getAttribute('data-w-fragment'))
        .filter(Boolean)
        .join(', ');
      state.labHostCount = hostNodes.length;
    },

    async retryFailedFragments(ctx) {
      const maybeRetry = (ctx as unknown as { retryFailedFragments?: () => Promise<unknown> }).retryFailedFragments;
      if (typeof maybeRetry === 'function') {
        await maybeRetry();
        return;
      }
      if (typeof window !== 'undefined' && (window as unknown as { __WEBSPRESSO_CLIENT__?: { fragments?: { retryFailed?: () => Promise<unknown> } } }).__WEBSPRESSO_CLIENT__?.fragments?.retryFailed) {
        await (window as unknown as { __WEBSPRESSO_CLIENT__: { fragments: { retryFailed: () => Promise<unknown> } } }).__WEBSPRESSO_CLIENT__.fragments.retryFailed();
      }
    },
  },
});

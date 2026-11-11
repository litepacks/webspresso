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
  }),

  computed: {
    filterSummaryText: ({ state }) => {
      const { search, status, priority } = state.applied;
      return `Filter: ${status}/${priority}${search ? ` • "${search}"` : ''} • Page ${state.page}`;
    },
    editingBadge: ({ state }) => {
      return state.selectedTodoId ? `Task #${state.selectedTodoId}` : 'No Task Selected';
    },
    hasInsights: ({ tasks }) => Boolean(tasks.insights?.data),
    insightsHeadline: ({ tasks }) => tasks.insights?.data?.recommendation || '',
    insightsDetail: ({ tasks }) => {
      const data = tasks.insights?.data;
      if (!data) return '';
      return `Completion: ${data.percentCompleted}% (${data.completed}/${data.total}) • Top Category: ${data.topCategory}`;
    },
  },

  tasks: {
    insights: ({ api }) => ({
      run: () => api.get('/api/todos/insights'),
      concurrency: 'latest',
      staleTime: '10s',
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    }),
  },

  connect({ forms, state }) {
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
      editForm.onSuccess(async (_data, { services }) => {
        if (!services.has('toast')) return;
        const toast = await services.get('toast');
        toast.success('Draft saved.');
      });
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
    async applyFilters({ state, refresh }) {
      const next = { ...state.draft };
      await refresh('todos-list', {
        search: next.search,
        status: next.status,
        priority: next.priority,
        page: 1,
        limit: 4,
      }, {
        onSuccess() {
          state.applied = next;
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
        onSuccess() {
          state.applied = next;
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
        onSuccess() {
          state.applied = next;
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
        onSuccess() {
          state.page = prevPageNum;
        },
      });
    },

    async selectTodoForEdit({ state, forms, api }, _event, actionEl) {
      if (!actionEl) return;
      const id = actionEl.data('todo-id');
      if (!id) return;

      const editForm = forms.get('edit-todo');
      if (!editForm) return;

      // Protect user's dirty draft if form currently has unsaved edits
      if (editForm.dirty) {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
          const discard = window.confirm('Discard unsaved draft in Draft Inspector?');
          if (!discard) return;
        }
      }

      state.selectedTodoId = Number(id);

      // Client requests the record via typed GET with latest concurrency
      const todo = await api.get(`/api/todos/${id}`, {
        key: 'todos:edit-fetch',
        concurrency: 'latest',
      });

      if (!todo || typeof todo !== 'object') return;

      // If user typed into the form while the fetch was in flight, do not overwrite dirty draft
      if (editForm.dirty) return;

      editForm.setAction(`/api/todos/${todo.id}`);
      editForm.fill(todo, { baseline: true });
    },

    resetDraftForm({ forms }) {
      const editForm = forms.get('edit-todo');
      if (editForm) {
        editForm.reset();
      }
    },

    async loadInsights({ tasks, services }) {
      await tasks.insights.run();
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
  },
});

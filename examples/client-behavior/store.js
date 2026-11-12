'use strict';

/**
 * In-memory store for the Client Behavior Layer example app
 * (Supports Counter and Todo List examples without external DB setup)
 */

const { defaultStorage } = require('../../core/client/storage');

let counterValue = 0;

const INITIAL_TODOS = [
  {
    id: 1,
    title: 'Verify unified SSR fragment engine (/__webspresso/fragments)',
    completed: true,
    priority: 'high',
    category: 'architecture',
    notes: 'Initial SSR and partial refresh share the exact same loader and Nunjucks template.',
  },
  {
    id: 2,
    title: 'Test Datastar per-instance signal isolation (__w_inst_<id>)',
    completed: true,
    priority: 'high',
    category: 'frontend',
    notes: 'Multiple instances of the same controller on one page never overwrite each other.',
  },
  {
    id: 3,
    title: 'Preserve unsaved draft and cursor focus during list refresh',
    completed: false,
    priority: 'high',
    category: 'frontend',
    notes: 'In-place DOM morphing keeps active form inputs and cursor position intact while fragments refresh.',
  },
  {
    id: 4,
    title: 'Generate .webspresso/api.d.ts from defineApi Zod schemas',
    completed: false,
    priority: 'medium',
    category: 'backend',
    notes: 'Client input, server output, and WireSerialize<T> types are derived automatically.',
  },
  {
    id: 5,
    title: 'Emit X-Webspresso-Invalidate only after DB transaction commit',
    completed: false,
    priority: 'medium',
    category: 'backend',
    notes: 'Rolled-back transactions never publish fragment invalidations.',
  },
  {
    id: 6,
    title: 'Validate accessible form error mapping (aria-invalid & auto-focus)',
    completed: false,
    priority: 'low',
    category: 'testing',
    notes: 'HTTP 422 validation errors map to field spans and focus the first invalid control.',
  },
];

let nextTodoId = 7;
let todos = INITIAL_TODOS.map((t) => ({ ...t }));

const INITIAL_ACTIVITY = [
  { id: 1, action: 'seed', summary: 'Workspace initialized with 6 engineering tasks', todoId: null },
];
let nextActivityId = 2;
let activityLog = INITIAL_ACTIVITY.map((a) => ({ ...a }));

const metrics = {
  mutationCommits: 0,
  summaryLoaderCalls: 0,
  listLoaderCalls: 0,
  activityLoaderCalls: 0,
  sharedSnapshotComputations: 0,
};

const serverHooks = {
  beforeCommit: null,
  beforeFragmentLoad: null,
};

function setServerHooks(hooks = {}) {
  serverHooks.beforeCommit = typeof hooks.beforeCommit === 'function' ? hooks.beforeCommit : null;
  serverHooks.beforeFragmentLoad =
    typeof hooks.beforeFragmentLoad === 'function' ? hooks.beforeFragmentLoad : null;
}

function getStoreMetrics() {
  return { ...metrics };
}

function recordActivity(action, summary, todoId = null) {
  const entry = {
    id: nextActivityId++,
    action,
    summary,
    todoId,
  };
  activityLog.unshift(entry);
  if (activityLog.length > 30) {
    activityLog.length = 30;
  }
  return entry;
}

function getCounter() {
  return counterValue;
}

function incrementCounter(amount = 1) {
  counterValue += Number(amount) || 1;
  return counterValue;
}

function resetStore() {
  counterValue = 0;
  nextTodoId = 7;
  todos = INITIAL_TODOS.map((t) => ({ ...t }));
  nextActivityId = 2;
  activityLog = INITIAL_ACTIVITY.map((a) => ({ ...a }));
  metrics.mutationCommits = 0;
  metrics.summaryLoaderCalls = 0;
  metrics.listLoaderCalls = 0;
  metrics.activityLoaderCalls = 0;
  metrics.sharedSnapshotComputations = 0;
  serverHooks.beforeCommit = null;
  serverHooks.beforeFragmentLoad = null;
  try {
    defaultStorage.session.clear();
    defaultStorage.local.clear();
    defaultStorage.memory.clear();
  } catch (_e) {}
}

function getTodosSummary() {
  const total = todos.length;
  const completed = todos.filter((t) => t.completed).length;
  const active = total - completed;
  const highPriority = todos.filter((t) => !t.completed && t.priority === 'high').length;
  const percentCompleted = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    total,
    active,
    completed,
    highPriority,
    percentCompleted,
  };
}

function queryTodos({
  search = '',
  status = 'all',
  priority = 'all',
  page = 1,
  limit = 4,
} = {}) {
  const q = String(search || '').trim().toLowerCase();
  const normStatus = String(status || 'all').toLowerCase();
  const normPriority = String(priority || 'all').toLowerCase();

  const filtered = todos.filter((t) => {
    if (normStatus === 'active' && t.completed) return false;
    if (normStatus === 'completed' && !t.completed) return false;
    if (normPriority !== 'all' && t.priority !== normPriority) return false;
    if (q) {
      const hay = `${t.title} ${t.notes || ''} ${t.category || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const safeLimit = Math.max(1, Number(limit) || 4);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (safePage - 1) * safeLimit;
  const items = filtered.slice(start, start + safeLimit);

  return {
    items,
    total,
    allTotal: todos.length,
    page: safePage,
    limit: safeLimit,
    totalPages,
    search: String(search || ''),
    status: normStatus,
    priority: normPriority,
    summary: getTodosSummary(),
  };
}

function createTodo({ title, priority = 'medium', category = 'architecture', notes: todoNotes = '' }) {
  const created = {
    id: nextTodoId++,
    title: String(title).trim(),
    completed: false,
    priority: ['high', 'medium', 'low'].includes(priority) ? priority : 'medium',
    category: String(category || 'architecture').trim(),
    notes: String(todoNotes || '').trim(),
  };
  todos.unshift(created);
  metrics.mutationCommits += 1;
  recordActivity('create', `Created #${created.id}: ${created.title}`, created.id);
  return created;
}

function toggleTodo(id) {
  const numId = Number(id);
  const target = todos.find((t) => t.id === numId);
  if (!target) return null;
  target.completed = !target.completed;
  metrics.mutationCommits += 1;
  recordActivity(
    'toggle',
    `${target.completed ? 'Completed' : 'Reopened'} #${target.id}: ${target.title}`,
    target.id
  );
  return { ...target };
}

function updateTodo(id, patch = {}) {
  const numId = Number(id);
  const target = todos.find((t) => t.id === numId);
  if (!target) return null;
  if (patch.title !== undefined && String(patch.title).trim()) {
    target.title = String(patch.title).trim();
  }
  if (patch.priority !== undefined && ['high', 'medium', 'low'].includes(patch.priority)) {
    target.priority = patch.priority;
  }
  if (patch.category !== undefined && String(patch.category).trim()) {
    target.category = String(patch.category).trim();
  }
  if (patch.notes !== undefined) {
    target.notes = String(patch.notes).trim();
  }
  if (patch.completed !== undefined) {
    target.completed = Boolean(patch.completed);
  }
  metrics.mutationCommits += 1;
  recordActivity('update', `Updated #${target.id}: ${target.title}`, target.id);
  return { ...target };
}

function deleteTodo(id) {
  const numId = Number(id);
  const idx = todos.findIndex((t) => t.id === numId);
  if (idx === -1) return false;
  const removed = todos[idx];
  todos.splice(idx, 1);
  metrics.mutationCommits += 1;
  recordActivity('delete', `Deleted #${removed.id}: ${removed.title}`, removed.id);
  return true;
}

function bulkTodos(action) {
  if (action === 'complete-all') {
    for (const t of todos) t.completed = true;
  } else if (action === 'activate-all') {
    for (const t of todos) t.completed = false;
  } else if (action === 'clear-completed') {
    todos = todos.filter((t) => !t.completed);
  } else if (action === 'reset-demo') {
    nextTodoId = 7;
    todos = INITIAL_TODOS.map((t) => ({ ...t }));
  }
  metrics.mutationCommits += 1;
  recordActivity('bulk', `Executed bulk action: ${action}`, null);
  return getTodosSummary();
}

function getActivityFeed({ limit = 6 } = {}) {
  const safeLimit = Math.max(1, Number(limit) || 6);
  return {
    items: activityLog.slice(0, safeLimit).map((a) => ({ ...a })),
    totalEvents: activityLog.length,
    mutationCommits: metrics.mutationCommits,
  };
}

function getSharedWorkspaceSnapshot() {
  metrics.sharedSnapshotComputations += 1;
  return {
    summary: getTodosSummary(),
    activity: getActivityFeed({ limit: 6 }),
    computedCount: metrics.sharedSnapshotComputations,
  };
}

function getTodoInsights(options = {}) {
  const categoryFilter =
    options && typeof options.category === 'string' && options.category !== 'all'
      ? options.category.trim().toLowerCase()
      : null;
  const scopedTodos = categoryFilter
    ? todos.filter((t) => String(t.category || '').toLowerCase() === categoryFilter)
    : todos;
  const summary = getTodosSummary();
  const byCategory = {};
  const byPriority = { high: 0, medium: 0, low: 0 };
  for (const t of scopedTodos) {
    byCategory[t.category] = (byCategory[t.category] || 0) + 1;
    if (!t.completed) {
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
    }
  }
  const topCategory =
    Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none';

  return {
    ...summary,
    scopedCount: scopedTodos.length,
    categoryFilter: categoryFilter || 'all',
    byCategory,
    byPriority,
    topCategory,
    recommendation:
      summary.highPriority > 0
        ? `${summary.highPriority} high-priority open task(s) need attention.`
        : summary.active > 0
        ? `Great progress! Zero high-priority blockers remaining (${summary.active} open task(s) left).`
        : 'All tasks completed! 🎉',
  };
}

function getTodoById(id) {
  const numId = Number(id);
  const target = todos.find((t) => t.id === numId);
  return target ? { ...target } : null;
}

module.exports = {
  getCounter,
  incrementCounter,
  resetStore,
  getTodosSummary,
  queryTodos,
  getTodoById,
  createTodo,
  toggleTodo,
  updateTodo,
  deleteTodo,
  bulkTodos,
  getTodoInsights,
  getActivityFeed,
  getSharedWorkspaceSnapshot,
  getStoreMetrics,
  setServerHooks,
  serverHooks,
  metrics,
};

'use strict';

/**
 * In-memory store for the Client Behavior Layer example app
 * (Supports Counter and Todo List examples without external DB setup)
 */

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
  return created;
}

function toggleTodo(id) {
  const numId = Number(id);
  const target = todos.find((t) => t.id === numId);
  if (!target) return null;
  target.completed = !target.completed;
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
  return { ...target };
}

function deleteTodo(id) {
  const numId = Number(id);
  const idx = todos.findIndex((t) => t.id === numId);
  if (idx === -1) return false;
  todos.splice(idx, 1);
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
  return getTodosSummary();
}

function getTodoInsights() {
  const summary = getTodosSummary();
  const byCategory = {};
  const byPriority = { high: 0, medium: 0, low: 0 };
  for (const t of todos) {
    byCategory[t.category] = (byCategory[t.category] || 0) + 1;
    if (!t.completed) {
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
    }
  }
  const topCategory =
    Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none';

  return {
    ...summary,
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
};

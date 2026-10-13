// Helper to extract custom actions for a model
function getModelActions(modelName, modelMeta) {
  const fromMeta = Array.isArray(modelMeta?.actions) ? modelMeta.actions : [];
  const fromConfig = Array.isArray(window.__ADMIN_CONFIG__?.actions)
    ? window.__ADMIN_CONFIG__.actions.filter(a => {
        if (!a.models || a.models === '*') return true;
        if (Array.isArray(a.models)) return a.models.includes(modelName);
        return a.models === modelName;
      })
    : [];

  const map = new Map();
  for (const a of fromConfig) map.set(a.id, a);
  for (const a of fromMeta) map.set(a.id, a);
  return Array.from(map.values());
}

// Helper to extract custom bulk actions for a model
function getModelBulkActions(modelName, modelMeta) {
  const fromMeta = Array.isArray(modelMeta?.bulkActions) ? modelMeta.bulkActions : [];
  const fromConfig = Array.isArray(window.__ADMIN_CONFIG__?.bulkActions)
    ? window.__ADMIN_CONFIG__.bulkActions.filter(a => {
        if (a.id === 'bulk-delete' || a.id === 'bulk-restore' || a.id === 'bulk-update') return false;
        if (!a.models || a.models === '*') return true;
        if (Array.isArray(a.models)) return a.models.includes(modelName);
        return a.models === modelName;
      })
    : [];

  const map = new Map();
  for (const a of fromConfig) map.set(a.id, a);
  for (const a of fromMeta) map.set(a.id, a);
  return Array.from(map.values());
}

// Evaluate condition whether an action should be shown for a record
function shouldShowAction(action, record) {
  if (!action || !action.showWhen) return true;
  if (!record) return true;
  if (typeof action.showWhen === 'function') {
    try {
      return !!action.showWhen(record);
    } catch (e) {
      return false;
    }
  }
  if (typeof action.showWhen === 'object' && action.showWhen !== null) {
    return Object.entries(action.showWhen).every(([k, v]) => record[k] === v);
  }
  return true;
}

// Render icon for actions (SVG string or common icon names)
function renderActionIcon(icon) {
  if (!icon) return null;
  if (typeof icon === 'string' && (icon.startsWith('<svg') || icon.includes('</svg>'))) {
    return m.trust(icon);
  }
  const iconPaths = {
    check: 'M5 13l4 4L19 7',
    copy: 'M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z',
    duplicate: 'M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z',
    play: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z',
    refresh: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
    eye: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
    trash: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
    archive: 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4',
    mail: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
    star: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z',
  };
  const pathD = iconPaths[icon];
  if (pathD) {
    return m('svg.w-3.5.h-3.5', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
      m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: pathD })
    );
  }
  return m('span.text-xs', icon);
}

function getActionColorClass(color) {
  switch (color) {
    case 'green':
      return 'text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 hover:bg-green-50 dark:hover:bg-green-950/40';
    case 'red':
      return 'text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40';
    case 'blue':
    case 'indigo':
      return 'text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40';
    case 'amber':
    case 'yellow':
      return 'text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40';
    case 'purple':
    case 'violet':
      return 'text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40';
    default:
      return 'text-gray-600 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700/60';
  }
}

function getBulkActionColorClass(color) {
  switch (color) {
    case 'green':
      return 'text-green-600 dark:text-green-400 border-green-200 dark:border-green-800 hover:bg-green-50 dark:hover:bg-green-950/40';
    case 'red':
      return 'text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/40';
    case 'blue':
    case 'indigo':
      return 'text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/40';
    case 'amber':
    case 'yellow':
      return 'text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/40';
    case 'purple':
    case 'violet':
      return 'text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800 hover:bg-purple-50 dark:hover:bg-purple-950/40';
    default:
      return 'text-gray-700 dark:text-slate-300 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700/40';
  }
}

async function executeRecordAction(action, record, modelName, modelMeta, onSuccess) {
  if (action.confirm) {
    const msg = action.confirmMessage || ('Are you sure you want to perform "' + action.label + '"?');
    const isConfirmed = await confirmAction({ title: action.label, message: msg, danger: action.color === 'red' });
    if (!isConfirmed) return;
  }
  const primaryKey = modelMeta?.primaryKey || 'id';
  const recId = record[primaryKey];
  const busyKey = action.id + '-' + recId;
  state.actionInProgress = busyKey;
  m.redraw();
  try {
    const res = await api.post('/extensions/actions/' + action.id + '/' + modelName + '/' + recId);
    const msg = res?.result?.message || res?.message;
    if (msg) {
      notifySuccess(msg);
    }
    const redirectUrl = res?.result?.redirect || res?.redirect;
    if (redirectUrl) {
      m.route.set(redirectUrl);
      return;
    }
    if (typeof onSuccess === 'function') {
      await onSuccess(res);
    } else if (typeof loadRecords === 'function' && state.pagination) {
      loadRecords(modelName, state.pagination.page);
    }
  } catch (err) {
    const errText = 'Action failed: ' + (err.message || err);
    notifyError(errText);
  } finally {
    state.actionInProgress = null;
    m.redraw();
  }
}

async function executeBulkAction(action, modelName, modelMeta) {
  const count = state.selectAllMode ? state.pagination.total : state.selectedRecords.size;
  if (action.confirm) {
    const msg = action.confirmMessage || ('Perform "' + action.label + '" on ' + count + ' records?');
    const isConfirmed = await confirmAction({ title: action.label, message: msg, danger: action.color === 'red' });
    if (!isConfirmed) return;
  }
  state.bulkActionInProgress = true;
  m.redraw();
  try {
    const payload = state.selectAllMode
      ? { selectAll: true, filters: state.filters, trashed: state.trashedView }
      : { ids: Array.from(state.selectedRecords), trashed: state.trashedView };
    const res = await api.post('/extensions/bulk-actions/' + action.id + '/' + modelName, payload);
    state.selectedRecords = new Set();
    state.selectAllMode = false;
    loadRecords(modelName, state.pagination.page);
    if (res?.result?.message || res?.message) {
      const msg = res.result?.message || res.message;
      notifySuccess(msg);
    }
  } catch (err) {
    const errText = 'Bulk action failed: ' + (err.message || err);
    notifyError(errText);
  } finally {
    state.bulkActionInProgress = false;
    m.redraw();
  }
}

// Record List Component - displays records with dynamic columns
const RecordList = {
  oninit(vnode) {
    vnode.state._stopPoll = null;
    vnode.state.manualRefresh = false;
    const modelName = m.route.param('model');
    initializeModelView(modelName);
    vnode.state._stopPoll = runAdminAutoRefresh(() => {
      const mName = m.route.param('model');
      if (state._currentModelName !== mName || !state.currentModelMeta) return;
      loadRecords(mName, state.pagination.page, state.filters);
    });
  },
  onremove(vnode) {
    if (vnode.state._stopPoll) vnode.state._stopPoll();
  },
  onbeforeupdate: () => {
    // Check if model changed (navigation between different models)
    const modelName = m.route.param('model');
    if (state._currentModelName !== modelName) {
      initializeModelView(modelName);
    }
    return true;
  },
  view: (vnode) => {
    const modelName = m.route.param('model');
    const modelMeta = state.currentModelMeta;
    const displayColumns = modelMeta ? getDisplayColumns(modelMeta.columns, modelMeta) : [];
    const primaryKey = modelMeta?.primaryKey || 'id';
    const customActions = getModelActions(modelName, modelMeta);
    const customBulkActions = getModelBulkActions(modelName, modelMeta);
    
    // Count active filters
    const activeFilterCount = Object.values(state.filters || {}).filter(filterPayloadIsActive).length;
    
    const breadcrumbs = [
      { label: modelMeta?.label || modelName, href: '/models/' + modelName },
    ];
    
    // Filter change handler with auto-apply for quick filters
    const handleQuickFilterChange = (colName, filter) => {
      const newFilters = { ...state.filters };
      if (filter === null) {
        delete newFilters[colName];
      } else {
        newFilters[colName] = filter;
      }
      state.filters = newFilters;
      loadRecords(modelName, 1, newFilters);
    };
    
    // Filter change handler for drawer (no auto-apply)
    const handleDrawerFilterChange = (colName, filter) => {
      const newFilters = { ...state.filters };
      if (filter === null) {
        delete newFilters[colName];
      } else {
        newFilters[colName] = filter;
      }
      state.filters = newFilters;
      m.redraw();
    };
    
    return m(Layout, { breadcrumbs }, [
      // Header
      m('.flex.flex-col.sm:flex-row.sm:items-center.sm:justify-between.gap-3.mb-4', [
        m('.flex.items-center.gap-3', [
          m('h2.text-2xl.font-bold', modelMeta?.label || modelName),
          m(RefreshIconButton, {
            title: 'Reload records',
            spinning: vnode.state.manualRefresh || state.loading,
            onclick: () => {
              vnode.state.manualRefresh = true;
              m.redraw();
              loadRecords(modelName, state.pagination.page, state.filters).finally(() => {
                vnode.state.manualRefresh = false;
                m.redraw();
              });
            },
          }),
          modelMeta?.softDelete ? m('.flex.rounded-lg.border.border-gray-200.dark:border-slate-600.p-0.5', [
            m('button.px-3.py-1.5.text-sm.font-medium.rounded-md.transition-colors', {
              class: !state.trashedView ? 'bg-indigo-600.text-white' : 'text-gray-600.hover:text-gray-900.dark:hover:text-slate-100',
              onclick: () => {
                state.trashedView = false;
                loadRecords(modelName, 1);
              },
            }, 'Active'),
            m('button.px-3.py-1.5.text-sm.font-medium.rounded-md.transition-colors', {
              class: state.trashedView ? 'bg-indigo-600.text-white' : 'text-gray-600.hover:text-gray-900.dark:hover:text-slate-100',
              onclick: () => {
                state.trashedView = true;
                loadRecords(modelName, 1);
              },
            }, 'Trash'),
          ]) : null,
        ]),
        m('.flex.flex-wrap.items-center.gap-2', [
          m('button.inline-flex.items-center.gap-2.px-4.py-2.text-sm.font-medium.text-indigo-700.bg-white.dark:bg-slate-800.border.border-indigo-200.rounded-lg.hover:bg-indigo-50.transition-colors', {
            onclick: async () => {
              try {
                const payload = { selectAll: true, filters: state.filters };
                if (state.trashedView) payload.trashed = 'only';
                await downloadDataExchangeXlsx(modelName, payload);
              } catch (err) {
                notifyError('Error: ' + err.message);
              }
            },
          }, [
            m('svg.w-4.h-4', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
              m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4' })
            ),
            'Export Excel',
          ]),
          !state.trashedView ? m('input[type=file]', {
            id: 'data-exchange-import-' + modelName,
            style: 'display:none',
            accept: '.csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv',
            onchange: async (e) => {
              const file = e.target.files && e.target.files[0];
              e.target.value = '';
              if (!file) return;
              const adminPath = window.__ADMIN_PATH__ || '/_admin';
              const mode = (await confirmAction({
                title: 'Import Mode',
                message: 'Confirm to upsert records matching existing IDs, or cancel to insert as new records only.',
                confirmText: 'Upsert by ID',
                cancelText: 'Insert only'
              })) ? 'upsert' : 'insert';
              const upsertKey = 'id';
              const fd = new FormData();
              fd.append('file', file);
              try {
                const res = await fetch(
                  adminPath + '/api/data-exchange/import/' + modelName +
                    '?mode=' + encodeURIComponent(mode) + '&upsertKey=' + encodeURIComponent(upsertKey),
                  { method: 'POST', body: fd, credentials: 'include' }
                );
                const body = await res.json().catch(function () { return ({}); });
                if (!res.ok) {
                  throw new Error(body.error || 'Import failed');
                }
                var msg = 'Import finished: created ' + body.created + ', updated ' + (body.updated || 0) + ', failed ' + (body.failed || 0);
                if (body.errors && body.errors.length) {
                  msg += 'First errors: ' + body.errors.slice(0, 3).map(function (x) { return 'row ' + x.row + ': ' + x.message; }).join('; ');
                }
                notifySuccess(msg);
                loadRecords(modelName, state.pagination.page, state.filters);
              } catch (err) {
                notifyError('Error: ' + err.message);
              }
            },
          }) : null,
          !state.trashedView ? m('button.inline-flex.items-center.gap-2.px-4.py-2.text-sm.font-medium.text-indigo-700.bg-white.dark:bg-slate-800.border.border-indigo-200.rounded-lg.hover:bg-indigo-50.transition-colors', {
            onclick: function () {
              var el = document.getElementById('data-exchange-import-' + modelName);
              if (el) el.click();
            },
          }, [
            m('svg.w-4.h-4', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
              m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M7 10l5 5m0 0l5-5m-5 5V4' })
            ),
            'Import',
          ]) : null,
          !state.trashedView && !modelMeta?.readOnly && modelMeta?.permissions?.create !== false ? m('button.inline-flex.items-center.gap-2.px-4.py-2.text-sm.font-medium.text-white.bg-indigo-600.rounded-lg.hover:bg-indigo-700.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
            onclick: () => {
              state.currentRecord = null;
              state.editing = true;
              m.route.set('/models/' + modelName + '/new');
            },
          }, [
            m('svg.w-4.h-4', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' }, [
              m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M12 4v16m8-8H4' }),
            ]),
            'New Record',
          ]) : null,
        ]),
      ]),
      
      // Quick Filters Bar
      m(QuickFiltersBar, {
        modelMeta: modelMeta,
        filters: state.filters,
        onFilterChange: handleQuickFilterChange,
        onOpenDrawer: () => {
          state.filterDrawerOpen = true;
          m.redraw();
        },
        activeFilterCount: activeFilterCount,
      }),
      
      // Active filters badges
      m(ActiveFiltersBar, {
        filters: state.filters,
        modelMeta: modelMeta,
        onRemove: (colName) => {
          const newFilters = { ...state.filters };
          delete newFilters[colName];
          state.filters = newFilters;
          loadRecords(modelName, 1, newFilters);
        },
        onClearAll: () => {
          state.filters = {};
          loadRecords(modelName, 1, {});
        },
      }),
      
      // Filter Drawer
      m(FilterDrawer, {
        isOpen: state.filterDrawerOpen,
        modelMeta: modelMeta,
        filters: state.filters,
        onFilterChange: handleDrawerFilterChange,
        onApply: () => {
          loadRecords(modelName, 1, state.filters);
        },
        onClear: () => {
          state.filters = {};
          m.redraw();
        },
        onClose: () => {
          state.filterDrawerOpen = false;
          m.redraw();
        },
      }),
      
      state.error ? m('.bg-red-100.border.border-red-400.text-red-700.px-4.py-3.rounded.mb-4', state.error) : null,
      state.loading
        ? m('.flex.items-center.justify-center.py-12', [
            m('.animate-spin.rounded-full.h-8.w-8.border-b-2.border-indigo-600'),
          ])
        : state.records.length === 0
          ? m('.bg-white dark:bg-slate-800.rounded-lg.shadow-sm.border.border-gray-200 dark:border-slate-600.p-12.text-center', [
              m('svg.w-12.h-12.mx-auto.text-gray-400 dark:text-slate-500.mb-4', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' }, [
                m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '1.5', d: 'M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4' }),
              ]),
              m('h3.text-lg.font-medium.text-gray-900 dark:text-slate-100.mb-1', 'No records found'),
              m('p.text-gray-500', activeFilterCount > 0 ? 'Try adjusting your filters' : 'Get started by creating your first record'),
            ])
          : m('.bg-white dark:bg-slate-800.rounded-lg.shadow-sm.border.border-gray-200 dark:border-slate-600.overflow-hidden', [
            // Bulk Actions Toolbar (shown when items selected)
            (state.selectedRecords && state.selectedRecords.size > 0) || state.selectAllMode ? m('.bg-indigo-50.dark:bg-indigo-950/40.border-b.border-indigo-100.dark:border-indigo-900/50.px-4.py-3.flex.flex-col.sm:flex-row.sm:items-center.sm:justify-between.gap-3', [
              m('.flex.flex-wrap.items-center.gap-2', [
                m('span.text-sm.text-indigo-700.dark:text-indigo-300.font-medium', 
                  state.selectAllMode 
                    ? 'All ' + state.pagination.total + ' records selected'
                    : state.selectedRecords.size + ' record' + (state.selectedRecords.size > 1 ? 's' : '') + ' selected'
                ),
                // Show "Select all X records" option when current page is fully selected
                !state.selectAllMode && state.selectedRecords.size === state.records.length && state.pagination.total > state.records.length && m('button.text-sm.text-indigo-600.dark:text-indigo-400.hover:text-indigo-800.underline.font-medium', {
                  onclick: () => {
                    state.selectAllMode = true;
                    m.redraw();
                  },
                }, 'Select all ' + state.pagination.total + ' records'),
                // Show "Select only this page" when in selectAllMode
                state.selectAllMode && m('button.text-sm.text-indigo-600.dark:text-indigo-400.hover:text-indigo-800.underline', {
                  onclick: () => {
                    state.selectAllMode = false;
                    m.redraw();
                  },
                }, 'Select only this page (' + state.selectedRecords.size + ')'),
              ]),
              m('.flex.flex-wrap.items-center.gap-1.5', [
                state.trashedView && modelMeta?.softDelete
                  ? m('button.inline-flex.items-center.gap-1.px-3.py-1.5.text-sm.font-medium.text-green-600.bg-white dark:bg-slate-800.border.border-green-200.rounded.hover:bg-green-50.transition-colors', {
                      disabled: state.bulkActionInProgress,
                      onclick: async () => {
                        if (!(await confirmAction({ title: 'Restore Records', message: 'Restore the selected records?', confirmText: 'Restore' }))) return;
                        state.bulkActionInProgress = true;
                        m.redraw();
                        try {
                          const payload = state.selectAllMode
                            ? { selectAll: true, filters: state.filters, trashed: true }
                            : { ids: Array.from(state.selectedRecords), trashed: true };
                          await api.post('/extensions/bulk-actions/bulk-restore/' + modelName, payload);
                          state.selectedRecords = new Set();
                          state.selectAllMode = false;
                          notifySuccess('Records restored successfully');
                          loadRecords(modelName, 1);
                        } catch (err) {
                          notifyError('Error: ' + err.message);
                        } finally {
                          state.bulkActionInProgress = false;
                          m.redraw();
                        }
                      },
                    }, [
                      m('svg.w-4.h-4', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                        m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M5 13l4 4L19 7' })
                      ),
                      'Restore',
                    ])
                  : (!modelMeta?.readOnly && modelMeta?.permissions?.delete !== false ? m('button.inline-flex.items-center.gap-1.px-3.py-1.5.text-sm.font-medium.text-red-600.bg-white dark:bg-slate-800.border.border-red-200.rounded.hover:bg-red-50.transition-colors', {
                      disabled: state.bulkActionInProgress,
                      onclick: async () => {
                        const count = state.selectAllMode ? state.pagination.total : state.selectedRecords.size;
                        if (!(await confirmAction({ title: 'Delete Records', message: 'Are you sure you want to delete ' + count + ' records? This action cannot be undone.', danger: true, confirmText: 'Delete' }))) return;
                        state.bulkActionInProgress = true;
                        m.redraw();
                        try {
                          const payload = state.selectAllMode 
                            ? { selectAll: true, filters: state.filters }
                            : { ids: Array.from(state.selectedRecords) };
                          await api.post('/extensions/bulk-actions/bulk-delete/' + modelName, payload);
                          state.selectedRecords = new Set();
                          state.selectAllMode = false;
                          notifySuccess('Records deleted successfully');
                          loadRecords(modelName, 1);
                        } catch (err) {
                          notifyError('Error: ' + err.message);
                        } finally {
                          state.bulkActionInProgress = false;
                          m.redraw();
                        }
                      },
                    }, [
                      m('svg.w-4.h-4', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                        m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16' })
                      ),
                      'Delete',
                    ]) : null),
                // Custom bulk actions
                !state.trashedView && customBulkActions.map(action =>
                  m('button.inline-flex.items-center.gap-1.px-3.py-1.5.text-sm.font-medium.bg-white.dark:bg-slate-800.border.rounded.transition-colors.' + getBulkActionColorClass(action.color), {
                    disabled: state.bulkActionInProgress,
                    onclick: () => executeBulkAction(action, modelName, modelMeta),
                  }, [
                    action.icon ? renderActionIcon(action.icon) : null,
                    action.label,
                  ])
                ),
                !state.trashedView ? m('button.inline-flex.items-center.gap-1.px-3.py-1.5.text-sm.font-medium.text-blue-600.bg-white dark:bg-slate-800.border.border-blue-200.rounded.hover:bg-blue-50.transition-colors', {
                  disabled: state.bulkActionInProgress,
                  onclick: async () => {
                    state.bulkActionInProgress = true;
                    m.redraw();
                    try {
                      const payload = state.selectAllMode 
                        ? { selectAll: true, filters: state.filters }
                        : { ids: Array.from(state.selectedRecords) };
                      const response = await api.post('/extensions/export?model=' + modelName + '&format=json', payload);
                      // Download as file
                      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.style.display = 'none';
                      a.href = url;
                      a.download = modelName + '-export.json';
                      document.body.appendChild(a);
                      a.click();
                      setTimeout(function () {
                        if (a.parentNode) a.parentNode.removeChild(a);
                        URL.revokeObjectURL(url);
                      }, 1000);
                    } catch (err) {
                      notifyError('Error: ' + err.message);
                    } finally {
                      state.bulkActionInProgress = false;
                      m.redraw();
                    }
                  },
                }, [
                  m('svg.w-4.h-4', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4' })
                  ),
                  'Export JSON',
                ]) : null,
                !state.trashedView ? m('button.inline-flex.items-center.gap-1.px-3.py-1.5.text-sm.font-medium.text-green-600.bg-white dark:bg-slate-800.border.border-green-200.rounded.hover:bg-green-50.transition-colors', {
                  disabled: state.bulkActionInProgress,
                  onclick: async () => {
                    state.bulkActionInProgress = true;
                    m.redraw();
                    try {
                      const payload = state.selectAllMode 
                        ? { selectAll: true, filters: state.filters }
                        : { ids: Array.from(state.selectedRecords) };
                      if (!state.selectAllMode && (!payload.ids || payload.ids.length === 0)) {
                        notifyWarning('Please select at least one record to export');
                        return;
                      }
                      const response = await api.post('/extensions/export?model=' + modelName + '&format=csv', payload);
                      // Download as file
                      const blob = new Blob([response.data], { type: 'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.style.display = 'none';
                      a.href = url;
                      a.download = modelName + '-export.csv';
                      document.body.appendChild(a);
                      a.click();
                      setTimeout(function () {
                        if (a.parentNode) a.parentNode.removeChild(a);
                        URL.revokeObjectURL(url);
                      }, 1000);
                    } catch (err) {
                      notifyError('Error: ' + err.message);
                    } finally {
                      state.bulkActionInProgress = false;
                      m.redraw();
                    }
                  },
                }, [
                  m('svg.w-4.h-4', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4' })
                  ),
                  'Export CSV',
                ]) : null,
                m('button.inline-flex.items-center.gap-1.px-3.py-1.5.text-sm.font-medium.text-violet-600.bg-white dark:bg-slate-800.border.border-violet-200.rounded.hover:bg-violet-50.transition-colors', {
                  disabled: state.bulkActionInProgress,
                  onclick: async () => {
                    state.bulkActionInProgress = true;
                    m.redraw();
                    try {
                      const payload = state.selectAllMode 
                        ? { selectAll: true, filters: state.filters }
                        : { ids: Array.from(state.selectedRecords) };
                      if (!state.selectAllMode && (!payload.ids || payload.ids.length === 0)) {
                        notifyWarning('Please select at least one record to export');
                        return;
                      }
                      if (state.trashedView) payload.trashed = 'only';
                      await downloadDataExchangeXlsx(modelName, payload);
                    } catch (err) {
                      notifyError('Error: ' + err.message);
                    } finally {
                      state.bulkActionInProgress = false;
                      m.redraw();
                    }
                  },
                }, [
                  m('svg.w-4.h-4', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4' })
                  ),
                  'Export Excel',
                ]),
                !state.trashedView ? m(BulkFieldUpdateDropdown, {
                  modelName: modelName,
                  selectedIds: state.selectAllMode ? null : Array.from(state.selectedRecords),
                  selectAllMode: state.selectAllMode,
                  filters: state.filters,
                  onComplete: () => {
                    state.selectedRecords = new Set();
                    state.selectAllMode = false;
                    loadRecords(modelName, state.pagination.page);
                  },
                }) : null,
                m('button.px-3.py-1.5.text-sm.text-gray-500 dark:text-slate-400.hover:text-gray-700 dark:hover:text-slate-200 dark:hover:text-slate-200', {
                  onclick: () => {
                    state.selectedRecords = new Set();
                    state.selectAllMode = false;
                    state.bulkFieldDropdownOpen = false;
                    state.selectedBulkField = null;
                    m.redraw();
                  },
                }, 'Clear'),
              ]),
            ]) : null,
            // Table container with sticky header, fixed columns, and overflow scroll
            m('.overflow-auto.max-h-[calc(100vh-380px)]', { style: 'position: relative;' }, [
              m('table.w-full.border-collapse', { style: 'min-width: 100%;' }, [
                // Sticky header
                m('thead.bg-gray-50.dark:bg-slate-900', { style: 'position: sticky; top: 0; z-index: 20;' }, [
                  m('tr', [
                    // Checkbox column header (sticky left on md+, box-shadow on right)
                    m('th.px-4.py-3.text-left.bg-gray-50.dark:bg-slate-900.border-b.border-gray-200.dark:border-slate-700.admin-table-sticky-check', { style: 'width: 40px;' }, [
                      m('input[type=checkbox].rounded.border-gray-300 dark:border-slate-600.text-indigo-600.focus:ring-indigo-500', {
                        checked: state.records.length > 0 && state.selectedRecords && state.selectedRecords.size === state.records.length,
                        indeterminate: state.selectedRecords && state.selectedRecords.size > 0 && state.selectedRecords.size < state.records.length,
                        onchange: (e) => {
                          if (e.target.checked) {
                            state.selectedRecords = new Set(state.records.map(r => r[primaryKey]));
                          } else {
                            state.selectedRecords = new Set();
                          }
                          m.redraw();
                        },
                      }),
                    ]),
                    // Dynamic column headers (first column sticky left on md+ with box-shadow)
                    ...displayColumns.map((col, i) => {
                      const isSortable = col.sortable !== false;
                      const isSorted = isSortable && state.sortColumn === col.name;
                      const dir = isSorted ? state.sortDirection : null;
                      const stickyClass = i === 0 ? '.admin-table-sticky-first' : '';

                      if (!isSortable) {
                        return m('th.px-4.py-3.text-left.text-xs.font-medium.text-gray-500.dark:text-slate-400.uppercase.tracking-wider.whitespace-nowrap.bg-gray-50.dark:bg-slate-900.border-b.border-gray-200.dark:border-slate-700' + stickyClass,
                          formatColumnLabel(col.name)
                        );
                      }

                      return m('th.px-4.py-3.text-left.text-xs.font-medium.text-gray-500.dark:text-slate-400.uppercase.tracking-wider.whitespace-nowrap.bg-gray-50.dark:bg-slate-900.border-b.border-gray-200.dark:border-slate-700.cursor-pointer.select-none.hover:bg-gray-100.dark:hover:bg-slate-800/80.transition-colors.group' + stickyClass,
                        {
                          onclick: () => {
                            let nextSort = col.name;
                            let nextDir = 'asc';
                            if (state.sortColumn === col.name) {
                              if (state.sortDirection === 'asc') {
                                nextDir = 'desc';
                              } else if (state.sortDirection === 'desc') {
                                nextSort = null;
                                nextDir = null;
                              }
                            }
                            state.sortColumn = nextSort;
                            state.sortDirection = nextDir;
                            loadRecords(modelName, 1, state.filters, nextSort, nextDir);
                          },
                        },
                        m('.flex.items-center.gap-1.5', [
                          m('span', formatColumnLabel(col.name)),
                          dir === 'asc'
                            ? m('svg.w-3.5.h-3.5.text-indigo-600.dark:text-indigo-400.flex-shrink-0', { fill: 'currentColor', viewBox: '0 0 20 20' },
                                m('path', { 'fill-rule': 'evenodd', d: 'M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z', 'clip-rule': 'evenodd' })
                              )
                            : dir === 'desc'
                              ? m('svg.w-3.5.h-3.5.text-indigo-600.dark:text-indigo-400.flex-shrink-0', { fill: 'currentColor', viewBox: '0 0 20 20' },
                                  m('path', { 'fill-rule': 'evenodd', d: 'M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z', 'clip-rule': 'evenodd' })
                                )
                              : m('svg.w-3.5.h-3.5.text-gray-300.dark:text-slate-600.group-hover:text-gray-400.flex-shrink-0', { fill: 'currentColor', viewBox: '0 0 20 20' },
                                  m('path', { d: 'M5 12a1 1 0 100 2h10a1 1 0 100-2H5zM5 6a1 1 0 100 2h10a1 1 0 100-2H5z' })
                                )
                        ])
                      );
                    }),
                    // Sticky actions header (sticky right on md+, box-shadow on left)
                    m('th.px-4.py-3.text-right.text-xs.font-medium.text-gray-500.dark:text-slate-400.uppercase.tracking-wider.bg-gray-50.dark:bg-slate-900.border-b.border-gray-200.dark:border-slate-700.admin-table-sticky-actions', {
                      style: 'min-width: 120px;',
                    }, 'Actions'),
                  ]),
                ]),
                m('tbody.divide-y.divide-gray-100.dark:divide-slate-700', state.records.map(record => 
                  m('tr.hover:bg-gray-50.dark:hover:bg-slate-800/50.transition-colors', {
                    class: state.selectedRecords && state.selectedRecords.has(record[primaryKey]) ? 'bg-indigo-50 dark:bg-indigo-950/50' : '',
                  }, [
                    // Checkbox cell (sticky left on md+, box-shadow on right)
                    m('td.px-4.py-3.bg-white.dark:bg-slate-800.admin-table-sticky-check', [
                      m('input[type=checkbox].rounded.border-gray-300.dark:border-slate-600.text-indigo-600.focus:ring-indigo-500', {
                        checked: state.selectedRecords && state.selectedRecords.has(record[primaryKey]),
                        onchange: (e) => {
                          if (!state.selectedRecords) state.selectedRecords = new Set();
                          if (e.target.checked) {
                            state.selectedRecords.add(record[primaryKey]);
                          } else {
                            state.selectedRecords.delete(record[primaryKey]);
                          }
                          m.redraw();
                        },
                      }),
                    ]),
                    // Dynamic cell values (first column sticky left on md+ with box-shadow)
                    ...displayColumns.map((col, i) => 
                      m('td.px-4.py-3.text-sm.whitespace-nowrap.text-gray-700.dark:text-slate-300.bg-white.dark:bg-slate-800' + (i === 0 ? '.admin-table-sticky-first' : ''),
                        formatCellValue(record[col.name], col, record)
                      )
                    ),
                    // Sticky actions cell (sticky right on md+, box-shadow on left)
                    m('td.px-4.py-3.text-sm.text-right.whitespace-nowrap.text-gray-700.dark:text-slate-300.bg-white.dark:bg-slate-800.admin-table-sticky-actions', [
                      state.trashedView && modelMeta?.softDelete
                        ? m('button.inline-flex.items-center.px-2.py-1.text-sm.text-green-600.dark:text-green-400.hover:text-green-800.dark:hover:text-green-300.hover:bg-green-50.dark:hover:bg-green-950/40.rounded.transition-colors', {
                            onclick: async () => {
                              try {
                                await api.post('/models/' + modelName + '/records/' + record[primaryKey] + '/restore');
                                notifySuccess('Record restored successfully');
                                loadRecords(modelName, state.pagination.page);
                              } catch (err) {
                                notifyError('Error: ' + err.message);
                              }
                            },
                          }, 'Restore')
                        : [
                            // Custom row actions
                            ...customActions
                              .filter(action => shouldShowAction(action, record))
                              .map(action =>
                                m('button.inline-flex.items-center.px-2.py-1.text-sm.rounded.mr-1.transition-colors.' + getActionColorClass(action.color), {
                                  disabled: state.actionInProgress === (action.id + '-' + record[primaryKey]),
                                  onclick: () => executeRecordAction(action, record, modelName, modelMeta),
                                }, [
                                  action.icon ? m('span.mr-1', renderActionIcon(action.icon)) : null,
                                  state.actionInProgress === (action.id + '-' + record[primaryKey]) ? '...' : action.label,
                                ])
                              ),
                            m('button.inline-flex.items-center.px-2.py-1.text-sm.text-indigo-600.dark:text-indigo-400.hover:text-indigo-800.dark:hover:text-indigo-300.hover:bg-indigo-50.dark:hover:bg-indigo-950/40.rounded.mr-1.transition-colors', {
                              onclick: () => {
                                state.currentRecord = record;
                                state.editing = true;
                                m.route.set('/models/' + modelName + '/edit/' + record[primaryKey]);
                              },
                            }, modelMeta?.readOnly || modelMeta?.permissions?.edit === false ? 'View' : 'Edit'),
                            !modelMeta?.readOnly && modelMeta?.permissions?.delete !== false ? m('button.inline-flex.items-center.px-2.py-1.text-sm.text-red-600.dark:text-red-400.hover:text-red-800.dark:hover:text-red-300.hover:bg-red-50.dark:hover:bg-red-950/40.rounded.transition-colors', {
                              onclick: async () => {
                                const isConfirmed = await confirmAction({
                                  title: 'Delete Record',
                                  message: 'Are you sure you want to delete this record?',
                                  danger: true,
                                  confirmText: 'Delete'
                                });
                                if (isConfirmed) {
                                  try {
                                    await api.delete('/models/' + modelName + '/records/' + record[primaryKey]);
                                    notifySuccess('Record deleted successfully');
                                    loadRecords(modelName, state.pagination.page);
                                  } catch (err) {
                                    const errMsg = 'Error: ' + err.message;
                                    notifyError(errMsg);
                                  }
                                }
                              },
                            }, 'Delete') : null,
                          ],
                    ]),
                  ])
                )),
              ]),
            ]),
            // Pagination
            m(Pagination, {
              page: state.pagination.page,
              perPage: state.pagination.perPage,
              total: state.pagination.total,
              totalPages: state.pagination.totalPages,
              onPageChange: (newPage) => loadRecords(modelName, newPage),
            }),
          ]),
    ]);
  },
};

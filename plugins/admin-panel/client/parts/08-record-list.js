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
    const displayColumns = modelMeta ? getDisplayColumns(modelMeta.columns) : [];
    const primaryKey = modelMeta?.primaryKey || 'id';
    
    // Count active filters
    const activeFilterCount = Object.values(state.filters || {}).filter(f => 
      f && (f.value !== '' || f.from || f.to)
    ).length;
    
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
      m('.flex.items-center.justify-between.mb-4', [
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
          modelMeta?.softDelete ? m('.flex.rounded-lg.border.border-gray-200 dark:border-slate-600.p-0.5', [
            m('button.px-3.py-1.5.text-sm.font-medium.rounded-md.transition-colors', {
              class: !state.trashedView ? 'bg-indigo-600.text-white' : 'text-gray-600.hover:text-gray-900 dark:hover:text-slate-100 dark:hover:text-slate-100',
              onclick: () => {
                state.trashedView = false;
                loadRecords(modelName, 1);
              },
            }, 'Active'),
            m('button.px-3.py-1.5.text-sm.font-medium.rounded-md.transition-colors', {
              class: state.trashedView ? 'bg-indigo-600.text-white' : 'text-gray-600.hover:text-gray-900 dark:hover:text-slate-100 dark:hover:text-slate-100',
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
                alert('Error: ' + err.message);
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
              const mode = window.confirm('OK = upsert by id, Cancel = insert only') ? 'upsert' : 'insert';
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
                alert(msg);
                loadRecords(modelName, state.pagination.page, state.filters);
              } catch (err) {
                alert('Error: ' + err.message);
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
          !state.trashedView ? m('button.inline-flex.items-center.gap-2.px-4.py-2.text-sm.font-medium.text-white.bg-indigo-600.rounded-lg.hover:bg-indigo-700.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
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
            (state.selectedRecords && state.selectedRecords.size > 0) || state.selectAllMode ? m('.bg-indigo-50.border-b.border-indigo-100.px-4.py-3.flex.items-center.justify-between', [
              m('.flex.items-center.gap-3', [
                m('span.text-sm.text-indigo-700.font-medium', 
                  state.selectAllMode 
                    ? 'All ' + state.pagination.total + ' records selected'
                    : state.selectedRecords.size + ' record' + (state.selectedRecords.size > 1 ? 's' : '') + ' selected'
                ),
                // Show "Select all X records" option when current page is fully selected
                !state.selectAllMode && state.selectedRecords.size === state.records.length && state.pagination.total > state.records.length && m('button.text-sm.text-indigo-600.hover:text-indigo-800.underline.font-medium', {
                  onclick: () => {
                    state.selectAllMode = true;
                    m.redraw();
                  },
                }, 'Select all ' + state.pagination.total + ' records'),
                // Show "Select only this page" when in selectAllMode
                state.selectAllMode && m('button.text-sm.text-indigo-600.hover:text-indigo-800.underline', {
                  onclick: () => {
                    state.selectAllMode = false;
                    m.redraw();
                  },
                }, 'Select only this page (' + state.selectedRecords.size + ')'),
              ]),
              m('.flex.items-center.gap-2', [
                state.trashedView && modelMeta?.softDelete
                  ? m('button.inline-flex.items-center.gap-1.px-3.py-1.5.text-sm.font-medium.text-green-600.bg-white dark:bg-slate-800.border.border-green-200.rounded.hover:bg-green-50.transition-colors', {
                      disabled: state.bulkActionInProgress,
                      onclick: async () => {
                        if (!confirm('Restore the selected records?')) return;
                        state.bulkActionInProgress = true;
                        m.redraw();
                        try {
                          const payload = state.selectAllMode
                            ? { selectAll: true, filters: state.filters, trashed: true }
                            : { ids: Array.from(state.selectedRecords), trashed: true };
                          await api.post('/extensions/bulk-actions/bulk-restore/' + modelName, payload);
                          state.selectedRecords = new Set();
                          state.selectAllMode = false;
                          loadRecords(modelName, 1);
                        } catch (err) {
                          alert('Error: ' + err.message);
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
                  : m('button.inline-flex.items-center.gap-1.px-3.py-1.5.text-sm.font-medium.text-red-600.bg-white dark:bg-slate-800.border.border-red-200.rounded.hover:bg-red-50.transition-colors', {
                      disabled: state.bulkActionInProgress,
                      onclick: async () => {
                        const count = state.selectAllMode ? state.pagination.total : state.selectedRecords.size;
                        if (!confirm('Are you sure you want to delete ' + count + ' records? This action cannot be undone.')) return;
                        state.bulkActionInProgress = true;
                        m.redraw();
                        try {
                          const payload = state.selectAllMode 
                            ? { selectAll: true, filters: state.filters }
                            : { ids: Array.from(state.selectedRecords) };
                          await api.post('/extensions/bulk-actions/bulk-delete/' + modelName, payload);
                          state.selectedRecords = new Set();
                          state.selectAllMode = false;
                          loadRecords(modelName, 1);
                        } catch (err) {
                          alert('Error: ' + err.message);
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
                    ]),
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
                      a.href = url;
                      a.download = modelName + '-export.json';
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch (err) {
                      alert('Error: ' + err.message);
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
                      const response = await api.post('/extensions/export?model=' + modelName + '&format=csv', payload);
                      // Download as file
                      const blob = new Blob([response.data], { type: 'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = modelName + '-export.csv';
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch (err) {
                      alert('Error: ' + err.message);
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
                      if (state.trashedView) payload.trashed = 'only';
                      await downloadDataExchangeXlsx(modelName, payload);
                    } catch (err) {
                      alert('Error: ' + err.message);
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
                    // Checkbox column header (sticky left, box-shadow on right)
                    m('th.px-4.py-3.text-left.bg-gray-50 dark:bg-slate-900.border-b.border-gray-200 dark:border-slate-700', { style: 'width: 40px; position: sticky; left: 0; z-index: 15; box-shadow: 4px 0 8px -4px rgba(0,0,0,0.08);' }, [
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
                    // Dynamic column headers (first column sticky left with box-shadow)
                    ...displayColumns.map((col, i) => 
                      m('th.px-4.py-3.text-left.text-xs.font-medium.text-gray-500 dark:text-slate-400.uppercase.tracking-wider.whitespace-nowrap.bg-gray-50 dark:bg-slate-900.border-b.border-gray-200 dark:border-slate-700', 
                        i === 0 ? { style: 'position: sticky; left: 40px; z-index: 15; box-shadow: 4px 0 8px -4px rgba(0,0,0,0.08);' } : {},
                        formatColumnLabel(col.name)
                      )
                    ),
                    // Sticky actions header (sticky right, box-shadow on left)
                    m('th.px-4.py-3.text-right.text-xs.font-medium.text-gray-500 dark:text-slate-400.uppercase.tracking-wider.bg-gray-50 dark:bg-slate-900.border-b.border-gray-200 dark:border-slate-700', {
                      style: 'position: sticky; right: 0; min-width: 120px; z-index: 15; box-shadow: -4px 0 8px -4px rgba(0,0,0,0.08);',
                    }, 'Actions'),
                  ]),
                ]),
                m('tbody.divide-y.divide-gray-100.dark:divide-slate-700', state.records.map(record => 
                  m('tr.hover:bg-gray-50 dark:hover:bg-slate-800/50.transition-colors', {
                    class: state.selectedRecords && state.selectedRecords.has(record[primaryKey]) ? 'bg-indigo-50 dark:bg-indigo-950/50' : '',
                  }, [
                    // Checkbox cell (sticky left, box-shadow on right)
                    m('td.px-4.py-3.bg-white.dark:bg-slate-800', {
                      style: 'position: sticky; left: 0; z-index: 5; box-shadow: 4px 0 8px -4px rgba(0,0,0,0.08);',
                    }, [
                      m('input[type=checkbox].rounded.border-gray-300 dark:border-slate-600.text-indigo-600.focus:ring-indigo-500', {
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
                    // Dynamic cell values (first column sticky left with box-shadow)
                    ...displayColumns.map((col, i) => 
                      m('td.px-4.py-3.text-sm.whitespace-nowrap.text-gray-700 dark:text-slate-300.bg-white dark:bg-slate-800',
                        i === 0 ? { style: 'position: sticky; left: 40px; z-index: 5; box-shadow: 4px 0 8px -4px rgba(0,0,0,0.08);' } : {},
                        formatCellValue(record[col.name], col)
                      )
                    ),
                    // Sticky actions cell (sticky right, box-shadow on left)
                    m('td.px-4.py-3.text-sm.text-right.whitespace-nowrap.text-gray-700 dark:text-slate-300.bg-white dark:bg-slate-800', {
                      style: 'position: sticky; right: 0; z-index: 5; box-shadow: -4px 0 8px -4px rgba(0,0,0,0.08);',
                    }, [
                      state.trashedView && modelMeta?.softDelete
                        ? m('button.inline-flex.items-center.px-2.py-1.text-sm.text-green-600.dark:text-green-400.hover:text-green-800.dark:hover:text-green-300.hover:bg-green-50.dark:hover:bg-green-950/40.rounded.transition-colors', {
                            onclick: async () => {
                              try {
                                await api.post('/models/' + modelName + '/records/' + record[primaryKey] + '/restore');
                                loadRecords(modelName, state.pagination.page);
                              } catch (err) {
                                alert('Error: ' + err.message);
                              }
                            },
                          }, 'Restore')
                        : [
                            m('button.inline-flex.items-center.px-2.py-1.text-sm.text-indigo-600.dark:text-indigo-400.hover:text-indigo-800.dark:hover:text-indigo-300.hover:bg-indigo-50.dark:hover:bg-indigo-950/40.rounded.mr-1.transition-colors', {
                              onclick: () => {
                                state.currentRecord = record;
                                state.editing = true;
                                m.route.set('/models/' + modelName + '/edit/' + record[primaryKey]);
                              },
                            }, 'Edit'),
                            m('button.inline-flex.items-center.px-2.py-1.text-sm.text-red-600.dark:text-red-400.hover:text-red-800.dark:hover:text-red-300.hover:bg-red-50.dark:hover:bg-red-950/40.rounded.transition-colors', {
                              onclick: async () => {
                                if (confirm('Are you sure you want to delete this record?')) {
                                  try {
                                    await api.delete('/models/' + modelName + '/records/' + record[primaryKey]);
                                    loadRecords(modelName, state.pagination.page);
                                  } catch (err) {
                                    alert('Error: ' + err.message);
                                  }
                                }
                              },
                            }, 'Delete'),
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

/**
 * Schema Explorer Admin SPA Component (Mithril.js)
 * Clean, modern, zero-CDN interface for exploring database tables, columns, constraints, and relationships.
 */

'use strict';

/**
 * Generates the Mithril client-side component code as a string
 * @param {Object} [options]
 * @param {string} [options.apiPrefix='/schema']
 * @returns {string} JavaScript client code
 */
function generateSchemaExplorerAdminComponent(options = {}) {
  const { apiPrefix = '/schema' } = options;

  return `
(function() {

function getSchemaApi(method, path) {
  var adminPath = window.__ADMIN_PATH__ || '/_admin';
  var url = adminPath + '/api${apiPrefix}' + (path || '');
  var fetchFn = (typeof window !== 'undefined' && window.Admin && window.Admin.fetch) ? window.Admin.fetch : fetch;
  return fetchFn(url, {
    method: method || 'GET',
    credentials: 'include',
    headers: { 'Accept': 'application/json' },
    timeout: 30000,
  }).then(function(res) {
    if (!res.ok) {
      return res.json().catch(function() { return { error: res.statusText }; }).then(function(err) {
        throw new Error(err.error || 'Failed to load schema data (' + res.status + ')');
      });
    }
    return res.json();
  });
}

function copyTextToClipboard(text, onSuccess) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      if (typeof onSuccess === 'function') onSuccess();
    }).catch(function() {
      fallbackCopy(text, onSuccess);
    });
  } else {
    fallbackCopy(text, onSuccess);
  }
}

function fallbackCopy(text, onSuccess) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    if (typeof onSuccess === 'function') onSuccess();
  } catch (e) {
    console.error('Copy failed:', e);
  }
  document.body.removeChild(ta);
}

function downloadFile(content, fileName, contentType) {
  var blob = new Blob([content], { type: contentType || 'text/plain;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(function() {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

var SchemaExplorerPage = {
  oninit: function(vnode) {
    vnode.state.loading = true;
    vnode.state.error = null;
    vnode.state.models = [];
    vnode.state.relationships = [];
    vnode.state.mermaid = '';
    vnode.state.activeTab = 'details'; // 'details' | 'graph' | 'mermaid'
    vnode.state.selectedModelName = null;
    vnode.state.searchQuery = '';
    vnode.state.selectedGraphModel = null;
    vnode.state.copiedMermaid = false;
    vnode.state.copiedJson = false;

    this.loadData(vnode);
  },

  loadData: function(vnode) {
    vnode.state.loading = true;
    vnode.state.error = null;

    getSchemaApi('GET', '')
      .then(function(data) {
        vnode.state.models = data.models || [];
        vnode.state.relationships = data.relationships || [];
        vnode.state.mermaid = data.mermaid || '';
        
        // Auto-select first model if none selected
        if (!vnode.state.selectedModelName && vnode.state.models.length > 0) {
          vnode.state.selectedModelName = vnode.state.models[0].name;
        }

        vnode.state.loading = false;
        m.redraw();
      })
      .catch(function(err) {
        vnode.state.error = err.message || String(err);
        vnode.state.loading = false;
        m.redraw();
      });
  },

  selectModel: function(vnode, name) {
    vnode.state.selectedModelName = name;
    vnode.state.activeTab = 'details';
    m.redraw();
  },

  copyMermaid: function(vnode) {
    var self = this;
    copyTextToClipboard(vnode.state.mermaid, function() {
      vnode.state.copiedMermaid = true;
      m.redraw();
      setTimeout(function() {
        vnode.state.copiedMermaid = false;
        m.redraw();
      }, 2000);
    });
  },

  downloadJson: function(vnode) {
    var payload = JSON.stringify({
      models: vnode.state.models,
      relationships: vnode.state.relationships,
      generatedAt: new Date().toISOString()
    }, null, 2);
    downloadFile(payload, 'database-schema.json', 'application/json');
  },

  view: function(vnode) {
    var s = vnode.state;
    var self = this;

    // Filter models by search query
    var q = (s.searchQuery || '').toLowerCase().trim();
    var filteredModels = s.models.filter(function(m) {
      if (!q) return true;
      if (m.name.toLowerCase().indexOf(q) !== -1) return true;
      if (m.table.toLowerCase().indexOf(q) !== -1) return true;
      if (m.columns && m.columns.some(function(c) { return c.name.toLowerCase().indexOf(q) !== -1; })) return true;
      return false;
    });

    // Active selected model
    var selectedModel = s.models.find(function(m) { return m.name === s.selectedModelName; }) || filteredModels[0] || null;

    // Compute stats
    var totalColumns = s.models.reduce(function(acc, m) { return acc + (m.columns ? m.columns.length : 0); }, 0);
    var totalRelations = s.relationships.length;

    return m('div.space-y-6', [
      // 1. Top Header Banner
      m('div.bg-gradient-to-r.from-slate-900.via-indigo-950.to-slate-900.text-white.p-6.rounded-2xl.shadow-lg.border.border-slate-800', [
        m('div.flex.flex-col.md:flex-row.md:items-center.justify-between.gap-4', [
          m('div.flex.items-center.space-x-4', [
            m('div.w-12.h-12.rounded-xl.bg-indigo-600.bg-opacity-80.flex.items-center.justify-center.text-2xl.shadow-inner.flex-shrink-0', '🗄️'),
            m('div', [
              m('h1.text-2xl.font-extrabold.tracking-tight', 'Database Schema & Relations Explorer'),
              m('p.text-sm.text-slate-300.mt-1', 'Explore database tables, column constraints, and relationships interactively.'),
            ]),
          ]),
          m('div.flex.flex-wrap.items-center.gap-2', [
            m('button.inline-flex.items-center.px-3.py-2.rounded-lg.text-xs.font-semibold.bg-slate-800.hover:bg-slate-700.text-slate-200.border.border-slate-700.transition-colors.shadow-sm', {
              onclick: function() { self.loadData(vnode); },
              title: 'Refresh Schema'
            }, [
              m('span.mr-1.5', '🔄'),
              'Refresh'
            ]),
            m('button.inline-flex.items-center.px-3.py-2.rounded-lg.text-xs.font-semibold.bg-indigo-600.hover:bg-indigo-500.text-white.transition-colors.shadow-sm', {
              onclick: function() { self.copyMermaid(vnode); },
              title: 'Copy Mermaid ER Code'
            }, [
              m('span.mr-1.5', s.copiedMermaid ? '✓' : '📋'),
              s.copiedMermaid ? 'Copied!' : 'Copy Mermaid'
            ]),
            m('button.inline-flex.items-center.px-3.py-2.rounded-lg.text-xs.font-semibold.bg-slate-800.hover:bg-slate-700.text-slate-200.border.border-slate-700.transition-colors.shadow-sm', {
              onclick: function() { self.downloadJson(vnode); },
              title: 'Download Schema as JSON'
            }, [
              m('span.mr-1.5', '💾'),
              'Download JSON'
            ]),
          ]),
        ]),

        // Stat Counter Badges
        m('div.grid.grid-cols-2.sm:grid-cols-4.gap-3.mt-6.pt-4.border-t.border-slate-800/80', [
          renderStatPill('📦 Models', s.models.length + ' Tables'),
          renderStatPill('📑 Total Columns', totalColumns + ' Columns'),
          renderStatPill('🔗 Relationships', totalRelations + ' Connections'),
          renderStatPill('⚡ Status', s.loading ? 'Loading…' : 'Active & Synced'),
        ]),
      ]),

      // Loading & Error States
      s.loading && m('div.flex.items-center.justify-center.py-16.bg-white.dark:bg-slate-800.rounded-xl.shadow-sm.border.border-gray-200.dark:border-slate-700', [
        m('div.text-center', [
          m('div.inline-block.animate-spin.rounded-full.h-8.w-8.border-4.border-indigo-500.border-t-transparent.mb-3'),
          m('p.text-sm.text-gray-500.dark:text-slate-400', 'Scanning schemas and relationships…'),
        ])
      ]),

      s.error && m('div.p-4.rounded-xl.bg-red-50.dark:bg-red-950/40.border.border-red-200.dark:border-red-800.text-red-700.dark:text-red-300.flex.items-start.space-x-3', [
        m('span.text-xl', '⚠️'),
        m('div', [
          m('h4.font-bold.text-sm', 'Schema Loading Error'),
          m('p.text-xs.mt-1', s.error),
          m('button.mt-2.text-xs.underline.font-semibold', { onclick: function() { self.loadData(vnode); } }, 'Retry'),
        ])
      ]),

      !s.loading && !s.error && m('div.space-y-6', [
        // 2. Tab Navigation
        m('div.border-b.border-gray-200.dark:border-slate-700.flex.space-x-4', [
          renderTabButton('details', '📋 Table & Column Details', s.activeTab, function() { s.activeTab = 'details'; }),
          renderTabButton('graph', '🌐 Relationship Map (ER)', s.activeTab, function() { s.activeTab = 'graph'; }),
          renderTabButton('mermaid', '🧜‍♂️ Mermaid ER Code', s.activeTab, function() { s.activeTab = 'mermaid'; }),
        ]),

        // 3. Tab Contents
        s.activeTab === 'details' && renderDetailsTab(vnode, filteredModels, selectedModel, self),
        s.activeTab === 'graph' && renderGraphTab(vnode, self),
        s.activeTab === 'mermaid' && renderMermaidTab(vnode, self),
      ])
    ]);
  }
};

function renderStatPill(label, val) {
  return m('div.bg-slate-800/60.rounded-xl.p-3.border.border-slate-700/50', [
    m('div.text-xs.text-slate-400.font-medium', label),
    m('div.text-base.font-bold.text-white.mt-0.5', val),
  ]);
}

function renderTabButton(id, title, activeTab, onClick) {
  var isActive = activeTab === id;
  return m('button.py-3.px-4.border-b-2.text-sm.font-medium.transition-colors.flex.items-center.space-x-2', {
    class: isActive
      ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-semibold'
      : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200',
    onclick: onClick
  }, title);
}

/** TAB 1: Table & Column Details */
function renderDetailsTab(vnode, filteredModels, selectedModel, self) {
  var s = vnode.state;

  return m('div.grid.grid-cols-1.lg:grid-cols-12.gap-6', [
    // Left: Table List
    m('div.lg:col-span-4.space-y-4', [
      m('div.bg-white.dark:bg-slate-800.rounded-xl.shadow-sm.border.border-gray-200.dark:border-slate-700.p-4', [
        m('div.relative.mb-3', [
          m('input.w-full.bg-gray-50.dark:bg-slate-900.border.border-gray-200.dark:border-slate-700.rounded-lg.px-3.py-2.text-sm.text-gray-900.dark:text-slate-100.placeholder-gray-400.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
            placeholder: '🔍 Search tables or columns…',
            value: s.searchQuery,
            oninput: function(e) { s.searchQuery = e.target.value; }
          }),
          s.searchQuery && m('button.absolute.right-2.top-2.text-gray-400.hover:text-gray-600.text-xs', {
            onclick: function() { s.searchQuery = ''; }
          }, '✕')
        ]),

        m('div.text-xs.font-semibold.uppercase.tracking-wider.text-gray-400.dark:text-slate-500.mb-2', 
          'Tables (' + filteredModels.length + ')'
        ),

        m('div.space-y-1.5.max-h-[600px].overflow-y-auto.pr-1', filteredModels.map(function(model) {
          var isSelected = selectedModel && selectedModel.name === model.name;
          var colCount = (model.columns || []).length;
          var outCount = (model.outgoingRelations || []).length;
          var inCount = (model.incomingRelations || []).length;

          return m('div.p-3.rounded-xl.cursor-pointer.transition-all.border', {
            class: isSelected
              ? 'bg-indigo-50.dark:bg-indigo-950/40.border-indigo-400.dark:border-indigo-600.shadow-sm'
              : 'bg-white.dark:bg-slate-800.border-gray-200.dark:border-slate-700/60.hover:border-indigo-300.hover:bg-gray-50.dark:hover:bg-slate-700/50',
            onclick: function() { self.selectModel(vnode, model.name); }
          }, [
            m('div.flex.items-center.justify-between', [
              m('span.font-bold.text-sm', {
                class: isSelected ? 'text-indigo-900 dark:text-indigo-200' : 'text-gray-900 dark:text-slate-100'
              }, model.name),
              m('span.text-xs.font-mono.px-2.py-0.5.rounded-md.bg-gray-100.dark:bg-slate-700.text-gray-600.dark:text-slate-300',
                model.table
              ),
            ]),
            m('div.flex.items-center.space-x-3.mt-2.text-xs.text-gray-500.dark:text-slate-400', [
              m('span', colCount + ' cols'),
              (outCount + inCount > 0) && m('span.text-indigo-600.dark:text-indigo-400.font-medium', 
                '🔗 ' + (outCount + inCount) + ' relations'
              ),
              model.scopes && model.scopes.softDelete && m('span.text-amber-600.dark:text-amber-400', '🗑️ SoftDel'),
            ])
          ]);
        }))
      ])
    ]),

    // Right: Selected Model Schema Details
    m('div.lg:col-span-8.space-y-6', [
      !selectedModel ? m('div.p-12.text-center.bg-white.dark:bg-slate-800.rounded-xl.border.border-gray-200.dark:border-slate-700', [
        m('p.text-gray-500.dark:text-slate-400', 'Select a table on the left to view details.')
      ]) : [
        // Model Header Card
        m('div.bg-white.dark:bg-slate-800.rounded-xl.shadow-sm.border.border-gray-200.dark:border-slate-700.p-6', [
          m('div.flex.flex-col.sm:flex-row.sm:items-center.justify-between.gap-4', [
            m('div', [
              m('div.flex.items-center.space-x-3', [
                m('h2.text-xl.font-extrabold.text-gray-900.dark:text-slate-100', selectedModel.name),
                m('span.text-xs.font-mono.px-2.5.py-1.rounded-lg.bg-slate-100.dark:bg-slate-700.text-slate-700.dark:text-slate-200.border.border-slate-200.dark:border-slate-600', 
                  'table: ' + selectedModel.table
                ),
              ]),
              m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', 
                'Primary Key: ' + (selectedModel.primaryKey || 'id') + ' • Total ' + (selectedModel.columns || []).length + ' Columns'
              ),
            ]),

            // Scopes Badges
            m('div.flex.flex-wrap.gap-2', [
              selectedModel.scopes && selectedModel.scopes.timestamps
                ? m('span.text-xs.font-medium.px-2.5.py-1.rounded-md.bg-emerald-50.dark:bg-emerald-950/40.text-emerald-700.dark:text-emerald-300.border.border-emerald-200.dark:border-emerald-800', '⏱️ Timestamps')
                : null,
              selectedModel.scopes && selectedModel.scopes.softDelete
                ? m('span.text-xs.font-medium.px-2.5.py-1.rounded-md.bg-amber-50.dark:bg-amber-950/40.text-amber-700.dark:text-amber-300.border.border-amber-200.dark:border-amber-800', '🗑️ Soft Delete')
                : null,
              selectedModel.scopes && selectedModel.scopes.tenant
                ? m('span.text-xs.font-medium.px-2.5.py-1.rounded-md.bg-purple-50.dark:bg-purple-950/40.text-purple-700.dark:text-purple-300.border.border-purple-200.dark:border-purple-800', '🏢 Multi-Tenant')
                : null,
            ])
          ]),
        ]),

        // Columns Breakdown
        m('div.bg-white.dark:bg-slate-800.rounded-xl.shadow-sm.border.border-gray-200.dark:border-slate-700.overflow-hidden', [
          m('div.px-6.py-4.border-b.border-gray-200.dark:border-slate-700.flex.items-center.justify-between', [
            m('h3.text-base.font-bold.text-gray-900.dark:text-slate-100', 'Column Definitions'),
            m('span.text-xs.text-gray-500.dark:text-slate-400', (selectedModel.columns || []).length + ' fields')
          ]),

          m('div.overflow-x-auto', [
            m('table.min-w-full.divide-y.divide-gray-200.dark:divide-slate-700.text-left.text-sm', [
              m('thead.bg-gray-50.dark:bg-slate-900/60', [
                m('tr', [
                  m('th.px-4.py-3.text-xs.font-semibold.text-gray-500.dark:text-slate-400.uppercase', 'Column'),
                  m('th.px-4.py-3.text-xs.font-semibold.text-gray-500.dark:text-slate-400.uppercase', 'Data Type'),
                  m('th.px-4.py-3.text-xs.font-semibold.text-gray-500.dark:text-slate-400.uppercase', 'Nullable'),
                  m('th.px-4.py-3.text-xs.font-semibold.text-gray-500.dark:text-slate-400.uppercase', 'Constraints'),
                  m('th.px-4.py-3.text-xs.font-semibold.text-gray-500.dark:text-slate-400.uppercase', 'Default'),
                ])
              ]),
              m('tbody.divide-y.divide-gray-100.dark:divide-slate-700/60', (selectedModel.columns || []).map(function(col) {
                var isPk = col.primary || col.name === selectedModel.primaryKey;
                var isFk = col.references || (selectedModel.outgoingRelations || []).some(function(r) { return r.foreignKey === col.name; });

                return m('tr.hover:bg-gray-50.dark:hover:bg-slate-700/30.transition-colors', [
                  // Name + Icon
                  m('td.px-4.py-3.font-mono.text-sm.font-semibold.text-gray-900.dark:text-slate-100.flex.items-center.space-x-2', [
                    isPk && m('span.text-amber-500', { title: 'Primary Key' }, '🔑'),
                    !isPk && isFk && m('span.text-indigo-500', { title: 'Foreign Key' }, '🔗'),
                    m('span', col.name)
                  ]),

                  // Type pill
                  m('td.px-4.py-3', [
                    renderTypeBadge(col)
                  ]),

                  // Nullable
                  m('td.px-4.py-3.text-xs', [
                    col.nullable 
                      ? m('span.px-2.py-0.5.rounded.bg-amber-50.dark:bg-amber-950/40.text-amber-700.dark:text-amber-300.font-medium', 'NULL')
                      : m('span.px-2.py-0.5.rounded.bg-gray-100.dark:bg-slate-700.text-gray-700.dark:text-slate-300.font-medium', 'NOT NULL')
                  ]),

                  // Constraints
                  m('td.px-4.py-3', [
                    m('div.flex.flex-wrap.gap-1.5', [
                      isPk && m('span.text-2xs.font-bold.px-2.py-0.5.rounded.bg-amber-100.dark:bg-amber-900/60.text-amber-800.dark:text-amber-200', 'PK'),
                      col.unique && m('span.text-2xs.font-bold.px-2.py-0.5.rounded.bg-purple-100.dark:bg-purple-900/60.text-purple-800.dark:text-purple-200', 'UNIQUE'),
                      col.index && m('span.text-2xs.font-bold.px-2.py-0.5.rounded.bg-slate-100.dark:bg-slate-700.text-slate-700.dark:text-slate-300', 'INDEX'),
                      col.autoIncrement && m('span.text-2xs.font-bold.px-2.py-0.5.rounded.bg-blue-100.dark:bg-blue-900/60.text-blue-800.dark:text-blue-200', 'AUTO_INC'),
                      col.references && m('span.text-2xs.font-bold.px-2.py-0.5.rounded.bg-cyan-100.dark:bg-cyan-900/60.text-cyan-800.dark:text-cyan-200', 'FK ➔ ' + col.references),
                      !isPk && !col.unique && !col.index && !col.references && !col.autoIncrement && m('span.text-xs.text-gray-400', '—')
                    ])
                  ]),

                  // Default
                  m('td.px-4.py-3.font-mono.text-xs.text-gray-600.dark:text-slate-400', 
                    col.default !== undefined && col.default !== null ? String(col.default) : '—'
                  )
                ]);
              }))
            ])
          ])
        ]),

        // Relationships Card
        renderModelRelationsSection(vnode, selectedModel, self)
      ]
    ])
  ]);
}

function renderTypeBadge(col) {
  var type = col.type || 'string';
  var label = type;
  if (col.maxLength) label += '(' + col.maxLength + ')';
  else if (col.precision) label += '(' + col.precision + (col.scale ? ',' + col.scale : '') + ')';
  else if (col.enumValues && col.enumValues.length) label += '[' + col.enumValues.slice(0, 3).join(',') + '…]';

  var bg = 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-200';
  if (type === 'integer' || type === 'bigint' || type === 'float' || type === 'decimal') {
    bg = 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800';
  } else if (type === 'string' || type === 'text') {
    bg = 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800';
  } else if (type === 'boolean') {
    bg = 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800';
  } else if (type === 'timestamp' || type === 'date') {
    bg = 'bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800';
  } else if (type === 'json' || type === 'jsonb') {
    bg = 'bg-pink-50 text-pink-700 dark:bg-pink-950/60 dark:text-pink-300 border border-pink-200 dark:border-pink-800';
  }

  return m('span.px-2.py-0.5.rounded-md.font-mono.text-xs.font-medium', { class: bg }, label);
}

function renderModelRelationsSection(vnode, selectedModel, self) {
  var outgoing = selectedModel.outgoingRelations || [];
  var incoming = selectedModel.incomingRelations || [];

  return m('div.bg-white.dark:bg-slate-800.rounded-xl.shadow-sm.border.border-gray-200.dark:border-slate-700.p-6.space-y-6', [
    m('div.flex.items-center.justify-between.border-b.border-gray-200.dark:border-slate-700.pb-4', [
      m('h3.text-base.font-bold.text-gray-900.dark:text-slate-100', 'Model Relationships'),
      m('span.text-xs.text-gray-500.dark:text-slate-400', (outgoing.length + incoming.length) + ' total connections')
    ]),

    outgoing.length === 0 && incoming.length === 0 && m('p.text-sm.text-gray-500.dark:text-slate-400.py-4', 
      'No relationships defined or detected for this model.'
    ),

    // Outgoing Relations
    outgoing.length > 0 && m('div.space-y-3', [
      m('h4.text-xs.font-bold.uppercase.tracking-wider.text-indigo-600.dark:text-indigo-400', 
        '↗ Outgoing Relations (' + selectedModel.name + ' references)'
      ),
      m('div.grid.grid-cols-1.md:grid-cols-2.gap-3', outgoing.map(function(rel) {
        return m('div.p-4.rounded-xl.border.border-gray-200.dark:border-slate-700.bg-gray-50.dark:bg-slate-900/40.space-y-2', [
          m('div.flex.items-center.justify-between', [
            m('span.font-bold.text-sm.text-gray-900.dark:text-slate-100', rel.name),
            renderRelationTypeBadge(rel.type),
          ]),
          m('div.text-xs.text-gray-600.dark:text-slate-300.font-mono', [
            m('span.text-gray-500', rel.foreignKey || 'id'),
            m('span.mx-1.5.text-indigo-500', '➔'),
            m('span.font-semibold', (rel.targetModel || rel.targetTable) + '.' + (rel.localKey || 'id')),
          ]),
          rel.targetModel && m('button.text-xs.text-indigo-600.dark:text-indigo-400.font-semibold.hover:underline.pt-1', {
            onclick: function() { self.selectModel(vnode, rel.targetModel); }
          }, 'Go to Table: ' + rel.targetModel + ' ➔')
        ]);
      }))
    ]),

    // Incoming Relations
    incoming.length > 0 && m('div.space-y-3.pt-2', [
      m('h4.text-xs.font-bold.uppercase.tracking-wider.text-emerald-600.dark:text-emerald-400', 
        '↙ Incoming Relations (Other models referencing ' + selectedModel.name + ')'
      ),
      m('div.grid.grid-cols-1.md:grid-cols-2.gap-3', incoming.map(function(rel) {
        return m('div.p-4.rounded-xl.border.border-gray-200.dark:border-slate-700.bg-gray-50.dark:bg-slate-900/40.space-y-2', [
          m('div.flex.items-center.justify-between', [
            m('span.font-bold.text-sm.text-gray-900.dark:text-slate-100', rel.sourceModel),
            renderRelationTypeBadge(rel.type),
          ]),
          m('div.text-xs.text-gray-600.dark:text-slate-300.font-mono', [
            m('span.font-semibold', rel.sourceTable + '.' + (rel.foreignKey || 'id')),
            m('span.mx-1.5.text-emerald-500', '➔'),
            m('span.text-gray-500', selectedModel.table + '.' + (rel.localKey || 'id')),
          ]),
          m('button.text-xs.text-emerald-600.dark:text-emerald-400.font-semibold.hover:underline.pt-1', {
            onclick: function() { self.selectModel(vnode, rel.sourceModel); }
          }, 'Go to Table: ' + rel.sourceModel + ' ➔')
        ]);
      }))
    ])
  ]);
}

function renderRelationTypeBadge(type) {
  var t = type || 'belongsTo';
  var bg = 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300';
  if (t === 'hasMany') bg = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300';
  else if (t === 'hasOne') bg = 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300';
  else if (t === 'manyToMany') bg = 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300';

  return m('span.px-2.py-0.5.rounded-md.text-2xs.font-bold.uppercase.tracking-wide', { class: bg }, t);
}

/** TAB 2: Visual Relationship Map (ER) */
function renderGraphTab(vnode, self) {
  var s = vnode.state;
  var sel = s.selectedGraphModel;

  return m('div.space-y-6', [
    // Info Banner
    m('div.p-4.rounded-xl.bg-indigo-50.dark:bg-indigo-950/30.border.border-indigo-100.dark:border-indigo-900.flex.items-center.justify-between', [
      m('div.text-xs.text-indigo-900.dark:text-indigo-300', [
        m('span.font-bold', '💡 Tip: '),
        'Click on any table card to highlight all its direct relationships.'
      ]),
      sel && m('button.text-xs.font-bold.text-indigo-600.dark:text-indigo-400.hover:underline', {
        onclick: function() { s.selectedGraphModel = null; }
      }, 'Clear Selection ✕')
    ]),

    // Visual Cards Grid
    m('div.grid.grid-cols-1.md:grid-cols-2.xl:grid-cols-3.gap-5', s.models.map(function(model) {
      var isDirectlySelected = sel === model.name;
      var isConnected = false;
      if (sel) {
        var activeModel = s.models.find(function(m) { return m.name === sel; });
        if (activeModel && activeModel.connectedModels && activeModel.connectedModels.indexOf(model.name) !== -1) {
          isConnected = true;
        }
      }

      var cardBorder = 'border-gray-200 dark:border-slate-700';
      var cardOpacity = 'opacity-100';
      if (sel) {
        if (isDirectlySelected) {
          cardBorder = 'border-indigo-500 ring-2 ring-indigo-500 shadow-md';
        } else if (isConnected) {
          cardBorder = 'border-emerald-500 ring-2 ring-emerald-400/60 shadow-sm';
        } else {
          cardOpacity = 'opacity-40 hover:opacity-100';
        }
      }

      var outRels = model.outgoingRelations || [];
      var inRels = model.incomingRelations || [];

      return m('div.rounded-2xl.border.bg-white.dark:bg-slate-800.shadow-sm.p-5.transition-all.cursor-pointer', {
        class: cardBorder + ' ' + cardOpacity,
        onclick: function() {
          s.selectedGraphModel = (s.selectedGraphModel === model.name) ? null : model.name;
        }
      }, [
        // Card Header
        m('div.flex.items-center.justify-between.border-b.border-gray-100.dark:border-slate-700/80.pb-3.mb-3', [
          m('div', [
            m('div.font-extrabold.text-base.text-gray-900.dark:text-slate-100', model.name),
            m('div.text-xs.font-mono.text-gray-500.dark:text-slate-400', model.table),
          ]),
          m('span.text-xs.font-bold.px-2.py-0.5.rounded.bg-amber-100.dark:bg-amber-950/60.text-amber-800.dark:text-amber-200', 
            'PK: ' + (model.primaryKey || 'id')
          )
        ]),

        // Column preview (top 6 columns)
        m('div.space-y-1.text-xs.font-mono.py-1', (model.columns || []).slice(0, 6).map(function(c) {
          var isFk = c.references || outRels.some(function(r) { return r.foreignKey === c.name; });
          var isPk = c.primary || c.name === model.primaryKey;
          return m('div.flex.items-center.justify-between.py-0.5.px-1.5.rounded', {
            class: isPk ? 'bg-amber-50/50 dark:bg-amber-950/20' : (isFk ? 'bg-indigo-50/50 dark:bg-indigo-950/20' : '')
          }, [
            m('span.truncate', [
              isPk ? '🔑 ' : (isFk ? '🔗 ' : '• '),
              c.name
            ]),
            m('span.text-gray-400.text-2xs', c.type)
          ]);
        })),

        (model.columns || []).length > 6 && m('div.text-2xs.text-gray-400.text-center.pt-1', 
          '+ ' + ((model.columns || []).length - 6) + ' more columns…'
        ),

        // Relations footer
        m('div.mt-4.pt-3.border-t.border-gray-100.dark:border-slate-700/80.flex.flex-col.gap-2', [
          m('div.flex.items-center.justify-between.text-xs', [
            m('span.text-gray-500.dark:text-slate-400', 'Relations:'),
            m('span.font-semibold.text-indigo-600.dark:text-indigo-400', (outRels.length + inRels.length) + ' connections')
          ]),

          m('div.flex.flex-wrap.gap-1', [
            outRels.map(function(r) {
              return m('span.text-2xs.font-semibold.px-2.py-0.5.rounded.bg-indigo-50.dark:bg-indigo-950/60.text-indigo-700.dark:text-indigo-300', 
                '➔ ' + (r.targetModel || r.targetTable)
              );
            }),
            inRels.map(function(r) {
              return m('span.text-2xs.font-semibold.px-2.py-0.5.rounded.bg-emerald-50.dark:bg-emerald-950/60.text-emerald-700.dark:text-emerald-300', 
                '⬅ ' + r.sourceModel
              );
            }),
          ]),

          m('button.mt-1.w-full.py-1.5.rounded-lg.bg-gray-100.dark:bg-slate-700.hover:bg-indigo-50.dark:hover:bg-indigo-950/40.text-gray-700.dark:text-slate-200.hover:text-indigo-600.text-xs.font-semibold.transition-colors', {
            onclick: function(e) {
              e.stopPropagation();
              self.selectModel(vnode, model.name);
            }
          }, 'View Details ➔')
        ])
      ]);
    })),

    // Full Relationships Matrix / Table
    m('div.bg-white.dark:bg-slate-800.rounded-xl.shadow-sm.border.border-gray-200.dark:border-slate-700.overflow-hidden', [
      m('div.px-6.py-4.border-b.border-gray-200.dark:border-slate-700', [
        m('h3.text-base.font-bold.text-gray-900.dark:text-slate-100', 'All Relationships Matrix'),
        m('p.text-xs.text-gray-500.dark:text-slate-400.mt-0.5', 'All model connections and foreign key mappings detected in database.')
      ]),

      m('div.overflow-x-auto', [
        m('table.min-w-full.divide-y.divide-gray-200.dark:divide-slate-700.text-left.text-sm', [
          m('thead.bg-gray-50.dark:bg-slate-900/60', [
            m('tr', [
              m('th.px-4.py-3.text-xs.font-semibold.text-gray-500.dark:text-slate-400.uppercase', 'Source Model / Table'),
              m('th.px-4.py-3.text-xs.font-semibold.text-gray-500.dark:text-slate-400.uppercase', 'Relation'),
              m('th.px-4.py-3.text-xs.font-semibold.text-gray-500.dark:text-slate-400.uppercase', 'Type'),
              m('th.px-4.py-3.text-xs.font-semibold.text-gray-500.dark:text-slate-400.uppercase', 'Target Model / Table'),
              m('th.px-4.py-3.text-xs.font-semibold.text-gray-500.dark:text-slate-400.uppercase', 'Key Mapping'),
            ])
          ]),
          m('tbody.divide-y.divide-gray-100.dark:divide-slate-700/60', s.relationships.map(function(r) {
            return m('tr.hover:bg-gray-50.dark:hover:bg-slate-700/30.transition-colors', [
              m('td.px-4.py-3', [
                m('button.font-bold.text-indigo-600.dark:text-indigo-400.hover:underline', {
                  onclick: function() { self.selectModel(vnode, r.sourceModel); }
                }, r.sourceModel),
                m('span.text-xs.font-mono.text-gray-400.ml-1.5', '(' + r.sourceTable + ')')
              ]),
              m('td.px-4.py-3.font-mono.text-xs.font-semibold', r.name),
              m('td.px-4.py-3', renderRelationTypeBadge(r.type)),
              m('td.px-4.py-3', [
                r.targetModel ? m('button.font-bold.text-emerald-600.dark:text-emerald-400.hover:underline', {
                  onclick: function() { self.selectModel(vnode, r.targetModel); }
                }, r.targetModel) : m('span.text-gray-500', r.targetTable || '—'),
                r.targetTable && m('span.text-xs.font-mono.text-gray-400.ml-1.5', '(' + r.targetTable + ')')
              ]),
              m('td.px-4.py-3.font-mono.text-xs.text-gray-600.dark:text-slate-300', [
                m('span', r.sourceTable + '.' + (r.foreignKey || 'id')),
                m('span.text-indigo-500.mx-1', '➔'),
                m('span', (r.targetTable || r.targetModel) + '.' + (r.localKey || 'id')),
              ])
            ]);
          }))
        ])
      ])
    ])
  ]);
}

/** TAB 3: Mermaid ER Diagram Code */
function renderMermaidTab(vnode, self) {
  var s = vnode.state;

  return m('div.space-y-4', [
    m('div.bg-slate-900.text-white.p-6.rounded-2xl.border.border-slate-800.shadow-md.space-y-4', [
      m('div.flex.items-center.justify-between', [
        m('div', [
          m('h3.text-lg.font-bold', 'Mermaid.js Entity-Relationship Diagram'),
          m('p.text-xs.text-slate-400.mt-1', 
            'Copy and paste this code block into GitHub READMEs, Markdown documentation, or the mermaid.live editor.'
          ),
        ]),
        m('button.px-4.py-2.rounded-lg.bg-indigo-600.hover:bg-indigo-500.text-white.text-xs.font-bold.transition-colors.shadow-sm', {
          onclick: function() { self.copyMermaid(vnode); }
        }, [
          m('span.mr-1.5', s.copiedMermaid ? '✓' : '📋'),
          s.copiedMermaid ? 'Copied!' : 'Copy Code'
        ])
      ]),

      m('div.bg-slate-950.rounded-xl.p-4.border.border-slate-800.overflow-x-auto', [
        m('pre.font-mono.text-xs.text-emerald-400.leading-relaxed', s.mermaid || '// No schema data available yet')
      ])
    ])
  ]);
}

window.__customPages = window.__customPages || {};
window.__customPages['schema-explorer'] = SchemaExplorerPage;

})();
`;
}

module.exports = {
  generateSchemaExplorerAdminComponent,
};

/**
 * Audit log admin page — Mithril component source (string)
 * @module plugins/audit-log/admin-component
 */

/**
 * @param {Object} options
 * @param {string} [options.apiPrefix='/audit-logs']
 */
function generateAuditLogComponent(options = {}) {
  const apiPrefix = options.apiPrefix || '/audit-logs';

  return `
(function() {
  var API = '${apiPrefix}';

  function AuditLogPage() {
    var rows = [];
    var loading = true;
    var error = null;
    var page = 1;
    var perPage = 25;
    var total = 0;
    var filterModel = '';
    var filterAction = '';

    function load() {
      loading = true;
      error = null;
      var q = '?page=' + page + '&perPage=' + perPage;
      if (filterModel) q += '&model=' + encodeURIComponent(filterModel);
      if (filterAction) q += '&action=' + encodeURIComponent(filterAction);
      api.get(API + q).then(function(res) {
        rows = res.data || [];
        total = (res.meta && res.meta.total) || 0;
        loading = false;
      }).catch(function(e) {
        error = e.message || String(e);
        loading = false;
      });
    }

    return {
      oninit: load,
      view: function() {
        if (loading) {
          return m('div.p-8.text-gray-500', 'Loading…');
        }
        if (error) {
          return m('div.p-8.text-red-600', error);
        }
        var maxPage = Math.max(1, Math.ceil(total / perPage) || 1);
        return m('div.p-6.space-y-4', [
          m('div.flex.flex-wrap.items-end.gap-4', [
            m('div', [
              m('label.block.text-xs.text-gray-500.mb-1', 'Model'),
              m('input.border.rounded.px-2.py-1', {
                value: filterModel,
                oninput: function(e) { filterModel = e.target.value; },
                placeholder: 'Post',
              }),
            ]),
            m('div', [
              m('label.block.text-xs.text-gray-500.mb-1', 'Action'),
              m('select.border.rounded.px-2.py-1', {
                value: filterAction,
                onchange: function(e) { filterAction = e.target.value; },
              }, [
                m('option', { value: '' }, 'All'),
                m('option', { value: 'create' }, 'create'),
                m('option', { value: 'update' }, 'update'),
                m('option', { value: 'delete' }, 'delete'),
                m('option', { value: 'restore' }, 'restore'),
              ]),
            ]),
            m('button.bg-blue-600.text-white.px-4.py-1.rounded', {
              onclick: function() { page = 1; load(); },
            }, 'Apply'),
          ]),
          m('div.text-sm.text-gray-500', 'Total: ' + total),
          m('div.overflow-x-auto.border.rounded', [
            m('table.min-w-full.text-sm', [
              m('thead.bg-gray-50', [
                m('tr', [
                  m('th.text-left.p-2', 'Time'),
                  m('th.text-left.p-2', 'Actor'),
                  m('th.text-left.p-2', 'Action'),
                  m('th.text-left.p-2', 'Model'),
                  m('th.text-left.p-2', 'Id'),
                  m('th.text-left.p-2', 'Path'),
                ]),
              ]),
              m('tbody', rows.map(function(r) {
                return m('tr.border-t', [
                  m('td.p-2.whitespace-nowrap', r.created_at || ''),
                  m('td.p-2', (r.actor_email || '') + (r.actor_id != null ? ' #' + r.actor_id : '')),
                  m('td.p-2', r.action),
                  m('td.p-2', r.resource_model),
                  m('td.p-2', r.resource_id != null ? String(r.resource_id) : '—'),
                  m('td.p-2.max-w-md.truncate', { title: r.path || '' }, r.path || ''),
                ]);
              })),
            ]),
          ]),
          m('div.flex.items-center.gap-2', [
            m('button.px-3.py-1.border.rounded', {
              disabled: page <= 1,
              onclick: function() { if (page > 1) { page--; load(); } },
            }, 'Prev'),
            m('span.text-sm', 'Page ' + page + ' / ' + maxPage),
            m('button.px-3.py-1.border.rounded', {
              disabled: page >= maxPage,
              onclick: function() { if (page < maxPage) { page++; load(); } },
            }, 'Next'),
          ]),
        ]);
      },
    };
  }

  window.__customPages = window.__customPages || {};
  window.__customPages['audit-log'] = AuditLogPage;
})();
`;
}

module.exports = {
  generateAuditLogComponent,
};

/**
 * Email admin page — Mithril component source (string)
 * @module plugins/email/admin-component
 */

/**
 * @param {Object} [options={}]
 * @param {string} [options.apiPrefix='/email']
 */
function generateEmailComponent(options = {}) {
  const apiPrefix = options.apiPrefix || '/email';

  return `
(function() {
  var API = '${apiPrefix}';

  function EmailPage() {
    var tab = 'logs';
    var logs = [];
    var templates = [];
    var loading = true;
    var error = null;
    var page = 1;
    var perPage = 25;
    var total = 0;
    var statusFilter = '';
    var testTo = '';
    var testSubject = 'Test email';
    var testTemplate = '';
    var testData = '{}';
    var previewHtml = '';
    var verifyMsg = '';
    var actionMsg = '';

    function loadLogs() {
      loading = true;
      error = null;
      var q = '?page=' + page + '&perPage=' + perPage;
      if (statusFilter) q += '&status=' + encodeURIComponent(statusFilter);
      api.get(API + '/logs' + q).then(function(res) {
        logs = res.data || [];
        total = (res.meta && res.meta.total) || 0;
        loading = false;
      }).catch(function(e) {
        error = e.message || String(e);
        loading = false;
      });
    }

    function loadTemplates() {
      api.get(API + '/templates').then(function(res) {
        templates = res.data || [];
      }).catch(function() {});
    }

    return {
      oninit: function() {
        loadTemplates();
        loadLogs();
      },
      view: function() {
        return m('div.p-6.space-y-4', [
          m('div.flex.gap-2.border-b.pb-2', [
            ['logs', 'send', 'preview', 'verify'].map(function(t) {
              return m('button.px-3.py-1.rounded.text-sm', {
                class: tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100',
                onclick: function() { tab = t; actionMsg = ''; verifyMsg = ''; },
              }, t === 'logs' ? 'Logs' : t === 'send' ? 'Test send' : t === 'preview' ? 'Preview' : 'Verify SMTP');
            }),
          ]),

          tab === 'logs' && (loading
            ? m('div.text-gray-500', 'Loading…')
            : error
              ? m('div.text-red-600', error)
              : m('div.space-y-3', [
                m('div.flex.flex-wrap.gap-2.items-end', [
                  m('select.border.rounded.px-2.py-1', {
                    value: statusFilter,
                    onchange: function(e) { statusFilter = e.target.value; page = 1; loadLogs(); },
                  }, [
                    m('option', { value: '' }, 'All statuses'),
                    m('option', { value: 'sent' }, 'sent'),
                    m('option', { value: 'failed' }, 'failed'),
                  ]),
                  m('button.border.px-3.py-1.rounded', { onclick: loadLogs }, 'Refresh'),
                  m('button.border.px-3.py-1.rounded.text-red-700', {
                    onclick: function() {
                      if (!confirm('Delete logs older than 90 days?')) return;
                      api.post(API + '/purge', { days: 90 }).then(function() { loadLogs(); });
                    },
                  }, 'Purge 90d'),
                ]),
                m('div.text-sm.text-gray-500', 'Total: ' + total),
                m('div.overflow-x-auto.border.rounded', [
                  m('table.min-w-full.text-sm', [
                    m('thead.bg-gray-50', m('tr', [
                      m('th.text-left.p-2', 'Time'),
                      m('th.text-left.p-2', 'To'),
                      m('th.text-left.p-2', 'Subject'),
                      m('th.text-left.p-2', 'Template'),
                      m('th.text-left.p-2', 'Status'),
                      m('th.text-left.p-2', 'Error'),
                    ])),
                    m('tbody', logs.map(function(r) {
                      return m('tr.border-t', [
                        m('td.p-2.whitespace-nowrap', r.created_at || ''),
                        m('td.p-2', r.to || ''),
                        m('td.p-2', r.subject || ''),
                        m('td.p-2', r.template_id || '—'),
                        m('td.p-2', r.status),
                        m('td.p-2.text-red-600.max-w-xs.truncate', { title: r.error || '' }, r.error || ''),
                      ]);
                    })),
                  ]),
                ]),
              ])),

          tab === 'send' && m('div.space-y-3.max-w-xl', [
            m('div', [
              m('label.block.text-xs.text-gray-500.mb-1', 'To'),
              m('input.border.rounded.w-full.px-2.py-1', {
                value: testTo,
                oninput: function(e) { testTo = e.target.value; },
                placeholder: 'user@example.com',
              }),
            ]),
            m('div', [
              m('label.block.text-xs.text-gray-500.mb-1', 'Subject'),
              m('input.border.rounded.w-full.px-2.py-1', {
                value: testSubject,
                oninput: function(e) { testSubject = e.target.value; },
              }),
            ]),
            m('div', [
              m('label.block.text-xs.text-gray-500.mb-1', 'Template'),
              m('select.border.rounded.w-full.px-2.py-1', {
                value: testTemplate,
                onchange: function(e) { testTemplate = e.target.value; },
              }, [
                m('option', { value: '' }, '(none — use data only if template empty)'),
              ].concat(templates.map(function(t) {
                return m('option', { value: t.id }, t.id);
              }))),
            ]),
            m('div', [
              m('label.block.text-xs.text-gray-500.mb-1', 'Data (JSON)'),
              m('textarea.border.rounded.w-full.px-2.py-1.font-mono.text-xs', {
                rows: 4,
                value: testData,
                oninput: function(e) { testData = e.target.value; },
              }),
            ]),
            m('button.bg-blue-600.text-white.px-4.py-2.rounded', {
              onclick: function() {
                actionMsg = 'Sending…';
                api.post(API + '/send-test', {
                  to: testTo,
                  subject: testSubject,
                  template: testTemplate || undefined,
                  data: testData,
                }).then(function() {
                  actionMsg = 'Sent.';
                  loadLogs();
                }).catch(function(e) {
                  actionMsg = e.message || String(e);
                });
              },
            }, 'Send test'),
            actionMsg && m('div.text-sm', actionMsg),
          ]),

          tab === 'preview' && m('div.space-y-3', [
            m('div.max-w-xl.space-y-2', [
              m('select.border.rounded.w-full.px-2.py-1', {
                value: testTemplate,
                onchange: function(e) { testTemplate = e.target.value; },
              }, templates.map(function(t) {
                return m('option', { value: t.id }, t.id);
              })),
              m('textarea.border.rounded.w-full.px-2.py-1.font-mono.text-xs', {
                rows: 3,
                value: testData,
                oninput: function(e) { testData = e.target.value; },
              }),
              m('button.border.px-3.py-1.rounded', {
                onclick: function() {
                  api.post(API + '/preview', { template: testTemplate, data: testData }).then(function(res) {
                    previewHtml = res.html || '';
                  });
                },
              }, 'Preview'),
            ]),
            previewHtml && m('iframe.border.rounded.w-full', {
              style: 'height: 420px',
              srcdoc: previewHtml,
            }),
          ]),

          tab === 'verify' && m('div.space-y-3', [
            m('button.bg-blue-600.text-white.px-4.py-2.rounded', {
              onclick: function() {
                verifyMsg = 'Checking…';
                api.post(API + '/verify').then(function(res) {
                  verifyMsg = res.message || 'OK';
                }).catch(function(e) {
                  verifyMsg = e.message || String(e);
                });
              },
            }, 'Verify SMTP connection'),
            verifyMsg && m('div.text-sm', verifyMsg),
          ]),
        ]);
      },
    };
  }

  window.__customPages = window.__customPages || {};
  window.__customPages['email'] = EmailPage;
})();
`;
}

module.exports = {
  generateEmailComponent,
};

/**
 * Email admin page — Mithril component source (string)
 * Full-featured suite: Live responsive preview (Desktop/Mobile), sample variables,
 * delivery log search & filter, detail modal, retry/resend, test sender, and SMTP diagnostics.
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
    var searchQuery = '';
    var searchTimer = null;

    // Selected log for detail modal
    var activeLog = null;
    var resendingId = null;

    // Send Test state
    var testTo = '';
    var testSubject = 'Webspresso Test Email';
    var testTemplate = '';
    var testData = '{}';
    var testCc = '';
    var testBcc = '';
    var showAdvancedSend = false;
    var isSending = false;
    var sendFeedback = null;

    // Preview state
    var previewTemplate = '';
    var previewData = '{}';
    var previewHtml = '';
    var previewText = '';
    var previewDevice = 'desktop'; // 'desktop' | 'mobile' | 'fluid'
    var previewMode = 'html'; // 'html' | 'text'
    var isPreviewLoading = false;
    var previewError = null;

    // Quick Send Modal from Preview
    var quickSendOpen = false;
    var quickSendTo = '';
    var isQuickSending = false;
    var quickSendFeedback = null;

    // SMTP Diagnostics state
    var isVerifying = false;
    var verifyResult = null;

    // Toast notification state
    var toast = null;
    var toastTimer = null;

    function showToast(message, type) {
      if (toastTimer) clearTimeout(toastTimer);
      toast = { message: message, type: type || 'success' };
      m.redraw();
      toastTimer = setTimeout(function() {
        toast = null;
        m.redraw();
      }, 4000);
    }

    function loadLogs() {
      loading = true;
      error = null;
      var q = '?page=' + page + '&perPage=' + perPage;
      if (statusFilter) q += '&status=' + encodeURIComponent(statusFilter);
      if (searchQuery.trim()) q += '&search=' + encodeURIComponent(searchQuery.trim());

      api.get(API + '/logs' + q).then(function(res) {
        logs = res.data || [];
        total = (res.meta && res.meta.total) || 0;
        loading = false;
        m.redraw();
      }).catch(function(e) {
        error = e.message || String(e);
        loading = false;
        m.redraw();
      });
    }

    function loadTemplates() {
      api.get(API + '/templates').then(function(res) {
        templates = res.data || [];
        if (templates.length > 0 && !previewTemplate) {
          selectPreviewTemplate(templates[0].id);
        }
        m.redraw();
      }).catch(function() {});
    }

    function selectPreviewTemplate(tmplId) {
      previewTemplate = tmplId;
      var found = templates.find(function(t) { return t.id === tmplId; });
      if (found && found.sampleData) {
        previewData = JSON.stringify(found.sampleData, null, 2);
      } else {
        previewData = JSON.stringify({ name: 'User', actionUrl: 'https://example.com' }, null, 2);
      }
      renderPreview();
    }

    function renderPreview() {
      if (!previewTemplate) return;
      isPreviewLoading = true;
      previewError = null;
      m.redraw();

      api.post(API + '/preview', {
        template: previewTemplate,
        data: previewData,
      }).then(function(res) {
        previewHtml = res.html || '';
        previewText = res.text || '';
        isPreviewLoading = false;
        m.redraw();
      }).catch(function(err) {
        previewError = err.message || String(err);
        isPreviewLoading = false;
        m.redraw();
      });
    }

    function handleResend(logId) {
      if (resendingId) return;
      resendingId = logId;
      m.redraw();

      api.post(API + '/retry', { id: logId }).then(function(res) {
        resendingId = null;
        showToast('Email #' + logId + ' resent successfully!', 'success');
        loadLogs();
      }).catch(function(err) {
        resendingId = null;
        showToast('Resend failed: ' + (err.message || String(err)), 'error');
        m.redraw();
      });
    }

    function handleSendTest() {
      if (!testTo.trim() || !testSubject.trim()) {
        sendFeedback = { type: 'error', message: 'Recipient (To) and Subject are required.' };
        return;
      }
      isSending = true;
      sendFeedback = null;
      m.redraw();

      api.post(API + '/send-test', {
        to: testTo.trim(),
        subject: testSubject.trim(),
        template: testTemplate || undefined,
        data: testData,
        cc: testCc.trim() || undefined,
        bcc: testBcc.trim() || undefined,
      }).then(function(res) {
        isSending = false;
        sendFeedback = { type: 'success', message: 'Test email sent successfully! Message ID: ' + (res.messageId || 'OK') };
        showToast('Test email sent to ' + testTo, 'success');
        loadLogs();
      }).catch(function(err) {
        isSending = false;
        sendFeedback = { type: 'error', message: err.message || String(err) };
        m.redraw();
      });
    }

    function handleQuickSendPreview() {
      if (!quickSendTo.trim()) return;
      isQuickSending = true;
      quickSendFeedback = null;
      m.redraw();

      api.post(API + '/send-test', {
        to: quickSendTo.trim(),
        subject: '[Preview Test] ' + previewTemplate,
        template: previewTemplate,
        data: previewData,
      }).then(function(res) {
        isQuickSending = false;
        quickSendFeedback = { type: 'success', message: 'Preview sent to ' + quickSendTo.trim() };
        showToast('Preview sent to ' + quickSendTo.trim(), 'success');
        setTimeout(function() {
          quickSendOpen = false;
          quickSendFeedback = null;
          m.redraw();
        }, 1500);
      }).catch(function(err) {
        isQuickSending = false;
        quickSendFeedback = { type: 'error', message: err.message || String(err) };
        m.redraw();
      });
    }

    function handleVerifySMTP() {
      isVerifying = true;
      verifyResult = null;
      var start = Date.now();
      m.redraw();

      api.post(API + '/verify').then(function(res) {
        var elapsed = Date.now() - start;
        isVerifying = false;
        verifyResult = {
          success: true,
          message: res.message || 'SMTP connection verified successfully',
          latency: elapsed,
        };
        m.redraw();
      }).catch(function(err) {
        var elapsed = Date.now() - start;
        isVerifying = false;
        verifyResult = {
          success: false,
          message: err.message || String(err),
          latency: elapsed,
        };
        m.redraw();
      });
    }

    // Modal view for log details
    function renderLogModal() {
      if (!activeLog) return null;
      var log = activeLog;
      var isFailed = log.status === 'failed';

      return m('div.fixed.inset-0.z-50.flex.items-center.justify-center.p-4.bg-black/50.backdrop-blur-xs', {
        onclick: function(e) { if (e.target === e.currentTarget) activeLog = null; },
      }, [
        m('div.bg-white.dark:bg-slate-900.border.border-gray-200.dark:border-slate-800.rounded-2xl.shadow-2xl.w-full.max-w-2xl.max-h-[90vh].flex.flex-col.overflow-hidden', [
          // Header
          m('div.flex.items-center.justify-between.px-6.py-4.border-b.border-gray-200.dark:border-slate-800.bg-gray-50/70.dark:bg-slate-850', [
            m('div.flex.items-center.gap-3', [
              m('div.w-9.h-9.rounded-xl.flex.items-center.justify-center.' + (isFailed ? 'bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400' : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400'), [
                m('svg.w-5.h-5', { fill: 'none', stroke: 'currentColor', strokeWidth: 2, viewBox: '0 0 24 24' }, [
                  m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' })
                ])
              ]),
              m('div', [
                m('h3.font-bold.text-gray-900.dark:text-white.text-base', 'Email Delivery Log #' + log.id),
                m('p.text-xs.text-gray-500.dark:text-slate-400', log.created_at || 'Just now')
              ])
            ]),
            m('button.text-gray-400.hover:text-gray-600.dark:hover:text-slate-200.p-1.5.rounded-lg', {
              onclick: function() { activeLog = null; }
            }, [
              m('svg.w-5.h-5', { fill: 'none', stroke: 'currentColor', strokeWidth: 2, viewBox: '0 0 24 24' }, [
                m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M6 18L18 6M6 6l12 12' })
              ])
            ])
          ]),

          // Body
          m('div.p-6.space-y-4.overflow-y-auto.text-sm', [
            m('div.grid.grid-cols-2.gap-4.p-4.rounded-xl.bg-gray-50.dark:bg-slate-800/50.border.border-gray-100.dark:border-slate-800', [
              m('div', [
                m('span.text-xs.font-medium.text-gray-500.dark:text-slate-400.block', 'Recipient (To)'),
                m('span.font-semibold.text-gray-900.dark:text-white.break-all', log.to || '—')
              ]),
              m('div', [
                m('span.text-xs.font-medium.text-gray-500.dark:text-slate-400.block', 'Status'),
                m('span.inline-flex.items-center.gap-1.5.px-2.5.py-0.5.rounded-full.text-xs.font-semibold.' + (isFailed ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'), [
                  m('span.w-1.5.h-1.5.rounded-full.' + (isFailed ? 'bg-rose-500' : 'bg-emerald-500')),
                  log.status || 'unknown'
                ])
              ]),
              m('div', [
                m('span.text-xs.font-medium.text-gray-500.dark:text-slate-400.block', 'Template ID'),
                m('span.font-mono.text-xs.bg-gray-200.dark:bg-slate-700.px-2.py-0.5.rounded.text-gray-800.dark:text-slate-200', log.template_id || 'Direct send')
              ]),
              m('div', [
                m('span.text-xs.font-medium.text-gray-500.dark:text-slate-400.block', 'Message ID'),
                m('span.font-mono.text-xs.text-gray-700.dark:text-slate-300.break-all', log.message_id || '—')
              ])
            ]),

            m('div', [
              m('span.text-xs.font-medium.text-gray-500.dark:text-slate-400.block.mb-1', 'Subject'),
              m('div.p-3.rounded-xl.bg-gray-50.dark:bg-slate-800/50.border.border-gray-200.dark:border-slate-800.font-medium.text-gray-900.dark:text-white', log.subject || '—')
            ]),

            (log.cc || log.bcc) && m('div.grid.grid-cols-2.gap-4', [
              log.cc && m('div', [
                m('span.text-xs.font-medium.text-gray-500.dark:text-slate-400.block.mb-1', 'CC'),
                m('div.p-2.rounded-lg.bg-gray-50.dark:bg-slate-800/50.text-xs.text-gray-700.dark:text-slate-300', log.cc)
              ]),
              log.bcc && m('div', [
                m('span.text-xs.font-medium.text-gray-500.dark:text-slate-400.block.mb-1', 'BCC'),
                m('div.p-2.rounded-lg.bg-gray-50.dark:bg-slate-800/50.text-xs.text-gray-700.dark:text-slate-300', log.bcc)
              ])
            ]),

            isFailed && m('div', [
              m('span.text-xs.font-semibold.text-rose-600.dark:text-rose-400.block.mb-1', 'Failure Reason / Error Details'),
              m('div.p-3.rounded-xl.bg-rose-50.dark:bg-rose-950/40.border.border-rose-200.dark:border-rose-800/60.text-rose-800.dark:text-rose-300.font-mono.text-xs.whitespace-pre-wrap.break-words', log.error || 'Unknown transport error')
            ])
          ]),

          // Footer
          m('div.flex.items-center.justify-between.px-6.py-4.border-t.border-gray-200.dark:border-slate-800.bg-gray-50/70.dark:bg-slate-850', [
            m('button.px-4.py-2.rounded-xl.text-sm.font-medium.text-gray-600.dark:text-slate-300.hover:bg-gray-200.dark:hover:bg-slate-700', {
              onclick: function() { activeLog = null; }
            }, 'Close'),

            m('button.flex.items-center.gap-2.px-4.py-2.rounded-xl.text-sm.font-semibold.bg-indigo-600.hover:bg-indigo-700.text-white.shadow-sm', {
              disabled: resendingId === log.id,
              onclick: function() {
                var id = log.id;
                activeLog = null;
                handleResend(id);
              }
            }, [
              resendingId === log.id
                ? m('span.inline-block.w-4.h-4.border-2.border-white.border-t-transparent.rounded-full.animate-spin')
                : m('svg.w-4.h-4', { fill: 'none', stroke: 'currentColor', strokeWidth: 2, viewBox: '0 0 24 24' }, [
                    m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' })
                  ]),
              'Resend Now'
            ])
          ])
        ])
      ]);
    }

    // Quick Send Modal in Preview tab
    function renderQuickSendModal() {
      if (!quickSendOpen) return null;

      return m('div.fixed.inset-0.z-50.flex.items-center.justify-center.p-4.bg-black/50.backdrop-blur-xs', {
        onclick: function(e) { if (e.target === e.currentTarget) quickSendOpen = false; },
      }, [
        m('div.bg-white.dark:bg-slate-900.border.border-gray-200.dark:border-slate-800.rounded-2xl.shadow-2xl.w-full.max-w-md.p-6.space-y-4', [
          m('div.flex.items-center.justify-between', [
            m('h3.font-bold.text-gray-900.dark:text-white.text-base', 'Send Template Test'),
            m('button.text-gray-400.hover:text-gray-600.p-1', {
              onclick: function() { quickSendOpen = false; }
            }, '✕')
          ]),
          m('p.text-xs.text-gray-500.dark:text-slate-400', 'Sends "' + previewTemplate + '" with active preview data.'),
          m('div', [
            m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1', 'Recipient Email Address'),
            m('input.w-full.px-3.py-2.rounded-xl.border.border-gray-300.dark:border-slate-700.bg-white.dark:bg-slate-800.text-sm', {
              type: 'email',
              value: quickSendTo,
              oninput: function(e) { quickSendTo = e.target.value; },
              placeholder: 'developer@example.com',
            })
          ]),
          quickSendFeedback && m('div.p-3.rounded-xl.text-xs.font-medium.' + (quickSendFeedback.type === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'), quickSendFeedback.message),
          m('div.flex.justify-end.gap-2.pt-2', [
            m('button.px-3.py-1.5.rounded-xl.text-xs.font-medium.text-gray-600.dark:text-slate-300', {
              onclick: function() { quickSendOpen = false; }
            }, 'Cancel'),
            m('button.px-4.py-1.5.rounded-xl.text-xs.font-semibold.bg-indigo-600.text-white.flex.items-center.gap-1.5', {
              disabled: isQuickSending || !quickSendTo.trim(),
              onclick: handleQuickSendPreview,
            }, [
              isQuickSending && m('span.inline-block.w-3.h-3.border-2.border-white.border-t-transparent.rounded-full.animate-spin'),
              'Send Test'
            ])
          ])
        ])
      ]);
    }

    function onKeydown(e) {
      if (e.key === 'Escape') {
        if (activeLog || quickSendOpen) {
          activeLog = null;
          quickSendOpen = false;
          m.redraw();
        }
      }
    }

    return {
      oninit: function() {
        loadTemplates();
        loadLogs();
        window.addEventListener('keydown', onKeydown);
      },
      onremove: function() {
        window.removeEventListener('keydown', onKeydown);
      },
      view: function() {
        var sentCount = logs.filter(function(l) { return l.status === 'sent'; }).length;
        var failCount = logs.filter(function(l) { return l.status === 'failed'; }).length;
        var successRate = logs.length > 0 ? Math.round((sentCount / logs.length) * 100) : 100;

        return m('div.p-6.space-y-6.max-w-7xl.mx-auto', [
          // Floating Toast
          toast && m('div.fixed.bottom-6.right-6.z-50.flex.items-center.gap-2.px-4.py-3.rounded-xl.shadow-xl.text-sm.font-semibold.text-white.animate-fade-in.' + (toast.type === 'error' ? 'bg-rose-600' : 'bg-emerald-600'), [
            m('span', toast.type === 'error' ? '⚠️' : '✅'),
            m('span', toast.message)
          ]),

          // Top Header & Stats Summary
          m('div.flex.flex-col.md:flex-row.md:items-center.justify-between.gap-4.border-b.border-gray-200.dark:border-slate-800.pb-5', [
            m('div', [
              m('h1.text-2xl.font-extrabold.text-gray-900.dark:text-white.tracking-tight', 'Email Delivery & Templates'),
              m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', 'MJML compilation, responsive live previewer, delivery logs, and SMTP transport diagnostics.')
            ]),
            m('div.flex.items-center.gap-3', [
              m('div.flex.items-center.gap-2.px-3.py-1.5.rounded-xl.bg-gray-100.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.text-xs', [
                m('span.text-gray-500.dark:text-slate-400', 'Success Rate:'),
                m('span.font-bold.' + (successRate >= 95 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'), successRate + '%')
              ]),
              m('div.flex.items-center.gap-2.px-3.py-1.5.rounded-xl.bg-gray-100.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.text-xs', [
                m('span.text-gray-500.dark:text-slate-400', 'Total Logs:'),
                m('span.font-bold.text-gray-800.dark:text-slate-200', total)
              ])
            ])
          ]),

          // Navigation Tabs
          m('div.flex.items-center.gap-1.bg-gray-100.dark:bg-slate-800/80.p-1.rounded-xl.w-fit.border.border-gray-200.dark:border-slate-700/60', [
            [
              { id: 'logs', label: 'Delivery Logs', icon: '📜' },
              { id: 'preview', label: 'Live Template Preview', icon: '👁️' },
              { id: 'send', label: 'Send Test Email', icon: '✉️' },
              { id: 'verify', label: 'SMTP Diagnostics', icon: '🩺' },
            ].map(function(t) {
              var isActive = tab === t.id;
              return m('button.flex.items-center.gap-2.px-4.py-2.rounded-lg.text-xs.font-semibold.transition-all', {
                class: isActive
                  ? 'bg-white.dark:bg-slate-700.text-indigo-600.dark:text-indigo-300.shadow-xs'
                  : 'text-gray-600.dark:text-slate-400.hover:text-gray-900.dark:hover:text-white',
                onclick: function() { tab = t.id; },
              }, [
                m('span', t.icon),
                m('span', t.label)
              ]);
            })
          ]),

          // TAB 1: DELIVERY LOGS
          tab === 'logs' && m('div.space-y-4', [
            // Controls bar
            m('div.flex.flex-col.sm:flex-row.items-stretch.sm:items-center.justify-between.gap-3', [
              m('div.flex.flex-wrap.items-center.gap-2.flex-1', [
                // Search Input
                m('div.relative.min-w-[240px]', [
                  m('input.w-full.pl-8.pr-3.py-1.5.text-xs.rounded-xl.border.border-gray-200.dark:border-slate-700.bg-white.dark:bg-slate-800.text-gray-800.dark:text-slate-100', {
                    placeholder: 'Search recipient, subject, template...',
                    value: searchQuery,
                    oninput: function(e) {
                      searchQuery = e.target.value;
                      if (searchTimer) clearTimeout(searchTimer);
                      searchTimer = setTimeout(function() {
                        page = 1;
                        loadLogs();
                      }, 300);
                    },
                  }),
                  m('svg.w-4.h-4.text-gray-400.absolute.left-2.5.top-2', { fill: 'none', stroke: 'currentColor', strokeWidth: 2, viewBox: '0 0 24 24' }, [
                    m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
                  ])
                ]),

                // Status Filter
                m('select.text-xs.rounded-xl.border.border-gray-200.dark:border-slate-700.bg-white.dark:bg-slate-800.px-3.py-1.5.text-gray-700.dark:text-slate-300', {
                  value: statusFilter,
                  onchange: function(e) { statusFilter = e.target.value; page = 1; loadLogs(); },
                }, [
                  m('option', { value: '' }, 'All Statuses'),
                  m('option', { value: 'sent' }, 'Sent only'),
                  m('option', { value: 'failed' }, 'Failed only'),
                ]),

                m('button.px-3.py-1.5.rounded-xl.border.border-gray-200.dark:border-slate-700.bg-white.dark:bg-slate-800.text-xs.font-semibold.text-gray-700.dark:text-slate-300.hover:bg-gray-50.flex.items-center.gap-1.5', {
                  onclick: loadLogs
                }, [
                  m('span', '🔄'),
                  'Refresh'
                ]),
              ]),

              m('div.flex.items-center.gap-2', [
                m('button.px-3.py-1.5.rounded-xl.border.border-rose-200.dark:border-rose-900.bg-rose-50/70.dark:bg-rose-950/40.text-rose-700.dark:text-rose-400.text-xs.font-semibold.hover:bg-rose-100', {
                  onclick: function() {
                    var d = prompt('Delete logs older than how many days?', '90');
                    if (!d) return;
                    var daysNum = parseInt(d, 10);
                    if (Number.isNaN(daysNum) || daysNum < 1) return alert('Invalid days number');
                    api.post(API + '/purge', { days: daysNum }).then(function(res) {
                      showToast('Purged ' + (res.deleted || 0) + ' older email logs', 'success');
                      loadLogs();
                    }).catch(function(err) {
                      showToast('Purge failed: ' + (err.message || String(err)), 'error');
                    });
                  }
                }, '🗑️ Purge Logs'),
              ])
            ]),

            // Table card
            loading
              ? m('div.p-12.text-center.text-gray-400', [
                  m('span.inline-block.w-6.h-6.border-2.border-indigo-600.border-t-transparent.rounded-full.animate-spin.mb-2'),
                  m('div.text-xs', 'Loading delivery logs…')
                ])
              : error
                ? m('div.p-6.rounded-2xl.bg-rose-50.border.border-rose-200.text-rose-700.text-xs', error)
                : logs.length === 0
                  ? m('div.p-12.text-center.rounded-2xl.border.border-dashed.border-gray-200.dark:border-slate-800.text-gray-400', [
                      m('span.text-3xl.block.mb-2', '📫'),
                      m('p.text-sm.font-semibold.text-gray-700.dark:text-slate-300', 'No email logs found'),
                      m('p.text-xs.text-gray-400.mt-1', 'Sent emails and error logs will appear here.')
                    ])
                  : m('div.border.border-gray-200.dark:border-slate-800.rounded-2xl.overflow-hidden.bg-white.dark:bg-slate-900.shadow-xs', [
                      m('div.overflow-x-auto', [
                        m('table.min-w-full.text-xs.text-left', [
                          m('thead.bg-gray-50/80.dark:bg-slate-850.border-b.border-gray-200.dark:border-slate-800.text-gray-500.dark:text-slate-400.font-semibold', m('tr', [
                            m('th.p-3.w-28', 'Status'),
                            m('th.p-3', 'Recipient'),
                            m('th.p-3', 'Subject'),
                            m('th.p-3', 'Template'),
                            m('th.p-3.w-36', 'Time'),
                            m('th.p-3.w-32.text-right', 'Actions'),
                          ])),
                          m('tbody.divide-y.divide-gray-100.dark:divide-slate-800/60', logs.map(function(r) {
                            var isFailed = r.status === 'failed';
                            var isThisResending = resendingId === r.id;

                            return m('tr.hover:bg-gray-50/50.dark:hover:bg-slate-800/40.transition-colors', [
                              // Status pill
                              m('td.p-3', [
                                m('span.inline-flex.items-center.gap-1.px-2.py-0.5.rounded-full.text-[11px].font-semibold.' + (isFailed ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'), [
                                  m('span.w-1.5.h-1.5.rounded-full.' + (isFailed ? 'bg-rose-500' : 'bg-emerald-500')),
                                  r.status
                                ])
                              ]),
                              // Recipient
                              m('td.p-3.font-medium.text-gray-800.dark:text-slate-200', [
                                m('div.truncate.max-w-[200px]', { title: r.to }, r.to || '—')
                              ]),
                              // Subject
                              m('td.p-3.text-gray-700.dark:text-slate-300', [
                                m('div.truncate.max-w-[260px]', { title: r.subject }, r.subject || '—')
                              ]),
                              // Template
                              m('td.p-3', [
                                r.template_id
                                  ? m('span.font-mono.text-[11px].bg-gray-100.dark:bg-slate-800.px-2.py-0.5.rounded.text-gray-700.dark:text-slate-300', r.template_id)
                                  : m('span.text-gray-400.italic', 'direct')
                              ]),
                              // Timestamp
                              m('td.p-3.text-gray-500.dark:text-slate-400.whitespace-nowrap', r.created_at ? new Date(r.created_at).toLocaleDateString() + ' ' + new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'),
                              // Actions
                              m('td.p-3.text-right', [
                                m('div.flex.items-center.justify-end.gap-1.5', [
                                  m('button.p-1.5.rounded-lg.text-gray-500.hover:text-indigo-600.hover:bg-indigo-50.dark:hover:bg-slate-800', {
                                    title: 'View Details',
                                    onclick: function() { activeLog = r; },
                                  }, [
                                    m('svg.w-4.h-4', { fill: 'none', stroke: 'currentColor', strokeWidth: 2, viewBox: '0 0 24 24' }, [
                                      m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z' }),
                                      m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z' })
                                    ])
                                  ]),
                                  m('button.p-1.5.rounded-lg.text-gray-500.hover:text-emerald-600.hover:bg-emerald-50.dark:hover:bg-slate-800', {
                                    title: 'Resend / Retry Delivery',
                                    disabled: isThisResending,
                                    onclick: function() { handleResend(r.id); },
                                  }, [
                                    isThisResending
                                      ? m('span.inline-block.w-3.5.h-3.5.border-2.border-emerald-600.border-t-transparent.rounded-full.animate-spin')
                                      : m('svg.w-4.h-4', { fill: 'none', stroke: 'currentColor', strokeWidth: 2, viewBox: '0 0 24 24' }, [
                                          m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' })
                                        ])
                                  ])
                                ])
                              ])
                            ]);
                          }))
                        ])
                      ]),

                      // Pagination Footer
                      m('div.flex.items-center.justify-between.px-4.py-3.border-t.border-gray-200.dark:border-slate-800.bg-gray-50/50.dark:bg-slate-850', [
                        m('span.text-xs.text-gray-500.dark:text-slate-400', 'Showing ' + logs.length + ' of ' + total + ' records'),
                        m('div.flex.items-center.gap-2', [
                          m('button.px-3.py-1.rounded-lg.border.border-gray-200.dark:border-slate-700.text-xs.font-semibold.text-gray-600.dark:text-slate-300.hover:bg-white', {
                            disabled: page <= 1,
                            onclick: function() { if (page > 1) { page--; loadLogs(); } },
                          }, '‹ Previous'),
                          m('span.text-xs.font-medium.text-gray-700.dark:text-slate-300', 'Page ' + page + ' of ' + Math.max(1, Math.ceil(total / perPage))),
                          m('button.px-3.py-1.rounded-lg.border.border-gray-200.dark:border-slate-700.text-xs.font-semibold.text-gray-600.dark:text-slate-300.hover:bg-white', {
                            disabled: page >= Math.ceil(total / perPage),
                            onclick: function() { if (page < Math.ceil(total / perPage)) { page++; loadLogs(); } },
                          }, 'Next ›'),
                        ])
                      ])
                    ]),
            renderLogModal()
          ]),

          // TAB 2: LIVE TEMPLATE PREVIEWER
          tab === 'preview' && m('div.space-y-4', [
            // Top Preview Toolbar
            m('div.flex.flex-wrap.items-center.justify-between.gap-3.p-3.rounded-2xl.bg-white.dark:bg-slate-900.border.border-gray-200.dark:border-slate-800', [
              // Template Selector
              m('div.flex.items-center.gap-3', [
                m('span.text-xs.font-semibold.text-gray-600.dark:text-slate-300', 'Template:'),
                m('select.text-xs.font-semibold.rounded-xl.border.border-gray-200.dark:border-slate-700.bg-gray-50.dark:bg-slate-800.px-3.py-1.5.text-gray-800.dark:text-slate-100', {
                  value: previewTemplate,
                  onchange: function(e) { selectPreviewTemplate(e.target.value); },
                }, templates.map(function(t) {
                  return m('option', { value: t.id }, t.id + (t.kind ? ' (' + t.kind + ')' : ''));
                })),
                m('button.px-2.5.py-1.rounded-xl.border.border-gray-200.dark:border-slate-700.text-xs.font-semibold.text-gray-600.dark:text-slate-300.hover:bg-gray-100', {
                  title: 'Re-render preview',
                  onclick: renderPreview,
                }, '🔄')
              ]),

              // Center: Device Viewport Controls
              m('div.flex.items-center.gap-1.bg-gray-100.dark:bg-slate-800.p-1.rounded-xl.border.border-gray-200.dark:border-slate-700', [
                [
                  { id: 'desktop', label: '💻 Desktop', width: '680px' },
                  { id: 'mobile', label: '📱 Mobile', width: '375px' },
                  { id: 'fluid', label: '🖥️ Fluid', width: '100%' },
                ].map(function(d) {
                  var isDevActive = previewDevice === d.id;
                  return m('button.px-3.py-1.rounded-lg.text-xs.font-semibold.transition-all', {
                    class: isDevActive
                      ? 'bg-white.dark:bg-slate-700.text-indigo-600.dark:text-indigo-300.shadow-xs'
                      : 'text-gray-600.dark:text-slate-400 hover:text-gray-900',
                    onclick: function() { previewDevice = d.id; },
                  }, d.label);
                })
              ]),

              // Right: Mode Toggle & Send Test Action
              m('div.flex.items-center.gap-2', [
                m('div.flex.items-center.gap-1.bg-gray-100.dark:bg-slate-800.p-1.rounded-xl', [
                  m('button.px-2.5.py-1.rounded-lg.text-xs.font-semibold', {
                    class: previewMode === 'html' ? 'bg-white.dark:bg-slate-700.text-indigo-600.shadow-xs' : 'text-gray-600',
                    onclick: function() { previewMode = 'html'; }
                  }, 'HTML'),
                  m('button.px-2.5.py-1.rounded-lg.text-xs.font-semibold', {
                    class: previewMode === 'text' ? 'bg-white.dark:bg-slate-700.text-indigo-600.shadow-xs' : 'text-gray-600',
                    onclick: function() { previewMode = 'text'; }
                  }, 'Text')
                ]),

                m('button.flex.items-center.gap-1.5.px-3.py-1.5.rounded-xl.bg-indigo-600.hover:bg-indigo-700.text-white.text-xs.font-semibold.shadow-xs', {
                  onclick: function() { quickSendOpen = true; }
                }, [
                  m('span', '🚀'),
                  'Send Test'
                ])
              ])
            ]),

            // Split Layout: Left Data & Options / Right Canvas
            m('div.grid.grid-cols-1.lg:grid-cols-12.gap-4.items-start', [
              // Left Column: Template Variables (4 cols)
              m('div.lg:col-span-4.space-y-3.bg-white.dark:bg-slate-900.border.border-gray-200.dark:border-slate-800.p-4.rounded-2xl', [
                m('div.flex.items-center.justify-between', [
                  m('span.text-xs.font-bold.text-gray-800.dark:text-white', 'Template Variables (JSON)'),
                  m('button.text-[11px].text-indigo-600.dark:text-indigo-400.font-medium.hover:underline', {
                    onclick: function() { selectPreviewTemplate(previewTemplate); }
                  }, 'Reset to Defaults')
                ]),
                m('textarea.w-full.h-64.p-3.rounded-xl.border.border-gray-200.dark:border-slate-800.bg-gray-50.dark:bg-slate-800/80.font-mono.text-xs.text-gray-800.dark:text-slate-100.focus:outline-hidden.focus:ring-2.focus:ring-indigo-500', {
                  value: previewData,
                  oninput: function(e) {
                    previewData = e.target.value;
                    renderPreview();
                  }
                }),
                m('div.flex.items-center.justify-between.text-[11px].text-gray-500.dark:text-slate-400', [
                  m('span', 'Auto-renders live as you type'),
                  m('button.px-3.py-1.rounded-lg.bg-indigo-50.text-indigo-600.font-semibold.hover:bg-indigo-100', {
                    onclick: renderPreview
                  }, 'Re-render')
                ]),
                previewError && m('div.p-3.rounded-xl.bg-rose-50.border.border-rose-200.text-rose-700.text-xs', [
                  m('span.font-bold.block.mb-0.5', 'Render Error:'),
                  previewError
                ])
              ]),

              // Right Column: Canvas Iframe (8 cols)
              m('div.lg:col-span-8.flex.flex-col.items-center.justify-center.p-6.rounded-2xl.bg-gray-100/80.dark:bg-slate-950.border.border-gray-200.dark:border-slate-800.min-h-[580px]', [
                isPreviewLoading
                  ? m('div.text-center.text-gray-400', [
                      m('span.inline-block.w-8.h-8.border-3.border-indigo-600.border-t-transparent.rounded-full.animate-spin.mb-2'),
                      m('div.text-xs', 'Compiling MJML template…')
                    ])
                  : previewMode === 'text'
                    ? m('div.w-full.max-w-2xl.p-4.rounded-xl.bg-white.dark:bg-slate-900.border.border-gray-200.dark:border-slate-800.font-mono.text-xs.whitespace-pre-wrap', previewText || 'No plain text rendered.')
                    : m('div.w-full.flex.justify-center', [
                        // Responsive Device Frame
                        m('div.w-full.transition-all.duration-200.' + (
                          previewDevice === 'mobile'
                            ? 'max-w-[375px] bg-slate-800 p-3 rounded-[36px] shadow-2xl border-4 border-slate-700'
                            : previewDevice === 'desktop'
                              ? 'max-w-[680px] bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-gray-200 dark:border-slate-800 overflow-hidden'
                              : 'w-full bg-white dark:bg-slate-900 rounded-xl shadow-md border border-gray-200 dark:border-slate-800 overflow-hidden'
                        ), [
                          // Speaker notch on mobile
                          previewDevice === 'mobile' && m('div.w-24.h-3.bg-slate-700.rounded-full.mx-auto.mb-3'),
                          m('iframe.w-full.rounded-lg.bg-white', {
                            style: 'height: 520px; border: none;',
                            srcdoc: previewHtml,
                            sandbox: 'allow-same-origin',
                          })
                        ])
                      ])
              ])
            ]),

            renderQuickSendModal()
          ]),

          // TAB 3: SEND TEST EMAIL
          tab === 'send' && m('div.max-w-2xl.mx-auto.bg-white.dark:bg-slate-900.border.border-gray-200.dark:border-slate-800.rounded-2xl.p-6.space-y-4.shadow-xs', [
            m('div.border-b.border-gray-200.dark:border-slate-800.pb-3', [
              m('h2.font-bold.text-gray-900.dark:text-white.text-lg', 'Send Manual / Test Email'),
              m('p.text-xs.text-gray-500.dark:text-slate-400', 'Dispatch an email using configured Nodemailer transport and MJML templates.')
            ]),

            m('div.space-y-4', [
              m('div', [
                m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1', 'Recipient (To) *'),
                m('input.w-full.px-3.py-2.rounded-xl.border.border-gray-300.dark:border-slate-700.bg-white.dark:bg-slate-800.text-sm', {
                  value: testTo,
                  oninput: function(e) { testTo = e.target.value; },
                  placeholder: 'recipient@example.com',
                })
              ]),

              m('div', [
                m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1', 'Subject *'),
                m('input.w-full.px-3.py-2.rounded-xl.border.border-gray-300.dark:border-slate-700.bg-white.dark:bg-slate-800.text-sm', {
                  value: testSubject,
                  oninput: function(e) { testSubject = e.target.value; },
                })
              ]),

              m('div', [
                m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1', 'Template (Optional)'),
                m('select.w-full.px-3.py-2.rounded-xl.border.border-gray-300.dark:border-slate-700.bg-white.dark:bg-slate-800.text-sm', {
                  value: testTemplate,
                  onchange: function(e) {
                    testTemplate = e.target.value;
                    var found = templates.find(function(t) { return t.id === testTemplate; });
                    if (found && found.sampleData) {
                      testData = JSON.stringify(found.sampleData, null, 2);
                    }
                  },
                }, [
                  m('option', { value: '' }, '(None — direct raw email)'),
                ].concat(templates.map(function(t) {
                  return m('option', { value: t.id }, t.id);
                })))
              ]),

              m('div', [
                m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1', 'Template Data (JSON)'),
                m('textarea.w-full.h-28.px-3.py-2.rounded-xl.border.border-gray-300.dark:border-slate-700.bg-white.dark:bg-slate-800.font-mono.text-xs', {
                  value: testData,
                  oninput: function(e) { testData = e.target.value; },
                })
              ]),

              m('div', [
                m('button.text-xs.text-indigo-600.dark:text-indigo-400.font-medium.hover:underline.flex.items-center.gap-1', {
                  onclick: function() { showAdvancedSend = !showAdvancedSend; }
                }, [
                  m('span', showAdvancedSend ? '▼' : '▶'),
                  'Advanced Headers (CC, BCC)'
                ]),

                showAdvancedSend && m('div.grid.grid-cols-2.gap-3.pt-3', [
                  m('div', [
                    m('label.block.text-xs.text-gray-500.mb-1', 'CC (Optional)'),
                    m('input.w-full.px-3.py-1.5.rounded-lg.border.border-gray-300.dark:border-slate-700.bg-white.dark:bg-slate-800.text-xs', {
                      value: testCc,
                      oninput: function(e) { testCc = e.target.value; },
                      placeholder: 'cc@example.com',
                    })
                  ]),
                  m('div', [
                    m('label.block.text-xs.text-gray-500.mb-1', 'BCC (Optional)'),
                    m('input.w-full.px-3.py-1.5.rounded-lg.border.border-gray-300.dark:border-slate-700.bg-white.dark:bg-slate-800.text-xs', {
                      value: testBcc,
                      oninput: function(e) { testBcc = e.target.value; },
                      placeholder: 'bcc@example.com',
                    })
                  ])
                ])
              ]),

              sendFeedback && m('div.p-4.rounded-xl.text-xs.font-medium.' + (sendFeedback.type === 'error' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'), sendFeedback.message),

              m('button.w-full.py-2.5.rounded-xl.bg-indigo-600.hover:bg-indigo-700.text-white.text-sm.font-semibold.shadow-sm.flex.items-center.justify-center.gap-2', {
                disabled: isSending,
                onclick: handleSendTest,
              }, [
                isSending && m('span.inline-block.w-4.h-4.border-2.border-white.border-t-transparent.rounded-full.animate-spin'),
                'Send Email'
              ])
            ])
          ]),

          // TAB 4: SMTP DIAGNOSTICS
          tab === 'verify' && m('div.max-w-2xl.mx-auto.bg-white.dark:bg-slate-900.border.border-gray-200.dark:border-slate-800.rounded-2xl.p-6.space-y-4.shadow-xs', [
            m('div.border-b.border-gray-200.dark:border-slate-800.pb-3', [
              m('h2.font-bold.text-gray-900.dark:text-white.text-lg', 'SMTP Server Diagnostics'),
              m('p.text-xs.text-gray-500.dark:text-slate-400', 'Verify SMTP credentials, round-trip handshake latency, and TLS encryption.')
            ]),

            m('div.space-y-4', [
              m('p.text-xs.text-gray-600.dark:text-slate-300', 'Click the button below to test the connection to your configured mail server transport.'),

              m('button.px-4.py-2.rounded-xl.bg-indigo-600.hover:bg-indigo-700.text-white.text-sm.font-semibold.shadow-xs.flex.items-center.gap-2', {
                disabled: isVerifying,
                onclick: handleVerifySMTP,
              }, [
                isVerifying && m('span.inline-block.w-4.h-4.border-2.border-white.border-t-transparent.rounded-full.animate-spin'),
                'Verify SMTP Connection'
              ]),

              verifyResult && m('div.p-4.rounded-2xl.border.' + (verifyResult.success ? 'bg-emerald-50/80 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800' : 'bg-rose-50/80 border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:border-rose-800'), [
                m('div.flex.items-center.justify-between.mb-1', [
                  m('span.font-bold.text-sm', verifyResult.success ? '✅ Connection Established' : '❌ Verification Failed'),
                  m('span.text-xs.font-mono.bg-black/10.px-2.py-0.5.rounded', verifyResult.latency + ' ms')
                ]),
                m('p.text-xs.mt-1', verifyResult.message)
              ])
            ])
          ])
        ]);
      }
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

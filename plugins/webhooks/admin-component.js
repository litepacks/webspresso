/**
 * Webhooks Admin Panel Component — Mithril SPA Component Generator
 * Features endpoints management, real-time ping testing, delivery log inspector, and retry
 * @module plugins/webhooks/admin-component
 */

'use strict';

/**
 * Generate client-side Mithril SPA component script string for Webhooks
 * 
 * @param {Object} [options]
 * @param {string} [options.apiPrefix='/webhooks']
 * @returns {string}
 */
function generateWebhooksComponent(options = {}) {
  const apiPrefix = options.apiPrefix || '/webhooks';

  return `
(function() {
  var API = '${apiPrefix}';

  function formatRelativeTime(dateStr) {
    if (!dateStr) return '—';
    try {
      var d = new Date(dateStr);
      var now = new Date();
      var diffMs = now - d;
      var diffSec = Math.floor(diffMs / 1000);
      var diffMin = Math.floor(diffSec / 60);
      var diffHour = Math.floor(diffMin / 60);
      var diffDay = Math.floor(diffHour / 24);

      if (diffSec < 60) return 'Just now';
      if (diffMin < 60) return diffMin + 'm ago';
      if (diffHour < 24) return diffHour + 'h ago';
      if (diffDay === 1) return 'Yesterday';
      if (diffDay < 30) return diffDay + 'd ago';
      return d.toLocaleDateString();
    } catch (e) {
      return dateStr;
    }
  }

  function parseEvents(events) {
    if (!events) return ['*'];
    if (Array.isArray(events)) return events;
    if (typeof events === 'string') {
      try {
        var parsed = JSON.parse(events);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {}
      return events.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    }
    return ['*'];
  }

  function WebhooksPage() {
    var activeTab = 'endpoints'; // 'endpoints' | 'deliveries'
    var loading = false;
    var error = null;
    var successToast = null;

    // Endpoints state
    var endpoints = [];
    var showEndpointModal = false;
    var editingEndpoint = null;
    var endpointForm = {
      name: '',
      url: '',
      secret: '',
      events: '*',
      is_active: true,
      description: '',
    };

    // Deliveries state
    var deliveries = [];
    var deliveryTotal = 0;
    var deliveryPage = 1;
    var deliveryLimit = 25;
    var deliveryPages = 1;
    var filterEvent = '';
    var filterSuccess = '';
    var activeDeliveryModal = null;

    function setToast(msg) {
      successToast = msg;
      setTimeout(function() {
        successToast = null;
        m.redraw();
      }, 3500);
    }

    function generateRandomSecret() {
      var chars = '0123456789abcdef';
      var res = 'whsec_';
      for (var i = 0; i < 48; i++) {
        res += chars[Math.floor(Math.random() * chars.length)];
      }
      return res;
    }

    function loadEndpoints() {
      loading = true;
      error = null;
      return m.request({
        method: 'GET',
        url: API + '/endpoints',
      }).then(function(res) {
        endpoints = res.items || [];
        loading = false;
        m.redraw();
      }).catch(function(err) {
        loading = false;
        error = (err.response && err.response.error) || err.message || 'Failed to load endpoints.';
        m.redraw();
      });
    }

    function loadDeliveries() {
      loading = true;
      error = null;
      var q = '?page=' + deliveryPage + '&limit=' + deliveryLimit;
      if (filterEvent) q += '&event=' + encodeURIComponent(filterEvent);
      if (filterSuccess !== '') q += '&success=' + encodeURIComponent(filterSuccess);

      return m.request({
        method: 'GET',
        url: API + '/deliveries' + q,
      }).then(function(res) {
        deliveries = res.items || [];
        deliveryTotal = res.total || 0;
        deliveryPage = res.page || 1;
        deliveryPages = res.pages || 1;
        loading = false;
        m.redraw();
      }).catch(function(err) {
        loading = false;
        error = (err.response && err.response.error) || err.message || 'Failed to load delivery records.';
        m.redraw();
      });
    }

    function saveEndpoint() {
      var isEdit = !!editingEndpoint;
      var method = isEdit ? 'PUT' : 'POST';
      var url = isEdit ? API + '/endpoints/' + editingEndpoint.id : API + '/endpoints';

      var payload = {
        name: endpointForm.name,
        url: endpointForm.url,
        secret: endpointForm.secret || generateRandomSecret(),
        events: endpointForm.events,
        is_active: endpointForm.is_active,
        description: endpointForm.description,
      };

      return m.request({
        method: method,
        url: url,
        body: payload,
      }).then(function() {
        showEndpointModal = false;
        editingEndpoint = null;
        setToast(isEdit ? 'Endpoint updated.' : 'New endpoint created.');
        loadEndpoints();
      }).catch(function(err) {
        alert((err.response && err.response.error) || err.message || 'Save failed.');
      });
    }

    function deleteEndpoint(ep) {
      if (!confirm('Are you sure you want to delete endpoint "' + ep.name + '"?')) {
        return;
      }
      m.request({
        method: 'DELETE',
        url: API + '/endpoints/' + ep.id,
      }).then(function() {
        setToast('Endpoint deleted.');
        loadEndpoints();
      }).catch(function(err) {
        alert((err.response && err.response.error) || err.message || 'Delete failed.');
      });
    }

    function pingEndpoint(ep) {
      setToast('Sending ping to "' + ep.name + '"...');
      m.request({
        method: 'POST',
        url: API + '/endpoints/' + ep.id + '/ping',
      }).then(function(res) {
        if (res.success) {
          setToast('Ping successful! Response code: ' + res.statusCode + ' (' + (res.durationMs || 0) + 'ms)');
        } else {
          alert('Ping failed: ' + (res.error || ('HTTP ' + res.statusCode)));
        }
        if (activeTab === 'deliveries') loadDeliveries();
      }).catch(function(err) {
        alert('Failed to send ping request: ' + (err.message || 'Network error'));
      });
    }

    function retryDelivery(dlv) {
      setToast('Retrying delivery #' + dlv.id + '...');
      m.request({
        method: 'POST',
        url: API + '/deliveries/' + dlv.id + '/retry',
      }).then(function(res) {
        if (res.success) {
          setToast('Retry successful! (' + res.statusCode + ')');
        } else {
          alert('Retry failed: ' + (res.error || ('HTTP ' + res.statusCode)));
        }
        loadDeliveries();
      }).catch(function(err) {
        alert('Failed to send retry request: ' + err.message);
      });
    }

    function openNewModal() {
      editingEndpoint = null;
      endpointForm = {
        name: '',
        url: '',
        secret: generateRandomSecret(),
        events: '*',
        is_active: true,
        description: '',
      };
      showEndpointModal = true;
    }

    function openEditModal(ep) {
      editingEndpoint = ep;
      var evts = parseEvents(ep.events).join(', ');
      endpointForm = {
        name: ep.name || '',
        url: ep.url || '',
        secret: ep.secret || '',
        events: evts,
        is_active: ep.is_active !== false,
        description: ep.description || '',
      };
      showEndpointModal = true;
    }

    return {
      oninit: function() {
        loadEndpoints();
      },

      view: function() {
        var totalEndpoints = endpoints.length;
        var activeEndpoints = endpoints.filter(function(e) { return e.is_active; }).length;

        return m('div.space-y-6', [
          // Toast Notification
          successToast ? m('div.fixed.bottom-5.right-5.z-50.px-4.py-2.5.rounded-xl.bg-emerald-600.text-white.text-sm.font-medium.shadow-lg.flex.items-center.gap-2.animate-fade-in', [
            m('span', '✓'),
            m('span', successToast),
          ]) : null,

          // Page Header
          m('div.flex.flex-col.sm:flex-row.sm:items-center.sm:justify-between.gap-4.border-b.border-gray-200.dark:border-slate-800.pb-5', [
            m('div', [
              m('h1.text-2xl.font-bold.text-gray-900.dark:text-white', 'Webhooks'),
              m('p.text-sm.text-gray-500.dark:text-slate-400.mt-1',
                'Secure HMAC-SHA256 event notifications and delivery management for external systems'
              ),
            ]),
            m('div.flex.items-center.gap-3', [
              m('button.inline-flex.items-center.gap-2.px-4.py-2.text-sm.font-semibold.rounded-xl.bg-indigo-600.text-white.hover:bg-indigo-500.shadow-sm.transition-all', {
                onclick: openNewModal,
              }, [
                m('span', '+'),
                m('span', 'Add New Endpoint'),
              ]),
            ]),
          ]),

          // Stats Bar
          m('div.grid.grid-cols-2.sm:grid-cols-4.gap-4', [
            m('div.p-4.rounded-2xl.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.shadow-sm', [
              m('div.text-xs.font-medium.text-gray-500.dark:text-slate-400', 'Registered Endpoints'),
              m('div.text-2xl.font-bold.text-gray-900.dark:text-white.mt-1', totalEndpoints),
            ]),
            m('div.p-4.rounded-2xl.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.shadow-sm', [
              m('div.text-xs.font-medium.text-gray-500.dark:text-slate-400', 'Active Endpoints'),
              m('div.text-2xl.font-bold.text-emerald-600.dark:text-emerald-400.mt-1', activeEndpoints),
            ]),
            m('div.p-4.rounded-2xl.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.shadow-sm', [
              m('div.text-xs.font-medium.text-gray-500.dark:text-slate-400', 'Deliveries Count'),
              m('div.text-2xl.font-bold.text-indigo-600.dark:text-indigo-400.mt-1', deliveryTotal || '—'),
            ]),
            m('div.p-4.rounded-2xl.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.shadow-sm', [
              m('div.text-xs.font-medium.text-gray-500.dark:text-slate-400', 'Signature Standard'),
              m('div.text-sm.font-semibold.text-gray-700.dark:text-slate-200.mt-2.font-mono', 'HMAC SHA-256'),
            ]),
          ]),

          // Tabs Switcher
          m('div.flex.border-b.border-gray-200.dark:border-slate-700', [
            m('button.px-5.py-2.5.text-sm.font-medium.border-b-2.transition-colors', {
              class: activeTab === 'endpoints'
                ? 'border-indigo-600.text-indigo-600.dark:text-indigo-400.dark:border-indigo-400'
                : 'border-transparent.text-gray-500.hover:text-gray-700.dark:text-slate-400.dark:hover:text-slate-200',
              onclick: function() { activeTab = 'endpoints'; loadEndpoints(); },
            }, 'Endpoints (' + totalEndpoints + ')'),
            m('button.px-5.py-2.5.text-sm.font-medium.border-b-2.transition-colors', {
              class: activeTab === 'deliveries'
                ? 'border-indigo-600.text-indigo-600.dark:text-indigo-400.dark:border-indigo-400'
                : 'border-transparent.text-gray-500.hover:text-gray-700.dark:text-slate-400.dark:hover:text-slate-200',
              onclick: function() { activeTab = 'deliveries'; loadDeliveries(); },
            }, 'Delivery History'),
          ]),

          // TAB 1: ENDPOINTS LIST
          activeTab === 'endpoints' ? m('div.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.rounded-2xl.overflow-hidden.shadow-sm', [
            endpoints.length === 0 ? m('div.p-12.text-center.text-gray-500.dark:text-slate-400', [
              m('p.text-base.font-medium', 'No webhook endpoints registered yet.'),
              m('p.text-xs.mt-1', 'Add a new endpoint above to forward system events to Zapier, Slack, or your custom server.'),
            ]) : m('div.overflow-x-auto', [
              m('table.w-full.text-left.text-sm', [
                m('thead.bg-gray-50.dark:bg-slate-750.text-xs.uppercase.text-gray-500.dark:text-slate-400.border-b.border-gray-200.dark:border-slate-700', [
                  m('tr', [
                    m('th.p-4', 'Name & Target URL'),
                    m('th.p-4', 'Subscribed Events'),
                    m('th.p-4', 'Status'),
                    m('th.p-4', 'Success Rate'),
                    m('th.p-4.text-right', 'Actions'),
                  ]),
                ]),
                m('tbody.divide-y.divide-gray-100.dark:divide-slate-700', endpoints.map(function(ep) {
                  var evts = parseEvents(ep.events);
                  var stats = ep.stats || { total: 0, successRate: 100 };

                  return m('tr.hover:bg-gray-50/60.dark:hover:bg-slate-750/50.transition-colors', [
                    m('td.p-4', [
                      m('div.font-semibold.text-gray-900.dark:text-white', ep.name),
                      m('div.text-xs.font-mono.text-gray-500.dark:text-slate-400.truncate.max-w-md.mt-0.5', { title: ep.url }, ep.url),
                      ep.description ? m('div.text-xs.text-gray-400.mt-1', ep.description) : null,
                    ]),
                    m('td.p-4', [
                      m('div.flex.flex-wrap.gap-1', evts.map(function(evt) {
                        return m('span.px-2.py-0.5.text-xs.font-mono.rounded-md.bg-gray-100.dark:bg-slate-700.text-gray-700.dark:text-slate-300', evt);
                      })),
                    ]),
                    m('td.p-4', [
                      ep.is_active
                        ? m('span.inline-flex.items-center.gap-1.5.px-2.5.py-1.rounded-full.text-xs.font-medium.bg-emerald-50.text-emerald-700.dark:bg-emerald-950/40.dark:text-emerald-300', [
                            m('span.w-1.5.h-1.5.rounded-full.bg-emerald-500'),
                            'Active'
                          ])
                        : m('span.inline-flex.items-center.gap-1.5.px-2.5.py-1.rounded-full.text-xs.font-medium.bg-gray-100.text-gray-600.dark:bg-slate-700.dark:text-slate-400', [
                            m('span.w-1.5.h-1.5.rounded-full.bg-gray-400'),
                            'Inactive'
                          ]),
                    ]),
                    m('td.p-4', [
                      stats.total > 0
                        ? m('div.text-xs', [
                            m('span.font-medium', stats.successRate + '% '),
                            m('span.text-gray-400', '(' + stats.successful + '/' + stats.total + ')'),
                          ])
                        : m('span.text-xs.text-gray-400', 'No deliveries'),
                    ]),
                    m('td.p-4.text-right', [
                      m('div.inline-flex.items-center.gap-2', [
                        m('button.px-2.5.py-1.text-xs.font-medium.rounded-lg.border.border-gray-200.dark:border-slate-700.text-gray-700.dark:text-slate-200.hover:bg-gray-100.dark:hover:bg-slate-700.transition-colors', {
                          onclick: function() { pingEndpoint(ep); },
                        }, '⚡ Ping'),
                        m('button.px-2.5.py-1.text-xs.font-medium.rounded-lg.border.border-gray-200.dark:border-slate-700.text-indigo-600.dark:text-indigo-400.hover:bg-indigo-50.dark:hover:bg-slate-700.transition-colors', {
                          onclick: function() { openEditModal(ep); },
                        }, 'Edit'),
                        m('button.px-2.5.py-1.text-xs.font-medium.rounded-lg.border.border-gray-200.dark:border-slate-700.text-red-600.hover:bg-red-50.dark:hover:bg-slate-700.transition-colors', {
                          onclick: function() { deleteEndpoint(ep); },
                        }, 'Delete'),
                      ]),
                    ]),
                  ]);
                })),
              ]),
            ]),
          ]) : null,

          // TAB 2: DELIVERIES LIST
          activeTab === 'deliveries' ? m('div.space-y-4', [
            // Filter Bar
            m('div.flex.flex-col.sm:flex-row.gap-3.items-center.justify-between.bg-white.dark:bg-slate-800.p-3.rounded-xl.border.border-gray-200.dark:border-slate-700', [
              m('div.flex.items-center.gap-3.w-full.sm:w-auto', [
                m('input.px-3.py-1.5.text-xs.border.border-gray-200.dark:border-slate-700.rounded-lg.bg-transparent.text-gray-900.dark:text-white', {
                  placeholder: 'Filter event (e.g. user.*)',
                  value: filterEvent,
                  oninput: function(e) { filterEvent = e.target.value; },
                }),
                m('select.px-3.py-1.5.text-xs.border.border-gray-200.dark:border-slate-700.rounded-lg.bg-transparent.text-gray-900.dark:text-white', {
                  value: filterSuccess,
                  onchange: function(e) { filterSuccess = e.target.value; },
                }, [
                  m('option', { value: '' }, 'All Statuses'),
                  m('option', { value: 'true' }, 'Success Only'),
                  m('option', { value: 'false' }, 'Failed Only'),
                ]),
                m('button.px-3.py-1.5.text-xs.font-medium.rounded-lg.bg-gray-100.dark:bg-slate-700.text-gray-700.dark:text-slate-200.hover:bg-gray-200', {
                  onclick: function() { deliveryPage = 1; loadDeliveries(); },
                }, 'Filter'),
              ]),
              m('div.text-xs.text-gray-500.dark:text-slate-400', 'Total: ' + deliveryTotal + ' records'),
            ]),

            // Deliveries Table
            m('div.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.rounded-2xl.overflow-hidden.shadow-sm', [
              deliveries.length === 0 ? m('div.p-12.text-center.text-gray-500.dark:text-slate-400', [
                m('p.text-base.font-medium', 'No delivery records found yet.'),
              ]) : m('div.overflow-x-auto', [
                m('table.w-full.text-left.text-sm', [
                  m('thead.bg-gray-50.dark:bg-slate-750.text-xs.uppercase.text-gray-500.dark:text-slate-400.border-b.border-gray-200.dark:border-slate-700', [
                    m('tr', [
                      m('th.p-4', 'Status'),
                      m('th.p-4', 'Event'),
                      m('th.p-4', 'Duration'),
                      m('th.p-4', 'Attempt'),
                      m('th.p-4', 'Time'),
                      m('th.p-4.text-right', 'Actions'),
                    ]),
                  ]),
                  m('tbody.divide-y.divide-gray-100.dark:divide-slate-700', deliveries.map(function(dlv) {
                    var isSuccess = dlv.success;
                    var badgeClass = isSuccess
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300';
                    var statusLabel = dlv.status_code ? 'HTTP ' + dlv.status_code : (isSuccess ? '200 OK' : 'Error');

                    return m('tr.hover:bg-gray-50/60.dark:hover:bg-slate-750/50.transition-colors', [
                      m('td.p-4', [
                        m('span.inline-flex.items-center.px-2.5.py-0.5.rounded-full.text-xs.font-semibold.border', {
                          class: badgeClass,
                        }, statusLabel),
                      ]),
                      m('td.p-4', [
                        m('span.font-mono.font-semibold.text-gray-900.dark:text-white', dlv.event),
                        m('div.text-xs.text-gray-400', 'Endpoint #' + dlv.endpoint_id),
                      ]),
                      m('td.p-4.text-xs.text-gray-600.dark:text-slate-300', (dlv.duration_ms != null ? dlv.duration_ms + ' ms' : '—')),
                      m('td.p-4.text-xs.text-gray-600.dark:text-slate-300', dlv.attempt + ' / ' + dlv.max_attempts),
                      m('td.p-4.text-xs.text-gray-500.dark:text-slate-400', formatRelativeTime(dlv.created_at)),
                      m('td.p-4.text-right', [
                        m('div.inline-flex.items-center.gap-2', [
                          m('button.px-2.5.py-1.text-xs.font-medium.rounded-lg.border.border-gray-200.dark:border-slate-700.text-indigo-600.hover:bg-indigo-50.dark:hover:bg-slate-700', {
                            onclick: function() { activeDeliveryModal = dlv; },
                          }, 'Details'),
                          !isSuccess ? m('button.px-2.5.py-1.text-xs.font-medium.rounded-lg.bg-indigo-50.text-indigo-600.dark:bg-indigo-950/50.dark:text-indigo-300.hover:bg-indigo-100', {
                            onclick: function() { retryDelivery(dlv); },
                          }, 'Retry') : null,
                        ]),
                      ]),
                    ]);
                  })),
                ]),
              ]),

              // Pagination Bar
              m('div.flex.items-center.justify-between.p-4.border-t.border-gray-100.dark:border-slate-700', [
                m('div.text-xs.text-gray-500', deliveryTotal + ' records listed'),
                m('div.flex.items-center.gap-2', [
                  m('button.px-3.py-1.text-xs.border.rounded-lg.disabled:opacity-40', {
                    disabled: deliveryPage <= 1,
                    onclick: function() { if (deliveryPage > 1) { deliveryPage--; loadDeliveries(); } },
                  }, 'Previous'),
                  m('span.text-xs.text-gray-600.dark:text-slate-300', deliveryPage + ' / ' + deliveryPages),
                  m('button.px-3.py-1.text-xs.border.rounded-lg.disabled:opacity-40', {
                    disabled: deliveryPage >= deliveryPages,
                    onclick: function() { if (deliveryPage < deliveryPages) { deliveryPage++; loadDeliveries(); } },
                  }, 'Next'),
                ]),
              ]),
            ]),
          ]) : null,

          // MODAL: CREATE / EDIT ENDPOINT
          showEndpointModal ? m('div.fixed.inset-0.z-50.flex.items-center.justify-center.p-4.bg-black/50.backdrop-blur-sm', [
            m('div.bg-white.dark:bg-slate-800.rounded-2xl.border.border-gray-200.dark:border-slate-700.shadow-2xl.w-full.max-w-lg.p-6.space-y-4', [
              m('div.flex.items-center.justify-between', [
                m('h3.text-lg.font-bold.text-gray-900.dark:text-white', editingEndpoint ? 'Edit Endpoint' : 'New Webhook Endpoint'),
                m('button.text-gray-400.hover:text-gray-600.dark:hover:text-white', {
                  onclick: function() { showEndpointModal = false; },
                }, '✕'),
              ]),
              m('div.space-y-3', [
                m('div', [
                  m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1', 'Name / Description *'),
                  m('input.w-full.px-3.py-2.text-sm.border.border-gray-300.dark:border-slate-600.rounded-xl.bg-transparent.text-gray-900.dark:text-white', {
                    placeholder: 'e.g. Zapier Order Sync',
                    value: endpointForm.name,
                    oninput: function(e) { endpointForm.name = e.target.value; },
                  }),
                ]),
                m('div', [
                  m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1', 'Target URL *'),
                  m('input.w-full.px-3.py-2.text-sm.border.border-gray-300.dark:border-slate-600.rounded-xl.bg-transparent.text-gray-900.dark:text-white', {
                    placeholder: 'https://example.com/api/webhook',
                    value: endpointForm.url,
                    oninput: function(e) { endpointForm.url = e.target.value; },
                  }),
                ]),
                m('div', [
                  m('div.flex.items-center.justify-between.mb-1', [
                    m('label.text-xs.font-semibold.text-gray-700.dark:text-slate-300', 'Signing Secret'),
                    m('button.text-xs.text-indigo-600.dark:text-indigo-400.hover:underline', {
                      type: 'button',
                      onclick: function() { endpointForm.secret = generateRandomSecret(); },
                    }, 'Generate New'),
                  ]),
                  m('input.w-full.px-3.py-2.text-xs.font-mono.border.border-gray-300.dark:border-slate-600.rounded-xl.bg-transparent.text-gray-900.dark:text-white', {
                    value: endpointForm.secret,
                    oninput: function(e) { endpointForm.secret = e.target.value; },
                  }),
                ]),
                m('div', [
                  m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1', 'Subscribed Events (Comma-separated, * for all events)'),
                  m('input.w-full.px-3.py-2.text-sm.border.border-gray-300.dark:border-slate-600.rounded-xl.bg-transparent.text-gray-900.dark:text-white', {
                    placeholder: 'user.*, order.created, payment.success',
                    value: endpointForm.events,
                    oninput: function(e) { endpointForm.events = e.target.value; },
                  }),
                ]),
                m('div.flex.items-center.gap-2.pt-1', [
                  m('input[type=checkbox]', {
                    id: 'active_check',
                    checked: endpointForm.is_active,
                    onchange: function(e) { endpointForm.is_active = e.target.checked; },
                  }),
                  m('label.text-xs.font-medium.text-gray-700.dark:text-slate-300', { for: 'active_check' }, 'Enable this endpoint to receive events'),
                ]),
              ]),
              m('div.flex.items-center.justify-end.gap-3.pt-3.border-t.border-gray-100.dark:border-slate-700', [
                m('button.px-4.py-2.text-xs.font-medium.rounded-xl.border.border-gray-300.dark:border-slate-600.text-gray-700.dark:text-slate-200', {
                  onclick: function() { showEndpointModal = false; },
                }, 'Cancel'),
                m('button.px-4.py-2.text-xs.font-semibold.rounded-xl.bg-indigo-600.text-white.hover:bg-indigo-500', {
                  onclick: saveEndpoint,
                }, editingEndpoint ? 'Update' : 'Save'),
              ]),
            ]),
          ]) : null,

          // MODAL: DELIVERY DETAILS
          activeDeliveryModal ? m('div.fixed.inset-0.z-50.flex.items-center.justify-center.p-4.bg-black/50.backdrop-blur-sm', [
            m('div.bg-white.dark:bg-slate-800.rounded-2xl.border.border-gray-200.dark:border-slate-700.shadow-2xl.w-full.max-w-2xl.max-h-[90vh].flex.flex-col.overflow-hidden', [
              m('div.p-5.border-b.border-gray-200.dark:border-slate-700.flex.items-center.justify-between', [
                m('div', [
                  m('h3.text-base.font-bold.text-gray-900.dark:text-white', 'Delivery Details #' + activeDeliveryModal.id),
                  m('span.text-xs.text-gray-500.dark:text-slate-400', activeDeliveryModal.event + ' — ' + formatRelativeTime(activeDeliveryModal.created_at)),
                ]),
                m('button.text-gray-400.hover:text-gray-600.dark:hover:text-white', {
                  onclick: function() { activeDeliveryModal = null; },
                }, '✕'),
              ]),
              m('div.p-5.space-y-4.overflow-y-auto.flex-1', [
                m('div.grid.grid-cols-2.sm:grid-cols-3.gap-2.text-xs.p-3.bg-gray-50.dark:bg-slate-750.rounded-xl', [
                  m('div', [m('span.text-gray-400.block', 'Status'), m('span.font-semibold', activeDeliveryModal.success ? 'Success' : 'Failed')]),
                  m('div', [m('span.text-gray-400.block', 'HTTP Code'), m('span.font-semibold', activeDeliveryModal.status_code || '—')]),
                  m('div', [m('span.text-gray-400.block', 'Response Time'), m('span.font-semibold', (activeDeliveryModal.duration_ms || 0) + ' ms')]),
                  m('div', [m('span.text-gray-400.block', 'Attempt'), m('span.font-semibold', activeDeliveryModal.attempt + ' / ' + activeDeliveryModal.max_attempts)]),
                  m('div.col-span-2', [m('span.text-gray-400.block', 'Error'), m('span.text-red-500', activeDeliveryModal.error || 'None')]),
                ]),
                m('div', [
                  m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1', 'Request Payload (JSON)'),
                  m('pre.p-3.rounded-xl.bg-slate-900.text-slate-100.text-xs.font-mono.overflow-x-auto.max-h-60',
                    (function() {
                      try {
                        return JSON.stringify(JSON.parse(activeDeliveryModal.payload), null, 2);
                      } catch (e) {
                        return activeDeliveryModal.payload || '';
                      }
                    })()
                  ),
                ]),
                activeDeliveryModal.response_body ? m('div', [
                  m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1', 'Target Response Body'),
                  m('pre.p-3.rounded-xl.bg-slate-900.text-slate-100.text-xs.font-mono.overflow-x-auto.max-h-40',
                    activeDeliveryModal.response_body
                  ),
                ]) : null,
              ]),
              m('div.p-4.border-t.border-gray-200.dark:border-slate-700.flex.justify-end', [
                m('button.px-4.py-2.text-xs.font-semibold.rounded-xl.bg-indigo-600.text-white.hover:bg-indigo-500', {
                  onclick: function() { activeDeliveryModal = null; },
                }, 'Close'),
              ]),
            ]),
          ]) : null,
        ]);
      },
    };
  }

  window.__customPages = window.__customPages || {};
  window.__customPages['webhooks'] = WebhooksPage;
})();
`;
}

module.exports = {
  generateWebhooksComponent,
};

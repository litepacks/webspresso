/**
 * Webhooks Admin Panel Component — Mithril SPA Component Generator
 * Features endpoints management, interactive payload & ping testing, delivery log inspector, secret rotation, and bulk retry
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

  var EVENT_PRESETS = {
    'ping': {
      label: 'Ping Handshake (ping)',
      payload: {
        ping: true,
        message: 'Manual webhook ping test from Webspresso Admin',
        timestamp: new Date().toISOString()
      }
    },
    'order.created': {
      label: 'Order Created (order.created)',
      payload: {
        id: 'ord_9824',
        event: 'order.created',
        amount: 149.50,
        currency: 'USD',
        status: 'paid',
        customer: {
          id: 'cust_401',
          name: 'Jane Doe',
          email: 'jane.doe@example.com'
        },
        items: [
          { sku: 'PREM-SUB', name: 'Annual Pro Plan', qty: 1, unit_price: 149.50 }
        ]
      }
    },
    'user.registered': {
      label: 'User Registered (user.registered)',
      payload: {
        id: 1042,
        event: 'user.registered',
        email: 'developer@example.com',
        username: 'octocat',
        plan: 'developer',
        created_at: new Date().toISOString()
      }
    },
    'payment.succeeded': {
      label: 'Payment Succeeded (payment.succeeded)',
      payload: {
        id: 'pay_7721',
        event: 'payment.succeeded',
        amount: 49.00,
        currency: 'EUR',
        payment_method: 'card_visa',
        receipt_url: 'https://example.com/receipts/pay_7721'
      }
    },
    'custom': {
      label: 'Custom JSON Payload',
      payload: {
        event: 'custom.event',
        data: {
          test: true,
          value: 42
        }
      }
    }
  };

  function WebhooksPage() {
    var activeTab = 'endpoints'; // 'endpoints' | 'deliveries'
    var loading = false;
    var error = null;
    var successToast = null;

    // Global Stats
    var stats = {
      totalEndpoints: 0,
      activeEndpoints: 0,
      totalDeliveries: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      successRate: 100,
      avgDurationMs: 0
    };

    // Endpoints state
    var endpoints = [];
    var searchEndpoints = '';
    var filterEndpointActive = '';
    var revealedSecrets = {};
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

    // Interactive Test / Ping Modal state
    var showTestModal = false;
    var testEndpointTarget = null;
    var testEvent = 'ping';
    var testPayloadStr = JSON.stringify(EVENT_PRESETS['ping'].payload, null, 2);
    var testResult = null;
    var testInProgress = false;

    // Deliveries state
    var deliveries = [];
    var deliveryTotal = 0;
    var deliveryPage = 1;
    var deliveryLimit = 25;
    var deliveryPages = 1;
    var filterEvent = '';
    var filterSuccess = '';
    var filterEndpointId = '';
    var activeDeliveryModal = null;
    var selectedDeliveryIds = {};
    var bulkRetrying = false;

    // Replay with edit state inside delivery modal
    var replayEditMode = false;
    var replayPayloadStr = '';

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

    function copyToClipboard(text, label) {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
          setToast((label || 'Text') + ' copied to clipboard!');
        }).catch(function() {
          setToast('Failed to copy to clipboard.');
        });
      } else {
        var el = document.createElement('textarea');
        el.value = text;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        setToast((label || 'Text') + ' copied to clipboard!');
      }
    }

  var clientApi = {
    get: function(path) {
      if (typeof api !== 'undefined' && api && typeof api.get === 'function') {
        return api.get(path);
      }
      var adminPath = window.__ADMIN_PATH__ || '/_admin';
      return m.request({ method: 'GET', url: adminPath + '/api' + path });
    },
    post: function(path, data) {
      if (typeof api !== 'undefined' && api && typeof api.post === 'function') {
        return api.post(path, data);
      }
      var adminPath = window.__ADMIN_PATH__ || '/_admin';
      return m.request({ method: 'POST', url: adminPath + '/api' + path, body: data });
    },
    put: function(path, data) {
      if (typeof api !== 'undefined' && api && typeof api.put === 'function') {
        return api.put(path, data);
      }
      var adminPath = window.__ADMIN_PATH__ || '/_admin';
      return m.request({ method: 'PUT', url: adminPath + '/api' + path, body: data });
    },
    delete: function(path) {
      if (typeof api !== 'undefined' && api && typeof api.delete === 'function') {
        return api.delete(path);
      }
      var adminPath = window.__ADMIN_PATH__ || '/_admin';
      return m.request({ method: 'DELETE', url: adminPath + '/api' + path });
    }
  };

    function loadStats() {
      return clientApi.get(API + '/stats').then(function(res) {
        if (res) {
          stats = res;
          m.redraw();
        }
      }).catch(function() {});
    }

    function loadEndpoints() {
      loading = true;
      error = null;
      var q = '?';
      if (searchEndpoints) q += 'search=' + encodeURIComponent(searchEndpoints) + '&';
      if (filterEndpointActive !== '') q += 'active=' + encodeURIComponent(filterEndpointActive) + '&';

      return clientApi.get(API + '/endpoints' + q).then(function(res) {
        endpoints = (res && res.items) || [];
        loading = false;
        loadStats();
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
      if (filterEvent) q += '&search=' + encodeURIComponent(filterEvent);
      if (filterSuccess !== '') q += '&success=' + encodeURIComponent(filterSuccess);
      if (filterEndpointId) q += '&endpointId=' + encodeURIComponent(filterEndpointId);

      return clientApi.get(API + '/deliveries' + q).then(function(res) {
        deliveries = (res && res.items) || [];
        deliveryTotal = (res && res.total) || 0;
        deliveryPage = (res && res.page) || 1;
        deliveryPages = (res && res.pages) || 1;
        selectedDeliveryIds = {};
        loading = false;
        loadStats();
        m.redraw();
      }).catch(function(err) {
        loading = false;
        error = (err.response && err.response.error) || err.message || 'Failed to load delivery records.';
        m.redraw();
      });
    }

    function saveEndpoint() {
      var isEdit = !!editingEndpoint;
      var url = isEdit ? API + '/endpoints/' + editingEndpoint.id : API + '/endpoints';

      var payload = {
        name: endpointForm.name,
        url: endpointForm.url,
        secret: endpointForm.secret || generateRandomSecret(),
        events: endpointForm.events,
        is_active: endpointForm.is_active,
        description: endpointForm.description,
      };

      var req = isEdit ? clientApi.put(url, payload) : clientApi.post(url, payload);

      return req.then(function() {
        showEndpointModal = false;
        editingEndpoint = null;
        setToast(isEdit ? 'Endpoint updated successfully.' : 'New endpoint created successfully.');
        loadEndpoints();
      }).catch(function(err) {
        alert((err.response && err.response.error) || err.message || 'Save failed.');
      });
    }

    function deleteEndpoint(ep) {
      if (!confirm('Are you sure you want to delete endpoint "' + ep.name + '"?')) {
        return;
      }
      clientApi.delete(API + '/endpoints/' + ep.id).then(function() {
        setToast('Endpoint deleted.');
        loadEndpoints();
      }).catch(function(err) {
        alert((err.response && err.response.error) || err.message || 'Delete failed.');
      });
    }

    function rotateSecret(ep) {
      if (!confirm('Rotate signing secret for "' + ep.name + '"?\\n\\nThe previous secret will remain stored for signature verification during grace period.')) {
        return;
      }
      clientApi.post(API + '/endpoints/' + ep.id + '/rotate-secret', {}).then(function(res) {
        setToast('Secret rotated! New secret: ' + (res.secret || ''));
        loadEndpoints();
      }).catch(function(err) {
        alert((err.response && err.response.error) || err.message || 'Secret rotation failed.');
      });
    }

    function openTestModal(ep) {
      testEndpointTarget = ep;
      testEvent = 'ping';
      testPayloadStr = JSON.stringify(EVENT_PRESETS['ping'].payload, null, 2);
      testResult = null;
      testInProgress = false;
      showTestModal = true;
    }

    function setEventPreset(evtKey) {
      testEvent = evtKey;
      if (EVENT_PRESETS[evtKey]) {
        testPayloadStr = JSON.stringify(EVENT_PRESETS[evtKey].payload, null, 2);
      }
    }

    function runWebhookTest() {
      if (!testEndpointTarget) return;

      var parsedPayload;
      try {
        parsedPayload = JSON.parse(testPayloadStr);
      } catch (e) {
        alert('Invalid JSON in payload: ' + e.message);
        return;
      }

      testInProgress = true;
      testResult = null;

      clientApi.post(API + '/endpoints/' + testEndpointTarget.id + '/test', {
        event: testEvent,
        payload: parsedPayload,
      }).then(function(res) {
        testInProgress = false;
        testResult = res;
        if (res && res.success) {
          setToast('Test delivery successful! (' + res.statusCode + ' in ' + (res.durationMs || 0) + 'ms)');
        }
        loadStats();
        m.redraw();
      }).catch(function(err) {
        testInProgress = false;
        testResult = {
          success: false,
          statusCode: 0,
          error: (err.response && err.response.error) || err.message || 'Network dispatch error',
        };
        m.redraw();
      });
    }

    function retryDelivery(dlv) {
      setToast('Retrying delivery #' + dlv.id + '...');
      clientApi.post(API + '/deliveries/' + dlv.id + '/retry', {}).then(function(res) {
        if (res && res.success) {
          setToast('Retry successful! (HTTP ' + res.statusCode + ')');
        } else {
          alert('Retry failed: ' + ((res && res.error) || ('HTTP ' + (res && res.statusCode))));
        }
        loadDeliveries();
      }).catch(function(err) {
        alert('Failed to send retry request: ' + err.message);
      });
    }

    function replayActiveDelivery() {
      if (!activeDeliveryModal) return;
      var dlv = activeDeliveryModal;
      var body = {};

      if (replayEditMode) {
        try {
          body.payload = JSON.parse(replayPayloadStr);
        } catch (e) {
          alert('Invalid JSON payload: ' + e.message);
          return;
        }
      }

      setToast('Replaying delivery #' + dlv.id + '...');
      clientApi.post(API + '/deliveries/' + dlv.id + '/replay', body).then(function(res) {
        if (res && res.success) {
          setToast('Replay successful! Created delivery #' + (res.deliveryId || res.id) + ' (HTTP ' + res.statusCode + ')');
          activeDeliveryModal = null;
          replayEditMode = false;
        } else {
          alert('Replay failed: ' + ((res && res.error) || ('HTTP ' + (res && res.statusCode))));
        }
        loadDeliveries();
      }).catch(function(err) {
        alert('Failed to replay delivery: ' + err.message);
      });
    }

    function bulkRetrySelected() {
      var ids = Object.keys(selectedDeliveryIds).filter(function(k) { return selectedDeliveryIds[k]; });
      if (ids.length === 0) return;

      if (!confirm('Retry ' + ids.length + ' selected deliveries?')) return;

      bulkRetrying = true;
      clientApi.post(API + '/deliveries/bulk-retry', { ids: ids }).then(function(res) {
        bulkRetrying = false;
        selectedDeliveryIds = {};
        setToast('Bulk retry finished: ' + (res ? res.succeeded : 0) + ' succeeded, ' + (res ? res.failed : 0) + ' failed.');
        loadDeliveries();
      }).catch(function(err) {
        bulkRetrying = false;
        alert('Bulk retry failed: ' + err.message);
      });
    }

    function toggleSelectAllDeliveries(checked) {
      selectedDeliveryIds = {};
      if (checked) {
        for (var i = 0; i < deliveries.length; i++) {
          selectedDeliveryIds[deliveries[i].id] = true;
        }
      }
    }

    function getSelectedCount() {
      return Object.keys(selectedDeliveryIds).filter(function(k) { return selectedDeliveryIds[k]; }).length;
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

    // Keydown listener for Esc key
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        if (showTestModal) {
          showTestModal = false;
          m.redraw();
        } else if (showEndpointModal) {
          showEndpointModal = false;
          m.redraw();
        } else if (activeDeliveryModal) {
          activeDeliveryModal = null;
          m.redraw();
        }
      }
    }

    return {
      oninit: function() {
        loadEndpoints();
        loadStats();
        window.addEventListener('keydown', onKeyDown);
      },

      onremove: function() {
        window.removeEventListener('keydown', onKeyDown);
      },

      view: function() {
        var totalEndpoints = stats.totalEndpoints || endpoints.length;
        var activeEndpoints = stats.activeEndpoints || endpoints.filter(function(e) { return e.is_active; }).length;
        var selectedCount = getSelectedCount();
        var allSelected = deliveries.length > 0 && selectedCount === deliveries.length;

        return m('div.space-y-6', [
          // Toast Notification
          successToast ? m('div.fixed.bottom-5.right-5.z-50.px-4.py-2.5.rounded-xl.bg-emerald-600.text-white.text-sm.font-medium.shadow-xl.flex.items-center.gap-2.animate-fade-in', [
            m('span', '✓'),
            m('span', successToast),
          ]) : null,

          // Page Header
          m('div.flex.flex-col.sm:flex-row.sm:items-center.sm:justify-between.gap-4.border-b.border-gray-200.dark:border-slate-800.pb-5', [
            m('div', [
              m('div.flex.items-center.gap-3', [
                m('div.w-9.h-9.rounded-xl.bg-indigo-600/10.text-indigo-600.dark:bg-indigo-500/20.dark:text-indigo-400.flex.items-center.justify-center.font-bold.text-lg', '🪝'),
                m('h1.text-2xl.font-bold.text-gray-900.dark:text-white', 'Webhooks Engine'),
              ]),
              m('p.text-sm.text-gray-500.dark:text-slate-400.mt-1',
                'HMAC-SHA256 cryptographically signed webhook dispatches, live payload testing, and delivery audit history.'
              ),
            ]),
            m('div.flex.items-center.gap-3', [
              m('button.inline-flex.items-center.gap-2.px-4.py-2.text-sm.font-semibold.rounded-xl.bg-indigo-600.text-white.hover:bg-indigo-500.shadow-sm.transition-all', {
                onclick: openNewModal,
              }, [
                m('span', '+'),
                m('span', 'Add Webhook Endpoint'),
              ]),
            ]),
          ]),

          // Metrics Summary Banner
          m('div.grid.grid-cols-2.sm:grid-cols-4.gap-4', [
            m('div.p-4.rounded-2xl.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.shadow-sm', [
              m('div.text-xs.font-medium.text-gray-500.dark:text-slate-400', 'Active Endpoints'),
              m('div.text-2xl.font-bold.text-gray-900.dark:text-white.mt-1', [
                m('span.text-emerald-600.dark:text-emerald-400', activeEndpoints),
                m('span.text-gray-400.text-lg.font-normal', ' / ' + totalEndpoints),
              ]),
            ]),
            m('div.p-4.rounded-2xl.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.shadow-sm', [
              m('div.text-xs.font-medium.text-gray-500.dark:text-slate-400', 'Total Deliveries'),
              m('div.text-2xl.font-bold.text-indigo-600.dark:text-indigo-400.mt-1', stats.totalDeliveries || deliveryTotal || 0),
            ]),
            m('div.p-4.rounded-2xl.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.shadow-sm', [
              m('div.text-xs.font-medium.text-gray-500.dark:text-slate-400', 'Delivery Success Rate'),
              m('div.text-2xl.font-bold.mt-1', {
                class: (stats.successRate >= 95 ? 'text-emerald-600 dark:text-emerald-400' : (stats.successRate >= 80 ? 'text-amber-500' : 'text-rose-600'))
              }, stats.successRate + '%'),
            ]),
            m('div.p-4.rounded-2xl.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.shadow-sm', [
              m('div.text-xs.font-medium.text-gray-500.dark:text-slate-400', 'Average Latency'),
              m('div.text-2xl.font-bold.text-gray-900.dark:text-white.mt-1', (stats.avgDurationMs || 0) + ' ms'),
            ]),
          ]),

          // Navigation Tabs Switcher
          m('div.flex.border-b.border-gray-200.dark:border-slate-700', [
            m('button.px-5.py-2.5.text-sm.font-semibold.border-b-2.transition-colors.flex.items-center.gap-2', {
              class: activeTab === 'endpoints'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200',
              onclick: function() { activeTab = 'endpoints'; loadEndpoints(); },
            }, [
              m('span', 'Endpoints'),
              m('span.px-2.py-0.5.text-xs.rounded-full.bg-gray-100.dark:bg-slate-700.text-gray-700.dark:text-slate-300', totalEndpoints),
            ]),
            m('button.px-5.py-2.5.text-sm.font-semibold.border-b-2.transition-colors.flex.items-center.gap-2', {
              class: activeTab === 'deliveries'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200',
              onclick: function() { activeTab = 'deliveries'; loadDeliveries(); },
            }, [
              m('span', 'Delivery Audit Logs'),
              stats.failedDeliveries > 0 ? m('span.px-2.py-0.5.text-xs.rounded-full.bg-rose-100.text-rose-700.dark:bg-rose-950/50.dark:text-rose-300', stats.failedDeliveries + ' failed') : null,
            ]),
          ]),

          // TAB 1: ENDPOINTS LIST
          activeTab === 'endpoints' ? m('div.space-y-4', [
            // Filter & Search Bar
            m('div.flex.flex-col.sm:flex-row.gap-3.items-center.justify-between.bg-white.dark:bg-slate-800.p-3.rounded-xl.border.border-gray-200.dark:border-slate-700', [
              m('div.flex.items-center.gap-3.w-full.sm:w-auto', [
                m('input.px-3.py-1.5.text-xs.border.border-gray-200.dark:border-slate-700.rounded-lg.bg-transparent.text-gray-900.dark:text-white.w-56', {
                  placeholder: 'Search name or URL...',
                  value: searchEndpoints,
                  oninput: function(e) { searchEndpoints = e.target.value; },
                  onkeydown: function(e) { if (e.key === 'Enter') loadEndpoints(); },
                }),
                m('select.px-3.py-1.5.text-xs.border.border-gray-200.dark:border-slate-700.rounded-lg.bg-transparent.text-gray-900.dark:text-white', {
                  value: filterEndpointActive,
                  onchange: function(e) { filterEndpointActive = e.target.value; loadEndpoints(); },
                }, [
                  m('option', { value: '' }, 'All Statuses'),
                  m('option', { value: 'true' }, 'Active Only'),
                  m('option', { value: 'false' }, 'Inactive Only'),
                ]),
                m('button.px-3.py-1.5.text-xs.font-medium.rounded-lg.bg-gray-100.dark:bg-slate-700.text-gray-700.dark:text-slate-200.hover:bg-gray-200', {
                  onclick: function() { loadEndpoints(); },
                }, 'Search'),
              ]),
              m('div.text-xs.text-gray-500.dark:text-slate-400', endpoints.length + ' endpoints displayed'),
            ]),

            // Endpoints Table
            m('div.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.rounded-2xl.overflow-hidden.shadow-sm', [
              endpoints.length === 0 ? m('div.p-12.text-center.text-gray-500.dark:text-slate-400', [
                m('p.text-base.font-medium', 'No webhook endpoints found.'),
                m('p.text-xs.mt-1', 'Add a new endpoint above to start forwarding real-time events to external webhooks.'),
              ]) : m('div.overflow-x-auto', [
                m('table.w-full.text-left.text-sm', [
                  m('thead.bg-gray-50.dark:bg-slate-750.text-xs.uppercase.text-gray-500.dark:text-slate-400.border-b.border-gray-200.dark:border-slate-700', [
                    m('tr', [
                      m('th.p-4', 'Endpoint & Destination'),
                      m('th.p-4', 'Subscribed Events'),
                      m('th.p-4', 'Signing Secret'),
                      m('th.p-4', 'Status'),
                      m('th.p-4', 'Health'),
                      m('th.p-4.text-right', 'Actions'),
                    ]),
                  ]),
                  m('tbody.divide-y.divide-gray-100.dark:divide-slate-700', endpoints.map(function(ep) {
                    var evts = parseEvents(ep.events);
                    var epStats = ep.stats || { total: 0, successful: 0, successRate: 100 };
                    var isRevealed = !!revealedSecrets[ep.id];
                    var maskedSecret = ep.secret
                      ? (isRevealed ? ep.secret : (ep.secret.slice(0, 6) + '••••••••••••••••••••••••••••'))
                      : '—';

                    return m('tr.hover:bg-gray-50/60.dark:hover:bg-slate-750/50.transition-colors', [
                      // Name & URL
                      m('td.p-4', [
                        m('div.font-semibold.text-gray-900.dark:text-white.flex.items-center.gap-2', [
                          ep.name,
                          m('span.text-xs.font-normal.text-gray-400', '#' + ep.id),
                        ]),
                        m('div.text-xs.font-mono.text-indigo-600.dark:text-indigo-400.truncate.max-w-xs.mt-0.5', { title: ep.url }, ep.url),
                        ep.description ? m('div.text-xs.text-gray-400.mt-1', ep.description) : null,
                      ]),

                      // Events
                      m('td.p-4', [
                        m('div.flex.flex-wrap.gap-1.max-w-xs', evts.map(function(evt) {
                          return m('span.px-2.py-0.5.text-xs.font-mono.rounded-md.bg-gray-100.dark:bg-slate-700.text-gray-700.dark:text-slate-300', evt);
                        })),
                      ]),

                      // Secret with Reveal & Copy & Rotate
                      m('td.p-4', [
                        m('div.flex.items-center.gap-1.5', [
                          m('span.text-xs.font-mono.text-gray-600.dark:text-slate-300', maskedSecret),
                          ep.secret ? m('button.p-1.text-xs.text-gray-400.hover:text-gray-700.dark:hover:text-slate-200.rounded', {
                            title: isRevealed ? 'Hide secret' : 'Reveal secret',
                            onclick: function() { revealedSecrets[ep.id] = !isRevealed; },
                          }, isRevealed ? '🙈' : '👁️') : null,
                          ep.secret ? m('button.p-1.text-xs.text-gray-400.hover:text-gray-700.dark:hover:text-slate-200.rounded', {
                            title: 'Copy signing secret',
                            onclick: function() { copyToClipboard(ep.secret, 'Signing secret'); },
                          }, '📋') : null,
                          m('button.p-1.text-xs.text-indigo-600.hover:text-indigo-700.dark:text-indigo-400.rounded', {
                            title: 'Rotate secret',
                            onclick: function() { rotateSecret(ep); },
                          }, '🔄'),
                        ]),
                      ]),

                      // Status pill
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

                      // Health & stats
                      m('td.p-4', [
                        epStats.total > 0
                          ? m('div.text-xs', [
                              m('span.font-semibold', {
                                class: epStats.successRate >= 90 ? 'text-emerald-600' : 'text-rose-600'
                              }, epStats.successRate + '% '),
                              m('span.text-gray-400', '(' + epStats.successful + '/' + epStats.total + ')'),
                            ])
                          : m('span.text-xs.text-gray-400', 'No deliveries yet'),
                      ]),

                      // Actions
                      m('td.p-4.text-right', [
                        m('div.inline-flex.items-center.gap-1.5', [
                          m('button.px-2.5.py-1.text-xs.font-semibold.rounded-lg.bg-indigo-50.text-indigo-600.dark:bg-indigo-950/50.dark:text-indigo-300.hover:bg-indigo-100.transition-colors', {
                            onclick: function() { openTestModal(ep); },
                          }, '⚡ Test / Ping'),
                          m('button.px-2.5.py-1.text-xs.font-medium.rounded-lg.border.border-gray-200.dark:border-slate-700.text-gray-700.dark:text-slate-200.hover:bg-gray-100.dark:hover:bg-slate-700.transition-colors', {
                            onclick: function() { openEditModal(ep); },
                          }, 'Edit'),
                          m('button.px-2.5.py-1.text-xs.font-medium.rounded-lg.border.border-gray-200.dark:border-slate-700.text-rose-600.hover:bg-rose-50.dark:hover:bg-slate-700.transition-colors', {
                            onclick: function() { deleteEndpoint(ep); },
                          }, 'Delete'),
                        ]),
                      ]),
                    ]);
                  })),
                ]),
              ]),
            ]),
          ]) : null,

          // TAB 2: DELIVERIES AUDIT LOG
          activeTab === 'deliveries' ? m('div.space-y-4', [
            // Filter Bar
            m('div.flex.flex-col.sm:flex-row.gap-3.items-center.justify-between.bg-white.dark:bg-slate-800.p-3.rounded-xl.border.border-gray-200.dark:border-slate-700', [
              m('div.flex.flex-wrap.items-center.gap-2.5.w-full.sm:w-auto', [
                m('input.px-3.py-1.5.text-xs.border.border-gray-200.dark:border-slate-700.rounded-lg.bg-transparent.text-gray-900.dark:text-white.w-48', {
                  placeholder: 'Search event or payload...',
                  value: filterEvent,
                  oninput: function(e) { filterEvent = e.target.value; },
                  onkeydown: function(e) { if (e.key === 'Enter') { deliveryPage = 1; loadDeliveries(); } },
                }),
                m('select.px-3.py-1.5.text-xs.border.border-gray-200.dark:border-slate-700.rounded-lg.bg-transparent.text-gray-900.dark:text-white', {
                  value: filterSuccess,
                  onchange: function(e) { filterSuccess = e.target.value; deliveryPage = 1; loadDeliveries(); },
                }, [
                  m('option', { value: '' }, 'All Statuses'),
                  m('option', { value: 'true' }, 'Success (2xx)'),
                  m('option', { value: 'false' }, 'Failed'),
                ]),
                m('select.px-3.py-1.5.text-xs.border.border-gray-200.dark:border-slate-700.rounded-lg.bg-transparent.text-gray-900.dark:text-white', {
                  value: filterEndpointId,
                  onchange: function(e) { filterEndpointId = e.target.value; deliveryPage = 1; loadDeliveries(); },
                }, [
                  m('option', { value: '' }, 'All Endpoints'),
                  endpoints.map(function(ep) {
                    return m('option', { value: String(ep.id) }, ep.name + ' (#' + ep.id + ')');
                  }),
                ]),
                m('button.px-3.py-1.5.text-xs.font-medium.rounded-lg.bg-gray-100.dark:bg-slate-700.text-gray-700.dark:text-slate-200.hover:bg-gray-200', {
                  onclick: function() { deliveryPage = 1; loadDeliveries(); },
                }, 'Filter'),
              ]),
              m('div.flex.items-center.gap-3', [
                selectedCount > 0 ? m('button.px-3.py-1.5.text-xs.font-semibold.rounded-lg.bg-indigo-600.text-white.hover:bg-indigo-500.transition-colors.flex.items-center.gap-1.5', {
                  disabled: bulkRetrying,
                  onclick: bulkRetrySelected,
                }, [
                  bulkRetrying ? m('span.animate-spin', '⟳') : null,
                  'Retry Selected (' + selectedCount + ')',
                ]) : null,
                m('div.text-xs.text-gray-500.dark:text-slate-400', 'Total: ' + deliveryTotal + ' deliveries'),
              ]),
            ]),

            // Deliveries Table
            m('div.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.rounded-2xl.overflow-hidden.shadow-sm', [
              deliveries.length === 0 ? m('div.p-12.text-center.text-gray-500.dark:text-slate-400', [
                m('p.text-base.font-medium', 'No delivery records found.'),
                m('p.text-xs.mt-1', 'Deliveries will appear here automatically when events are triggered or test pings sent.'),
              ]) : m('div.overflow-x-auto', [
                m('table.w-full.text-left.text-sm', [
                  m('thead.bg-gray-50.dark:bg-slate-750.text-xs.uppercase.text-gray-500.dark:text-slate-400.border-b.border-gray-200.dark:border-slate-700', [
                    m('tr', [
                      m('th.p-4.w-8', [
                        m('input[type=checkbox]', {
                          checked: allSelected,
                          onchange: function(e) { toggleSelectAllDeliveries(e.target.checked); },
                        }),
                      ]),
                      m('th.p-4', 'Status'),
                      m('th.p-4', 'Event Name'),
                      m('th.p-4', 'Target Endpoint'),
                      m('th.p-4', 'Duration'),
                      m('th.p-4', 'Attempt'),
                      m('th.p-4', 'Dispatched At'),
                      m('th.p-4.text-right', 'Actions'),
                    ]),
                  ]),
                  m('tbody.divide-y.divide-gray-100.dark:divide-slate-700', deliveries.map(function(dlv) {
                    var isSuccess = dlv.success;
                    var badgeClass = isSuccess
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300';
                    var statusLabel = dlv.status_code ? 'HTTP ' + dlv.status_code : (isSuccess ? '200 OK' : 'Failed');
                    var isSelected = !!selectedDeliveryIds[dlv.id];

                    return m('tr.hover:bg-gray-50/60.dark:hover:bg-slate-750/50.transition-colors', {
                      class: isSelected ? 'bg-indigo-50/30 dark:bg-indigo-950/20' : '',
                    }, [
                      m('td.p-4', [
                        m('input[type=checkbox]', {
                          checked: isSelected,
                          onchange: function(e) { selectedDeliveryIds[dlv.id] = e.target.checked; },
                        }),
                      ]),
                      m('td.p-4', [
                        m('span.inline-flex.items-center.px-2.5.py-0.5.rounded-full.text-xs.font-semibold.border', {
                          class: badgeClass,
                        }, statusLabel),
                      ]),
                      m('td.p-4', [
                        m('span.font-mono.font-semibold.text-gray-900.dark:text-white', dlv.event),
                        m('div.text-xs.font-mono.text-gray-400', 'ID: #' + dlv.id),
                      ]),
                      m('td.p-4', [
                        m('div.text-xs.font-medium.text-gray-800.dark:text-slate-200', 'Endpoint #' + dlv.endpoint_id),
                      ]),
                      m('td.p-4.text-xs.text-gray-600.dark:text-slate-300', (dlv.duration_ms != null ? dlv.duration_ms + ' ms' : '—')),
                      m('td.p-4.text-xs.text-gray-600.dark:text-slate-300', dlv.attempt + ' / ' + dlv.max_attempts),
                      m('td.p-4.text-xs.text-gray-500.dark:text-slate-400', formatRelativeTime(dlv.created_at)),
                      m('td.p-4.text-right', [
                        m('div.inline-flex.items-center.gap-1.5', [
                          m('button.px-2.5.py-1.text-xs.font-medium.rounded-lg.border.border-gray-200.dark:border-slate-700.text-indigo-600.dark:text-indigo-400.hover:bg-indigo-50.dark:hover:bg-slate-700', {
                            onclick: function() { activeDeliveryModal = dlv; replayEditMode = false; },
                          }, 'Inspect'),
                          m('button.px-2.5.py-1.text-xs.font-medium.rounded-lg.bg-gray-100.dark:bg-slate-700.text-gray-700.dark:text-slate-200.hover:bg-gray-200', {
                            onclick: function() { retryDelivery(dlv); },
                          }, 'Retry'),
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

          // MODAL 1: INTERACTIVE PAYLOAD & PING TESTER
          showTestModal && testEndpointTarget ? m('div.fixed.inset-0.z-50.flex.items-center.justify-center.p-4.bg-black/50.backdrop-blur-sm', [
            m('div.bg-white.dark:bg-slate-800.rounded-2xl.border.border-gray-200.dark:border-slate-700.shadow-2xl.w-full.max-w-2xl.max-h-[92vh].flex.flex-col.overflow-hidden', [
              m('div.p-5.border-b.border-gray-200.dark:border-slate-700.flex.items-center.justify-between', [
                m('div', [
                  m('h3.text-base.font-bold.text-gray-900.dark:text-white', 'Live Webhook Tester'),
                  m('p.text-xs.text-indigo-600.dark:text-indigo-400.font-mono.mt-0.5', testEndpointTarget.name + ' (' + testEndpointTarget.url + ')'),
                ]),
                m('button.text-gray-400.hover:text-gray-600.dark:hover:text-white', {
                  onclick: function() { showTestModal = false; },
                }, '✕'),
              ]),
              m('div.p-5.space-y-4.overflow-y-auto.flex-1', [
                // Preset Event Selector
                m('div', [
                  m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1.5', 'Select Event Preset:'),
                  m('div.grid.grid-cols-2.sm:grid-cols-3.gap-2', Object.keys(EVENT_PRESETS).map(function(key) {
                    var preset = EVENT_PRESETS[key];
                    var isSelected = testEvent === key;
                    return m('button.px-3.py-2.text-xs.font-medium.rounded-xl.border.text-left.transition-all', {
                      class: isSelected
                        ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/40 dark:text-indigo-300'
                        : 'border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-750',
                      onclick: function() { setEventPreset(key); },
                    }, preset.label);
                  })),
                ]),

                // Custom Event Name (if custom)
                m('div', [
                  m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1', 'Event Name (X-Webspresso-Event)'),
                  m('input.w-full.px-3.py-2.text-xs.font-mono.border.border-gray-300.dark:border-slate-600.rounded-xl.bg-transparent.text-gray-900.dark:text-white', {
                    value: testEvent,
                    oninput: function(e) { testEvent = e.target.value; },
                  }),
                ]),

                // Payload JSON Editor
                m('div', [
                  m('div.flex.items-center.justify-between.mb-1', [
                    m('label.text-xs.font-semibold.text-gray-700.dark:text-slate-300', 'Request Payload (JSON)'),
                    m('button.text-xs.text-indigo-600.dark:text-indigo-400.hover:underline', {
                      onclick: function() {
                        try {
                          testPayloadStr = JSON.stringify(JSON.parse(testPayloadStr), null, 2);
                        } catch (e) {
                          alert('Syntax Error: ' + e.message);
                        }
                      },
                    }, 'Prettify JSON'),
                  ]),
                  m('textarea.w-full.h-36.p-3.font-mono.text-xs.border.border-gray-300.dark:border-slate-600.rounded-xl.bg-slate-900.text-slate-100.focus:outline-none', {
                    value: testPayloadStr,
                    oninput: function(e) { testPayloadStr = e.target.value; },
                  }),
                ]),

                // Live Result Box
                testResult ? m('div.p-4.rounded-xl.border', {
                  class: testResult.success
                    ? 'bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800'
                    : 'bg-rose-50/50 border-rose-200 dark:bg-rose-950/20 dark:border-rose-800'
                }, [
                  m('div.flex.items-center.justify-between.mb-2', [
                    m('div.flex.items-center.gap-2', [
                      m('span.text-xs.font-bold.px-2.py-0.5.rounded-md', {
                        class: testResult.success ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                      }, testResult.statusCode ? 'HTTP ' + testResult.statusCode : (testResult.success ? '200 OK' : 'FAILED')),
                      m('span.text-xs.font-semibold.text-gray-700.dark:text-slate-200', '⏱️ ' + (testResult.durationMs || 0) + ' ms'),
                    ]),
                    m('span.text-xs.text-gray-500', 'Delivery ID: #' + (testResult.deliveryId || '—')),
                  ]),
                  testResult.error ? m('div.text-xs.text-rose-600.dark:text-rose-400.font-medium.mb-2', testResult.error) : null,
                  testResult.responseBody ? m('div', [
                    m('div.text-xs.font-semibold.text-gray-600.dark:text-slate-400.mb-1', 'Server Response Body:'),
                    m('pre.p-2.rounded-lg.bg-slate-900.text-slate-100.text-xs.font-mono.overflow-x-auto.max-h-28', testResult.responseBody),
                  ]) : null,
                ]) : null,
              ]),
              m('div.p-4.border-t.border-gray-200.dark:border-slate-700.flex.items-center.justify-end.gap-3', [
                m('button.px-4.py-2.text-xs.font-medium.rounded-xl.border.border-gray-300.dark:border-slate-600.text-gray-700.dark:text-slate-200', {
                  onclick: function() { showTestModal = false; },
                }, 'Close'),
                m('button.px-4.py-2.text-xs.font-semibold.rounded-xl.bg-indigo-600.text-white.hover:bg-indigo-500.flex.items-center.gap-2', {
                  disabled: testInProgress,
                  onclick: runWebhookTest,
                }, [
                  testInProgress ? m('span.animate-spin', '⟳') : m('span', '⚡'),
                  testInProgress ? 'Dispatching...' : 'Send Webhook Test',
                ]),
              ]),
            ]),
          ]) : null,

          // MODAL 2: CREATE / EDIT ENDPOINT
          showEndpointModal ? m('div.fixed.inset-0.z-50.flex.items-center.justify-center.p-4.bg-black/50.backdrop-blur-sm', [
            m('div.bg-white.dark:bg-slate-800.rounded-2xl.border.border-gray-200.dark:border-slate-700.shadow-2xl.w-full.max-w-lg.p-6.space-y-4', [
              m('div.flex.items-center.justify-between', [
                m('h3.text-lg.font-bold.text-gray-900.dark:text-white', editingEndpoint ? 'Edit Webhook Endpoint' : 'New Webhook Endpoint'),
                m('button.text-gray-400.hover:text-gray-600.dark:hover:text-white', {
                  onclick: function() { showEndpointModal = false; },
                }, '✕'),
              ]),
              m('div.space-y-3', [
                m('div', [
                  m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1', 'Name / Identifier *'),
                  m('input.w-full.px-3.py-2.text-sm.border.border-gray-300.dark:border-slate-600.rounded-xl.bg-transparent.text-gray-900.dark:text-white', {
                    placeholder: 'e.g. Stripe Order Webhook',
                    value: endpointForm.name,
                    oninput: function(e) { endpointForm.name = e.target.value; },
                  }),
                ]),
                m('div', [
                  m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1', 'Destination URL *'),
                  m('input.w-full.px-3.py-2.text-sm.border.border-gray-300.dark:border-slate-600.rounded-xl.bg-transparent.text-gray-900.dark:text-white', {
                    placeholder: 'https://example.com/api/webhook',
                    value: endpointForm.url,
                    oninput: function(e) { endpointForm.url = e.target.value; },
                  }),
                ]),
                m('div', [
                  m('div.flex.items-center.justify-between.mb-1', [
                    m('label.text-xs.font-semibold.text-gray-700.dark:text-slate-300', 'HMAC Signing Secret'),
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
                  m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1', 'Subscribed Events (Comma-separated or * for wildcard)'),
                  m('input.w-full.px-3.py-2.text-sm.border.border-gray-300.dark:border-slate-600.rounded-xl.bg-transparent.text-gray-900.dark:text-white', {
                    placeholder: 'order.*, user.registered, ping',
                    value: endpointForm.events,
                    oninput: function(e) { endpointForm.events = e.target.value; },
                  }),
                ]),
                m('div', [
                  m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1', 'Description (Optional)'),
                  m('input.w-full.px-3.py-2.text-sm.border.border-gray-300.dark:border-slate-600.rounded-xl.bg-transparent.text-gray-900.dark:text-white', {
                    placeholder: 'Target external service notes...',
                    value: endpointForm.description,
                    oninput: function(e) { endpointForm.description = e.target.value; },
                  }),
                ]),
                m('div.flex.items-center.gap-2.pt-1', [
                  m('input[type=checkbox]', {
                    id: 'active_check',
                    checked: endpointForm.is_active,
                    onchange: function(e) { endpointForm.is_active = e.target.checked; },
                  }),
                  m('label.text-xs.font-medium.text-gray-700.dark:text-slate-300', { for: 'active_check' }, 'Enable this endpoint to actively receive matching events'),
                ]),
              ]),
              m('div.flex.items-center.justify-end.gap-3.pt-3.border-t.border-gray-100.dark:border-slate-700', [
                m('button.px-4.py-2.text-xs.font-medium.rounded-xl.border.border-gray-300.dark:border-slate-600.text-gray-700.dark:text-slate-200', {
                  onclick: function() { showEndpointModal = false; },
                }, 'Cancel'),
                m('button.px-4.py-2.text-xs.font-semibold.rounded-xl.bg-indigo-600.text-white.hover:bg-indigo-500', {
                  onclick: saveEndpoint,
                }, editingEndpoint ? 'Update Endpoint' : 'Create Endpoint'),
              ]),
            ]),
          ]) : null,

          // MODAL 3: DELIVERY DETAILS & REPLAY
          activeDeliveryModal ? m('div.fixed.inset-0.z-50.flex.items-center.justify-center.p-4.bg-black/50.backdrop-blur-sm', [
            m('div.bg-white.dark:bg-slate-800.rounded-2xl.border.border-gray-200.dark:border-slate-700.shadow-2xl.w-full.max-w-2xl.max-h-[92vh].flex.flex-col.overflow-hidden', [
              m('div.p-5.border-b.border-gray-200.dark:border-slate-700.flex.items-center.justify-between', [
                m('div', [
                  m('h3.text-base.font-bold.text-gray-900.dark:text-white', 'Delivery Inspection #' + activeDeliveryModal.id),
                  m('span.text-xs.text-gray-500.dark:text-slate-400', activeDeliveryModal.event + ' — ' + formatRelativeTime(activeDeliveryModal.created_at)),
                ]),
                m('button.text-gray-400.hover:text-gray-600.dark:hover:text-white', {
                  onclick: function() { activeDeliveryModal = null; replayEditMode = false; },
                }, '✕'),
              ]),
              m('div.p-5.space-y-4.overflow-y-auto.flex-1', [
                m('div.grid.grid-cols-2.sm:grid-cols-4.gap-2.text-xs.p-3.bg-gray-50.dark:bg-slate-750.rounded-xl', [
                  m('div', [
                    m('span.text-gray-400.block', 'Status'),
                    m('span.font-semibold', {
                      class: activeDeliveryModal.success ? 'text-emerald-600' : 'text-rose-600'
                    }, activeDeliveryModal.success ? '200 OK' : ('HTTP ' + (activeDeliveryModal.status_code || 'Error'))),
                  ]),
                  m('div', [m('span.text-gray-400.block', 'Latency'), m('span.font-semibold', (activeDeliveryModal.duration_ms || 0) + ' ms')]),
                  m('div', [m('span.text-gray-400.block', 'Attempt'), m('span.font-semibold', activeDeliveryModal.attempt + ' / ' + activeDeliveryModal.max_attempts)]),
                  m('div', [m('span.text-gray-400.block', 'Endpoint ID'), m('span.font-semibold', '#' + activeDeliveryModal.endpoint_id)]),
                  activeDeliveryModal.error ? m('div.col-span-2.sm:col-span-4.mt-1', [
                    m('span.text-gray-400.block', 'Error Message'),
                    m('span.text-rose-600.font-medium', activeDeliveryModal.error),
                  ]) : null,
                ]),

                // Payload JSON
                m('div', [
                  m('div.flex.items-center.justify-between.mb-1', [
                    m('label.text-xs.font-semibold.text-gray-700.dark:text-slate-300', 'Dispatched Payload (JSON)'),
                    m('button.text-xs.text-indigo-600.dark:text-indigo-400.hover:underline', {
                      onclick: function() {
                        replayEditMode = !replayEditMode;
                        if (replayEditMode) {
                          try {
                            replayPayloadStr = JSON.stringify(JSON.parse(activeDeliveryModal.payload), null, 2);
                          } catch (e) {
                            replayPayloadStr = activeDeliveryModal.payload || '';
                          }
                        }
                      },
                    }, replayEditMode ? 'Cancel Edit' : 'Edit Payload for Replay'),
                  ]),
                  replayEditMode ? m('textarea.w-full.h-36.p-3.font-mono.text-xs.border.border-gray-300.dark:border-slate-600.rounded-xl.bg-slate-900.text-slate-100', {
                    value: replayPayloadStr,
                    oninput: function(e) { replayPayloadStr = e.target.value; },
                  }) : m('pre.p-3.rounded-xl.bg-slate-900.text-slate-100.text-xs.font-mono.overflow-x-auto.max-h-56',
                    (function() {
                      try {
                        return JSON.stringify(JSON.parse(activeDeliveryModal.payload), null, 2);
                      } catch (e) {
                        return activeDeliveryModal.payload || '';
                      }
                    })()
                  ),
                ]),

                // Response body
                activeDeliveryModal.response_body ? m('div', [
                  m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1', 'Target Server Response Body'),
                  m('pre.p-3.rounded-xl.bg-slate-900.text-slate-100.text-xs.font-mono.overflow-x-auto.max-h-36',
                    activeDeliveryModal.response_body
                  ),
                ]) : null,
              ]),
              m('div.p-4.border-t.border-gray-200.dark:border-slate-700.flex.items-center.justify-between', [
                m('button.px-4.py-2.text-xs.font-semibold.rounded-xl.bg-indigo-600.text-white.hover:bg-indigo-500.flex.items-center.gap-1.5', {
                  onclick: replayActiveDelivery,
                }, [
                  m('span', '⟳'),
                  replayEditMode ? 'Replay with Edited Payload' : 'Replay Delivery Now',
                ]),
                m('button.px-4.py-2.text-xs.font-medium.rounded-xl.border.border-gray-300.dark:border-slate-600.text-gray-700.dark:text-slate-200', {
                  onclick: function() { activeDeliveryModal = null; replayEditMode = false; },
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

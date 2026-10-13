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

      if (diffSec < 60) return 'Az önce';
      if (diffMin < 60) return diffMin + ' dk önce';
      if (diffHour < 24) return diffHour + ' sa önce';
      if (diffDay === 1) return 'Dün';
      if (diffDay < 30) return diffDay + ' gün önce';
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
        error = (err.response && err.response.error) || err.message || 'Uç noktalar yüklenemedi.';
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
        error = (err.response && err.response.error) || err.message || 'Teslimat kayıtları yüklenemedi.';
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
        setToast(isEdit ? 'Uç nokta güncellendi.' : 'Yeni uç nokta oluşturuldu.');
        loadEndpoints();
      }).catch(function(err) {
        alert((err.response && err.response.error) || err.message || 'Kayıt başarısız.');
      });
    }

    function deleteEndpoint(ep) {
      if (!confirm('\"' + ep.name + '\" uç noktasını silmek istediğinize emin misiniz?')) {
        return;
      }
      m.request({
        method: 'DELETE',
        url: API + '/endpoints/' + ep.id,
      }).then(function() {
        setToast('Uç nokta silindi.');
        loadEndpoints();
      }).catch(function(err) {
        alert((err.response && err.response.error) || err.message || 'Silme işlemi başarısız.');
      });
    }

    function pingEndpoint(ep) {
      setToast('\"' + ep.name + '\" adresine ping gönderiliyor...');
      m.request({
        method: 'POST',
        url: API + '/endpoints/' + ep.id + '/ping',
      }).then(function(res) {
        if (res.success) {
          setToast('Ping başarılı! Yanıt kodu: ' + res.statusCode + ' (' + (res.durationMs || 0) + 'ms)');
        } else {
          alert('Ping başarısız oldu: ' + (res.error || ('HTTP ' + res.statusCode)));
        }
        if (activeTab === 'deliveries') loadDeliveries();
      }).catch(function(err) {
        alert('Ping isteği gönderilemedi: ' + (err.message || 'Ağ hatası'));
      });
    }

    function retryDelivery(dlv) {
      setToast('Teslimat #' + dlv.id + ' yeniden deneniyor...');
      m.request({
        method: 'POST',
        url: API + '/deliveries/' + dlv.id + '/retry',
      }).then(function(res) {
        if (res.success) {
          setToast('Yeniden deneme başarılı! (' + res.statusCode + ')');
        } else {
          alert('Yeniden deneme başarısız: ' + (res.error || ('HTTP ' + res.statusCode)));
        }
        loadDeliveries();
      }).catch(function(err) {
        alert('Yeniden deneme isteği gönderilemedi: ' + err.message);
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
                'Harici sistemlere HMAC-SHA256 imzalı güvenli olay bildirimleri ve teslimat yönetimi'
              ),
            ]),
            m('div.flex.items-center.gap-3', [
              m('button.inline-flex.items-center.gap-2.px-4.py-2.text-sm.font-semibold.rounded-xl.bg-indigo-600.text-white.hover:bg-indigo-500.shadow-sm.transition-all', {
                onclick: openNewModal,
              }, [
                m('span', '+'),
                m('span', 'Yeni Uç Nokta Ekle'),
              ]),
            ]),
          ]),

          // Stats Bar
          m('div.grid.grid-cols-2.sm:grid-cols-4.gap-4', [
            m('div.p-4.rounded-2xl.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.shadow-sm', [
              m('div.text-xs.font-medium.text-gray-500.dark:text-slate-400', 'Kayıtlı Uç Nokta'),
              m('div.text-2xl.font-bold.text-gray-900.dark:text-white.mt-1', totalEndpoints),
            ]),
            m('div.p-4.rounded-2xl.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.shadow-sm', [
              m('div.text-xs.font-medium.text-gray-500.dark:text-slate-400', 'Aktif Uç Nokta'),
              m('div.text-2xl.font-bold.text-emerald-600.dark:text-emerald-400.mt-1', activeEndpoints),
            ]),
            m('div.p-4.rounded-2xl.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.shadow-sm', [
              m('div.text-xs.font-medium.text-gray-500.dark:text-slate-400', 'Teslimat Sayısı'),
              m('div.text-2xl.font-bold.text-indigo-600.dark:text-indigo-400.mt-1', deliveryTotal || '—'),
            ]),
            m('div.p-4.rounded-2xl.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.shadow-sm', [
              m('div.text-xs.font-medium.text-gray-500.dark:text-slate-400', 'İmza Standardı'),
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
            }, 'Uç Noktalar (' + totalEndpoints + ')'),
            m('button.px-5.py-2.5.text-sm.font-medium.border-b-2.transition-colors', {
              class: activeTab === 'deliveries'
                ? 'border-indigo-600.text-indigo-600.dark:text-indigo-400.dark:border-indigo-400'
                : 'border-transparent.text-gray-500.hover:text-gray-700.dark:text-slate-400.dark:hover:text-slate-200',
              onclick: function() { activeTab = 'deliveries'; loadDeliveries(); },
            }, 'Teslimat Geçmişi'),
          ]),

          // TAB 1: ENDPOINTS LIST
          activeTab === 'endpoints' ? m('div.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.rounded-2xl.overflow-hidden.shadow-sm', [
            endpoints.length === 0 ? m('div.p-12.text-center.text-gray-500.dark:text-slate-400', [
              m('p.text-base.font-medium', 'Henüz kayıtlı bir webhook uç noktası bulunmuyor.'),
              m('p.text-xs.mt-1', 'Sistem olaylarını Zapier, Slack veya kendi sunucunuza iletmek için yukarıdan yeni uç nokta ekleyin.'),
            ]) : m('div.overflow-x-auto', [
              m('table.w-full.text-left.text-sm', [
                m('thead.bg-gray-50.dark:bg-slate-750.text-xs.uppercase.text-gray-500.dark:text-slate-400.border-b.border-gray-200.dark:border-slate-700', [
                  m('tr', [
                    m('th.p-4', 'İsim & Hedef URL'),
                    m('th.p-4', 'Abone Olaylar'),
                    m('th.p-4', 'Durum'),
                    m('th.p-4', 'Başarı Oranı'),
                    m('th.p-4.text-right', 'İşlemler'),
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
                            'Aktif'
                          ])
                        : m('span.inline-flex.items-center.gap-1.5.px-2.5.py-1.rounded-full.text-xs.font-medium.bg-gray-100.text-gray-600.dark:bg-slate-700.dark:text-slate-400', [
                            m('span.w-1.5.h-1.5.rounded-full.bg-gray-400'),
                            'Pasif'
                          ]),
                    ]),
                    m('td.p-4', [
                      stats.total > 0
                        ? m('div.text-xs', [
                            m('span.font-medium', stats.successRate + '% '),
                            m('span.text-gray-400', '(' + stats.successful + '/' + stats.total + ')'),
                          ])
                        : m('span.text-xs.text-gray-400', 'Teslimat yok'),
                    ]),
                    m('td.p-4.text-right', [
                      m('div.inline-flex.items-center.gap-2', [
                        m('button.px-2.5.py-1.text-xs.font-medium.rounded-lg.border.border-gray-200.dark:border-slate-700.text-gray-700.dark:text-slate-200.hover:bg-gray-100.dark:hover:bg-slate-700.transition-colors', {
                          onclick: function() { pingEndpoint(ep); },
                        }, '⚡ Ping'),
                        m('button.px-2.5.py-1.text-xs.font-medium.rounded-lg.border.border-gray-200.dark:border-slate-700.text-indigo-600.dark:text-indigo-400.hover:bg-indigo-50.dark:hover:bg-slate-700.transition-colors', {
                          onclick: function() { openEditModal(ep); },
                        }, 'Düzenle'),
                        m('button.px-2.5.py-1.text-xs.font-medium.rounded-lg.border.border-gray-200.dark:border-slate-700.text-red-600.hover:bg-red-50.dark:hover:bg-slate-700.transition-colors', {
                          onclick: function() { deleteEndpoint(ep); },
                        }, 'Sil'),
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
                  placeholder: 'Olay filtresi (örn: user.*)',
                  value: filterEvent,
                  oninput: function(e) { filterEvent = e.target.value; },
                }),
                m('select.px-3.py-1.5.text-xs.border.border-gray-200.dark:border-slate-700.rounded-lg.bg-transparent.text-gray-900.dark:text-white', {
                  value: filterSuccess,
                  onchange: function(e) { filterSuccess = e.target.value; },
                }, [
                  m('option', { value: '' }, 'Tüm Durumlar'),
                  m('option', { value: 'true' }, 'Yalnızca Başarılı'),
                  m('option', { value: 'false' }, 'Yalnızca Başarısız'),
                ]),
                m('button.px-3.py-1.5.text-xs.font-medium.rounded-lg.bg-gray-100.dark:bg-slate-700.text-gray-700.dark:text-slate-200.hover:bg-gray-200', {
                  onclick: function() { deliveryPage = 1; loadDeliveries(); },
                }, 'Filtrele'),
              ]),
              m('div.text-xs.text-gray-500.dark:text-slate-400', 'Toplam: ' + deliveryTotal + ' kayıt'),
            ]),

            // Deliveries Table
            m('div.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.rounded-2xl.overflow-hidden.shadow-sm', [
              deliveries.length === 0 ? m('div.p-12.text-center.text-gray-500.dark:text-slate-400', [
                m('p.text-base.font-medium', 'Henüz teslimat kaydı bulunamadı.'),
              ]) : m('div.overflow-x-auto', [
                m('table.w-full.text-left.text-sm', [
                  m('thead.bg-gray-50.dark:bg-slate-750.text-xs.uppercase.text-gray-500.dark:text-slate-400.border-b.border-gray-200.dark:border-slate-700', [
                    m('tr', [
                      m('th.p-4', 'Durum'),
                      m('th.p-4', 'Olay'),
                      m('th.p-4', 'Süre'),
                      m('th.p-4', 'Deneme'),
                      m('th.p-4', 'Zaman'),
                      m('th.p-4.text-right', 'İşlemler'),
                    ]),
                  ]),
                  m('tbody.divide-y.divide-gray-100.dark:divide-slate-700', deliveries.map(function(dlv) {
                    var isSuccess = dlv.success;
                    var badgeClass = isSuccess
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300';
                    var statusLabel = dlv.status_code ? 'HTTP ' + dlv.status_code : (isSuccess ? '200 OK' : 'Hata');

                    return m('tr.hover:bg-gray-50/60.dark:hover:bg-slate-750/50.transition-colors', [
                      m('td.p-4', [
                        m('span.inline-flex.items-center.px-2.5.py-0.5.rounded-full.text-xs.font-semibold.border', {
                          class: badgeClass,
                        }, statusLabel),
                      ]),
                      m('td.p-4', [
                        m('span.font-mono.font-semibold.text-gray-900.dark:text-white', dlv.event),
                        m('div.text-xs.text-gray-400', 'Uç Nokta #' + dlv.endpoint_id),
                      ]),
                      m('td.p-4.text-xs.text-gray-600.dark:text-slate-300', (dlv.duration_ms != null ? dlv.duration_ms + ' ms' : '—')),
                      m('td.p-4.text-xs.text-gray-600.dark:text-slate-300', dlv.attempt + ' / ' + dlv.max_attempts),
                      m('td.p-4.text-xs.text-gray-500.dark:text-slate-400', formatRelativeTime(dlv.created_at)),
                      m('td.p-4.text-right', [
                        m('div.inline-flex.items-center.gap-2', [
                          m('button.px-2.5.py-1.text-xs.font-medium.rounded-lg.border.border-gray-200.dark:border-slate-700.text-indigo-600.hover:bg-indigo-50.dark:hover:bg-slate-700', {
                            onclick: function() { activeDeliveryModal = dlv; },
                          }, 'Detay'),
                          !isSuccess ? m('button.px-2.5.py-1.text-xs.font-medium.rounded-lg.bg-indigo-50.text-indigo-600.dark:bg-indigo-950/50.dark:text-indigo-300.hover:bg-indigo-100', {
                            onclick: function() { retryDelivery(dlv); },
                          }, 'Yeniden Dene') : null,
                        ]),
                      ]),
                    ]);
                  })),
                ]),
              ]),

              // Pagination Bar
              m('div.flex.items-center.justify-between.p-4.border-t.border-gray-100.dark:border-slate-700', [
                m('div.text-xs.text-gray-500', deliveryTotal + ' kayıt listelendi'),
                m('div.flex.items-center.gap-2', [
                  m('button.px-3.py-1.text-xs.border.rounded-lg.disabled:opacity-40', {
                    disabled: deliveryPage <= 1,
                    onclick: function() { if (deliveryPage > 1) { deliveryPage--; loadDeliveries(); } },
                  }, 'Önceki'),
                  m('span.text-xs.text-gray-600.dark:text-slate-300', deliveryPage + ' / ' + deliveryPages),
                  m('button.px-3.py-1.text-xs.border.rounded-lg.disabled:opacity-40', {
                    disabled: deliveryPage >= deliveryPages,
                    onclick: function() { if (deliveryPage < deliveryPages) { deliveryPage++; loadDeliveries(); } },
                  }, 'Sonraki'),
                ]),
              ]),
            ]),
          ]) : null,

          // MODAL: CREATE / EDIT ENDPOINT
          showEndpointModal ? m('div.fixed.inset-0.z-50.flex.items-center.justify-center.p-4.bg-black/50.backdrop-blur-sm', [
            m('div.bg-white.dark:bg-slate-800.rounded-2xl.border.border-gray-200.dark:border-slate-700.shadow-2xl.w-full.max-w-lg.p-6.space-y-4', [
              m('div.flex.items-center.justify-between', [
                m('h3.text-lg.font-bold.text-gray-900.dark:text-white', editingEndpoint ? 'Uç Noktayı Düzenle' : 'Yeni Webhook Uç Noktası'),
                m('button.text-gray-400.hover:text-gray-600.dark:hover:text-white', {
                  onclick: function() { showEndpointModal = false; },
                }, '✕'),
              ]),
              m('div.space-y-3', [
                m('div', [
                  m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1', 'İsim / Tanım *'),
                  m('input.w-full.px-3.py-2.text-sm.border.border-gray-300.dark:border-slate-600.rounded-xl.bg-transparent.text-gray-900.dark:text-white', {
                    placeholder: 'Örn: Zapier Sipariş Takibi',
                    value: endpointForm.name,
                    oninput: function(e) { endpointForm.name = e.target.value; },
                  }),
                ]),
                m('div', [
                  m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1', 'Hedef URL *'),
                  m('input.w-full.px-3.py-2.text-sm.border.border-gray-300.dark:border-slate-600.rounded-xl.bg-transparent.text-gray-900.dark:text-white', {
                    placeholder: 'https://example.com/api/webhook',
                    value: endpointForm.url,
                    oninput: function(e) { endpointForm.url = e.target.value; },
                  }),
                ]),
                m('div', [
                  m('div.flex.items-center.justify-between.mb-1', [
                    m('label.text-xs.font-semibold.text-gray-700.dark:text-slate-300', 'İmzalama Gizli Anahtarı (Secret)'),
                    m('button.text-xs.text-indigo-600.dark:text-indigo-400.hover:underline', {
                      type: 'button',
                      onclick: function() { endpointForm.secret = generateRandomSecret(); },
                    }, 'Yeni Üret'),
                  ]),
                  m('input.w-full.px-3.py-2.text-xs.font-mono.border.border-gray-300.dark:border-slate-600.rounded-xl.bg-transparent.text-gray-900.dark:text-white', {
                    value: endpointForm.secret,
                    oninput: function(e) { endpointForm.secret = e.target.value; },
                  }),
                ]),
                m('div', [
                  m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1', 'Abone Olaylar (Virgülle ayırın, * tüm olaylar)'),
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
                  m('label.text-xs.font-medium.text-gray-700.dark:text-slate-300', { for: 'active_check' }, 'Bu uç nokta aktif olsun ve olayları alsın'),
                ]),
              ]),
              m('div.flex.items-center.justify-end.gap-3.pt-3.border-t.border-gray-100.dark:border-slate-700', [
                m('button.px-4.py-2.text-xs.font-medium.rounded-xl.border.border-gray-300.dark:border-slate-600.text-gray-700.dark:text-slate-200', {
                  onclick: function() { showEndpointModal = false; },
                }, 'İptal'),
                m('button.px-4.py-2.text-xs.font-semibold.rounded-xl.bg-indigo-600.text-white.hover:bg-indigo-500', {
                  onclick: saveEndpoint,
                }, editingEndpoint ? 'Güncelle' : 'Kaydet'),
              ]),
            ]),
          ]) : null,

          // MODAL: DELIVERY DETAILS
          activeDeliveryModal ? m('div.fixed.inset-0.z-50.flex.items-center.justify-center.p-4.bg-black/50.backdrop-blur-sm', [
            m('div.bg-white.dark:bg-slate-800.rounded-2xl.border.border-gray-200.dark:border-slate-700.shadow-2xl.w-full.max-w-2xl.max-h-[90vh].flex.flex-col.overflow-hidden', [
              m('div.p-5.border-b.border-gray-200.dark:border-slate-700.flex.items-center.justify-between', [
                m('div', [
                  m('h3.text-base.font-bold.text-gray-900.dark:text-white', 'Teslimat Detayı #' + activeDeliveryModal.id),
                  m('span.text-xs.text-gray-500.dark:text-slate-400', activeDeliveryModal.event + ' — ' + formatRelativeTime(activeDeliveryModal.created_at)),
                ]),
                m('button.text-gray-400.hover:text-gray-600.dark:hover:text-white', {
                  onclick: function() { activeDeliveryModal = null; },
                }, '✕'),
              ]),
              m('div.p-5.space-y-4.overflow-y-auto.flex-1', [
                m('div.grid.grid-cols-2.sm:grid-cols-3.gap-2.text-xs.p-3.bg-gray-50.dark:bg-slate-750.rounded-xl', [
                  m('div', [m('span.text-gray-400.block', 'Durum'), m('span.font-semibold', activeDeliveryModal.success ? 'Başarılı' : 'Başarısız')]),
                  m('div', [m('span.text-gray-400.block', 'HTTP Kodu'), m('span.font-semibold', activeDeliveryModal.status_code || '—')]),
                  m('div', [m('span.text-gray-400.block', 'Yanıt Süresi'), m('span.font-semibold', (activeDeliveryModal.duration_ms || 0) + ' ms')]),
                  m('div', [m('span.text-gray-400.block', 'Deneme'), m('span.font-semibold', activeDeliveryModal.attempt + ' / ' + activeDeliveryModal.max_attempts)]),
                  m('div.col-span-2', [m('span.text-gray-400.block', 'Hata'), m('span.text-red-500', activeDeliveryModal.error || 'Yok')]),
                ]),
                m('div', [
                  m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1', 'İstek Payload Verisi (JSON)'),
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
                  m('label.block.text-xs.font-semibold.text-gray-700.dark:text-slate-300.mb-1', 'Hedef Sunucu Yanıtı (Body)'),
                  m('pre.p-3.rounded-xl.bg-slate-900.text-slate-100.text-xs.font-mono.overflow-x-auto.max-h-40',
                    activeDeliveryModal.response_body
                  ),
                ]) : null,
              ]),
              m('div.p-4.border-t.border-gray-200.dark:border-slate-700.flex.justify-end', [
                m('button.px-4.py-2.text-xs.font-semibold.rounded-xl.bg-indigo-600.text-white.hover:bg-indigo-500', {
                  onclick: function() { activeDeliveryModal = null; },
                }, 'Kapat'),
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

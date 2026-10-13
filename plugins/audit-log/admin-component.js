/**
 * Audit log admin page — Mithril component source (string)
 * Features dual Table & Timeline View (Zaman Tüneli) with record focus & diff metadata
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

  function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
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

  function getActionTheme(action) {
    switch (action) {
      case 'create':
        return {
          label: 'OLUŞTURULDU',
          color: 'emerald',
          badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
          dotClass: 'bg-emerald-500 text-white ring-4 ring-emerald-100 dark:ring-emerald-950/60',
          icon: 'plus',
        };
      case 'update':
        return {
          label: 'GÜNCELLENDİ',
          color: 'blue',
          badgeClass: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
          dotClass: 'bg-blue-500 text-white ring-4 ring-blue-100 dark:ring-blue-950/60',
          icon: 'pencil',
        };
      case 'delete':
        return {
          label: 'SİLİNDİ',
          color: 'rose',
          badgeClass: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
          dotClass: 'bg-rose-500 text-white ring-4 ring-rose-100 dark:ring-rose-950/60',
          icon: 'trash',
        };
      case 'restore':
        return {
          label: 'GERİ YÜKLENDİ',
          color: 'amber',
          badgeClass: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
          dotClass: 'bg-amber-500 text-white ring-4 ring-amber-100 dark:ring-amber-950/60',
          icon: 'undo',
        };
      default:
        return {
          label: (action || 'İŞLEM').toUpperCase(),
          color: 'gray',
          badgeClass: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
          dotClass: 'bg-gray-500 text-white ring-4 ring-gray-100 dark:ring-slate-800',
          icon: 'activity',
        };
    }
  }

  function renderSvgIcon(name, cls) {
    cls = cls || 'w-4 h-4';
    if (name === 'plus') {
      return m('svg', { class: cls, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
        m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2.5', d: 'M12 4v16m8-8H4' })
      );
    }
    if (name === 'pencil') {
      return m('svg', { class: cls, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
        m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z' })
      );
    }
    if (name === 'trash') {
      return m('svg', { class: cls, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
        m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16' })
      );
    }
    if (name === 'undo') {
      return m('svg', { class: cls, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
        m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M3 10h10a5 5 0 015 5v2m-15-7l4-4m-4 4l4 4' })
      );
    }
    if (name === 'clock') {
      return m('svg', { class: cls, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
        m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' })
      );
    }
    if (name === 'table') {
      return m('svg', { class: cls, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
        m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M3 10h18M3 14h18m-9-4v8m-7 4h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' })
      );
    }
    if (name === 'search') {
      return m('svg', { class: cls, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
        m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
      );
    }
    // Default activity
    return m('svg', { class: cls, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
      m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M13 10V3L4 14h7v7l9-11h-7z' })
    );
  }

  function AuditLogPage() {
    var rows = [];
    var loading = true;
    var error = null;
    var page = 1;
    var perPage = 25;
    var total = 0;
    var viewMode = 'timeline'; // 'timeline' | 'table'

    var filterModel = '';
    var filterAction = '';
    var filterRecordId = '';
    var filterSearch = '';

    var expandedIds = {};

    function parseQueryParams() {
      try {
        var searchStr = window.location.search || '';
        if (!searchStr && typeof m !== 'undefined' && m.route && m.route.get) {
          var cur = m.route.get();
          if (cur.indexOf('?') !== -1) {
            searchStr = cur.substring(cur.indexOf('?'));
          }
        }
        var params = new URLSearchParams(searchStr);
        if (params.get('model')) filterModel = params.get('model');
        if (params.get('recordId') || params.get('resourceId') || params.get('id')) {
          filterRecordId = params.get('recordId') || params.get('resourceId') || params.get('id');
        }
        if (params.get('action')) filterAction = params.get('action');
        if (params.get('view')) viewMode = params.get('view');
      } catch (e) {}
    }

    function load() {
      loading = true;
      error = null;
      var q = '?page=' + page + '&perPage=' + perPage;
      if (filterModel) q += '&model=' + encodeURIComponent(filterModel);
      if (filterAction) q += '&action=' + encodeURIComponent(filterAction);
      if (filterRecordId) q += '&recordId=' + encodeURIComponent(filterRecordId);
      if (filterSearch) q += '&search=' + encodeURIComponent(filterSearch);

      api.get(API + q).then(function(res) {
        rows = res.data || [];
        total = (res.meta && res.meta.total) || 0;
        loading = false;
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      }).catch(function(e) {
        error = e.message || String(e);
        loading = false;
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      });
    }

    function toggleExpand(id) {
      expandedIds[id] = !expandedIds[id];
    }

    function focusRecord(model, id) {
      filterModel = model || '';
      filterRecordId = id != null ? String(id) : '';
      page = 1;
      viewMode = 'timeline';
      load();
    }

    function clearFocus() {
      filterRecordId = '';
      page = 1;
      load();
    }

    function clearAllFilters() {
      filterModel = '';
      filterAction = '';
      filterRecordId = '';
      filterSearch = '';
      page = 1;
      load();
    }

    return {
      oninit: function() {
        parseQueryParams();
        load();
      },
      view: function() {
        var maxPage = Math.max(1, Math.ceil(total / perPage) || 1);

        return m('div.p-6.max-w-7xl.mx-auto.space-y-6', [
          // 1. Header with View Toggle & Purge
          m('div.flex.flex-col.md:flex-row.md:items-center.justify-between.gap-4.pb-4.border-b.border-gray-200.dark:border-slate-800', [
            m('div', [
              m('div.flex.items-center.gap-2.5', [
                m('span.p-2.rounded-lg.bg-indigo-50.text-indigo-600.dark:bg-indigo-950/40.dark:text-indigo-400',
                  renderSvgIcon('clock', 'w-5 h-5')
                ),
                m('h1.text-2xl.font-bold.text-gray-900.dark:text-slate-100', 'Denetim Günlüğü & Zaman Tüneli'),
              ]),
              m('p.text-sm.text-gray-500.dark:text-slate-400.mt-1',
                'Tüm yönetici CRUD işlemlerinin ve model mutasyonlarının denetim geçmişi.'
              ),
            ]),

            m('div.flex.items-center.gap-3', [
              // View Switcher (Timeline vs Table)
              m('div.inline-flex.rounded-lg.border.border-gray-200.dark:border-slate-700.p-1.bg-gray-50.dark:bg-slate-900', [
                m('button.px-3.py-1.5.text-xs.font-medium.rounded-md.flex.items-center.gap-1.5.transition-all', {
                  class: viewMode === 'timeline'
                    ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200',
                  onclick: function() { viewMode = 'timeline'; }
                }, [
                  renderSvgIcon('clock', 'w-3.5 h-3.5'),
                  m('span', 'Zaman Tüneli'),
                ]),
                m('button.px-3.py-1.5.text-xs.font-medium.rounded-md.flex.items-center.gap-1.5.transition-all', {
                  class: viewMode === 'table'
                    ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200',
                  onclick: function() { viewMode = 'table'; }
                }, [
                  renderSvgIcon('table', 'w-3.5 h-3.5'),
                  m('span', 'Tablo'),
                ]),
              ]),

              // Purge button
              m('button.px-3.py-1.5.text-xs.font-medium.border.border-rose-200.dark:border-rose-900.text-rose-700.dark:text-rose-400.rounded-lg.hover:bg-rose-50.dark:hover:bg-rose-950/40.transition-colors', {
                onclick: function() {
                  if (!confirm('90 günden eski denetim günlükleri silinsin mi?')) return;
                  api.post(API + '/purge', { days: 90 }).then(function() {
                    page = 1;
                    load();
                  }).catch(function(e) {
                    alert('Temizleme hatası: ' + (e.message || String(e)));
                  });
                },
              }, '90 Gün Öncesini Temizle'),
            ]),
          ]),

          // 2. Focused Record Banner (if filterRecordId is active)
          filterRecordId ? m('div.p-4.rounded-xl.bg-gradient-to-r.from-indigo-50.to-blue-50.dark:from-indigo-950/40.dark:to-blue-950/40.border.border-indigo-200.dark:border-indigo-800.flex.items-center.justify-between.gap-4', [
            m('div.flex.items-center.gap-3', [
              m('span.w-9.h-9.rounded-full.bg-indigo-600.text-white.flex.items-center.justify-center.font-bold.text-sm', '📌'),
              m('div', [
                m('h3.text-sm.font-semibold.text-indigo-950.dark:text-indigo-200',
                  (filterModel ? filterModel + ' #' : 'Kayıt #') + filterRecordId + ' İçin Değişiklik Zaman Tüneli'
                ),
                m('p.text-xs.text-indigo-700.dark:text-indigo-400',
                  'Bu kayda ait tüm ekleme, güncelleme ve silme geçmişi filtreleniyor.'
                ),
              ]),
            ]),
            m('button.px-3.py-1.5.text-xs.font-medium.bg-white.dark:bg-slate-800.text-indigo-700.dark:text-indigo-300.border.border-indigo-200.dark:border-indigo-700.rounded-lg.hover:bg-indigo-50.dark:hover:bg-indigo-900/60.transition-colors', {
              onclick: clearFocus,
            }, '✕ Filtreyi Kaldır'),
          ]) : null,

          // 3. Search & Filter Controls Card
          m('div.p-4.rounded-xl.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.shadow-sm.space-y-4', [
            m('div.grid.grid-cols-1.sm:grid-cols-2.lg:grid-cols-5.gap-3.items-end', [
              // Model Filter
              m('div', [
                m('label.block.text-xs.font-medium.text-gray-600.dark:text-slate-400.mb-1', 'Model'),
                m('input.w-full.border.border-gray-300.dark:border-slate-600.bg-white.dark:bg-slate-900.text-gray-900.dark:text-slate-100.rounded-lg.px-3.py-1.5.text-sm.focus:ring-2.focus:ring-indigo-500.focus:outline-none', {
                  value: filterModel,
                  placeholder: 'Örn. Post, User',
                  oninput: function(e) { filterModel = e.target.value; },
                  onkeydown: function(e) { if (e.key === 'Enter') { page = 1; load(); } },
                }),
              ]),

              // Record ID Filter
              m('div', [
                m('label.block.text-xs.font-medium.text-gray-600.dark:text-slate-400.mb-1', 'Kayıt ID'),
                m('input.w-full.border.border-gray-300.dark:border-slate-600.bg-white.dark:bg-slate-900.text-gray-900.dark:text-slate-100.rounded-lg.px-3.py-1.5.text-sm.focus:ring-2.focus:ring-indigo-500.focus:outline-none', {
                  value: filterRecordId,
                  placeholder: 'Örn. 42',
                  oninput: function(e) { filterRecordId = e.target.value; },
                  onkeydown: function(e) { if (e.key === 'Enter') { page = 1; load(); } },
                }),
              ]),

              // Action Filter
              m('div', [
                m('label.block.text-xs.font-medium.text-gray-600.dark:text-slate-400.mb-1', 'İşlem Türü'),
                m('select.w-full.border.border-gray-300.dark:border-slate-600.bg-white.dark:bg-slate-900.text-gray-900.dark:text-slate-100.rounded-lg.px-3.py-1.5.text-sm.focus:ring-2.focus:ring-indigo-500.focus:outline-none', {
                  value: filterAction,
                  onchange: function(e) { filterAction = e.target.value; page = 1; load(); },
                }, [
                  m('option', { value: '' }, 'Tüm İşlemler'),
                  m('option', { value: 'create' }, 'Oluşturma (create)'),
                  m('option', { value: 'update' }, 'Güncelleme (update)'),
                  m('option', { value: 'delete' }, 'Silme (delete)'),
                  m('option', { value: 'restore' }, 'Geri Yükleme (restore)'),
                ]),
              ]),

              // Search Filter (Actor, Path)
              m('div', [
                m('label.block.text-xs.font-medium.text-gray-600.dark:text-slate-400.mb-1', 'Arama'),
                m('div.relative', [
                  m('input.w-full.border.border-gray-300.dark:border-slate-600.bg-white.dark:bg-slate-900.text-gray-900.dark:text-slate-100.rounded-lg.pl-8.pr-3.py-1.5.text-sm.focus:ring-2.focus:ring-indigo-500.focus:outline-none', {
                    value: filterSearch,
                    placeholder: 'E-posta, IP veya yol...',
                    oninput: function(e) { filterSearch = e.target.value; },
                    onkeydown: function(e) { if (e.key === 'Enter') { page = 1; load(); } },
                  }),
                  m('span.absolute.left-2.5.top-2.text-gray-400', renderSvgIcon('search', 'w-4 h-4')),
                ]),
              ]),

              // Action Buttons
              m('div.flex.items-center.gap-2', [
                m('button.flex-1.bg-indigo-600.text-white.px-4.py-1.5.rounded-lg.text-sm.font-medium.hover:bg-indigo-700.transition-colors.shadow-sm', {
                  onclick: function() { page = 1; load(); },
                }, 'Apply'),
                m('button.border.border-gray-300.dark:border-slate-600.text-gray-700.dark:text-slate-300.px-3.py-1.5.rounded-lg.text-sm.hover:bg-gray-100.dark:hover:bg-slate-700.transition-colors', {
                  title: 'Clear Filters',
                  onclick: clearAllFilters,
                }, 'Clear'),
              ]),
            ]),
          ]),

          // Total Counter (required by Playwright E2E: getByText(/Total:/))
          m('div.text-sm.text-gray-500.dark:text-slate-400', 'Total: ' + total),

          // 4. Main Content Area (Timeline vs Table)
          loading ? m('div.py-16.text-center.space-y-3', [
            m('div.inline-block.animate-spin.rounded-full.h-8.w-8.border-4.border-indigo-600.border-t-transparent'),
            m('p.text-sm.text-gray-500.dark:text-slate-400', 'Denetim kayıtları yükleniyor...'),
          ]) : error ? m('div.p-6.rounded-xl.bg-red-50.dark:bg-red-950/40.border.border-red-200.dark:border-red-800.text-red-700.dark:text-red-300', [
            m('h4.font-semibold.text-sm', 'Kayıtlar Yüklenemedi'),
            m('p.text-xs.mt-1', error),
          ]) : rows.length === 0 ? m('div.py-16.text-center.bg-white.dark:bg-slate-800.rounded-xl.border.border-dashed.border-gray-300.dark:border-slate-700.p-8', [
            m('div.w-12.h-12.mx-auto.rounded-full.bg-gray-100.dark:bg-slate-700.flex.items-center.justify-center.text-gray-400.mb-3',
              renderSvgIcon('clock', 'w-6 h-6')
            ),
            m('h3.text-base.font-medium.text-gray-900.dark:text-slate-100', 'Kayıt Bulunamadı'),
            m('p.text-sm.text-gray-500.dark:text-slate-400.mt-1', 'Seçilen filtrelere uygun herhangi bir denetim kaydı bulunamadı.'),
            (filterModel || filterAction || filterRecordId || filterSearch) ? m('button.mt-4.text-xs.text-indigo-600.dark:text-indigo-400.hover:underline', {
              onclick: clearAllFilters,
            }, 'Filtreleri temizle ve tekrar dene') : null,
          ]) : viewMode === 'timeline' ? (
            // ==================== TIMELINE VIEW ====================
            m('div.space-y-6', [
              m('div.relative.pl-6.border-l-2.border-indigo-200.dark:border-slate-700.ml-4.space-y-8', rows.map(function(r) {
                var theme = getActionTheme(r.action);
                var isExpanded = !!expandedIds[r.id];
                var metadata = r.metadata;
                if (typeof metadata === 'string') {
                  try { metadata = JSON.parse(metadata); } catch (e) {}
                }
                var changedFields = metadata && Array.isArray(metadata.changedFields) ? metadata.changedFields : [];

                return m('div.relative.group', [
                  // Spine Node Dot
                  m('span.absolute.-left-[33px].top-1.5.flex.items-center.justify-center.w-7.h-7.rounded-full.shadow-sm', {
                    class: theme.dotClass,
                  }, renderSvgIcon(theme.icon, 'w-3.5 h-3.5')),

                  // Event Card
                  m('div.rounded-xl.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.p-5.shadow-sm.hover:shadow-md.transition-shadow.space-y-3', [
                    // Card Header
                    m('div.flex.flex-wrap.items-center.justify-between.gap-2', [
                      m('div.flex.items-center.gap-2.5', [
                        // Action Badge
                        m('span.px-2.5.py-0.5.text-xs.font-semibold.rounded-full.border', {
                          class: theme.badgeClass,
                        }, theme.label),

                        // Model & ID Tag (Clickable to focus)
                        m('button.px-2.5.py-0.5.text-xs.font-medium.bg-gray-100.dark:bg-slate-700.text-gray-800.dark:text-slate-200.rounded-md.hover:bg-indigo-100.dark:hover:bg-indigo-900/60.hover:text-indigo-700.transition-colors.flex.items-center.gap-1', {
                          title: 'Bu kaydın tüm geçmişini zaman tünelinde göster',
                          onclick: function() { focusRecord(r.resource_model, r.resource_id); },
                        }, [
                          m('span.font-semibold', r.resource_model),
                          r.resource_id != null ? m('span.text-indigo-600.dark:text-indigo-400', '#' + r.resource_id) : null,
                        ]),
                      ]),

                      // Timestamp & Relative Time
                      m('div.text-xs.text-gray-500.dark:text-slate-400.flex.items-center.gap-1.5', [
                        m('span.font-medium.text-gray-700.dark:text-slate-300', formatRelativeTime(r.created_at)),
                        m('span', '•'),
                        m('span', r.created_at || ''),
                      ]),
                    ]),

                    // Actor Identity Row
                    m('div.flex.items-center.justify-between.text-xs.pt-1', [
                      m('div.flex.items-center.gap-2', [
                        m('span.w-6.h-6.rounded-full.bg-slate-200.dark:bg-slate-700.text-slate-700.dark:text-slate-300.font-bold.flex.items-center.justify-center.text-[10px]',
                          ((r.actor_email && r.actor_email[0]) || 'A').toUpperCase()
                        ),
                        m('span.font-medium.text-gray-900.dark:text-slate-100', r.actor_email || 'Sistem / Otomasyon'),
                        r.actor_id != null ? m('span.text-gray-400', '(ID: ' + r.actor_id + ')') : null,
                      ]),

                      r.ip ? m('span.px-2.py-0.5.rounded.bg-gray-50.dark:bg-slate-900.text-gray-500.border.border-gray-200.dark:border-slate-700.font-mono.text-[11px]', r.ip) : null,
                    ]),

                    // Changes / Mutated Fields Summary
                    r.action === 'update' && changedFields.length > 0 ? m('div.pt-1.space-y-1.5', [
                      m('span.text-xs.font-medium.text-gray-500.dark:text-slate-400', 'Değiştirilen Alanlar:'),
                      m('div.flex.flex-wrap.gap-1.5', changedFields.map(function(f) {
                        return m('span.px-2.py-0.5.rounded-md.bg-blue-50.text-blue-700.dark:bg-blue-950/40.dark:text-blue-300.border.border-blue-200.dark:border-blue-800.text-xs.font-mono', f);
                      })),
                    ]) : r.action === 'create' ? m('p.text-xs.text-gray-600.dark:text-slate-300',
                      'Kayıt başarıyla oluşturuldu ve veritabanına eklendi.'
                    ) : r.action === 'delete' ? m('p.text-xs.text-rose-600.dark:text-rose-400',
                      'Kayıt veritabanından silindi (soft delete/hard delete).'
                    ) : r.action === 'restore' ? m('p.text-xs.text-amber-600.dark:text-amber-400',
                      'Silinmiş kayıt başarıyla geri yüklendi.'
                    ) : null,

                    // Details Toggle Accordion
                    m('div.pt-2.border-t.border-gray-100.dark:border-slate-750', [
                      m('button.text-xs.text-indigo-600.dark:text-indigo-400.hover:underline.flex.items-center.gap-1', {
                        onclick: function() { toggleExpand(r.id); }
                      }, [
                        m('span', isExpanded ? '▲ Teknik Detayları Gizle' : '▼ Teknik Detayları Göster'),
                      ]),

                      isExpanded ? m('div.mt-3.p-3.rounded-lg.bg-gray-50.dark:bg-slate-900.border.border-gray-200.dark:border-slate-700.text-xs.space-y-2', [
                        m('div.grid.grid-cols-1.md:grid-cols-2.gap-2', [
                          m('div', [
                            m('span.font-semibold.text-gray-600.dark:text-slate-400', 'Yol: '),
                            m('span.font-mono.text-gray-800.dark:text-slate-200', (r.http_method || '') + ' ' + (r.path || '—')),
                          ]),
                          m('div', [
                            m('span.font-semibold.text-gray-600.dark:text-slate-400', 'Tarayıcı / Agent: '),
                            m('span.truncate.text-gray-800.dark:text-slate-200.inline-block.max-w-xs', { title: r.user_agent || '' }, r.user_agent || '—'),
                          ]),
                        ]),
                        metadata ? m('div.pt-1', [
                          m('span.font-semibold.text-gray-600.dark:text-slate-400.block.mb-1', 'Metadata:'),
                          m('pre.p-2.rounded.bg-gray-900.text-emerald-400.font-mono.text-[11px].overflow-x-auto',
                            JSON.stringify(metadata, null, 2)
                          ),
                        ]) : null,
                      ]) : null,
                    ]),
                  ]),
                ]);
              })),
            ])
          ) : (
            // ==================== TABLE VIEW ====================
            m('div.overflow-x-auto.border.border-gray-200.dark:border-slate-700.rounded-xl.bg-white.dark:bg-slate-800.shadow-sm', [
              m('table.min-w-full.text-sm', [
                m('thead.bg-gray-50.dark:bg-slate-900.border-b.border-gray-200.dark:border-slate-700', [
                  m('tr', [
                    m('th.text-left.p-3.font-semibold.text-gray-700.dark:text-slate-300', 'Zaman'),
                    m('th.text-left.p-3.font-semibold.text-gray-700.dark:text-slate-300', 'Kullanıcı'),
                    m('th.text-left.p-3.font-semibold.text-gray-700.dark:text-slate-300', 'İşlem'),
                    m('th.text-left.p-3.font-semibold.text-gray-700.dark:text-slate-300', 'Model'),
                    m('th.text-left.p-3.font-semibold.text-gray-700.dark:text-slate-300', 'Kayıt ID'),
                    m('th.text-left.p-3.font-semibold.text-gray-700.dark:text-slate-300', 'Yol'),
                    m('th.text-right.p-3.font-semibold.text-gray-700.dark:text-slate-300', 'Zaman Tüneli'),
                  ]),
                ]),
                m('tbody.divide-y.divide-gray-100.dark:divide-slate-700', rows.map(function(r) {
                  var theme = getActionTheme(r.action);
                  return m('tr.hover:bg-gray-50.dark:hover:bg-slate-750.transition-colors', [
                    m('td.p-3.whitespace-nowrap.text-gray-600.dark:text-slate-300', [
                      m('span.block.font-medium.text-gray-900.dark:text-slate-100', formatRelativeTime(r.created_at)),
                      m('span.text-xs.text-gray-400', r.created_at || ''),
                    ]),
                    m('td.p-3.text-gray-800.dark:text-slate-200', [
                      m('span.block.font-medium', r.actor_email || 'Sistem'),
                      r.actor_id != null ? m('span.text-xs.text-gray-400', '#' + r.actor_id) : null,
                    ]),
                    m('td.p-3', [
                      m('span.px-2.py-0.5.text-xs.font-semibold.rounded-full.border', {
                        class: theme.badgeClass,
                      }, r.action),
                    ]),
                    m('td.p-3.font-medium.text-gray-900.dark:text-slate-100', r.resource_model),
                    m('td.p-3.text-gray-600.dark:text-slate-300', r.resource_id != null ? '#' + r.resource_id : '—'),
                    m('td.p-3.max-w-xs.truncate.text-xs.font-mono.text-gray-500.dark:text-slate-400', { title: r.path || '' }, r.path || ''),
                    m('td.p-3.text-right', [
                      m('button.px-2.5.py-1.text-xs.font-medium.text-indigo-600.dark:text-indigo-400.hover:bg-indigo-50.dark:hover:bg-indigo-950/40.rounded-lg.transition-colors', {
                        onclick: function() { focusRecord(r.resource_model, r.resource_id); },
                      }, 'Tünelde Gör →'),
                    ]),
                  ]);
                })),
              ]),
            ])
          ),

          // 5. Pagination Bar
          m('div.flex.flex-col.sm:flex-row.items-center.justify-between.gap-3.pt-2', [
            m('div.text-xs.text-gray-500.dark:text-slate-400', [
              m('strong.font-semibold.text-gray-800.dark:text-slate-200', total),
              m('span', ' records listed'),
            ]),

            m('div.flex.items-center.gap-2', [
              m('button.px-3.py-1.5.text-xs.font-medium.border.border-gray-300.dark:border-slate-700.rounded-lg.bg-white.dark:bg-slate-800.text-gray-700.dark:text-slate-200.hover:bg-gray-50.dark:hover:bg-slate-750.disabled:opacity-40.disabled:cursor-not-allowed.transition-colors', {
                disabled: page <= 1,
                onclick: function() { if (page > 1) { page--; load(); } },
              }, 'Prev'),
              m('span.text-xs.font-medium.text-gray-700.dark:text-slate-300.px-2',
                'Page ' + page + ' / ' + maxPage
              ),
              m('button.px-3.py-1.5.text-xs.font-medium.border.border-gray-300.dark:border-slate-700.rounded-lg.bg-white.dark:bg-slate-800.text-gray-700.dark:text-slate-200.hover:bg-gray-50.dark:hover:bg-slate-750.disabled:opacity-40.disabled:cursor-not-allowed.transition-colors', {
                disabled: page >= maxPage,
                onclick: function() { if (page < maxPage) { page++; load(); } },
              }, 'Next'),
            ]),
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

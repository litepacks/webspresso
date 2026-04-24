/**
 * Analytics Admin Page Component
 * Generates Mithril.js component code as a string for embedding in the admin SPA
 * @module plugins/site-analytics/admin-component
 */

function generateAnalyticsComponent() {
  return `
// =============================================
// Site Analytics Page Component
// =============================================
(function() {

var COUNTRY_FLAGS = {
  US:'🇺🇸',GB:'🇬🇧',DE:'🇩🇪',FR:'🇫🇷',ES:'🇪🇸',IT:'🇮🇹',NL:'🇳🇱',BR:'🇧🇷',
  CA:'🇨🇦',AU:'🇦🇺',JP:'🇯🇵',KR:'🇰🇷',CN:'🇨🇳',IN:'🇮🇳',RU:'🇷🇺',TR:'🇹🇷',
  PL:'🇵🇱',SE:'🇸🇪',NO:'🇳🇴',DK:'🇩🇰',FI:'🇫🇮',CZ:'🇨🇿',AT:'🇦🇹',CH:'🇨🇭',
  BE:'🇧🇪',PT:'🇵🇹',GR:'🇬🇷',IE:'🇮🇪',NZ:'🇳🇿',MX:'🇲🇽',AR:'🇦🇷',CO:'🇨🇴',
  SA:'🇸🇦',AE:'🇦🇪',IL:'🇮🇱',TH:'🇹🇭',VN:'🇻🇳',ID:'🇮🇩',MY:'🇲🇾',PH:'🇵🇭',
  SG:'🇸🇬',TW:'🇹🇼',HK:'🇭🇰',ZA:'🇿🇦',EG:'🇪🇬',NG:'🇳🇬',KE:'🇰🇪',UA:'🇺🇦',
  RO:'🇷🇴',HU:'🇭🇺',BG:'🇧🇬',HR:'🇭🇷',SK:'🇸🇰',SI:'🇸🇮',RS:'🇷🇸',BD:'🇧🇩',
  PK:'🇵🇰',IR:'🇮🇷',IQ:'🇮🇶',CL:'🇨🇱',PE:'🇵🇪',VE:'🇻🇪',EC:'🇪🇨',BY:'🇧🇾',
};

var COUNTRY_NAMES = {
  US:'United States',GB:'United Kingdom',DE:'Germany',FR:'France',ES:'Spain',
  IT:'Italy',NL:'Netherlands',BR:'Brazil',CA:'Canada',AU:'Australia',JP:'Japan',
  KR:'South Korea',CN:'China',IN:'India',RU:'Russia',TR:'Turkey',PL:'Poland',
  SE:'Sweden',NO:'Norway',DK:'Denmark',FI:'Finland',CZ:'Czech Republic',AT:'Austria',
  CH:'Switzerland',BE:'Belgium',PT:'Portugal',GR:'Greece',IE:'Ireland',NZ:'New Zealand',
  MX:'Mexico',AR:'Argentina',CO:'Colombia',SA:'Saudi Arabia',AE:'UAE',IL:'Israel',
  TH:'Thailand',VN:'Vietnam',ID:'Indonesia',MY:'Malaysia',PH:'Philippines',SG:'Singapore',
  TW:'Taiwan',HK:'Hong Kong',ZA:'South Africa',EG:'Egypt',NG:'Nigeria',KE:'Kenya',
  UA:'Ukraine',RO:'Romania',HU:'Hungary',BG:'Bulgaria',HR:'Croatia',SK:'Slovakia',
  SI:'Slovenia',RS:'Serbia',BD:'Bangladesh',PK:'Pakistan',IR:'Iran',IQ:'Iraq',
  CL:'Chile',PE:'Peru',VE:'Venezuela',EC:'Ecuador',BY:'Belarus',
};

var chartInstance = null;

function analyticsApi(path, days) {
  return api.get('/analytics/' + path + '?days=' + days);
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function relativeTime(dateStr) {
  if (!dateStr) return '';
  var now = new Date();
  var d = new Date(dateStr);
  var diff = now - d;
  var mins = Math.floor(diff / 60000);
  var hours = Math.floor(mins / 60);
  var days = Math.floor(hours / 24);
  if (days > 0) return days + ' day' + (days > 1 ? 's' : '') + ' ago';
  if (hours > 0) return hours + ' hour' + (hours > 1 ? 's' : '') + ' ago';
  if (mins > 0) return mins + ' minute' + (mins > 1 ? 's' : '') + ' ago';
  return 'just now';
}

// ---------- Stat Card ----------
function StatCard() {
  return {
    view: function(vnode) {
      var a = vnode.attrs;
      return m('div.bg-white.rounded-lg.shadow.p-5.flex.items-center.gap-4', [
        m('div.w-12.h-12.rounded-xl.flex.items-center.justify-center.text-xl', {
          class: a.bgClass || 'bg-blue-100',
        }, a.icon),
        m('div', [
          m('p.text-2xl.font-bold.text-gray-900', formatNumber(a.value || 0)),
          m('p.text-xs.text-gray-500.uppercase.tracking-wide', a.label),
        ]),
      ]);
    }
  };
}

// ---------- Chart Component ----------
function ViewsChart() {
  return {
    oncreate: function(vnode) {
      var ctx = vnode.dom.querySelector('canvas').getContext('2d');
      var data = vnode.attrs.data || [];
      chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: data.map(function(d) { return d.date; }),
          datasets: [
            {
              label: 'Views',
              data: data.map(function(d) { return d.views; }),
              borderColor: '#3B82F6',
              backgroundColor: 'rgba(59,130,246,0.08)',
              fill: true,
              tension: 0.3,
              pointRadius: data.length > 60 ? 0 : 2,
            },
            {
              label: 'Visitors',
              data: data.map(function(d) { return d.visitors; }),
              borderColor: '#10B981',
              backgroundColor: 'rgba(16,185,129,0.08)',
              fill: true,
              tension: 0.3,
              pointRadius: data.length > 60 ? 0 : 2,
            },
            {
              label: 'Sessions',
              data: data.map(function(d) { return d.sessions; }),
              borderColor: '#F59E0B',
              backgroundColor: 'rgba(245,158,11,0.05)',
              fill: false,
              tension: 0.3,
              borderDash: [4, 4],
              pointRadius: 0,
            }
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              position: 'top',
              labels: { usePointStyle: true, boxWidth: 6, padding: 16 },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: {
                maxTicksLimit: 12,
                callback: function(val, i) {
                  var label = this.getLabelForValue(val);
                  return label ? label.slice(5) : '';
                }
              },
            },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(0,0,0,0.04)' },
              ticks: { precision: 0 },
            },
          },
        },
      });
    },
    onremove: function() {
      if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    },
    view: function(vnode) {
      return m('div', { style: 'height:280px' }, [
        m('canvas'),
      ]);
    }
  };
}

// ---------- Horizontal Bar (pure CSS) ----------
function HBar() {
  return {
    view: function(vnode) {
      var pct = vnode.attrs.pct || 0;
      var color = vnode.attrs.color || 'bg-blue-500';
      return m('div.flex-1.h-2.bg-gray-100.rounded-full.overflow-hidden', [
        m('div.h-full.rounded-full.transition-all', {
          class: color,
          style: 'width:' + Math.min(pct, 100) + '%',
        }),
      ]);
    }
  };
}

// ---------- Main Analytics Page ----------
var AnalyticsPage = {
  oninit: function(vnode) {
    vnode.state.days = 30;
    vnode.state.loading = true;
    vnode.state.stats = null;
    vnode.state.viewsOverTime = [];
    vnode.state.topPages = [];
    vnode.state.botActivity = [];
    vnode.state.referrerSources = [];
    vnode.state.countries = [];
    vnode.state.recent = [];
    vnode.state.chartLoaded = false;
    vnode.state._stopPoll = null;
    vnode.state.chartDataVersion = 0;
    this.loadData(vnode);
    this.loadChartJs(vnode);
    if (typeof runAdminAutoRefresh === 'function') {
      vnode.state._stopPoll = runAdminAutoRefresh(function() {
        this.loadData(vnode);
      }.bind(this));
    }
  },

  onremove: function(vnode) {
    if (vnode.state._stopPoll) vnode.state._stopPoll();
  },

  loadChartJs: function(vnode) {
    if (window.Chart) {
      vnode.state.chartLoaded = true;
      return;
    }
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
    script.onload = function() {
      vnode.state.chartLoaded = true;
      m.redraw();
    };
    document.head.appendChild(script);
  },

  loadData: function(vnode) {
    vnode.state.loading = true;
    var days = vnode.state.days;

    return Promise.all([
      analyticsApi('stats', days),
      analyticsApi('views-over-time', days),
      analyticsApi('top-pages', days),
      analyticsApi('bot-activity', days),
      analyticsApi('referrer-sources', days),
      analyticsApi('countries', days),
      analyticsApi('client-errors', days),
      analyticsApi('recent', days),
    ]).then(function(results) {
      vnode.state.stats = results[0];
      vnode.state.viewsOverTime = results[1];
      vnode.state.topPages = results[2];
      vnode.state.botActivity = results[3];
      vnode.state.referrerSources = results[4];
      vnode.state.countries = results[5];
      vnode.state.clientErrors = results[6];
      vnode.state.recent = results[7];
      vnode.state.loading = false;
      vnode.state.chartDataVersion = (vnode.state.chartDataVersion || 0) + 1;

      if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
      }
      m.redraw();
    }).catch(function(err) {
      console.error('Analytics load error:', err);
      vnode.state.loading = false;
      m.redraw();
    });
  },

  setDays: function(vnode, d) {
    vnode.state.days = d;
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    this.loadData(vnode);
  },

  view: function(vnode) {
    var s = vnode.state;
    var self = this;

    return m(Layout, [
      m(Breadcrumb, { items: [{ label: 'Analytics', href: '/analytics' }] }),

      // Header row
      m('div.flex.items-center.justify-between.mb-6', [
        m('div', [
          m('h1.text-2xl.font-bold.text-gray-900.flex.items-center.gap-2', [
            m(Icon, { name: 'chart', class: 'w-6 h-6' }),
            'Analytics',
          ]),
          m('p.text-gray-500.text-sm.mt-1', 'Page view statistics and visitor analytics'),
        ]),
        m('div.flex.items-center.gap-2.flex-wrap.justify-end', [
          typeof RefreshIconButton !== 'undefined'
            ? m(RefreshIconButton, {
                title: 'Refresh analytics',
                spinning: s.loading,
                onclick: function() { self.loadData(vnode); },
              })
            : null,
          // Day filter
          m('div.flex.gap-1.bg-gray-100.rounded-lg.p-1', [7, 30, 90].map(function(d) {
            return m('button.px-3.py-1.5.text-sm.font-medium.rounded-md.transition-colors', {
              class: s.days === d
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
              onclick: function() { self.setDays(vnode, d); },
            }, 'Last ' + d + ' days');
          })),
        ]),
      ]),

      s.loading
        ? m('div.flex.justify-center.py-24', m(Spinner))
        : [
          // Stat cards
          m('div.grid.grid-cols-2.sm:grid-cols-3.lg:grid-cols-3.xl:grid-cols-6.gap-4.mb-6', [
            m(StatCard, { icon: '👁', label: 'Views', value: s.stats?.views, bgClass: 'bg-blue-100' }),
            m(StatCard, { icon: '👤', label: 'Visitors', value: s.stats?.visitors, bgClass: 'bg-green-100' }),
            m(StatCard, { icon: '📄', label: 'Unique Pages', value: s.stats?.uniquePages, bgClass: 'bg-yellow-100' }),
            m(StatCard, { icon: '🔗', label: 'Sessions', value: s.stats?.sessions, bgClass: 'bg-purple-100' }),
            m(StatCard, { icon: '🏠', label: 'Direct traffic', value: s.stats?.directViews, bgClass: 'bg-slate-100' }),
            m(StatCard, { icon: '🌐', label: 'With referrer', value: s.stats?.referredViews, bgClass: 'bg-cyan-100' }),
          ]),

          // Chart + Bot Activity row
          m('div.grid.grid-cols-1.lg:grid-cols-3.gap-4.mb-6', [
            // Views over time chart
            m('div.lg:col-span-2.bg-white.rounded-lg.shadow', [
              m('div.px-5.py-4.border-b.border-gray-100.flex.items-center.justify-between', [
                m('h3.text-sm.font-semibold.text-gray-900.flex.items-center.gap-2', [
                  m(Icon, { name: 'chart', class: 'w-4 h-4 text-gray-400' }),
                  'Views Over Time',
                ]),
              ]),
              m('div.p-5', [
                s.chartLoaded && s.viewsOverTime.length > 0
                  ? m(ViewsChart, { key: 'chart-' + s.days + '-' + (s.chartDataVersion || 0), data: s.viewsOverTime })
                  : m('div.flex.justify-center.py-16.text-gray-400.text-sm', 'Loading chart...'),
              ]),
            ]),

            // Bot Activity
            m('div.bg-white.rounded-lg.shadow', [
              m('div.px-5.py-4.border-b.border-gray-100', [
                m('h3.text-sm.font-semibold.text-gray-900', 'Bot Activity'),
              ]),
              m('div.p-4', [
                s.botActivity.length === 0
                  ? m('p.text-gray-400.text-sm.text-center.py-4', 'No bot activity')
                  : (function() {
                    var maxReqs = Math.max.apply(null, s.botActivity.map(function(b) { return b.requests; }));
                    return m('div.space-y-2.5', s.botActivity.slice(0, 12).map(function(bot) {
                      return m('div.flex.items-center.gap-3', [
                        m('span.text-xs.font-medium.text-gray-700.w-24.truncate', { title: bot.name }, bot.name),
                        m(HBar, { pct: (bot.requests / maxReqs) * 100, color: 'bg-indigo-500' }),
                        m('span.text-xs.text-gray-500.w-12.text-right.tabular-nums', formatNumber(bot.requests)),
                      ]);
                    }));
                  })(),
              ]),
            ]),
          ]),

          // Top Pages + Recent Activity row
          m('div.grid.grid-cols-1.lg:grid-cols-2.gap-4.mb-6', [
            // Top Pages
            m('div.bg-white.rounded-lg.shadow.flex.flex-col', { style: 'max-height:480px' }, [
              m('div.px-5.py-4.border-b.border-gray-100.shrink-0', [
                m('h3.text-sm.font-semibold.text-gray-900', 'Top Pages'),
              ]),
              m('div.divide-y.divide-gray-50.overflow-y-auto.flex-1', [
                s.topPages.length === 0
                  ? m('p.text-gray-400.text-sm.text-center.py-6', 'No page views yet')
                  : (function() {
                    var maxViews = s.topPages[0]?.views || 1;
                    return s.topPages.slice(0, 15).map(function(page, i) {
                      return m('div.flex.items-center.gap-3.px-5.py-2.5.hover:bg-gray-50', [
                        m('span.text-xs.text-gray-400.w-5.text-right', i + 1),
                        m('div.flex-1.min-w-0', [
                          m('p.text-sm.text-gray-800.truncate', { title: page.path }, page.path),
                          m('div.mt-1', m(HBar, {
                            pct: (page.views / maxViews) * 100,
                            color: 'bg-blue-400',
                          })),
                        ]),
                        m('div.text-right.shrink-0', [
                          m('span.text-sm.font-semibold.text-gray-900', formatNumber(page.views)),
                          m('span.text-xs.text-gray-400.ml-1', 'views'),
                        ]),
                      ]);
                    });
                  })(),
              ]),
            ]),

            // Recent Activity
            m('div.bg-white.rounded-lg.shadow.flex.flex-col', { style: 'max-height:480px' }, [
              m('div.px-5.py-4.border-b.border-gray-100.flex.items-center.justify-between.shrink-0', [
                m('h3.text-sm.font-semibold.text-gray-900', 'Recent Activity'),
                m('span.text-xs.text-gray-400', 'Live'),
              ]),
              m('div.divide-y.divide-gray-50.overflow-y-auto.flex-1', [
                s.recent.length === 0
                  ? m('p.text-gray-400.text-sm.text-center.py-6', 'No recent activity')
                  : s.recent.slice(0, 10).map(function(item) {
                    return m('div.flex.items-center.gap-3.px-5.py-2.5.hover:bg-gray-50', [
                      m('div.w-7.h-7.rounded-full.bg-blue-50.flex.items-center.justify-center.shrink-0', [
                        m('span.text-xs', item.country ? (COUNTRY_FLAGS[item.country] || '🌐') : '🌐'),
                      ]),
                      m('div.flex-1.min-w-0', [
                        m('p.text-sm.text-gray-800.truncate', { title: item.path }, item.path),
                        m('p.text-xs.text-gray-400', relativeTime(item.created_at)),
                      ]),
                      item.referrer && m('span.text-xs.text-gray-400.truncate.max-w-[120px]', {
                        title: item.referrer,
                      }, (function() {
                        try { return new URL(item.referrer).hostname; } catch(e) { return ''; }
                      })()),
                    ]);
                  }),
              ]),
            ]),
          ]),

          // Client Errors
          m('div.bg-white.rounded-lg.shadow.mb-6', [
            m('div.px-5.py-4.border-b.border-gray-100.flex.items-center.justify-between', [
              m('h3.text-sm.font-semibold.text-gray-900.flex.items-center.gap-2', [
                m('span', '⚠️'),
                'Client Errors',
              ]),
              m('span.text-xs.text-gray-400', 'Last ' + s.days + ' days'),
            ]),
            m('div.p-4.max-h-64.overflow-y-auto', [
              !s.clientErrors || s.clientErrors.length === 0
                ? m('p.text-gray-400.text-sm.text-center.py-6', 'No client errors')
                : s.clientErrors.slice(0, 15).map(function(err) {
                    return m('div.border-b.border-gray-50.pb-3.mb-3.last:border-0.last:mb-0.last:pb-0', [
                      m('div.flex.items-start.gap-2', [
                        m('span.text-xs.px-1.5.py-0.5.rounded.bg-red-100.text-red-700', err.error_type || 'error'),
                        m('span.text-xs.text-gray-500', relativeTime(err.created_at)),
                      ]),
                      m('p.text-sm.text-gray-800.font-mono.break-all.mt-1', {
                        title: err.stack || err.message,
                      }, (err.message || '').slice(0, 120) + (err.message && err.message.length > 120 ? '…' : '')),
                      err.path && m('p.text-xs.text-gray-500.mt-0.5', err.path),
                    ]);
                  }),
            ]),
          ]),

          // Referrer sources (hostname-level)
          m('div.bg-white.rounded-lg.shadow.mb-6', [
            m('div.px-5.py-4.border-b.border-gray-100.flex.items-center.justify-between', [
              m('h3.text-sm.font-semibold.text-gray-900', 'Referrer sources'),
              m('span.text-xs.text-gray-400', 'By hostname · last ' + s.days + ' days'),
            ]),
            m('div.p-4', [
              !s.referrerSources || s.referrerSources.length === 0
                ? m('p.text-gray-400.text-sm.text-center.py-4', 'No external referrer data (direct visits or missing Referer header)')
                : (function() {
                  var maxV = s.referrerSources[0]?.views || 1;
                  return m('div.grid.grid-cols-1.sm:grid-cols-2.gap-x-8.gap-y-2', s.referrerSources.map(function(r) {
                    return m('div.flex.items-center.gap-3.py-1', [
                      m('span.text-sm.text-gray-700.flex-1.min-w-0.truncate', { title: r.source }, r.source),
                      m('div.w-32.shrink-0', m(HBar, {
                        pct: (r.views / maxV) * 100,
                        color: 'bg-sky-500',
                      })),
                      m('span.text-xs.text-gray-500.w-12.text-right.tabular-nums', formatNumber(r.views)),
                    ]);
                  }));
                })(),
            ]),
          ]),

          // Country Stats
          m('div.bg-white.rounded-lg.shadow.mb-6', [
            m('div.px-5.py-4.border-b.border-gray-100.flex.items-center.justify-between', [
              m('h3.text-sm.font-semibold.text-gray-900', 'Country Stats'),
              m('span.text-xs.text-gray-400', 'Last ' + s.days + ' days'),
            ]),
            m('div.p-4', [
              s.countries.length === 0
                ? m('p.text-gray-400.text-sm.text-center.py-4', 'No country data')
                : (function() {
                  var maxViews = s.countries[0]?.views || 1;
                  return m('div.grid.grid-cols-1.sm:grid-cols-2.gap-x-8.gap-y-2', s.countries.map(function(c) {
                    return m('div.flex.items-center.gap-3.py-1', [
                      m('span.text-base.w-6.text-center', COUNTRY_FLAGS[c.country] || '🏳️'),
                      m('span.text-sm.text-gray-700.w-6.font-medium', c.country),
                      m('div.flex-1', m(HBar, {
                        pct: (c.views / maxViews) * 100,
                        color: 'bg-emerald-500',
                      })),
                      m('span.text-xs.text-gray-500.w-12.text-right.tabular-nums', formatNumber(c.views)),
                    ]);
                  }));
                })(),
            ]),
          ]),
        ],
    ]);
  },
};

window.__customPages = window.__customPages || {};
window.__customPages['analytics'] = AnalyticsPage;

})();
`;
}

module.exports = { generateAnalyticsComponent };

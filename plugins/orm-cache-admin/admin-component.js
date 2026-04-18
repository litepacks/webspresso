/**
 * Admin SPA page for ORM cache (Mithril string component)
 * @module plugins/orm-cache-admin/admin-component
 */

function generateOrmCacheAdminComponent() {
  return `
(function() {

function ormCacheApi(method, path, body) {
  var opts = { method: method, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  return fetch('/_admin/api/orm-cache' + path, opts).then(function(r) {
    return r.json().then(function(j) {
      if (!r.ok) throw new Error(j.error || r.statusText);
      return j;
    });
  });
}

var OrmCachePage = {
  oninit: function(vnode) {
    vnode.state.loading = true;
    vnode.state.error = null;
    vnode.state.stats = null;
    vnode.state.modelName = '';
    this.refresh(vnode);
  },
  refresh: function(vnode) {
    vnode.state.loading = true;
    vnode.state.error = null;
    ormCacheApi('get', '/stats').then(function(s) {
      vnode.state.stats = s;
      vnode.state.loading = false;
      m.redraw();
    }).catch(function(e) {
      vnode.state.error = e.message || String(e);
      vnode.state.loading = false;
      m.redraw();
    });
  },
  purge: function(vnode) {
    if (!confirm('Purge entire ORM cache?')) return;
    ormCacheApi('post', '/purge').then(function() {
      return this.refresh(vnode);
    }.bind(this)).catch(function(e) {
      vnode.state.error = e.message;
      m.redraw();
    }.bind(this));
  },
  invalidateModel: function(vnode) {
    var name = (vnode.state.modelName || '').trim();
    if (!name) return;
    ormCacheApi('post', '/invalidate', { model: name }).then(function() {
      vnode.state.modelName = '';
      return this.refresh(vnode);
    }.bind(this)).catch(function(e) {
      vnode.state.error = e.message;
      m.redraw();
    }.bind(this));
  },
  resetMetrics: function(vnode) {
    ormCacheApi('post', '/metrics/reset').then(function() {
      return this.refresh(vnode);
    }.bind(this)).catch(function(e) {
      vnode.state.error = e.message;
      m.redraw();
    }.bind(this));
  },
  view: function(vnode) {
    var s = vnode.state;
    var self = this;
    return m(Layout, [
      m(Breadcrumb, { items: [{ label: 'ORM Cache', href: '/orm-cache' }] }),
      m('div.mb-6', [
        m('h1.text-2xl.font-bold.text-gray-900', 'ORM query cache'),
        m('p.text-gray-500.text-sm.mt-1', 'Hit/miss metrics and manual invalidation (memory provider)'),
      ]),
      s.loading
        ? m('div.flex.justify-center.py-16', m(Spinner))
        : s.error
          ? m('div.bg-red-50.text-red-700.p-4.rounded-lg', s.error)
          : m('div.space-y-6', [
              m('div.grid.grid-cols-2.md:grid-cols-4.gap-4', [
                statBox('Hits', s.stats && s.stats.hits),
                statBox('Misses', s.stats && s.stats.misses),
                statBox('Hit rate', formatRate(s.stats && s.stats.hitRate)),
                statBox('Bypassed', s.stats && s.stats.bypassed),
              ]),
              m('div.grid.grid-cols-2.md:grid-cols-4.gap-4', [
                statBox('Sets', s.stats && s.stats.sets),
                statBox('Invalidations', s.stats && s.stats.invalidations),
                statBox('Approx keys', s.stats && s.stats.approxKeys),
                statBox('Approx tags', s.stats && s.stats.approxTags),
              ]),
              m('div.flex.flex-wrap.gap-2', [
                m('button.px-4.py-2.bg-red-600.text-white.rounded-md.text-sm', {
                  onclick: function() { self.purge(vnode); },
                }, 'Purge all'),
                m('button.px-4.py-2.bg-gray-200.text-gray-800.rounded-md.text-sm', {
                  onclick: function() { self.resetMetrics(vnode); },
                }, 'Reset metrics'),
                m('button.px-4.py-2.bg-blue-600.text-white.rounded-md.text-sm', {
                  onclick: function() { self.refresh(vnode); },
                }, 'Refresh'),
              ]),
              m('div.bg-white.rounded-lg.shadow.p-4', [
                m('h3.text-sm.font-semibold.mb-2', 'Invalidate by model'),
                m('div.flex.gap-2', [
                  m('input.flex-1.border.rounded.px-3.py-2.text-sm', {
                    placeholder: 'Model name (e.g. User)',
                    value: s.modelName,
                    oninput: function(e) { s.modelName = e.target.value; },
                  }),
                  m('button.px-4.py-2.bg-amber-600.text-white.rounded-md.text-sm', {
                    onclick: function() { self.invalidateModel(vnode); },
                  }, 'Invalidate'),
                ]),
              ]),
            ]),
    ]);
  },
};

function statBox(label, value) {
  return m('div.bg-white.rounded-lg.shadow.p-4', [
    m('p.text-xs.text-gray-500.uppercase', label),
    m('p.text-xl.font-semibold.text-gray-900', value === undefined || value === null ? '—' : String(value)),
  ]);
}

function formatRate(r) {
  if (r === null || r === undefined || isNaN(r)) return '—';
  return (r * 100).toFixed(1) + '%';
}

window.__customPages = window.__customPages || {};
window.__customPages['orm-cache'] = OrmCachePage;
})();
`;
}

module.exports = { generateOrmCacheAdminComponent };

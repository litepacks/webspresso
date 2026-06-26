/**
 * Content entries admin pages — Mithril component source.
 * @module plugins/content/admin/content-entries-component
 */

/**
 * @param {Object} [options]
 * @param {string} [options.apiPrefix='/content']
 */
function generateContentEntriesComponent(options = {}) {
  const apiPrefix = options.apiPrefix || '/content';

  return `
(function() {
  var API = '${apiPrefix}';

  function ContentEntriesListPage() {
  var typeSlug = m.route.param('typeSlug');
  var entries = [];
  var typeMeta = null;
  var loading = true;
  var error = null;

  function load() {
    loading = true;
    return Promise.all([
      api.get(API + '/types/' + encodeURIComponent(typeSlug) + '/schema').catch(function() { return null; }),
      api.get(API + '/types/' + encodeURIComponent(typeSlug) + '/entries'),
    ]).then(function(results) {
      if (results[0]) typeMeta = results[0].data;
      entries = (results[1] && results[1].data) || [];
      loading = false;
    }).catch(function(e) {
      error = e.message;
      loading = false;
    });
  }

  return {
    oninit: load,
    view: function() {
      var title = typeMeta ? typeMeta.name : typeSlug;
      return m(Layout, { breadcrumbs: [
        { label: 'Content Types', href: '/content/types' },
        { label: title, href: '/content/types/' + encodeURIComponent(typeSlug) + '/entries' },
      ]}, [
        m('.flex.items-center.justify-between.mb-6', [
          m('h2.text-2xl.font-bold', title + ' — Entries'),
          m('a.bg-blue-600.text-white.px-4.py-2.rounded.text-sm', {
            href: '/content/types/' + encodeURIComponent(typeSlug) + '/entries/new',
          }, 'New Entry'),
        ]),
        loading ? m('p.text-gray-500', 'Loading…') : null,
        error ? m('.bg-red-50.text-red-700.p-4.rounded', error) : null,
        !loading && !error ? m('.bg-white.dark:bg-slate-800.rounded-lg.shadow.overflow-hidden', [
          m('table.w-full.text-sm', [
            m('thead.bg-gray-50', m('tr', [
              m('th.text-left.p-3', 'Title'),
              m('th.text-left.p-3', 'Slug'),
              m('th.text-left.p-3', 'Status'),
              m('th.text-right.p-3', 'Actions'),
            ])),
            m('tbody', entries.map(function(e) {
              return m('tr.border-t', [
                m('td.p-3', e.title || '—'),
                m('td.p-3.text-gray-500', e.slug),
                m('td.p-3', m('span.px-2.py-0.5.rounded.text-xs', {
                  class: e.status === 'published' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800',
                }, e.status)),
                m('td.p-3.text-right', m('a.text-blue-600', {
                  href: '/content/types/' + encodeURIComponent(typeSlug) + '/entries/edit/' + e.id,
                }, 'Edit')),
              ]);
            })),
          ]),
          entries.length === 0 ? m('p.p-6.text-gray-500', 'No entries yet.') : null,
        ]) : null,
      ]);
    },
  };
  }

  function fieldInput(field, formData, uploadUrl) {
    var val = formData[field.name];
    var label = field.label || field.name;

    if (field.type === 'boolean') {
      return m('label.flex.items-center.gap-2', [
        m('input', { type: 'checkbox', checked: !!val, onchange: function(e) { formData[field.name] = e.target.checked; } }),
        label,
      ]);
    }
    if (field.type === 'textarea' || field.type === 'rich-text') {
      return m('div', [
        m('label.block.text-sm.font-medium.mb-1', label),
        m('textarea.w-full.border.rounded.px-3.py-2.min-h-24', {
          value: val || '',
          oninput: function(e) { formData[field.name] = e.target.value; },
        }),
      ]);
    }
    if (field.type === 'select') {
      return m('div', [
        m('label.block.text-sm.font-medium.mb-1', label),
        m('select.w-full.border.rounded.px-3.py-2', {
          value: val || '',
          onchange: function(e) { formData[field.name] = e.target.value; },
        }, (field.options || []).map(function(o) { return m('option', { value: o }, o); })),
      ]);
    }
    if (field.type === 'image' && uploadUrl) {
      return m('div', [
        m('label.block.text-sm.font-medium.mb-1', label),
        m('input.w-full.border.rounded.px-3.py-2.mb-2', {
          value: val || '',
          placeholder: 'Image URL',
          oninput: function(e) { formData[field.name] = e.target.value; },
        }),
        m('input', {
          type: 'file',
          accept: 'image/*',
          onchange: function(e) {
            var file = e.target.files && e.target.files[0];
            if (!file) return;
            var fd = new FormData();
            fd.append('file', file);
            fetch(uploadUrl, { method: 'POST', body: fd, credentials: 'include' })
              .then(function(r) { return r.json(); })
              .then(function(res) {
                if (res.url) { formData[field.name] = res.url; m.redraw(); }
              });
          },
        }),
      ]);
    }
    if (field.type === 'repeater') {
      var items = Array.isArray(val) ? val : [];
      return m('div.space-y-3', [
        m('label.block.text-sm.font-medium', label),
        items.map(function(item, idx) {
          return m('.border.rounded.p-3.space-y-2', [
            m('.text-xs.text-gray-500', 'Item ' + (idx + 1)),
            (field.fields || []).map(function(nf) {
              return fieldInput(nf, item, uploadUrl);
            }),
            m('button.text-xs.text-red-600', {
              type: 'button',
              onclick: function() { items.splice(idx, 1); formData[field.name] = items; },
            }, 'Remove'),
          ]);
        }),
        m('button.text-sm.text-blue-600', {
          type: 'button',
          onclick: function() {
            var row = {};
            (field.fields || []).forEach(function(nf) { row[nf.name] = ''; });
            items.push(row);
            formData[field.name] = items;
          },
        }, '+ Add item'),
      ]);
    }
    var inputType = field.type === 'number' ? 'number' : (field.type === 'date' ? 'date' : 'text');
    return m('div', [
      m('label.block.text-sm.font-medium.mb-1', label),
      m('input.w-full.border.rounded.px-3.py-2', {
        type: inputType,
        value: val != null ? val : '',
        oninput: function(e) {
          formData[field.name] = field.type === 'number' ? Number(e.target.value) : e.target.value;
        },
      }),
    ]);
  }

  function ContentEntryFormPage() {
  var typeSlug = m.route.param('typeSlug');
  var id = m.route.param('id');
  var isNew = !id || id === 'new';
  var schema = { fields: [] };
  var form = { slug: '', title: '', status: 'published', data: {} };
  var loading = true;
  var saving = false;
  var error = null;
  var uploadUrl = (window.__ADMIN_CONFIG__ && window.__ADMIN_CONFIG__.uploadUrl) || null;

  function load() {
    return api.get(API + '/types/' + encodeURIComponent(typeSlug) + '/schema').then(function(res) {
      schema = res.data.schema || { fields: [] };
      if (!isNew) {
        return api.get(API + '/entries/' + id).then(function(entryRes) {
          var e = entryRes.data;
          form.slug = e.slug;
          form.title = e.title || '';
          form.status = e.status || 'published';
          form.data = e.data || {};
          loading = false;
        });
      }
      loading = false;
    }).catch(function(e) {
      error = e.message;
      loading = false;
    });
  }

  return {
    oninit: load,
    view: function() {
      if (loading) return m(Layout, m('p.p-8', 'Loading…'));
      return m(Layout, { breadcrumbs: [
        { label: 'Content Types', href: '/content/types' },
        { label: typeSlug, href: '/content/types/' + encodeURIComponent(typeSlug) + '/entries' },
        { label: isNew ? 'New' : 'Edit', href: '#' },
      ]}, [
        m('h2.text-2xl.font-bold.mb-6', isNew ? 'New Entry' : 'Edit Entry'),
        error ? m('.bg-red-50.text-red-700.p-4.rounded.mb-4', error) : null,
        m('form.bg-white.dark:bg-slate-800.rounded-lg.shadow.p-6.space-y-4', {
          onsubmit: function(e) {
            e.preventDefault();
            saving = true;
            var payload = {
              slug: form.slug,
              title: form.title || null,
              status: form.status,
              data: form.data,
            };
            var req = isNew
              ? api.post(API + '/types/' + encodeURIComponent(typeSlug) + '/entries', payload)
              : api.put(API + '/entries/' + id, payload);
            req.then(function() {
              m.route.set('/content/types/' + encodeURIComponent(typeSlug) + '/entries');
            }).catch(function(err) {
              error = err.message;
              saving = false;
              m.redraw();
            });
          },
        }, [
          m('.grid.grid-cols-2.gap-4', [
            m('div', [
              m('label.block.text-sm.font-medium.mb-1', 'Slug'),
              m('input.w-full.border.rounded.px-3.py-2', {
                value: form.slug,
                disabled: !isNew,
                oninput: function(e) { form.slug = e.target.value; },
              }),
            ]),
            m('div', [
              m('label.block.text-sm.font-medium.mb-1', 'Title'),
              m('input.w-full.border.rounded.px-3.py-2', {
                value: form.title,
                oninput: function(e) { form.title = e.target.value; },
              }),
            ]),
          ]),
          m('div', [
            m('label.block.text-sm.font-medium.mb-1', 'Status'),
            m('select.w-full.border.rounded.px-3.py-2', {
              value: form.status,
              onchange: function(e) { form.status = e.target.value; },
            }, [
              m('option', { value: 'published' }, 'Published'),
              m('option', { value: 'draft' }, 'Draft'),
            ]),
          ]),
          m('hr'),
          schema.fields.map(function(f) {
            return fieldInput(f, form.data, uploadUrl);
          }),
          m('.flex.justify-end.gap-3', [
            m('a.px-4.py-2.border.rounded', {
              href: '/content/types/' + encodeURIComponent(typeSlug) + '/entries',
            }, 'Cancel'),
            m('button.px-4.py-2.bg-blue-600.text-white.rounded', { disabled: saving }, saving ? 'Saving…' : 'Save'),
          ]),
        ]),
      ]);
    },
  };
  }

  window.__customPages = window.__customPages || {};
  window.__customPages['content-entries'] = ContentEntriesListPage;
  window.__customPages['content-entries-new'] = ContentEntryFormPage;
  window.__customPages['content-entries-edit'] = ContentEntryFormPage;
})();
`;
}

module.exports = { generateContentEntriesComponent };

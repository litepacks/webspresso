/**
 * Content types admin page — Mithril component source.
 * @module plugins/content/admin/content-types-component
 */

/**
 * @param {Object} [options]
 * @param {string} [options.apiPrefix='/content']
 */
function generateContentTypesComponent(options = {}) {
  const apiPrefix = options.apiPrefix || '/content';

  return `
(function() {
  var API = '${apiPrefix}';
  var FIELD_TYPES = ['text','textarea','rich-text','number','boolean','image','url','date','select','repeater'];

  function emptyField() {
    return { name: '', type: 'text', label: '', required: false, options: [], fields: [] };
  }

  function ContentTypesListPage() {
  var types = [];
  var loading = true;
  var error = null;

  function load() {
    loading = true;
    error = null;
    return api.get(API + '/types').then(function(res) {
      types = res.data || [];
      loading = false;
    }).catch(function(e) {
      error = e.message || String(e);
      loading = false;
    });
  }

  return {
    oninit: load,
    view: function() {
      return m(Layout, { breadcrumbs: [{ label: 'Content Types', href: '/content/types' }] }, [
        m('.flex.items-center.justify-between.mb-6', [
          m('h2.text-2xl.font-bold.text-gray-900.dark:text-slate-100', 'Content Types'),
          m('a.bg-blue-600.text-white.px-4.py-2.rounded-lg.text-sm', { href: '/content/types/new' }, 'New Type'),
        ]),
        loading ? m('p.text-gray-500', 'Loading…') : null,
        error ? m('.bg-red-50.text-red-700.p-4.rounded', error) : null,
        !loading && !error ? m('.bg-white.dark:bg-slate-800.rounded-lg.shadow.overflow-hidden', [
          m('table.w-full.text-sm', [
            m('thead.bg-gray-50.dark:bg-slate-900', m('tr', [
              m('th.text-left.p-3', 'Name'),
              m('th.text-left.p-3', 'Slug'),
              m('th.text-left.p-3', 'Fields'),
              m('th.text-right.p-3', 'Actions'),
            ])),
            m('tbody', types.map(function(t) {
              return m('tr.border-t.border-gray-100.dark:border-slate-700', [
                m('td.p-3.font-medium', t.name),
                m('td.p-3.text-gray-500', t.slug),
                m('td.p-3.text-gray-500', (t.schema && t.schema.fields ? t.schema.fields.length : 0)),
                m('td.p-3.text-right.space-x-2', [
                  m('a.text-blue-600', { href: '/content/types/' + encodeURIComponent(t.slug) + '/entries' }, 'Entries'),
                  m('a.text-gray-600', { href: '/content/types/edit/' + t.id }, 'Edit'),
                ]),
              ]);
            })),
          ]),
          types.length === 0 ? m('p.p-6.text-gray-500', 'No content types yet.') : null,
        ]) : null,
      ]);
    },
  };
  }

  function ContentTypeFormPage() {
  var id = m.route.param('id');
  var isNew = !id || id === 'new';
  var form = { slug: '', name: '', description: '', schema: { fields: [emptyField()] } };
  var loading = !isNew;
  var saving = false;
  var error = null;

  function load() {
    if (isNew) return Promise.resolve();
    return api.get(API + '/types/' + id).then(function(res) {
      var d = res.data;
      form.slug = d.slug;
      form.name = d.name;
      form.description = d.description || '';
      form.schema = d.schema || { fields: [] };
      if (!form.schema.fields || form.schema.fields.length === 0) {
        form.schema.fields = [emptyField()];
      }
      loading = false;
    }).catch(function(e) {
      error = e.message;
      loading = false;
    });
  }

  function renderFieldEditor(field, path, onRemove) {
    return m('.border.border-gray-200.dark:border-slate-600.rounded.p-4.space-y-3', [
      m('.grid.grid-cols-2.gap-3', [
        m('div', [
          m('label.block.text-xs.text-gray-500.mb-1', 'Name'),
          m('input.w-full.border.rounded.px-2.py-1', {
            value: field.name,
            oninput: function(e) { field.name = e.target.value; },
          }),
        ]),
        m('div', [
          m('label.block.text-xs.text-gray-500.mb-1', 'Type'),
          m('select.w-full.border.rounded.px-2.py-1', {
            value: field.type,
            onchange: function(e) { field.type = e.target.value; },
          }, FIELD_TYPES.map(function(t) { return m('option', { value: t }, t); })),
        ]),
        m('div', [
          m('label.block.text-xs.text-gray-500.mb-1', 'Label'),
          m('input.w-full.border.rounded.px-2.py-1', {
            value: field.label || '',
            oninput: function(e) { field.label = e.target.value; },
          }),
        ]),
        m('div.flex.items-end', [
          m('label.flex.items-center.gap-2.text-sm', [
            m('input', { type: 'checkbox', checked: !!field.required, onchange: function(e) { field.required = e.target.checked; } }),
            'Required',
          ]),
        ]),
      ]),
      field.type === 'select' ? m('div', [
        m('label.block.text-xs.text-gray-500.mb-1', 'Options (comma-separated)'),
        m('input.w-full.border.rounded.px-2.py-1', {
          value: (field.options || []).join(', '),
          oninput: function(e) {
            field.options = e.target.value.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
          },
        }),
      ]) : null,
      field.type === 'repeater' ? m('.pl-4.border-l-2.border-blue-200.space-y-2', [
        m('p.text-xs.text-gray-500', 'Nested fields'),
        (field.fields || []).map(function(nf, idx) {
          return renderFieldEditor(nf, path + '.fields.' + idx, function() {
            field.fields.splice(idx, 1);
          });
        }),
        m('button.text-sm.text-blue-600', {
          type: 'button',
          onclick: function() {
            field.fields = field.fields || [];
            field.fields.push(emptyField());
          },
        }, '+ Add nested field'),
      ]) : null,
      onRemove ? m('button.text-sm.text-red-600', { type: 'button', onclick: onRemove }, 'Remove field') : null,
    ]);
  }

  return {
    oninit: load,
    view: function() {
      if (loading) return m(Layout, m('p.p-8.text-gray-500', 'Loading…'));
      return m(Layout, { breadcrumbs: [
        { label: 'Content Types', href: '/content/types' },
        { label: isNew ? 'New' : 'Edit', href: '#' },
      ]}, [
        m('h2.text-2xl.font-bold.mb-6', isNew ? 'New Content Type' : 'Edit Content Type'),
        error ? m('.bg-red-50.text-red-700.p-4.rounded.mb-4', error) : null,
        m('form.bg-white.dark:bg-slate-800.rounded-lg.shadow.p-6.space-y-4', {
          onsubmit: function(e) {
            e.preventDefault();
            saving = true;
            error = null;
            var payload = {
              slug: form.slug,
              name: form.name,
              description: form.description || null,
              schema: form.schema,
            };
            var req = isNew
              ? api.post(API + '/types', payload)
              : api.put(API + '/types/' + id, payload);
            req.then(function() {
              m.route.set('/content/types');
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
              m('label.block.text-sm.font-medium.mb-1', 'Name'),
              m('input.w-full.border.rounded.px-3.py-2', {
                value: form.name,
                oninput: function(e) { form.name = e.target.value; },
              }),
            ]),
          ]),
          m('div', [
            m('label.block.text-sm.font-medium.mb-1', 'Description'),
            m('textarea.w-full.border.rounded.px-3.py-2', {
              value: form.description,
              oninput: function(e) { form.description = e.target.value; },
            }),
          ]),
          m('div', [
            m('.flex.items-center.justify-between.mb-2', [
              m('h3.font-semibold', 'Fields'),
              m('button.text-sm.text-blue-600', {
                type: 'button',
                onclick: function() { form.schema.fields.push(emptyField()); },
              }, '+ Add field'),
            ]),
            form.schema.fields.map(function(f, i) {
              return renderFieldEditor(f, String(i), function() {
                form.schema.fields.splice(i, 1);
              });
            }),
          ]),
          m('.flex.justify-end.gap-3.pt-4', [
            m('a.px-4.py-2.border.rounded', { href: '/content/types' }, 'Cancel'),
            m('button.px-4.py-2.bg-blue-600.text-white.rounded', { disabled: saving }, saving ? 'Saving…' : 'Save'),
          ]),
        ]),
      ]);
    },
  };
  }

  window.__customPages = window.__customPages || {};
  window.__customPages['content-types'] = ContentTypesListPage;
  window.__customPages['content-types-new'] = ContentTypeFormPage;
  window.__customPages['content-types-edit'] = ContentTypeFormPage;
})();
`;
}

module.exports = { generateContentTypesComponent };

/**
 * Admin Panel Components
 * Mithril.js components for admin panel UI
 */

module.exports = `
// API helper
const api = {
  async request(path, options = {}) {
    const adminPath = window.__ADMIN_PATH__ || '/_admin';
    const url = adminPath + '/api' + path;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      credentials: 'include',
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }
    
    return response.json();
  },
  
  get(path) { return this.request(path, { method: 'GET' }); },
  post(path, data) { return this.request(path, { method: 'POST', body: JSON.stringify(data) }); },
  put(path, data) { return this.request(path, { method: 'PUT', body: JSON.stringify(data) }); },
  delete(path) { return this.request(path, { method: 'DELETE' }); },
};

// State
const state = {
  user: null,
  needsSetup: false,
  loading: false,
  error: null,
  models: [],
  currentModel: null,
  records: [],
  pagination: null,
  currentRecord: null,
  editing: false,
};

// Login Form Component
const LoginForm = {
  view: () => m('.max-w-md.mx-auto.mt-16', [
    m('h1.text-3xl.font-bold.mb-6', 'Admin Login'),
    m('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        state.loading = true;
        state.error = null;
        try {
          const data = new FormData(e.target);
          const result = await api.post('/auth/login', {
            email: data.get('email'),
            password: data.get('password'),
          });
          state.user = result.user;
          m.route.set('/');
        } catch (err) {
          state.error = err.message;
        } finally {
          state.loading = false;
        }
      }
    }, [
      state.error ? m('.bg-red-100.border.border-red-400.text-red-700.px-4.py-3.rounded.mb-4', state.error) : null,
      m('.mb-4', [
        m('label.block.text-sm.font-medium.mb-2', { for: 'email' }, 'Email'),
        m('input#email.w-full.px-3.py-2.border.border-gray-300.rounded', {
          type: 'email',
          name: 'email',
          required: true,
        }),
      ]),
      m('.mb-4', [
        m('label.block.text-sm.font-medium.mb-2', { for: 'password' }, 'Password'),
        m('input#password.w-full.px-3.py-2.border.border-gray-300.rounded', {
          type: 'password',
          name: 'password',
          required: true,
        }),
      ]),
      m('button.w-full.bg-blue-600.text-white.py-2.px-4.rounded.hover:bg-blue-700', {
        type: 'submit',
        disabled: state.loading,
      }, state.loading ? 'Logging in...' : 'Login'),
    ]),
  ]),
};

// Setup Form Component
const SetupForm = {
  view: () => m('.max-w-md.mx-auto.mt-16', [
    m('h1.text-3xl.font-bold.mb-6', 'Setup Admin Account'),
    m('p.text-gray-600.mb-6', 'Create the first admin user account.'),
    m('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        state.loading = true;
        state.error = null;
        try {
          const data = new FormData(e.target);
          const result = await api.post('/auth/setup', {
            email: data.get('email'),
            password: data.get('password'),
            name: data.get('name'),
          });
          state.user = result.user;
          state.needsSetup = false;
          m.route.set('/');
        } catch (err) {
          state.error = err.message;
        } finally {
          state.loading = false;
        }
      }
    }, [
      state.error ? m('.bg-red-100.border.border-red-400.text-red-700.px-4.py-3.rounded.mb-4', state.error) : null,
      m('.mb-4', [
        m('label.block.text-sm.font-medium.mb-2', { for: 'name' }, 'Name'),
        m('input#name.w-full.px-3.py-2.border.border-gray-300.rounded', {
          type: 'text',
          name: 'name',
          required: true,
        }),
      ]),
      m('.mb-4', [
        m('label.block.text-sm.font-medium.mb-2', { for: 'email' }, 'Email'),
        m('input#email.w-full.px-3.py-2.border.border-gray-300.rounded', {
          type: 'email',
          name: 'email',
          required: true,
        }),
      ]),
      m('.mb-4', [
        m('label.block.text-sm.font-medium.mb-2', { for: 'password' }, 'Password'),
        m('input#password.w-full.px-3.py-2.border.border-gray-300.rounded', {
          type: 'password',
          name: 'password',
          required: true,
        }),
      ]),
      m('button.w-full.bg-blue-600.text-white.py-2.px-4.rounded.hover:bg-blue-700', {
        type: 'submit',
        disabled: state.loading,
      }, state.loading ? 'Creating...' : 'Create Admin Account'),
    ]),
  ]),
};

// Layout Component
const Layout = {
  view: (vnode) => m('.min-h-screen.bg-gray-100', [
    m('.bg-white.shadow', [
      m('.max-w-7xl.mx-auto.px-4.py-4', [
        m('.flex.items-center.justify-between', [
          m('h1.text-xl.font-bold', 'Admin Panel'),
          state.user ? m('.flex.items-center.gap-4', [
            m('span.text-sm.text-gray-600', state.user.name || state.user.email),
            m('button.text-sm.text-red-600.hover:text-red-800', {
              onclick: async () => {
                await api.post('/auth/logout');
                state.user = null;
                m.route.set('/login');
              }
            }, 'Logout'),
          ]) : null,
        ]),
      ]),
    ]),
    m('.max-w-7xl.mx-auto.px-4.py-6', vnode.children),
  ]),
};

// Model List Component
const ModelList = {
  oninit: () => {
    state.loading = true;
    state.error = null;
    api.get('/models')
      .then(result => {
        state.models = result.models || [];
      })
      .catch(err => {
        state.error = err.message;
      })
      .finally(() => {
        state.loading = false;
        m.redraw();
      });
  },
  view: () => m(Layout, [
    m('h2.text-2xl.font-bold.mb-6', 'Models'),
    state.error ? m('.bg-red-100.border.border-red-400.text-red-700.px-4.py-3.rounded.mb-4', state.error) : null,
    state.loading
      ? m('p.text-gray-600', 'Loading models...')
      : state.models.length === 0
        ? m('p.text-gray-600', 'No models enabled in admin panel. Make sure your models have admin: { enabled: true }')
        : m('.grid.grid-cols-1.md:grid-cols-2.lg:grid-cols-3.gap-4', 
            state.models.map(model => 
              m('a.bg-white.p-6.rounded.shadow.hover:shadow-lg.transition', {
                href: '/models/' + model.name,
                onclick: (e) => {
                  e.preventDefault();
                  m.route.set('/models/' + model.name);
                }
              }, [
                model.icon ? m('span.text-2xl.mb-2.block', model.icon) : null,
                m('h3.font-semibold.text-lg', model.label || model.name),
                m('p.text-sm.text-gray-600.mt-2', model.table),
              ])
            )
          ),
  ]),
};

// Record List Component (placeholder - will be enhanced with field renderers)
const RecordList = {
  oninit: (vnode) => {
    const modelName = vnode.attrs.model;
    state.loading = true;
    state.error = null;
    state.records = [];
    
    // Load model metadata if not already loaded
    const loadModel = state.models.length === 0 
      ? api.get('/models').then(r => { state.models = r.models || []; })
      : Promise.resolve();
    
    loadModel
      .then(() => api.get('/models/' + modelName + '/records'))
      .then(result => {
        state.records = result.data || [];
        state.pagination = result.pagination || null;
        state.currentModel = state.models.find(m => m.name === modelName);
      })
      .catch(err => {
        state.error = err.message;
      })
      .finally(() => {
        state.loading = false;
        m.redraw();
      });
  },
  view: (vnode) => {
    const modelName = vnode.attrs.model;
    return m(Layout, [
      m('.flex.items-center.justify-between.mb-6', [
        m('h2.text-2xl.font-bold', state.currentModel?.label || modelName),
        m('button.bg-blue-600.text-white.px-4.py-2.rounded.hover:bg-blue-700', {
          onclick: () => {
            state.currentRecord = null;
            state.editing = true;
            m.route.set('/models/' + modelName + '/new');
          }
        }, 'New Record'),
      ]),
      state.error ? m('.bg-red-100.border.border-red-400.text-red-700.px-4.py-3.rounded.mb-4', state.error) : null,
      state.loading
        ? m('p.text-gray-600', 'Loading records...')
        : state.records.length === 0
          ? m('p.text-gray-600', 'No records found.')
          : m('.bg-white.rounded.shadow.overflow-hidden', [
            m('table.w-full', [
              m('thead.bg-gray-50', [
                m('tr', [
                  m('th.px-6.py-3.text-left.text-xs.font-medium.text-gray-500.uppercase', 'ID'),
                  m('th.px-6.py-3.text-left.text-xs.font-medium.text-gray-500.uppercase', 'Data'),
                  m('th.px-6.py-3.text-left.text-xs.font-medium.text-gray-500.uppercase', 'Actions'),
                ]),
              ]),
              m('tbody', state.records.map(record => 
                m('tr.border-t', [
                  m('td.px-6.py-4.text-sm', record.id || record[state.currentModel?.primaryKey || 'id']),
                  m('td.px-6.py-4.text-sm.text-gray-600', JSON.stringify(record).substring(0, 100) + '...'),
                  m('td.px-6.py-4.text-sm', [
                    m('button.text-blue-600.hover:text-blue-800.mr-4', {
                      onclick: () => {
                        state.currentRecord = record;
                        state.editing = true;
                        m.route.set('/models/' + modelName + '/edit/' + (record.id || record[state.currentModel?.primaryKey || 'id']));
                      }
                    }, 'Edit'),
                    m('button.text-red-600.hover:text-red-800', {
                      onclick: async () => {
                        if (confirm('Are you sure you want to delete this record?')) {
                          try {
                            await api.delete('/models/' + modelName + '/records/' + (record.id || record[state.currentModel?.primaryKey || 'id']));
                            m.route.set('/models/' + modelName);
                          } catch (err) {
                            alert('Error: ' + err.message);
                          }
                        }
                      }
                    }, 'Delete'),
                  ]),
                ])
              )),
            ]),
          ]),
    ]);
  },
};

// Record Form Component (placeholder - will be enhanced with field renderers)
const RecordForm = {
  oninit: (vnode) => {
    const { model: modelName, id } = vnode.attrs;
    state.error = null;
    
    if (id && id !== 'new') {
      state.loading = true;
      api.get('/models/' + modelName + '/records/' + id)
        .then(result => {
          state.currentRecord = result.data;
        })
        .catch(err => {
          state.error = err.message;
        })
        .finally(() => {
          state.loading = false;
          m.redraw();
        });
    } else {
      state.currentRecord = {};
    }
  },
  view: (vnode) => {
    const { model: modelName, id } = vnode.attrs;
    const isNew = !id || id === 'new';
    return m(Layout, [
      m('h2.text-2xl.font-bold.mb-6', isNew ? 'New Record' : 'Edit Record'),
      m('form.bg-white.p-6.rounded.shadow', {
        onsubmit: async (e) => {
          e.preventDefault();
          state.loading = true;
          state.error = null;
          try {
            const data = new FormData(e.target);
            const record = {};
            for (const [key, value] of data.entries()) {
              record[key] = value;
            }
            if (isNew) {
              await api.post('/models/' + modelName + '/records', record);
            } else {
              await api.put('/models/' + modelName + '/records/' + id, record);
            }
            m.route.set('/models/' + modelName);
          } catch (err) {
            state.error = err.message;
          } finally {
            state.loading = false;
          }
        }
      }, [
        state.error ? m('.bg-red-100.border.border-red-400.text-red-700.px-4.py-3.rounded.mb-4', state.error) : null,
        m('p.text-gray-600.mb-4', 'Form fields will be rendered here based on model schema.'),
        m('.flex.gap-4', [
          m('button.bg-blue-600.text-white.px-6.py-2.rounded.hover:bg-blue-700', {
            type: 'submit',
            disabled: state.loading,
          }, state.loading ? 'Saving...' : 'Save'),
          m('a.bg-gray-200.text-gray-800.px-6.py-2.rounded.hover:bg-gray-300', {
            href: '/models/' + modelName,
            onclick: (e) => {
              e.preventDefault();
              m.route.set('/models/' + modelName);
            }
          }, 'Cancel'),
        ]),
      ]),
    ]);
  },
};

// Export components
window.__ADMIN_COMPONENTS__ = {
  LoginForm,
  SetupForm,
  Layout,
  ModelList,
  RecordList,
  RecordForm,
  api,
  state,
};
`;

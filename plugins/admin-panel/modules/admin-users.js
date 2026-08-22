/**
 * Admin Panel - Admin User Management Module
 * Manages administrative staff users in admin_users table
 * @module plugins/admin-panel/modules/admin-users
 */

const { hash } = require('../../../core/auth/hash');

/**
 * DBs like SQLite store booleans as 0/1; Postgres/MySQL use real booleans.
 */
function truthyBooleanForDb(db) {
  try {
    const client = db?.knex?.client?.config?.client;
    if (client === 'sqlite3' || client === 'better-sqlite3') return 1;
  } catch (_) {}
  return true;
}

function normalizeBoolean(val) {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val === 'true' || val === '1';
  if (typeof val === 'number') return val === 1;
  return Boolean(val);
}

/**
 * Sanitize admin user object to never return password or sensitive internal props
 */
function sanitizeAdminUser(user) {
  if (!user) return null;
  const { password, ...safeUser } = user;
  return {
    ...safeUser,
    active: Boolean(safeUser.active),
  };
}

/**
 * Register admin user management menu in admin panel
 * @param {Object} options - Options
 * @param {Object} options.registry - Admin registry
 * @param {Object} [options.config] - Admin users config
 */
function registerAdminUsersManagement(options) {
  const { registry, config = {} } = options;

  if (config.enabled === false) return;

  // Register menu item under system group
  registry.registerMenuItem({
    id: 'admin-users-list',
    label: config.label || 'Admin Users',
    path: '/admins',
    icon: config.icon || 'shield',
    group: 'system',
    order: config.order || 50,
  });
}

/**
 * Create Admin Users API handlers
 */
function createAdminUsersApiHandlers(options) {
  const { db, AdminUser, hashPassword } = options;

  const getRepo = () => {
    if (!db || !AdminUser) return null;
    return db.getRepository(AdminUser.name || 'AdminUser');
  };

  /**
   * Helper to count total active admins in system
   */
  async function countActiveAdmins(repo, excludeId = null) {
    let q = repo.query();
    if (excludeId != null) {
      q = q.whereNot('id', excludeId);
    }
    const isSqlite = truthyBooleanForDb(db) === 1;
    if (isSqlite) {
      q = q.where((builder) => builder.where('active', 1).orWhere('active', true));
    } else {
      q = q.where('active', true);
    }
    const countRes = await q.count({ count: '*' });
    const count = Array.isArray(countRes) && countRes[0] ? (countRes[0].count ?? countRes[0]['count(*)']) : 0;
    return Number(count) || 0;
  }

  /**
   * List all admin users
   */
  async function listAdmins(req, res) {
    try {
      const repo = getRepo();
      if (!repo) {
        return res.status(500).json({ error: 'Admin user repository not available' });
      }

      const { search, role, active } = req.query || {};
      let query = repo.query();

      if (search) {
        const term = `%${search.trim()}%`;
        query = query.where((builder) => {
          builder.where('email', 'like', term).orWhere('name', 'like', term);
        });
      }

      if (role) {
        query = query.where('role', role);
      }

      if (active !== undefined && active !== '') {
        const isActive = active === 'true' || active === '1' || active === true;
        const isSqlite = truthyBooleanForDb(db) === 1;
        if (isSqlite) {
          query = query.where('active', isActive ? 1 : 0);
        } else {
          query = query.where('active', isActive);
        }
      }

      query = query.orderBy('created_at', 'desc');

      const users = await query;
      const safeUsers = (users || []).map(sanitizeAdminUser);

      res.json({
        success: true,
        data: safeUsers,
        total: safeUsers.length,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get single admin user
   */
  async function getAdmin(req, res) {
    try {
      const repo = getRepo();
      if (!repo) {
        return res.status(500).json({ error: 'Admin user repository not available' });
      }

      const { id } = req.params;
      const user = await repo.findById(id);
      if (!user) {
        return res.status(404).json({ error: 'Admin user not found' });
      }

      res.json({
        success: true,
        data: sanitizeAdminUser(user),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Create new admin user
   */
  async function createAdmin(req, res) {
    try {
      const repo = getRepo();
      if (!repo) {
        return res.status(500).json({ error: 'Admin user repository not available' });
      }

      const { email, password, name, role = 'admin', active = true } = req.body || {};

      if (!email || !String(email).trim()) {
        return res.status(400).json({ error: 'Email is required' });
      }
      const cleanEmail = String(email).trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        return res.status(400).json({ error: 'Invalid email address format' });
      }

      if (!password || String(password).length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }

      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'Name is required' });
      }

      // Check if email already exists
      const existing = await repo.query().where('email', cleanEmail).first();
      if (existing) {
        return res.status(400).json({ error: 'An admin user with this email already exists' });
      }

      // Hash password
      const hasher = hashPassword || ((pw) => hash(pw, 10));
      const hashedPassword = await hasher(password, 10);

      const isActiveBool = normalizeBoolean(active);
      const isSqlite = truthyBooleanForDb(db) === 1;

      const newUser = await repo.create({
        email: cleanEmail,
        password: hashedPassword,
        name: String(name).trim(),
        role: String(role).trim() || 'admin',
        active: isSqlite ? (isActiveBool ? 1 : 0) : isActiveBool,
      });

      res.status(201).json({
        success: true,
        message: 'Admin user created successfully',
        data: sanitizeAdminUser(newUser),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Update admin user
   */
  async function updateAdmin(req, res) {
    try {
      const repo = getRepo();
      if (!repo) {
        return res.status(500).json({ error: 'Admin user repository not available' });
      }

      const { id } = req.params;
      const currentAdmin = req.session?.adminUser;
      const targetUser = await repo.findById(id);

      if (!targetUser) {
        return res.status(404).json({ error: 'Admin user not found' });
      }

      const { email, password, name, role, active } = req.body || {};
      const updates = {};

      // Name
      if (name !== undefined) {
        if (!String(name).trim()) {
          return res.status(400).json({ error: 'Name cannot be empty' });
        }
        updates.name = String(name).trim();
      }

      // Email
      if (email !== undefined) {
        const cleanEmail = String(email).trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(cleanEmail)) {
          return res.status(400).json({ error: 'Invalid email address format' });
        }
        if (cleanEmail !== targetUser.email.toLowerCase()) {
          const duplicate = await repo.query().where('email', cleanEmail).whereNot('id', id).first();
          if (duplicate) {
            return res.status(400).json({ error: 'An admin user with this email already exists' });
          }
          updates.email = cleanEmail;
        }
      }

      // Role
      if (role !== undefined) {
        updates.role = String(role).trim() || 'admin';
      }

      // Active status validation & protection rules
      if (active !== undefined) {
        const desiredActive = normalizeBoolean(active);
        const currentActive = Boolean(targetUser.active);

        if (desiredActive !== currentActive) {
          // Rule 1: Self-deactivation protection
          if (currentAdmin && String(currentAdmin.id) === String(id) && !desiredActive) {
            return res.status(400).json({ error: 'You cannot deactivate your own admin account' });
          }

          // Rule 2: Last active admin protection
          if (!desiredActive && currentActive) {
            const otherActiveCount = await countActiveAdmins(repo, id);
            if (otherActiveCount < 1) {
              return res.status(400).json({ error: 'Cannot deactivate the last active administrator account' });
            }
          }

          const isSqlite = truthyBooleanForDb(db) === 1;
          updates.active = isSqlite ? (desiredActive ? 1 : 0) : desiredActive;
        }
      }

      // Password change (optional)
      if (password !== undefined && String(password).trim() !== '') {
        if (String(password).length < 8) {
          return res.status(400).json({ error: 'New password must be at least 8 characters' });
        }
        const hasher = hashPassword || ((pw) => hash(pw, 10));
        updates.password = await hasher(password, 10);
      }

      if (Object.keys(updates).length > 0) {
        await repo.update(id, updates);
      }

      const updatedUser = await repo.findById(id);

      // If current logged-in admin updated own name or email, sync session
      if (currentAdmin && String(currentAdmin.id) === String(id)) {
        req.session.adminUser = sanitizeAdminUser(updatedUser);
      }

      res.json({
        success: true,
        message: 'Admin user updated successfully',
        data: sanitizeAdminUser(updatedUser),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Delete admin user
   */
  async function deleteAdmin(req, res) {
    try {
      const repo = getRepo();
      if (!repo) {
        return res.status(500).json({ error: 'Admin user repository not available' });
      }

      const { id } = req.params;
      const currentAdmin = req.session?.adminUser;

      // Rule 1: Self-deletion protection
      if (currentAdmin && String(currentAdmin.id) === String(id)) {
        return res.status(400).json({ error: 'You cannot delete your own admin account' });
      }

      const targetUser = await repo.findById(id);
      if (!targetUser) {
        return res.status(404).json({ error: 'Admin user not found' });
      }

      // Rule 2: Last active admin protection
      if (targetUser.active) {
        const otherActiveCount = await countActiveAdmins(repo, id);
        if (otherActiveCount < 1) {
          return res.status(400).json({ error: 'Cannot delete the last active administrator account' });
        }
      }

      await repo.delete(id);

      res.json({
        success: true,
        message: 'Admin user deleted successfully',
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  return {
    listAdmins,
    getAdmin,
    createAdmin,
    updateAdmin,
    deleteAdmin,
  };
}

/**
 * Generate Mithril AdminUsers SPA Component
 */
function generateAdminUsersComponent() {
  return `
const AdminUsersPage = {
  oninit(vnode) {
    vnode.state.loading = true;
    vnode.state.admins = [];
    vnode.state.search = '';
    vnode.state.error = null;
    vnode.state.success = null;

    // Modal state
    vnode.state.modalOpen = false;
    vnode.state.modalMode = 'create'; // 'create' | 'edit'
    vnode.state.modalLoading = false;
    vnode.state.modalError = null;

    // Form fields
    vnode.state.formId = null;
    vnode.state.formName = '';
    vnode.state.formEmail = '';
    vnode.state.formRole = 'admin';
    vnode.state.formActive = true;
    vnode.state.formPassword = '';

    vnode.state.loadAdmins = async function() {
      vnode.state.loading = true;
      vnode.state.error = null;
      try {
        const q = vnode.state.search ? '?search=' + encodeURIComponent(vnode.state.search) : '';
        const res = await api.get('/admins' + q);
        vnode.state.admins = (res && res.data) || [];
      } catch (err) {
        vnode.state.error = err.message || 'Failed to load administrator accounts';
      } finally {
        vnode.state.loading = false;
        m.redraw();
      }
    };

    vnode.state.openCreateModal = function() {
      vnode.state.modalMode = 'create';
      vnode.state.formId = null;
      vnode.state.formName = '';
      vnode.state.formEmail = '';
      vnode.state.formRole = 'admin';
      vnode.state.formActive = true;
      vnode.state.formPassword = '';
      vnode.state.modalError = null;
      vnode.state.modalOpen = true;
    };

    vnode.state.openEditModal = function(admin) {
      vnode.state.modalMode = 'edit';
      vnode.state.formId = admin.id;
      vnode.state.formName = admin.name || '';
      vnode.state.formEmail = admin.email || '';
      vnode.state.formRole = admin.role || 'admin';
      vnode.state.formActive = Boolean(admin.active);
      vnode.state.formPassword = '';
      vnode.state.modalError = null;
      vnode.state.modalOpen = true;
    };

    vnode.state.saveAdmin = async function(e) {
      if (e) e.preventDefault();
      const s = vnode.state;
      s.modalLoading = true;
      s.modalError = null;
      s.success = null;

      try {
        if (s.modalMode === 'create') {
          if (!s.formPassword || s.formPassword.length < 8) {
            s.modalError = 'Password must be at least 8 characters';
            s.modalLoading = false;
            m.redraw();
            return;
          }
          await api.post('/admins', {
            name: s.formName,
            email: s.formEmail,
            role: s.formRole,
            active: s.formActive,
            password: s.formPassword,
          });
          s.success = 'Administrator created successfully';
        } else {
          const payload = {
            name: s.formName,
            email: s.formEmail,
            role: s.formRole,
            active: s.formActive,
          };
          if (s.formPassword && s.formPassword.trim()) {
            if (s.formPassword.length < 8) {
              s.modalError = 'New password must be at least 8 characters';
              s.modalLoading = false;
              m.redraw();
              return;
            }
            payload.password = s.formPassword;
          }
          await api.put('/admins/' + encodeURIComponent(s.formId), payload);
          s.success = 'Administrator updated successfully';
        }

        s.modalOpen = false;
        await s.loadAdmins();
      } catch (err) {
        s.modalError = err.message || 'Failed to save administrator';
      } finally {
        s.modalLoading = false;
        m.redraw();
      }
    };

    vnode.state.deleteAdmin = async function(admin) {
      if (!confirm('Are you sure you want to delete administrator "' + (admin.name || admin.email) + '"? This action cannot be undone.')) {
        return;
      }
      vnode.state.loading = true;
      vnode.state.error = null;
      vnode.state.success = null;
      try {
        await api.delete('/admins/' + encodeURIComponent(admin.id));
        vnode.state.success = 'Administrator deleted successfully';
        await vnode.state.loadAdmins();
      } catch (err) {
        vnode.state.error = err.message || 'Failed to delete administrator';
        vnode.state.loading = false;
        m.redraw();
      }
    };

    vnode.state.loadAdmins();
  },

  view(vnode) {
    const s = vnode.state;
    const currentAdminId = (state && state.user && state.user.id) ? String(state.user.id) : null;

    return m(Layout, { breadcrumbs: [{ label: 'System', href: '/' }, { label: 'Admin Users', href: '/admins' }] }, [
      m('div.space-y-6', [
        // Page Header
        m('div.flex.flex-col.sm:flex-row.sm:items-center.sm:justify-between.gap-4', [
          m('div', [
            m('h1.text-2xl.font-bold.text-gray-900.dark:text-slate-100.flex.items-center.gap-2', [
              m(Icon, { name: 'shield', class: 'w-7 h-7 text-blue-600 dark:text-blue-400' }),
              'Admin Users',
            ]),
            m('p.text-sm.text-gray-500.dark:text-slate-400', 'Manage administrator accounts, roles, and access credentials'),
          ]),
          m('div.flex.items-center.gap-3', [
            m('button.px-4.py-2.bg-blue-600.hover:bg-blue-700.text-white.font-medium.text-sm.rounded-lg.shadow-sm.transition-colors.flex.items-center.gap-2', {
              onclick: s.openCreateModal,
            }, [
              m(Icon, { name: 'plus', class: 'w-4 h-4' }),
              'New Administrator',
            ]),
          ]),
        ]),

        // Flash Alerts
        s.error && m('div.p-4.rounded-lg.bg-red-50.dark:bg-red-900/30.border.border-red-200.dark:border-red-800.text-red-700.dark:text-red-300.text-sm.flex.items-center.justify-between', [
          m('span', s.error),
          m('button.text-red-500.hover:text-red-700', { onclick: () => { s.error = null; } }, m(Icon, { name: 'x', class: 'w-4 h-4' })),
        ]),
        s.success && m('div.p-4.rounded-lg.bg-green-50.dark:bg-green-900/30.border.border-green-200.dark:border-green-800.text-green-700.dark:text-green-300.text-sm.flex.items-center.justify-between', [
          m('span', s.success),
          m('button.text-green-500.hover:text-green-700', { onclick: () => { s.success = null; } }, m(Icon, { name: 'x', class: 'w-4 h-4' })),
        ]),

        // Search and Filter Bar
        m('div.flex.items-center.gap-3.bg-white.dark:bg-slate-800.p-4.rounded-xl.border.border-gray-200.dark:border-slate-700.shadow-sm', [
          m('div.relative.flex-1', [
            m('div.absolute.inset-y-0.left-0.pl-3.flex.items-center.pointer-events-none', m(Icon, { name: 'search', class: 'w-4 h-4 text-gray-400' })),
            m('input.w-full.pl-9.pr-4.py-2.text-sm.border.border-gray-300.dark:border-slate-600.rounded-lg.bg-white.dark:bg-slate-900.text-gray-900.dark:text-slate-100.focus:ring-2.focus:ring-blue-500', {
              type: 'text',
              placeholder: 'Search administrators by name or email...',
              value: s.search,
              oninput: (e) => { s.search = e.target.value; },
              onkeyup: (e) => { if (e.key === 'Enter') s.loadAdmins(); },
            }),
          ]),
          m('button.px-4.py-2.bg-gray-100.dark:bg-slate-700.hover:bg-gray-200.dark:hover:bg-slate-600.text-gray-700.dark:text-slate-200.text-sm.font-medium.rounded-lg.transition-colors', {
            onclick: s.loadAdmins,
          }, 'Filter'),
        ]),

        // Admin Users Table
        m('div.bg-white.dark:bg-slate-800.rounded-xl.border.border-gray-200.dark:border-slate-700.shadow-sm.overflow-hidden', [
          s.loading
            ? m('div.flex.justify-center.items-center.py-16', m(Spinner))
            : s.admins.length === 0
              ? m('div.text-center.py-16', [
                  m(Icon, { name: 'shield', class: 'w-12 h-12 mx-auto text-gray-300 dark:text-slate-600 mb-3' }),
                  m('p.text-base.font-medium.text-gray-900.dark:text-slate-100', 'No administrator accounts found'),
                  m('p.text-sm.text-gray-500.dark:text-slate-400.mt-1', 'Create your first additional admin account or change your search filter.'),
                ])
              : m('div.overflow-x-auto', [
                  m('table.min-w-full.divide-y.divide-gray-200.dark:divide-slate-700.text-sm.text-left', [
                    m('thead.bg-gray-50.dark:bg-slate-900/60', [
                      m('tr', [
                        m('th.px-6.py-3.5.text-xs.font-semibold.text-gray-500.dark:text-slate-400.uppercase.tracking-wider', 'Administrator'),
                        m('th.px-6.py-3.5.text-xs.font-semibold.text-gray-500.dark:text-slate-400.uppercase.tracking-wider', 'Role'),
                        m('th.px-6.py-3.5.text-xs.font-semibold.text-gray-500.dark:text-slate-400.uppercase.tracking-wider', 'Status'),
                        m('th.px-6.py-3.5.text-xs.font-semibold.text-gray-500.dark:text-slate-400.uppercase.tracking-wider', 'Created At'),
                        m('th.px-6.py-3.5.text-right.text-xs.font-semibold.text-gray-500.dark:text-slate-400.uppercase.tracking-wider', 'Actions'),
                      ]),
                    ]),
                    m('tbody.divide-y.divide-gray-200.dark:divide-slate-700', s.admins.map((admin) => {
                      const isSelf = currentAdminId && String(admin.id) === currentAdminId;
                      return m('tr.hover:bg-gray-50/50.dark:hover:bg-slate-700/30.transition-colors', { key: admin.id }, [
                        // User info
                        m('td.px-6.py-4', [
                          m('div.flex.items-center.gap-3', [
                            m('div.w-9.h-9.bg-blue-100.dark:bg-blue-900/50.rounded-full.flex.items-center.justify-center.flex-shrink-0', [
                              m('span.text-sm.font-semibold.text-blue-600.dark:text-blue-300', 
                                (admin.name || admin.email || 'A').charAt(0).toUpperCase()
                              ),
                            ]),
                            m('div', [
                              m('div.flex.items-center.gap-2', [
                                m('span.font-medium.text-gray-900.dark:text-slate-100', admin.name || 'Unnamed'),
                                isSelf && m('span.px-2.py-0.5.text-xs.bg-blue-100.dark:bg-blue-900/50.text-blue-700.dark:text-blue-300.rounded-full.font-medium', 'You'),
                              ]),
                              m('span.text-xs.text-gray-500.dark:text-slate-400', admin.email),
                            ]),
                          ]),
                        ]),

                        // Role
                        m('td.px-6.py-4', [
                          m('span.inline-flex.items-center.px-2.5.py-0.5.rounded-md.text-xs.font-medium.bg-gray-100.dark:bg-slate-700.text-gray-800.dark:text-slate-200', 
                            admin.role || 'admin'
                          ),
                        ]),

                        // Status
                        m('td.px-6.py-4', [
                          admin.active
                            ? m('span.inline-flex.items-center.gap-1.5.px-2.5.py-0.5.rounded-full.text-xs.font-medium.bg-green-100.dark:bg-green-900/40.text-green-800.dark:text-green-300', [
                                m('span.w-1.5.h-1.5.rounded-full.bg-green-500'),
                                'Active',
                              ])
                            : m('span.inline-flex.items-center.gap-1.5.px-2.5.py-0.5.rounded-full.text-xs.font-medium.bg-red-100.dark:bg-red-900/40.text-red-800.dark:text-red-300', [
                                m('span.w-1.5.h-1.5.rounded-full.bg-red-500'),
                                'Inactive',
                              ]),
                        ]),

                        // Created Date
                        m('td.px-6.py-4.text-gray-500.dark:text-slate-400.text-xs', 
                          formatDate(admin.created_at)
                        ),

                        // Actions
                        m('td.px-6.py-4.text-right.space-x-2', [
                          m('button.px-2.5.py-1.5.text-xs.font-medium.text-blue-600.dark:text-blue-400.hover:bg-blue-50.dark:hover:bg-blue-900/30.rounded.transition-colors', {
                            title: 'Edit Administrator',
                            onclick: () => s.openEditModal(admin),
                          }, 'Edit'),
                          !isSelf && m('button.px-2.5.py-1.text-xs.font-medium.text-red-600.dark:text-red-400.hover:bg-red-50.dark:hover:bg-red-900/30.rounded.transition-colors', {
                            title: 'Delete Administrator',
                            onclick: () => s.deleteAdmin(admin),
                          }, 'Delete'),
                        ]),
                      ]);
                    })),
                  ]),
                ]),
        ]),

        // Modal for Add / Edit Administrator
        s.modalOpen && m('div.fixed.inset-0.z-50.flex.items-center.justify-center.p-4.bg-black/50.backdrop-blur-sm', [
          m('div.bg-white.dark:bg-slate-800.rounded-2xl.border.border-gray-200.dark:border-slate-700.shadow-2xl.max-w-lg.w-full.overflow-hidden.animate-fade-in', [
            // Modal Header
            m('div.flex.items-center.justify-between.px-6.py-4.border-b.border-gray-100.dark:border-slate-700', [
              m('h2.text-lg.font-bold.text-gray-900.dark:text-slate-100', 
                s.modalMode === 'create' ? 'Add Administrator' : 'Edit Administrator'
              ),
              m('button.text-gray-400.hover:text-gray-600.dark:hover:text-slate-300', {
                onclick: () => { s.modalOpen = false; },
              }, m(Icon, { name: 'x', class: 'w-5 h-5' })),
            ]),

            // Modal Body Form
            m('form', { onsubmit: s.saveAdmin }, [
              m('div.p-6.space-y-4', [
                s.modalError && m('div.p-3.rounded-lg.bg-red-50.dark:bg-red-900/30.text-red-700.dark:text-red-300.text-sm', s.modalError),

                // Name
                m('div', [
                  m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', 'Full Name'),
                  m('input.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-lg.bg-white.dark:bg-slate-900.text-gray-900.dark:text-slate-100.focus:ring-2.focus:ring-blue-500', {
                    type: 'text',
                    required: true,
                    placeholder: 'e.g. Ahmet Yılmaz',
                    value: s.formName,
                    oninput: (e) => { s.formName = e.target.value; },
                  }),
                ]),

                // Email
                m('div', [
                  m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', 'Email Address'),
                  m('input.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-lg.bg-white.dark:bg-slate-900.text-gray-900.dark:text-slate-100.focus:ring-2.focus:ring-blue-500', {
                    type: 'email',
                    required: true,
                    placeholder: 'admin@example.com',
                    value: s.formEmail,
                    oninput: (e) => { s.formEmail = e.target.value; },
                  }),
                ]),

                // Role & Active Status Row
                m('div.grid.grid-cols-1.sm:grid-cols-2.gap-4', [
                  m('div', [
                    m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', 'Role'),
                    m('select.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-lg.bg-white.dark:bg-slate-900.text-gray-900.dark:text-slate-100.focus:ring-2.focus:ring-blue-500', {
                      value: s.formRole,
                      onchange: (e) => { s.formRole = e.target.value; },
                    }, [
                      m('option', { value: 'admin' }, 'admin'),
                      m('option', { value: 'superadmin' }, 'superadmin'),
                      m('option', { value: 'editor' }, 'editor'),
                    ]),
                  ]),
                  m('div.flex.items-center.pt-6', [
                    m('label.flex.items-center.gap-2.cursor-pointer', [
                      m('input.w-4.h-4.text-blue-600.rounded.border-gray-300.dark:border-slate-600.focus:ring-blue-500', {
                        type: 'checkbox',
                        checked: s.formActive,
                        disabled: s.modalMode === 'edit' && currentAdminId && String(s.formId) === currentAdminId,
                        onchange: (e) => { s.formActive = e.target.checked; },
                      }),
                      m('span.text-sm.font-medium.text-gray-700.dark:text-slate-300', 'Active Status'),
                    ]),
                  ]),
                ]),
                (s.modalMode === 'edit' && currentAdminId && String(s.formId) === currentAdminId) && m('p.text-xs.text-amber-600.dark:text-amber-400', 'You cannot deactivate your own account.'),

                // Password Field
                m('div', [
                  m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', 
                    s.modalMode === 'create' ? 'Password' : 'New Password (Optional)'
                  ),
                  m('input.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-lg.bg-white.dark:bg-slate-900.text-gray-900.dark:text-slate-100.focus:ring-2.focus:ring-blue-500', {
                    type: 'password',
                    required: s.modalMode === 'create',
                    placeholder: s.modalMode === 'create' ? 'Minimum 8 characters' : 'Leave blank to keep current password',
                    value: s.formPassword,
                    oninput: (e) => { s.formPassword = e.target.value; },
                  }),
                  m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', 'Must be at least 8 characters.'),
                ]),
              ]),

              // Modal Footer
              m('div.flex.items-center.justify-end.gap-3.px-6.py-4.bg-gray-50.dark:bg-slate-900/60.border-t.border-gray-100.dark:border-slate-700', [
                m('button.px-4.py-2.text-sm.font-medium.text-gray-700.dark:text-slate-300.hover:bg-gray-100.dark:hover:bg-slate-700.rounded-lg.transition-colors', {
                  type: 'button',
                  onclick: () => { s.modalOpen = false; },
                }, 'Cancel'),
                m('button.px-5.py-2.text-sm.font-medium.text-white.bg-blue-600.hover:bg-blue-700.rounded-lg.shadow-sm.transition-colors.disabled:opacity-50.flex.items-center.gap-2', {
                  type: 'submit',
                  disabled: s.modalLoading,
                }, [
                  s.modalLoading && m(Spinner),
                  s.modalLoading ? 'Saving...' : (s.modalMode === 'create' ? 'Create Admin' : 'Save Changes'),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]);
  },
};
`;
}

module.exports = {
  registerAdminUsersManagement,
  createAdminUsersApiHandlers,
  generateAdminUsersComponent,
  sanitizeAdminUser,
};

/**
 * Profile Page Component
 * Allows logged-in admin user to view and update name, email, and password
 * @module plugins/admin-panel/modules/profile
 */

function generateProfileComponent() {
  return `
const ProfilePage = {
  oninit(vnode) {
    vnode.state.loading = true;
    vnode.state.saving = false;
    vnode.state.name = '';
    vnode.state.email = '';
    vnode.state.currentPassword = '';
    vnode.state.newPassword = '';
    vnode.state.confirmPassword = '';
    vnode.state.error = null;
    vnode.state.success = null;

    api.get('/auth/me')
      .then(res => {
        if (res && res.user) {
          vnode.state.name = res.user.name || '';
          vnode.state.email = res.user.email || '';
        }
        vnode.state.loading = false;
        m.redraw();
      })
      .catch(err => {
        vnode.state.error = err.message || String(err);
        vnode.state.loading = false;
        m.redraw();
      });
  },

  view(vnode) {
    const s = vnode.state;

    const handleSubmit = async (e) => {
      e.preventDefault();
      s.saving = true;
      s.error = null;
      s.success = null;

      if (s.newPassword) {
        if (!s.currentPassword) {
          s.error = 'Current password is required to change your password';
          s.saving = false;
          m.redraw();
          return;
        }
        if (s.newPassword.length < 6) {
          s.error = 'New password must be at least 6 characters';
          s.saving = false;
          m.redraw();
          return;
        }
        if (s.newPassword !== s.confirmPassword) {
          s.error = 'New passwords do not match';
          s.saving = false;
          m.redraw();
          return;
        }
      }

      try {
        const payload = {
          name: s.name,
          email: s.email,
        };
        if (s.newPassword) {
          payload.currentPassword = s.currentPassword;
          payload.newPassword = s.newPassword;
        }

        const res = await api.put('/auth/profile', payload);
        s.saving = false;
        if (res && res.success && res.user) {
          s.success = 'Profile updated successfully';
          s.currentPassword = '';
          s.newPassword = '';
          s.confirmPassword = '';
          if (typeof state !== 'undefined' && state) {
            state.user = res.user;
          }
        }
        m.redraw();
      } catch (err) {
        s.saving = false;
        s.error = err.message || 'Failed to update profile';
        m.redraw();
      }
    };

    return m(Layout, { breadcrumbs: [{ label: 'Profile', href: '/profile' }] }, [
      m('div.max-w-4xl.mx-auto.space-y-6', [
        m('div.flex.items-center.justify-between', [
          m('div', [
            m('h1.text-2xl.font-bold.text-gray-900.dark:text-slate-100', 'My Profile'),
            m('p.text-sm.text-gray-500.dark:text-slate-400', 'Manage your personal details and account password'),
          ]),
        ]),

        s.loading
          ? m('div.flex.justify-center.py-12', m(Spinner))
          : m('form', { onsubmit: handleSubmit }, [
              s.error && m('div.p-4.mb-4.rounded-lg.bg-red-50.dark:bg-red-900/30.text-red-700.dark:text-red-300.text-sm', s.error),
              s.success && m('div.p-4.mb-4.rounded-lg.bg-green-50.dark:bg-green-900/30.text-green-700.dark:text-green-300.text-sm', s.success),

              // Personal Information Card
              m('div.bg-white.dark:bg-slate-800.rounded-xl.border.border-gray-200.dark:border-slate-700.p-6.mb-6.shadow-sm.space-y-4', [
                m('h2.text-lg.font-semibold.text-gray-900.dark:text-slate-100.border-b.border-gray-100.dark:border-slate-700.pb-3', 'Personal Information'),
                m('div.grid.grid-cols-1.md:grid-cols-2.gap-4', [
                  m('div', [
                    m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', 'Name'),
                    m('input.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-lg.bg-white.dark:bg-slate-900.text-gray-900.dark:text-slate-100.focus:ring-2.focus:ring-blue-500', {
                      type: 'text',
                      required: true,
                      value: s.name,
                      oninput: (e) => { s.name = e.target.value; },
                    }),
                  ]),
                  m('div', [
                    m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', 'Email Address'),
                    m('input.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-lg.bg-white.dark:bg-slate-900.text-gray-900.dark:text-slate-100.focus:ring-2.focus:ring-blue-500', {
                      type: 'email',
                      required: true,
                      value: s.email,
                      oninput: (e) => { s.email = e.target.value; },
                    }),
                  ]),
                ]),
              ]),

              // Password Change Card
              m('div.bg-white.dark:bg-slate-800.rounded-xl.border.border-gray-200.dark:border-slate-700.p-6.mb-6.shadow-sm.space-y-4', [
                m('h2.text-lg.font-semibold.text-gray-900.dark:text-slate-100.border-b.border-gray-100.dark:border-slate-700.pb-3', 'Change Password'),
                m('p.text-xs.text-gray-500.dark:text-slate-400', 'Leave blank if you do not wish to change your password'),
                m('div.space-y-4', [
                  m('div', [
                    m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', 'Current Password'),
                    m('input.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-lg.bg-white.dark:bg-slate-900.text-gray-900.dark:text-slate-100.focus:ring-2.focus:ring-blue-500', {
                      type: 'password',
                      value: s.currentPassword,
                      oninput: (e) => { s.currentPassword = e.target.value; },
                      placeholder: '••••••••',
                    }),
                  ]),
                  m('div.grid.grid-cols-1.md:grid-cols-2.gap-4', [
                    m('div', [
                      m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', 'New Password'),
                      m('input.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-lg.bg-white.dark:bg-slate-900.text-gray-900.dark:text-slate-100.focus:ring-2.focus:ring-blue-500', {
                        type: 'password',
                        value: s.newPassword,
                        oninput: (e) => { s.newPassword = e.target.value; },
                        placeholder: 'Min 6 characters',
                      }),
                    ]),
                    m('div', [
                      m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', 'Confirm New Password'),
                      m('input.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-lg.bg-white.dark:bg-slate-900.text-gray-900.dark:text-slate-100.focus:ring-2.focus:ring-blue-500', {
                        type: 'password',
                        value: s.confirmPassword,
                        oninput: (e) => { s.confirmPassword = e.target.value; },
                        placeholder: 'Repeat new password',
                      }),
                    ]),
                  ]),
                ]),
              ]),

              m('div.flex.justify-end', [
                m('button.px-6.py-2.bg-blue-600.hover:bg-blue-700.text-white.font-medium.rounded-lg.shadow-sm.transition-colors.disabled:opacity-50.flex.items-center.gap-2', {
                  type: 'submit',
                  disabled: s.saving,
                }, [
                  s.saving && m(Spinner),
                  s.saving ? 'Saving...' : 'Save Profile',
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
  generateProfileComponent,
};

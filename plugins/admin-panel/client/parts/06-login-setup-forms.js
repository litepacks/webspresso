// Login Form Component
const LoginForm = {
  view: () => m('.min-h-screen.flex.items-center.justify-center.p-4.sm:p-6.bg-gradient-to-br.from-blue-600.via-indigo-600.to-purple-700', [
    m('.w-full.max-w-md', [
      m('.bg-white dark:bg-slate-800.rounded-2xl.shadow-2xl.p-6.sm:p-8', [
        m('div.text-center.mb-6', [
          m('h1.text-2xl.sm:text-3xl.font-bold.text-gray-900.dark:text-slate-50', 'Admin Login'),
          m('p.text-gray-500.dark:text-slate-400.text-sm.mt-1', 'Sign in to your account'),
        ]),
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
          state.error ? m('.bg-red-50.border.border-red-200.text-red-700.dark:bg-red-950/50.dark:border-red-800/80.dark:text-red-200.px-4.py-3.rounded-lg.mb-4.text-sm', state.error) : null,
          m('.mb-4', [
            m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-2', { for: 'email' }, 'Email'),
            m('input#email.w-full.px-3.py-2.5.bg-white.text-gray-900.border.border-gray-300.rounded-lg.placeholder-gray-400.focus:ring-2.focus:ring-blue-500.focus:border-blue-500.transition-colors.dark:bg-slate-900/80.dark:border-slate-500.dark:text-slate-100.dark:placeholder-slate-500', {
              type: 'email',
              name: 'email',
              required: true,
              placeholder: 'admin@example.com',
            }),
          ]),
          m('.mb-6', [
            m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-2', { for: 'password' }, 'Password'),
            m('input#password.w-full.px-3.py-2.5.bg-white.text-gray-900.border.border-gray-300.rounded-lg.focus:ring-2.focus:ring-blue-500.focus:border-blue-500.transition-colors.dark:bg-slate-900/80.dark:border-slate-500.dark:text-slate-100', {
              type: 'password',
              name: 'password',
              required: true,
            }),
          ]),
          m('button.w-full.bg-blue-600.text-white.py-2.5.px-4.rounded-lg.font-medium.hover:bg-blue-700.focus:ring-2.focus:ring-blue-500.focus:ring-offset-2.dark:focus:ring-offset-slate-800.disabled:opacity-50.transition-colors', {
            type: 'submit',
            disabled: state.loading,
          }, state.loading ? 'Logging in...' : 'Sign in'),
        ]),
      ]),
    ]),
  ]),
};

// Setup Form Component
const SetupForm = {
  view: () => m('.min-h-screen.flex.items-center.justify-center.p-4.sm:p-6.bg-gradient-to-br.from-blue-600.via-indigo-600.to-purple-700', [
    m('.w-full.max-w-md', [
      m('.bg-white dark:bg-slate-800.rounded-2xl.shadow-2xl.p-6.sm:p-8', [
        m('div.text-center.mb-6', [
          m('h1.text-2xl.sm:text-3xl.font-bold.text-gray-900.dark:text-slate-50', 'Setup Admin Account'),
          m('p.text-gray-500.dark:text-slate-400.text-sm.mt-1', 'Create the first admin user account.'),
        ]),
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
      state.error ? m('.bg-red-50.border.border-red-200.text-red-700.dark:bg-red-950/50.dark:border-red-800/80.dark:text-red-200.px-4.py-3.rounded-lg.mb-4.text-sm', state.error) : null,
          m('.mb-4', [
            m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-2', { for: 'name' }, 'Name'),
            m('input#name.w-full.px-3.py-2.5.bg-white.text-gray-900.border.border-gray-300.rounded-lg.focus:ring-2.focus:ring-blue-500.focus:border-blue-500.transition-colors.dark:bg-slate-900/80.dark:border-slate-500.dark:text-slate-100', {
              type: 'text',
              name: 'name',
              required: true,
            }),
          ]),
          m('.mb-4', [
            m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-2', { for: 'email' }, 'Email'),
            m('input#email.w-full.px-3.py-2.5.bg-white.text-gray-900.border.border-gray-300.rounded-lg.placeholder-gray-400.focus:ring-2.focus:ring-blue-500.focus:border-blue-500.transition-colors.dark:bg-slate-900/80.dark:border-slate-500.dark:text-slate-100.dark:placeholder-slate-500', {
              type: 'email',
              name: 'email',
              required: true,
              placeholder: 'admin@example.com',
            }),
          ]),
          m('.mb-6', [
            m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-2', { for: 'password' }, 'Password'),
            m('input#password.w-full.px-3.py-2.5.bg-white.text-gray-900.border.border-gray-300.rounded-lg.focus:ring-2.focus:ring-blue-500.focus:border-blue-500.transition-colors.dark:bg-slate-900/80.dark:border-slate-500.dark:text-slate-100', {
              type: 'password',
              name: 'password',
              required: true,
            }),
          ]),
          m('button.w-full.bg-blue-600.text-white.py-2.5.px-4.rounded-lg.font-medium.hover:bg-blue-700.focus:ring-2.focus:ring-blue-500.focus:ring-offset-2.dark:focus:ring-offset-slate-800.disabled:opacity-50.transition-colors', {
            type: 'submit',
            disabled: state.loading,
          }, state.loading ? 'Creating...' : 'Create Admin Account'),
        ]),
      ]),
    ]),
  ]),
};

// Layout Component is defined in menu.js module (uses Sidebar)

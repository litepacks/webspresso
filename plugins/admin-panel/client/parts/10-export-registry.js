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
  AdminUI: typeof window !== 'undefined' ? window.AdminUI : undefined,
  Admin: typeof window !== 'undefined' ? window.Admin : undefined,
  ToastContainer: typeof window !== 'undefined' ? window.ToastContainer : undefined,
  ConfirmModalContainer: typeof window !== 'undefined' ? window.ConfirmModalContainer : undefined,
};

if (typeof window !== 'undefined') {
  window.Admin = window.Admin || {};
  window.Admin.api = api;
  window.Admin.state = state;
  if (typeof window.AdminUI !== 'undefined') {
    window.Admin.ui = window.AdminUI;
  }
}

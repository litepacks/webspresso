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
  fetch: typeof fetchWithTimeout !== 'undefined' ? fetchWithTimeout : undefined,
  fetchWithTimeout: typeof fetchWithTimeout !== 'undefined' ? fetchWithTimeout : undefined,
  notify: typeof window !== 'undefined' ? window.notify : undefined,
  confirmModal: typeof window !== 'undefined' ? window.confirmModal : undefined,
  toastState: typeof window !== 'undefined' ? window.toastState : undefined,
  confirmState: typeof window !== 'undefined' ? window.confirmState : undefined,
  AdminUI: typeof window !== 'undefined' ? window.AdminUI : undefined,
  Admin: typeof window !== 'undefined' ? window.Admin : undefined,
  ToastContainer: typeof window !== 'undefined' ? window.ToastContainer : undefined,
  ConfirmModalContainer: typeof window !== 'undefined' ? window.ConfirmModalContainer : undefined,
};

if (typeof window !== 'undefined') {
  window.Admin = window.Admin || {};
  window.Admin.api = api;
  window.Admin.state = state;
  if (typeof fetchWithTimeout !== 'undefined') {
    window.Admin.fetch = fetchWithTimeout;
    window.Admin.fetchWithTimeout = fetchWithTimeout;
  }
  if (typeof window.AdminUI !== 'undefined') {
    window.Admin.ui = window.AdminUI;
  }
  if (typeof window.notify !== 'undefined') {
    window.Admin.toast = window.notify;
  }
  if (typeof window.confirmModal !== 'undefined') {
    window.Admin.confirm = window.confirmModal;
  }
}

/**
 * File Upload Field Renderer
 * POST multipart field "file" to window.__ADMIN_CONFIG__.settings.uploadUrl
 */

function getUploadUrlFromAdminConfig() {
  try {
    const cfg = typeof window !== 'undefined' ? window.__ADMIN_CONFIG__ : null;
    const u = cfg && cfg.settings && cfg.settings.uploadUrl;
    return u ? String(u) : '';
  } catch {
    return '';
  }
}

function isImageAccept(accept) {
  return accept && accept !== '*/*' && String(accept).includes('image');
}

function isImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('blob:')) return true;
  return /\.(jpe?g|png|gif|webp|svg|avif|bmp|ico)(\?|#|$)/i.test(url.trim());
}

function shouldShowImagePreview(url, accept) {
  return isImageAccept(accept) || isImageUrl(url);
}

function renderUploadedFilePreview(url, { accept, readonly, onRemove, label }) {
  if (!url) return null;

  if (shouldShowImagePreview(url, accept)) {
    return m('.mt-3.flex.flex-col.items-start.gap-2', [
      m('a.block', { href: url, target: '_blank', rel: 'noopener noreferrer' },
        m('img.max-h-48.max-w-full.rounded-lg.border.border-gray-200.dark:border-slate-600.object-contain.bg-white.dark:bg-slate-900.shadow-sm', {
          src: url,
          alt: label || 'Preview',
          loading: 'lazy',
        })
      ),
      m('p.text-xs.text-gray-500.dark:text-slate-400.break-all', url),
      !readonly && onRemove
        ? m('button.text-red-600.dark:text-red-400.hover:text-red-800.dark:hover:text-red-300.text-sm', {
            type: 'button',
            onclick: onRemove,
          }, 'Remove')
        : null,
    ]);
  }

  return m('.mt-3.flex.flex-col.items-start.gap-2', [
    m('a.text-sm.text-indigo-600.dark:text-indigo-400.break-all', {
      href: url,
      target: '_blank',
      rel: 'noopener noreferrer',
    }, url),
    !readonly && onRemove
      ? m('button.text-red-600.dark:text-red-400.hover:text-red-800.dark:hover:text-red-300.text-sm', {
          type: 'button',
          onclick: onRemove,
        }, 'Remove')
      : null,
  ]);
}

function revokeLocalPreview(state) {
  if (state?.localPreview) {
    try {
      URL.revokeObjectURL(state.localPreview);
    } catch {
      // ignore
    }
    state.localPreview = null;
  }
}

module.exports = {
  FileUploadField: {
    oninit: (vnode) => {
      vnode.state.localPreview = null;
    },
    onremove: (vnode) => {
      revokeLocalPreview(vnode.state);
    },
    oncreate: (vnode) => {
      const { name, meta = {} } = vnode.attrs;
      if (!getUploadUrlFromAdminConfig()) return;

      const dropZoneId = 'drop-zone-' + name;
      const dropZone = document.getElementById(dropZoneId);
      if (!dropZone) return;

      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
        dropZone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
      });

      ['dragenter', 'dragover'].forEach((eventName) => {
        dropZone.addEventListener(eventName, () => {
          dropZone.classList.add('border-blue-500', 'bg-blue-50', 'dark:bg-slate-800');
        });
      });

      ['dragleave', 'drop'].forEach((eventName) => {
        dropZone.addEventListener(eventName, () => {
          dropZone.classList.remove('border-blue-500', 'bg-blue-50', 'dark:bg-slate-800');
        });
      });

      dropZone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0) {
          handleFileUpload(files[0], vnode, meta);
        }
      });

      const fileInput = dropZone.querySelector('input[type=file]');
      if (fileInput) {
        fileInput.addEventListener('change', (e) => {
          if (e.target.files.length > 0) {
            handleFileUpload(e.target.files[0], vnode, meta);
          }
        });
      }
    },

    view: (vnode) => {
      const { name, value = '', meta = {}, required = false, readonly = false } = vnode.attrs;
      const state = vnode.state;
      const dropZoneId = 'drop-zone-' + name;
      const maxSize = meta.maxSize || meta.maxBytes || 10 * 1024 * 1024;
      const accept = meta.accept || '*/*';
      const uploadUrl = getUploadUrlFromAdminConfig();
      const displayUrl = state.localPreview || value;
      const label = meta.label || name;
      const clearValue = () => {
        revokeLocalPreview(state);
        if (vnode.attrs.onchange) vnode.attrs.onchange('');
      };

      if (!uploadUrl) {
        return m('.mb-4', [
          m(
            'label.block.text-sm.font-medium.mb-2',
            label,
            required ? m('span.text-red-500', ' *') : null
          ),
          m('p.text-xs.text-amber-700.dark:text-amber-400.mb-2', 'Upload URL is not configured.'),
          m('input.w-full.px-3.py-2.border.rounded', {
            type: 'text',
            name,
            value: typeof value === 'string' ? value : '',
            placeholder: 'https://… or /uploads/…',
            required,
            readonly,
            oninput: (e) => {
              if (vnode.attrs.onchange) vnode.attrs.onchange(e.target.value);
            },
          }),
          value
            ? renderUploadedFilePreview(value, { accept, readonly, onRemove: clearValue, label })
            : null,
        ]);
      }

      return m('.mb-4', [
        m(
          'label.block.text-sm.font-medium.mb-2',
          label,
          required ? m('span.text-red-500', ' *') : null
        ),
        displayUrl
          ? renderUploadedFilePreview(displayUrl, { accept, readonly, onRemove: clearValue, label })
          : null,
        m(
          'div.border-2.border-dashed.border-gray-300.dark:border-slate-600.rounded.p-6.text-center',
          {
            id: dropZoneId,
            style: readonly ? undefined : 'cursor: pointer;',
          },
          [
            m('input[type=file]', {
              class: 'hidden',
              id: 'file-input-' + name,
              accept,
              disabled: readonly,
              onchange: (e) => {
                if (e.target.files.length > 0) {
                  handleFileUpload(e.target.files[0], vnode, meta);
                }
              },
            }),
            readonly
              ? null
              : m('div', [
                  m(
                    'p.text-gray-600.dark:text-slate-400.mb-2',
                    displayUrl ? 'Drag and drop to replace, or' : 'Drag and drop a file here, or'
                  ),
                  m(
                    'label.text-blue-600.hover:text-blue-800.cursor-pointer',
                    { for: 'file-input-' + name },
                    displayUrl ? 'choose another file' : 'browse'
                  ),
                ]),
          ]
        ),
        m('input[type=hidden]', {
          name,
          value: typeof value === 'string' ? value : '',
        }),
        m(
          'p.text-xs.text-gray-500.mt-1',
          'Max ' + Math.round(maxSize / 1024 / 1024) + ' MB (server enforces limits)'
        ),
      ]);
    },
  },
};

/**
 * @param {File} file
 * @param {import('mithril').Vnode} vnode
 * @param {Object} meta
 */
async function handleFileUpload(file, vnode, meta) {
  const maxSize = meta.maxSize || meta.maxBytes || 10 * 1024 * 1024;
  if (file.size > maxSize) {
    alert(`File too large (max ${Math.round(maxSize / 1024 / 1024)} MB).`);
    return;
  }

  const uploadUrl = getUploadUrlFromAdminConfig();
  if (!uploadUrl) {
    alert('Upload URL is not configured.');
    return;
  }

  if (file.type?.startsWith('image/')) {
    revokeLocalPreview(vnode.state);
    vnode.state.localPreview = URL.createObjectURL(file);
    if (typeof m !== 'undefined' && m.redraw) m.redraw();
  }

  const fd = new FormData();
  fd.append('file', file);

  try {
    const res = await fetch(uploadUrl, { method: 'POST', body: fd, credentials: 'include' });
    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    if (!res.ok) {
      revokeLocalPreview(vnode.state);
      if (typeof m !== 'undefined' && m.redraw) m.redraw();
      alert(data.message || data.error || `Upload failed (${res.status})`);
      return;
    }
    revokeLocalPreview(vnode.state);
    const url = data.url || data.publicUrl || '';
    if (vnode.attrs.onchange) vnode.attrs.onchange(url);
    if (typeof m !== 'undefined' && m.redraw) m.redraw();
  } catch (err) {
    revokeLocalPreview(vnode.state);
    if (typeof m !== 'undefined' && m.redraw) m.redraw();
    alert(err.message || 'Upload failed');
  }
}

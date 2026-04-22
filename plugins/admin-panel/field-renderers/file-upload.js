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

module.exports = {
  FileUploadField: {
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
      const { name, value = '', meta = {}, required = false } = vnode.attrs;
      const dropZoneId = 'drop-zone-' + name;
      const maxSize = meta.maxSize || meta.maxBytes || 10 * 1024 * 1024;
      const accept = meta.accept || '*/*';
      const uploadUrl = getUploadUrlFromAdminConfig();

      if (!uploadUrl) {
        return m('.mb-4', [
          m(
            'label.block.text-sm.font-medium.mb-2',
            meta.label || name,
            required ? m('span.text-red-500', ' *') : null
          ),
          m('p.text-xs.text-amber-700.dark:text-amber-400.mb-2', 'Upload URL is not configured.'),
          m('input.w-full.px-3.py-2.border.rounded', {
            type: 'text',
            name,
            value: typeof value === 'string' ? value : '',
            placeholder: 'https://… or /uploads/…',
            required,
            oninput: (e) => {
              if (vnode.attrs.onchange) vnode.attrs.onchange(e.target.value);
            },
          }),
        ]);
      }

      return m('.mb-4', [
        m(
          'label.block.text-sm.font-medium.mb-2',
          meta.label || name,
          required ? m('span.text-red-500', ' *') : null
        ),
        m(
          'div.border-2.border-dashed.border-gray-300.dark:border-slate-600.rounded.p-8.text-center',
          {
            id: dropZoneId,
            style: 'cursor: pointer;',
          },
          [
            m('input[type=file]', {
              class: 'hidden',
              id: 'file-input-' + name,
              accept,
              onchange: (e) => {
                if (e.target.files.length > 0) {
                  handleFileUpload(e.target.files[0], vnode, meta);
                }
              },
            }),
            m('div', [
              m('p.text-gray-600.dark:text-slate-400.mb-2', 'Drag and drop a file here, or'),
              m(
                'label.text-blue-600.hover:text-blue-800.cursor-pointer',
                { for: 'file-input-' + name },
                'browse'
              ),
            ]),
            value
              ? m('.mt-4', [
                  m(
                    'p.text-sm.text-gray-600.break-all',
                    'Current: ' + (typeof value === 'string' ? value : value.name || 'uploaded')
                  ),
                  m(
                    'button.text-red-600.hover:text-red-800.text-sm.mt-2',
                    {
                      type: 'button',
                      onclick: () => {
                        if (vnode.attrs.onchange) vnode.attrs.onchange('');
                      },
                    },
                    'Remove'
                  ),
                ])
              : null,
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
      alert(data.message || data.error || `Upload failed (${res.status})`);
      return;
    }
    const url = data.url || data.publicUrl || '';
    if (vnode.attrs.onchange) vnode.attrs.onchange(url);
    if (typeof m !== 'undefined' && m.redraw) m.redraw();
  } catch (err) {
    alert(err.message || 'Upload failed');
  }
}

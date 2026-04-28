// Rich Text Field Renderer Component
const RichTextField = {
    oncreate: (vnode) => {
      const { name, value = '', onchange, readonly = false } = vnode.attrs;
      
      // Load Quill if not already loaded
      if (typeof window.Quill === 'undefined') {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdn.quilljs.com/1.3.6/quill.snow.css';
        document.head.appendChild(link);
        
        const script = document.createElement('script');
        script.src = 'https://cdn.quilljs.com/1.3.6/quill.js';
        script.onload = () => {
          initEditor(vnode);
        };
        document.head.appendChild(script);
      } else {
        initEditor(vnode);
      }
      
      function initEditor(vnode) {
        const editorId = 'quill-editor-' + name;
        const editorEl = document.getElementById(editorId);
        const hiddenInput = document.getElementById(name + '-value');
        const isReadonly = readonly || false;
        
        if (editorEl && !editorEl._quill) {
          const quill = new window.Quill(editorEl, {
            theme: 'snow',
            readOnly: isReadonly,
            modules: {
              toolbar: isReadonly ? false : [
                [{ 'header': [1, 2, 3, false] }],
                ['bold', 'italic', 'underline', 'strike'],
                [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                ['link', 'image'],
                ['clean']
              ]
            }
          });
          
          // Set initial content
          if (value) {
            quill.root.innerHTML = value;
            if (hiddenInput) {
              hiddenInput.value = value;
            }
          }
          
          // Handle content changes
          if (!isReadonly) {
            quill.on('text-change', () => {
              const content = quill.root.innerHTML;
              if (hiddenInput) {
                hiddenInput.value = content;
              }
              if (onchange) {
                onchange(content);
              }
            });
          }
          
          editorEl._quill = quill;
        }
      }
    },
  
  onupdate: (vnode) => {
    // Update editor content if value changed externally
    const { name, value = '', readonly = false } = vnode.attrs;
    const editorId = 'quill-editor-' + name;
    const editorEl = document.getElementById(editorId);
    const hiddenInput = document.getElementById(name + '-value');
    
    if (editorEl && editorEl._quill) {
      const currentContent = editorEl._quill.root.innerHTML;
      const newValue = value || '';
      if (currentContent !== newValue) {
        editorEl._quill.root.innerHTML = newValue;
        if (hiddenInput) {
          hiddenInput.value = newValue;
        }
      }
    }
  },
  
  view: (vnode) => {
    const { name, col, value = '', onChange, readonly } = vnode.attrs;
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const hint = ui.hint || '';
    const editorId = 'quill-editor-' + name;
    const required = !col.nullable && !readonly;
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700 dark:text-slate-300.mb-1', { for: name },
        label,
        required ? m('span.text-red-500', ' *') : null
      ),
      m('div.border.border-gray-300.dark:border-slate-600.rounded.bg-white.dark:bg-slate-900/50', {
        id: editorId,
        class: readonly ? 'bg-gray-100 dark:bg-slate-800 opacity-50' : '',
        style: 'min-height: 200px;'
      }),
      m('input[type=hidden]', {
        name,
        id: name + '-value',
        value: value || '',
      }),
      hint ? m('p.text-xs.text-gray-500 dark:text-slate-400.mt-1', hint) : null,
    ]);
  }
};

// File upload field (multipart POST to settings.uploadUrl; field name "file")
const FileUploadField = {
  oncreate: (vnode) => {
    const col = vnode.attrs.col;
    const readonly = vnode.attrs.readonly;
    if (readonly) return;
    var cfg = window.__ADMIN_CONFIG__;
    var uploadUrl = (cfg && cfg.settings && cfg.settings.uploadUrl) ? String(cfg.settings.uploadUrl) : '';
    if (!uploadUrl) return;
    const dropZoneId = 'drop-zone-' + col.name;
    const dropZone = document.getElementById(dropZoneId);
    if (!dropZone) return;
    const meta = col.ui || {};
    const onChange = vnode.attrs.onChange;
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function (eventName) {
      dropZone.addEventListener(eventName, function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
    });
    ['dragenter', 'dragover'].forEach(function (eventName) {
      dropZone.addEventListener(eventName, function () {
        dropZone.classList.add('border-blue-500', 'bg-blue-50', 'dark:bg-slate-800');
      });
    });
    ['dragleave', 'drop'].forEach(function (eventName) {
      dropZone.addEventListener(eventName, function () {
        dropZone.classList.remove('border-blue-500', 'bg-blue-50', 'dark:bg-slate-800');
      });
    });
    dropZone.addEventListener('drop', function (e) {
      var files = e.dataTransfer.files;
      if (files.length > 0) {
        handleAdminFileUpload(files[0], onChange, meta);
      }
    });
    var fileInput = dropZone.querySelector('input[type=file]');
    if (fileInput) {
      fileInput.addEventListener('change', function (e) {
        if (e.target.files.length > 0) {
          handleAdminFileUpload(e.target.files[0], onChange, meta);
        }
      });
    }
  },
  view: (vnode) => {
    const col = vnode.attrs.col;
    const value = vnode.attrs.value || '';
    const onChange = vnode.attrs.onChange;
    const readonly = vnode.attrs.readonly || false;
    const meta = col.ui || {};
    const label = meta.label || formatColumnLabel(col.name);
    const hint = meta.hint || '';
    const required = !col.nullable && !readonly;
    var uploadUrl = '';
    try {
      var cfg2 = window.__ADMIN_CONFIG__;
      uploadUrl = (cfg2 && cfg2.settings && cfg2.settings.uploadUrl) ? String(cfg2.settings.uploadUrl) : '';
    } catch (e) { uploadUrl = ''; }
    var maxSize = meta.maxSize || meta.maxBytes || (10 * 1024 * 1024);
    var accept = meta.accept || '*/*';
    var dropZoneId = 'drop-zone-' + col.name;
    if (readonly) {
      return m('.mb-4', [
        m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', label, required ? m('span.text-red-500', ' *') : null),
        value ? m('a.text-indigo-600.dark:text-indigo-400.break-all', { href: value, target: '_blank', rel: 'noopener noreferrer' }, value) : m('span.text-gray-400.dark:text-slate-500', '—'),
        hint ? m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', hint) : null,
      ]);
    }
    if (!uploadUrl) {
      return m('.mb-4', [
        m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', { for: col.name }, label, required ? m('span.text-red-500', ' *') : null),
        m('p.text-xs.text-amber-700.dark:text-amber-400.mb-2', 'Upload URL is not configured. Enter a public URL or path manually.'),
        m('input.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-md.bg-white.dark:bg-slate-900/70.text-gray-900.dark:text-slate-100.placeholder-gray-400.dark:placeholder-slate-500', {
          type: 'text',
          id: col.name,
          name: col.name,
          value: value,
          placeholder: 'https://… or /uploads/…',
          required: required,
          oninput: function (e) { if (onChange) onChange(e.target.value); },
        }),
        hint ? m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', hint) : null,
      ]);
    }
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', label, required ? m('span.text-red-500', ' *') : null),
      m('div#' + dropZoneId + '.border-2.border-dashed.border-gray-300.dark:border-slate-600.rounded-lg.p-8.text-center.bg-gray-50.dark:bg-slate-900/40', { style: 'cursor: pointer;' }, [
        m('input[type=file].hidden', {
          id: 'file-input-' + col.name,
          accept: accept,
          onchange: function (e) {
            if (e.target.files.length > 0) {
              handleAdminFileUpload(e.target.files[0], onChange, meta);
            }
          },
        }),
        m('div', [
          m('p.text-gray-600.dark:text-slate-400.mb-2', 'Drag and drop a file here, or'),
          m('label.text-blue-600.hover:text-blue-800.dark:text-blue-400.cursor-pointer', { for: 'file-input-' + col.name }, 'browse'),
        ]),
        value ? m('.mt-4.text-left', [
          m('p.text-sm.text-gray-600.dark:text-slate-400.break-all', 'Current: ' + value),
          m('button.text-red-600.dark:text-red-400.hover:text-red-800.dark:hover:text-red-300.text-sm.mt-2', {
            type: 'button',
            onclick: function () { if (onChange) onChange(''); },
          }, 'Remove'),
        ]) : null,
      ]),
      m('input[type=hidden]', { name: col.name, value: typeof value === 'string' ? value : '' }),
      m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', 'Max ' + Math.round(maxSize / 1024 / 1024) + ' MB (server enforces limits)'),
      hint ? m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', hint) : null,
    ]);
  },
};

async function handleAdminFileUpload(file, onChange, meta) {
  var uploadUrl = '';
  try {
    var cfg = window.__ADMIN_CONFIG__;
    uploadUrl = (cfg && cfg.settings && cfg.settings.uploadUrl) ? String(cfg.settings.uploadUrl) : '';
  } catch (e) {}
  if (!uploadUrl) {
    alert('Upload URL is not configured.');
    return;
  }
  var maxSize = meta.maxSize || meta.maxBytes || (10 * 1024 * 1024);
  if (file.size > maxSize) {
    alert('File too large (max ' + Math.round(maxSize / 1024 / 1024) + ' MB).');
    return;
  }
  var fd = new FormData();
  fd.append('file', file);
  try {
    var res = await fetch(uploadUrl, { method: 'POST', body: fd, credentials: 'include' });
    var data = {};
    try { data = await res.json(); } catch (e2) { data = {}; }
    if (!res.ok) {
      alert(data.message || data.error || ('Upload failed (' + res.status + ')'));
      return;
    }
    var url = data.url || data.publicUrl || '';
    if (onChange) onChange(url);
    m.redraw();
  } catch (err) {
    alert(err.message || 'Upload failed');
  }
}

// Get appropriate renderer for a column type
function getFieldRenderer(col, modelMeta) {
  // Check for custom field first
  if (col.customField && col.customField.type) {
    if (col.customField.type === 'rich-text') {
      return (col, value, onChange, readonly) => {
        return m(RichTextField, {
          name: col.name,
          col,
          value: value || '',
          onChange,
          readonly: readonly || false,
        });
      };
    }
    if (col.customField.type === 'file-upload') {
      return (col, value, onChange, readonly) => {
        return m(FileUploadField, {
          col,
          value: value || '',
          onChange,
          readonly: readonly || false,
        });
      };
    }
    // Add other custom field types here if needed
  }

  if (col.type === 'file') {
    return (col, value, onChange, readonly) => {
      return m(FileUploadField, {
        col,
        value: value || '',
        onChange,
        readonly: readonly || false,
      });
    };
  }
  
  // Fallback to standard type renderers
  const typeMap = {
    string: 'string',
    text: 'text',
    integer: 'integer',
    bigint: 'integer',
    float: 'float',
    decimal: 'float',
    boolean: 'boolean',
    date: 'date',
    datetime: 'datetime',
    timestamp: 'datetime',
    enum: 'enum',
    json: 'json',
    array: 'array',
    uuid: 'string',
    nanoid: 'string',
  };
  return FieldRenderers[typeMap[col.type] || 'string'];
}

// Check if a column is auto-generated (readonly)
function isAutoColumn(col) {
  // Primary key with auto-increment is readonly
  if (col.primary || col.autoIncrement) return 'primary';
  // Auto timestamps are always readonly
  if (col.auto === 'create' || col.auto === 'update') return 'auto';
  // Common timestamp field names
  if (col.name === 'created_at' || col.name === 'updated_at') return 'auto';
  return false;
}

// Check if rich-text content is empty
function isRichTextEmpty(value) {
  if (!value) return true;
  // Remove all HTML tags and check if only whitespace remains
  const stripped = value.replace(/<[^>]*>/g, '').trim();
  // Check for common empty Quill outputs
  return stripped === '' || value === '<p><br></p>' || value === '<p></p>';
}

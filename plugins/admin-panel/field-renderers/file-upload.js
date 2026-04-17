/**
 * File Upload Field Renderer
 * Droppable file upload component
 */

module.exports = {
  FileUploadField: {
    oncreate: (vnode) => {
      const { name, value = '', onchange, meta = {} } = vnode.attrs;
      const dropZoneId = 'drop-zone-' + name;
      
      const dropZone = document.getElementById(dropZoneId);
      if (!dropZone) return;
      
      // Prevent default drag behaviors
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
      });
      
      // Highlight drop zone when item is dragged over it
      ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
          dropZone.classList.add('border-blue-500', 'bg-blue-50');
        });
      });
      
      ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
          dropZone.classList.remove('border-blue-500', 'bg-blue-50');
        });
      });
      
      // Handle dropped files
      dropZone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0) {
          handleFile(files[0], vnode, meta);
        }
      });
      
      // Handle file input change
      const fileInput = dropZone.querySelector('input[type=file]');
      if (fileInput) {
        fileInput.addEventListener('change', (e) => {
          if (e.target.files.length > 0) {
            handleFile(e.target.files[0], vnode, meta);
          }
        });
      }
    },
    
    view: (vnode) => {
      const { name, value = '', meta = {}, required = false } = vnode.attrs;
      const dropZoneId = 'drop-zone-' + name;
      const maxSize = meta.maxSize || 5 * 1024 * 1024; // 5MB default
      const accept = meta.accept || '*/*';
      
      return m('.mb-4', [
        m('label.block.text-sm.font-medium.mb-2',
          meta.label || name,
          required ? m('span.text-red-500', ' *') : null
        ),
        m('div#drop-zone-' + name + '.border-2.border-dashed.border-gray-300 dark:border-slate-600.rounded.p-8.text-center', {
          style: 'cursor: pointer;'
        }, [
          m('input[type=file]', {
            class: 'hidden',
            id: 'file-input-' + name,
            accept,
            onchange: (e) => {
              if (e.target.files.length > 0) {
                handleFile(e.target.files[0], vnode, meta);
              }
            }
          }),
          m('div', [
            m('p.text-gray-600 dark:text-slate-400.mb-2', 'Drag and drop a file here, or'),
            m('label.text-blue-600.hover:text-blue-800.cursor-pointer', {
              for: 'file-input-' + name
            }, 'browse'),
          ]),
          value ? m('.mt-4', [
            m('p.text-sm.text-gray-600', 'Current file: ' + (typeof value === 'string' ? value : value.name || 'uploaded')),
            m('button.text-red-600.hover:text-red-800.text-sm.mt-2', {
              onclick: () => {
                if (vnode.attrs.onchange) {
                  vnode.attrs.onchange('');
                }
              }
            }, 'Remove'),
          ]) : null,
        ]),
        m('input[type=hidden]', {
          name,
          value: typeof value === 'string' ? value : '',
        }),
      ]);
    }
  },
};

/**
 * Handle file upload
 * @param {File} file - File object
 * @param {Object} vnode - Mithril vnode
 * @param {Object} meta - Field metadata
 */
function handleFile(file, vnode, meta) {
  const maxSize = meta.maxSize || 5 * 1024 * 1024;
  
  if (file.size > maxSize) {
    alert(`File size exceeds maximum allowed size of ${Math.round(maxSize / 1024 / 1024)}MB`);
    return;
  }
  
  // For now, just store the file name
  // In a real implementation, you'd upload to server and get URL
  if (vnode.attrs.onchange) {
    vnode.attrs.onchange(file.name);
  }
}

/**
 * Rich Text Editor Field Renderer
 * Uses Quill editor (CDN)
 */

module.exports = {
  RichTextField: {
    oncreate: (vnode) => {
      const { name, value = '', onchange } = vnode.attrs;
      
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
        
        if (editorEl && !editorEl._quill) {
          const quill = new window.Quill(editorEl, {
            theme: 'snow',
            modules: {
              toolbar: [
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
          quill.on('text-change', () => {
            const content = quill.root.innerHTML;
            if (hiddenInput) {
              hiddenInput.value = content;
            }
            if (onchange) {
              onchange(content);
            }
          });
          
          editorEl._quill = quill;
          vnode.state.quill = quill;
        }
      }
    },
    
    onupdate: (vnode) => {
      // Update editor content if value changed externally
      const { name, value = '' } = vnode.attrs;
      const editorId = 'quill-editor-' + name;
      const editorEl = document.getElementById(editorId);
      const hiddenInput = document.getElementById(name + '-value');
      
      if (editorEl && editorEl._quill && vnode.state.quill) {
        const currentContent = editorEl._quill.root.innerHTML;
        if (currentContent !== value) {
          editorEl._quill.root.innerHTML = value || '';
          if (hiddenInput) {
            hiddenInput.value = value || '';
          }
        }
      }
    },
    
    view: (vnode) => {
      const { name, meta = {}, required = false, value = '' } = vnode.attrs;
      const ui = meta.ui || {};
      const label = ui.label || meta.label || name;
      const hint = ui.hint || '';
      const editorId = 'quill-editor-' + name;
      
      return m('.mb-4', [
        m('label.block.text-sm.font-medium.text-gray-700 dark:text-slate-300.mb-1', { for: name },
          label,
          required ? m('span.text-red-500', ' *') : null
        ),
        m('div.border.border-gray-300 dark:border-slate-600.rounded', {
          id: editorId,
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
  },
};

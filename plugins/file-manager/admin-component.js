/**
 * File Manager Admin Page & Modal Picker — Mithril.js component source (string)
 * @module plugins/file-manager/admin-component
 */

/**
 * @param {Object} options
 * @param {string} [options.apiPrefix='/files']
 * @param {string} [options.publicBasePath='/uploads']
 */
function generateFileManagerComponent(options = {}) {
  const apiPrefix = options.apiPrefix || '/files';
  const publicBasePath = options.publicBasePath || '/uploads';

  return `
(function() {
  var API = '${apiPrefix}';
  var PUBLIC_BASE = '${publicBasePath}';

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatDate(d) {
    if (!d) return '—';
    try {
      var date = new Date(d);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch(e) {
      return String(d);
    }
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  function renderFileIcon(item) {
    if (item.isDir) {
      return m('svg.w-8.h-8.text-amber-500', { fill: 'currentColor', viewBox: '0 0 20 20' }, [
        m('path', { d: 'M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z' })
      ]);
    }
    var type = item.type || 'other';
    if (type === 'image') {
      return m('svg.w-8.h-8.text-emerald-500', { fill: 'none', stroke: 'currentColor', strokeWidth: 2, viewBox: '0 0 24 24' }, [
        m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' })
      ]);
    }
    if (type === 'document' || type === 'text') {
      return m('svg.w-8.h-8.text-blue-500', { fill: 'none', stroke: 'currentColor', strokeWidth: 2, viewBox: '0 0 24 24' }, [
        m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' })
      ]);
    }
    if (type === 'video') {
      return m('svg.w-8.h-8.text-purple-500', { fill: 'none', stroke: 'currentColor', strokeWidth: 2, viewBox: '0 0 24 24' }, [
        m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' })
      ]);
    }
    if (type === 'audio') {
      return m('svg.w-8.h-8.text-pink-500', { fill: 'none', stroke: 'currentColor', strokeWidth: 2, viewBox: '0 0 24 24' }, [
        m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3' })
      ]);
    }
    if (type === 'archive') {
      return m('svg.w-8.h-8.text-amber-600', { fill: 'none', stroke: 'currentColor', strokeWidth: 2, viewBox: '0 0 24 24' }, [
        m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4' })
      ]);
    }
    return m('svg.w-8.h-8.text-gray-400', { fill: 'none', stroke: 'currentColor', strokeWidth: 2, viewBox: '0 0 24 24' }, [
      m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z' })
    ]);
  }

  function renderShortcutItem(keys, desc) {
    return m('div.flex.items-center.justify-between.p-2.rounded-lg.bg-gray-50.dark:bg-slate-800/70.border.border-gray-100.dark:border-slate-700/50', [
      m('span.text-xs.text-gray-600.dark:text-slate-300', desc),
      m('kbd.px-2.py-0.5.text-[11px].font-mono.font-semibold.rounded.bg-white.dark:bg-slate-700.text-gray-800.dark:text-slate-200.border.border-gray-200.dark:border-slate-600.shadow-xs', keys)
    ]);
  }

  function renderCategoryCard(title, icon, cat, textColor, dotBg) {
    var c = cat || { count: 0, bytes: 0, percent: 0, formattedBytes: '0 B' };
    return m('div.p-2.rounded-lg.bg-gray-50.dark:bg-slate-900/60.border.border-gray-100.dark:border-slate-700/50.flex.flex-col.gap-0.5', [
      m('div.flex.items-center.gap-1.5', [
        m('span.w-2.h-2.rounded-full.' + dotBg),
        m('span.font-semibold.text-gray-800.dark:text-slate-200.truncate', title)
      ]),
      m('div.flex.items-baseline.justify-between.mt-1', [
        m('span.font-medium.' + textColor, c.formattedBytes),
        m('span.text-[10px].text-gray-400', c.count + ' files')
      ])
    ]);
  }

  var TEXT_EXTS = [
    'txt', 'csv', 'md', 'markdown', 'json', 'xml', 'html', 'htm',
    'css', 'scss', 'sass', 'less', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
    'sql', 'yaml', 'yml', 'env', 'sh', 'bash', 'log', 'ini', 'toml',
    'svg', 'gitignore', 'conf', 'config'
  ];

  function isTextFile(item) {
    if (!item || item.isDir) return false;
    var ext = (item.ext || '').toLowerCase();
    return item.type === 'text' || item.type === 'code' || TEXT_EXTS.indexOf(ext) !== -1;
  }

  function FileManagerView(isPickerMode, onSelectCallback, pickerAccept) {
    var currentPath = '';
    var breadcrumbs = [{ name: 'Root', path: '' }];
    var items = [];
    var loading = true;
    var error = null;
    var searchQuery = '';
    var typeFilter = 'all';
    var viewMode = 'grid'; // 'grid' | 'list'
    var sort = 'name';
    var order = 'asc';
    var selectedItem = null;
    var modalState = null; // 'newFolder' | 'rename' | 'delete' | 'preview'
    var inputFolderValue = '';
    var inputRenameValue = '';
    var copyingFeedback = null;
    var uploading = false;
    var uploadStatus = '';
    var isDraggingOver = false;
    var dragCounter = 0;
    var activeXhr = null;
    var uploadProgress = 0;
    var uploadLoadedBytes = 0;
    var uploadTotalBytes = 0;
    var uploadFileCount = 0;
    var uploadSuccessMessage = '';
    var uploadSuccessTimer = null;
    var selectedPaths = {};
    var batchActionLoading = false;
    var focusedIndex = 0;
    var showShortcutsModal = false;
    var storageStats = null;
    var showStorageDetails = false;
    var editMode = false;
    var editorState = {
      loaded: false,
      rotation: 0,
      flipH: false,
      flipV: false,
      aspectRatio: 'free',
      naturalWidth: 0,
      naturalHeight: 0,
      cropX: 0,
      cropY: 0,
      cropW: 100,
      cropH: 100,
      targetWidth: 0,
      targetHeight: 0,
      lockRatio: true,
      format: 'original',
      saving: false,
      saveStatus: '',
    };
    var loadedImageMeta = {};

    var textEditMode = false;
    var textEditorState = {
      loading: false,
      saving: false,
      saveStatus: '',
      error: null,
      file: null,
      content: '',
      initialContent: '',
      lineCount: 1,
      charCount: 0,
      wordWrap: false,
      fontSize: 13,
      isJson: false,
      jsonError: null,
    };

    function openTextEditor(item) {
      if (!item || item.isDir) return;
      textEditMode = true;
      modalState = null;
      textEditorState.loading = true;
      textEditorState.saving = false;
      textEditorState.saveStatus = '';
      textEditorState.error = null;
      textEditorState.file = item;
      textEditorState.content = '';
      textEditorState.initialContent = '';
      textEditorState.isJson = (item.ext || '').toLowerCase() === 'json';
      textEditorState.jsonError = null;

      api.get(API + '/content?path=' + encodeURIComponent(item.path)).then(function(res) {
        textEditorState.loading = false;
        textEditorState.content = res.content || '';
        textEditorState.initialContent = res.content || '';
        updateTextStats();
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      }).catch(function(err) {
        textEditorState.loading = false;
        textEditorState.error = err.message || String(err);
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      });
    }

    function updateTextStats() {
      var lines = textEditorState.content.split(String.fromCharCode(10));
      textEditorState.lineCount = lines.length;
      textEditorState.charCount = textEditorState.content.length;
      if (textEditorState.isJson) {
        try {
          if (textEditorState.content.trim()) {
            JSON.parse(textEditorState.content);
          }
          textEditorState.jsonError = null;
        } catch (e) {
          textEditorState.jsonError = e.message;
        }
      }
    }

    function formatJsonContent() {
      try {
        var parsed = JSON.parse(textEditorState.content);
        textEditorState.content = JSON.stringify(parsed, null, 2);
        textEditorState.jsonError = null;
        updateTextStats();
      } catch (e) {
        alert('Invalid JSON: ' + e.message);
      }
    }

    function saveTextContent(overwrite) {
      if (!textEditorState.file || textEditorState.saving) return;
      textEditorState.saving = true;
      textEditorState.saveStatus = 'Saving…';
      if (typeof m !== 'undefined' && m.redraw) m.redraw();

      api.post(API + '/save-content', {
        path: textEditorState.file.path,
        content: textEditorState.content,
        overwrite: !!overwrite
      }).then(function(res) {
        textEditorState.saving = false;
        textEditorState.saveStatus = 'Saved successfully!';
        textEditorState.initialContent = textEditorState.content;
        setTimeout(function() {
          textEditorState.saveStatus = '';
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        }, 2500);
        if (res && res.file) {
          textEditorState.file = res.file;
          selectedItem = res.file;
        }
        loadDirectory();
      }).catch(function(err) {
        textEditorState.saving = false;
        textEditorState.saveStatus = '';
        alert('Failed to save file: ' + (err.message || String(err)));
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      });
    }

    function getSelectedPathsList() {
      return Object.keys(selectedPaths).filter(function(k) { return !!selectedPaths[k]; });
    }

    function isSelected(item) {
      return !!selectedPaths[item.path];
    }

    function toggleSelect(item, e) {
      if (e && e.stopPropagation) e.stopPropagation();
      if (selectedPaths[item.path]) {
        delete selectedPaths[item.path];
      } else {
        selectedPaths[item.path] = item;
      }
      if (typeof m !== 'undefined' && m.redraw) m.redraw();
    }

    function isAllSelected() {
      if (!items || items.length === 0) return false;
      for (var i = 0; i < items.length; i++) {
        if (!selectedPaths[items[i].path]) return false;
      }
      return true;
    }

    function toggleSelectAll() {
      if (isAllSelected()) {
        clearSelection();
      } else {
        for (var i = 0; i < items.length; i++) {
          selectedPaths[items[i].path] = items[i];
        }
      }
      if (typeof m !== 'undefined' && m.redraw) m.redraw();
    }

    function clearSelection() {
      selectedPaths = {};
      if (typeof m !== 'undefined' && m.redraw) m.redraw();
    }

    function downloadBatchZip() {
      var paths = getSelectedPathsList();
      if (paths.length === 0) return;
      var query = paths.map(function(p) { return 'paths=' + encodeURIComponent(p); }).join('&');
      var downloadUrl = (window.__ADMIN_PATH__ || '/_admin') + '/api' + API + '/download-zip?' + query;
      window.open(downloadUrl, '_blank');
    }

    function deleteBatchSelected() {
      var paths = getSelectedPathsList();
      if (paths.length === 0) return;
      if (!confirm('Are you sure you want to delete ' + paths.length + ' selected item(s)?')) return;
      batchActionLoading = true;
      if (typeof m !== 'undefined' && m.redraw) m.redraw();

      api.post(API + '/batch-delete', { paths: paths }).then(function(res) {
        batchActionLoading = false;
        clearSelection();
        loadDirectory();
      }).catch(function(err) {
        batchActionLoading = false;
        alert('Failed to delete selected items: ' + (err.message || String(err)));
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      });
    }

    function moveBatchSelected() {
      var paths = getSelectedPathsList();
      if (paths.length === 0) return;
      var target = prompt('Enter target relative directory path to move selected items into:', currentPath);
      if (target === null) return;
      batchActionLoading = true;
      if (typeof m !== 'undefined' && m.redraw) m.redraw();

      api.post(API + '/batch-move', { paths: paths, destination: target }).then(function(res) {
        batchActionLoading = false;
        clearSelection();
        loadDirectory();
      }).catch(function(err) {
        batchActionLoading = false;
        alert('Failed to move selected items: ' + (err.message || String(err)));
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      });
    }

    function loadDirectory(pathParam) {
      if (pathParam !== undefined) currentPath = pathParam;
      selectedPaths = {};
      loading = true;
      error = null;

      var q = '?path=' + encodeURIComponent(currentPath);
      if (searchQuery) q += '&search=' + encodeURIComponent(searchQuery);
      if (typeFilter && typeFilter !== 'all') q += '&type=' + encodeURIComponent(typeFilter);
      if (sort) q += '&sort=' + encodeURIComponent(sort) + '&order=' + encodeURIComponent(order);

      api.get(API + q).then(function(res) {
        items = res.items || [];
        breadcrumbs = res.breadcrumbs || [{ name: 'Root', path: '' }];
        if (res.storage) {
          storageStats = res.storage;
        }
        loading = false;
        focusedIndex = Math.max(0, Math.min(focusedIndex, Math.max(0, items.length - 1)));
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      }).catch(function(err) {
        error = err.message || String(err);
        loading = false;
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      });
    }

    function loadStorageStats(force) {
      api.get(API + '/storage-stats' + (force ? '?refresh=true' : '')).then(function(res) {
        if (res && res.stats) {
          storageStats = res.stats;
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        }
      }).catch(function() {});
    }

    function createFolder() {
      if (!inputFolderValue.trim()) return;
      api.post(API + '/mkdir', { path: currentPath, name: inputFolderValue.trim() }).then(function() {
        modalState = null;
        inputFolderValue = '';
        loadDirectory();
      }).catch(function(err) {
        alert('Failed to create folder: ' + (err.message || String(err)));
      });
    }

    function renameSelected() {
      if (!selectedItem || !inputRenameValue.trim()) return;
      api.post(API + '/rename', { path: selectedItem.path, newName: inputRenameValue.trim() }).then(function() {
        modalState = null;
        inputRenameValue = '';
        selectedItem = null;
        loadDirectory();
      }).catch(function(err) {
        alert('Failed to rename: ' + (err.message || String(err)));
      });
    }

    function deleteSelected() {
      if (!selectedItem) return;
      api.post(API + '/delete', { path: selectedItem.path }).then(function() {
        modalState = null;
        selectedItem = null;
        loadDirectory();
      }).catch(function(err) {
        alert('Silinemedi: ' + (err.message || String(err)));
      });
    }

    function cancelUpload() {
      if (activeXhr) {
        try { activeXhr.abort(); } catch (_) {}
        activeXhr = null;
      }
      uploading = false;
      uploadProgress = 0;
      uploadStatus = 'Upload cancelled';
      if (typeof m !== 'undefined' && m.redraw) m.redraw();
    }

    function handleFileUpload(fileList) {
      if (!fileList || fileList.length === 0) return;
      uploading = true;
      uploadProgress = 0;
      uploadLoadedBytes = 0;
      uploadTotalBytes = 0;
      uploadFileCount = fileList.length;
      uploadStatus = 'Uploading ' + fileList.length + ' file(s)…';
      uploadSuccessMessage = '';
      if (uploadSuccessTimer) clearTimeout(uploadSuccessTimer);
      if (typeof m !== 'undefined' && m.redraw) m.redraw();

      var fd = new FormData();
      for (var i = 0; i < fileList.length; i++) {
        fd.append('files', fileList[i]);
      }

      var uploadUrl = (window.__ADMIN_PATH__ || '/_admin') + '/api' + API + '/upload?path=' + encodeURIComponent(currentPath);

      var xhr = new XMLHttpRequest();
      activeXhr = xhr;

      xhr.upload.onprogress = function(evt) {
        if (evt.lengthComputable) {
          uploadLoadedBytes = evt.loaded;
          uploadTotalBytes = evt.total;
          uploadProgress = Math.min(100, Math.round((evt.loaded / evt.total) * 100));
          uploadStatus = 'Uploading ' + uploadFileCount + ' file(s) (' + formatBytes(evt.loaded) + ' / ' + formatBytes(evt.total) + ')';
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        }
      };

      xhr.onload = function() {
        activeXhr = null;
        uploading = false;
        uploadProgress = 100;
        try {
          var res = JSON.parse(xhr.responseText || '{}');
          if (xhr.status >= 200 && xhr.status < 300 && res.success) {
            uploadSuccessMessage = (res.files && res.files.length ? res.files.length : uploadFileCount) + ' file(s) successfully uploaded!';
            uploadSuccessTimer = setTimeout(function() {
              uploadSuccessMessage = '';
              if (typeof m !== 'undefined' && m.redraw) m.redraw();
            }, 4000);
            loadDirectory();
          } else {
            alert('Upload error: ' + (res.error || ('HTTP ' + xhr.status)));
            if (typeof m !== 'undefined' && m.redraw) m.redraw();
          }
        } catch (e) {
          alert('Upload failed: ' + (e.message || String(e)));
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        }
      };

      xhr.onerror = function() {
        activeXhr = null;
        uploading = false;
        uploadProgress = 0;
        alert('Network error while uploading');
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      };

      xhr.onabort = function() {
        activeXhr = null;
        uploading = false;
        uploadProgress = 0;
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      };

      xhr.open('POST', uploadUrl, true);
      xhr.withCredentials = true;
      xhr.send(fd);
    }

    if (typeof window !== 'undefined') {
      window.__fmDropzoneTest = {
        setDrag: function(active) {
          isDraggingOver = !!active;
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        },
        setProgress: function(pct, loaded, total, status) {
          uploading = true;
          uploadProgress = pct;
          uploadLoadedBytes = loaded || 2450000;
          uploadTotalBytes = total || 5000000;
          uploadStatus = status || ('Uploading 3 file(s) (' + formatBytes(uploadLoadedBytes) + ' / ' + formatBytes(uploadTotalBytes) + ')');
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        },
        setSuccess: function(msg) {
          uploading = false;
          uploadSuccessMessage = msg || '3 file(s) successfully uploaded!';
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        },
        selectFirst: function(n) {
          selectedPaths = {};
          for (var i = 0; i < Math.min(n || 2, items.length); i++) {
            selectedPaths[items[i].path] = items[i];
          }
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        },
        reset: function() {
          uploading = false;
          isDraggingOver = false;
          uploadSuccessMessage = '';
          selectedPaths = {};
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        },
        setFocusedIndex: function(idx) {
          focusedIndex = idx;
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        },
        getFocusedIndex: function() { return focusedIndex; },
        toggleShortcutsModal: function(show) {
          showShortcutsModal = typeof show === 'boolean' ? show : !showShortcutsModal;
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        },
        isShortcutsModalOpen: function() { return showShortcutsModal; },
        setStorageStats: function(stats) {
          storageStats = stats;
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        },
        getStorageStats: function() { return storageStats; },
        toggleStorageDetails: function(show) {
          showStorageDetails = typeof show === 'boolean' ? show : !showStorageDetails;
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        },
        isStorageDetailsOpen: function() { return showStorageDetails; }
      };
    }

    function isEditableActive() {
      var el = document.activeElement;
      if (!el) return false;
      var tag = el.tagName ? el.tagName.toLowerCase() : '';
      return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
    }

    function handleGlobalKeydown(e) {
      if (!e) return;

      // Ignore when typing inside editable inputs
      if (isEditableActive()) {
        if (e.key === 'Escape') {
          if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        }
        return;
      }

      // If text editor or image editor is active
      if (textEditMode) {
        if (e.key === 'Escape') {
          if (textEditorState.content !== textEditorState.initialContent) {
            if (!confirm('You have unsaved changes. Discard them?')) return;
          }
          textEditMode = false;
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        }
        return;
      }
      if (editMode) {
        if (e.key === 'Escape') {
          editMode = false;
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        }
        return;
      }

      // Close shortcuts modal if open
      if (showShortcutsModal) {
        if (e.key === 'Escape' || e.key === '?' || e.key === 'h' || e.key === 'H') {
          e.preventDefault();
          showShortcutsModal = false;
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        }
        return;
      }

      // Handle Escape: close open modal or clear selection
      if (e.key === 'Escape') {
        if (modalState) {
          e.preventDefault();
          modalState = null;
          selectedItem = null;
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
          return;
        }
        var curSelected = getSelectedPathsList();
        if (curSelected.length > 0) {
          e.preventDefault();
          selectedPaths = {};
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
          return;
        }
      }

      // If other dialogs (rename, delete, newFolder) are open, let modal handle it
      if (modalState && modalState !== 'preview') {
        return;
      }

      // Toggle shortcuts cheatsheet with '?' or 'h'
      if (e.key === '?' || ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        showShortcutsModal = true;
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
        return;
      }

      // Focus search input with '/'
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        var searchEl = document.getElementById('fm-search-input');
        if (searchEl) {
          searchEl.focus();
          searchEl.select();
        }
        return;
      }

      // Select All with Cmd+A or Ctrl+A
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        toggleSelectAll();
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
        return;
      }

      // Space: Finder-style Quick Look
      if (e.key === ' ' || e.code === 'Space') {
        if (items.length > 0 && focusedIndex < items.length) {
          e.preventDefault();
          if (modalState === 'preview') {
            modalState = null;
            selectedItem = null;
          } else {
            selectedItem = items[focusedIndex];
            modalState = 'preview';
          }
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        }
        return;
      }

      // If preview modal is open, arrows cycle through items
      if (modalState === 'preview') {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          if (items.length > 0) {
            focusedIndex = (focusedIndex + 1) % items.length;
            selectedItem = items[focusedIndex];
            if (typeof m !== 'undefined' && m.redraw) m.redraw();
          }
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (items.length > 0) {
            focusedIndex = (focusedIndex - 1 + items.length) % items.length;
            selectedItem = items[focusedIndex];
            if (typeof m !== 'undefined' && m.redraw) m.redraw();
          }
          return;
        }
        return;
      }

      // Arrow navigation in items list
      if (e.key === 'ArrowRight') {
        if (items.length > 0) {
          e.preventDefault();
          focusedIndex = (focusedIndex + 1) % items.length;
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        }
        return;
      }
      if (e.key === 'ArrowLeft') {
        if (items.length > 0) {
          e.preventDefault();
          focusedIndex = (focusedIndex - 1 + items.length) % items.length;
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        if (items.length > 0) {
          e.preventDefault();
          var step = viewMode === 'grid' ? 4 : 1;
          focusedIndex = Math.min(items.length - 1, focusedIndex + step);
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        if (items.length > 0) {
          e.preventDefault();
          var stepUp = viewMode === 'grid' ? 4 : 1;
          focusedIndex = Math.max(0, focusedIndex - stepUp);
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        }
        return;
      }

      // Enter: Open folder or view file
      if (e.key === 'Enter') {
        if (items.length > 0 && focusedIndex < items.length) {
          e.preventDefault();
          var itm = items[focusedIndex];
          if (itm.isDir) {
            loadDirectory(itm.path);
            focusedIndex = 0;
          } else if (isPickerMode && onSelectCallback) {
            onSelectCallback(itm.publicUrl, itm);
          } else {
            selectedItem = itm;
            modalState = 'preview';
          }
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        }
        return;
      }

      // Parent folder: Alt+Up or Cmd/Ctrl+Up
      if ((e.altKey && e.key === 'ArrowUp') || ((e.metaKey || e.ctrlKey) && e.key === 'ArrowUp')) {
        if (breadcrumbs.length > 1) {
          e.preventDefault();
          var parentBc = breadcrumbs[breadcrumbs.length - 2];
          loadDirectory(parentBc.path);
          focusedIndex = 0;
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        }
        return;
      }

      // Toggle selection with 'x'
      if ((e.key === 'x' || e.key === 'X') && !e.ctrlKey && !e.metaKey) {
        if (items.length > 0 && focusedIndex < items.length) {
          e.preventDefault();
          var toggleItem = items[focusedIndex];
          if (selectedPaths[toggleItem.path]) {
            delete selectedPaths[toggleItem.path];
          } else {
            selectedPaths[toggleItem.path] = toggleItem;
          }
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        }
        return;
      }

      // Quick edit with 'e'
      if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey) {
        if (items.length > 0 && focusedIndex < items.length) {
          var editItm = items[focusedIndex];
          if (isTextFile(editItm)) {
            e.preventDefault();
            openTextEditor(editItm);
          } else if (editItm.type === 'image' && editItm.publicUrl && !editItm.name.endsWith('.svg')) {
            e.preventDefault();
            selectedItem = editItm;
            openImageEditor(editItm);
          }
        }
        return;
      }

      // Rename with 'r'
      if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey) {
        if (items.length > 0 && focusedIndex < items.length) {
          e.preventDefault();
          selectedItem = items[focusedIndex];
          inputRenameValue = selectedItem.name;
          modalState = 'rename';
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        }
        return;
      }

      // Delete with Delete or Cmd+Backspace
      if (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        var selPaths = getSelectedPathsList();
        if (selPaths.length > 0) {
          deleteBatchSelected();
        } else if (items.length > 0 && focusedIndex < items.length) {
          selectedItem = items[focusedIndex];
          modalState = 'delete';
        }
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
        return;
      }
    }

    function openImageEditor(item) {
      if (!item || item.type !== 'image' || !item.publicUrl) return;
      editMode = true;
      editorState.loaded = false;
      editorState.rotation = 0;
      editorState.flipH = false;
      editorState.flipV = false;
      editorState.aspectRatio = 'free';
      editorState.cropX = 0;
      editorState.cropY = 0;
      editorState.cropW = 100;
      editorState.cropH = 100;
      editorState.saving = false;
      editorState.saveStatus = '';
      editorState.format = 'original';

      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function() {
        editorState.loaded = true;
        editorState.naturalWidth = img.naturalWidth;
        editorState.naturalHeight = img.naturalHeight;
        editorState.targetWidth = img.naturalWidth;
        editorState.targetHeight = img.naturalHeight;
        loadedImageMeta[item.path] = { width: img.naturalWidth, height: img.naturalHeight };
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      };
      img.onerror = function() {
        alert('Could not load image for editing.');
        editMode = false;
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      };
      img.src = item.publicUrl;
    }

    function setAspectRatio(ratio) {
      editorState.aspectRatio = ratio;
      if (ratio === '1:1') {
        var minSide = Math.min(editorState.cropW, editorState.cropH);
        editorState.cropW = minSide;
        editorState.cropH = minSide;
      } else if (ratio === '16:9') {
        editorState.cropW = 100;
        editorState.cropH = Math.min(100, Math.round((100 * (editorState.naturalWidth * 9)) / (editorState.naturalHeight * 16)));
      } else if (ratio === '4:3') {
        editorState.cropW = 100;
        editorState.cropH = Math.min(100, Math.round((100 * (editorState.naturalWidth * 3)) / (editorState.naturalHeight * 4)));
      }
    }

    function saveTransformedImage(overwrite) {
      if (!selectedItem || editorState.saving) return;
      editorState.saving = true;
      editorState.saveStatus = 'Applying transformations…';
      if (typeof m !== 'undefined' && m.redraw) m.redraw();

      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function() {
        try {
          var canvas = document.createElement('canvas');
          var ctx = canvas.getContext('2d');

          var sx = (editorState.cropX / 100) * img.naturalWidth;
          var sy = (editorState.cropY / 100) * img.naturalHeight;
          var sw = (editorState.cropW / 100) * img.naturalWidth;
          var sh = (editorState.cropH / 100) * img.naturalHeight;

          var isRotated90 = (editorState.rotation % 180 !== 0);
          var outW = editorState.targetWidth || Math.round(sw);
          var outH = editorState.targetHeight || Math.round(sh);

          canvas.width = isRotated90 ? outH : outW;
          canvas.height = isRotated90 ? outW : outH;

          ctx.save();
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate((editorState.rotation * Math.PI) / 180);
          ctx.scale(editorState.flipH ? -1 : 1, editorState.flipV ? -1 : 1);

          var drawW = isRotated90 ? canvas.height : canvas.width;
          var drawH = isRotated90 ? canvas.width : canvas.height;
          ctx.drawImage(img, sx, sy, sw, sh, -drawW / 2, -drawH / 2, drawW, drawH);
          ctx.restore();

          var mime = 'image/png';
          if (editorState.format && editorState.format !== 'original') {
            mime = editorState.format;
          } else if (selectedItem.ext === 'jpg' || selectedItem.ext === 'jpeg') {
            mime = 'image/jpeg';
          } else if (selectedItem.ext === 'webp') {
            mime = 'image/webp';
          }

          var dataUrl = canvas.toDataURL(mime, 0.92);

          api.post(API + '/save-image', {
            path: selectedItem.path,
            dataUrl: dataUrl,
            overwrite: !!overwrite
          }).then(function(res) {
            editorState.saving = false;
            editorState.saveStatus = '';
            editMode = false;
            if (res && res.file) {
              selectedItem = res.file;
            }
            loadDirectory();
          }).catch(function(err) {
            editorState.saving = false;
            editorState.saveStatus = '';
            alert('Failed to save image: ' + (err.message || String(err)));
            if (typeof m !== 'undefined' && m.redraw) m.redraw();
          });
        } catch (e) {
          editorState.saving = false;
          editorState.saveStatus = '';
          alert('Canvas processing error: ' + (e.message || String(e)));
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        }
      };
      img.onerror = function() {
        editorState.saving = false;
        editorState.saveStatus = '';
        alert('Could not reload image for canvas export.');
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      };
      img.src = selectedItem.publicUrl + (selectedItem.publicUrl.indexOf('?') === -1 ? '?t=' : '&t=') + Date.now();
    }

    return {
      oninit: function() {
        if (typeof window !== 'undefined') {
          window.addEventListener('keydown', handleGlobalKeydown);
        }
        if (isPickerMode && pickerAccept) {
          if (pickerAccept.indexOf('image') !== -1) typeFilter = 'image';
          else if (pickerAccept.indexOf('video') !== -1) typeFilter = 'video';
          else if (pickerAccept.indexOf('audio') !== -1) typeFilter = 'audio';
          else if (pickerAccept.indexOf('pdf') !== -1) typeFilter = 'document';
        }
        loadDirectory('');
      },

      onremove: function() {
        if (typeof window !== 'undefined') {
          window.removeEventListener('keydown', handleGlobalKeydown);
        }
      },

      view: function() {
        return m('div.space-y-4', [
          // Toolbar
          m('div.flex.flex-col.md:flex-row.md:items-center.justify-between.gap-3.bg-white.dark:bg-slate-800.p-4.rounded-xl.border.border-gray-200.dark:border-slate-700.shadow-sm', [
            // Left: Breadcrumbs & Select All
            m('div.flex.items-center.gap-3.flex-wrap.text-sm', [
              !loading && !error && items.length > 0 ? m('label.flex.items-center.gap-1.5.cursor-pointer.px-2.5.py-1.rounded-lg.border.border-gray-200.dark:border-slate-700.bg-gray-50.dark:bg-slate-900.text-xs.font-medium.text-gray-700.dark:text-slate-300.hover:bg-gray-100.dark:hover:bg-slate-800.transition.select-none', [
                m('input[type=checkbox].rounded.border-gray-300.text-indigo-600.focus:ring-indigo-500.cursor-pointer', {
                  checked: isAllSelected(),
                  onchange: toggleSelectAll
                }),
                m('span', isAllSelected() ? 'Unselect All' : 'Select All')
              ]) : null,
              m('div.flex.items-center.gap-2.flex-wrap', [
                m('span.text-gray-400.dark:text-slate-500', '📁'),
                breadcrumbs.map(function(bc, idx) {
                  var isLast = idx === breadcrumbs.length - 1;
                  return m('span.flex.items-center.gap-2', [
                    isLast
                      ? m('span.font-semibold.text-gray-900.dark:text-slate-100', bc.name)
                      : m('button.text-indigo-600.dark:text-indigo-400.hover:underline', {
                          onclick: function() { loadDirectory(bc.path); }
                        }, bc.name),
                    !isLast ? m('span.text-gray-400.dark:text-slate-600', '/') : null
                  ]);
                })
              ])
            ]),

            // Right: Actions & Tools
            m('div.flex.items-center.gap-2.flex-wrap', [
              // Search input
              m('div.relative', [
                m('input#fm-search-input.text-xs.pl-8.pr-3.py-1.5.border.border-gray-200.dark:border-slate-700.rounded-lg.bg-gray-50.dark:bg-slate-900.text-gray-900.dark:text-slate-100.placeholder-gray-400', {
                  id: 'fm-search-input',
                  type: 'text',
                  placeholder: 'Search files… (/ to focus)',
                  value: searchQuery,
                  oninput: function(e) { searchQuery = e.target.value; },
                  onkeydown: function(e) { if (e.key === 'Enter') loadDirectory(); }
                }),
                m('span.absolute.left-2.5.top-2.text-gray-400', '🔍')
              ]),

              // Type filter
              m('select.text-xs.px-2.5.py-1.5.border.border-gray-200.dark:border-slate-700.rounded-lg.bg-gray-50.dark:bg-slate-900.text-gray-800.dark:text-slate-200', {
                value: typeFilter,
                onchange: function(e) { typeFilter = e.target.value; loadDirectory(); }
              }, [
                m('option', { value: 'all' }, 'All Files'),
                m('option', { value: 'image' }, 'Images'),
                m('option', { value: 'document' }, 'Documents'),
                m('option', { value: 'video' }, 'Videos'),
                m('option', { value: 'audio' }, 'Audio'),
                m('option', { value: 'archive' }, 'Archives'),
                m('option', { value: 'code' }, 'Code & Text'),
              ]),

              // Grid / List View switch
              m('div.flex.border.border-gray-200.dark:border-slate-700.rounded-lg.overflow-hidden', [
                m('button.px-2.5.py-1.text-xs.font-medium', {
                  class: viewMode === 'grid' ? 'bg-indigo-600 text-white' : 'bg-gray-50 dark:bg-slate-900 text-gray-700 dark:text-slate-300',
                  onclick: function() { viewMode = 'grid'; }
                }, 'Grid'),
                m('button.px-2.5.py-1.text-xs.font-medium', {
                  class: viewMode === 'list' ? 'bg-indigo-600 text-white' : 'bg-gray-50 dark:bg-slate-900 text-gray-700 dark:text-slate-300',
                  onclick: function() { viewMode = 'list'; }
                }, 'List'),
              ]),

              // New Folder Button
              m('button.px-3.py-1.5.text-xs.font-medium.bg-gray-100.dark:bg-slate-700.hover:bg-gray-200.dark:hover:bg-slate-600.text-gray-800.dark:text-slate-200.rounded-lg.flex.items-center.gap-1.transition', {
                onclick: function() { inputFolderValue = ''; modalState = 'newFolder'; }
              }, [
                m('span', '+'),
                m('span', 'New Folder')
              ]),

              // Upload Button
              m('label.px-3.py-1.5.text-xs.font-medium.bg-indigo-600.hover:bg-indigo-700.text-white.rounded-lg.cursor-pointer.flex.items-center.gap-1.transition', [
                m('span', '↑'),
                m('span', 'Upload'),
                m('input[type=file].hidden', {
                  multiple: true,
                  onchange: function(e) { handleFileUpload(e.target.files); e.target.value = ''; }
                })
              ]),

              // Shortcuts Cheatsheet
              m('button.px-2.5.py-1.5.text-xs.font-medium.bg-gray-100.dark:bg-slate-700.hover:bg-gray-200.dark:hover:bg-slate-600.text-gray-700.dark:text-slate-300.rounded-lg.flex.items-center.gap-1.transition', {
                title: 'Keyboard Shortcuts (Press ? or h)',
                onclick: function() { showShortcutsModal = true; }
              }, [
                m('span', '⌨️'),
                m('span.hidden.sm:inline', 'Shortcuts')
              ]),

              // Refresh
              m('button.p-1.5.text-xs.text-gray-500.hover:text-gray-900.dark:hover:text-slate-100.rounded-lg', {
                title: 'Refresh',
                onclick: function() { loadDirectory(); }
              }, '🔄')
            ])
          ]),

          // Upload Progress Banner / Card
          uploading ? m('div.p-4.bg-white.dark:bg-slate-800.border.border-indigo-200.dark:border-indigo-800.rounded-xl.shadow-sm.flex.flex-col.gap-2.animate-in.fade-in', [
            m('div.flex.items-center.justify-between.text-xs', [
              m('div.flex.items-center.gap-2', [
                m('span.w-2.h-2.rounded-full.bg-indigo-600.animate-ping'),
                m('span.font-semibold.text-gray-900.dark:text-slate-100', uploadStatus || 'Uploading files…'),
              ]),
              m('div.flex.items-center.gap-3', [
                m('span.font-mono.font-bold.text-indigo-600.dark:text-indigo-400', uploadProgress + '%'),
                m('button.text-xs.text-red-500.hover:text-red-700.dark:hover:text-red-400.font-medium.px-2.py-0.5.rounded.border.border-red-200.dark:border-red-900/40.hover:bg-red-50.dark:hover:bg-red-950/30.transition', {
                  onclick: cancelUpload
                }, 'Cancel')
              ])
            ]),
            m('div.w-full.h-2.bg-gray-100.dark:bg-slate-700.rounded-full.overflow-hidden', [
              m('div.h-full.bg-gradient-to-r.from-indigo-500.to-violet-600.rounded-full.transition-all.duration-200', {
                style: { width: uploadProgress + '%' }
              })
            ]),
            uploadTotalBytes > 0 ? m('div.flex.items-center.justify-between.text-[11px].text-gray-400.dark:text-slate-400', [
              m('span', formatBytes(uploadLoadedBytes) + ' uploaded'),
              m('span', 'Total ' + formatBytes(uploadTotalBytes))
            ]) : null
          ]) : null,

          // Upload Success Banner
          uploadSuccessMessage ? m('div.p-3.bg-emerald-50.dark:bg-emerald-950/40.border.border-emerald-200.dark:border-emerald-800.rounded-xl.flex.items-center.justify-between.text-xs.text-emerald-800.dark:text-emerald-200.shadow-sm.animate-in.fade-in', [
            m('div.flex.items-center.gap-2', [
              m('span.text-base', '✅'),
              m('span.font-medium', uploadSuccessMessage)
            ]),
            m('button.text-emerald-600.dark:text-emerald-400.hover:text-emerald-900.font-bold.px-1', {
              onclick: function() { uploadSuccessMessage = ''; }
            }, '✕')
          ]) : null,

          // STORAGE USAGE & QUOTA VISUALIZER (OPTION 6)
          storageStats ? m('div.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.rounded-xl.p-3.5.shadow-sm.space-y-2.5', [
            // Top row: Usage stats & Controls
            m('div.flex.flex-col.sm:flex-row.sm:items-center.justify-between.gap-2.text-xs', [
              m('div.flex.items-center.gap-2.flex-wrap', [
                m('span.text-base', '💾'),
                m('span.font-semibold.text-gray-900.dark:text-slate-100', 'Storage:'),
                m('span.font-medium.text-gray-700.dark:text-slate-300', storageStats.formattedTotal + ' of ' + storageStats.formattedQuota),
                m('span.px-2.py-0.5.rounded-full.text-[11px].font-semibold', {
                  class: storageStats.isOverLimit
                    ? 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                    : storageStats.isNearLimit
                    ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                    : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                }, storageStats.usagePercent + '% used' + (storageStats.isOverLimit ? ' (Over Quota!)' : storageStats.isNearLimit ? ' (Near Quota)' : '')),
              ]),

              m('div.flex.items-center.gap-3.text-gray-500.dark:text-slate-400', [
                m('span', storageStats.fileCount + ' files · ' + storageStats.folderCount + ' folders'),
                m('button.text-indigo-600.dark:text-indigo-400.hover:underline.font-medium.flex.items-center.gap-1', {
                  onclick: function() { showStorageDetails = !showStorageDetails; }
                }, [
                  m('span', showStorageDetails ? 'Hide Breakdown' : 'Breakdown'),
                  m('span.text-[10px]', showStorageDetails ? '▲' : '▼')
                ]),
                m('button.p-1.text-gray-400.hover:text-gray-700.dark:hover:text-slate-200.rounded', {
                  title: 'Refresh Storage Stats',
                  onclick: function() { loadStorageStats(true); }
                }, '🔄')
              ])
            ]),

            // Segmented Progress Bar
            m('div.w-full.h-2.5.bg-gray-100.dark:bg-slate-700/60.rounded-full.overflow-hidden.flex.shadow-inner', [
              storageStats.categories.images && storageStats.categories.images.bytes > 0
                ? m('div.h-full.bg-emerald-500.transition-all', {
                    style: { width: Math.max(1, storageStats.categories.images.percent) + '%' },
                    title: 'Images: ' + storageStats.categories.images.formattedBytes + ' (' + storageStats.categories.images.percent + '%)'
                  }) : null,
              storageStats.categories.documents && storageStats.categories.documents.bytes > 0
                ? m('div.h-full.bg-indigo-500.transition-all', {
                    style: { width: Math.max(1, storageStats.categories.documents.percent) + '%' },
                    title: 'Documents: ' + storageStats.categories.documents.formattedBytes + ' (' + storageStats.categories.documents.percent + '%)'
                  }) : null,
              storageStats.categories.code && storageStats.categories.code.bytes > 0
                ? m('div.h-full.bg-amber-500.transition-all', {
                    style: { width: Math.max(1, storageStats.categories.code.percent) + '%' },
                    title: 'Code & Text: ' + storageStats.categories.code.formattedBytes + ' (' + storageStats.categories.code.percent + '%)'
                  }) : null,
              storageStats.categories.media && storageStats.categories.media.bytes > 0
                ? m('div.h-full.bg-pink-500.transition-all', {
                    style: { width: Math.max(1, storageStats.categories.media.percent) + '%' },
                    title: 'Media: ' + storageStats.categories.media.formattedBytes + ' (' + storageStats.categories.media.percent + '%)'
                  }) : null,
              storageStats.categories.archives && storageStats.categories.archives.bytes > 0
                ? m('div.h-full.bg-purple-500.transition-all', {
                    style: { width: Math.max(1, storageStats.categories.archives.percent) + '%' },
                    title: 'Archives: ' + storageStats.categories.archives.formattedBytes + ' (' + storageStats.categories.archives.percent + '%)'
                  }) : null,
              storageStats.categories.other && storageStats.categories.other.bytes > 0
                ? m('div.h-full.bg-slate-400.transition-all', {
                    style: { width: Math.max(1, storageStats.categories.other.percent) + '%' },
                    title: 'Other: ' + storageStats.categories.other.formattedBytes + ' (' + storageStats.categories.other.percent + '%)'
                  }) : null
            ]),

            // Expanded Breakdown Details
            showStorageDetails ? m('div.pt-2.border-t.border-gray-100.dark:border-slate-700/60.grid.grid-cols-2.sm:grid-cols-3.md:grid-cols-6.gap-2.text-xs.animate-in.fade-in', [
              renderCategoryCard('Images', '🖼️', storageStats.categories.images, 'text-emerald-600 dark:text-emerald-400', 'bg-emerald-500'),
              renderCategoryCard('Documents', '📄', storageStats.categories.documents, 'text-indigo-600 dark:text-indigo-400', 'bg-indigo-500'),
              renderCategoryCard('Code & Text', '📝', storageStats.categories.code, 'text-amber-600 dark:text-amber-400', 'bg-amber-500'),
              renderCategoryCard('Media', '🎬', storageStats.categories.media, 'text-pink-600 dark:text-pink-400', 'bg-pink-500'),
              renderCategoryCard('Archives', '📦', storageStats.categories.archives, 'text-purple-600 dark:text-purple-400', 'bg-purple-500'),
              renderCategoryCard('Other', '🗂️', storageStats.categories.other, 'text-slate-600 dark:text-slate-400', 'bg-slate-400'),
            ]) : null
          ]) : null,

          // Main Content / Drop Zone
          m('div.min-h-[420px].relative', {
            ondragenter: function(e) {
              e.preventDefault();
              e.stopPropagation();
              dragCounter++;
              isDraggingOver = true;
              if (typeof m !== 'undefined' && m.redraw) m.redraw();
            },
            ondragleave: function(e) {
              e.preventDefault();
              e.stopPropagation();
              dragCounter--;
              if (dragCounter <= 0) {
                dragCounter = 0;
                isDraggingOver = false;
              }
              if (typeof m !== 'undefined' && m.redraw) m.redraw();
            },
            ondragover: function(e) {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'copy';
              }
            },
            ondrop: function(e) {
              e.preventDefault();
              e.stopPropagation();
              dragCounter = 0;
              isDraggingOver = false;
              if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleFileUpload(e.dataTransfer.files);
              }
              if (typeof m !== 'undefined' && m.redraw) m.redraw();
            }
          }, [
            // FULL SURFACE DROPZONE OVERLAY
            isDraggingOver ? m('div.absolute.inset-0.z-30.bg-indigo-600/15.dark:bg-indigo-500/25.backdrop-blur-sm.border-2.border-dashed.border-indigo-500.rounded-2xl.flex.flex-col.items-center.justify-center.p-8.pointer-events-none.transition-all', [
              m('div.w-20.h-20.rounded-2xl.bg-indigo-600.text-white.flex.items-center.justify-center.text-3xl.shadow-xl.shadow-indigo-500/30.mb-4.animate-bounce', '📥'),
              m('h3.text-lg.font-bold.text-indigo-950.dark:text-indigo-100', 'Drop files here to upload'),
              m('p.text-sm.text-indigo-700.dark:text-indigo-300.mt-1', 'Target Directory: ' + (currentPath ? '/' + currentPath : '/ (Root)')),
              m('div.mt-4.px-3.py-1.rounded-full.bg-white/80.dark:bg-slate-900/80.text-xs.font-semibold.text-indigo-600.dark:text-indigo-400.shadow-sm', 'Release to automatically upload')
            ]) : null,
            loading ? m('div.flex.flex-col.items-center.justify-center.py-20.text-gray-400', [
              m('div.w-8.h-8.border-2.border-indigo-600.border-t-transparent.rounded-full.animate-spin.mb-2'),
              m('p.text-xs', 'Loading files…')
            ]) : null,

            !loading && error ? m('div.p-6.text-center.text-red-600.dark:text-red-400.text-sm', error) : null,

            !loading && !error && items.length === 0 ? m('div.flex.flex-col.items-center.justify-center.py-20.text-gray-400.border-2.border-dashed.border-gray-200.dark:border-slate-800.rounded-xl', [
              m('span.text-4xl.mb-2', '📂'),
              m('p.text-sm.font-medium.text-gray-600.dark:text-slate-400', 'This folder is empty'),
              m('p.text-xs.text-gray-400.mt-1', 'You can drag and drop files here or use the "Upload" button.')
            ]) : null,

            // GRID VIEW
            !loading && !error && items.length > 0 && viewMode === 'grid' ? m('div.grid.grid-cols-2.sm:grid-cols-3.md:grid-cols-4.lg:grid-cols-6.gap-4', items.map(function(item, idx) {
              var isImg = item.type === 'image' && item.publicUrl;
              var selected = isSelected(item);
              var isFocused = (focusedIndex === idx);
              return m('div.group.relative.flex.flex-col.bg-white.dark:bg-slate-800.border.rounded-xl.p-3.hover:shadow-md.transition.cursor-pointer', {
                class: (selected ? 'border-indigo-500 ring-2 ring-indigo-500/50 bg-indigo-50/40 dark:bg-indigo-950/20 ' : 'border-gray-200 dark:border-slate-700 ') + (isFocused ? 'ring-2 ring-offset-2 ring-indigo-600 dark:ring-offset-slate-900 shadow-md ' : ''),
                onclick: function() {
                  focusedIndex = idx;
                  if (item.isDir) {
                    loadDirectory(item.path);
                  } else if (isPickerMode && onSelectCallback) {
                    onSelectCallback(item.publicUrl);
                  } else {
                    selectedItem = item;
                    modalState = 'preview';
                  }
                }
              }, [
                // Selection Checkbox
                m('div.absolute.top-2.left-2.z-10', [
                  m('input[type=checkbox].rounded.border-gray-300.text-indigo-600.focus:ring-indigo-500.cursor-pointer.w-4.h-4.shadow-sm', {
                    checked: selected,
                    onclick: function(e) { if (e && e.stopPropagation) e.stopPropagation(); },
                    onchange: function(e) { toggleSelect(item, e); }
                  })
                ]),

                // Thumbnail / Icon
                m('div.aspect-square.w-full.rounded-lg.bg-gray-50.dark:bg-slate-900.flex.items-center.justify-center.overflow-hidden.mb-2.relative', [
                  isImg
                    ? m('img.w-full.h-full.object-cover.group-hover:scale-105.transition.duration-300', { src: item.publicUrl, loading: 'lazy' })
                    : renderFileIcon(item),
                  item.isDir ? null : m('span.absolute.top-1.right-1.px-1.5.py-0.5.text-[10px].uppercase.font-bold.rounded.bg-black/40.text-white.backdrop-blur-sm', item.ext || item.type)
                ]),

                // Info
                m('p.text-xs.font-medium.text-gray-900.dark:text-slate-100.truncate', { title: item.name }, item.name),
                m('div.flex.items-center.justify-between.text-[11px].text-gray-400.dark:text-slate-500.mt-1', [
                  m('span', item.isDir ? 'Folder' : formatBytes(item.size)),
                  // Menu dots
                  m('div.relative.opacity-0.group-hover:opacity-100.transition', [
                    isTextFile(item) ? m('button.hover:text-indigo-600.px-1', {
                      title: 'Edit Code / Text',
                      onclick: function(e) {
                        e.stopPropagation();
                        openTextEditor(item);
                      }
                    }, '📝') : null,
                    item.type === 'image' && item.publicUrl && !item.name.endsWith('.svg') ? m('button.hover:text-indigo-600.px-1', {
                      title: 'Edit Image',
                      onclick: function(e) {
                        e.stopPropagation();
                        selectedItem = item;
                        openImageEditor(item);
                      }
                    }, '✂️') : null,
                    m('button.hover:text-gray-700.dark:hover:text-slate-200.px-1', {
                      onclick: function(e) {
                        e.stopPropagation();
                        selectedItem = item;
                        inputRenameValue = item.name;
                        modalState = 'rename';
                      }
                    }, '✏️'),
                    m('button.hover:text-red-600.px-1', {
                      onclick: function(e) {
                        e.stopPropagation();
                        selectedItem = item;
                        modalState = 'delete';
                      }
                    }, '🗑️'),
                  ])
                ])
              ]);
            })) : null,

            // LIST VIEW
            !loading && !error && items.length > 0 && viewMode === 'list' ? m('div.overflow-x-auto.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.rounded-xl', [
              m('table.min-w-full.text-left.text-xs', [
                m('thead.bg-gray-50.dark:bg-slate-900.border-b.border-gray-200.dark:border-slate-700.text-gray-500', [
                  m('tr', [
                    m('th.p-3.w-8', [
                      m('input[type=checkbox].rounded.border-gray-300.text-indigo-600.focus:ring-indigo-500.cursor-pointer', {
                        checked: isAllSelected(),
                        onchange: toggleSelectAll
                      })
                    ]),
                    m('th.p-3', 'Name'),
                    m('th.p-3', 'Type'),
                    m('th.p-3', 'Size'),
                    m('th.p-3', 'Date'),
                    m('th.p-3.text-right', 'Actions'),
                  ])
                ]),
                m('tbody.divide-y.divide-gray-100.dark:divide-slate-700/50', items.map(function(item, idx) {
                  var selected = isSelected(item);
                  var isFocused = (focusedIndex === idx);
                  return m('tr.transition.cursor-pointer', {
                    class: (selected ? 'bg-indigo-50/70 dark:bg-indigo-950/40 ' : 'hover:bg-gray-50/80 dark:hover:bg-slate-700/30 ') + (isFocused ? 'ring-2 ring-inset ring-indigo-500 font-semibold bg-indigo-50/40 dark:bg-indigo-950/30 ' : ''),
                    onclick: function() {
                      focusedIndex = idx;
                      if (item.isDir) {
                        loadDirectory(item.path);
                      } else if (isPickerMode && onSelectCallback) {
                        onSelectCallback(item.publicUrl);
                      } else {
                        selectedItem = item;
                        modalState = 'preview';
                      }
                    }
                  }, [
                    m('td.p-3.w-8', [
                      m('input[type=checkbox].rounded.border-gray-300.text-indigo-600.focus:ring-indigo-500.cursor-pointer', {
                        checked: selected,
                        onclick: function(e) { if (e && e.stopPropagation) e.stopPropagation(); },
                        onchange: function(e) { toggleSelect(item, e); }
                      })
                    ]),
                    m('td.p-3.flex.items-center.gap-2.font-medium.text-gray-900.dark:text-slate-100', [
                      m('span', renderFileIcon(item)),
                      m('span.truncate.max-w-xs.md:max-w-md', item.name)
                    ]),
                    m('td.p-3.text-gray-500.dark:text-slate-400', item.isDir ? 'Folder' : (item.ext || item.type).toUpperCase()),
                    m('td.p-3.text-gray-500.dark:text-slate-400', item.isDir ? '—' : formatBytes(item.size)),
                    m('td.p-3.text-gray-500.dark:text-slate-400', formatDate(item.mtime)),
                    m('td.p-3.text-right.space-x-2', [
                      isTextFile(item) ? m('button.text-indigo-600.dark:text-indigo-400.hover:underline.font-medium', {
                        onclick: function(e) {
                          e.stopPropagation();
                          openTextEditor(item);
                        }
                      }, 'Edit') : null,
                      item.type === 'image' && item.publicUrl && !item.name.endsWith('.svg') ? m('button.text-indigo-600.dark:text-indigo-400.hover:underline.font-medium', {
                        onclick: function(e) {
                          e.stopPropagation();
                          selectedItem = item;
                          openImageEditor(item);
                        }
                      }, 'Edit') : null,
                      !item.isDir && item.publicUrl ? m('button.text-indigo-600.dark:text-indigo-400.hover:underline', {
                        onclick: function(e) {
                          e.stopPropagation();
                          copyToClipboard(item.publicUrl);
                          alert('URL copied: ' + item.publicUrl);
                        }
                      }, 'URL') : null,
                      m('button.text-gray-600.dark:text-slate-400.hover:text-gray-900', {
                        onclick: function(e) {
                          e.stopPropagation();
                          selectedItem = item;
                          inputRenameValue = item.name;
                          modalState = 'rename';
                        }
                      }, 'Rename'),
                      m('button.text-red-600.dark:text-red-400.hover:underline', {
                        onclick: function(e) {
                          e.stopPropagation();
                          selectedItem = item;
                          modalState = 'delete';
                        }
                      }, 'Delete'),
                    ])
                  ]);
                }))
              ])
            ]) : null
          ]),

          // STICKY FLOATING BULK ACTION BAR
          getSelectedPathsList().length > 0 ? m('div.fixed.bottom-6.left-1/2.-translate-x-1/2.z-50.bg-slate-900/95.dark:bg-slate-800/95.text-white.px-5.py-3.rounded-2xl.shadow-2xl.backdrop-blur-md.border.border-slate-700.flex.items-center.gap-4.animate-in.fade-in', [
            m('div.flex.items-center.gap-2.border-r.border-slate-700.pr-4', [
              m('span.w-2.h-2.rounded-full.bg-indigo-400.animate-ping'),
              m('span.text-xs.font-semibold', getSelectedPathsList().length + ' selected')
            ]),

            // Action Buttons
            m('div.flex.items-center.gap-2', [
              // Download Zip
              m('button.px-3.py-1.5.bg-indigo-600.hover:bg-indigo-500.text-white.text-xs.font-medium.rounded-lg.flex.items-center.gap-1.5.transition.shadow-sm', {
                disabled: batchActionLoading,
                onclick: downloadBatchZip
              }, [
                m('span', '📦'),
                m('span', 'Download ZIP')
              ]),

              // Move
              m('button.px-3.py-1.5.bg-slate-800.dark:bg-slate-700.hover:bg-slate-700.dark:hover:bg-slate-600.text-white.text-xs.font-medium.rounded-lg.flex.items-center.gap-1.5.transition', {
                disabled: batchActionLoading,
                onclick: moveBatchSelected
              }, [
                m('span', '📁'),
                m('span', 'Move…')
              ]),

              // Delete
              m('button.px-3.py-1.5.bg-red-600/90.hover:bg-red-600.text-white.text-xs.font-medium.rounded-lg.flex.items-center.gap-1.5.transition.shadow-sm', {
                disabled: batchActionLoading,
                onclick: deleteBatchSelected
              }, [
                m('span', '🗑️'),
                m('span', 'Delete (' + getSelectedPathsList().length + ')')
              ]),

              // Deselect
              m('button.p-1.5.text-slate-400.hover:text-white.rounded-lg.text-xs.transition.ml-1', {
                title: 'Clear Selection',
                onclick: clearSelection
              }, '✕')
            ])
          ]) : null,

          // MODALS
          // 1. New Folder Modal
          modalState === 'newFolder' ? m('div.fixed.inset-0.bg-black/50.flex.items-center.justify-center.z-50.p-4', [
            m('div.bg-white.dark:bg-slate-800.rounded-xl.shadow-xl.max-w-md.w-full.p-6.space-y-4', [
              m('h3.text-base.font-bold.text-gray-900.dark:text-slate-100', 'Create New Folder'),
              m('input.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-lg.bg-white.dark:bg-slate-900.text-sm', {
                type: 'text',
                placeholder: 'Folder name…',
                value: inputFolderValue,
                oninput: function(e) { inputFolderValue = e.target.value; },
                onkeydown: function(e) { if (e.key === 'Enter') createFolder(); }
              }),
              m('div.flex.justify-end.gap-2', [
                m('button.px-4.py-2.text-xs.rounded-lg.border.border-gray-300.dark:border-slate-600.text-gray-700.dark:text-slate-300', {
                  onclick: function() { modalState = null; }
                }, 'Cancel'),
                m('button.px-4.py-2.text-xs.rounded-lg.bg-indigo-600.text-white.font-medium', {
                  onclick: createFolder
                }, 'Create')
              ])
            ])
          ]) : null,

          // 2. Rename Modal
          modalState === 'rename' && selectedItem ? m('div.fixed.inset-0.bg-black/50.flex.items-center.justify-center.z-50.p-4', [
            m('div.bg-white.dark:bg-slate-800.rounded-xl.shadow-xl.max-w-md.w-full.p-6.space-y-4', [
              m('h3.text-base.font-bold.text-gray-900.dark:text-slate-100', 'Rename'),
              m('input.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-lg.bg-white.dark:bg-slate-900.text-sm', {
                type: 'text',
                value: inputRenameValue,
                oninput: function(e) { inputRenameValue = e.target.value; },
                onkeydown: function(e) { if (e.key === 'Enter') renameSelected(); }
              }),
              m('div.flex.justify-end.gap-2', [
                m('button.px-4.py-2.text-xs.rounded-lg.border.border-gray-300.dark:border-slate-600.text-gray-700.dark:text-slate-300', {
                  onclick: function() { modalState = null; }
                }, 'Cancel'),
                m('button.px-4.py-2.text-xs.rounded-lg.bg-indigo-600.text-white.font-medium', {
                  onclick: renameSelected
                }, 'Save')
              ])
            ])
          ]) : null,

          // 3. Delete Confirmation Modal
          modalState === 'delete' && selectedItem ? m('div.fixed.inset-0.bg-black/50.flex.items-center.justify-center.z-50.p-4', [
            m('div.bg-white.dark:bg-slate-800.rounded-xl.shadow-xl.max-w-md.w-full.p-6.space-y-4', [
              m('h3.text-base.font-bold.text-red-600.dark:text-red-400', 'Confirm Delete'),
              m('p.text-sm.text-gray-600.dark:text-slate-300', [
                m('strong', selectedItem.name),
                ' will be permanently deleted. Are you sure?'
              ]),
              m('div.flex.justify-end.gap-2', [
                m('button.px-4.py-2.text-xs.rounded-lg.border.border-gray-300.dark:border-slate-600.text-gray-700.dark:text-slate-300', {
                  onclick: function() { modalState = null; }
                }, 'Cancel'),
                m('button.px-4.py-2.text-xs.rounded-lg.bg-red-600.text-white.font-medium', {
                  onclick: deleteSelected
                }, 'Delete')
              ])
            ])
          ]) : null,

          // 4. Preview Modal
          modalState === 'preview' && selectedItem && !editMode ? m('div.fixed.inset-0.bg-black/60.flex.items-center.justify-center.z-50.p-4.backdrop-blur-sm', {
            onclick: function() { modalState = null; }
          }, [
            m('div.bg-white.dark:bg-slate-800.rounded-2xl.shadow-2xl.w-full.max-w-3xl.max-h-[85vh].flex.flex-col.overflow-hidden.border.border-gray-200.dark:border-slate-700.transition-all', {
              onclick: function(e) { e.stopPropagation(); }
            }, [
              // Header
              m('div.flex.items-center.justify-between.px-5.py-3.5.border-b.border-gray-200.dark:border-slate-700.bg-gray-50/70.dark:bg-slate-800/80', [
                m('div.flex.items-center.gap-2.truncate.max-w-md', [
                  m('span.text-xs.font-semibold.uppercase.px-2.py-0.5.rounded.bg-indigo-100.dark:bg-indigo-900/50.text-indigo-700.dark:text-indigo-300', selectedItem.ext || selectedItem.type),
                  m('h3.text-sm.font-bold.text-gray-900.dark:text-slate-100.truncate', selectedItem.name),
                ]),
                m('div.flex.items-center.gap-2', [
                  isTextFile(selectedItem) ? m('button.px-3.py-1.5.text-xs.font-medium.rounded-lg.bg-indigo-50.dark:bg-indigo-950/40.text-indigo-600.dark:text-indigo-400.hover:bg-indigo-100.dark:hover:bg-indigo-900/60.border.border-indigo-200.dark:border-indigo-800.flex.items-center.gap-1.5.transition', {
                    onclick: function() { openTextEditor(selectedItem); }
                  }, [
                    m('span', '📝'),
                    m('span', 'Edit Text / Code')
                  ]) : null,
                  selectedItem.type === 'image' && selectedItem.publicUrl && !selectedItem.name.endsWith('.svg') ? m('button.px-3.py-1.5.text-xs.font-medium.rounded-lg.bg-indigo-50.dark:bg-indigo-950/40.text-indigo-600.dark:text-indigo-400.hover:bg-indigo-100.dark:hover:bg-indigo-900/60.border.border-indigo-200.dark:border-indigo-800.flex.items-center.gap-1.5.transition', {
                    onclick: function() { openImageEditor(selectedItem); }
                  }, [
                    m('span', '✂️'),
                    m('span', 'Edit Image')
                  ]) : null,
                  m('button.text-gray-400.hover:text-gray-600.dark:hover:text-slate-200.text-lg.p-1.rounded-md', {
                    onclick: function() { modalState = null; }
                  }, '✕')
                ])
              ]),
              // Media Viewer Area
              m('div.flex-1.p-6.flex.items-center.justify-center.min-h-[220px].max-h-[420px].overflow-hidden', {
                style: selectedItem.type === 'image' ? 'background-image: radial-gradient(rgba(148, 163, 184, 0.25) 1px, transparent 1px); background-size: 16px 16px; background-color: rgba(248, 250, 252, 0.6);' : ''
              }, [
                selectedItem.type === 'image' && selectedItem.publicUrl
                  ? m('img.max-h-[360px].max-w-full.w-auto.h-auto.rounded-lg.object-contain.shadow-sm.border.border-gray-200/50.dark:border-slate-700/50', {
                      src: selectedItem.publicUrl,
                      onload: function(e) {
                        loadedImageMeta[selectedItem.path] = { width: e.target.naturalWidth, height: e.target.naturalHeight };
                        if (typeof m !== 'undefined' && m.redraw) m.redraw();
                      }
                    })
                  : (selectedItem.type === 'video' && selectedItem.publicUrl
                      ? m('video.max-h-[360px].max-w-full.rounded-lg', { src: selectedItem.publicUrl, controls: true })
                      : (selectedItem.type === 'audio' && selectedItem.publicUrl
                          ? m('audio.w-full.max-w-md', { src: selectedItem.publicUrl, controls: true })
                          : (isTextFile(selectedItem)
                              ? m('div.flex.flex-col.items-center.justify-center.p-8.text-center', [
                                  m('div.w-16.h-16.rounded-2xl.bg-indigo-50.dark:bg-slate-700/60.flex.items-center.justify-center.mb-3', renderFileIcon(selectedItem)),
                                  m('p.text-sm.font-bold.text-gray-900.dark:text-slate-100', selectedItem.name),
                                  m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', 'Text / Configuration / Code File (' + (selectedItem.ext || 'text').toUpperCase() + ')'),
                                  m('button.mt-4.px-4.py-2.bg-indigo-600.hover:bg-indigo-700.text-white.text-xs.font-semibold.rounded-xl.shadow-sm.flex.items-center.gap-2.transition', {
                                    onclick: function() { openTextEditor(selectedItem); }
                                  }, [
                                    m('span', '📝'),
                                    m('span', 'Open in Code Editor')
                                  ])
                                ])
                              : m('div.text-center.p-8', [
                                  renderFileIcon(selectedItem),
                                  m('p.text-xs.text-gray-500.mt-2', 'Preview not available')
                                ]))))
              ]),
              // File Info Pane
              m('div.p-4.space-y-3.text-xs.text-gray-600.dark:text-slate-300.border-t.border-gray-200.dark:border-slate-700.bg-white.dark:bg-slate-800', [
                m('div.grid.grid-cols-2.md:grid-cols-4.gap-2.text-[11px]', [
                  m('div.bg-gray-50.dark:bg-slate-900.p-2.rounded-lg.border.border-gray-100.dark:border-slate-700', [
                    m('span.text-gray-400.block', 'File Size'),
                    m('strong.text-gray-800.dark:text-slate-200', formatBytes(selectedItem.size))
                  ]),
                  m('div.bg-gray-50.dark:bg-slate-900.p-2.rounded-lg.border.border-gray-100.dark:border-slate-700', [
                    m('span.text-gray-400.block', 'Dimensions'),
                    m('strong.text-gray-800.dark:text-slate-200', loadedImageMeta[selectedItem.path] ? loadedImageMeta[selectedItem.path].width + ' × ' + loadedImageMeta[selectedItem.path].height + ' px' : '—')
                  ]),
                  m('div.bg-gray-50.dark:bg-slate-900.p-2.rounded-lg.border.border-gray-100.dark:border-slate-700', [
                    m('span.text-gray-400.block', 'Format'),
                    m('strong.text-gray-800.dark:text-slate-200', selectedItem.mimeType || selectedItem.ext.toUpperCase())
                  ]),
                  m('div.bg-gray-50.dark:bg-slate-900.p-2.rounded-lg.border.border-gray-100.dark:border-slate-700', [
                    m('span.text-gray-400.block', 'Last Modified'),
                    m('strong.text-gray-800.dark:text-slate-200', formatDate(selectedItem.mtime))
                  ]),
                ]),
                selectedItem.publicUrl ? m('div.flex.items-center.gap-2.pt-1', [
                  m('input.flex-1.px-2.5.py-1.5.text-xs.border.border-gray-200.dark:border-slate-700.rounded-lg.bg-gray-50.dark:bg-slate-900.text-gray-700.dark:text-slate-300', {
                    readonly: true,
                    value: selectedItem.publicUrl
                  }),
                  m('button.px-3.5.py-1.5.bg-indigo-600.text-white.rounded-lg.font-medium.hover:bg-indigo-700.transition', {
                    onclick: function() {
                      copyToClipboard(selectedItem.publicUrl);
                      alert('URL copied to clipboard!');
                    }
                  }, 'Copy URL'),
                  isPickerMode && onSelectCallback ? m('button.px-3.5.py-1.5.bg-emerald-600.text-white.rounded-lg.font-medium.hover:bg-emerald-700.transition', {
                    onclick: function() {
                      onSelectCallback(selectedItem.publicUrl);
                      modalState = null;
                    }
                  }, 'Select This File') : null
                ]) : null
              ])
            ])
          ]) : null,

          // 5. Image Editor Modal
          editMode && selectedItem ? m('div.fixed.inset-0.bg-black/75.flex.items-center.justify-center.z-50.p-4.backdrop-blur-sm', {
            onclick: function() { if (!editorState.saving) editMode = false; }
          }, [
            m('div.bg-white.dark:bg-slate-800.rounded-2xl.shadow-2xl.w-full.max-w-5xl.max-h-[90vh].flex.flex-col.overflow-hidden.border.border-gray-200.dark:border-slate-700', {
              onclick: function(e) { e.stopPropagation(); }
            }, [
              // Header
              m('div.flex.items-center.justify-between.px-6.py-3.5.border-b.border-gray-200.dark:border-slate-700.bg-gray-50/70.dark:bg-slate-800', [
                m('div.flex.items-center.gap-2.truncate', [
                  m('span.text-base', '🎨'),
                  m('h3.text-sm.font-bold.text-gray-900.dark:text-slate-100.truncate', 'Edit Image: ' + selectedItem.name),
                  editorState.naturalWidth ? m('span.text-xs.text-gray-500.dark:text-slate-400', '(' + editorState.naturalWidth + ' × ' + editorState.naturalHeight + ' px)') : null,
                ]),
                m('button.text-gray-400.hover:text-gray-600.dark:hover:text-slate-200.text-lg', {
                  disabled: editorState.saving,
                  onclick: function() { editMode = false; }
                }, '✕')
              ]),

              // Body: 2 Columns (Canvas/Preview on Left, Controls on Right)
              m('div.flex-1.grid.grid-cols-1.lg:grid-cols-3.overflow-y-auto', [
                // Left Column: Interactive Canvas & Preview
                m('div.lg:col-span-2.p-6.flex.flex-col.items-center.justify-center.border-b.lg:border-b-0.lg:border-r.border-gray-200.dark:border-slate-700', {
                  style: 'background-image: radial-gradient(rgba(148, 163, 184, 0.3) 1px, transparent 1px); background-size: 16px 16px; background-color: rgba(248, 250, 252, 0.5);'
                }, [
                  m('div.relative.max-w-full.flex.items-center.justify-center.overflow-hidden.rounded-xl.shadow-md.border.border-gray-200.dark:border-slate-700.bg-white.dark:bg-slate-900', {
                    style: 'max-height: 420px;'
                  }, [
                    m('img.max-h-[380px].max-w-full.w-auto.h-auto.object-contain.transition-all.duration-200', {
                      src: selectedItem.publicUrl,
                      style: 'transform: rotate(' + editorState.rotation + 'deg) scale(' + (editorState.flipH ? -1 : 1) + ', ' + (editorState.flipV ? -1 : 1) + ');'
                    }),
                    // Crop frame overlay if aspect ratio active
                    editorState.aspectRatio !== 'free' ? m('div.absolute.inset-4.border-2.border-indigo-500.border-dashed.rounded-lg.pointer-events-none.flex.items-center.justify-center.bg-indigo-500/10', [
                      m('span.text-xs.font-bold.px-2.py-1.rounded.bg-indigo-600.text-white.shadow', editorState.aspectRatio)
                    ]) : null
                  ]),
                  m('div.mt-3.text-xs.text-gray-500.dark:text-slate-400.text-center', [
                    m('span', 'Rotation: ' + editorState.rotation + '° | Flip: ' + (editorState.flipH ? 'H ' : '') + (editorState.flipV ? 'V' : (editorState.flipH ? '' : 'None'))),
                    editorState.aspectRatio !== 'free' ? m('span.ml-2.font-semibold.text-indigo-600', '| Crop: ' + editorState.aspectRatio) : null
                  ])
                ]),

                // Right Column: Tools & Actions
                m('div.p-6.space-y-5.bg-white.dark:bg-slate-800/80', [
                  // 1. Aspect Ratio Presets
                  m('div.space-y-2', [
                    m('label.text-xs.font-bold.uppercase.tracking-wider.text-gray-500.dark:text-slate-400.block', 'Aspect Ratio (Kırpma)'),
                    m('div.grid.grid-cols-2.gap-1.5', [
                      ['free', 'Free / Serbest'],
                      ['1:1', '1:1 Square'],
                      ['16:9', '16:9 Banner'],
                      ['4:3', '4:3 Standard']
                    ].map(function(item) {
                      var active = editorState.aspectRatio === item[0];
                      return m('button.px-2.py-1.5.text-xs.rounded-lg.border.font-medium.transition', {
                        class: active
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-gray-50 dark:bg-slate-900 text-gray-700 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:bg-gray-100',
                        onclick: function() { setAspectRatio(item[0]); }
                      }, item[1]);
                    }))
                  ]),

                  // 2. Rotate & Flip Controls
                  m('div.space-y-2', [
                    m('label.text-xs.font-bold.uppercase.tracking-wider.text-gray-500.dark:text-slate-400.block', 'Transform (Döndür & Çevir)'),
                    m('div.grid.grid-cols-2.gap-2', [
                      m('button.px-3.py-2.text-xs.rounded-lg.border.border-gray-200.dark:border-slate-700.bg-gray-50.dark:bg-slate-900.hover:bg-gray-100.dark:hover:bg-slate-800.text-gray-800.dark:text-slate-200.flex.items-center.justify-center.gap-1.5', {
                        onclick: function() { editorState.rotation = (editorState.rotation - 90 + 360) % 360; }
                      }, [m('span', '↺'), m('span', '-90°')]),
                      m('button.px-3.py-2.text-xs.rounded-lg.border.border-gray-200.dark:border-slate-700.bg-gray-50.dark:bg-slate-900.hover:bg-gray-100.dark:hover:bg-slate-800.text-gray-800.dark:text-slate-200.flex.items-center.justify-center.gap-1.5', {
                        onclick: function() { editorState.rotation = (editorState.rotation + 90) % 360; }
                      }, [m('span', '↻'), m('span', '+90°')]),
                      m('button.px-3.py-2.text-xs.rounded-lg.border.border-gray-200.dark:border-slate-700.bg-gray-50.dark:bg-slate-900.hover:bg-gray-100.dark:hover:bg-slate-800.text-gray-800.dark:text-slate-200.flex.items-center.justify-center.gap-1.5', {
                        class: editorState.flipH ? 'border-indigo-500 text-indigo-600 bg-indigo-50/50' : '',
                        onclick: function() { editorState.flipH = !editorState.flipH; }
                      }, [m('span', '⇄'), m('span', 'Flip Horiz')]),
                      m('button.px-3.py-2.text-xs.rounded-lg.border.border-gray-200.dark:border-slate-700.bg-gray-50.dark:bg-slate-900.hover:bg-gray-100.dark:hover:bg-slate-800.text-gray-800.dark:text-slate-200.flex.items-center.justify-center.gap-1.5', {
                        class: editorState.flipV ? 'border-indigo-500 text-indigo-600 bg-indigo-50/50' : '',
                        onclick: function() { editorState.flipV = !editorState.flipV; }
                      }, [m('span', '⇅'), m('span', 'Flip Vert')])
                    ])
                  ]),

                  // 3. Resize Controls
                  m('div.space-y-2', [
                    m('label.text-xs.font-bold.uppercase.tracking-wider.text-gray-500.dark:text-slate-400.block', 'Resize (Yeniden Boyutlandır)'),
                    m('div.grid.grid-cols-2.gap-2', [
                      m('div', [
                        m('span.text-[10px].text-gray-400.block.mb-1', 'Width (px)'),
                        m('input.w-full.px-2.5.py-1.5.text-xs.border.border-gray-200.dark:border-slate-700.rounded-lg.bg-gray-50.dark:bg-slate-900.text-gray-800.dark:text-slate-200', {
                          type: 'number',
                          value: editorState.targetWidth,
                          oninput: function(e) {
                            var w = parseInt(e.target.value, 10) || 1;
                            editorState.targetWidth = w;
                            if (editorState.lockRatio && editorState.naturalWidth) {
                              editorState.targetHeight = Math.round((w * editorState.naturalHeight) / editorState.naturalWidth);
                            }
                          }
                        })
                      ]),
                      m('div', [
                        m('span.text-[10px].text-gray-400.block.mb-1', 'Height (px)'),
                        m('input.w-full.px-2.5.py-1.5.text-xs.border.border-gray-200.dark:border-slate-700.rounded-lg.bg-gray-50.dark:bg-slate-900.text-gray-800.dark:text-slate-200', {
                          type: 'number',
                          value: editorState.targetHeight,
                          oninput: function(e) {
                            var h = parseInt(e.target.value, 10) || 1;
                            editorState.targetHeight = h;
                            if (editorState.lockRatio && editorState.naturalHeight) {
                              editorState.targetWidth = Math.round((h * editorState.naturalWidth) / editorState.naturalHeight);
                            }
                          }
                        })
                      ])
                    ])
                  ]),

                  // 4. Output Format
                  m('div.space-y-2', [
                    m('label.text-xs.font-bold.uppercase.tracking-wider.text-gray-500.dark:text-slate-400.block', 'Output Format'),
                    m('select.w-full.px-2.5.py-1.5.text-xs.border.border-gray-200.dark:border-slate-700.rounded-lg.bg-gray-50.dark:bg-slate-900.text-gray-800.dark:text-slate-200', {
                      value: editorState.format,
                      onchange: function(e) { editorState.format = e.target.value; }
                    }, [
                      m('option', { value: 'original' }, 'Keep Original (' + selectedItem.ext.toUpperCase() + ')'),
                      m('option', { value: 'image/webp' }, 'Convert to WebP (Recommended)'),
                      m('option', { value: 'image/png' }, 'PNG'),
                      m('option', { value: 'image/jpeg' }, 'JPEG')
                    ])
                  ]),

                  // 5. Actions: Save as Copy vs Overwrite
                  m('div.pt-3.border-t.border-gray-200.dark:border-slate-700.space-y-2', [
                    editorState.saveStatus ? m('p.text-xs.text-indigo-600.font-medium.animate-pulse', editorState.saveStatus) : null,
                    m('div.flex.flex-col.gap-2', [
                      m('button.w-full.py-2.px-4.bg-indigo-600.hover:bg-indigo-700.text-white.text-xs.font-semibold.rounded-xl.shadow-sm.transition.flex.items-center.justify-center.gap-1.5', {
                        disabled: editorState.saving,
                        onclick: function() { saveTransformedImage(false); }
                      }, [
                        m('span', '💾'),
                        m('span', 'Save as New File')
                      ]),
                      m('button.w-full.py-2.px-4.bg-amber-600.hover:bg-amber-700.text-white.text-xs.font-semibold.rounded-xl.shadow-sm.transition.flex.items-center.justify-center.gap-1.5', {
                        disabled: editorState.saving,
                        onclick: function() {
                          if (confirm('Are you sure you want to overwrite "' + selectedItem.name + '"?')) {
                            saveTransformedImage(true);
                          }
                        }
                      }, [
                        m('span', '⚡'),
                        m('span', 'Overwrite Original')
                      ]),
                      m('button.w-full.py-1.5.px-4.border.border-gray-300.dark:border-slate-600.text-gray-700.dark:text-slate-300.text-xs.rounded-xl.hover:bg-gray-100.dark:hover:bg-slate-700.transition', {
                        disabled: editorState.saving,
                        onclick: function() { editMode = false; }
                      }, 'Cancel')
                    ])
                  ])
                ])
              ])
            ])
          ]) : null,

          // 6. Text / Code Editor Modal
          textEditMode && textEditorState.file ? m('div.fixed.inset-0.bg-black/75.flex.items-center.justify-center.z-50.p-4.backdrop-blur-sm', {
            onclick: function() {
              if (textEditorState.saving) return;
              if (textEditorState.content !== textEditorState.initialContent) {
                if (!confirm('You have unsaved changes. Discard them?')) return;
              }
              textEditMode = false;
            }
          }, [
            m('div.bg-slate-900.text-slate-100.rounded-2xl.shadow-2xl.w-full.max-w-5xl.max-h-[90vh].flex.flex-col.overflow-hidden.border.border-slate-700', {
              onclick: function(e) { e.stopPropagation(); }
            }, [
              // Header
              m('div.flex.items-center.justify-between.px-6.py-3.border-b.border-slate-800.bg-slate-950/80', [
                m('div.flex.items-center.gap-2.5.truncate', [
                  m('span.text-base', textEditorState.isJson ? '⚙️' : '📝'),
                  m('h3.text-sm.font-bold.text-slate-100.truncate', textEditorState.file.name),
                  m('span.text-[10px].uppercase.font-bold.px-2.py-0.5.rounded.bg-indigo-900/60.text-indigo-300.border.border-indigo-700/50', textEditorState.file.ext || 'TEXT'),
                  textEditorState.content !== textEditorState.initialContent
                    ? m('span.text-[10px].font-semibold.px-2.py-0.5.rounded-full.bg-amber-500/20.text-amber-400.border.border-amber-500/40.animate-pulse', '● Unsaved')
                    : m('span.text-[10px].font-semibold.px-2.py-0.5.rounded-full.bg-emerald-500/10.text-emerald-400', 'Saved'),
                  textEditorState.isJson
                    ? (textEditorState.jsonError
                        ? m('span.text-[10px].font-semibold.px-2.py-0.5.rounded.bg-red-500/20.text-red-400.truncate.max-w-xs', { title: textEditorState.jsonError }, '⚠️ Invalid JSON')
                        : m('span.text-[10px].font-semibold.px-2.py-0.5.rounded.bg-emerald-500/20.text-emerald-400', '✓ Valid JSON'))
                    : null
                ]),
                // Header Actions
                m('div.flex.items-center.gap-2', [
                  textEditorState.isJson ? m('button.px-2.5.py-1.text-xs.rounded-lg.bg-indigo-600/30.hover:bg-indigo-600/50.text-indigo-200.border.border-indigo-500/40.flex.items-center.gap-1.transition', {
                    onclick: formatJsonContent,
                    title: 'Beautify / Format JSON with 2-space indentation'
                  }, [
                    m('span', '✨'),
                    m('span', 'Format JSON')
                  ]) : null,
                  m('button.px-2.py-1.text-xs.rounded-lg.bg-slate-800.hover:bg-slate-700.text-slate-300.border.border-slate-700.transition', {
                    onclick: function() { textEditorState.wordWrap = !textEditorState.wordWrap; },
                    title: 'Toggle Word Wrap'
                  }, textEditorState.wordWrap ? 'Wrap: On' : 'Wrap: Off'),
                  m('div.flex.items-center.border.border-slate-700.rounded-lg.overflow-hidden', [
                    m('button.px-2.py-1.text-xs.bg-slate-800.hover:bg-slate-700.text-slate-300', {
                      onclick: function() { textEditorState.fontSize = Math.max(10, textEditorState.fontSize - 1); },
                      title: 'Decrease font size'
                    }, 'A-'),
                    m('span.px-2.py-1.text-[10px].bg-slate-900.text-slate-400', textEditorState.fontSize + 'px'),
                    m('button.px-2.py-1.text-xs.bg-slate-800.hover:bg-slate-700.text-slate-300', {
                      onclick: function() { textEditorState.fontSize = Math.min(22, textEditorState.fontSize + 1); },
                      title: 'Increase font size'
                    }, 'A+'),
                  ]),
                  m('button.text-slate-400.hover:text-slate-100.text-lg.p-1.rounded-md', {
                    disabled: textEditorState.saving,
                    onclick: function() {
                      if (textEditorState.content !== textEditorState.initialContent) {
                        if (!confirm('You have unsaved changes. Discard them?')) return;
                      }
                      textEditMode = false;
                    }
                  }, '✕')
                ])
              ]),

              // Editor Body: Loading / Error / Textarea
              m('div.flex-1.relative.flex.overflow-hidden.bg-slate-950', [
                textEditorState.loading ? m('div.w-full.flex.flex-col.items-center.justify-center.py-24.text-slate-400', [
                  m('div.w-8.h-8.border-2.border-indigo-500.border-t-transparent.rounded-full.animate-spin.mb-2'),
                  m('p.text-xs', 'Loading file content…')
                ]) : (textEditorState.error ? m('div.w-full.p-8.text-center.text-red-400.text-sm', textEditorState.error) : [
                  // Textarea with line numbers gutter
                  m('div.flex.w-full.h-full.min-h-[420px]', [
                    // Line numbers gutter
                    m('div.py-3.px-3.bg-slate-900/60.text-slate-500.text-right.select-none.font-mono.border-r.border-slate-800/80', {
                      style: 'font-size: ' + textEditorState.fontSize + 'px; line-height: 1.5; min-width: 44px;'
                    }, (function() {
                      var lines = [];
                      var count = Math.max(1, textEditorState.lineCount);
                      for (var i = 1; i <= count; i++) {
                        lines.push(m('div', String(i)));
                      }
                      return lines;
                    })()),
                    // Real textarea
                    m('textarea.w-full.h-full.p-3.bg-transparent.text-slate-100.font-mono.resize-none.outline-none.focus:ring-0.border-none', {
                      value: textEditorState.content,
                      spellcheck: false,
                      style: 'font-size: ' + textEditorState.fontSize + 'px; line-height: 1.5; white-space: ' + (textEditorState.wordWrap ? 'pre-wrap' : 'pre') + '; tab-size: 2;',
                      oninput: function(e) {
                        textEditorState.content = e.target.value;
                        updateTextStats();
                      },
                      onkeydown: function(e) {
                        if (e.key === 'Tab') {
                          e.preventDefault();
                          var start = e.target.selectionStart;
                          var end = e.target.selectionEnd;
                          var val = e.target.value;
                          e.target.value = val.substring(0, start) + '  ' + val.substring(end);
                          e.target.selectionStart = e.target.selectionEnd = start + 2;
                          textEditorState.content = e.target.value;
                          updateTextStats();
                        } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                          e.preventDefault();
                          saveTextContent(true);
                        }
                      }
                    })
                  ])
                ])
              ]),

              // Footer: Status Bar & Save Actions
              m('div.flex.items-center.justify-between.px-6.py-3.border-t.border-slate-800.bg-slate-900', [
                // Left stats
                m('div.flex.items-center.gap-4.text-xs.text-slate-400', [
                  m('span', 'Lines: ' + textEditorState.lineCount),
                  m('span', 'Chars: ' + textEditorState.charCount),
                  m('span', 'Encoding: UTF-8'),
                  textEditorState.saveStatus ? m('span.text-indigo-400.font-medium.animate-pulse', textEditorState.saveStatus) : null
                ]),
                // Right buttons
                m('div.flex.items-center.gap-2', [
                  m('button.px-3.py-1.5.text-xs.font-medium.rounded-xl.border.border-slate-700.hover:bg-slate-800.text-slate-300.transition', {
                    disabled: textEditorState.saving,
                    onclick: function() {
                      if (textEditorState.content !== textEditorState.initialContent) {
                        if (!confirm('You have unsaved changes. Discard them?')) return;
                      }
                      textEditMode = false;
                    }
                  }, 'Close'),
                  m('button.px-3.py-1.5.text-xs.font-semibold.rounded-xl.bg-slate-800.hover:bg-slate-700.text-slate-200.border.border-slate-600.flex.items-center.gap-1.5.transition', {
                    disabled: textEditorState.saving || textEditorState.loading,
                    onclick: function() { saveTextContent(false); }
                  }, [
                    m('span', '📋'),
                    m('span', 'Save as Copy')
                  ]),
                  m('button.px-4.py-1.5.text-xs.font-semibold.rounded-xl.bg-indigo-600.hover:bg-indigo-500.text-white.shadow-sm.flex.items-center.gap-1.5.transition', {
                    disabled: textEditorState.saving || textEditorState.loading,
                    onclick: function() { saveTextContent(true); }
                  }, [
                    m('span', textEditorState.saving ? '⏳' : '💾'),
                    m('span', textEditorState.saving ? 'Saving…' : 'Save Changes')
                  ])
                ])
              ])
            ])
          ]) : null,

          // KEYBOARD SHORTCUTS CHEATSHEET MODAL
          showShortcutsModal ? m('div.fixed.inset-0.bg-black/60.flex.items-center.justify-center.z-50.p-4.backdrop-blur-sm', {
            onclick: function() { showShortcutsModal = false; }
          }, [
            m('div.bg-white.dark:bg-slate-900.rounded-2xl.shadow-2xl.w-full.max-w-xl.overflow-hidden.border.border-gray-200.dark:border-slate-800.transition-all', {
              onclick: function(e) { e.stopPropagation(); }
            }, [
              // Header
              m('div.flex.items-center.justify-between.px-6.py-4.border-b.border-gray-100.dark:border-slate-800.bg-gray-50/60.dark:bg-slate-800/50', [
                m('div.flex.items-center.gap-2.5', [
                  m('span.text-xl', '⌨️'),
                  m('div', [
                    m('h3.text-base.font-bold.text-gray-900.dark:text-slate-100', 'Keyboard Shortcuts'),
                    m('p.text-xs.text-gray-500.dark:text-slate-400', 'Navigate and manage files without touching your mouse')
                  ])
                ]),
                m('button.text-gray-400.hover:text-gray-600.dark:hover:text-slate-200.p-1.5.rounded-lg.hover:bg-gray-100.dark:hover:bg-slate-800', {
                  onclick: function() { showShortcutsModal = false; }
                }, '✕')
              ]),

              // Body: Shortcut Categories
              m('div.p-6.space-y-5.max-h-[70vh].overflow-y-auto', [
                // Group 1: Navigation
                m('div.space-y-2.5', [
                  m('h4.text-xs.font-bold.text-indigo-600.dark:text-indigo-400.uppercase.tracking-wider', 'Navigation & Browsing'),
                  m('div.grid.grid-cols-1.sm:grid-cols-2.gap-2', [
                    renderShortcutItem('↑ ↓ ← →', 'Move focus between items'),
                    renderShortcutItem('Enter', 'Open folder / preview file'),
                    renderShortcutItem('Space', 'Finder Quick Look (preview)'),
                    renderShortcutItem('Alt + ↑', 'Enclosing parent folder')
                  ])
                ]),

                // Group 2: Selection & Batch
                m('div.space-y-2.5', [
                  m('h4.text-xs.font-bold.text-indigo-600.dark:text-indigo-400.uppercase.tracking-wider', 'Selection & Batch Actions'),
                  m('div.grid.grid-cols-1.sm:grid-cols-2.gap-2', [
                    renderShortcutItem('Cmd / Ctrl + A', 'Select all files/folders'),
                    renderShortcutItem('X', 'Toggle select focused item'),
                    renderShortcutItem('Esc', 'Clear selection / close modal'),
                    renderShortcutItem('Delete', 'Delete selected / focused item')
                  ])
                ]),

                // Group 3: Quick Tools & Editors
                m('div.space-y-2.5', [
                  m('h4.text-xs.font-bold.text-indigo-600.dark:text-indigo-400.uppercase.tracking-wider', 'Quick Tools & Actions'),
                  m('div.grid.grid-cols-1.sm:grid-cols-2.gap-2', [
                    renderShortcutItem('E', 'Edit code/text or image'),
                    renderShortcutItem('R', 'Rename focused item'),
                    renderShortcutItem('/', 'Focus search input'),
                    renderShortcutItem('? or H', 'Toggle shortcuts help')
                  ])
                ])
              ]),

              // Footer
              m('div.flex.items-center.justify-between.px-6.py-3.border-t.border-gray-100.dark:border-slate-800.bg-gray-50.dark:bg-slate-800/70', [
                m('span.text-xs.text-gray-400.dark:text-slate-500', 'Press Esc to close at any time'),
                m('button.px-4.py-1.5.text-xs.font-semibold.rounded-xl.bg-indigo-600.hover:bg-indigo-500.text-white.shadow-sm.transition', {
                  onclick: function() { showShortcutsModal = false; }
                }, 'Got It')
              ])
            ])
          ]) : null
        ]);
      }
    };
  }

  function FileManagerPage() {
    return FileManagerView(false, null, null);
  }

  window.__customPages = window.__customPages || {};
  window.__customPages['files'] = FileManagerPage;

  // Global Picker Modal helper
  window.__openFileManagerPicker = function(options) {
    var opts = options || {};
    var onSelect = opts.onSelect;
    var accept = opts.accept || '';

    var existing = document.getElementById('file-manager-picker-modal-root');
    if (existing && existing.parentNode) {
      m.mount(existing, null);
      existing.parentNode.removeChild(existing);
    }

    var modalContainer = document.createElement('div');
    modalContainer.id = 'file-manager-picker-modal-root';
    document.body.appendChild(modalContainer);

    function cleanup() {
      document.removeEventListener('keydown', onKeyDown);
      if (modalContainer && modalContainer.parentNode) {
        m.mount(modalContainer, null);
        modalContainer.parentNode.removeChild(modalContainer);
      }
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') cleanup();
    }
    document.addEventListener('keydown', onKeyDown);

    var PickerModalComponent = {
      view: function() {
        return m('div.fixed.inset-0.bg-black/60.flex.items-center.justify-center.z-[9999].p-4.backdrop-blur-sm', {
          onclick: function(e) {
            if (e.target === e.currentTarget) cleanup();
          }
        }, [
          m('div.bg-white.dark:bg-slate-900.rounded-2xl.shadow-2xl.max-w-4xl.w-full.max-h-[90vh].flex.flex-col.overflow-hidden.border.border-gray-200.dark:border-slate-700', [
            m('div.flex.items-center.justify-between.p-4.border-b.border-gray-200.dark:border-slate-700.bg-gray-50.dark:bg-slate-800', [
              m('h2.text-base.font-bold.text-gray-900.dark:text-slate-100', opts.title || 'Choose from Media Library'),
              m('button.text-gray-400.hover:text-gray-600.dark:hover:text-slate-200.text-xl', {
                onclick: cleanup
              }, '✕')
            ]),
            m('div.p-4.overflow-y-auto.flex-1', [
              m(FileManagerView(true, function(selectedUrl, item) {
                if (onSelect) onSelect(selectedUrl, item);
                cleanup();
              }, accept))
            ])
          ])
        ]);
      }
    };

    m.mount(modalContainer, PickerModalComponent);
  };

})();
`;
}

module.exports = {
  generateFileManagerComponent,
};

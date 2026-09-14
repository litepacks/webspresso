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

    function loadDirectory(pathParam) {
      if (pathParam !== undefined) currentPath = pathParam;
      loading = true;
      error = null;

      var q = '?path=' + encodeURIComponent(currentPath);
      if (searchQuery) q += '&search=' + encodeURIComponent(searchQuery);
      if (typeFilter && typeFilter !== 'all') q += '&type=' + encodeURIComponent(typeFilter);
      if (sort) q += '&sort=' + encodeURIComponent(sort) + '&order=' + encodeURIComponent(order);

      api.get(API + q).then(function(res) {
        items = res.items || [];
        breadcrumbs = res.breadcrumbs || [{ name: 'Root', path: '' }];
        loading = false;
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      }).catch(function(err) {
        error = err.message || String(err);
        loading = false;
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      });
    }

    function createFolder() {
      if (!inputFolderValue.trim()) return;
      api.post(API + '/mkdir', { path: currentPath, name: inputFolderValue.trim() }).then(function() {
        modalState = null;
        inputFolderValue = '';
        loadDirectory();
      }).catch(function(err) {
        alert('Klasör oluşturulamadı: ' + (err.message || String(err)));
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
        alert('Yeniden adlandırılamadı: ' + (err.message || String(err)));
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

    function handleFileUpload(fileList) {
      if (!fileList || fileList.length === 0) return;
      uploading = true;
      uploadStatus = fileList.length + ' dosya yükleniyor…';
      if (typeof m !== 'undefined' && m.redraw) m.redraw();

      var fd = new FormData();
      for (var i = 0; i < fileList.length; i++) {
        fd.append('files', fileList[i]);
      }

      var uploadUrl = (window.__ADMIN_PATH__ || '/_admin') + '/api' + API + '/upload?path=' + encodeURIComponent(currentPath);

      fetch(uploadUrl, {
        method: 'POST',
        body: fd,
        credentials: 'include',
      }).then(function(r) { return r.json(); }).then(function(res) {
        uploading = false;
        uploadStatus = '';
        if (res.success) {
          loadDirectory();
        } else {
          alert('Yükleme hatası: ' + (res.error || 'Bilinmeyen hata'));
          if (typeof m !== 'undefined' && m.redraw) m.redraw();
        }
      }).catch(function(err) {
        uploading = false;
        uploadStatus = '';
        alert('Yükleme hatası: ' + (err.message || String(err)));
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      });
    }

    return {
      oninit: function() {
        if (isPickerMode && pickerAccept) {
          if (pickerAccept.indexOf('image') !== -1) typeFilter = 'image';
          else if (pickerAccept.indexOf('video') !== -1) typeFilter = 'video';
          else if (pickerAccept.indexOf('audio') !== -1) typeFilter = 'audio';
          else if (pickerAccept.indexOf('pdf') !== -1) typeFilter = 'document';
        }
        loadDirectory('');
      },

      view: function() {
        return m('div.space-y-4', [
          // Toolbar
          m('div.flex.flex-col.md:flex-row.md:items-center.justify-between.gap-3.bg-white.dark:bg-slate-800.p-4.rounded-xl.border.border-gray-200.dark:border-slate-700.shadow-sm', [
            // Left: Breadcrumbs
            m('div.flex.items-center.gap-2.flex-wrap.text-sm', [
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
            ]),

            // Right: Actions & Tools
            m('div.flex.items-center.gap-2.flex-wrap', [
              // Search input
              m('div.relative', [
                m('input.text-xs.pl-8.pr-3.py-1.5.border.border-gray-200.dark:border-slate-700.rounded-lg.bg-gray-50.dark:bg-slate-900.text-gray-900.dark:text-slate-100.placeholder-gray-400', {
                  type: 'text',
                  placeholder: 'Dosyalarda ara…',
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
                m('option', { value: 'all' }, 'Tüm Dosyalar'),
                m('option', { value: 'image' }, 'Resimler'),
                m('option', { value: 'document' }, 'Belgeler'),
                m('option', { value: 'video' }, 'Videolar'),
                m('option', { value: 'audio' }, 'Sesler'),
                m('option', { value: 'archive' }, 'Arşivler'),
                m('option', { value: 'code' }, 'Kod & Metin'),
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
                }, 'Liste'),
              ]),

              // New Folder Button
              m('button.px-3.py-1.5.text-xs.font-medium.bg-gray-100.dark:bg-slate-700.hover:bg-gray-200.dark:hover:bg-slate-600.text-gray-800.dark:text-slate-200.rounded-lg.flex.items-center.gap-1.transition', {
                onclick: function() { inputFolderValue = ''; modalState = 'newFolder'; }
              }, [
                m('span', '+'),
                m('span', 'Yeni Klasör')
              ]),

              // Upload Button
              m('label.px-3.py-1.5.text-xs.font-medium.bg-indigo-600.hover:bg-indigo-700.text-white.rounded-lg.cursor-pointer.flex.items-center.gap-1.transition', [
                m('span', '↑'),
                m('span', 'Yükle'),
                m('input[type=file].hidden', {
                  multiple: true,
                  onchange: function(e) { handleFileUpload(e.target.files); e.target.value = ''; }
                })
              ]),

              // Refresh
              m('button.p-1.5.text-xs.text-gray-500.hover:text-gray-900.dark:hover:text-slate-100.rounded-lg', {
                title: 'Yenile',
                onclick: function() { loadDirectory(); }
              }, '🔄')
            ])
          ]),

          // Uploading Banner
          uploading ? m('div.p-3.bg-indigo-50.dark:bg-indigo-950/40.border.border-indigo-200.dark:border-indigo-800.rounded-lg.flex.items-center.gap-3.text-xs.text-indigo-700.dark:text-indigo-300.animate-pulse', [
            m('span.animate-spin', '⏳'),
            m('span.font-medium', uploadStatus)
          ]) : null,

          // Main Content / Drop Zone
          m('div.min-h-[360px].relative', {
            ondragover: function(e) { e.preventDefault(); e.stopPropagation(); },
            ondrop: function(e) {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer && e.dataTransfer.files) {
                handleFileUpload(e.dataTransfer.files);
              }
            }
          }, [
            loading ? m('div.flex.flex-col.items-center.justify-center.py-20.text-gray-400', [
              m('div.w-8.h-8.border-2.border-indigo-600.border-t-transparent.rounded-full.animate-spin.mb-2'),
              m('p.text-xs', 'Dosyalar yükleniyor…')
            ]) : null,

            !loading && error ? m('div.p-6.text-center.text-red-600.dark:text-red-400.text-sm', error) : null,

            !loading && !error && items.length === 0 ? m('div.flex.flex-col.items-center.justify-center.py-20.text-gray-400.border-2.border-dashed.border-gray-200.dark:border-slate-800.rounded-xl', [
              m('span.text-4xl.mb-2', '📂'),
              m('p.text-sm.font-medium.text-gray-600.dark:text-slate-400', 'Bu klasör boş'),
              m('p.text-xs.text-gray-400.mt-1', 'Dosyaları buraya sürükleyip bırakabilir veya "Yükle" butonunu kullanabilirsiniz.')
            ]) : null,

            // GRID VIEW
            !loading && !error && items.length > 0 && viewMode === 'grid' ? m('div.grid.grid-cols-2.sm:grid-cols-3.md:grid-cols-4.lg:grid-cols-6.gap-4', items.map(function(item) {
              var isImg = item.type === 'image' && item.publicUrl;
              return m('div.group.relative.flex.flex-col.bg-white.dark:bg-slate-800.border.border-gray-200.dark:border-slate-700.rounded-xl.p-3.hover:shadow-md.transition.cursor-pointer', {
                onclick: function() {
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
                  m('span', item.isDir ? 'Klasör' : formatBytes(item.size)),
                  // Menu dots
                  m('div.relative.opacity-0.group-hover:opacity-100.transition', [
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
                    m('th.p-3', 'Ad'),
                    m('th.p-3', 'Tür'),
                    m('th.p-3', 'Boyut'),
                    m('th.p-3', 'Tarih'),
                    m('th.p-3.text-right', 'İşlemler'),
                  ])
                ]),
                m('tbody.divide-y.divide-gray-100.dark:divide-slate-700/50', items.map(function(item) {
                  return m('tr.hover:bg-gray-50/80.dark:hover:bg-slate-700/30.transition.cursor-pointer', {
                    onclick: function() {
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
                    m('td.p-3.flex.items-center.gap-2.font-medium.text-gray-900.dark:text-slate-100', [
                      m('span', renderFileIcon(item)),
                      m('span.truncate.max-w-xs.md:max-w-md', item.name)
                    ]),
                    m('td.p-3.text-gray-500.dark:text-slate-400', item.isDir ? 'Klasör' : (item.ext || item.type).toUpperCase()),
                    m('td.p-3.text-gray-500.dark:text-slate-400', item.isDir ? '—' : formatBytes(item.size)),
                    m('td.p-3.text-gray-500.dark:text-slate-400', formatDate(item.mtime)),
                    m('td.p-3.text-right.space-x-2', [
                      !item.isDir && item.publicUrl ? m('button.text-indigo-600.dark:text-indigo-400.hover:underline', {
                        onclick: function(e) {
                          e.stopPropagation();
                          copyToClipboard(item.publicUrl);
                          alert('URL kopyalandı: ' + item.publicUrl);
                        }
                      }, 'URL') : null,
                      m('button.text-gray-600.dark:text-slate-400.hover:text-gray-900', {
                        onclick: function(e) {
                          e.stopPropagation();
                          selectedItem = item;
                          inputRenameValue = item.name;
                          modalState = 'rename';
                        }
                      }, 'Ad Değiştir'),
                      m('button.text-red-600.dark:text-red-400.hover:underline', {
                        onclick: function(e) {
                          e.stopPropagation();
                          selectedItem = item;
                          modalState = 'delete';
                        }
                      }, 'Sil'),
                    ])
                  ]);
                }))
              ])
            ]) : null
          ]),

          // MODALS
          // 1. New Folder Modal
          modalState === 'newFolder' ? m('div.fixed.inset-0.bg-black/50.flex.items-center.justify-center.z-50.p-4', [
            m('div.bg-white.dark:bg-slate-800.rounded-xl.shadow-xl.max-w-md.w-full.p-6.space-y-4', [
              m('h3.text-base.font-bold.text-gray-900.dark:text-slate-100', 'Yeni Klasör Oluştur'),
              m('input.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-lg.bg-white.dark:bg-slate-900.text-sm', {
                type: 'text',
                placeholder: 'Klasör adı…',
                value: inputFolderValue,
                oninput: function(e) { inputFolderValue = e.target.value; },
                onkeydown: function(e) { if (e.key === 'Enter') createFolder(); }
              }),
              m('div.flex.justify-end.gap-2', [
                m('button.px-4.py-2.text-xs.rounded-lg.border.border-gray-300.dark:border-slate-600.text-gray-700.dark:text-slate-300', {
                  onclick: function() { modalState = null; }
                }, 'İptal'),
                m('button.px-4.py-2.text-xs.rounded-lg.bg-indigo-600.text-white.font-medium', {
                  onclick: createFolder
                }, 'Oluştur')
              ])
            ])
          ]) : null,

          // 2. Rename Modal
          modalState === 'rename' && selectedItem ? m('div.fixed.inset-0.bg-black/50.flex.items-center.justify-center.z-50.p-4', [
            m('div.bg-white.dark:bg-slate-800.rounded-xl.shadow-xl.max-w-md.w-full.p-6.space-y-4', [
              m('h3.text-base.font-bold.text-gray-900.dark:text-slate-100', 'Yeniden Adlandır'),
              m('input.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-lg.bg-white.dark:bg-slate-900.text-sm', {
                type: 'text',
                value: inputRenameValue,
                oninput: function(e) { inputRenameValue = e.target.value; },
                onkeydown: function(e) { if (e.key === 'Enter') renameSelected(); }
              }),
              m('div.flex.justify-end.gap-2', [
                m('button.px-4.py-2.text-xs.rounded-lg.border.border-gray-300.dark:border-slate-600.text-gray-700.dark:text-slate-300', {
                  onclick: function() { modalState = null; }
                }, 'İptal'),
                m('button.px-4.py-2.text-xs.rounded-lg.bg-indigo-600.text-white.font-medium', {
                  onclick: renameSelected
                }, 'Kaydet')
              ])
            ])
          ]) : null,

          // 3. Delete Confirmation Modal
          modalState === 'delete' && selectedItem ? m('div.fixed.inset-0.bg-black/50.flex.items-center.justify-center.z-50.p-4', [
            m('div.bg-white.dark:bg-slate-800.rounded-xl.shadow-xl.max-w-md.w-full.p-6.space-y-4', [
              m('h3.text-base.font-bold.text-red-600.dark:text-red-400', 'Silmeyi Onayla'),
              m('p.text-sm.text-gray-600.dark:text-slate-300', [
                m('strong', selectedItem.name),
                ' kalıcı olarak silinecek. Emin misiniz?'
              ]),
              m('div.flex.justify-end.gap-2', [
                m('button.px-4.py-2.text-xs.rounded-lg.border.border-gray-300.dark:border-slate-600.text-gray-700.dark:text-slate-300', {
                  onclick: function() { modalState = null; }
                }, 'Vazgeç'),
                m('button.px-4.py-2.text-xs.rounded-lg.bg-red-600.text-white.font-medium', {
                  onclick: deleteSelected
                }, 'Sil')
              ])
            ])
          ]) : null,

          // 4. Preview Modal
          modalState === 'preview' && selectedItem ? m('div.fixed.inset-0.bg-black/60.flex.items-center.justify-center.z-50.p-4.backdrop-blur-sm', {
            onclick: function() { modalState = null; }
          }, [
            m('div.bg-white.dark:bg-slate-800.rounded-2xl.shadow-2xl.max-w-2xl.w-full.overflow-hidden.border.border-gray-200.dark:border-slate-700', {
              onclick: function(e) { e.stopPropagation(); }
            }, [
              // Header
              m('div.flex.items-center.justify-between.p-4.border-b.border-gray-200.dark:border-slate-700', [
                m('h3.text-sm.font-bold.text-gray-900.dark:text-slate-100.truncate.max-w-lg', selectedItem.name),
                m('button.text-gray-400.hover:text-gray-600.dark:hover:text-slate-200.text-lg', {
                  onclick: function() { modalState = null; }
                }, '✕')
              ]),
              // Media Viewer Area
              m('div.p-6.bg-gray-50.dark:bg-slate-900/50.flex.items-center.justify-center.min-h-[240px]', [
                selectedItem.type === 'image' && selectedItem.publicUrl
                  ? m('img.max-h-96.rounded-lg.object-contain.shadow-sm', { src: selectedItem.publicUrl })
                  : (selectedItem.type === 'video' && selectedItem.publicUrl
                      ? m('video.max-h-96.rounded-lg', { src: selectedItem.publicUrl, controls: true })
                      : (selectedItem.type === 'audio' && selectedItem.publicUrl
                          ? m('audio.w-full', { src: selectedItem.publicUrl, controls: true })
                          : m('div.text-center.p-8', [
                              renderFileIcon(selectedItem),
                              m('p.text-xs.text-gray-500.mt-2', 'Önizleme mevcut değil')
                            ])))
              ]),
              // File Info Pane
              m('div.p-4.space-y-2.text-xs.text-gray-600.dark:text-slate-300.border-t.border-gray-200.dark:border-slate-700', [
                m('div.grid.grid-cols-2.gap-2', [
                  m('p', [m('span.text-gray-400', 'Boyut: '), formatBytes(selectedItem.size)]),
                  m('p', [m('span.text-gray-400', 'Tür: '), selectedItem.mimeType || selectedItem.ext]),
                  m('p', [m('span.text-gray-400', 'Tarih: '), formatDate(selectedItem.mtime)]),
                  m('p.truncate', [m('span.text-gray-400', 'Yol: '), selectedItem.path]),
                ]),
                selectedItem.publicUrl ? m('div.flex.items-center.gap-2.pt-2', [
                  m('input.flex-1.px-2.py-1.text-xs.border.rounded.bg-gray-50.dark:bg-slate-900.text-gray-700.dark:text-slate-300', {
                    readonly: true,
                    value: selectedItem.publicUrl
                  }),
                  m('button.px-3.py-1.bg-indigo-600.text-white.rounded.font-medium.hover:bg-indigo-700', {
                    onclick: function() {
                      copyToClipboard(selectedItem.publicUrl);
                      alert('URL kopyalandı!');
                    }
                  }, 'Kopyala'),
                  isPickerMode && onSelectCallback ? m('button.px-3.py-1.bg-emerald-600.text-white.rounded.font-medium.hover:bg-emerald-700', {
                    onclick: function() {
                      onSelectCallback(selectedItem.publicUrl);
                      modalState = null;
                    }
                  }, 'Bu Dosyayı Seç') : null
                ]) : null
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

    var modalContainer = document.createElement('div');
    modalContainer.id = 'file-manager-picker-modal-root';
    document.body.appendChild(modalContainer);

    function cleanup() {
      if (modalContainer && modalContainer.parentNode) {
        m.mount(modalContainer, null);
        modalContainer.parentNode.removeChild(modalContainer);
      }
    }

    var PickerModalComponent = {
      view: function() {
        return m('div.fixed.inset-0.bg-black/60.flex.items-center.justify-center.z-[9999].p-4.backdrop-blur-sm', [
          m('div.bg-white.dark:bg-slate-900.rounded-2xl.shadow-2xl.max-w-4xl.w-full.max-h-[90vh].flex.flex-col.overflow-hidden.border.border-gray-200.dark:border-slate-700', [
            m('div.flex.items-center.justify-between.p-4.border-b.border-gray-200.dark:border-slate-700.bg-gray-50.dark:bg-slate-800', [
              m('h2.text-base.font-bold.text-gray-900.dark:text-slate-100', opts.title || '📁 Ortam Kütüphanesinden Dosya Seç'),
              m('button.text-gray-400.hover:text-gray-600.dark:hover:text-slate-200.text-xl', {
                onclick: cleanup
              }, '✕')
            ]),
            m('div.p-4.overflow-y-auto.flex-1', [
              m(FileManagerView(true, function(selectedUrl) {
                if (onSelect) onSelect(selectedUrl);
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

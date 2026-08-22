/**
 * Inline content editing for admin users on public pages.
 * Popover anchored to the edit trigger — responsive bottom sheet on small screens.
 */
(function () {
  'use strict';

  var config = window.__WS_CONTENT__;
  if (!config || !config.enabled) return;

  var API = config.adminPath + '/api/content';
  var modalEl = null;
  var activeEntry = null;
  var activeSchema = null;
  var activeAnchor = null;
  var activeHost = null;
  var formState = {};
  var repositionBound = false;

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function qsa(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function ensureEditor() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.id = 'ws-content-modal';
    modalEl.innerHTML =
      '<div class="ws-content-modal-backdrop" data-close="1"></div>' +
      '<div class="ws-content-modal-panel" role="dialog" aria-modal="true" aria-labelledby="ws-content-modal-title">' +
      '<div class="ws-content-popover-arrow" aria-hidden="true"></div>' +
      '<div class="ws-content-modal-header">' +
      '<h3 class="ws-content-modal-title" id="ws-content-modal-title">Edit content</h3>' +
      '<button type="button" class="ws-content-modal-close" data-close="1" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="ws-content-modal-body"></div>' +
      '<div class="ws-content-modal-error" hidden></div>' +
      '<div class="ws-content-modal-footer">' +
      '<button type="button" class="ws-content-btn ws-content-btn-muted" data-close="1">Cancel</button>' +
      '<button type="button" class="ws-content-btn ws-content-btn-primary" data-save="1">Save</button>' +
      '</div></div>';
    document.body.appendChild(modalEl);

    modalEl.addEventListener('click', function (e) {
      if (e.target && e.target.getAttribute('data-close')) closeEditor();
    });
    qs('[data-save="1"]', modalEl).addEventListener('click', saveEditor);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modalEl.classList.contains('is-open')) {
        e.preventDefault();
        closeEditor();
      }
    });

    if (!repositionBound) {
      repositionBound = true;
      window.addEventListener('resize', function () {
        if (modalEl.classList.contains('is-open')) positionPopover();
      });
      window.addEventListener(
        'scroll',
        function () {
          if (modalEl.classList.contains('is-open')) positionPopover();
        },
        true
      );
    }

    return modalEl;
  }

  function closeEditor() {
    if (modalEl) modalEl.classList.remove('is-open');
    if (activeHost) activeHost.classList.remove('is-editing');
    activeEntry = null;
    activeSchema = null;
    activeAnchor = null;
    activeHost = null;
    formState = {};
  }

  function showError(msg) {
    var el = qs('.ws-content-modal-error', modalEl);
    if (!el) return;
    if (msg) {
      el.textContent = msg;
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  }

  function positionPopover() {
    if (!modalEl || !activeAnchor) return;
    var panel = qs('.ws-content-modal-panel', modalEl);
    if (!panel) return;

    if (window.innerWidth < 640) {
      panel.classList.add('is-sheet');
      panel.style.top = '';
      panel.style.left = '';
      panel.style.visibility = 'visible';
      return;
    }

    panel.classList.remove('is-sheet');
    panel.style.visibility = 'hidden';
    panel.style.display = 'flex';

    var panelRect = panel.getBoundingClientRect();
    var anchorRect = activeAnchor.getBoundingClientRect();
    var gap = 10;
    var pad = 12;
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    var top = anchorRect.bottom + gap;
    var left = anchorRect.left + anchorRect.width / 2 - panelRect.width / 2;
    var above = false;

    if (top + panelRect.height > vh - pad && anchorRect.top - panelRect.height - gap > pad) {
      top = anchorRect.top - panelRect.height - gap;
      above = true;
    }

    top = Math.max(pad, Math.min(top, vh - panelRect.height - pad));
    left = Math.max(pad, Math.min(left, vw - panelRect.width - pad));

    panel.style.top = top + 'px';
    panel.style.left = left + 'px';
    panel.style.visibility = 'visible';
    panel.classList.toggle('is-above', above);

    var arrow = qs('.ws-content-popover-arrow', panel);
    if (arrow) {
      var arrowLeft = anchorRect.left + anchorRect.width / 2 - left;
      arrow.style.left = Math.max(16, Math.min(arrowLeft, panelRect.width - 16)) + 'px';
    }
  }

  function focusFirstField() {
    var body = qs('.ws-content-modal-body', modalEl);
    if (!body) return;
    var input = body.querySelector('input, textarea, select');
    if (input) input.focus();
  }

  function renderField(field, container) {
    var wrap = document.createElement('div');
    wrap.className = 'ws-content-field';
    var label = document.createElement('label');
    label.textContent = field.label || field.name;
    wrap.appendChild(label);

    var value = formState[field.name];
    var input;

    if (field.type === 'boolean') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!value;
      input.addEventListener('change', function () {
        formState[field.name] = input.checked;
      });
    } else if (field.type === 'textarea' || field.type === 'rich-text') {
      input = document.createElement('textarea');
      input.rows = field.type === 'rich-text' ? 6 : 3;
      input.value = value || '';
      input.addEventListener('input', function () {
        formState[field.name] = input.value;
      });
    } else if (field.type === 'select') {
      input = document.createElement('select');
      (field.options || []).forEach(function (opt) {
        var o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        if (value === opt) o.selected = true;
        input.appendChild(o);
      });
      input.addEventListener('change', function () {
        formState[field.name] = input.value;
      });
    } else {
      input = document.createElement('input');
      input.type = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
      input.value = value != null ? value : '';
      input.addEventListener('input', function () {
        formState[field.name] = field.type === 'number' ? Number(input.value) : input.value;
      });
    }

    wrap.appendChild(input);
    container.appendChild(wrap);
  }

  function openEditor(anchorEl, hostEl, entryId, typeSlug) {
    ensureEditor();
    showError('');
    activeAnchor = anchorEl;
    activeHost = hostEl;
    if (activeHost) activeHost.classList.add('is-editing');

    var body = qs('.ws-content-modal-body', modalEl);
    body.innerHTML = '<p>Loading…</p>';
    modalEl.classList.add('is-open');
    positionPopover();

    Promise.all([
      fetch(API + '/types/' + encodeURIComponent(typeSlug) + '/schema', { credentials: 'include' }).then(function (r) {
        return r.json();
      }),
      fetch(API + '/entries/' + entryId, { credentials: 'include' }).then(function (r) {
        return r.json();
      }),
    ])
      .then(function (results) {
        if (!results[0].data || !results[1].data) throw new Error('Failed to load content');
        activeSchema = results[0].data.schema;
        activeEntry = results[1].data;
        formState = Object.assign({}, activeEntry.data || {});
        body.innerHTML = '';
        var title = qs('.ws-content-modal-title', modalEl);
        if (title) title.textContent = 'Edit: ' + (activeEntry.title || activeEntry.slug);
        (activeSchema.fields || []).forEach(function (field) {
          renderField(field, body);
        });
        requestAnimationFrame(function () {
          positionPopover();
          focusFirstField();
        });
      })
      .catch(function (err) {
        body.innerHTML = '';
        showError(err.message || 'Load failed');
        positionPopover();
      });
  }

  function sanitizeClientHtml(htmlStr) {
    if (!htmlStr) return '';
    try {
      var parser = new DOMParser();
      var doc = parser.parseFromString(htmlStr, 'text/html');
      var forbiddenTags = ['script', 'iframe', 'object', 'embed', 'applet', 'base'];
      forbiddenTags.forEach(function (tag) {
        var nodes = doc.querySelectorAll(tag);
        for (var i = 0; i < nodes.length; i++) {
          nodes[i].parentNode.removeChild(nodes[i]);
        }
      });
      var allNodes = doc.querySelectorAll('*');
      for (var i = 0; i < allNodes.length; i++) {
        var node = allNodes[i];
        var attrs = Array.prototype.slice.call(node.attributes);
        for (var j = 0; j < attrs.length; j++) {
          var attrName = attrs[j].name.toLowerCase();
          var attrVal = attrs[j].value.toLowerCase().replace(/[\x00-\x20\s]+/g, '').trim();
          if (attrName.indexOf('on') === 0) {
            node.removeAttribute(attrs[j].name);
          } else if ((attrName === 'href' || attrName === 'src' || attrName === 'action' || attrName === 'formaction' || attrName === 'xlink:href') &&
                     /^(?:javascript|data|vbscript):/i.test(attrVal)) {
            node.removeAttribute(attrs[j].name);
          }
        }
      }
      return doc.body.innerHTML;
    } catch (e) {
      return '';
    }
  }

  function updateDomFields(entryId, data) {
    qsa('[data-ws-content-entry="' + entryId + '"][data-ws-content-field]').forEach(function (el) {
      var field = el.getAttribute('data-ws-content-field');
      if (!field || !(field in data)) return;
      var val = data[field];
      var isHtml = el.getAttribute('data-ws-content-html') === 'true';
      if (isHtml) {
        el.innerHTML = sanitizeClientHtml(val);
      } else {
        el.textContent = val != null ? val : '';
      }
    });
  }

  function saveEditor() {
    if (!activeEntry) return;
    showError('');
    var saveBtn = qs('[data-save="1"]', modalEl);
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    fetch(API + '/entries/' + activeEntry.id, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: formState }),
    })
      .then(function (r) {
        return r.json().then(function (json) {
          if (!r.ok) throw new Error(json.error || 'Save failed');
          return json;
        });
      })
      .then(function (res) {
        var data = (res.data && res.data.data) || formState;
        updateDomFields(activeEntry.id, data);
        closeEditor();
      })
      .catch(function (err) {
        showError(err.message || 'Save failed');
      })
      .finally(function () {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      });
  }

  function lowestCommonAncestor(nodes) {
    if (!nodes.length) return null;
    var ancestor = nodes[0].parentElement;
    while (ancestor && ancestor !== document.body) {
      var ok = nodes.every(function (n) {
        return ancestor.contains(n);
      });
      if (ok) return ancestor;
      ancestor = ancestor.parentElement;
    }
    return nodes[0].parentElement;
  }

  function getEntryHosts() {
    var byEntry = {};
    qsa('[data-ws-content-entry]').forEach(function (el) {
      var entryId = el.getAttribute('data-ws-content-entry');
      var typeSlug = el.getAttribute('data-ws-content-type');
      if (!entryId || !typeSlug) return;
      if (!byEntry[entryId]) byEntry[entryId] = { typeSlug: typeSlug, nodes: [] };
      byEntry[entryId].nodes.push(el);
    });

    var hosts = [];
    Object.keys(byEntry).forEach(function (entryId) {
      var info = byEntry[entryId];
      var block = qs('.ws-content-block[data-ws-content-entry="' + entryId + '"]');
      var host = block || lowestCommonAncestor(info.nodes);
      if (!host) return;
      hosts.push({ host: host, entryId: entryId, typeSlug: info.typeSlug });
    });
    return hosts;
  }

  function attachToolbar(host, entryId, typeSlug) {
    if (host.querySelector('.ws-content-toolbar')) return;
    host.classList.add('ws-content-host');

    var toolbar = document.createElement('div');
    toolbar.className = 'ws-content-toolbar';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ws-content-edit-btn';
    btn.title = 'Edit content';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.innerHTML = '<span class="ws-content-edit-btn-icon" aria-hidden="true">✎</span> Edit';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openEditor(btn, host, entryId, typeSlug);
    });

    toolbar.appendChild(btn);
    host.insertBefore(toolbar, host.firstChild);
  }

  function attachEditButtons() {
    getEntryHosts().forEach(function (item) {
      attachToolbar(item.host, item.entryId, item.typeSlug);
    });
  }

  function init() {
    attachEditButtons();
    document.addEventListener('DOMContentLoaded', attachEditButtons);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

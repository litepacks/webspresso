/**
 * Self-contained HTML page for ORM map (snapshot + Mermaid).
 */

const fs = require('fs');
const path = require('path');

/**
 * @param {object} snapshot - { generatedAt, models }
 * @param {string} mermaidSource
 * @param {{ title?: string, packageName?: string }} meta
 * @returns {string}
 */
function buildOrmMapHtml(snapshot, mermaidSource, meta = {}) {
  const title = meta.title || 'ORM model map';
  const pkgName = meta.packageName || '';
  const dataJson = JSON.stringify(snapshot);
  const mermaidEscaped = JSON.stringify(mermaidSource);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0c0f14;
      --bg-elevated: #121722;
      --surface: #171d28;
      --surface-hover: #1e2635;
      --border: #2a3548;
      --border-subtle: #222a3a;
      --text: #e8edf4;
      --text-secondary: #9aa8bc;
      --accent: #4e9fd4;
      --accent-dim: rgba(78, 159, 212, 0.15);
      --accent-glow: rgba(78, 159, 212, 0.35);
      --success: #6bcf7f;
      --warning: #e6b05c;
      --radius: 10px;
      --radius-sm: 7px;
      --font: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
      --mono: "IBM Plex Mono", ui-monospace, monospace;
      --shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
      --header-h: 60px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font);
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      font-size: 15px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0,0,0,0);
      border: 0;
    }
    header.app-header {
      position: sticky;
      top: 0;
      z-index: 40;
      height: var(--header-h);
      padding: 0 1.25rem 0 1.5rem;
      background: linear-gradient(180deg, var(--bg-elevated) 0%, rgba(18, 23, 34, 0.92) 100%);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .brand {
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
      min-width: 0;
    }
    .brand h1 {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    .brand .subtitle {
      font-size: 0.75rem;
      color: var(--text-secondary);
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem 0.75rem;
      align-items: center;
    }
    .dot-sep { opacity: 0.45; }
    time { color: var(--text-secondary); }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      background: var(--accent-dim);
      color: var(--accent);
      border: 1px solid rgba(78, 159, 212, 0.35);
    }
    .header-actions {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .btn {
      font-family: var(--font);
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      padding: 0.45rem 0.85rem;
      border-radius: var(--radius-sm);
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
    }
    .btn:hover {
      background: var(--surface-hover);
      border-color: #3d4d66;
    }
    .btn:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent-glow);
    }
    .btn-primary {
      background: linear-gradient(180deg, #5aaee3 0%, var(--accent) 100%);
      border-color: rgba(255,255,255,0.12);
      color: #081018;
    }
    .btn-primary:hover {
      filter: brightness(1.06);
      border-color: rgba(255,255,255,0.2);
    }
    .layout {
      flex: 1;
      display: grid;
      grid-template-columns: minmax(220px, 280px) 1fr;
      min-height: 0;
      max-width: 1600px;
      margin: 0 auto;
      width: 100%;
    }
    @media (max-width: 900px) {
      .layout {
        grid-template-columns: 1fr;
      }
      aside.sidebar {
        border-right: none;
        border-bottom: 1px solid var(--border-subtle);
        max-height: min(42vh, 320px);
      }
    }
    aside.sidebar {
      background: var(--surface);
      border-right: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .sidebar-top {
      padding: 1rem;
      border-bottom: 1px solid var(--border-subtle);
      flex-shrink: 0;
    }
    .sidebar-top label {
      display: block;
      font-size: 0.65rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--text-secondary);
      margin-bottom: 0.45rem;
    }
    .filter-input {
      width: 100%;
      font-family: var(--font);
      font-size: 0.875rem;
      padding: 0.5rem 0.65rem 0.5rem 2rem;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--bg) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='%239aa8bc' viewBox='0 0 16 16'%3E%3Cpath d='M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z'/%3E%3C/svg%3E") 0.55rem center no-repeat;
      color: var(--text);
    }
    .filter-input::placeholder { color: #6b7a90; }
    .filter-input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-dim);
    }
    nav#nav {
      overflow-y: auto;
      padding: 0.5rem;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    nav#nav::-webkit-scrollbar { width: 8px; }
    nav#nav::-webkit-scrollbar-thumb {
      background: var(--border);
      border-radius: 4px;
    }
    .nav-item {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.1rem;
      width: 100%;
      text-align: left;
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--text);
      padding: 0.55rem 0.65rem 0.55rem 0.75rem;
      cursor: pointer;
      font-family: var(--font);
      transition: background 0.12s;
      border-left: 3px solid transparent;
    }
    .nav-item:hover { background: var(--surface-hover); }
    .nav-item:focus-visible {
      outline: none;
      box-shadow: inset 0 0 0 2px var(--accent-glow);
    }
    .nav-item.active {
      background: var(--accent-dim);
      border-left-color: var(--accent);
    }
    .nav-item .name { font-weight: 600; font-size: 0.9rem; letter-spacing: -0.01em; }
    .nav-item .table-name {
      font-family: var(--mono);
      font-size: 0.72rem;
      color: var(--text-secondary);
    }
    .nav-item.hidden { display: none; }
    .content {
      overflow-y: auto;
      padding: 1.25rem 1.5rem 2rem;
      min-height: 0;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      margin-bottom: 1.25rem;
      overflow: hidden;
    }
    .card-header {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.5rem 1rem;
      padding: 0.85rem 1.1rem;
      background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 100%);
      border-bottom: 1px solid var(--border-subtle);
    }
    .card-header h2 {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 600;
    }
    .card-header .hint {
      font-size: 0.75rem;
      color: var(--text-secondary);
    }
    .diagram-body {
      padding: 1rem 1rem 1.25rem;
      overflow: auto;
      background: radial-gradient(ellipse at top, rgba(78, 159, 212, 0.06) 0%, transparent 55%);
    }
    .diagram-body .mermaid {
      display: flex;
      justify-content: center;
      min-height: 120px;
    }
    .detail-stack { padding: 0 0 1rem; }
    .model-hero {
      margin-bottom: 1.25rem;
    }
    .model-hero h2 {
      margin: 0 0 0.35rem;
      font-size: 1.5rem;
      font-weight: 600;
      letter-spacing: -0.03em;
    }
    .table-pill {
      display: inline-flex;
      font-family: var(--mono);
      font-size: 0.8rem;
      padding: 0.2rem 0.55rem;
      border-radius: var(--radius-sm);
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--accent);
    }
    .chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-top: 0.75rem;
    }
    .chip {
      font-size: 0.72rem;
      padding: 0.2rem 0.5rem;
      border-radius: 6px;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text-secondary);
    }
    .chip strong { color: var(--success); font-weight: 500; }
    h3.section-title {
      margin: 1.25rem 0 0.6rem;
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-secondary);
    }
    .table-wrap {
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      overflow: auto;
      margin-bottom: 0.25rem;
    }
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8125rem;
    }
    table.data-table thead {
      position: sticky;
      top: 0;
      z-index: 1;
    }
    table.data-table th {
      text-align: left;
      padding: 0.55rem 0.75rem;
      background: var(--bg-elevated);
      color: var(--text-secondary);
      font-weight: 600;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid var(--border);
    }
    table.data-table td {
      padding: 0.45rem 0.75rem;
      border-bottom: 1px solid var(--border-subtle);
      vertical-align: top;
    }
    table.data-table tbody tr:nth-child(even) td {
      background: rgba(0,0,0,0.12);
    }
    table.data-table tbody tr:last-child td { border-bottom: none; }
    table.data-table code {
      font-family: var(--mono);
      font-size: 0.85em;
      background: transparent;
      padding: 0;
      color: var(--text);
    }
    .pill {
      display: inline-block;
      padding: 0.12rem 0.38rem;
      border-radius: 4px;
      font-size: 0.68rem;
      font-weight: 500;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text-secondary);
      margin: 0.1rem 0.1rem 0 0;
    }
    .pill-fk { border-color: rgba(230, 176, 92, 0.45); color: var(--warning); }
    .rel-type { color: var(--success); font-weight: 500; }
    .link-model {
      font-family: var(--font);
      background: none;
      border: none;
      color: var(--accent);
      cursor: pointer;
      font-weight: 500;
      padding: 0;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .link-model:hover { color: #7ebbe8; }
    .empty-state {
      padding: 2rem;
      text-align: center;
      color: var(--text-secondary);
      font-size: 0.9rem;
    }
    .footer-meta {
      font-size: 0.75rem;
      color: var(--text-secondary);
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border-subtle);
    }
    @media print {
      header.app-header .header-actions { display: none; }
      .filter-input { display: none; }
      aside.sidebar { max-height: none !important; }
      body { background: #fff; color: #111; }
      .card, aside.sidebar, .nav-item.active { box-shadow: none; }
    }
  </style>
</head>
<body>
  <header class="app-header">
    <div class="brand">
      <h1>${escapeHtml(title)}</h1>
      <div class="subtitle">
        ${pkgName ? '<span>' + escapeHtml(pkgName) + '</span><span class="dot-sep">·</span>' : ''}
        <time id="gen-time" datetime="${escapeHtml(snapshot.generatedAt)}"></time>
      </div>
    </div>
    <span class="badge" id="model-count-badge">${snapshot.models.length} models</span>
    <div class="header-actions">
      <button type="button" class="btn btn-primary" id="btn-svg">Download SVG</button>
      <button type="button" class="btn" id="btn-print">Print / PDF</button>
    </div>
  </header>
  <div class="layout">
    <aside class="sidebar" aria-label="Model list">
      <div class="sidebar-top">
        <label for="filter-models">Filter models</label>
        <input class="filter-input" type="search" id="filter-models" placeholder="Search by name or table…" autocomplete="off">
      </div>
      <nav id="nav" role="navigation"></nav>
    </aside>
    <div class="content">
      <section class="card" aria-labelledby="diagram-heading">
        <div class="card-header">
          <h2 id="diagram-heading">Entity relationship</h2>
          <span class="hint">Generated diagram · scroll to pan wide graphs</span>
        </div>
        <div class="diagram-body">
          <div class="mermaid" id="mermaid-diagram"></div>
        </div>
      </section>
      <div class="detail-stack" id="detail"></div>
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <script>
(function() {
  var SNAPSHOT = ${dataJson};
  var MERMAID_SRC = ${mermaidEscaped};

  function $(id) { return document.getElementById(id); }

  var nav = $('nav');
  var navButtons = [];
  var selected = (SNAPSHOT.models && SNAPSHOT.models[0]) ? SNAPSHOT.models[0].name : null;

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function selectModel(name) {
    selected = name;
    navButtons.forEach(function(item) {
      var on = item.modelName === name;
      item.el.classList.toggle('active', on);
      item.el.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) item.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    renderDetail(SNAPSHOT.models.find(function(x) { return x.name === name; }));
  }

  function renderDetail(m) {
    var d = $('detail');
    if (!m) {
      d.innerHTML = '<div class="empty-state">Select a model from the list.</div>';
      return;
    }

    var chips = [];
    chips.push('<span class="chip">PK <strong>' + esc(m.primaryKey) + '</strong></span>');
    if (m.scopes && m.scopes.timestamps) chips.push('<span class="chip">Timestamps</span>');
    if (m.scopes && m.scopes.softDelete) chips.push('<span class="chip">Soft delete</span>');
    if (m.scopes && m.scopes.tenant) chips.push('<span class="chip">Tenant: <strong>' + esc(m.scopes.tenant) + '</strong></span>');
    if (m.cache !== undefined && m.cache !== null) chips.push('<span class="chip">Cache: ' + esc(String(m.cache)) + '</span>');

    var rows = m.columns.map(function(c) {
      var flags = [];
      if (c.primary) flags.push('PK');
      if (c.unique) flags.push('UQ');
      if (c.index) flags.push('IX');
      var fk = c.references ? 'FK→' + c.references : '';
      var flagHtml = flags.map(function(f) {
        return '<span class="pill">' + esc(f) + '</span>';
      }).join(' ');
      if (fk) flagHtml += '<span class="pill pill-fk">' + esc(fk) + '</span>';
      return '<tr><td><code>' + esc(c.name) + '</code></td><td>' + esc(c.type) + '</td><td>' + (c.nullable ? '<span class="pill">NULL</span>' : '<span class="pill">NOT NULL</span>') + '</td><td>' + (flagHtml || '—') + '</td></tr>';
    }).join('');

    var modelNames = new Set(SNAPSHOT.models.map(function(x) { return x.name; }));
    var rels = (m.relations || []).map(function(r) {
      var targetCell = '—';
      if (r.targetModel) {
        if (modelNames.has(r.targetModel)) {
          targetCell = '<button type="button" class="link-model" data-jump="' + esc(r.targetModel) + '">' + esc(r.targetModel) + '</button>';
        } else {
          targetCell = esc(r.targetModel);
        }
      }
      return '<tr><td><code>' + esc(r.name) + '</code></td><td class="rel-type">' + esc(r.type) + '</td><td>' + targetCell + '</td><td><code>' + esc(r.foreignKey) + '</code></td></tr>';
    }).join('');

    d.innerHTML =
      '<div class="model-hero">' +
        '<h2>' + esc(m.name) + '</h2>' +
        '<div><span class="table-pill">' + esc(m.table) + '</span></div>' +
        '<div class="chip-row">' + chips.join('') + '</div>' +
      '</div>' +
      '<h3 class="section-title">Columns (' + m.columns.length + ')</h3>' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>Column</th><th>Type</th><th>Null</th><th>Flags</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="4" class="empty-state">No columns</td></tr>') +
      '</tbody></table></div>' +
      '<h3 class="section-title">Relations (' + (m.relations || []).length + ')</h3>' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Type</th><th>Target</th><th>FK</th></tr></thead><tbody>' +
      (rels || '<tr><td colspan="4" class="empty-state">No relations</td></tr>') +
      '</tbody></table></div>' +
      (m.rest && m.rest.enabled ? '<div class="footer-meta">REST <code>/' + esc(m.rest.path || '') + '</code>' + (m.rest.allowInclude && m.rest.allowInclude.length ? ' · include: ' + m.rest.allowInclude.map(esc).join(', ') : '') + '</div>' : '') +
      (m.hidden && m.hidden.length ? '<div class="footer-meta">Hidden columns: ' + m.hidden.map(function(h) { return '<code>' + esc(h) + '</code>'; }).join(' ') + '</div>' : '') +
      (m.admin && m.admin.enabled ? '<div class="footer-meta">Admin · ' + esc(m.admin.label || m.name) + (m.admin.icon ? ' ' + esc(m.admin.icon) : '') + '</div>' : '');

    d.querySelectorAll('.link-model').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var n = btn.getAttribute('data-jump');
        if (n) selectModel(n);
      });
    });
  }

  SNAPSHOT.models.forEach(function(m) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'nav-item' + (m.name === selected ? ' active' : '');
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', m.name === selected ? 'true' : 'false');
    var nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = m.name;
    var tableEl = document.createElement('span');
    tableEl.className = 'table-name';
    tableEl.textContent = m.table;
    b.appendChild(nameEl);
    b.appendChild(tableEl);
    b.addEventListener('click', function() { selectModel(m.name); });
    navButtons.push({ modelName: m.name, el: b });
    nav.appendChild(b);
  });

  var tEl = $('gen-time');
  if (tEl && SNAPSHOT.generatedAt) {
    try {
      tEl.textContent = new Date(SNAPSHOT.generatedAt).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      });
    } catch (e) {
      tEl.textContent = SNAPSHOT.generatedAt;
    }
  }

  $('filter-models').addEventListener('input', function() {
    var q = (this.value || '').trim().toLowerCase();
    navButtons.forEach(function(item) {
      var model = SNAPSHOT.models.find(function(x) { return x.name === item.modelName; });
      var hay = (model.name + ' ' + model.table).toLowerCase();
      var show = !q || hay.indexOf(q) !== -1;
      item.el.classList.toggle('hidden', !show);
    });
  });

  selectModel(selected);

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: {
      darkMode: true,
      background: '#171d28',
      mainBkg: '#1e2635',
      secondBkg: '#121722',
      lineColor: '#4e9fd4',
      border1: '#2a3548',
      border2: '#2a3548',
      primaryTextColor: '#e8edf4',
      secondaryTextColor: '#9aa8bc',
      tertiaryTextColor: '#9aa8bc',
      noteBkgColor: '#1a1f2e',
      noteTextColor: '#e8edf4',
      noteBorderColor: '#2a3548'
    }
  });
  var diagramEl = $('mermaid-diagram');
  diagramEl.textContent = MERMAID_SRC;
  mermaid.run({ nodes: [diagramEl] }).catch(function(e) {
    diagramEl.innerHTML = '<p class="empty-state">Could not render diagram: ' + esc(e && e.message ? e.message : String(e)) + '</p>';
  });

  $('btn-print').onclick = function() { window.print(); };

  $('btn-svg').onclick = function() {
    var svg = document.querySelector('#mermaid-diagram svg');
    if (!svg) {
      alert('Diagram is still loading — try again in a second.');
      return;
    }
    var clone = svg.cloneNode(true);
    var xml = new XMLSerializer().serializeToString(clone);
    var blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'orm-map-diagram.svg';
    a.click();
    URL.revokeObjectURL(url);
  };
})();
  </script>
</body>
</html>
`;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Optional: read package name from cwd/package.json
 * @param {string} cwd
 * @returns {string}
 */
function readPackageName(cwd) {
  try {
    const p = path.join(cwd, 'package.json');
    if (!fs.existsSync(p)) return '';
    const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
    return typeof pkg.name === 'string' ? pkg.name : '';
  } catch {
    return '';
  }
}

module.exports = { buildOrmMapHtml, readPackageName, escapeHtml };

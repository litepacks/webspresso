/**
 * Developer Mail Preview & Dev Inbox (AdonisJS & Laravel-inspired)
 * Mounted at /_webspresso/mail-preview in development
 * @module plugins/email/preview-handler
 */

/**
 * Generate standalone responsive HTML for Dev Mail Preview UI
 * @param {Array<Object>} messages
 * @param {string} [basePath='/_webspresso/mail-preview']
 * @returns {string}
 */
function renderPreviewHtml(messages = [], basePath = '/_webspresso/mail-preview') {
  const safeJson = JSON.stringify(messages).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mail Preview & Dev Inbox — Webspresso</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --surface: #111827;
      --surface-hover: #1f2937;
      --border: #1e293b;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --accent: #6366f1;
      --accent-hover: #4f46e5;
      --accent-glow: rgba(99, 102, 241, 0.15);
      --success: #10b981;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    header {
      height: 56px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      z-index: 10;
    }
    .logo-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .logo-badge {
      background: linear-gradient(135deg, #6366f1, #a855f7);
      color: #fff;
      font-weight: 700;
      font-size: 14px;
      padding: 4px 10px;
      border-radius: 8px;
      letter-spacing: 0.5px;
    }
    .header-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text);
    }
    .header-count {
      font-size: 12px;
      color: var(--text-muted);
      background: rgba(255,255,255,0.06);
      padding: 2px 8px;
      border-radius: 999px;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .btn {
      background: rgba(255,255,255,0.06);
      color: var(--text);
      border: 1px solid var(--border);
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn:hover { background: var(--surface-hover); }
    .btn-danger { color: #fca5a5; }
    .btn-danger:hover { background: rgba(239, 68, 68, 0.15); border-color: var(--danger); }
    .main-layout {
      display: flex;
      flex: 1;
      height: calc(100vh - 56px);
      overflow: hidden;
    }
    .sidebar {
      width: 360px;
      background: var(--surface);
      border-right: 1px solid var(--border);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }
    .email-item {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      cursor: pointer;
      transition: background 0.15s;
    }
    .email-item:hover { background: rgba(255,255,255,0.03); }
    .email-item.active {
      background: var(--accent-glow);
      border-left: 3px solid var(--accent);
    }
    .email-to {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    .email-time {
      font-size: 11px;
      font-weight: 400;
      color: var(--text-muted);
    }
    .email-subject {
      font-size: 13px;
      color: #cbd5e1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 4px;
    }
    .email-preview {
      font-size: 12px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .content-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: var(--bg);
      overflow: hidden;
    }
    .viewer-header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 16px 24px;
    }
    .vh-subject {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .vh-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      font-size: 12px;
      color: var(--text-muted);
    }
    .vh-meta strong { color: var(--text); }
    .viewer-toolbar {
      padding: 8px 24px;
      background: rgba(17, 24, 39, 0.6);
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .tab-group, .viewport-group {
      display: flex;
      gap: 6px;
    }
    .tab-btn, .vp-btn {
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 12px;
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      cursor: pointer;
    }
    .tab-btn.active, .vp-btn.active {
      background: rgba(255,255,255,0.08);
      border-color: var(--border);
      color: var(--text);
      font-weight: 600;
    }
    .viewport-container {
      flex: 1;
      display: flex;
      justify-content: center;
      align-items: stretch;
      padding: 20px;
      overflow-y: auto;
      background: #020617;
    }
    .preview-frame-wrapper {
      width: 100%;
      height: 100%;
      background: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
      transition: width 0.3s ease;
    }
    .preview-frame-wrapper.mobile { width: 375px; }
    .preview-frame-wrapper.tablet { width: 768px; }
    iframe {
      width: 100%;
      height: 100%;
      border: none;
    }
    pre.code-view {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      line-height: 1.6;
      background: #090d16;
      color: #93c5fd;
      padding: 20px;
      border-radius: 8px;
      width: 100%;
      height: 100%;
      overflow: auto;
      white-space: pre-wrap;
    }
    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      text-align: center;
      padding: 40px;
    }
    .empty-icon {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.8;
    }
    .empty-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 8px;
    }
    .empty-code {
      margin-top: 20px;
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--border);
      padding: 12px 18px;
      border-radius: 8px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #a5b4fc;
      text-align: left;
    }
  </style>
</head>
<body>
  <header>
    <div class="logo-group">
      <span class="logo-badge">Webspresso</span>
      <span class="header-title">📬 Mail Preview & Dev Inbox</span>
      <span class="header-count" id="headerCount">0 emails</span>
    </div>
    <div class="header-actions">
      <button class="btn" onclick="fetchMessages()">↻ Refresh</button>
      <button class="btn btn-danger" onclick="clearOutbox()">🗑️ Clear Outbox</button>
    </div>
  </header>

  <div class="main-layout">
    <div class="sidebar" id="sidebarList">
      <!-- Populated via JS -->
    </div>

    <div class="content-area" id="viewerArea">
      <!-- Populated via JS -->
    </div>
  </div>

  <script>
    let messages = ${safeJson};
    let selectedId = messages.length > 0 ? messages[messages.length - 1].id : null;
    let activeTab = 'html';
    let activeViewport = 'desktop';

    function renderSidebar() {
      const sidebar = document.getElementById('sidebarList');
      const countEl = document.getElementById('headerCount');
      countEl.textContent = messages.length + ' email' + (messages.length === 1 ? '' : 's');

      if (messages.length === 0) {
        sidebar.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px;">No emails captured yet</div>';
        renderEmptyViewer();
        return;
      }

      sidebar.innerHTML = messages.slice().reverse().map(msg => {
        const isSelected = msg.id === selectedId;
        const toDisplay = Array.isArray(msg.to) ? msg.to.join(', ') : (typeof msg.to === 'object' ? (msg.to.address || JSON.stringify(msg.to)) : String(msg.to || ''));
        const dateStr = msg.sentAt ? new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
        const preview = msg.text || (msg.html ? msg.html.replace(/<[^>]+>/g, ' ').slice(0, 80) : '');

        return \`
          <div class="email-item \${isSelected ? 'active' : ''}" onclick="selectEmail('\${msg.id}')">
            <div class="email-to">
              <span>\${escapeHtml(toDisplay)}</span>
              <span class="email-time">\${dateStr}</span>
            </div>
            <div class="email-subject">\${escapeHtml(msg.subject || '(No Subject)')}</div>
            <div class="email-preview">\${escapeHtml(preview)}</div>
          </div>
        \`;
      }).join('');

      renderContent();
    }

    function renderEmptyViewer() {
      const viewer = document.getElementById('viewerArea');
      viewer.innerHTML = \`
        <div class="empty-state">
          <div class="empty-icon">✉️</div>
          <div class="empty-title">Inbox is Empty</div>
          <p>Send an email using <code>req.mailer.send(...)</code> or a <code>new Mailable()</code> class in your application to preview it here.</p>
          <div class="empty-code">
            // Example dispatch:<br>
            await req.mailer.send({<br>
            &nbsp;&nbsp;to: 'user@example.com',<br>
            &nbsp;&nbsp;subject: 'Welcome!',<br>
            &nbsp;&nbsp;html: '&lt;h1&gt;Welcome to Webspresso!&lt;/h1&gt;'<br>
            });
          </div>
        </div>
      \`;
    }

    function renderContent() {
      const viewer = document.getElementById('viewerArea');
      const msg = messages.find(m => m.id === selectedId);
      if (!msg) {
        if (messages.length > 0) {
          selectedId = messages[messages.length - 1].id;
          return renderContent();
        }
        return renderEmptyViewer();
      }

      const toDisplay = Array.isArray(msg.to) ? msg.to.join(', ') : (typeof msg.to === 'object' ? (msg.to.address || JSON.stringify(msg.to)) : String(msg.to || ''));
      const fromDisplay = typeof msg.from === 'object' ? (msg.from.address || JSON.stringify(msg.from)) : String(msg.from || '');
      const dateStr = msg.sentAt ? new Date(msg.sentAt).toLocaleString() : '';

      viewer.innerHTML = \`
        <div class="viewer-header">
          <div class="vh-subject">\${escapeHtml(msg.subject || '(No Subject)')}</div>
          <div class="vh-meta">
            <div><strong>From:</strong> \${escapeHtml(fromDisplay)}</div>
            <div><strong>To:</strong> \${escapeHtml(toDisplay)}</div>
            \${msg.cc ? \`<div><strong>Cc:</strong> \${escapeHtml(String(msg.cc))}</div>\` : ''}
            <div><strong>Date:</strong> \${dateStr}</div>
          </div>
        </div>

        <div class="viewer-toolbar">
          <div class="tab-group">
            <button class="tab-btn \${activeTab === 'html' ? 'active' : ''}" onclick="setTab('html')">HTML View</button>
            <button class="tab-btn \${activeTab === 'text' ? 'active' : ''}" onclick="setTab('text')">Plain Text</button>
            <button class="tab-btn \${activeTab === 'raw' ? 'active' : ''}" onclick="setTab('raw')">Headers & Payload</button>
          </div>
          \${activeTab === 'html' ? \`
            <div class="viewport-group">
              <button class="vp-btn \${activeViewport === 'desktop' ? 'active' : ''}" onclick="setViewport('desktop')">🖥️ Desktop</button>
              <button class="vp-btn \${activeViewport === 'tablet' ? 'active' : ''}" onclick="setViewport('tablet')">📱 Tablet</button>
              <button class="vp-btn \${activeViewport === 'mobile' ? 'active' : ''}" onclick="setViewport('mobile')">📱 Mobile</button>
            </div>
          \` : '<div></div>'}
        </div>

        <div class="viewport-container">
          \${activeTab === 'html' ? \`
            <div class="preview-frame-wrapper \${activeViewport}">
              <iframe id="previewFrame" src="${basePath}/api/messages/\${msg.id}/html"></iframe>
            </div>
          \` : activeTab === 'text' ? \`
            <pre class="code-view">\${escapeHtml(msg.text || '(No plain text body)')}</pre>
          \` : \`
            <pre class="code-view">\${escapeHtml(JSON.stringify(msg, null, 2))}</pre>
          \`}
        </div>
      \`;
    }

    function selectEmail(id) {
      selectedId = id;
      renderSidebar();
    }

    function setTab(tab) {
      activeTab = tab;
      renderContent();
    }

    function setViewport(vp) {
      activeViewport = vp;
      renderContent();
    }

    async function fetchMessages() {
      try {
        const res = await fetch('${basePath}/api/messages');
        const data = await res.json();
        messages = data.messages || [];
        if (!messages.some(m => m.id === selectedId) && messages.length > 0) {
          selectedId = messages[messages.length - 1].id;
        }
        renderSidebar();
      } catch (err) {
        console.error('Failed to refresh messages:', err);
      }
    }

    async function clearOutbox() {
      if (!confirm('Clear all captured emails from outbox?')) return;
      try {
        await fetch('${basePath}/api/clear', { method: 'POST' });
        messages = [];
        selectedId = null;
        renderSidebar();
      } catch (err) {
        console.error('Failed to clear outbox:', err);
      }
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    renderSidebar();
  </script>
</body>
</html>`;
}

/**
 * Create Dev Mail Preview HTTP handlers
 * @param {Object} options
 * @param {import('../../core/mail/mailer').Mailer} options.mailer
 * @param {string} [options.basePath='/_webspresso/mail-preview']
 */
function createMailPreviewHandlers({ mailer, basePath = '/_webspresso/mail-preview' }) {
  return {
    /**
     * GET /_webspresso/mail-preview
     * Serve HTML Dev Inbox SPA
     */
    indexHandler(req, res) {
      const messages = mailer.getOutbox();
      const html = renderPreviewHtml(messages, basePath);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    },

    /**
     * GET /_webspresso/mail-preview/api/messages
     */
    listMessagesHandler(req, res) {
      const messages = mailer.getOutbox();
      res.json({ success: true, count: messages.length, messages });
    },

    /**
     * GET /_webspresso/mail-preview/api/messages/:id
     */
    getMessageHandler(req, res) {
      const { id } = req.params;
      const messages = mailer.getOutbox();
      const msg = messages.find((m) => m.id === id || m.messageId === id);
      if (!msg) {
        return res.status(404).json({ error: 'Message not found' });
      }
      res.json({ success: true, message: msg });
    },

    /**
     * GET /_webspresso/mail-preview/api/messages/:id/html
     */
    getMessageHtmlHandler(req, res) {
      const { id } = req.params;
      const messages = mailer.getOutbox();
      const msg = messages.find((m) => m.id === id || m.messageId === id);
      if (!msg) {
        return res.status(404).send('<p>Message not found</p>');
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(msg.html || `<pre>${msg.text || 'No content'}</pre>`);
    },

    /**
     * POST /_webspresso/mail-preview/api/clear
     */
    clearMessagesHandler(req, res) {
      mailer.clearOutbox();
      res.json({ success: true, message: 'Outbox cleared' });
    },

    /**
     * POST /_webspresso/mail-preview/api/preview
     */
    async previewHandler(req, res) {
      try {
        const previewResult = await mailer.preview(req.body);
        res.json({ success: true, preview: previewResult });
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    },
  };
}

module.exports = {
  renderPreviewHtml,
  createMailPreviewHandlers,
};

/**
 * Dashboard CSS Styles
 * Dark theme inspired by GitHub
 */

module.exports = `
:root {
  --bg-primary: #0d1117;
  --bg-secondary: #161b22;
  --bg-tertiary: #21262d;
  --border: #30363d;
  --text-primary: #e6edf3;
  --text-secondary: #8b949e;
  --text-muted: #6e7681;
  --accent: #58a6ff;
  --accent-hover: #79c0ff;
  --green: #3fb950;
  --red: #f85149;
  --orange: #d29922;
  --purple: #a371f7;
  --pink: #db61a2;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.5;
  min-height: 100vh;
}

.dashboard {
  max-width: 1400px;
  margin: 0 auto;
  padding: 24px;
}

/* Header */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}

.header h1 {
  font-size: 24px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 12px;
}

.header h1 svg {
  width: 32px;
  height: 32px;
  color: var(--green);
}

.dev-badge {
  background: var(--green);
  color: var(--bg-primary);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
}

/* Tabs */
.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 24px;
  background: var(--bg-secondary);
  padding: 4px;
  border-radius: 8px;
  width: fit-content;
}

.tab {
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  transition: all 0.15s ease;
}

.tab:hover {
  color: var(--text-primary);
  background: var(--bg-tertiary);
}

.tab.active {
  color: var(--text-primary);
  background: var(--bg-tertiary);
}

/* Filter bar */
.filter-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.filter-group {
  display: flex;
  gap: 4px;
  background: var(--bg-secondary);
  padding: 4px;
  border-radius: 6px;
}

.filter-btn {
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  transition: all 0.15s ease;
}

.filter-btn:hover {
  color: var(--text-primary);
}

.filter-btn.active {
  color: var(--text-primary);
  background: var(--bg-tertiary);
}

.search-input {
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 14px;
  width: 240px;
  outline: none;
  transition: border-color 0.15s ease;
}

.search-input:focus {
  border-color: var(--accent);
}

.search-input::placeholder {
  color: var(--text-muted);
}

/* Table */
.table-container {
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 1px solid var(--border);
  overflow: hidden;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th {
  text-align: left;
  padding: 12px 16px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border);
}

td {
  padding: 12px 16px;
  font-size: 14px;
  border-bottom: 1px solid var(--border);
}

tr:last-child td {
  border-bottom: none;
}

tr:hover td {
  background: var(--bg-tertiary);
}

/* Method badges */
.method-badge {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
}

.method-get { background: rgba(63, 185, 80, 0.2); color: var(--green); }
.method-post { background: rgba(88, 166, 255, 0.2); color: var(--accent); }
.method-put { background: rgba(210, 153, 34, 0.2); color: var(--orange); }
.method-patch { background: rgba(163, 113, 247, 0.2); color: var(--purple); }
.method-delete { background: rgba(248, 81, 73, 0.2); color: var(--red); }

/* Type badges */
.type-badge {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

.type-ssr { background: rgba(163, 113, 247, 0.2); color: var(--purple); }
.type-api { background: rgba(219, 97, 162, 0.2); color: var(--pink); }

/* Code text */
.code {
  font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
  font-size: 13px;
  color: var(--accent);
}

.file-path {
  color: var(--text-secondary);
  font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
  font-size: 13px;
}

/* Dynamic indicator */
.dynamic-indicator {
  color: var(--orange);
  font-size: 12px;
  margin-left: 8px;
}

/* Cards */
.card {
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 1px solid var(--border);
  padding: 20px;
  margin-bottom: 16px;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.card-value {
  font-size: 32px;
  font-weight: 600;
  color: var(--text-primary);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

/* Plugin list */
.plugin-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}

.plugin-item:last-child {
  border-bottom: none;
}

.plugin-name {
  font-weight: 600;
  font-size: 15px;
}

.plugin-version {
  color: var(--text-muted);
  font-size: 13px;
  font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
}

/* Config section */
.config-section {
  margin-bottom: 24px;
}

.config-section h3 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--text-primary);
}

.config-item {
  display: flex;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
}

.config-item:last-child {
  border-bottom: none;
}

.config-key {
  font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
  font-size: 13px;
  color: var(--accent);
  min-width: 200px;
}

.config-value {
  font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
  font-size: 13px;
  color: var(--text-secondary);
  word-break: break-all;
}

/* Empty state */
.empty-state {
  text-align: center;
  padding: 48px;
  color: var(--text-muted);
}

.empty-state svg {
  width: 48px;
  height: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

/* Loading */
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px;
  color: var(--text-muted);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-right: 12px;
}
`;



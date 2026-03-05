/**
 * SEO Checker Panel UI
 * Generates the HTML and CSS for the SEO checker floating panel
 */

/**
 * Generate panel styles
 */
function generatePanelStyles() {
  return `
<style id="seo-checker-styles">
  #seo-checker-panel {
    position: fixed;
    top: 20px;
    right: 20px;
    width: 420px;
    max-height: calc(100vh - 100px);
    background: linear-gradient(145deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%);
    border: 1px solid #2d2d44;
    border-radius: 16px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.05);
    z-index: 99998;
    font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    color: #e4e4e7;
    display: none;
    flex-direction: column;
    overflow: hidden;
    backdrop-filter: blur(20px);
  }
  
  #seo-checker-panel.open {
    display: flex;
    animation: seoSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }
  
  @keyframes seoSlideIn {
    from {
      opacity: 0;
      transform: translateX(20px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateX(0) scale(1);
    }
  }
  
  /* Header */
  .seo-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    background: rgba(0,0,0,0.2);
  }
  
  .seo-panel-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    font-size: 14px;
    letter-spacing: 0.3px;
  }
  
  .seo-panel-title svg {
    width: 20px;
    height: 20px;
    color: #22d3ee;
  }
  
  .seo-panel-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .seo-refresh-btn {
    background: rgba(34, 211, 238, 0.1);
    border: 1px solid rgba(34, 211, 238, 0.2);
    border-radius: 8px;
    color: #22d3ee;
    padding: 6px 12px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  
  .seo-refresh-btn:hover {
    background: rgba(34, 211, 238, 0.2);
    border-color: #22d3ee;
  }
  
  .seo-panel-close {
    background: none;
    border: none;
    color: #71717a;
    font-size: 18px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    transition: all 0.2s;
  }
  
  .seo-panel-close:hover {
    background: rgba(255,255,255,0.05);
    color: #f4f4f5;
  }
  
  /* Score Section */
  .seo-score-section {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 20px;
    background: linear-gradient(180deg, rgba(0,0,0,0.1) 0%, transparent 100%);
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  
  .seo-score-circle {
    width: 100px;
    height: 100px;
    border-radius: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: conic-gradient(from 180deg, #3b82f6 0%, #22d3ee 50%, #10b981 100%);
    padding: 4px;
    position: relative;
  }
  
  .seo-score-circle::before {
    content: '';
    position: absolute;
    inset: 4px;
    background: #0f0f1a;
    border-radius: 50%;
  }
  
  .seo-score-circle.score-good { background: conic-gradient(from 180deg, #10b981 0%, #22d3ee 50%, #10b981 100%); }
  .seo-score-circle.score-warning { background: conic-gradient(from 180deg, #f59e0b 0%, #fbbf24 50%, #f59e0b 100%); }
  .seo-score-circle.score-bad { background: conic-gradient(from 180deg, #ef4444 0%, #f87171 50%, #ef4444 100%); }
  
  .seo-score-inner {
    position: relative;
    z-index: 1;
    text-align: center;
  }
  
  .seo-score-value {
    font-size: 32px;
    font-weight: 700;
    color: #fff;
    line-height: 1;
  }
  
  .seo-score-label {
    font-size: 10px;
    color: #a1a1aa;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-top: 4px;
  }
  
  /* Tabs */
  .seo-tabs {
    display: flex;
    padding: 0 12px;
    gap: 4px;
    background: rgba(0,0,0,0.2);
    border-bottom: 1px solid rgba(255,255,255,0.06);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
    scrollbar-color: #3f3f46 transparent;
  }
  
  .seo-tabs::-webkit-scrollbar {
    height: 4px;
  }
  
  .seo-tabs::-webkit-scrollbar-track {
    background: transparent;
  }
  
  .seo-tabs::-webkit-scrollbar-thumb {
    background: #3f3f46;
    border-radius: 2px;
  }
  
  .seo-tab {
    flex: 0 0 auto;
    padding: 10px 10px;
    background: none;
    border: none;
    color: #71717a;
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    border-bottom: 2px solid transparent;
    white-space: nowrap;
  }
  
  .seo-tab:hover {
    color: #a1a1aa;
    background: rgba(255,255,255,0.02);
  }
  
  .seo-tab.active {
    color: #22d3ee;
    border-bottom-color: #22d3ee;
    background: rgba(34, 211, 238, 0.05);
  }
  
  .seo-tab-icon {
    font-size: 16px;
  }
  
  .seo-tab-badge {
    font-size: 9px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 10px;
    min-width: 18px;
    text-align: center;
  }
  
  .badge-pass { background: rgba(16, 185, 129, 0.2); color: #10b981; }
  .badge-warning { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
  .badge-fail { background: rgba(239, 68, 68, 0.2); color: #ef4444; }
  
  /* Results */
  .seo-results {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    scrollbar-width: thin;
    scrollbar-color: #3f3f46 transparent;
  }
  
  .seo-results::-webkit-scrollbar {
    width: 6px;
  }
  
  .seo-results::-webkit-scrollbar-track {
    background: transparent;
  }
  
  .seo-results::-webkit-scrollbar-thumb {
    background: #3f3f46;
    border-radius: 3px;
  }
  
  .seo-category-section {
    display: none;
  }
  
  .seo-check-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.04);
    border-radius: 10px;
    margin-bottom: 8px;
    transition: all 0.2s;
  }
  
  .seo-check-item:hover {
    background: rgba(255,255,255,0.04);
    border-color: rgba(255,255,255,0.08);
  }
  
  .seo-check-status {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    flex-shrink: 0;
  }
  
  .check-pass {
    background: rgba(16, 185, 129, 0.15);
    color: #10b981;
    border: 1px solid rgba(16, 185, 129, 0.3);
  }
  
  .check-warning {
    background: rgba(245, 158, 11, 0.15);
    color: #f59e0b;
    border: 1px solid rgba(245, 158, 11, 0.3);
  }
  
  .check-fail {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }
  
  .seo-check-content {
    flex: 1;
    min-width: 0;
  }
  
  .seo-check-name {
    font-weight: 600;
    color: #f4f4f5;
    margin-bottom: 2px;
    font-size: 12px;
  }
  
  .seo-check-message {
    font-size: 11px;
    color: #a1a1aa;
    line-height: 1.4;
  }
  
  .seo-check-value {
    font-size: 10px;
    font-weight: 500;
    color: #71717a;
    background: rgba(0,0,0,0.3);
    padding: 4px 8px;
    border-radius: 6px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  
  /* Footer */
  .seo-panel-footer {
    padding: 12px 16px;
    border-top: 1px solid rgba(255,255,255,0.06);
    background: rgba(0,0,0,0.2);
    font-size: 10px;
    color: #52525b;
    text-align: center;
  }
  
  .seo-panel-footer a {
    color: #22d3ee;
    text-decoration: none;
  }
  
  /* Floating toggle button (for non-toolbar usage) */
  #seo-checker-toggle {
    position: fixed;
    bottom: 80px;
    right: 20px;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: linear-gradient(135deg, #22d3ee 0%, #3b82f6 100%);
    border: none;
    color: white;
    font-size: 20px;
    cursor: pointer;
    z-index: 99997;
    box-shadow: 0 4px 14px rgba(34, 211, 238, 0.4);
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  #seo-checker-toggle:hover {
    transform: scale(1.1);
    box-shadow: 0 6px 20px rgba(34, 211, 238, 0.5);
  }
  
  /* Hide toggle when using toolbar integration */
  #webspresso-dev-toolbar ~ #seo-checker-toggle {
    display: none;
  }
  
  /* Mobile responsive */
  @media (max-width: 480px) {
    #seo-checker-panel {
      top: 10px;
      right: 10px;
      left: 10px;
      width: auto;
      max-height: calc(100vh - 80px);
    }
    
    .seo-score-circle {
      width: 80px;
      height: 80px;
    }
    
    .seo-score-value {
      font-size: 24px;
    }
    
    .seo-tab {
      flex: 0 0 auto;
      padding: 8px 8px;
      font-size: 9px;
    }
    
    .seo-tab-icon {
      font-size: 14px;
    }
  }
</style>`;
}

/**
 * Generate panel HTML
 */
function generatePanelHtml(checkDefinitions) {
  const { categories } = require('./checks');
  
  return `
<button id="seo-checker-toggle" title="SEO Checker">🔍</button>
<div id="seo-checker-panel">
  <div class="seo-panel-header">
    <div class="seo-panel-title">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/>
        <path d="M21 21l-4.35-4.35"/>
      </svg>
      SEO Checker
    </div>
    <div class="seo-panel-actions">
      <button class="seo-refresh-btn">
        <span>↻</span> Refresh
      </button>
      <button class="seo-panel-close">×</button>
    </div>
  </div>
  
  <div class="seo-score-section">
    <div class="seo-score-circle">
      <div class="seo-score-inner">
        <div class="seo-score-value">--</div>
        <div class="seo-score-label">Score</div>
      </div>
    </div>
  </div>
  
  <div class="seo-tabs">
    ${categories.map(cat => `
      <button class="seo-tab${cat.id === 'meta' ? ' active' : ''}" data-category="${cat.id}">
        <span class="seo-tab-icon">${cat.icon}</span>
        <span>${cat.name}</span>
        <span class="seo-tab-badge">-</span>
      </button>
    `).join('')}
  </div>
  
  <div class="seo-results">
    <!-- Results will be populated by JavaScript -->
  </div>
  
  <div class="seo-panel-footer">
    Webspresso SEO Checker • <a href="/_webspresso" target="_blank">Dashboard</a>
  </div>
</div>`;
}

module.exports = {
  generatePanelStyles,
  generatePanelHtml
};

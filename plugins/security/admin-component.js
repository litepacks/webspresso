/**
 * Security Shield Admin Panel Component — Mithril SPA Generator
 * Interactive Security Cockpit featuring live KPI metrics, IP Firewall & Ban Manager,
 * Honeypot Incident Feed, Manual Ban Modal, and Security Posture Audit Checklist.
 * @module plugins/security/admin-component
 */

'use strict';

/**
 * Generate client-side Mithril SPA component script string for Security Shield
 * 
 * @param {Object} [options]
 * @param {string} [options.apiPrefix='/security']
 * @returns {string}
 */
function generateSecurityComponent(options = {}) {
  const apiPrefix = options.apiPrefix || '/security';

  return `
(function() {
  var API = '${apiPrefix}';

  function formatRelativeTime(dateStrOrTs) {
    if (!dateStrOrTs) return '—';
    try {
      var d = new Date(dateStrOrTs);
      var now = new Date();
      var diffMs = now - d;
      var isFuture = diffMs < 0;
      var absSec = Math.floor(Math.abs(diffMs) / 1000);
      var absMin = Math.floor(absSec / 60);
      var absHour = Math.floor(absMin / 60);
      var absDay = Math.floor(absHour / 24);

      if (isFuture) {
        if (absSec < 60) return 'in ' + absSec + 's';
        if (absMin < 60) return 'in ' + absMin + 'm';
        if (absHour < 24) return 'in ' + absHour + 'h';
        return 'in ' + absDay + 'd';
      }

      if (absSec < 60) return absSec + 's ago';
      if (absMin < 60) return absMin + 'm ago';
      if (absHour < 24) return absHour + 'h ago';
      return absDay + 'd ago';
    } catch (e) {
      return String(dateStrOrTs);
    }
  }

  function getReasonBadgeStyle(reason) {
    var r = (reason || '').toLowerCase();
    if (r.indexOf('honeypot') !== -1) {
      return 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-200 dark:border-purple-800';
    }
    if (r.indexOf('traversal') !== -1) {
      return 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-800';
    }
    if (r.indexOf('brute') !== -1) {
      return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    }
    if (r.indexOf('manual') !== -1) {
      return 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800';
    }
    return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700';
  }

  function getActionBadgeStyle(action) {
    var a = (action || '').toLowerCase();
    if (a === 'banned') {
      return 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-800';
    }
    if (a === 'blocked') {
      return 'bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300 border-orange-200 dark:border-orange-800';
    }
    if (a === 'throttled') {
      return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    }
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
  }

  var SecurityDashboard = {
    stats: {
      activeBans: 0,
      permanentBans: 0,
      autoBans24h: 0,
      totalBans: 0,
      totalViolations: 0,
      whitelistCount: 0,
      blacklistCount: 0,
      incidents24h: 0,
      incidentBreakdown: {},
      securityScore: 100,
      securityGrade: 'A+',
      passedChecks: 8,
      totalChecks: 8,
    },
    bannedIps: [],
    bannedTotal: 0,
    bannedPage: 1,
    bannedLimit: 20,
    bannedTotalPages: 1,

    incidents: [],
    incidentsTotal: 0,
    auditData: null,

    activeTab: 'banned', // 'banned' | 'incidents' | 'audit'
    searchQuery: '',
    reasonFilter: 'all',
    incidentTypeFilter: 'all',

    isLoading: false,
    errorMessage: '',
    successMessage: '',

    showBanModal: false,
    banModalData: {
      ip: '',
      reason: 'Malicious activity',
      duration: '24h',
      isSubmitting: false,
    },

    loadStats: function() {
      var self = this;
      return m.request({
        method: 'GET',
        url: '/_admin/api' + API + '/stats',
        withCredentials: true,
      }).then(function(res) {
        if (res && res.status === 'ok') {
          self.stats = res;
        }
      }).catch(function(err) {
        console.error('Failed to load security stats:', err);
      });
    },

    loadBannedIps: function() {
      var self = this;
      self.isLoading = true;
      var params = {
        page: self.bannedPage,
        limit: self.bannedLimit,
      };
      if (self.searchQuery) params.search = self.searchQuery;
      if (self.reasonFilter && self.reasonFilter !== 'all') params.reason = self.reasonFilter;

      var queryString = m.buildQueryString(params);

      return m.request({
        method: 'GET',
        url: '/_admin/api' + API + '/banned' + (queryString ? '?' + queryString : ''),
        withCredentials: true,
      }).then(function(res) {
        self.isLoading = false;
        if (res && Array.isArray(res.items)) {
          self.bannedIps = res.items;
          self.bannedTotal = res.total;
          self.bannedTotalPages = res.totalPages || 1;
        }
      }).catch(function(err) {
        self.isLoading = false;
        self.errorMessage = 'Failed to load banned IPs: ' + (err.message || 'Server error');
      });
    },

    loadIncidents: function() {
      var self = this;
      self.isLoading = true;
      var params = { limit: 50 };
      if (self.incidentTypeFilter && self.incidentTypeFilter !== 'all') {
        params.type = self.incidentTypeFilter;
      }
      if (self.searchQuery) {
        params.search = self.searchQuery;
      }

      var queryString = m.buildQueryString(params);

      return m.request({
        method: 'GET',
        url: '/_admin/api' + API + '/incidents' + (queryString ? '?' + queryString : ''),
        withCredentials: true,
      }).then(function(res) {
        self.isLoading = false;
        if (res && Array.isArray(res.items)) {
          self.incidents = res.items;
          self.incidentsTotal = res.total;
        }
      }).catch(function(err) {
        self.isLoading = false;
        console.error('Failed to load incidents:', err);
      });
    },

    loadAudit: function() {
      var self = this;
      self.isLoading = true;
      return m.request({
        method: 'GET',
        url: '/_admin/api' + API + '/audit',
        withCredentials: true,
      }).then(function(res) {
        self.isLoading = false;
        self.auditData = res;
      }).catch(function(err) {
        self.isLoading = false;
        console.error('Failed to load audit:', err);
      });
    },

    unbanIp: function(ip) {
      var self = this;
      if (!confirm('Are you sure you want to lift the ban on IP ' + ip + '?')) return;

      m.request({
        method: 'POST',
        url: '/_admin/api' + API + '/unban',
        body: { ip: ip },
        withCredentials: true,
      }).then(function() {
        self.successMessage = 'IP ' + ip + ' unbanned successfully.';
        self.loadStats();
        self.loadBannedIps();
        setTimeout(function() { self.successMessage = ''; m.redraw(); }, 4000);
      }).catch(function(err) {
        alert('Failed to unban IP: ' + (err.message || 'Server error'));
      });
    },

    clearIncidents: function() {
      var self = this;
      if (!confirm('Clear all logged security incidents?')) return;

      m.request({
        method: 'POST',
        url: '/_admin/api' + API + '/clear-incidents',
        withCredentials: true,
      }).then(function() {
        self.incidents = [];
        self.loadStats();
        m.redraw();
      });
    },

    submitBan: function() {
      var self = this;
      var data = self.banModalData;
      if (!data.ip.trim()) {
        alert('Please enter a valid IP address.');
        return;
      }

      data.isSubmitting = true;
      m.request({
        method: 'POST',
        url: '/_admin/api' + API + '/ban',
        body: {
          ip: data.ip.trim(),
          reason: data.reason.trim(),
          duration: data.duration,
        },
        withCredentials: true,
      }).then(function() {
        data.isSubmitting = false;
        self.showBanModal = false;
        self.successMessage = 'IP ' + data.ip.trim() + ' banned successfully.';
        data.ip = '';
        self.loadStats();
        self.loadBannedIps();
        setTimeout(function() { self.successMessage = ''; m.redraw(); }, 4000);
      }).catch(function(err) {
        data.isSubmitting = false;
        alert('Failed to ban IP: ' + (err.message || 'Server error'));
      });
    },

    oninit: function() {
      this.loadStats();
      this.loadBannedIps();
    },

    view: function() {
      var self = this;
      var stats = self.stats;

      var gradeColor = 'text-emerald-500';
      if (stats.securityGrade === 'B') gradeColor = 'text-blue-500';
      if (stats.securityGrade === 'C') gradeColor = 'text-amber-500';
      if (stats.securityGrade === 'F') gradeColor = 'text-rose-500';

      return m('div.space-y-6', [
        // Header
        m('div.flex.flex-col.md:flex-row.md:items-center.md:justify-between.gap-4', [
          m('div', [
            m('div.flex.items-center.gap-3', [
              m('h1.text-2xl.font-bold.text-gray-900.dark:text-white', 'Security Shield & Threat Defense'),
              m('span.inline-flex.items-center.gap-1.5.px-2.5.py-0.5.rounded-full.text-xs.font-semibold.bg-emerald-100.text-emerald-800.dark:bg-emerald-950/60.dark:text-emerald-300.border.border-emerald-200.dark:border-emerald-800', [
                m('span.w-2.h-2.rounded-full.bg-emerald-500.animate-pulse'),
                'Shield Active',
              ]),
            ]),
            m('p.text-sm.text-gray-500.dark:text-gray-400.mt-1', 'Native WAF, IP firewall, honeypot traps, brute-force defense, and security posture audit.'),
          ]),
          m('div.flex.items-center.gap-2.5', [
            m('button.px-3.5.py-2.text-sm.font-medium.text-white.bg-rose-600.hover:bg-rose-700.rounded-lg.shadow-sm.flex.items-center.gap-1.5.transition-colors', {
              onclick: function() { self.showBanModal = true; },
            }, [
              m('span', '+'),
              m('span', 'Ban IP Manually'),
            ]),
            m('button.px-3.5.py-2.text-sm.font-medium.text-gray-700.dark:text-gray-200.bg-white.dark:bg-gray-800.border.border-gray-300.dark:border-gray-700.hover:bg-gray-50.dark:hover:bg-gray-700.rounded-lg.shadow-sm.flex.items-center.gap-1.5.transition-colors', {
              onclick: function() {
                self.loadStats();
                if (self.activeTab === 'banned') self.loadBannedIps();
                if (self.activeTab === 'incidents') self.loadIncidents();
                if (self.activeTab === 'audit') self.loadAudit();
              },
            }, [
              m('span', '⟳'),
              m('span', 'Refresh'),
            ]),
          ]),
        ]),

        // Flash message
        self.successMessage ? m('div.p-4.rounded-lg.bg-emerald-50.dark:bg-emerald-950/50.border.border-emerald-200.dark:border-emerald-800.text-emerald-800.dark:text-emerald-300.text-sm', self.successMessage) : null,
        self.errorMessage ? m('div.p-4.rounded-lg.bg-rose-50.dark:bg-rose-950/50.border.border-rose-200.dark:border-rose-800.text-rose-800.dark:text-rose-300.text-sm', self.errorMessage) : null,

        // Live KPI Cards
        m('div.grid.grid-cols-1.sm:grid-cols-2.lg:grid-cols-4.gap-4', [
          // Card 1: Shield Status
          m('div.bg-white.dark:bg-gray-800.border.border-gray-200.dark:border-gray-700.rounded-xl.p-5.shadow-sm', [
            m('div.flex.items-center.justify-between', [
              m('span.text-xs.font-semibold.text-gray-500.dark:text-gray-400.uppercase.tracking-wider', 'Shield Engine'),
              m('span.text-xs.px-2.py-0.5.rounded-full.bg-emerald-100.dark:bg-emerald-900/40.text-emerald-700.dark:text-emerald-300.font-medium', 'Zero-Dep'),
            ]),
            m('div.mt-2.flex.items-baseline.gap-2', [
              m('span.text-2xl.font-bold.text-emerald-600.dark:text-emerald-400', 'Enforcing'),
            ]),
            m('div.mt-1.text-xs.text-gray-500.dark:text-gray-400', 'Headers & Firewall running'),
          ]),

          // Card 2: Active IP Bans
          m('div.bg-white.dark:bg-gray-800.border.border-gray-200.dark:border-gray-700.rounded-xl.p-5.shadow-sm', [
            m('div.flex.items-center.justify-between', [
              m('span.text-xs.font-semibold.text-gray-500.dark:text-gray-400.uppercase.tracking-wider', 'Active IP Bans'),
              m('span.text-xs.px-2.py-0.5.rounded-full.bg-rose-100.dark:bg-rose-900/40.text-rose-700.dark:text-rose-300.font-medium', stats.permanentBans + ' Perm'),
            ]),
            m('div.mt-2.flex.items-baseline.gap-2', [
              m('span.text-2xl.font-bold.text-gray-900.dark:text-white', stats.activeBans || 0),
              m('span.text-xs.text-gray-500.dark:text-gray-400', 'banned IPs'),
            ]),
            m('div.mt-1.text-xs.text-gray-500.dark:text-gray-400', (stats.autoBans24h || 0) + ' auto-banned in last 24h'),
          ]),

          // Card 3: Attacks Blocked
          m('div.bg-white.dark:bg-gray-800.border.border-gray-200.dark:border-gray-700.rounded-xl.p-5.shadow-sm', [
            m('div.flex.items-center.justify-between', [
              m('span.text-xs.font-semibold.text-gray-500.dark:text-gray-400.uppercase.tracking-wider', 'Attacks Blocked (24h)'),
              m('span.text-xs.px-2.py-0.5.rounded-full.bg-purple-100.dark:bg-purple-900/40.text-purple-700.dark:text-purple-300.font-medium', (stats.totalViolations || 0) + ' total'),
            ]),
            m('div.mt-2.flex.items-baseline.gap-2', [
              m('span.text-2xl.font-bold.text-gray-900.dark:text-white', stats.incidents24h || 0),
              m('span.text-xs.text-gray-500.dark:text-gray-400', 'threat attempts'),
            ]),
            m('div.mt-1.text-xs.text-gray-500.dark:text-gray-400', 'Traps, LFI & scanner hits'),
          ]),

          // Card 4: Health Score
          m('div.bg-white.dark:bg-gray-800.border.border-gray-200.dark:border-gray-700.rounded-xl.p-5.shadow-sm', [
            m('div.flex.items-center.justify-between', [
              m('span.text-xs.font-semibold.text-gray-500.dark:text-gray-400.uppercase.tracking-wider', 'Security Score'),
              m('span.text-xs.px-2.py-0.5.rounded-full.bg-blue-100.dark:bg-blue-900/40.text-blue-700.dark:text-blue-300.font-bold', stats.securityGrade || 'A+'),
            ]),
            m('div.mt-2.flex.items-baseline.gap-2', [
              m('span.text-2xl.font-bold.' + gradeColor, (stats.securityScore || 100) + '%'),
              m('span.text-xs.text-gray-500.dark:text-gray-400', '(' + stats.passedChecks + '/' + stats.totalChecks + ' checks)'),
            ]),
            m('div.mt-1.text-xs.text-gray-500.dark:text-gray-400', 'Full compliance with OWASP standard'),
          ]),
        ]),

        // Tab Navigation
        m('div.border-b.border-gray-200.dark:border-gray-700', [
          m('nav.flex.space-x-8', [
            m('button.py-3.px-1.border-b-2.font-medium.text-sm.transition-colors', {
              class: self.activeTab === 'banned'
                ? 'border-rose-500 text-rose-600 dark:text-rose-400 font-semibold'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
              onclick: function() {
                self.activeTab = 'banned';
                self.loadBannedIps();
              },
            }, [
              m('span', 'Banned IPs & Firewall'),
              m('span.ml-2.py-0.5.px-2.rounded-full.text-xs.bg-gray-100.dark:bg-gray-700.text-gray-600.dark:text-gray-300', stats.activeBans || 0),
            ]),
            m('button.py-3.px-1.border-b-2.font-medium.text-sm.transition-colors', {
              class: self.activeTab === 'incidents'
                ? 'border-purple-500 text-purple-600 dark:text-purple-400 font-semibold'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
              onclick: function() {
                self.activeTab = 'incidents';
                self.loadIncidents();
              },
            }, [
              m('span', 'Incident Threat Log'),
              m('span.ml-2.py-0.5.px-2.rounded-full.text-xs.bg-gray-100.dark:bg-gray-700.text-gray-600.dark:text-gray-300', stats.incidents24h || 0),
            ]),
            m('button.py-3.px-1.border-b-2.font-medium.text-sm.transition-colors', {
              class: self.activeTab === 'audit'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-semibold'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
              onclick: function() {
                self.activeTab = 'audit';
                self.loadAudit();
              },
            }, [
              m('span', 'Security Posture Audit'),
              m('span.ml-2.py-0.5.px-2.rounded-full.text-xs.bg-blue-100.dark:bg-blue-900/40.text-blue-700.dark:text-blue-300', stats.securityGrade || 'A+'),
            ]),
          ]),
        ]),

        // TAB 1: BANNED IPS
        self.activeTab === 'banned' ? m('div.space-y-4', [
          // Filter & Search bar
          m('div.flex.flex-col.sm:flex-row.sm:items-center.sm:justify-between.gap-3', [
            m('div.flex.items-center.gap-2.flex-1', [
              m('input.w-full.max-w-xs.px-3.py-2.text-sm.rounded-lg.border.border-gray-300.dark:border-gray-700.bg-white.dark:bg-gray-800.text-gray-900.dark:text-white', {
                placeholder: 'Search IP or reason...',
                value: self.searchQuery,
                oninput: function(e) {
                  self.searchQuery = e.target.value;
                  self.bannedPage = 1;
                },
                onkeyup: function(e) {
                  if (e.key === 'Enter') self.loadBannedIps();
                },
              }),
              m('select.px-3.py-2.text-sm.rounded-lg.border.border-gray-300.dark:border-gray-700.bg-white.dark:bg-gray-800.text-gray-700.dark:text-gray-200', {
                value: self.reasonFilter,
                onchange: function(e) {
                  self.reasonFilter = e.target.value;
                  self.bannedPage = 1;
                  self.loadBannedIps();
                },
              }, [
                m('option', { value: 'all' }, 'All Reasons'),
                m('option', { value: 'honeypot' }, 'Honeypot Hits'),
                m('option', { value: 'traversal' }, 'Path Traversal'),
                m('option', { value: 'brute' }, 'Brute-Force'),
                m('option', { value: 'manual' }, 'Manual Bans'),
              ]),
            ]),
            m('div.text-xs.text-gray-500.dark:text-gray-400', 'Showing ' + self.bannedIps.length + ' of ' + self.bannedTotal + ' banned IPs'),
          ]),

          // Table
          m('div.bg-white.dark:bg-gray-800.border.border-gray-200.dark:border-gray-700.rounded-xl.overflow-hidden.shadow-sm', [
            m('div.overflow-x-auto', [
              m('table.min-w-full.divide-y.divide-gray-200.dark:divide-gray-700.text-sm', [
                m('thead.bg-gray-50.dark:bg-gray-900/50.text-gray-500.dark:text-gray-400.text-xs.uppercase.font-semibold', [
                  m('tr', [
                    m('th.px-4.py-3.text-left', 'IP Address'),
                    m('th.px-4.py-3.text-left', 'Reason'),
                    m('th.px-4.py-3.text-left', 'Banned At'),
                    m('th.px-4.py-3.text-left', 'Expires In'),
                    m('th.px-4.py-3.text-center', 'Violations'),
                    m('th.px-4.py-3.text-right', 'Actions'),
                  ]),
                ]),
                m('tbody.divide-y.divide-gray-200.dark:divide-gray-700', [
                  self.bannedIps.length === 0 ? m('tr', [
                    m('td.px-4.py-8.text-center.text-gray-500.dark:text-gray-400', { colspan: 6 }, [
                      m('div.text-3xl.mb-2', '🛡️'),
                      m('div.font-medium', 'No banned IP addresses found.'),
                      m('div.text-xs.text-gray-400.mt-1', 'The firewall is active and monitoring for malicious activity.'),
                    ]),
                  ]) : self.bannedIps.map(function(item) {
                    var expiryStr = item.isPermanent ? 'Permanent' : formatRelativeTime(item.expiresAt);
                    return m('tr.hover:bg-gray-50.dark:hover:bg-gray-700/50.transition-colors', { key: item.ip }, [
                      m('td.px-4.py-3.font-mono.font-semibold.text-gray-900.dark:text-white', item.ip),
                      m('td.px-4.py-3', [
                        m('span.inline-flex.items-center.px-2.py-0.5.rounded-full.text-xs.font-medium.border', {
                          class: getReasonBadgeStyle(item.reason),
                        }, item.reason || 'manual_ban'),
                      ]),
                      m('td.px-4.py-3.text-gray-500.dark:text-gray-400', formatRelativeTime(item.bannedAt)),
                      m('td.px-4.py-3', [
                        item.isPermanent
                          ? m('span.px-2.py-0.5.rounded-full.text-xs.bg-gray-100.dark:bg-gray-700.text-gray-700.dark:text-gray-300.font-medium', 'Permanent')
                          : m('span.text-xs.text-amber-600.dark:text-amber-400.font-medium', expiryStr),
                      ]),
                      m('td.px-4.py-3.text-center.font-mono.text-xs.text-gray-600.dark:text-gray-300', item.violations || 0),
                      m('td.px-4.py-3.text-right', [
                        m('button.px-2.5.py-1.text-xs.font-medium.text-rose-600.dark:text-rose-400.hover:bg-rose-50.dark:hover:bg-rose-950/60.rounded.transition-colors', {
                          onclick: function() { self.unbanIp(item.ip); },
                        }, 'Unban'),
                      ]),
                    ]);
                  }),
                ]),
              ]),
            ]),
          ]),
        ]) : null,

        // TAB 2: INCIDENTS FEED
        self.activeTab === 'incidents' ? m('div.space-y-4', [
          m('div.flex.flex-col.sm:flex-row.sm:items-center.sm:justify-between.gap-3', [
            m('div.flex.items-center.gap-2.flex-1', [
              m('select.px-3.py-2.text-sm.rounded-lg.border.border-gray-300.dark:border-gray-700.bg-white.dark:bg-gray-800.text-gray-700.dark:text-gray-200', {
                value: self.incidentTypeFilter,
                onchange: function(e) {
                  self.incidentTypeFilter = e.target.value;
                  self.loadIncidents();
                },
              }, [
                m('option', { value: 'all' }, 'All Threat Types'),
                m('option', { value: 'honeypot' }, 'Honeypots'),
                m('option', { value: 'path_traversal' }, 'Path Traversal'),
                m('option', { value: 'bad_bot' }, 'Vulnerability Scanners'),
                m('option', { value: 'bruteforce' }, 'Brute-Force'),
                m('option', { value: 'manual_ban' }, 'Manual Bans'),
              ]),
              m('button.px-3.py-2.text-xs.font-medium.text-gray-600.dark:text-gray-300.bg-gray-100.dark:bg-gray-800.hover:bg-gray-200.dark:hover:bg-gray-700.rounded-lg.transition-colors', {
                onclick: function() { self.clearIncidents(); },
              }, 'Clear Log'),
            ]),
            m('div.text-xs.text-gray-500.dark:text-gray-400', 'Showing latest ' + self.incidents.length + ' security incidents'),
          ]),

          m('div.bg-white.dark:bg-gray-800.border.border-gray-200.dark:border-gray-700.rounded-xl.overflow-hidden.shadow-sm', [
            m('div.overflow-x-auto', [
              m('table.min-w-full.divide-y.divide-gray-200.dark:divide-gray-700.text-sm', [
                m('thead.bg-gray-50.dark:bg-gray-900/50.text-gray-500.dark:text-gray-400.text-xs.uppercase.font-semibold', [
                  m('tr', [
                    m('th.px-4.py-3.text-left', 'Time'),
                    m('th.px-4.py-3.text-left', 'Type'),
                    m('th.px-4.py-3.text-left', 'Attacker IP'),
                    m('th.px-4.py-3.text-left', 'Target Route / Path'),
                    m('th.px-4.py-3.text-left', 'Reason'),
                    m('th.px-4.py-3.text-right', 'Action Taken'),
                  ]),
                ]),
                m('tbody.divide-y.divide-gray-200.dark:divide-gray-700', [
                  self.incidents.length === 0 ? m('tr', [
                    m('td.px-4.py-8.text-center.text-gray-500.dark:text-gray-400', { colspan: 6 }, 'No incidents recorded yet.'),
                  ]) : self.incidents.map(function(inc) {
                    return m('tr.hover:bg-gray-50.dark:hover:bg-gray-700/50.transition-colors', { key: inc.id }, [
                      m('td.px-4.py-3.text-gray-500.dark:text-gray-400.text-xs.whitespace-nowrap', formatRelativeTime(inc.timestamp)),
                      m('td.px-4.py-3', [
                        m('span.inline-flex.items-center.px-2.py-0.5.rounded-full.text-xs.font-medium.border', {
                          class: getReasonBadgeStyle(inc.type),
                        }, inc.type),
                      ]),
                      m('td.px-4.py-3.font-mono.font-semibold.text-gray-900.dark:text-white', inc.ip),
                      m('td.px-4.py-3.font-mono.text-xs.text-gray-700.dark:text-gray-300', [
                        m('span.font-bold.text-indigo-600.dark:text-indigo-400.mr-1', inc.method),
                        inc.path,
                      ]),
                      m('td.px-4.py-3.text-xs.text-gray-500.dark:text-gray-400', inc.reason),
                      m('td.px-4.py-3.text-right', [
                        m('span.inline-flex.items-center.px-2.py-0.5.rounded-full.text-xs.font-bold.border', {
                          class: getActionBadgeStyle(inc.actionTaken),
                        }, (inc.actionTaken || 'BLOCKED').toUpperCase()),
                      ]),
                    ]);
                  }),
                ]),
              ]),
            ]),
          ]),
        ]) : null,

        // TAB 3: AUDIT CHECKLIST
        self.activeTab === 'audit' ? m('div.space-y-6', [
          self.auditData ? m('div.space-y-4', [
            // Audit Overview Header Card
            m('div.bg-gradient-to-r.from-slate-900.to-slate-800.text-white.p-6.rounded-xl.shadow-md.flex.flex-col.md:flex-row.md:items-center.md:justify-between.gap-4', [
              m('div', [
                m('div.text-xs.font-semibold.uppercase.tracking-wider.text-slate-400', 'OWASP Security Compliance Grade'),
                m('div.text-3xl.font-extrabold.mt-1.flex.items-center.gap-3', [
                  m('span', self.auditData.grade + ' Rating'),
                  m('span.text-lg.font-medium.text-emerald-400', '(' + self.auditData.score + '% Pass Rate)'),
                ]),
                m('div.text-sm.text-slate-300.mt-1', self.auditData.passedChecks + ' out of ' + self.auditData.totalChecks + ' security defenses verified and active.'),
              ]),
              m('div.flex.items-center.gap-2', [
                m('span.text-xs.text-slate-400', 'Last audited: ' + formatRelativeTime(self.auditData.auditedAt)),
              ]),
            ]),

            // Checklist Items
            m('div.grid.grid-cols-1.md:grid-cols-2.gap-4', [
              self.auditData.checks.map(function(chk) {
                return m('div.bg-white.dark:bg-gray-800.border.rounded-xl.p-5.shadow-sm.flex.flex-col.justify-between.transition-all', {
                  class: chk.passed
                    ? 'border-gray-200 dark:border-gray-700'
                    : 'border-rose-200 dark:border-rose-900/60 bg-rose-50/20 dark:bg-rose-950/10',
                }, [
                  m('div', [
                    m('div.flex.items-start.justify-between.gap-2', [
                      m('span.font-semibold.text-gray-900.dark:text-white', chk.title),
                      chk.passed
                        ? m('span.px-2.py-0.5.rounded-full.text-xs.font-bold.bg-emerald-100.text-emerald-800.dark:bg-emerald-950/60.dark:text-emerald-300', 'PASS')
                        : m('span.px-2.py-0.5.rounded-full.text-xs.font-bold.bg-rose-100.text-rose-800.dark:bg-rose-950/60.dark:text-rose-300', 'FAIL'),
                    ]),
                    m('p.text-xs.text-gray-500.dark:text-gray-400.mt-1.5', chk.description),
                  ]),
                  chk.recommendation ? m('div.mt-3.p-2.5.rounded-lg.bg-rose-50.dark:bg-rose-950/40.border.border-rose-200.dark:border-rose-800.text-xs.text-rose-700.dark:text-rose-300', [
                    m('span.font-semibold', 'Recommendation: '),
                    chk.recommendation,
                  ]) : null,
                ]);
              }),
            ]),
          ]) : m('div.p-8.text-center.text-gray-500', 'Loading security audit...'),
        ]) : null,

        // BAN IP MODAL
        self.showBanModal ? m('div.fixed.inset-0.z-50.flex.items-center.justify-center.bg-black/60.p-4', [
          m('div.bg-white.dark:bg-gray-800.rounded-2xl.border.border-gray-200.dark:border-gray-700.max-w-md.w-full.p-6.shadow-2xl.space-y-4', [
            m('div.flex.items-center.justify-between', [
              m('h2.text-lg.font-bold.text-gray-900.dark:text-white', 'Ban IP Address'),
              m('button.text-gray-400.hover:text-gray-600.dark:hover:text-gray-200.text-xl', {
                onclick: function() { self.showBanModal = false; },
              }, '✕'),
            ]),
            m('div.space-y-3', [
              m('div', [
                m('label.block.text-xs.font-medium.text-gray-700.dark:text-gray-300.mb-1', 'IP Address (IPv4 or IPv6)'),
                m('input.w-full.px-3.py-2.text-sm.rounded-lg.border.border-gray-300.dark:border-gray-600.bg-white.dark:bg-gray-700.text-gray-900.dark:text-white', {
                  placeholder: 'e.g. 198.51.100.42',
                  value: self.banModalData.ip,
                  oninput: function(e) { self.banModalData.ip = e.target.value; },
                }),
              ]),
              m('div', [
                m('label.block.text-xs.font-medium.text-gray-700.dark:text-gray-300.mb-1', 'Reason'),
                m('input.w-full.px-3.py-2.text-sm.rounded-lg.border.border-gray-300.dark:border-gray-600.bg-white.dark:bg-gray-700.text-gray-900.dark:text-white', {
                  placeholder: 'e.g. Automated scanning or malicious abuse',
                  value: self.banModalData.reason,
                  oninput: function(e) { self.banModalData.reason = e.target.value; },
                }),
              ]),
              m('div', [
                m('label.block.text-xs.font-medium.text-gray-700.dark:text-gray-300.mb-1', 'Ban Duration'),
                m('select.w-full.px-3.py-2.text-sm.rounded-lg.border.border-gray-300.dark:border-gray-600.bg-white.dark:bg-gray-700.text-gray-900.dark:text-white', {
                  value: self.banModalData.duration,
                  onchange: function(e) { self.banModalData.duration = e.target.value; },
                }, [
                  m('option', { value: '1h' }, '1 Hour'),
                  m('option', { value: '6h' }, '6 Hours'),
                  m('option', { value: '24h' }, '24 Hours (1 Day)'),
                  m('option', { value: '7d' }, '7 Days'),
                  m('option', { value: '30d' }, '30 Days'),
                  m('option', { value: 'permanent' }, 'Permanent'),
                ]),
              ]),
            ]),
            m('div.flex.items-center.justify-end.gap-3.pt-2', [
              m('button.px-4.py-2.text-sm.text-gray-700.dark:text-gray-300.hover:bg-gray-100.dark:hover:bg-gray-700.rounded-lg.transition-colors', {
                onclick: function() { self.showBanModal = false; },
              }, 'Cancel'),
              m('button.px-4.py-2.text-sm.font-semibold.text-white.bg-rose-600.hover:bg-rose-700.rounded-lg.shadow-sm.transition-colors', {
                disabled: self.banModalData.isSubmitting,
                onclick: function() { self.submitBan(); },
              }, self.banModalData.isSubmitting ? 'Banning...' : 'Confirm Ban'),
            ]),
          ]),
        ]) : null,
      ]);
    },
  };

  return SecurityDashboard;
})();
  `;
}

module.exports = {
  generateSecurityComponent,
};

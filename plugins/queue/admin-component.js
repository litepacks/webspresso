/**
 * Background Job Queue Admin Panel Component — Mithril SPA Component Generator
 * Features live KPI metrics, status filters, JSON payload & error traceback inspector,
 * 1-click retry, bulk retry, cancel job, purge, manual dispatch modal, and cron schedules.
 * @module plugins/queue/admin-component
 */

'use strict';

/**
 * Generate client-side Mithril SPA component script string for Job Queue
 * 
 * @param {Object} [options]
 * @param {string} [options.apiPrefix='/queue']
 * @returns {string}
 */
function generateQueueComponent(options = {}) {
  const apiPrefix = options.apiPrefix || '/queue';

  return `
(function() {
  var API = '${apiPrefix}';

  function formatRelativeTime(dateStr) {
    if (!dateStr) return '—';
    try {
      var d = new Date(dateStr);
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

      if (absSec < 60) return 'Just now';
      if (absMin < 60) return absMin + 'm ago';
      if (absHour < 24) return absHour + 'h ago';
      if (absDay === 1) return 'Yesterday';
      if (absDay < 30) return absDay + 'd ago';
      return d.toLocaleDateString();
    } catch (e) {
      return dateStr;
    }
  }

  function formatDateTime(dateStr) {
    if (!dateStr) return '—';
    try {
      var d = new Date(dateStr);
      return d.toLocaleString();
    } catch (e) {
      return dateStr;
    }
  }

  var DISPATCH_PRESETS = {
    'email.send': {
      label: 'Email Dispatch (email.send)',
      data: {
        to: 'user@example.com',
        subject: 'Welcome to Webspresso',
        template: 'welcome',
        vars: { name: 'Alex' }
      }
    },
    'report.generate': {
      label: 'Report Generation (report.generate)',
      data: {
        reportType: 'monthly_revenue',
        format: 'pdf',
        recipientId: 42,
        period: 'current_month'
      }
    },
    'cache.warm': {
      label: 'Cache Warmup (cache.warm)',
      data: {
        keys: ['homepage_featured', 'catalog_categories'],
        ttl: 3600
      }
    },
    'data.sync': {
      label: 'Data Sync (data.sync)',
      data: {
        source: 'external_crm',
        batchSize: 500,
        syncMode: 'incremental'
      }
    },
    'custom': {
      label: 'Custom Job Data',
      data: {
        test: true,
        dispatchedAt: new Date().toISOString()
      }
    }
  };

  function QueuePage() {
    var activeTab = 'all'; // 'all' | 'pending' | 'running' | 'delayed' | 'completed' | 'failed' | 'schedules'
    var loading = false;
    var error = null;
    var successToast = null;

    // Global Stats
    var stats = {
      pending: 0,
      delayed: 0,
      running: 0,
      completed: 0,
      failed: 0,
      total: 0,
      activeWorkers: 0,
      concurrency: 2,
      registeredJobs: [],
      isPaused: false,
      isRunning: true
    };

    // Jobs Listing
    var jobs = [];
    var totalJobs = 0;
    var page = 1;
    var limit = 20;
    var totalPages = 1;
    var searchTerm = '';
    var filterName = '';
    var selectedJobIds = {};

    // Schedules (Cron)
    var schedules = [];

    // Modals
    var showDetailModal = false;
    var inspectingJob = null;
    var showDispatchModal = false;
    var dispatchForm = {
      name: '',
      preset: 'custom',
      payloadStr: JSON.stringify(DISPATCH_PRESETS['custom'].data, null, 2),
      priority: 10,
      delaySeconds: 0,
      attempts: 3,
      timeoutSeconds: 30
    };

    var autoRefreshTimer = null;
    var autoRefreshInterval = 5000; // 5s poll

    function setToast(msg) {
      successToast = msg;
      setTimeout(function() {
        successToast = null;
        m.redraw();
      }, 3500);
    }

    function copyToClipboard(text, label) {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
          setToast((label || 'Text') + ' copied to clipboard!');
        }).catch(function() {
          setToast('Failed to copy to clipboard.');
        });
      } else {
        var el = document.createElement('textarea');
        el.value = text;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        setToast((label || 'Text') + ' copied to clipboard!');
      }
    }

    var clientApi = {
      get: function(path) {
        if (typeof api !== 'undefined' && api && typeof api.get === 'function') {
          return api.get(path);
        }
        var adminPath = window.__ADMIN_PATH__ || '/_admin';
        return m.request({ method: 'GET', url: adminPath + '/api' + path });
      },
      post: function(path, data) {
        if (typeof api !== 'undefined' && api && typeof api.post === 'function') {
          return api.post(path, data);
        }
        var adminPath = window.__ADMIN_PATH__ || '/_admin';
        return m.request({ method: 'POST', url: adminPath + '/api' + path, body: data });
      },
      delete: function(path) {
        if (typeof api !== 'undefined' && api && typeof api.delete === 'function') {
          return api.delete(path);
        }
        var adminPath = window.__ADMIN_PATH__ || '/_admin';
        return m.request({ method: 'DELETE', url: adminPath + '/api' + path });
      }
    };

    function fetchStats() {
      return clientApi.get(API + '/stats')
        .then(function(res) {
          if (res) {
            stats = {
              pending: res.pending || 0,
              delayed: res.delayed || 0,
              running: res.running || 0,
              completed: res.completed || 0,
              failed: res.failed || 0,
              total: res.total || 0,
              activeWorkers: res.activeWorkers || 0,
              concurrency: res.concurrency || 2,
              registeredJobs: res.registeredJobs || [],
              isPaused: !!res.isPaused,
              isRunning: res.isRunning !== false
            };
          }
        })
        .catch(function(err) {
          console.warn('[QueueAdmin] Failed to load stats:', err);
        });
    }

    function fetchJobs() {
      loading = true;
      var query = '?page=' + page + '&limit=' + limit;
      if (activeTab && activeTab !== 'all' && activeTab !== 'schedules') {
        query += '&status=' + activeTab;
      }
      if (filterName) {
        query += '&name=' + encodeURIComponent(filterName);
      }
      if (searchTerm) {
        query += '&search=' + encodeURIComponent(searchTerm);
      }

      return clientApi.get(API + '/jobs' + query)
        .then(function(res) {
          loading = false;
          if (res) {
            jobs = res.jobs || [];
            totalJobs = res.total || 0;
            totalPages = res.totalPages || 1;
          }
        })
        .catch(function(err) {
          loading = false;
          error = err.message || 'Failed to load jobs';
        });
    }

    function fetchSchedules() {
      return clientApi.get(API + '/schedules')
        .then(function(res) {
          schedules = Array.isArray(res) ? res : [];
        })
        .catch(function(err) {
          console.warn('[QueueAdmin] Failed to load schedules:', err);
        });
    }

    function refreshAll() {
      return Promise.all([fetchStats(), fetchJobs(), fetchSchedules()]).then(function() {
        m.redraw();
      });
    }

    function togglePauseQueue() {
      var action = stats.isPaused ? '/resume' : '/pause';
      clientApi.post(API + action, {})
        .then(function(res) {
          setToast(stats.isPaused ? 'Queue resumed' : 'Queue paused');
          fetchStats();
        })
        .catch(function(err) {
          alert('Error changing queue state: ' + (err.message || err));
        });
    }

    function retrySingleJob(id) {
      clientApi.post(API + '/jobs/' + id + '/retry', {})
        .then(function(res) {
          setToast('Job #' + id + ' re-queued successfully');
          if (showDetailModal && inspectingJob && inspectingJob.id == id) {
            inspectingJob.status = 'pending';
            inspectingJob.error = null;
          }
          refreshAll();
        })
        .catch(function(err) {
          alert('Failed to retry job: ' + (err.message || err));
        });
    }

    function cancelSingleJob(id) {
      if (!confirm('Are you sure you want to cancel and remove Job #' + id + '?')) return;
      clientApi.post(API + '/jobs/' + id + '/cancel', {})
        .then(function(res) {
          setToast('Job #' + id + ' cancelled');
          if (showDetailModal) showDetailModal = false;
          refreshAll();
        })
        .catch(function(err) {
          alert('Failed to cancel job: ' + (err.message || err));
        });
    }

    function bulkRetry() {
      var ids = Object.keys(selectedJobIds).filter(function(k) { return selectedJobIds[k]; });
      if (ids.length === 0) return;
      if (!confirm('Re-queue ' + ids.length + ' selected job(s)?')) return;

      clientApi.post(API + '/jobs/bulk-retry', { ids: ids })
        .then(function(res) {
          setToast('Successfully re-queued ' + (res.retried || ids.length) + ' jobs');
          selectedJobIds = {};
          refreshAll();
        })
        .catch(function(err) {
          alert('Bulk retry failed: ' + (err.message || err));
        });
    }

    function purgeJobs(statusType) {
      var label = statusType === 'completed' ? 'completed jobs' : (statusType === 'failed' ? 'failed jobs' : 'completed and failed jobs');
      if (!confirm('Are you sure you want to purge all ' + label + '?')) return;

      var statuses = statusType === 'all' ? ['completed', 'failed'] : [statusType];
      clientApi.post(API + '/jobs/purge', { status: statuses })
        .then(function(res) {
          setToast(res.message || 'Jobs purged successfully');
          refreshAll();
        })
        .catch(function(err) {
          alert('Failed to purge jobs: ' + (err.message || err));
        });
    }

    function triggerSchedule(idOrName) {
      clientApi.post(API + '/schedules/' + encodeURIComponent(idOrName) + '/trigger', {})
        .then(function(res) {
          setToast('Scheduled task triggered!');
          refreshAll();
        })
        .catch(function(err) {
          alert('Failed to trigger schedule: ' + (err.message || err));
        });
    }

    function submitDispatch() {
      if (!dispatchForm.name || !dispatchForm.name.trim()) {
        alert('Please enter a job name');
        return;
      }
      var parsedData = {};
      try {
        parsedData = JSON.parse(dispatchForm.payloadStr || '{}');
      } catch (e) {
        alert('Invalid JSON in payload: ' + e.message);
        return;
      }

      var payload = {
        name: dispatchForm.name.trim(),
        data: parsedData,
        priority: Number(dispatchForm.priority) || 10,
        attempts: Number(dispatchForm.attempts) || 3,
        timeout: (Number(dispatchForm.timeoutSeconds) || 30) * 1000
      };

      if (dispatchForm.delaySeconds > 0) {
        payload.delay = Number(dispatchForm.delaySeconds) * 1000;
      }

      clientApi.post(API + '/dispatch', payload)
        .then(function(res) {
          setToast('Job dispatched successfully! (ID: ' + res.job.id + ')');
          showDispatchModal = false;
          refreshAll();
        })
        .catch(function(err) {
          alert('Failed to dispatch job: ' + (err.message || err));
        });
    }

    function getSelectedCount() {
      return Object.keys(selectedJobIds).filter(function(k) { return selectedJobIds[k]; }).length;
    }

    function toggleSelectAll(checked) {
      selectedJobIds = {};
      if (checked) {
        jobs.forEach(function(j) {
          selectedJobIds[j.id] = true;
        });
      }
    }

    return {
      oninit: function() {
        refreshAll();
        autoRefreshTimer = setInterval(function() {
          fetchStats();
          if (activeTab !== 'schedules') {
            fetchJobs();
          }
          m.redraw();
        }, autoRefreshInterval);
      },
      onremove: function() {
        if (autoRefreshTimer) {
          clearInterval(autoRefreshTimer);
          autoRefreshTimer = null;
        }
      },
      view: function() {
        var selectedCount = getSelectedCount();
        var allSelected = jobs.length > 0 && selectedCount === jobs.length;

        return m('div', { class: 'ws-queue-container', style: 'padding: 24px 0;' }, [
          // Toast Notification
          successToast ? m('div', {
            class: 'ws-toast',
            style: 'position: fixed; bottom: 24px; right: 24px; z-index: 9999; background: #0f172a; color: #f8fafc; padding: 12px 20px; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.25); display: flex; align-items: center; gap: 10px; font-weight: 500; font-size: 14px; border: 1px solid #334155;'
          }, [
            m('span', { style: 'color: #10b981; font-size: 18px;' }, '✓'),
            successToast
          ]) : null,

          // Header Row
          m('div', { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;' }, [
            m('div', [
              m('div', { style: 'display: flex; align-items: center; gap: 12px;' }, [
                m('h1', { style: 'margin: 0; font-size: 24px; font-weight: 700; color: var(--text-main, #0f172a);' }, 'Job Queue Dashboard'),
                stats.isPaused ? m('span', {
                  style: 'background: #fef3c7; color: #b45309; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; border: 1px solid #fde68a; display: inline-flex; align-items: center; gap: 4px;'
                }, [
                  m('span', { style: 'width: 6px; height: 6px; border-radius: 50%; background: #d97706;' }),
                  'PAUSED'
                ]) : m('span', {
                  style: 'background: #dcfce7; color: #15803d; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; border: 1px solid #bbf7d0; display: inline-flex; align-items: center; gap: 4px;'
                }, [
                  m('span', { style: 'width: 6px; height: 6px; border-radius: 50%; background: #22c55e;' }),
                  'ACTIVE'
                ]),
                m('span', {
                  style: 'background: rgba(148, 163, 184, 0.15); color: #64748b; font-size: 12px; font-weight: 600; padding: 4px 8px; border-radius: 6px;'
                }, 'Workers: ' + stats.activeWorkers + ' / ' + stats.concurrency)
              ]),
              m('p', { style: 'margin: 4px 0 0; color: #64748b; font-size: 14px;' }, 'Monitor background jobs, inspect payloads, view stack traces, and re-enqueue failed tasks in real-time.')
            ]),
            m('div', { style: 'display: flex; gap: 10px; align-items: center;' }, [
              m('button', {
                class: 'btn-secondary',
                onclick: togglePauseQueue,
                style: 'display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; font-size: 13px; font-weight: 600; border-radius: 6px; cursor: pointer; border: 1px solid #cbd5e1; background: #ffffff; color: #334155;'
              }, [
                m('span', stats.isPaused ? '▶ Resume' : '⏸ Pause')
              ]),
              m('button', {
                class: 'btn-secondary',
                onclick: function() { purgeJobs('completed'); },
                title: 'Purge completed jobs',
                style: 'display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; font-size: 13px; font-weight: 500; border-radius: 6px; cursor: pointer; border: 1px solid #cbd5e1; background: #ffffff; color: #64748b;'
              }, 'Purge Completed'),
              m('button', {
                class: 'btn-secondary',
                onclick: refreshAll,
                title: 'Manual Refresh',
                style: 'padding: 8px 12px; font-size: 13px; border-radius: 6px; cursor: pointer; border: 1px solid #cbd5e1; background: #ffffff; color: #334155;'
              }, '↻ Refresh'),
              m('button', {
                class: 'btn-primary',
                onclick: function() {
                  dispatchForm.name = stats.registeredJobs[0] || 'email.send';
                  dispatchForm.preset = DISPATCH_PRESETS[dispatchForm.name] ? dispatchForm.name : 'custom';
                  dispatchForm.payloadStr = JSON.stringify((DISPATCH_PRESETS[dispatchForm.preset] || DISPATCH_PRESETS['custom']).data, null, 2);
                  showDispatchModal = true;
                },
                style: 'display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 6px; cursor: pointer; background: #2563eb; color: #ffffff; border: none; box-shadow: 0 1px 2px rgba(0,0,0,0.05);'
              }, [
                m('span', { style: 'font-size: 16px; line-height: 1;' }, '+'),
                'Dispatch Job'
              ])
            ])
          ]),

          // KPI Banner Grid (5 Metric Cards)
          m('div', {
            style: 'display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px;'
          }, [
            // Pending
            m('div', {
              onclick: function() { activeTab = 'pending'; page = 1; fetchJobs(); },
              style: 'cursor: pointer; background: var(--bg-card, #ffffff); border: 1px solid ' + (activeTab === 'pending' ? '#3b82f6' : 'var(--border, #e2e8f0)') + '; border-radius: 10px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); transition: all 0.15s ease;'
            }, [
              m('div', { style: 'display: flex; justify-content: space-between; align-items: center;' }, [
                m('span', { style: 'font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;' }, 'Pending / Waiting'),
                m('span', { style: 'width: 10px; height: 10px; border-radius: 50%; background: #f59e0b;' })
              ]),
              m('div', { style: 'font-size: 28px; font-weight: 700; color: #0f172a; margin-top: 8px;' }, stats.pending - stats.delayed >= 0 ? stats.pending - stats.delayed : stats.pending),
              m('div', { style: 'font-size: 12px; color: #64748b; margin-top: 4px;' }, 'Ready for workers')
            ]),

            // Running / Active
            m('div', {
              onclick: function() { activeTab = 'running'; page = 1; fetchJobs(); },
              style: 'cursor: pointer; background: var(--bg-card, #ffffff); border: 1px solid ' + (activeTab === 'running' ? '#3b82f6' : 'var(--border, #e2e8f0)') + '; border-radius: 10px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); transition: all 0.15s ease;'
            }, [
              m('div', { style: 'display: flex; justify-content: space-between; align-items: center;' }, [
                m('span', { style: 'font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;' }, 'Running'),
                m('span', { style: 'width: 10px; height: 10px; border-radius: 50%; background: #3b82f6;' })
              ]),
              m('div', { style: 'font-size: 28px; font-weight: 700; color: #2563eb; margin-top: 8px;' }, stats.running),
              m('div', { style: 'font-size: 12px; color: #64748b; margin-top: 4px;' }, 'Active execution')
            ]),

            // Delayed / Scheduled
            m('div', {
              onclick: function() { activeTab = 'delayed'; page = 1; fetchJobs(); },
              style: 'cursor: pointer; background: var(--bg-card, #ffffff); border: 1px solid ' + (activeTab === 'delayed' ? '#3b82f6' : 'var(--border, #e2e8f0)') + '; border-radius: 10px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); transition: all 0.15s ease;'
            }, [
              m('div', { style: 'display: flex; justify-content: space-between; align-items: center;' }, [
                m('span', { style: 'font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;' }, 'Delayed / Due'),
                m('span', { style: 'width: 10px; height: 10px; border-radius: 50%; background: #8b5cf6;' })
              ]),
              m('div', { style: 'font-size: 28px; font-weight: 700; color: #7c3aed; margin-top: 8px;' }, stats.delayed),
              m('div', { style: 'font-size: 12px; color: #64748b; margin-top: 4px;' }, 'Future runAt timestamp')
            ]),

            // Completed
            m('div', {
              onclick: function() { activeTab = 'completed'; page = 1; fetchJobs(); },
              style: 'cursor: pointer; background: var(--bg-card, #ffffff); border: 1px solid ' + (activeTab === 'completed' ? '#3b82f6' : 'var(--border, #e2e8f0)') + '; border-radius: 10px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); transition: all 0.15s ease;'
            }, [
              m('div', { style: 'display: flex; justify-content: space-between; align-items: center;' }, [
                m('span', { style: 'font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;' }, 'Completed'),
                m('span', { style: 'width: 10px; height: 10px; border-radius: 50%; background: #10b981;' })
              ]),
              m('div', { style: 'font-size: 28px; font-weight: 700; color: #059669; margin-top: 8px;' }, stats.completed),
              m('div', { style: 'font-size: 12px; color: #64748b; margin-top: 4px;' }, 'Processed successfully')
            ]),

            // Failed
            m('div', {
              onclick: function() { activeTab = 'failed'; page = 1; fetchJobs(); },
              style: 'cursor: pointer; background: var(--bg-card, #ffffff); border: 1px solid ' + (activeTab === 'failed' ? '#3b82f6' : 'var(--border, #e2e8f0)') + '; border-radius: 10px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); transition: all 0.15s ease;'
            }, [
              m('div', { style: 'display: flex; justify-content: space-between; align-items: center;' }, [
                m('span', { style: 'font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;' }, 'Failed'),
                m('span', { style: 'width: 10px; height: 10px; border-radius: 50%; background: #ef4444;' })
              ]),
              m('div', { style: 'font-size: 28px; font-weight: 700; color: #dc2626; margin-top: 8px;' }, stats.failed),
              m('div', { style: 'font-size: 12px; color: #64748b; margin-top: 4px;' }, 'Max retries exceeded')
            ])
          ]),

          // Main Card Wrapper
          m('div', {
            style: 'background: var(--bg-card, #ffffff); border: 1px solid var(--border, #e2e8f0); border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.03); overflow: hidden;'
          }, [
            // Tabs Bar & Filter Header
            m('div', {
              style: 'display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border, #e2e8f0); padding: 0 20px; flex-wrap: wrap; gap: 12px;'
            }, [
              // Navigation Tabs
              m('div', { style: 'display: flex; gap: 8px;' }, [
                [
                  { id: 'all', label: 'All Jobs', count: stats.total },
                  { id: 'pending', label: 'Pending', count: (stats.pending - stats.delayed >= 0 ? stats.pending - stats.delayed : stats.pending) },
                  { id: 'running', label: 'Running', count: stats.running },
                  { id: 'delayed', label: 'Delayed', count: stats.delayed },
                  { id: 'completed', label: 'Completed', count: stats.completed },
                  { id: 'failed', label: 'Failed', count: stats.failed },
                  { id: 'schedules', label: 'Recurring Schedules', count: schedules.length }
                ].map(function(tab) {
                  var isCurrent = activeTab === tab.id;
                  return m('button', {
                    onclick: function() {
                      activeTab = tab.id;
                      page = 1;
                      selectedJobIds = {};
                      if (activeTab === 'schedules') fetchSchedules();
                      else fetchJobs();
                    },
                    style: 'padding: 14px 16px; font-size: 13px; font-weight: 600; border: none; background: transparent; cursor: pointer; border-bottom: 2px solid ' + (isCurrent ? '#2563eb' : 'transparent') + '; color: ' + (isCurrent ? '#2563eb' : '#64748b') + '; display: inline-flex; align-items: center; gap: 8px;'
                  }, [
                    tab.label,
                    m('span', {
                      style: 'background: ' + (isCurrent ? '#eff6ff' : '#f1f5f9') + '; color: ' + (isCurrent ? '#2563eb' : '#64748b') + '; padding: 2px 7px; border-radius: 999px; font-size: 11px;'
                    }, tab.count)
                  ]);
                })
              ]),

              // Filters & Search Bar
              activeTab !== 'schedules' ? m('div', { style: 'display: flex; gap: 10px; align-items: center; padding: 10px 0;' }, [
                // Registered job type filter
                m('select', {
                  value: filterName,
                  onchange: function(e) { filterName = e.target.value; page = 1; fetchJobs(); },
                  style: 'padding: 6px 12px; font-size: 13px; border: 1px solid #cbd5e1; border-radius: 6px; background: #ffffff; color: #334155;'
                }, [
                  m('option', { value: '' }, 'All Job Types'),
                  stats.registeredJobs.map(function(rn) {
                    return m('option', { value: rn }, rn);
                  })
                ]),

                // Search input
                m('input', {
                  type: 'text',
                  placeholder: 'Search ID, name, error...',
                  value: searchTerm,
                  oninput: function(e) { searchTerm = e.target.value; },
                  onkeydown: function(e) { if (e.key === 'Enter') { page = 1; fetchJobs(); } },
                  style: 'padding: 6px 12px; font-size: 13px; border: 1px solid #cbd5e1; border-radius: 6px; min-width: 220px;'
                }),
                m('button', {
                  onclick: function() { page = 1; fetchJobs(); },
                  style: 'padding: 6px 12px; font-size: 13px; font-weight: 500; border: 1px solid #cbd5e1; border-radius: 6px; background: #f8fafc; cursor: pointer;'
                }, 'Search')
              ]) : null
            ]),

            // Bulk Actions Toolbar (Conditional)
            selectedCount > 0 && activeTab !== 'schedules' ? m('div', {
              style: 'background: #eff6ff; border-bottom: 1px solid #bfdbfe; padding: 10px 20px; display: flex; justify-content: space-between; align-items: center;'
            }, [
              m('span', { style: 'font-size: 13px; font-weight: 600; color: #1e40af;' }, selectedCount + ' job(s) selected'),
              m('div', { style: 'display: flex; gap: 10px;' }, [
                m('button', {
                  onclick: bulkRetry,
                  style: 'padding: 6px 12px; font-size: 12px; font-weight: 600; background: #2563eb; color: #ffffff; border: none; border-radius: 4px; cursor: pointer;'
                }, 'Re-queue Selected'),
                m('button', {
                  onclick: function() { selectedJobIds = {}; },
                  style: 'padding: 6px 12px; font-size: 12px; background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 4px; cursor: pointer;'
                }, 'Deselect All')
              ])
            ]) : null,

            // Content Table
            activeTab === 'schedules' ? m('div', { style: 'padding: 20px;' }, [
              schedules.length === 0 ? m('div', { style: 'text-align: center; padding: 48px; color: #64748b;' }, 'No recurring schedules registered.') :
              m('table', { style: 'width: 100%; border-collapse: collapse; font-size: 13px;' }, [
                m('thead', [
                  m('tr', { style: 'border-bottom: 1px solid #e2e8f0; text-align: left; color: #64748b; font-weight: 600;' }, [
                    m('th', { style: 'padding: 12px;' }, 'Name / ID'),
                    m('th', { style: 'padding: 12px;' }, 'Cron Expression'),
                    m('th', { style: 'padding: 12px;' }, 'Next Run'),
                    m('th', { style: 'padding: 12px;' }, 'Last Run'),
                    m('th', { style: 'padding: 12px;' }, 'Runs'),
                    m('th', { style: 'padding: 12px; text-align: right;' }, 'Actions')
                  ])
                ]),
                m('tbody', schedules.map(function(s) {
                  return m('tr', { style: 'border-bottom: 1px solid #f1f5f9;' }, [
                    m('td', { style: 'padding: 12px; font-weight: 600;' }, s.name || s.id),
                    m('td', { style: 'padding: 12px;' }, m('code', { style: 'background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 12px;' }, s.cronExpression || s.expression)),
                    m('td', { style: 'padding: 12px; color: #2563eb;' }, formatRelativeTime(s.nextRun)),
                    m('td', { style: 'padding: 12px; color: #64748b;' }, formatRelativeTime(s.lastRun)),
                    m('td', { style: 'padding: 12px;' }, s.runCount || 0),
                    m('td', { style: 'padding: 12px; text-align: right;' }, [
                      m('button', {
                        onclick: function() { triggerSchedule(s.id || s.name); },
                        style: 'padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px; border: 1px solid #cbd5e1; background: #ffffff; color: #2563eb; cursor: pointer;'
                      }, '▶ Trigger Now')
                    ])
                  ]);
                }))
              ])
            ]) :
            // Jobs Table
            m('div', { style: 'overflow-x: auto;' }, [
              jobs.length === 0 ? m('div', { style: 'text-align: center; padding: 64px 20px; color: #64748b;' }, [
                m('div', { style: 'font-size: 32px; margin-bottom: 8px;' }, '📭'),
                m('div', { style: 'font-size: 16px; font-weight: 600; color: #0f172a;' }, 'No jobs found'),
                m('p', { style: 'margin: 4px 0 16px; font-size: 14px;' }, 'No background jobs match the selected filter or criteria.'),
                m('button', {
                  onclick: function() { showDispatchModal = true; },
                  style: 'padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 6px; background: #2563eb; color: #ffffff; border: none; cursor: pointer;'
                }, 'Dispatch a Job')
              ]) :
              m('table', { style: 'width: 100%; border-collapse: collapse; font-size: 13px;' }, [
                m('thead', [
                  m('tr', { style: 'border-bottom: 1px solid #e2e8f0; text-align: left; color: #64748b; font-weight: 600;' }, [
                    m('th', { style: 'padding: 12px 16px; width: 40px;' }, [
                      m('input', {
                        type: 'checkbox',
                        checked: allSelected,
                        onchange: function(e) { toggleSelectAll(e.target.checked); }
                      })
                    ]),
                    m('th', { style: 'padding: 12px 16px;' }, 'Status'),
                    m('th', { style: 'padding: 12px 16px;' }, 'Job Name & ID'),
                    m('th', { style: 'padding: 12px 16px;' }, 'Attempts'),
                    m('th', { style: 'padding: 12px 16px;' }, 'Priority'),
                    m('th', { style: 'padding: 12px 16px;' }, 'Scheduled / Run At'),
                    m('th', { style: 'padding: 12px 16px;' }, 'Created'),
                    m('th', { style: 'padding: 12px 16px; text-align: right;' }, 'Actions')
                  ])
                ]),
                m('tbody', jobs.map(function(job) {
                  var isDelayed = job.status === 'pending' && job.runAt && new Date(job.runAt) > new Date();
                  var statusColor = {
                    pending: '#f59e0b',
                    running: '#3b82f6',
                    completed: '#10b981',
                    failed: '#ef4444'
                  }[job.status] || '#64748b';

                  if (isDelayed) statusColor = '#8b5cf6';

                  var statusBg = {
                    pending: '#fef3c7',
                    running: '#eff6ff',
                    completed: '#ecfdf5',
                    failed: '#fef2f2'
                  }[job.status] || '#f1f5f9';

                  if (isDelayed) statusBg = '#f5f3ff';

                  var statusLabel = isDelayed ? 'delayed' : job.status;

                  return m('tr', {
                    key: job.id,
                    style: 'border-bottom: 1px solid #f1f5f9; transition: background 0.1s ease;'
                  }, [
                    // Checkbox
                    m('td', { style: 'padding: 12px 16px;' }, [
                      m('input', {
                        type: 'checkbox',
                        checked: !!selectedJobIds[job.id],
                        onchange: function(e) { selectedJobIds[job.id] = e.target.checked; }
                      })
                    ]),

                    // Status Badge
                    m('td', { style: 'padding: 12px 16px;' }, [
                      m('span', {
                        style: 'display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; text-transform: uppercase; background: ' + statusBg + '; color: ' + statusColor + ';'
                      }, [
                        m('span', { style: 'width: 6px; height: 6px; border-radius: 50%; background: ' + statusColor + ';' }),
                        statusLabel
                      ])
                    ]),

                    // Job Name & ID
                    m('td', { style: 'padding: 12px 16px;' }, [
                      m('div', { style: 'font-weight: 600; color: #0f172a;' }, job.name),
                      m('div', { style: 'display: flex; align-items: center; gap: 6px; margin-top: 2px;' }, [
                        m('span', { style: 'font-family: monospace; font-size: 11px; color: #64748b; background: #f1f5f9; padding: 1px 4px; border-radius: 3px;' }, '#' + job.id),
                        job.error ? m('span', {
                          style: 'color: #dc2626; font-size: 11px; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;'
                        }, '⚠️ ' + (typeof job.error === 'string' ? job.error : (job.error.message || 'Error'))) : null
                      ])
                    ]),

                    // Attempts
                    m('td', { style: 'padding: 12px 16px;' }, [
                      m('span', {
                        style: 'font-weight: 600; color: ' + (job.attempts >= job.maxAttempts && job.status === 'failed' ? '#dc2626' : '#334155') + ';'
                      }, job.attempts + ' / ' + job.maxAttempts)
                    ]),

                    // Priority
                    m('td', { style: 'padding: 12px 16px;' }, [
                      m('span', {
                        style: 'background: #f8fafc; border: 1px solid #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;'
                      }, 'P' + job.priority)
                    ]),

                    // Run At / Scheduled
                    m('td', { style: 'padding: 12px 16px; color: #475569;' }, [
                      m('div', { style: 'font-weight: 500;' }, formatRelativeTime(job.runAt)),
                      m('div', { style: 'font-size: 11px; color: #94a3b8;' }, formatDateTime(job.runAt))
                    ]),

                    // Created At
                    m('td', { style: 'padding: 12px 16px; color: #64748b; font-size: 12px;' }, formatRelativeTime(job.createdAt)),

                    // Actions
                    m('td', { style: 'padding: 12px 16px; text-align: right;' }, [
                      m('div', { style: 'display: inline-flex; gap: 6px;' }, [
                        m('button', {
                          onclick: function() {
                            inspectingJob = job;
                            showDetailModal = true;
                          },
                          title: 'Inspect Job Details & Stack Trace',
                          style: 'padding: 5px 10px; font-size: 12px; font-weight: 500; border-radius: 4px; border: 1px solid #cbd5e1; background: #ffffff; color: #334155; cursor: pointer;'
                        }, 'Inspect'),
                        m('button', {
                          onclick: function() { retrySingleJob(job.id); },
                          title: 'Re-queue job',
                          style: 'padding: 5px 10px; font-size: 12px; font-weight: 500; border-radius: 4px; border: 1px solid #cbd5e1; background: #f8fafc; color: #2563eb; cursor: pointer;'
                        }, 'Retry'),
                        m('button', {
                          onclick: function() { cancelSingleJob(job.id); },
                          title: 'Cancel / Delete Job',
                          style: 'padding: 5px 8px; font-size: 12px; border-radius: 4px; border: 1px solid #fecaca; background: #ffffff; color: #dc2626; cursor: pointer;'
                        }, '✕')
                      ])
                    ])
                  ]);
                }))
              ])
            ]),

            // Pagination Footer
            activeTab !== 'schedules' && totalPages > 1 ? m('div', {
              style: 'display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; border-top: 1px solid var(--border, #e2e8f0);'
            }, [
              m('span', { style: 'font-size: 13px; color: #64748b;' }, 'Showing page ' + page + ' of ' + totalPages + ' (' + totalJobs + ' jobs)'),
              m('div', { style: 'display: flex; gap: 6px;' }, [
                m('button', {
                  disabled: page <= 1,
                  onclick: function() { if (page > 1) { page--; fetchJobs(); } },
                  style: 'padding: 6px 12px; font-size: 12px; font-weight: 500; border: 1px solid #cbd5e1; border-radius: 4px; background: #ffffff; cursor: ' + (page <= 1 ? 'not-allowed' : 'pointer') + '; opacity: ' + (page <= 1 ? '0.5' : '1') + ';'
                }, 'Previous'),
                m('button', {
                  disabled: page >= totalPages,
                  onclick: function() { if (page < totalPages) { page++; fetchJobs(); } },
                  style: 'padding: 6px 12px; font-size: 12px; font-weight: 500; border: 1px solid #cbd5e1; border-radius: 4px; background: #ffffff; cursor: ' + (page >= totalPages ? 'not-allowed' : 'pointer') + '; opacity: ' + (page >= totalPages ? '0.5' : '1') + ';'
                }, 'Next')
              ])
            ]) : null
          ]),

          // Job Detail Modal (JSON payload & Error Stack Trace)
          showDetailModal && inspectingJob ? m('div', {
            style: 'position: fixed; inset: 0; z-index: 10000; background: rgba(15, 23, 42, 0.6); display: flex; align-items: center; justify-content: center; padding: 20px;'
          }, [
            m('div', {
              style: 'background: #ffffff; border-radius: 12px; width: 100%; max-width: 760px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); overflow: hidden;'
            }, [
              // Modal Header
              m('div', {
                style: 'padding: 16px 24px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; background: #f8fafc;'
              }, [
                m('div', [
                  m('h3', { style: 'margin: 0; font-size: 18px; font-weight: 700; color: #0f172a;' }, 'Job Details #' + inspectingJob.id),
                  m('div', { style: 'font-size: 12px; color: #64748b; margin-top: 2px;' }, 'Name: ' + inspectingJob.name + ' • Status: ' + inspectingJob.status)
                ]),
                m('button', {
                  onclick: function() { showDetailModal = false; },
                  style: 'border: none; background: transparent; font-size: 20px; color: #64748b; cursor: pointer;'
                }, '✕')
              ]),

              // Modal Body
              m('div', { style: 'padding: 24px; overflow-y: auto; flex: 1;' }, [
                // Error Alert Box (if failed)
                inspectingJob.error ? m('div', {
                  style: 'background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;'
                }, [
                  m('div', { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;' }, [
                    m('span', { style: 'font-weight: 700; color: #b91c1c; font-size: 13px;' }, '⚠️ Execution Error & Stack Trace'),
                    m('button', {
                      onclick: function() {
                        var errStr = typeof inspectingJob.error === 'string' ? inspectingJob.error : (inspectingJob.error.stack || inspectingJob.error.message || JSON.stringify(inspectingJob.error));
                        copyToClipboard(errStr, 'Error stack trace');
                      },
                      style: 'background: #ffffff; border: 1px solid #fca5a5; color: #b91c1c; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px; cursor: pointer;'
                    }, 'Copy Error')
                  ]),
                  m('pre', {
                    style: 'margin: 0; font-family: monospace; font-size: 12px; color: #991b1b; white-space: pre-wrap; word-break: break-all; background: #fff5f5; padding: 10px; border-radius: 6px; border: 1px solid #fee2e2; max-height: 200px; overflow-y: auto;'
                  }, typeof inspectingJob.error === 'string' ? inspectingJob.error : (inspectingJob.error.stack || inspectingJob.error.message || JSON.stringify(inspectingJob.error, null, 2)))
                ]) : null,

                // Metadata Key-Value Grid
                m('div', {
                  style: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 20px; background: #f8fafc; padding: 16px; border-radius: 8px; font-size: 13px;'
                }, [
                  m('div', [m('span', { style: 'color: #64748b; font-weight: 500;' }, 'Job ID: '), m('strong', inspectingJob.id)]),
                  m('div', [m('span', { style: 'color: #64748b; font-weight: 500;' }, 'Job Type: '), m('strong', inspectingJob.name)]),
                  m('div', [m('span', { style: 'color: #64748b; font-weight: 500;' }, 'Status: '), m('strong', inspectingJob.status)]),
                  m('div', [m('span', { style: 'color: #64748b; font-weight: 500;' }, 'Priority: '), m('strong', 'P' + inspectingJob.priority)]),
                  m('div', [m('span', { style: 'color: #64748b; font-weight: 500;' }, 'Attempts: '), m('strong', inspectingJob.attempts + ' / ' + inspectingJob.maxAttempts)]),
                  m('div', [m('span', { style: 'color: #64748b; font-weight: 500;' }, 'Timeout: '), m('strong', (inspectingJob.timeout / 1000) + 's')]),
                  m('div', [m('span', { style: 'color: #64748b; font-weight: 500;' }, 'Created At: '), m('strong', formatDateTime(inspectingJob.createdAt))]),
                  m('div', [m('span', { style: 'color: #64748b; font-weight: 500;' }, 'Run At: '), m('strong', formatDateTime(inspectingJob.runAt))])
                ]),

                // Payload JSON Viewer
                m('div', { style: 'margin-bottom: 20px;' }, [
                  m('div', { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;' }, [
                    m('h4', { style: 'margin: 0; font-size: 13px; font-weight: 700; color: #334155; text-transform: uppercase; letter-spacing: 0.05em;' }, 'Job Data Payload'),
                    m('button', {
                      onclick: function() { copyToClipboard(JSON.stringify(inspectingJob.data, null, 2), 'Job data payload'); },
                      style: 'background: #ffffff; border: 1px solid #cbd5e1; color: #475569; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px; cursor: pointer;'
                    }, 'Copy JSON')
                  ]),
                  m('pre', {
                    style: 'margin: 0; font-family: monospace; font-size: 12px; color: #0f172a; background: #0f172a; color: #38bdf8; padding: 14px; border-radius: 8px; max-height: 220px; overflow-y: auto;'
                  }, JSON.stringify(inspectingJob.data, null, 2))
                ]),

                // Execution Result Viewer (if available)
                inspectingJob.result ? m('div', [
                  m('div', { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;' }, [
                    m('h4', { style: 'margin: 0; font-size: 13px; font-weight: 700; color: #334155; text-transform: uppercase; letter-spacing: 0.05em;' }, 'Execution Result'),
                    m('button', {
                      onclick: function() { copyToClipboard(JSON.stringify(inspectingJob.result, null, 2), 'Result'); },
                      style: 'background: #ffffff; border: 1px solid #cbd5e1; color: #475569; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px; cursor: pointer;'
                    }, 'Copy Result')
                  ]),
                  m('pre', {
                    style: 'margin: 0; font-family: monospace; font-size: 12px; color: #10b981; background: #064e3b; padding: 14px; border-radius: 8px; max-height: 180px; overflow-y: auto;'
                  }, JSON.stringify(inspectingJob.result, null, 2))
                ]) : null
              ]),

              // Modal Footer Actions
              m('div', {
                style: 'padding: 16px 24px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; background: #f8fafc;'
              }, [
                m('button', {
                  onclick: function() { cancelSingleJob(inspectingJob.id); },
                  style: 'padding: 8px 14px; font-size: 13px; font-weight: 600; color: #dc2626; background: #fff5f5; border: 1px solid #fecaca; border-radius: 6px; cursor: pointer;'
                }, 'Delete Job'),
                m('div', { style: 'display: flex; gap: 10px;' }, [
                  m('button', {
                    onclick: function() { showDetailModal = false; },
                    style: 'padding: 8px 14px; font-size: 13px; font-weight: 600; color: #475569; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; cursor: pointer;'
                  }, 'Close'),
                  m('button', {
                    onclick: function() {
                      retrySingleJob(inspectingJob.id);
                      showDetailModal = false;
                    },
                    style: 'padding: 8px 16px; font-size: 13px; font-weight: 600; color: #ffffff; background: #2563eb; border: none; border-radius: 6px; cursor: pointer;'
                  }, '↻ Re-queue Job')
                ])
              ])
            ])
          ]) : null,

          // Manual Job Dispatch Modal
          showDispatchModal ? m('div', {
            style: 'position: fixed; inset: 0; z-index: 10000; background: rgba(15, 23, 42, 0.6); display: flex; align-items: center; justify-content: center; padding: 20px;'
          }, [
            m('div', {
              style: 'background: #ffffff; border-radius: 12px; width: 100%; max-width: 640px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1); overflow: hidden;'
            }, [
              // Header
              m('div', {
                style: 'padding: 16px 24px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; background: #f8fafc;'
              }, [
                m('h3', { style: 'margin: 0; font-size: 18px; font-weight: 700; color: #0f172a;' }, 'Dispatch New Background Job'),
                m('button', {
                  onclick: function() { showDispatchModal = false; },
                  style: 'border: none; background: transparent; font-size: 20px; color: #64748b; cursor: pointer;'
                }, '✕')
              ]),

              // Body
              m('div', { style: 'padding: 24px; overflow-y: auto; flex: 1;' }, [
                // Preset Selector
                m('div', { style: 'margin-bottom: 16px;' }, [
                  m('label', { style: 'display: block; font-size: 13px; font-weight: 600; color: #334155; margin-bottom: 6px;' }, 'Preset Template'),
                  m('select', {
                    value: dispatchForm.preset,
                    onchange: function(e) {
                      dispatchForm.preset = e.target.value;
                      var p = DISPATCH_PRESETS[dispatchForm.preset];
                      if (p) {
                        dispatchForm.name = dispatchForm.preset === 'custom' ? (stats.registeredJobs[0] || 'custom.task') : dispatchForm.preset;
                        dispatchForm.payloadStr = JSON.stringify(p.data, null, 2);
                      }
                    },
                    style: 'width: 100%; padding: 8px 12px; font-size: 13px; border: 1px solid #cbd5e1; border-radius: 6px;'
                  }, Object.keys(DISPATCH_PRESETS).map(function(k) {
                    return m('option', { value: k }, DISPATCH_PRESETS[k].label);
                  }))
                ]),

                // Job Name
                m('div', { style: 'margin-bottom: 16px;' }, [
                  m('label', { style: 'display: block; font-size: 13px; font-weight: 600; color: #334155; margin-bottom: 6px;' }, 'Job Name / Handler'),
                  m('input', {
                    type: 'text',
                    value: dispatchForm.name,
                    oninput: function(e) { dispatchForm.name = e.target.value; },
                    placeholder: 'e.g. email.send or report.generate',
                    style: 'width: 100%; padding: 8px 12px; font-size: 13px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box;'
                  })
                ]),

                // Parameters Grid (Priority, Delay, Attempts, Timeout)
                m('div', {
                  style: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 16px;'
                }, [
                  m('div', [
                    m('label', { style: 'display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 4px;' }, 'Priority (Higher runs first)'),
                    m('input', {
                      type: 'number',
                      min: 1,
                      max: 100,
                      value: dispatchForm.priority,
                      oninput: function(e) { dispatchForm.priority = e.target.value; },
                      style: 'width: 100%; padding: 6px 10px; font-size: 13px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box;'
                    })
                  ]),
                  m('div', [
                    m('label', { style: 'display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 4px;' }, 'Delay (seconds)'),
                    m('input', {
                      type: 'number',
                      min: 0,
                      value: dispatchForm.delaySeconds,
                      oninput: function(e) { dispatchForm.delaySeconds = e.target.value; },
                      placeholder: '0 = Immediate',
                      style: 'width: 100%; padding: 6px 10px; font-size: 13px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box;'
                    })
                  ]),
                  m('div', [
                    m('label', { style: 'display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 4px;' }, 'Max Attempts'),
                    m('input', {
                      type: 'number',
                      min: 1,
                      max: 10,
                      value: dispatchForm.attempts,
                      oninput: function(e) { dispatchForm.attempts = e.target.value; },
                      style: 'width: 100%; padding: 6px 10px; font-size: 13px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box;'
                    })
                  ]),
                  m('div', [
                    m('label', { style: 'display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 4px;' }, 'Timeout (seconds)'),
                    m('input', {
                      type: 'number',
                      min: 1,
                      value: dispatchForm.timeoutSeconds,
                      oninput: function(e) { dispatchForm.timeoutSeconds = e.target.value; },
                      style: 'width: 100%; padding: 6px 10px; font-size: 13px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box;'
                    })
                  ])
                ]),

                // Payload Editor
                m('div', [
                  m('label', { style: 'display: block; font-size: 13px; font-weight: 600; color: #334155; margin-bottom: 6px;' }, 'JSON Payload'),
                  m('textarea', {
                    rows: 8,
                    value: dispatchForm.payloadStr,
                    oninput: function(e) { dispatchForm.payloadStr = e.target.value; },
                    style: 'width: 100%; padding: 10px 12px; font-family: monospace; font-size: 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: #0f172a; color: #38bdf8; box-sizing: border-box;'
                  })
                ])
              ]),

              // Footer
              m('div', {
                style: 'padding: 16px 24px; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 10px; background: #f8fafc;'
              }, [
                m('button', {
                  onclick: function() { showDispatchModal = false; },
                  style: 'padding: 8px 14px; font-size: 13px; font-weight: 600; color: #475569; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; cursor: pointer;'
                }, 'Cancel'),
                m('button', {
                  onclick: submitDispatch,
                  style: 'padding: 8px 16px; font-size: 13px; font-weight: 600; color: #ffffff; background: #2563eb; border: none; border-radius: 6px; cursor: pointer;'
                }, 'Enqueue Job Now')
              ])
            ])
          ]) : null
        ]);
      }
    };
  }

  if (typeof window !== 'undefined') {
    window.QueuePage = QueuePage;
  }

  return QueuePage;
})();
`;
}

module.exports = {
  generateQueueComponent,
};

/**
 * Job Queue Admin API Handlers
 * REST endpoints for dashboard metrics, job listing, details, retrying, and dispatching
 * @module plugins/queue/api-handlers
 */

'use strict';

/**
 * Create Queue API route handlers
 * 
 * @param {import('../../core/queue/manager').QueueManager} queueManager 
 * @param {Object} [options]
 * @returns {Record<string, Function>}
 */
function createQueueApiHandlers(queueManager, options = {}) {
  if (!queueManager) {
    throw new Error('queueManager is required for createQueueApiHandlers');
  }

  /**
   * GET /stats — Real-time queue metrics
   */
  async function getStatsHandler(req, res) {
    try {
      const stats = await queueManager.getStats();
      return res.status(200).json(stats);
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to fetch queue statistics' });
    }
  }

  /**
   * GET /jobs — List jobs with status, search and pagination
   */
  async function listJobsHandler(req, res) {
    try {
      const query = {
        status: req.query.status,
        name: req.query.name,
        search: req.query.search || req.query.q,
        page: req.query.page ? parseInt(req.query.page, 10) : 1,
        limit: req.query.limit ? parseInt(req.query.limit, 10) : 20,
        sortBy: req.query.sortBy || 'createdAt',
        sortOrder: req.query.sortOrder || 'desc',
      };
      const result = await queueManager.listJobs(query);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to list jobs' });
    }
  }

  /**
   * GET /jobs/:id — Get single job details
   */
  async function getJobHandler(req, res) {
    try {
      const id = req.params.id;
      const job = await queueManager.getJob(id);
      if (!job) {
        return res.status(404).json({ error: `Job #${id} not found` });
      }
      return res.status(200).json(typeof job.toJSON === 'function' ? job.toJSON() : job);
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to get job' });
    }
  }

  /**
   * POST /jobs/:id/retry — Retry a job
   */
  async function retryJobHandler(req, res) {
    try {
      const id = req.params.id;
      const opts = req.body || {};
      const job = await queueManager.retryJob(id, opts);
      if (!job) {
        return res.status(404).json({ error: `Job #${id} not found to retry` });
      }
      return res.status(200).json({
        success: true,
        message: `Job #${id} has been re-queued for execution`,
        job: typeof job.toJSON === 'function' ? job.toJSON() : job,
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Failed to retry job' });
    }
  }

  /**
   * POST /jobs/bulk-retry — Bulk retry multiple jobs
   */
  async function bulkRetryHandler(req, res) {
    try {
      const ids = req.body?.ids || req.body?.jobIds || [];
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'ids array is required for bulk retry' });
      }
      const opts = req.body || {};
      const result = await queueManager.bulkRetry(ids, opts);
      return res.status(200).json({
        success: true,
        retried: result.retried,
        total: ids.length,
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Failed to bulk retry jobs' });
    }
  }

  /**
   * DELETE /jobs/:id (or POST /jobs/:id/cancel) — Cancel and remove a job
   */
  async function cancelJobHandler(req, res) {
    try {
      const id = req.params.id;
      const result = await queueManager.cancelJob(id);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Failed to cancel job' });
    }
  }

  /**
   * POST /jobs/purge — Purge completed and/or failed jobs
   */
  async function purgeJobsHandler(req, res) {
    try {
      const status = req.body?.status || req.query?.status || ['completed', 'failed'];
      const purgedCount = await queueManager.purgeJobs({ status });
      return res.status(200).json({
        success: true,
        purged: purgedCount,
        message: `Successfully purged ${purgedCount} jobs.`,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to purge jobs' });
    }
  }

  /**
   * POST /dispatch — Manually dispatch an ad-hoc job
   */
  async function dispatchJobHandler(req, res) {
    try {
      const { name, data, delay, delayMs, priority, attempts, timeout } = req.body || {};
      if (!name) {
        return res.status(400).json({ error: 'Job name is required' });
      }

      const job = await queueManager.dispatch(name, data || {}, {
        delay: delay !== undefined ? delay : delayMs,
        priority: priority !== undefined ? Number(priority) : undefined,
        attempts: attempts !== undefined ? Number(attempts) : undefined,
        timeout: timeout !== undefined ? timeout : undefined,
      });

      return res.status(201).json({
        success: true,
        message: `Job '${name}' (${job.id}) enqueued successfully`,
        job: typeof job.toJSON === 'function' ? job.toJSON() : job,
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Failed to dispatch job' });
    }
  }

  /**
   * POST /pause — Pause queue processing
   */
  async function pauseQueueHandler(req, res) {
    try {
      queueManager.pause();
      return res.status(200).json({
        success: true,
        isPaused: queueManager.isPaused,
        message: 'Queue processing paused',
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to pause queue' });
    }
  }

  /**
   * POST /resume — Resume queue processing
   */
  async function resumeQueueHandler(req, res) {
    try {
      queueManager.resume();
      return res.status(200).json({
        success: true,
        isPaused: queueManager.isPaused,
        message: 'Queue processing resumed',
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to resume queue' });
    }
  }

  /**
   * GET /schedules — List registered schedules (cron jobs)
   */
  async function getSchedulesHandler(req, res) {
    try {
      const schedules = queueManager.getSchedules ? queueManager.getSchedules() : [];
      return res.status(200).json(schedules);
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to list schedules' });
    }
  }

  /**
   * POST /schedules/:id/trigger — Manually trigger a scheduled job
   */
  async function triggerScheduleHandler(req, res) {
    try {
      const idOrName = req.params.id || req.body?.id;
      const job = await queueManager.triggerSchedule(idOrName);
      return res.status(200).json({
        success: true,
        message: `Scheduled task '${idOrName}' triggered successfully`,
        job: job ? (typeof job.toJSON === 'function' ? job.toJSON() : job) : null,
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Failed to trigger schedule' });
    }
  }

  return {
    getStatsHandler,
    listJobsHandler,
    getJobHandler,
    retryJobHandler,
    bulkRetryHandler,
    cancelJobHandler,
    purgeJobsHandler,
    dispatchJobHandler,
    pauseQueueHandler,
    resumeQueueHandler,
    getSchedulesHandler,
    triggerScheduleHandler,
  };
}

module.exports = {
  createQueueApiHandlers,
};

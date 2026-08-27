/**
 * Knex Database-Backed Queue Adapter
 * @module core/queue/adapters/database
 */

'use strict';

const { Job } = require('../job');

class DatabaseQueueAdapter {
  /**
   * @param {Object} options
   * @param {import('knex').Knex} options.knex - Knex instance
   * @param {string} [options.tableName='webspresso_jobs'] - Queue table name
   */
  constructor(options = {}) {
    if (!options.knex) {
      throw new Error('DatabaseQueueAdapter requires a Knex instance in options.knex');
    }
    this.knex = options.knex;
    this.tableName = options.tableName || 'webspresso_jobs';
    this._tableChecked = false;
  }

  /**
   * Ensure the jobs table exists in the database
   */
  async ensureTable() {
    if (this._tableChecked) return;

    const exists = await this.knex.schema.hasTable(this.tableName);
    if (!exists) {
      await this.knex.schema.createTable(this.tableName, (table) => {
        table.string('id').primary();
        table.string('name').notNullable().index();
        table.text('data').nullable();
        table.string('status').notNullable().defaultTo('pending').index();
        table.integer('attempts').notNullable().defaultTo(0);
        table.integer('max_attempts').notNullable().defaultTo(3);
        table.text('backoff').nullable();
        table.integer('priority').notNullable().defaultTo(10);
        table.integer('timeout').notNullable().defaultTo(30000);
        table.integer('progress').notNullable().defaultTo(0);
        table.text('result').nullable();
        table.text('error').nullable();
        table.dateTime('run_at').notNullable().index();
        table.dateTime('created_at').notNullable();
        table.dateTime('updated_at').notNullable();
      });
    }

    this._tableChecked = true;
  }

  /**
   * Enqueue a job into the database
   * @param {Job} job
   * @returns {Promise<Job>}
   */
  async enqueue(job) {
    await this.ensureTable();
    const jobInstance = job instanceof Job ? job : new Job(job);

    await this.knex(this.tableName).insert({
      id: String(jobInstance.id),
      name: jobInstance.name,
      data: JSON.stringify(jobInstance.data),
      status: jobInstance.status,
      attempts: jobInstance.attempts,
      max_attempts: jobInstance.maxAttempts,
      backoff: JSON.stringify(jobInstance.backoff),
      priority: jobInstance.priority,
      timeout: jobInstance.timeout,
      progress: jobInstance.progressValue,
      result: jobInstance.result ? JSON.stringify(jobInstance.result) : null,
      error: jobInstance.error ? (jobInstance.error.message || String(jobInstance.error)) : null,
      run_at: jobInstance.runAt,
      created_at: jobInstance.createdAt,
      updated_at: jobInstance.updatedAt,
    });

    return jobInstance;
  }

  /**
   * Dequeue next pending job
   * @param {string[]} [jobNames]
   * @returns {Promise<Job|null>}
   */
  async dequeue(jobNames = []) {
    await this.ensureTable();
    const now = new Date();

    return this.knex.transaction(async (trx) => {
      let query = trx(this.tableName)
        .where('status', 'pending')
        .where('run_at', '<=', now)
        .orderBy('priority', 'desc')
        .orderBy('run_at', 'asc')
        .limit(1);

      if (jobNames && jobNames.length > 0) {
        query = query.whereIn('name', jobNames);
      }

      // If Postgres or MySQL support forUpdate / skipLocked
      const client = this.knex.client.config.client;
      if (client === 'pg' || client === 'postgres' || client === 'mysql' || client === 'mysql2') {
        try {
          query = query.forUpdate().skipLocked();
        } catch {}
      }

      const rows = await query;
      if (!rows || rows.length === 0) return null;

      const row = rows[0];
      const nextAttempts = Number(row.attempts) + 1;
      const updatedAt = new Date();

      await trx(this.tableName)
        .where('id', row.id)
        .update({
          status: 'running',
          attempts: nextAttempts,
          updated_at: updatedAt,
        });

      return this._rowToJob({
        ...row,
        status: 'running',
        attempts: nextAttempts,
        updated_at: updatedAt,
      });
    });
  }

  /**
   * Mark job as completed
   * @param {string|number} jobId
   * @param {any} [result]
   * @returns {Promise<Job|null>}
   */
  async complete(jobId, result = null) {
    await this.ensureTable();
    const updatedAt = new Date();
    await this.knex(this.tableName)
      .where('id', String(jobId))
      .update({
        status: 'completed',
        result: result !== undefined ? JSON.stringify(result) : null,
        progress: 100,
        updated_at: updatedAt,
      });

    return this.getJob(jobId);
  }

  /**
   * Mark job as failed
   * @param {string|number} jobId
   * @param {any} [error]
   * @returns {Promise<Job|null>}
   */
  async fail(jobId, error = null) {
    await this.ensureTable();
    const updatedAt = new Date();
    const errorStr = error ? (error.message || String(error)) : null;

    await this.knex(this.tableName)
      .where('id', String(jobId))
      .update({
        status: 'failed',
        error: errorStr,
        updated_at: updatedAt,
      });

    return this.getJob(jobId);
  }

  /**
   * Reschedule job for retry
   * @param {string|number} jobId
   * @param {number} delayMs
   * @param {any} [error]
   * @returns {Promise<Job|null>}
   */
  async retry(jobId, delayMs, error = null) {
    await this.ensureTable();
    const updatedAt = new Date();
    const runAt = new Date(Date.now() + Math.max(0, delayMs));
    const errorStr = error ? (error.message || String(error)) : null;

    await this.knex(this.tableName)
      .where('id', String(jobId))
      .update({
        status: 'pending',
        run_at: runAt,
        error: errorStr,
        updated_at: updatedAt,
      });

    return this.getJob(jobId);
  }

  /**
   * Get job by ID
   * @param {string|number} jobId
   * @returns {Promise<Job|null>}
   */
  async getJob(jobId) {
    await this.ensureTable();
    const row = await this.knex(this.tableName).where('id', String(jobId)).first();
    if (!row) return null;
    return this._rowToJob(row);
  }

  /**
   * Get stats summary
   * @returns {Promise<{ pending: number, running: number, completed: number, failed: number, total: number }>}
   */
  async getStats() {
    await this.ensureTable();
    const rows = await this.knex(this.tableName)
      .select('status')
      .count('* as count')
      .groupBy('status');

    const stats = { pending: 0, running: 0, completed: 0, failed: 0, total: 0 };
    for (const r of rows) {
      const count = Number(r.count || r.COUNT || 0);
      if (r.status in stats) {
        stats[r.status] = count;
      }
      stats.total += count;
    }

    return stats;
  }

  /**
   * Clear all jobs from table
   * @returns {Promise<void>}
   */
  async clear() {
    await this.ensureTable();
    await this.knex(this.tableName).del();
  }

  /**
   * Convert DB row to Job instance
   * @private
   */
  _rowToJob(row) {
    let data = {};
    try { data = JSON.parse(row.data); } catch {}

    let backoff = { type: 'exponential', delay: 1000 };
    try { if (row.backoff) backoff = JSON.parse(row.backoff); } catch {}

    let result = null;
    try { if (row.result) result = JSON.parse(row.result); } catch {}

    return new Job({
      id: row.id,
      name: row.name,
      data,
      status: row.status,
      attempts: Number(row.attempts),
      maxAttempts: Number(row.max_attempts),
      backoff,
      priority: Number(row.priority),
      timeout: Number(row.timeout),
      progress: Number(row.progress),
      result,
      error: row.error,
      runAt: row.run_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}

module.exports = { DatabaseQueueAdapter };

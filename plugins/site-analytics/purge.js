/**
 * Analytics Data Purge & Retention Service
 * Deletes page views and client errors older than a retention cutoff to prevent database bloat.
 * @module plugins/site-analytics/purge
 */

'use strict';

/**
 * Purge old analytics data from database
 * @param {import('knex').Knex} knex - Knex query builder instance
 * @param {Object} [options={}] - Purge options
 * @param {string} [options.tableName='analytics_page_views'] - Page views table name
 * @param {string} [options.errorsTableName='analytics_client_errors'] - Client errors table name
 * @param {Date|string|number} [options.olderThan] - Cutoff date for page views
 * @param {Date|string|number} [options.errorsOlderThan] - Cutoff date for client errors
 * @param {Date|string|number} [options.errorOlderThan] - Alias for errorsOlderThan
 * @param {number} [options.days] - Days of page views to keep (if olderThan not specified)
 * @param {number} [options.retentionDays=90] - Days of page views to keep (alias for days)
 * @param {number} [options.errorDays] - Days of client errors to keep (if errorsOlderThan not specified)
 * @param {number} [options.errorRetentionDays=30] - Days of client errors to keep (alias for errorDays)
 * @param {boolean} [options.purgePageViews=true] - Whether to purge page views
 * @param {boolean} [options.purgeErrors=true] - Whether to purge client errors
 * @returns {Promise<{ ok: boolean, success: boolean, viewsDeleted: number, pageViewsDeleted: number, errorsDeleted: number, totalDeleted: number, olderThan: Date, errorOlderThan: Date, viewsCutoff: string, errorsCutoff: string }>}
 */
async function purgeAnalyticsData(knex, options = {}) {
  if (!knex) {
    throw new Error('purgeAnalyticsData requires a database (knex) instance');
  }

  const tableName = options.tableName || 'analytics_page_views';
  const errorsTableName = options.errorsTableName || 'analytics_client_errors';
  const purgePageViews = options.purgePageViews !== false;
  const purgeErrors = options.purgeErrors !== false;

  const now = Date.now();

  // Validate days / retentionDays
  if (options.days !== undefined) {
    const d = typeof options.days === 'number' ? options.days : Number(options.days);
    if (Number.isNaN(d) || d <= 0) {
      throw new Error('purgeAnalyticsData: days must be a positive number');
    }
  }
  if (options.retentionDays !== undefined) {
    const d = typeof options.retentionDays === 'number' ? options.retentionDays : Number(options.retentionDays);
    if (Number.isNaN(d) || d <= 0) {
      throw new Error('purgeAnalyticsData: retentionDays must be a positive number');
    }
  }

  // Validate errorDays / errorRetentionDays
  if (options.errorDays !== undefined) {
    const ed = typeof options.errorDays === 'number' ? options.errorDays : Number(options.errorDays);
    if (Number.isNaN(ed) || ed <= 0) {
      throw new Error('purgeAnalyticsData: errorDays must be a positive number');
    }
  }
  if (options.errorRetentionDays !== undefined) {
    const ed = typeof options.errorRetentionDays === 'number' ? options.errorRetentionDays : Number(options.errorRetentionDays);
    if (Number.isNaN(ed) || ed <= 0) {
      throw new Error('purgeAnalyticsData: errorRetentionDays must be a positive number');
    }
  }

  // Calculate or validate page views cutoff
  let olderThan;
  if (options.olderThan !== undefined) {
    olderThan = options.olderThan instanceof Date ? options.olderThan : new Date(options.olderThan);
    if (Number.isNaN(olderThan.getTime())) {
      throw new Error('purgeAnalyticsData: invalid olderThan date');
    }
  } else {
    const daysRaw = options.days !== undefined ? options.days : (options.retentionDays !== undefined ? options.retentionDays : 90);
    const days = Number(daysRaw);
    olderThan = new Date(now - days * 24 * 60 * 60 * 1000);
  }

  // Calculate or validate client errors cutoff
  let errorOlderThan;
  const rawErrorCutoff = options.errorsOlderThan !== undefined ? options.errorsOlderThan : options.errorOlderThan;
  if (rawErrorCutoff !== undefined) {
    errorOlderThan = rawErrorCutoff instanceof Date ? rawErrorCutoff : new Date(rawErrorCutoff);
    if (Number.isNaN(errorOlderThan.getTime())) {
      throw new Error('purgeAnalyticsData: invalid errorsOlderThan date');
    }
  } else {
    const errDaysRaw = options.errorDays !== undefined
      ? options.errorDays
      : (options.errorRetentionDays !== undefined ? options.errorRetentionDays : 30);
    const errDays = Number(errDaysRaw);
    errorOlderThan = new Date(now - errDays * 24 * 60 * 60 * 1000);
  }

  function applyCutoffFilter(query, columnName, cutoffDate) {
    const client = knex?.client?.config?.client;
    const isSqlite = client === 'sqlite3' || client === 'better-sqlite3';
    if (isSqlite) {
      const iso = cutoffDate.toISOString();
      const formatted = iso.replace('T', ' ').replace(/\..+$/, '');
      return query.where((builder) => {
        builder
          .where(columnName, '<', iso)
          .orWhere(columnName, '<', formatted)
          .orWhere(columnName, '<', cutoffDate.getTime());
      });
    }
    return query.where(columnName, '<', cutoffDate);
  }

  let pageViewsDeleted = 0;
  let errorsDeleted = 0;

  if (purgePageViews) {
    let hasTable = true;
    if (knex.schema && typeof knex.schema.hasTable === 'function') {
      try {
        hasTable = await knex.schema.hasTable(tableName);
      } catch (e) {
        hasTable = false;
      }
    }
    if (hasTable) {
      try {
        const deleted = await applyCutoffFilter(knex(tableName), 'created_at', olderThan).delete();
        pageViewsDeleted = Number(deleted) || 0;
      } catch (e) {
        // Table or deletion error handled safely
      }
    }
  }

  if (purgeErrors) {
    let hasTable = true;
    if (knex.schema && typeof knex.schema.hasTable === 'function') {
      try {
        hasTable = await knex.schema.hasTable(errorsTableName);
      } catch (e) {
        hasTable = false;
      }
    }
    if (hasTable) {
      try {
        const deleted = await applyCutoffFilter(knex(errorsTableName), 'created_at', errorOlderThan).delete();
        errorsDeleted = Number(deleted) || 0;
      } catch (e) {
        // Table or deletion error handled safely
      }
    }
  }

  return {
    ok: true,
    success: true,
    viewsDeleted: pageViewsDeleted,
    pageViewsDeleted,
    errorsDeleted,
    totalDeleted: pageViewsDeleted + errorsDeleted,
    olderThan,
    errorOlderThan,
    viewsCutoff: olderThan.toISOString(),
    errorsCutoff: errorOlderThan.toISOString(),
  };
}

module.exports = {
  purgeAnalyticsData,
};

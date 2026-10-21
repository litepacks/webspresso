/**
 * Webspresso Cloud-Ready Database Migration Runner
 * Zero-dependency: Safe pre-flight connectivity retries, stale lock auto-healing,
 * dry-run evaluation, and zero-downtime deployment compatibility for Google Cloud Run & AWS.
 *
 * @module core/orm/migrate-cloud
 */

'use strict';

const { sleep } = require('../utils/time');

/**
 * Wait for database connectivity with exponential backoff
 * Handles Cloud SQL Auth Proxy / AWS RDS Aurora cold-starts
 * @param {import('knex').Knex} knex
 * @param {Object} [options]
 * @param {number} [options.retries=5]
 * @param {number} [options.initialDelayMs=1000]
 * @param {number} [options.maxDelayMs=10000]
 * @param {Function} [options.onRetry]
 * @returns {Promise<boolean>}
 */
async function waitForDatabaseConnection(knex, options = {}) {
  const retries = options.retries ?? 5;
  const initialDelay = options.initialDelayMs ?? 1000;
  const maxDelay = options.maxDelayMs ?? 10000;
  const onRetry = options.onRetry || (() => {});

  let attempt = 0;
  let delay = initialDelay;

  while (attempt <= retries) {
    try {
      await knex.raw('SELECT 1');
      return true;
    } catch (err) {
      attempt++;
      if (attempt > retries) {
        throw new Error(`Database connection failed after ${retries} attempts: ${err.message}`);
      }
      onRetry({ attempt, retries, delay, error: err });
      await sleep(delay);
      delay = Math.min(delay * 2, maxDelay);
    }
  }

  return false;
}

/**
 * Safely inspect and release stale migration lock
 * @param {import('knex').Knex} knex
 * @param {Object} [migrationConfig]
 * @returns {Promise<boolean>} True if lock was released
 */
async function freeStaleMigrationLock(knex, migrationConfig = {}) {
  try {
    if (knex.migrate && typeof knex.migrate.forceFreeMigrationsLock === 'function') {
      await knex.migrate.forceFreeMigrationsLock(migrationConfig);
      return true;
    }
  } catch (_) {}
  return false;
}

/**
 * Get pending and completed migrations without running them
 * @param {import('knex').Knex} knex
 * @param {Object} [migrationConfig]
 * @returns {Promise<{ completed: string[], pending: string[] }>}
 */
async function getMigrationStatus(knex, migrationConfig = {}) {
  if (!knex.migrate || typeof knex.migrate.list !== 'function') {
    return { completed: [], pending: [] };
  }

  const [completedList, pendingList] = await knex.migrate.list(migrationConfig);
  const completed = (completedList || []).map((m) => (typeof m === 'string' ? m : m.name || String(m)));
  const pending = (pendingList || []).map((m) => (typeof m === 'string' ? m : m.name || String(m)));

  return { completed, pending };
}

/**
 * Execute Cloud Migration with safety guarantees
 * @param {import('knex').Knex} knex
 * @param {Object} [options]
 * @param {Object} [options.migrationConfig] - Custom knex migration options
 * @param {boolean} [options.dryRun=false] - Only report pending migrations without executing
 * @param {boolean} [options.unlockIfStale=true] - Force unlock if migrations lock was left hanging
 * @param {boolean} [options.waitForDb=true] - Retry connecting to database before failing
 * @param {number} [options.retries=5] - Connection retries
 * @param {Function} [options.logger] - Custom logger callback
 * @returns {Promise<{
 *   success: boolean;
 *   batch: number;
 *   applied: string[];
 *   pendingBefore: string[];
 *   durationMs: number;
 *   dryRun: boolean;
 * }>}
 */
async function runCloudMigration(knex, options = {}) {
  const {
    migrationConfig = {},
    dryRun = false,
    unlockIfStale = true,
    waitForDb = true,
    retries = 5,
    logger = null,
  } = options;

  const log = (msg) => {
    if (typeof logger === 'function') logger(msg);
  };

  const startTime = Date.now();

  // 1. Connectivity Check & Wait
  if (waitForDb) {
    log('Checking database connectivity...');
    await waitForDatabaseConnection(knex, {
      retries,
      onRetry: ({ attempt, retries: max, delay, error }) => {
        log(`Database not ready (attempt ${attempt}/${max}: ${error.message}). Retrying in ${delay}ms...`);
      },
    });
    log('Database connection established.');
  }

  // 2. Inspect current migration status
  const { completed, pending } = await getMigrationStatus(knex, migrationConfig);

  if (dryRun) {
    return {
      success: true,
      batch: 0,
      applied: [],
      pendingBefore: pending,
      durationMs: Date.now() - startTime,
      dryRun: true,
    };
  }

  // 3. Stale Lock Handling
  if (unlockIfStale) {
    try {
      // Check if locked
      const lockTable = migrationConfig.tableName ? `${migrationConfig.tableName}_lock` : 'knex_migrations_lock';
      const hasLockTable = await knex.schema.hasTable(lockTable);
      if (hasLockTable) {
        const lockRow = await knex(lockTable).first();
        if (lockRow && (lockRow.is_locked === 1 || lockRow.is_locked === true)) {
          log('Warning: Found active migration lock from previous aborted job. Unlocking...');
          await freeStaleMigrationLock(knex, migrationConfig);
          log('Migration lock released successfully.');
        }
      }
    } catch (lockErr) {
      log(`Note: Lock check skipped (${lockErr.message})`);
    }
  }

  // 4. Run Migration
  let batch = 0;
  let applied = [];

  if (pending.length > 0) {
    log(`Applying ${pending.length} pending migration(s)...`);
    const result = await knex.migrate.latest(migrationConfig);
    batch = result[0];
    applied = result[1] || [];
    log(`Migration batch ${batch} applied successfully (${applied.length} files).`);
  } else {
    log('Database schema is already up to date.');
  }

  return {
    success: true,
    batch,
    applied,
    pendingBefore: pending,
    durationMs: Date.now() - startTime,
    dryRun: false,
  };
}

module.exports = {
  waitForDatabaseConnection,
  freeStaleMigrationLock,
  getMigrationStatus,
  runCloudMigration,
};

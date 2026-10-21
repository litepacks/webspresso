/**
 * Serverless & Container Database Connection Pool Management
 * Optimizes Knex pool configurations for Google Cloud Run, AWS Lambda/Fargate,
 * and autoscaling container workloads to prevent database socket exhaustion.
 * @module core/orm/pool
 */

'use strict';

/**
 * Detect if running in a serverless or auto-scaling container environment
 * @param {Record<string, string>} [env=process.env]
 * @returns {{ isServerless: boolean, platform: 'cloudrun'|'aws-lambda'|'ecs'|'serverless'|'standard' }}
 */
function isServerlessEnvironment(env = process.env) {
  if (env.K_SERVICE || env.K_REVISION || env.CLOUD_RUN_JOB) {
    return { isServerless: true, platform: 'cloudrun' };
  }
  if (env.AWS_LAMBDA_FUNCTION_NAME) {
    return { isServerless: true, platform: 'aws-lambda' };
  }
  if (env.AWS_EXECUTION_ENV && !env.AWS_LAMBDA_FUNCTION_NAME) {
    return { isServerless: true, platform: 'ecs' };
  }
  if (env.SERVERLESS === 'true' || env.WEBSPRESSO_SERVERLESS === 'true' || env.CONTAINER_SCALE === 'true') {
    return { isServerless: true, platform: 'serverless' };
  }
  return { isServerless: false, platform: 'standard' };
}

/**
 * Normalize and apply serverless pool protections to Knex configuration
 * @param {Object} knexConfig
 * @param {Object|Record<string, string>} [optionsOrEnv]
 * @returns {Object} Normalized Knex configuration
 */
function normalizeServerlessPoolConfig(knexConfig = {}, optionsOrEnv = {}) {
  // Determine if optionsOrEnv is an environment map or options object
  const env = optionsOrEnv && optionsOrEnv.env ? optionsOrEnv.env : (
    (optionsOrEnv.K_SERVICE || optionsOrEnv.K_REVISION || optionsOrEnv.CLOUD_RUN_JOB || optionsOrEnv.AWS_LAMBDA_FUNCTION_NAME || optionsOrEnv.AWS_EXECUTION_ENV || optionsOrEnv.SERVERLESS || optionsOrEnv.WEBSPRESSO_SERVERLESS || optionsOrEnv.CONTAINER_SCALE || optionsOrEnv.NODE_ENV)
      ? optionsOrEnv
      : process.env
  );
  const explicitOptions = typeof optionsOrEnv === 'object' && !optionsOrEnv.NODE_ENV ? optionsOrEnv : {};

  const client = knexConfig.client || 'sqlite3';
  // SQLite and Cloudflare D1 don't use external TCP connection pools
  if (client === 'better-sqlite3' || client === 'sqlite3' || knexConfig.d1) {
    return knexConfig;
  }

  const { isServerless, platform } = isServerlessEnvironment(env);
  const userPool = knexConfig.pool || {};

  // Check if serverless pool optimization should be applied
  const isExplicitlyRequested = Boolean(
    knexConfig.serverlessPool === true ||
    userPool.serverless === true ||
    env.WEBSPRESSO_SERVERLESS_POOL === 'true'
  );

  const isAutoEnabled = isServerless && knexConfig.serverlessPool !== false && userPool.serverless !== false;

  if (!isExplicitlyRequested && !isAutoEnabled) {
    return knexConfig;
  }

  // Serverless pool defaults:
  // In serverless, idle containers shouldn't hold open DB connections: min: 0
  const serverlessMin = explicitOptions.min ?? (userPool.min !== undefined ? userPool.min : 0);

  // Max connections per container instance should be small (default: 2 for Lambda, 5 for Cloud Run/containers)
  const defaultMax = isServerless && platform === 'aws-lambda' ? 2 : 5;
  const serverlessMax = explicitOptions.max ?? (userPool.max !== undefined ? userPool.max : defaultMax);

  const normalizedPool = {
    ...userPool,
    min: serverlessMin,
    max: serverlessMax,
    idleTimeoutMillis: explicitOptions.idleTimeoutMillis ?? userPool.idleTimeoutMillis ?? 30000,
    acquireTimeoutMillis: explicitOptions.acquireTimeoutMillis ?? userPool.acquireTimeoutMillis ?? 10000,
    createTimeoutMillis: explicitOptions.createTimeoutMillis ?? userPool.createTimeoutMillis ?? 5000,
    destroyTimeoutMillis: explicitOptions.destroyTimeoutMillis ?? userPool.destroyTimeoutMillis ?? 5000,
    propagateCreateError: userPool.propagateCreateError ?? false,
    serverless: true,
  };

  return {
    ...knexConfig,
    pool: normalizedPool,
  };
}

module.exports = {
  isServerlessEnvironment,
  normalizeServerlessPoolConfig,
};

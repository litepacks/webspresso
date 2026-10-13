/**
 * API Key Model
 * Webspresso ORM model definition for API keys
 * @module plugins/api-key/model
 */

'use strict';

const { defineModel } = require('../../core/orm/model');
const { zdb } = require('../../core/orm');

/**
 * Create and return the ApiKey ORM Model definition
 * 
 * @param {string} [tableName='api_keys']
 * @returns {import('../../core/orm/types').ModelDefinition}
 */
function createApiKeyModel(tableName = 'api_keys') {
  const ApiKeySchema = zdb.schema({
    id: zdb.id(),
    name: zdb.string({ maxLength: 255 }),
    key_hash: zdb.string({ unique: true, maxLength: 64 }),
    key_hint: zdb.string({ maxLength: 64 }),
    prefix: zdb.string({ maxLength: 32, default: 'wsp_live_' }),
    user_id: zdb.integer({ nullable: true }),
    scopes: zdb.json({ nullable: true }),
    rate_limit: zdb.integer({ nullable: true }),
    metadata: zdb.json({ nullable: true }),
    expires_at: zdb.timestamp({ nullable: true }),
    last_used_at: zdb.timestamp({ nullable: true }),
    revoked_at: zdb.timestamp({ nullable: true }),
    created_at: zdb.timestamp({ auto: 'create' }),
    updated_at: zdb.timestamp({ auto: 'update' }),
  });

  return defineModel({
    name: 'ApiKey',
    table: tableName,
    schema: ApiKeySchema,
    scopes: {
      timestamps: true,
      active: (query) => query.whereNull('revoked_at'),
    },
    hidden: ['key_hash'], // Never expose SHA-256 hash in JSON responses
  });
}

module.exports = {
  createApiKeyModel,
};

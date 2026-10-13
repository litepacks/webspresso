/**
 * Webhooks ORM Models
 * Webspresso ORM model definitions for WebhookEndpoint and WebhookDelivery
 * @module plugins/webhooks/models
 */

'use strict';

const { defineModel } = require('../../core/orm/model');
const { zdb } = require('../../core/orm');

/**
 * Create WebhookEndpoint model definition
 * 
 * @param {string} [tableName='webhook_endpoints']
 * @returns {import('../../core/orm/types').ModelDefinition}
 */
function createWebhookEndpointModel(tableName = 'webhook_endpoints') {
  const schema = zdb.schema({
    id: zdb.id(),
    name: zdb.string({ maxLength: 255 }),
    url: zdb.string({ maxLength: 2048 }),
    secret: zdb.string({ maxLength: 255 }),
    events: zdb.text({ default: '["*"]' }),
    is_active: zdb.boolean({ default: true }),
    description: zdb.string({ maxLength: 1000, nullable: true }),
    headers: zdb.json({ nullable: true }),
    metadata: zdb.json({ nullable: true }),
    created_at: zdb.timestamp({ auto: 'create' }),
    updated_at: zdb.timestamp({ auto: 'update' }),
  });

  return defineModel({
    name: 'WebhookEndpoint',
    table: tableName,
    schema,
    scopes: {
      timestamps: true,
      active: (query) => query.where('is_active', true),
    },
    hidden: ['secret'], // Protect signing secret from serialization leaks
    relations: {
      deliveries: {
        type: 'hasMany',
        model: () => 'WebhookDelivery',
        foreignKey: 'endpoint_id',
      },
    },
  });
}

/**
 * Create WebhookDelivery model definition
 * 
 * @param {string} [tableName='webhook_deliveries']
 * @returns {import('../../core/orm/types').ModelDefinition}
 */
function createWebhookDeliveryModel(tableName = 'webhook_deliveries') {
  const schema = zdb.schema({
    id: zdb.id(),
    endpoint_id: zdb.integer(),
    event: zdb.string({ maxLength: 255 }),
    payload: zdb.text(),
    status_code: zdb.integer({ nullable: true }),
    success: zdb.boolean({ default: false }),
    duration_ms: zdb.integer({ nullable: true }),
    error: zdb.text({ nullable: true }),
    response_body: zdb.text({ nullable: true }),
    attempt: zdb.integer({ default: 1 }),
    max_attempts: zdb.integer({ default: 3 }),
    next_retry_at: zdb.timestamp({ nullable: true }),
    created_at: zdb.timestamp({ auto: 'create' }),
    updated_at: zdb.timestamp({ auto: 'update' }),
  });

  return defineModel({
    name: 'WebhookDelivery',
    table: tableName,
    schema,
    scopes: {
      timestamps: true,
      successful: (query) => query.where('success', true),
      failed: (query) => query.where('success', false),
    },
    relations: {
      endpoint: {
        type: 'belongsTo',
        model: () => 'WebhookEndpoint',
        foreignKey: 'endpoint_id',
      },
    },
  });
}

module.exports = {
  createWebhookEndpointModel,
  createWebhookDeliveryModel,
};

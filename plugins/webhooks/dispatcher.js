/**
 * Webhook Dispatcher Engine
 * Manages webhook endpoints, event matching, background delivery, retries, and history
 * @module plugins/webhooks/dispatcher
 */

'use strict';

const EventEmitter = require('events');
const crypto = require('crypto');
const { randomTimestampedId } = require('../../core/utils/crypto');
const { generateSecret } = require('./crypto');
const { matchesAnyEvent, normalizeEvents } = require('./matcher');
const { sendWebhook } = require('./sender');
const { safeJsonParse } = require('../../core/utils/json');

/**
 * Generate a standard unique delivery identifier
 * @returns {string}
 */
function generateDeliveryId() {
  if (typeof crypto.randomUUID === 'function') {
    return `dlv_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return randomTimestampedId('dlv', 8);
}

class WebhookDispatcher extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {any} [options.db] - Webspresso database or Knex instance
   * @param {any} [options.knex] - Knex instance
   * @param {string} [options.endpointsTable='webhook_endpoints']
   * @param {string} [options.deliveriesTable='webhook_deliveries']
   * @param {number} [options.maxAttempts=3] - Maximum retry attempts
   * @param {number} [options.backoffBaseMs=1000] - Base delay for exponential backoff (ms)
   * @param {number} [options.timeoutMs=10000] - Request timeout (ms)
   * @param {boolean} [options.wrapPayload=true] - Wrap data in standard event envelope
   * @param {any} [options.queue] - Webspresso QueueManager instance
   * @param {Array<Object>} [options.endpoints] - Static in-memory endpoints
   * @param {any} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    super();
    this.options = options;
    this.db = options.db || null;
    this.knex = options.knex || (this.db && this.db.knex) || (typeof this.db === 'function' ? this.db : null);
    this.endpointsTable = options.endpointsTable || 'webhook_endpoints';
    this.deliveriesTable = options.deliveriesTable || 'webhook_deliveries';
    this.maxAttempts = typeof options.maxAttempts === 'number' ? options.maxAttempts : 3;
    this.backoffBaseMs = typeof options.backoffBaseMs === 'number' ? options.backoffBaseMs : 1000;
    const defaultWebhookTimeout = options.timeouts?.webhook || 10000;
    this.timeoutMs = typeof options.timeoutMs === 'number'
      ? options.timeoutMs
      : (typeof options.timeout === 'number' ? options.timeout : defaultWebhookTimeout);
    this.wrapPayload = options.wrapPayload !== undefined ? options.wrapPayload : true;
    this.queue = options.queue || null;
    this.logger = options.logger || console;
    this._staticEndpoints = Array.isArray(options.endpoints) ? [...options.endpoints] : null;
    this._activeTimers = new Set();
  }

  /**
   * Resolve Knex query builder
   * @returns {any}
   */
  resolveKnex() {
    return this.knex || (this.db && this.db.knex) || (typeof this.db === 'function' ? this.db : null);
  }

  /**
   * Set or update queue manager
   * @param {any} queue 
   */
  setQueue(queue) {
    this.queue = queue;
  }

  /**
   * Cleanup any pending in-memory retry timers on shutdown
   */
  dispose() {
    for (const timer of this._activeTimers) {
      clearTimeout(timer);
    }
    this._activeTimers.clear();
  }

  // ---------------------------------------------------------------------------
  // Endpoints CRUD
  // ---------------------------------------------------------------------------

  /**
   * Retrieve active endpoints that subscribe to a given event
   * 
   * @param {string} eventName 
   * @returns {Promise<Array<Object>>}
   */
  async getEndpointsForEvent(eventName) {
    if (this._staticEndpoints) {
      return this._staticEndpoints.filter((ep) => {
        const isActive = ep.is_active !== false && ep.active !== false;
        return isActive && matchesAnyEvent(ep.events, eventName);
      });
    }

    const kx = this.resolveKnex();
    if (!kx) {
      return [];
    }

    const rows = await kx(this.endpointsTable).where({ is_active: true });
    return rows.filter((ep) => matchesAnyEvent(ep.events, eventName));
  }

  /**
   * List all webhook endpoints
   * 
   * @param {Object} [filters]
   * @param {boolean} [filters.active]
   * @param {string} [filters.search]
   * @param {number} [filters.limit]
   * @param {number} [filters.offset]
   * @returns {Promise<Array<Object>>}
   */
  async listEndpoints(filters = {}) {
    if (this._staticEndpoints) {
      let list = [...this._staticEndpoints];
      if (filters.active !== undefined) {
        list = list.filter((ep) => (ep.is_active !== false) === !!filters.active);
      }
      if (filters.search) {
        const q = filters.search.toLowerCase();
        list = list.filter((ep) => (ep.name && ep.name.toLowerCase().includes(q)) || (ep.url && ep.url.toLowerCase().includes(q)));
      }
      return list;
    }

    const kx = this.resolveKnex();
    if (!kx) return [];

    let query = kx(this.endpointsTable).select('*');
    if (filters.active !== undefined) {
      query = query.where({ is_active: !!filters.active });
    }
    if (filters.search) {
      query = query.where((q) => {
        q.where('name', 'like', `%${filters.search}%`)
         .orWhere('url', 'like', `%${filters.search}%`);
      });
    }
    query = query.orderBy('created_at', 'desc');
    if (filters.limit) query = query.limit(filters.limit);
    if (filters.offset) query = query.offset(filters.offset);

    return query;
  }

  /**
   * Get an endpoint by ID
   * 
   * @param {number|string} id 
   * @returns {Promise<Object|null>}
   */
  async getEndpoint(id) {
    if (this._staticEndpoints) {
      return this._staticEndpoints.find((ep) => String(ep.id) === String(id)) || null;
    }

    const kx = this.resolveKnex();
    if (!kx) return null;
    const ep = await kx(this.endpointsTable).where({ id }).first();
    if (ep && typeof ep.metadata === 'string') {
      // metadata is a JSON column (zdb.json); expose it as an object like the model does
      ep.metadata = safeJsonParse(ep.metadata, null);
    }
    return ep || null;
  }

  /**
   * Create a new webhook endpoint
   * 
   * @param {Object} data 
   * @returns {Promise<Object>}
   */
  async createEndpoint(data) {
    if (!data.name || typeof data.name !== 'string') {
      throw new Error('Endpoint name is required.');
    }
    if (!data.url || typeof data.url !== 'string') {
      throw new Error('Endpoint URL is required.');
    }

    const secret = data.secret || generateSecret();
    const eventsList = normalizeEvents(data.events);

    const record = {
      name: data.name.trim(),
      url: data.url.trim(),
      secret,
      events: JSON.stringify(eventsList),
      is_active: data.is_active !== undefined ? !!data.is_active : (data.active !== undefined ? !!data.active : true),
      description: data.description || null,
      headers: data.headers ? (typeof data.headers === 'string' ? data.headers : JSON.stringify(data.headers)) : null,
      metadata: data.metadata ? (typeof data.metadata === 'string' ? data.metadata : JSON.stringify(data.metadata)) : null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    if (this._staticEndpoints) {
      record.id = this._staticEndpoints.length + 1;
      this._staticEndpoints.push(record);
      return record;
    }

    const kx = this.resolveKnex();
    if (!kx) {
      record.id = 1;
      return record;
    }

    const insertRes = await kx(this.endpointsTable).insert(record);
    let insertedId = 1;
    if (Array.isArray(insertRes) && insertRes.length > 0) {
      insertedId = typeof insertRes[0] === 'object' && insertRes[0] !== null ? insertRes[0].id : insertRes[0];
    } else if (typeof insertRes === 'number') {
      insertedId = insertRes;
    }
    record.id = insertedId;
    return record;
  }

  /**
   * Update an existing webhook endpoint
   * 
   * @param {number|string} id 
   * @param {Object} data 
   * @returns {Promise<Object|null>}
   */
  async updateEndpoint(id, data) {
    const updatePayload = {
      updated_at: new Date(),
    };

    if (data.name !== undefined) updatePayload.name = String(data.name).trim();
    if (data.url !== undefined) updatePayload.url = String(data.url).trim();
    if (data.secret !== undefined) updatePayload.secret = String(data.secret);
    if (data.events !== undefined) updatePayload.events = JSON.stringify(normalizeEvents(data.events));
    if (data.is_active !== undefined) updatePayload.is_active = !!data.is_active;
    if (data.active !== undefined) updatePayload.is_active = !!data.active;
    if (data.description !== undefined) updatePayload.description = data.description;
    if (data.headers !== undefined) {
      updatePayload.headers = data.headers ? (typeof data.headers === 'string' ? data.headers : JSON.stringify(data.headers)) : null;
    }
    if (data.metadata !== undefined) {
      updatePayload.metadata = data.metadata ? (typeof data.metadata === 'string' ? data.metadata : JSON.stringify(data.metadata)) : null;
    }

    if (this._staticEndpoints) {
      const idx = this._staticEndpoints.findIndex((ep) => String(ep.id) === String(id));
      if (idx === -1) return null;
      // In-memory endpoints keep metadata as an object (only the DB column stores JSON text)
      const staticPayload = { ...updatePayload };
      if (data.metadata !== undefined) {
        staticPayload.metadata = typeof data.metadata === 'string'
          ? safeJsonParse(data.metadata, null)
          : (data.metadata || null);
      }
      this._staticEndpoints[idx] = { ...this._staticEndpoints[idx], ...staticPayload };
      return this._staticEndpoints[idx];
    }

    const kx = this.resolveKnex();
    if (!kx) return null;

    const rowsUpdated = await kx(this.endpointsTable).where({ id }).update(updatePayload);
    if (rowsUpdated === 0) return null;

    return this.getEndpoint(id);
  }

  /**
   * Delete a webhook endpoint
   * 
   * @param {number|string} id 
   * @returns {Promise<boolean>}
   */
  async deleteEndpoint(id) {
    if (this._staticEndpoints) {
      const initialLen = this._staticEndpoints.length;
      this._staticEndpoints = this._staticEndpoints.filter((ep) => String(ep.id) !== String(id));
      return this._staticEndpoints.length < initialLen;
    }

    const kx = this.resolveKnex();
    if (!kx) return false;

    // Delete associated deliveries first
    await kx(this.deliveriesTable).where({ endpoint_id: id }).delete();
    const rowsDeleted = await kx(this.endpointsTable).where({ id }).delete();
    return rowsDeleted > 0;
  }

  // ---------------------------------------------------------------------------
  // Webhook Dispatch & Execution
  // ---------------------------------------------------------------------------

  /**
   * Dispatch an event to all subscribed webhook endpoints
   * 
   * @param {string} event - Event name (e.g. 'order.created')
   * @param {any} payload - Event data payload
   * @param {Object} [options]
   * @param {boolean} [options.wait=false] - Whether to await all HTTP deliveries before returning
   * @param {number} [options.endpointId] - Limit dispatch to a specific endpoint
   * @returns {Promise<{ dispatched: number, deliveries: Array<Object> }>}
   */
  async dispatch(event, payload, options = {}) {
    if (!event || typeof event !== 'string') {
      throw new Error('Event name must be a non-empty string.');
    }

    let endpoints = await this.getEndpointsForEvent(event);
    if (options.endpointId) {
      endpoints = endpoints.filter((ep) => String(ep.id) === String(options.endpointId));
    }

    if (endpoints.length === 0) {
      return { dispatched: 0, deliveries: [] };
    }

    const kx = this.resolveKnex();
    const deliveries = [];
    const executionPromises = [];

    for (const endpoint of endpoints) {
      const deliveryId = generateDeliveryId();
      const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

      const deliveryRecord = {
        endpoint_id: endpoint.id,
        event,
        payload: payloadStr,
        status_code: null,
        success: false,
        duration_ms: null,
        error: null,
        response_body: null,
        attempt: 1,
        max_attempts: this.maxAttempts,
        next_retry_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      if (kx) {
        try {
          const insertRes = await kx(this.deliveriesTable).insert(deliveryRecord);
          let dbId = deliveryId;
          if (Array.isArray(insertRes) && insertRes.length > 0) {
            dbId = typeof insertRes[0] === 'object' && insertRes[0] !== null ? insertRes[0].id : insertRes[0];
          } else if (typeof insertRes === 'number') {
            dbId = insertRes;
          }
          deliveryRecord.id = dbId;
        } catch (dbErr) {
          deliveryRecord.id = deliveryId;
        }
      } else {
        deliveryRecord.id = deliveryId;
      }

      deliveries.push(deliveryRecord);

      // Determine dispatch mechanism: Queue vs In-process
      if (this.queue && typeof this.queue.dispatch === 'function') {
        const queuePromise = this.queue.dispatch('webhooks.deliver', {
          deliveryId: deliveryRecord.id,
          endpointId: endpoint.id,
          event,
          payload,
          attempt: 1,
        }, {
          attempts: this.maxAttempts,
          backoff: { type: 'exponential', delay: this.backoffBaseMs },
          timeout: this.timeoutMs,
        });
        executionPromises.push(queuePromise);
      } else {
        const execPromise = this.executeDelivery({
          endpoint,
          deliveryId: deliveryRecord.id,
          event,
          payload,
          attempt: 1,
        });
        executionPromises.push(execPromise);
      }
    }

    this.emit('dispatched', { event, count: endpoints.length, endpoints: endpoints.map((e) => e.id) });

    if (options.wait) {
      const results = await Promise.allSettled(executionPromises);
      return {
        dispatched: endpoints.length,
        deliveries,
        results: results.map((r) => (r.status === 'fulfilled' ? r.value : { error: r.reason?.message })),
      };
    }

    return { dispatched: endpoints.length, deliveries };
  }

  /**
   * Execute single HTTP delivery to an endpoint
   * 
   * @param {Object} params
   * @param {Object} params.endpoint
   * @param {number|string} params.deliveryId
   * @param {string} params.event
   * @param {any} params.payload
   * @param {number} [params.attempt=1]
   * @param {boolean} [params.autoRetry=true]
   * @returns {Promise<Object>}
   */
  async executeDelivery(params) {
    const {
      endpoint,
      deliveryId,
      event,
      payload,
      attempt = 1,
      autoRetry = true,
    } = params;

    const res = await sendWebhook({
      url: endpoint.url,
      event,
      payload,
      secret: endpoint.secret,
      deliveryId: String(deliveryId),
      headers: endpoint.headers,
      timeoutMs: this.timeoutMs,
      wrapPayload: this.wrapPayload,
    });

    const kx = this.resolveKnex();
    const updateData = {
      status_code: res.statusCode || null,
      success: !!res.success,
      duration_ms: res.durationMs,
      error: res.error || null,
      response_body: res.responseBody || null,
      attempt,
      updated_at: new Date(),
    };

    let willRetry = false;
    let nextRetryAt = null;

    if (!res.success && attempt < this.maxAttempts) {
      willRetry = true;
      const delayMs = this.backoffBaseMs * Math.pow(2, attempt - 1);
      nextRetryAt = new Date(Date.now() + delayMs);
      updateData.next_retry_at = nextRetryAt;

      // In-process retry timer if no queue is managing it
      if (autoRetry && !this.queue) {
        const timer = setTimeout(() => {
          this._activeTimers.delete(timer);
          this.executeDelivery({
            endpoint,
            deliveryId,
            event,
            payload,
            attempt: attempt + 1,
            autoRetry: true,
          }).catch((err) => {
            if (this.listenerCount('error') > 0) {
              this.emit('error', err);
            } else {
              console.error('[webhooks] Delivery retry failed:', err?.message || err);
            }
          });
        }, delayMs);
        if (timer.unref) timer.unref();
        this._activeTimers.add(timer);
      }
    } else {
      updateData.next_retry_at = null;
    }

    if (kx && deliveryId) {
      try {
        await kx(this.deliveriesTable).where({ id: deliveryId }).update(updateData);
      } catch (dbErr) {
        // Log or handle gracefully
      }
    }

    const outcome = {
      deliveryId,
      endpointId: endpoint.id,
      event,
      attempt,
      success: res.success,
      statusCode: res.statusCode,
      durationMs: res.durationMs,
      error: res.error,
      willRetry,
      nextRetryAt,
      responseBody: res.responseBody || null,
      headers: res.requestHeaders || {},
      body: res.bodyStr || null,
    };

    if (res.success) {
      this.emit('delivered', outcome);
    } else {
      this.emit('failed', outcome);
    }

    return outcome;
  }

  /**
   * Manually retry a specific delivery
   * 
   * @param {number|string} deliveryId 
   * @returns {Promise<Object>}
   */
  async retryDelivery(deliveryId) {
    const kx = this.resolveKnex();
    if (!kx) {
      throw new Error('Database connection required to retry delivery.');
    }

    const delivery = await kx(this.deliveriesTable).where({ id: deliveryId }).first();
    if (!delivery) {
      throw new Error(`Delivery #${deliveryId} not found.`);
    }

    const endpoint = await this.getEndpoint(delivery.endpoint_id);
    if (!endpoint) {
      throw new Error(`Target endpoint #${delivery.endpoint_id} no longer exists.`);
    }

    const parsedPayload = safeJsonParse(delivery.payload, delivery.payload);

    const nextAttempt = (delivery.attempt || 1) + 1;
    return this.executeDelivery({
      endpoint,
      deliveryId,
      event: delivery.event,
      payload: parsedPayload,
      attempt: nextAttempt,
      autoRetry: false,
    });
  }

  /**
   * Send a test webhook with custom event and payload to an endpoint
   * 
   * @param {number|string} endpointId 
   * @param {Object} [options]
   * @param {string} [options.event='ping']
   * @param {any} [options.payload]
   * @param {Object} [options.headers]
   * @returns {Promise<Object>}
   */
  async testEndpoint(endpointId, options = {}) {
    const endpoint = await this.getEndpoint(endpointId);
    if (!endpoint) {
      throw new Error(`Endpoint #${endpointId} not found.`);
    }

    const event = options.event || 'ping';
    const payload = options.payload !== undefined ? options.payload : {
      ping: true,
      message: 'Webspresso Webhook ping test',
      timestamp: new Date().toISOString(),
      endpoint: {
        id: endpoint.id,
        name: endpoint.name,
      },
    };

    const deliveryId = generateDeliveryId();
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const kx = this.resolveKnex();

    const deliveryRecord = {
      endpoint_id: endpoint.id,
      event,
      payload: payloadStr,
      status_code: null,
      success: false,
      duration_ms: null,
      error: null,
      response_body: null,
      attempt: 1,
      max_attempts: 1,
      next_retry_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    if (kx) {
      try {
        const insertRes = await kx(this.deliveriesTable).insert(deliveryRecord);
        let dbId = deliveryId;
        if (Array.isArray(insertRes) && insertRes.length > 0) {
          dbId = typeof insertRes[0] === 'object' && insertRes[0] !== null ? insertRes[0].id : insertRes[0];
        } else if (typeof insertRes === 'number') {
          dbId = insertRes;
        }
        deliveryRecord.id = dbId;
      } catch (err) {
        deliveryRecord.id = deliveryId;
      }
    } else {
      deliveryRecord.id = deliveryId;
    }

    const outcome = await this.executeDelivery({
      endpoint,
      deliveryId: deliveryRecord.id,
      event,
      payload,
      attempt: 1,
      autoRetry: false,
      headers: options.headers,
    });

    return {
      ...outcome,
      deliveryRecordId: deliveryRecord.id,
      event,
      payload,
    };
  }

  /**
   * Send a test ping webhook to an endpoint (backward-compatible alias)
   * 
   * @param {number|string} endpointId 
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async pingEndpoint(endpointId, options = {}) {
    return this.testEndpoint(endpointId, options);
  }

  /**
   * Rotate signing secret for an endpoint with grace metadata
   * 
   * @param {number|string} endpointId 
   * @param {Object} [options]
   * @param {string} [options.prefix='whsec_']
   * @returns {Promise<{ success: boolean, endpointId: any, secret: string, previousSecret: string, rotatedAt: string, endpoint: Object }>}
   */
  async rotateSecret(endpointId, options = {}) {
    const endpoint = await this.getEndpoint(endpointId);
    if (!endpoint) {
      throw new Error(`Endpoint #${endpointId} not found.`);
    }

    const prefix = options.prefix || 'whsec_';
    const newSecret = generateSecret(prefix);
    const previousSecret = endpoint.secret;
    const rotatedAt = new Date().toISOString();

    let meta = {};
    if (typeof endpoint.metadata === 'string') {
      meta = safeJsonParse(endpoint.metadata, {});
    } else if (typeof endpoint.metadata === 'object' && endpoint.metadata !== null) {
      meta = { ...endpoint.metadata };
    }
    meta.previous_secret = previousSecret;
    meta.secret_rotated_at = rotatedAt;

    const updated = await this.updateEndpoint(endpointId, {
      secret: newSecret,
      metadata: meta,
    });

    return {
      success: true,
      endpointId: endpoint.id,
      secret: newSecret,
      previousSecret,
      rotatedAt,
      endpoint: updated,
    };
  }

  /**
   * Replay an existing delivery, optionally overriding payload or event
   * 
   * @param {number|string} deliveryId 
   * @param {Object} [options]
   * @param {any} [options.payload]
   * @param {string} [options.event]
   * @param {number|string} [options.endpointId]
   * @returns {Promise<Object>}
   */
  async replayDelivery(deliveryId, options = {}) {
    const kx = this.resolveKnex();
    if (!kx) {
      throw new Error('Database connection required to replay delivery.');
    }

    const original = await kx(this.deliveriesTable).where({ id: deliveryId }).first();
    if (!original) {
      throw new Error(`Delivery #${deliveryId} not found.`);
    }

    const targetEndpointId = options.endpointId || original.endpoint_id;
    const endpoint = await this.getEndpoint(targetEndpointId);
    if (!endpoint) {
      throw new Error(`Target endpoint #${targetEndpointId} no longer exists.`);
    }

    const event = options.event || original.event;
    const payload = options.payload !== undefined
      ? options.payload
      : safeJsonParse(original.payload, original.payload);

    const newDeliveryId = generateDeliveryId();
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

    const newRecord = {
      endpoint_id: endpoint.id,
      event,
      payload: payloadStr,
      status_code: null,
      success: false,
      duration_ms: null,
      error: null,
      response_body: null,
      attempt: 1,
      max_attempts: 1,
      next_retry_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    let savedId = newDeliveryId;
    try {
      const insertRes = await kx(this.deliveriesTable).insert(newRecord);
      if (Array.isArray(insertRes) && insertRes.length > 0) {
        savedId = typeof insertRes[0] === 'object' && insertRes[0] !== null ? insertRes[0].id : insertRes[0];
      } else if (typeof insertRes === 'number') {
        savedId = insertRes;
      }
    } catch (e) {
      // fallback to generated ID
    }

    const outcome = await this.executeDelivery({
      endpoint,
      deliveryId: savedId,
      event,
      payload,
      attempt: 1,
      autoRetry: false,
    });

    return {
      ...outcome,
      replayedFromId: deliveryId,
      deliveryId: savedId,
    };
  }

  /**
   * Bulk retry multiple failed delivery records
   * 
   * @param {Array<number|string>} deliveryIds 
   * @returns {Promise<{ total: number, succeeded: number, failed: number, items: Array<Object> }>}
   */
  async bulkRetryDeliveries(deliveryIds = []) {
    if (!Array.isArray(deliveryIds) || deliveryIds.length === 0) {
      return { total: 0, succeeded: 0, failed: 0, items: [] };
    }

    const results = [];
    let succeeded = 0;
    let failed = 0;

    for (const id of deliveryIds) {
      try {
        const res = await this.retryDelivery(id);
        if (res.success) {
          succeeded++;
        } else {
          failed++;
        }
        results.push({ id, ...res });
      } catch (err) {
        failed++;
        results.push({ id, success: false, error: err.message });
      }
    }

    return {
      total: deliveryIds.length,
      succeeded,
      failed,
      items: results,
    };
  }

  // ---------------------------------------------------------------------------
  // Delivery Logs & Stats
  // ---------------------------------------------------------------------------

  /**
   * List delivery logs with pagination & filtering
   * 
   * @param {Object} [filters]
   * @param {number|string} [filters.endpointId]
   * @param {string} [filters.event]
   * @param {string} [filters.search]
   * @param {boolean} [filters.success]
   * @param {number} [filters.page=1]
   * @param {number} [filters.limit=25]
   * @returns {Promise<{ items: Array<Object>, total: number, page: number, limit: number, pages: number }>}
   */
  async listDeliveries(filters = {}) {
    const kx = this.resolveKnex();
    if (!kx) {
      return { items: [], total: 0, page: 1, limit: 25, pages: 0 };
    }

    const page = Math.max(1, parseInt(filters.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(filters.limit, 10) || 25));
    const offset = (page - 1) * limit;

    let baseQuery = kx(this.deliveriesTable);
    const epId = filters.endpointId || filters.endpoint_id;
    if (epId) {
      baseQuery = baseQuery.where({ endpoint_id: epId });
    }
    if (filters.event) {
      baseQuery = baseQuery.where('event', 'like', `%${filters.event}%`);
    }
    if (filters.success !== undefined && filters.success !== null && filters.success !== '') {
      baseQuery = baseQuery.where({ success: filters.success === true || filters.success === 'true' });
    }
    const search = filters.search || filters.q;
    if (search && String(search).trim()) {
      const q = String(search).trim();
      baseQuery = baseQuery.where((builder) => {
        builder.where('event', 'like', `%${q}%`)
          .orWhere('payload', 'like', `%${q}%`)
          .orWhere('error', 'like', `%${q}%`);
      });
    }

    const countRes = await baseQuery.clone().count({ count: '*' });
    let total = 0;
    if (Array.isArray(countRes) && countRes.length > 0) {
      total = parseInt(countRes[0].count || countRes[0]['count(*)'] || 0, 10);
    }

    const items = await baseQuery
      .clone()
      .select('*')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    return {
      items,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  /**
   * Get single delivery record by ID
   * 
   * @param {number|string} id 
   * @returns {Promise<Object|null>}
   */
  async getDelivery(id) {
    const kx = this.resolveKnex();
    if (!kx) return null;
    const row = await kx(this.deliveriesTable).where({ id }).first();
    return row || null;
  }

  /**
   * Compute comprehensive webhook statistics
   * 
   * @returns {Promise<{
   *   totalEndpoints: number,
   *   activeEndpoints: number,
   *   totalDeliveries: number,
   *   successfulDeliveries: number,
   *   failedDeliveries: number,
   *   successRate: number,
   *   avgDurationMs: number
   * }>}
   */
  async getStats() {
    const kx = this.resolveKnex();
    if (!kx) {
      const eps = this._staticEndpoints || [];
      return {
        totalEndpoints: eps.length,
        activeEndpoints: eps.filter((e) => e.is_active !== false).length,
        totalDeliveries: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        successRate: 100,
        avgDurationMs: 0,
      };
    }

    try {
      const [epCount] = await kx(this.endpointsTable).count({ count: '*' });
      const [activeEpCount] = await kx(this.endpointsTable).where({ is_active: true }).count({ count: '*' });
      
      const totalEndpoints = parseInt(epCount?.count || 0, 10);
      const activeEndpoints = parseInt(activeEpCount?.count || 0, 10);

      const dlvStats = await kx(this.deliveriesTable)
        .select(
          kx.raw('COUNT(*) as total'),
          kx.raw('SUM(CASE WHEN success = 1 OR success = true THEN 1 ELSE 0 END) as successful'),
          kx.raw('AVG(duration_ms) as avg_duration')
        );

      const totalDeliveries = parseInt(dlvStats[0]?.total || 0, 10);
      const successfulDeliveries = parseInt(dlvStats[0]?.successful || 0, 10);
      const failedDeliveries = totalDeliveries - successfulDeliveries;
      const successRate = totalDeliveries > 0 ? Math.round((successfulDeliveries / totalDeliveries) * 100) : 100;
      const avgDurationMs = Math.round(parseFloat(dlvStats[0]?.avg_duration || 0));

      return {
        totalEndpoints,
        activeEndpoints,
        totalDeliveries,
        successfulDeliveries,
        failedDeliveries,
        successRate,
        avgDurationMs,
      };
    } catch (e) {
      return {
        totalEndpoints: 0,
        activeEndpoints: 0,
        totalDeliveries: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        successRate: 100,
        avgDurationMs: 0,
      };
    }
  }

  /**
   * Purge old delivery logs
   * 
   * @param {Object} [options]
   * @param {number} [options.days=30]
   * @returns {Promise<number>} Number of deleted rows
   */
  async purgeDeliveries(options = {}) {
    const kx = this.resolveKnex();
    if (!kx) return 0;

    const days = typeof options.days === 'number' ? options.days : 30;
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const deleted = await kx(this.deliveriesTable)
      .where('created_at', '<', cutoffDate)
      .delete();

    return deleted;
  }
}

module.exports = {
  WebhookDispatcher,
  generateDeliveryId,
};

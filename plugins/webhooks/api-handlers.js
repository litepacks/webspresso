/**
 * Webhooks Admin API Handlers
 * REST endpoints for managing endpoints, inspecting delivery history, pinging, and retrying
 * @module plugins/webhooks/api-handlers
 */

'use strict';

/**
 * Create Webhook API route handlers
 * 
 * @param {import('./dispatcher').WebhookDispatcher} dispatcher 
 * @param {Object} [options]
 * @returns {Record<string, Function>}
 */
function createWebhookApiHandlers(dispatcher, options = {}) {
  /**
   * GET /endpoints — List all webhook endpoints
   */
  async function listEndpointsHandler(req, res) {
    try {
      const active = req.query.active !== undefined ? req.query.active === 'true' : undefined;
      const search = req.query.search || req.query.q || undefined;
      const endpoints = await dispatcher.listEndpoints({ active, search });

      // Enrich with delivery counts if knex available
      const kx = dispatcher.resolveKnex();
      let enriched = endpoints;
      if (kx && endpoints.length > 0) {
        try {
          const stats = await kx(dispatcher.deliveriesTable)
            .select('endpoint_id')
            .count('* as total_deliveries')
            .sum({ success_count: kx.raw('CASE WHEN success = 1 OR success = true THEN 1 ELSE 0 END') })
            .groupBy('endpoint_id');

          const statsMap = new Map();
          for (const s of stats) {
            statsMap.set(String(s.endpoint_id), {
              totalDeliveries: Number(s.total_deliveries || 0),
              successCount: Number(s.success_count || 0),
            });
          }

          enriched = endpoints.map((ep) => {
            const st = statsMap.get(String(ep.id)) || { totalDeliveries: 0, successCount: 0 };
            return {
              ...ep,
              stats: {
                total: st.totalDeliveries,
                successful: st.successCount,
                failed: st.totalDeliveries - st.successCount,
                successRate: st.totalDeliveries > 0 ? Math.round((st.successCount / st.totalDeliveries) * 100) : 100,
              },
            };
          });
        } catch (statsErr) {
          // Fallback if aggregation fails
        }
      }

      return res.status(200).json({
        items: enriched,
        total: enriched.length,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to list webhook endpoints' });
    }
  }

  /**
   * POST /endpoints — Create new endpoint
   */
  async function createEndpointHandler(req, res) {
    try {
      const body = req.body || {};
      if (!body.name || !body.url) {
        return res.status(400).json({ error: 'Endpoint name and URL are required.' });
      }

      const created = await dispatcher.createEndpoint(body);
      return res.status(201).json(created);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Failed to create webhook endpoint' });
    }
  }

  /**
   * GET /endpoints/:id — Get endpoint details
   */
  async function getEndpointHandler(req, res) {
    try {
      const id = req.params.id;
      const endpoint = await dispatcher.getEndpoint(id);
      if (!endpoint) {
        return res.status(404).json({ error: `Webhook endpoint #${id} not found` });
      }
      return res.status(200).json(endpoint);
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to get webhook endpoint' });
    }
  }

  /**
   * PUT/PATCH /endpoints/:id — Update endpoint
   */
  async function updateEndpointHandler(req, res) {
    try {
      const id = req.params.id;
      const body = req.body || {};
      const updated = await dispatcher.updateEndpoint(id, body);
      if (!updated) {
        return res.status(404).json({ error: `Webhook endpoint #${id} not found` });
      }
      return res.status(200).json(updated);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Failed to update webhook endpoint' });
    }
  }

  /**
   * DELETE /endpoints/:id — Delete endpoint
   */
  async function deleteEndpointHandler(req, res) {
    try {
      const id = req.params.id;
      const deleted = await dispatcher.deleteEndpoint(id);
      if (!deleted) {
        return res.status(404).json({ error: `Webhook endpoint #${id} not found` });
      }
      return res.status(200).json({ success: true, message: `Endpoint #${id} deleted.` });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to delete webhook endpoint' });
    }
  }

  /**
   * POST /endpoints/:id/ping or POST /endpoints/:id/test — Send test webhook / ping
   */
  async function pingEndpointHandler(req, res) {
    try {
      const id = req.params.id;
      const result = await dispatcher.pingEndpoint(id);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Failed to ping webhook endpoint' });
    }
  }

  /**
   * POST /endpoints/:id/test — Send test webhook with custom event/payload
   */
  async function testEndpointHandler(req, res) {
    try {
      const id = req.params.id;
      const opts = req.body || {};
      const result = await dispatcher.testEndpoint(id, opts);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Failed to test webhook endpoint' });
    }
  }

  /**
   * POST /endpoints/:id/rotate-secret — Rotate HMAC signing secret
   */
  async function rotateSecretHandler(req, res) {
    try {
      const id = req.params.id;
      const opts = req.body || {};
      const result = await dispatcher.rotateSecret(id, opts);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Failed to rotate secret' });
    }
  }

  /**
   * GET /deliveries — List delivery logs
   */
  async function listDeliveriesHandler(req, res) {
    try {
      const endpointId = req.query.endpointId || req.query.endpoint_id;
      const event = req.query.event;
      const search = req.query.search || req.query.q;
      const success = req.query.success;
      const page = req.query.page;
      const limit = req.query.limit || req.query.perPage;

      const data = await dispatcher.listDeliveries({
        endpointId,
        event,
        search,
        success,
        page,
        limit,
      });

      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to list webhook deliveries' });
    }
  }

  /**
   * GET /deliveries/:id — Get single delivery log
   */
  async function getDeliveryHandler(req, res) {
    try {
      const id = req.params.id;
      const item = await dispatcher.getDelivery(id);
      if (!item) {
        return res.status(404).json({ error: `Webhook delivery #${id} not found` });
      }
      return res.status(200).json(item);
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to get webhook delivery' });
    }
  }

  /**
   * POST /deliveries/:id/retry — Retry failed delivery
   */
  async function retryDeliveryHandler(req, res) {
    try {
      const id = req.params.id;
      const result = await dispatcher.retryDelivery(id);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Failed to retry webhook delivery' });
    }
  }

  /**
   * POST /deliveries/:id/replay — Replay delivery with optional edited payload/event
   */
  async function replayDeliveryHandler(req, res) {
    try {
      const id = req.params.id;
      const opts = req.body || {};
      const result = await dispatcher.replayDelivery(id, opts);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Failed to replay webhook delivery' });
    }
  }

  /**
   * POST /deliveries/bulk-retry — Bulk retry multiple delivery IDs
   */
  async function bulkRetryDeliveriesHandler(req, res) {
    try {
      const ids = req.body?.ids || req.body?.deliveryIds || [];
      const result = await dispatcher.bulkRetryDeliveries(ids);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Failed to bulk retry webhook deliveries' });
    }
  }

  /**
   * GET /stats — Global webhook metrics
   */
  async function getStatsHandler(req, res) {
    try {
      const stats = await dispatcher.getStats();
      return res.status(200).json(stats);
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to fetch webhook statistics' });
    }
  }

  /**
   * POST /deliveries/purge — Purge old deliveries
   */
  async function purgeDeliveriesHandler(req, res) {
    try {
      const days = parseInt(req.body?.days || req.query?.days, 10) || 30;
      const purgedCount = await dispatcher.purgeDeliveries({ days });
      return res.status(200).json({
        success: true,
        purged: purgedCount,
        message: `Purged ${purgedCount} webhook deliveries older than ${days} days.`,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to purge webhook deliveries' });
    }
  }

  return {
    listEndpointsHandler,
    createEndpointHandler,
    getEndpointHandler,
    updateEndpointHandler,
    deleteEndpointHandler,
    pingEndpointHandler,
    testEndpointHandler,
    rotateSecretHandler,
    listDeliveriesHandler,
    getDeliveryHandler,
    retryDeliveryHandler,
    replayDeliveryHandler,
    bulkRetryDeliveriesHandler,
    getStatsHandler,
    purgeDeliveriesHandler,
  };
}

module.exports = {
  createWebhookApiHandlers,
};

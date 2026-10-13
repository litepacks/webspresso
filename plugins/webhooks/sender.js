/**
 * Webhook Sender Module
 * Zero-dependency HTTP/HTTPS delivery using native fetch with signatures & timeouts
 * @module plugins/webhooks/sender
 */

'use strict';

const crypto = require('crypto');
const { signPayload } = require('./crypto');

/**
 * Send a webhook HTTP request to a target endpoint
 * 
 * @param {Object} options
 * @param {string} options.url - Destination URL
 * @param {string} options.event - Event name (e.g. 'order.created')
 * @param {any} options.payload - Event payload data
 * @param {string} [options.secret] - Signing secret
 * @param {string} [options.deliveryId] - Unique delivery ID
 * @param {Object} [options.headers] - Custom headers to merge
 * @param {number} [options.timeoutMs=10000] - Request timeout in milliseconds
 * @param {boolean} [options.wrapPayload=true] - Wrap data in standard event envelope
 * @param {number} [options.maxResponseBodyLength=2048] - Max response length to store
 * @returns {Promise<{
 *   success: boolean,
 *   statusCode: number,
 *   responseBody: string,
 *   durationMs: number,
 *   error: string|null,
 *   deliveryId: string,
 *   timestamp: number
 * }>}
 */
async function sendWebhook(options) {
  const {
    url,
    event,
    payload,
    secret,
    deliveryId = crypto.randomUUID ? crypto.randomUUID() : `dlv_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
    headers: customHeaders = {},
    timeoutMs = 10000,
    wrapPayload = true,
    maxResponseBodyLength = 2048,
  } = options;

  if (!url || typeof url !== 'string') {
    return {
      success: false,
      statusCode: 0,
      responseBody: '',
      durationMs: 0,
      error: 'Invalid webhook URL: destination URL is required.',
      deliveryId,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  const timestamp = Math.floor(Date.now() / 1000);

  // Construct request body
  let bodyObj = payload;
  if (wrapPayload && (typeof payload !== 'object' || payload === null || !payload.event)) {
    bodyObj = {
      id: deliveryId,
      event,
      timestamp,
      data: payload,
    };
  }
  const bodyStr = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);

  // Calculate cryptographic signatures if secret is configured
  let signatureHeaders = {};
  if (secret) {
    const { signature, timestampedSignature } = signPayload(bodyStr, secret, { timestamp });
    signatureHeaders = {
      'x-webspresso-signature': signature,
      'x-hub-signature-256': signature,
      'webhook-signature': timestampedSignature,
    };
  }

  // Parse custom headers if stored as JSON string
  let parsedCustomHeaders = {};
  if (typeof customHeaders === 'string') {
    try {
      parsedCustomHeaders = JSON.parse(customHeaders);
    } catch (e) {
      parsedCustomHeaders = {};
    }
  } else if (typeof customHeaders === 'object' && customHeaders !== null) {
    parsedCustomHeaders = customHeaders;
  }

  const requestHeaders = {
    'content-type': 'application/json',
    'accept': 'application/json, text/plain, */*',
    'user-agent': 'Webspresso-Webhooks/1.0',
    'x-webspresso-event': event,
    'x-webspresso-delivery': deliveryId,
    'x-webspresso-timestamp': String(timestamp),
    'webhook-id': deliveryId,
    'webhook-timestamp': String(timestamp),
    ...signatureHeaders,
    ...parsedCustomHeaders,
  };

  const startTime = Date.now();
  let controller = null;
  let timeoutId = null;

  try {
    controller = new AbortController();
    timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    const response = await fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: bodyStr,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const durationMs = Date.now() - startTime;

    let responseBody = '';
    try {
      const rawText = await response.text();
      responseBody = rawText ? rawText.slice(0, maxResponseBodyLength) : '';
    } catch (textErr) {
      responseBody = '';
    }

    const success = response.status >= 200 && response.status < 300;
    const error = success ? null : `HTTP ${response.status}: ${response.statusText || 'Delivery Failed'}`;

    return {
      success,
      statusCode: response.status,
      responseBody,
      durationMs,
      error,
      deliveryId,
      timestamp,
      bodyStr,
    };
  } catch (err) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    const durationMs = Date.now() - startTime;
    const isTimeout = err.name === 'AbortError' || err.code === 'ABORT_ERR';
    const errorMsg = isTimeout
      ? `Webhook delivery timed out after ${timeoutMs}ms`
      : (err.message || 'Network error');

    return {
      success: false,
      statusCode: 0,
      responseBody: '',
      durationMs,
      error: errorMsg,
      deliveryId,
      timestamp,
      bodyStr,
    };
  }
}

module.exports = {
  sendWebhook,
};

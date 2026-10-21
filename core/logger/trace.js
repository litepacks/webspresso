/**
 * Trace Context Extraction & Parsing for Distributed Cloud Tracing
 * Supports GCP Cloud Trace (x-cloud-trace-context), AWS X-Ray (x-amzn-trace-id), W3C (traceparent), and x-request-id
 * @module core/logger/trace
 */

'use strict';

const crypto = require('crypto');

/**
 * @typedef {Object} TraceContext
 * @property {string} traceId
 * @property {string|null} [spanId]
 * @property {boolean} sampled
 * @property {string|null} [raw]
 * @property {string} [platform]
 */

/**
 * Parse GCP x-cloud-trace-context header
 * Format: TRACE_ID[/SPAN_ID][;o=TRACE_TRUE]
 * @param {string} header
 * @returns {TraceContext|null}
 */
function parseGcpTraceContext(header) {
  if (!header || typeof header !== 'string') return null;

  const match = header.match(/^([a-f0-9]+)(?:\/([0-9a-f]+))?(?:;o=([01]))?$/i);
  if (!match) return null;

  return {
    traceId: match[1],
    spanId: match[2] || null,
    sampled: match[3] === '1',
    raw: header,
    platform: 'gcp',
  };
}

/**
 * Parse AWS X-Ray x-amzn-trace-id header
 * Format: Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995cbe3140f4fb;Sampled=1
 * @param {string} header
 * @returns {TraceContext|null}
 */
function parseAwsTraceContext(header) {
  if (!header || typeof header !== 'string') return null;

  const parts = {};
  for (const segment of header.split(';')) {
    const eq = segment.indexOf('=');
    if (eq > 0) {
      parts[segment.slice(0, eq).trim()] = segment.slice(eq + 1).trim();
    }
  }

  const traceId = parts['Root'] || parts['Self'] || null;
  if (!traceId) return null;

  return {
    traceId,
    spanId: parts['Parent'] || null,
    sampled: parts['Sampled'] === '1',
    raw: header,
    platform: 'aws',
  };
}

/**
 * Parse W3C traceparent header
 * Format: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 * @param {string} header
 * @returns {TraceContext|null}
 */
function parseW3cTraceparent(header) {
  if (!header || typeof header !== 'string') return null;

  const match = header.match(/^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/i);
  if (!match) return null;

  return {
    traceId: match[1],
    spanId: match[2],
    sampled: (parseInt(match[3], 16) & 1) === 1,
    raw: header,
    platform: 'w3c',
  };
}

/**
 * Extract unified trace context from HTTP request headers
 * @param {import('http').IncomingMessage|Record<string, any>} req
 * @returns {TraceContext}
 */
function extractTraceContext(req) {
  const headers = (req && req.headers) || {};

  // 1. Google Cloud Trace (Cloud Run, App Engine, GKE, Cloud Functions)
  const gcpHeader = headers['x-cloud-trace-context'];
  if (gcpHeader) {
    const parsed = parseGcpTraceContext(gcpHeader);
    if (parsed) return parsed;
  }

  // 2. AWS X-Ray (App Runner, ECS, Lambda, ALB, API Gateway)
  const awsHeader = headers['x-amzn-trace-id'];
  if (awsHeader) {
    const parsed = parseAwsTraceContext(awsHeader);
    if (parsed) return parsed;
  }

  // 3. W3C Trace Context (traceparent)
  const w3cHeader = headers['traceparent'];
  if (w3cHeader) {
    const parsed = parseW3cTraceparent(w3cHeader);
    if (parsed) return parsed;
  }

  // 4. Request ID or generate new UUID
  const reqId = headers['x-request-id'] || headers['x-correlation-id'] || crypto.randomUUID();

  return {
    traceId: reqId,
    spanId: null,
    sampled: false,
    raw: reqId,
    platform: 'generic',
  };
}

module.exports = {
  extractTraceContext,
  parseGcpTraceContext,
  parseAwsTraceContext,
  parseW3cTraceparent,
};

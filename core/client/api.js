'use strict';

/**
 * Webspresso Typed API Client & Request Coordinator
 *
 * Provides:
 * - Explicit concurrency policies per request key: 'latest' | 'drop' | 'queue' | 'parallel'
 * - Zero automatic retry on mutations (POST, PUT, PATCH, DELETE)
 * - Structured error taxonomy: 'http' | 'network' | 'validation' | 'canceled'
 * - Wire format modeling (Date -> ISO, undefined query stripping, 204/empty -> undefined, File/Blob/FormData)
 * - Automatic CSRF token & same-origin credential attachment
 * - Two-phase mutation -> invalidation dispatch where refresh failure never fails a succeeded mutation
 * - Raw & streaming escape hatches (`api.raw`, `api.stream`)
 */

const { isArray, isNumber } = require('./utils');

const VALID_POLICIES = new Set(['latest', 'drop', 'queue', 'parallel']);
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const RESERVED_OPTION_KEYS = new Set([
  'query',
  'params',
  'headers',
  'signal',
  'key',
  'policy',
  'concurrency',
  'credentials',
  'csrfToken',
  'parseResponse',
  'onRefreshError',
  'timeout',
  'retry',
  'retryMutations',
  'raw',
]);

/**
 * Structured Client Request Error
 * Distinguishes 'http', 'network', 'validation', 'canceled', and 'timeout' failure modes.
 */
class ClientRequestError extends Error {
  /**
   * @param {string} message
   * @param {object} details
   * @param {'http'|'network'|'validation'|'canceled'|'timeout'} details.kind
   * @param {number|null} [details.status]
   * @param {string} [details.code]
   * @param {string} [details.method]
   * @param {string} [details.url]
   * @param {string} [details.key]
   * @param {Record<string, string>} [details.fieldErrors]
   * @param {Record<string, string[]>} [details.fieldErrorList]
   * @param {Array<{path: string, message: string, code?: string}>} [details.issues]
   * @param {string|null} [details.formError]
   * @param {unknown} [details.data]
   * @param {boolean} [details.isDropped]
   * @param {boolean} [details.isSuperseded]
   * @param {boolean} [details.isTimedOut]
   * @param {Error} [details.cause]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'ClientRequestError';
    this.kind = details.kind || 'http';
    this.status = details.status !== undefined ? details.status : null;
    this.code = details.code || defaultCodeForKind(this.kind, this.status);
    this.method = details.method || 'GET';
    this.url = details.url || '';
    this.key = details.key || '';
    this.fieldErrors = details.fieldErrors || {};
    this.fieldErrorList = details.fieldErrorList || {};
    this.issues = isArray(details.issues) ? details.issues : [];
    this.formError = details.formError || null;
    this.data = details.data !== undefined ? details.data : null;
    this.isCanceled = this.kind === 'canceled';
    this.isValidation = this.kind === 'validation';
    this.isNetwork = this.kind === 'network';
    this.isHttp = this.kind === 'http';
    this.isTimedOut =
      this.kind === 'timeout' ||
      Boolean(details.isTimedOut) ||
      this.code === 'REQUEST_TIMED_OUT' ||
      this.status === 408;
    this.isDropped = Boolean(details.isDropped);
    this.isSuperseded = Boolean(details.isSuperseded);
    this.dispatched =
      details.dispatched !== undefined
        ? Boolean(details.dispatched)
        : !this.isDropped && (this.kind !== 'canceled' || Boolean(details.cause));
    this.outcomeUnknown =
      details.outcomeUnknown !== undefined
        ? Boolean(details.outcomeUnknown)
        : MUTATION_METHODS.has(this.method) &&
          this.dispatched &&
          !this.isDropped &&
          (this.kind === 'timeout' || this.kind === 'network' || this.kind === 'canceled');
    this.outcome = this.outcomeUnknown
      ? 'unknown'
      : !this.dispatched || this.isDropped
        ? 'not_sent'
        : 'failed';
    this.serverRollbackGuaranteed = false;
    if (this.isCanceled) {
      this.note = 'Client request cancellation/abort does not roll back server-side execution.';
    } else if (this.outcomeUnknown) {
      this.note =
        'Mutation request was dispatched before response delivery failed; the server may have committed the operation.';
    }
    if (details.cause) {
      this.cause = details.cause;
    }
  }
}

function defaultCodeForKind(kind, status) {
  if (kind === 'timeout' || status === 408) return 'REQUEST_TIMED_OUT';
  if (kind === 'validation') return 'VALIDATION_ERROR';
  if (kind === 'canceled') return 'REQUEST_CANCELED';
  if (kind === 'network') return 'NETWORK_ERROR';
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  return 'HTTP_ERROR';
}

/**
 * Discover CSRF token from DOM meta tag, hidden `_csrf` input, or cookies.
 *
 * @param {Document} [doc]
 * @returns {string|null}
 */
function discoverCsrfToken(doc) {
  const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
  if (!targetDoc) return null;

  if (typeof targetDoc.querySelector === 'function') {
    const meta =
      targetDoc.querySelector('meta[name="csrf-token"]') ||
      targetDoc.querySelector('meta[name="xsrf-token"]');
    if (meta && typeof meta.getAttribute === 'function') {
      const content = meta.getAttribute('content');
      if (content) return content.trim();
    }

    const input = targetDoc.querySelector('input[name="_csrf"]');
    if (input && input.value) {
      return String(input.value).trim();
    }
  }

  if (typeof targetDoc.cookie === 'string' && targetDoc.cookie) {
    const cookies = targetDoc.cookie.split(';');
    for (const raw of cookies) {
      const [rawName, ...rest] = raw.trim().split('=');
      if (rawName === 'XSRF-TOKEN' || rawName === '_csrf' || rawName === 'csrf_token') {
        try {
          return decodeURIComponent(rest.join('='));
        } catch (_e) {
          return rest.join('=');
        }
      }
    }
  }

  return null;
}

/**
 * Interpolate `:param` or `[param]` segments in URL paths and append query parameters.
 * Strips `undefined` values and formats `Date` instances as ISO strings.
 *
 * @param {string} urlTemplate
 * @param {Record<string, unknown>} [params]
 * @param {Record<string, unknown>} [query]
 * @returns {string}
 */
function buildRequestUrl(urlTemplate, params, query) {
  let resolvedPath = String(urlTemplate || '');

  if (params && typeof params === 'object') {
    for (const [key, val] of Object.entries(params)) {
      if (val === undefined || val === null) continue;
      const encoded = encodeURIComponent(val instanceof Date ? val.toISOString() : String(val));
      resolvedPath = resolvedPath
        .replace(new RegExp(`:${key}(?=/|$|\\?)`, 'g'), encoded)
        .replace(new RegExp(`\\[${key}\\]`, 'g'), encoded);
    }
  }

  if (!query || typeof query !== 'object') {
    return resolvedPath;
  }

  const searchParams = new URLSearchParams();
  for (const [key, rawVal] of Object.entries(query)) {
    if (rawVal === undefined) continue;
    if (isArray(rawVal)) {
      for (const item of rawVal) {
        if (item === undefined) continue;
        searchParams.append(key, item instanceof Date ? item.toISOString() : String(item));
      }
    } else if (rawVal instanceof Date) {
      searchParams.append(key, rawVal.toISOString());
    } else if (rawVal === null) {
      searchParams.append(key, '');
    } else if (typeof rawVal === 'object') {
      searchParams.append(key, JSON.stringify(rawVal));
    } else {
      searchParams.append(key, String(rawVal));
    }
  }

  const qs = searchParams.toString();
  if (!qs) return resolvedPath;
  return resolvedPath.includes('?') ? `${resolvedPath}&${qs}` : `${resolvedPath}?${qs}`;
}

/**
 * Check whether an object contains binary File or Blob instances that require FormData transport.
 */
function containsBinaryValue(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
  if (typeof File !== 'undefined' && value instanceof File) return true;
  if (typeof FormData !== 'undefined' && value instanceof FormData) return true;
  if (isArray(value)) {
    return value.some(containsBinaryValue);
  }
  for (const v of Object.values(value)) {
    if (containsBinaryValue(v)) return true;
  }
  return false;
}

/**
 * Convert a plain object containing File/Blob values into FormData.
 */
function objectToFormData(obj) {
  const fd = new FormData();
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) continue;
    if (isArray(val)) {
      for (const item of val) {
        if (item === undefined) continue;
        if (typeof Blob !== 'undefined' && item instanceof Blob) {
          fd.append(key, item);
        } else if (item instanceof Date) {
          fd.append(key, item.toISOString());
        } else if (item !== null) {
          fd.append(key, String(item));
        }
      }
    } else if (typeof Blob !== 'undefined' && val instanceof Blob) {
      fd.append(key, val);
    } else if (val instanceof Date) {
      fd.append(key, val.toISOString());
    } else if (val === null) {
      fd.append(key, '');
    } else if (typeof val === 'object') {
      fd.append(key, JSON.stringify(val));
    } else {
      fd.append(key, String(val));
    }
  }
  return fd;
}

/**
 * Serialize JSON payload while converting Date objects to ISO strings.
 */
function serializeRequestBody(body, headers) {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return body;
  }
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    }
    return body.toString();
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return body;
  }
  if (typeof body === 'string') {
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'text/plain;charset=UTF-8';
    }
    return body;
  }
  if (containsBinaryValue(body) && typeof FormData !== 'undefined') {
    return objectToFormData(body);
  }
  if (!headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }
  return JSON.stringify(body);
}

/**
 * Extract structured validation field errors from Webspresso / Zod error payloads.
 *
 * @param {unknown} payload
 * @returns {{ fieldErrors: Record<string, string>, fieldErrorList: Record<string, string[]>, issues: Array<{path: string, message: string, code?: string}>, formError: string|null }}
 */
function extractValidationErrors(payload) {
  const fieldErrors = {};
  const fieldErrorList = {};
  const issues = [];
  let formError = null;

  if (!payload || typeof payload !== 'object') {
    return { fieldErrors, fieldErrorList, issues, formError };
  }

  const errObj = payload.error && typeof payload.error === 'object' ? payload.error : payload;

  if (typeof errObj.formError === 'string' && errObj.formError) {
    formError = errObj.formError;
  } else if (typeof payload.formError === 'string' && payload.formError) {
    formError = payload.formError;
  }

  // 1. Direct fieldErrors map (e.g. { title: 'Required' } or { title: ['Required'] })
  const rawFieldErrors = errObj.fieldErrors || payload.fieldErrors || errObj.fields || null;
  if (rawFieldErrors && typeof rawFieldErrors === 'object' && !isArray(rawFieldErrors)) {
    for (const [field, msgOrArr] of Object.entries(rawFieldErrors)) {
      const list = isArray(msgOrArr) ? msgOrArr.map(String) : [String(msgOrArr)];
      if (list.length > 0) {
        fieldErrors[field] = list[0];
        fieldErrorList[field] = list;
        issues.push({ path: field, message: list[0] });
      }
    }
  }

  // 2. Zod / Webspresso `issues` or `details` array
  const rawIssues =
    (isArray(errObj.issues) && errObj.issues) ||
    (isArray(payload.issues) && payload.issues) ||
    (isArray(errObj.details) && errObj.details) ||
    (isArray(payload.details) && payload.details) ||
    (isArray(errObj.errors) && errObj.errors) ||
    [];

  for (const issue of rawIssues) {
    if (!issue || typeof issue !== 'object') continue;
    let rawPath = '';
    if (isArray(issue.path)) {
      // Strip leading 'body' / 'query' / 'params' prefix from route validation paths
      const cleanParts =
        issue.path.length > 1 &&
        (issue.path[0] === 'body' || issue.path[0] === 'query' || issue.path[0] === 'params')
          ? issue.path.slice(1)
          : issue.path;
      rawPath = cleanParts.join('.');
    } else if (typeof issue.path === 'string') {
      rawPath = issue.path.replace(/^(body|query|params)\./, '');
    } else if (typeof issue.field === 'string') {
      rawPath = issue.field.replace(/^(body|query|params)\./, '');
    }

    const message = issue.message ? String(issue.message) : 'Invalid value';
    issues.push({ path: rawPath, message, code: issue.code });

    if (rawPath) {
      if (!fieldErrors[rawPath]) {
        fieldErrors[rawPath] = message;
      }
      if (!fieldErrorList[rawPath]) {
        fieldErrorList[rawPath] = [];
      }
      if (!fieldErrorList[rawPath].includes(message)) {
        fieldErrorList[rawPath].push(message);
      }
    } else if (!formError) {
      formError = message;
    }
  }

  if (!formError && typeof errObj.message === 'string' && Object.keys(fieldErrors).length === 0) {
    formError = errObj.message;
  }

  return { fieldErrors, fieldErrorList, issues, formError };
}

/**
 * Separate invalidation infrastructure metadata from application data.
 * Supports:
 * - `X-Webspresso-Invalidate` response header
 * - `{ data, invalidate }` mutation result envelope
 */
function unwrapApiResultAndInvalidate(parsedBody, responseHeaders) {
  const headerTags = [];
  if (responseHeaders && typeof responseHeaders.get === 'function') {
    const rawHeader = responseHeaders.get('x-webspresso-invalidate');
    if (rawHeader) {
      for (const tag of rawHeader.split(',')) {
        const trimmed = tag.trim();
        if (trimmed) headerTags.push(trimmed);
      }
    }
  }

  let data = parsedBody;
  const bodyTags = [];

  if (
    parsedBody &&
    typeof parsedBody === 'object' &&
    !isArray(parsedBody) &&
    isArray(parsedBody.invalidate) &&
    'data' in parsedBody
  ) {
    for (const tag of parsedBody.invalidate) {
      if (typeof tag === 'string' && tag.trim()) {
        bodyTags.push(tag.trim());
      }
    }
    data = parsedBody.data;
    // Provide non-enumerable `.data` self-reference on object payloads so both
    // `result.id` and `result.data.id` work seamlessly.
    if (data && typeof data === 'object' && !('data' in data)) {
      Object.defineProperty(data, 'data', {
        value: data,
        enumerable: false,
        configurable: true,
      });
    }
  }

  const invalidate = Array.from(new Set([...headerTags, ...bodyTags]));
  return { data, invalidate };
}

/**
 * Normalize arguments for `api.get(url, inputOrOptions?, options?)`.
 */
function normalizeGetArgs(inputOrOptions, explicitOptions) {
  if (explicitOptions && typeof explicitOptions === 'object') {
    const inp = inputOrOptions && typeof inputOrOptions === 'object' ? inputOrOptions : {};
    const query = inp.query && typeof inp.query === 'object' ? inp.query : inp;
    const params = explicitOptions.params || inp.params;
    return {
      ...explicitOptions,
      query,
      params,
    };
  }

  if (!inputOrOptions || typeof inputOrOptions !== 'object') {
    return {};
  }

  const keys = Object.keys(inputOrOptions);
  const hasExplicitWrapper =
    'query' in inputOrOptions ||
    'params' in inputOrOptions ||
    'policy' in inputOrOptions ||
    'concurrency' in inputOrOptions ||
    'key' in inputOrOptions ||
    'signal' in inputOrOptions ||
    'headers' in inputOrOptions ||
    'timeout' in inputOrOptions ||
    'retry' in inputOrOptions ||
    'retryMutations' in inputOrOptions;

  if (hasExplicitWrapper && keys.every((k) => RESERVED_OPTION_KEYS.has(k))) {
    return { ...inputOrOptions };
  }

  // Mix of query keys and reserved options or pure query object
  const query = {};
  const opts = {};
  for (const [k, v] of Object.entries(inputOrOptions)) {
    if (RESERVED_OPTION_KEYS.has(k)) {
      opts[k] = v;
    } else {
      query[k] = v;
    }
  }
  if (opts.query && typeof opts.query === 'object') {
    Object.assign(query, opts.query);
  }
  opts.query = query;
  return opts;
}

/**
 * Normalize retry options into an actionable execution descriptor.
 * Never allows retries on mutations unless `retryMutations: true` is explicitly opted into.
 *
 * @param {boolean|number|object} [retryOpt]
 * @param {string} upperMethod
 * @param {boolean} [retryMutations=false]
 * @returns {object|null}
 */
function normalizeRetryConfig(retryOpt, upperMethod, retryMutations = false) {
  if (!retryOpt) return null;

  // Strict invariant: never automatically retry mutation methods (POST, PUT, PATCH, DELETE)
  if (MUTATION_METHODS.has(upperMethod) && !retryMutations) {
    return null;
  }

  let count = 0;
  let delay = 300;
  let maxDelay = 5000;
  let backoff = 'exponential';
  let statusCodes = new Set([408, 429, 502, 503, 504]);
  let onRetry = null;

  if (isNumber(retryOpt)) {
    count = Math.max(0, Math.floor(retryOpt));
  } else if (retryOpt === true) {
    count = 2;
  } else if (typeof retryOpt === 'object' && retryOpt !== null) {
    count = isNumber(retryOpt.count) ? Math.max(0, Math.floor(retryOpt.count)) : 2;
    if (isNumber(retryOpt.delay)) delay = Math.max(0, retryOpt.delay);
    if (isNumber(retryOpt.maxDelay)) maxDelay = Math.max(delay, retryOpt.maxDelay);
    if (retryOpt.backoff === 'linear' || retryOpt.backoff === 'exponential') {
      backoff = retryOpt.backoff;
    }
    if (isArray(retryOpt.statusCodes)) {
      statusCodes = new Set(retryOpt.statusCodes);
    }
    if (typeof retryOpt.onRetry === 'function') {
      onRetry = retryOpt.onRetry;
    }
  }

  if (count <= 0) return null;

  return {
    count,
    delay,
    maxDelay,
    backoff,
    statusCodes,
    onRetry,
  };
}

/**
 * Determine whether an error is transient and eligible for retry.
 */
function isRetryableError(err, statusCodes) {
  if (!err) return false;
  // Canceled, dropped, or superseded requests must never retry
  if (err.isCanceled || err.isDropped || err.isSuperseded) return false;
  // Network failures and timeouts are retryable
  if (err.kind === 'network' || err.kind === 'timeout' || err.isTimedOut) return true;
  // Transient HTTP status codes
  if (isNumber(err.status) && statusCodes && statusCodes.has(err.status)) {
    return true;
  }
  return false;
}

/**
 * Calculate retry delay with jitter.
 */
function calculateRetryDelay(attempt, config) {
  const base = config.delay;
  const max = config.maxDelay;
  let calculated;
  if (config.backoff === 'linear') {
    calculated = base * attempt;
  } else {
    calculated = base * Math.pow(2, attempt - 1);
  }
  const jitter = Math.random() * 50;
  return Math.min(max, calculated + jitter);
}

/**
 * Abortable delay helper that rejects immediately if any signal aborts during wait.
 */
function abortableSleep(ms, signals = []) {
  return new Promise((resolve, reject) => {
    for (const sig of signals) {
      if (sig && sig.aborted) {
        return reject(new Error('Sleep aborted'));
      }
    }

    let timer = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      for (const sig of signals) {
        if (sig && typeof sig.removeEventListener === 'function') {
          sig.removeEventListener('abort', onAbort);
        }
      }
    };

    const onAbort = () => {
      cleanup();
      reject(new Error('Sleep aborted'));
    };

    for (const sig of signals) {
      if (sig && typeof sig.addEventListener === 'function') {
        sig.addEventListener('abort', onAbort, { once: true });
      }
    }

    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
  });
}

/**
 * Create a Typed API Client instance.
 *
 * @param {object} [config]
 * @param {typeof fetch} [config.fetch] - Custom fetch implementation
 * @param {string} [config.baseUrl=''] - Optional base URL prefix
 * @param {() => string|null} [config.getCsrfToken] - Custom CSRF token provider
 * @param {(tags: string[], meta: object) => Promise<unknown>|unknown} [config.onInvalidate] - Fragment invalidation callback
 * @param {(err: Error, meta: object) => void} [config.onRefreshError] - Callback if background fragment refresh fails after mutation
 * @param {AbortSignal} [config.lifecycleSignal] - Controller lifecycle signal (aborts in-flight requests on unmount)
 * @param {() => boolean} [config.isConnected] - Controller connection check
 * @param {object} [config.debug] - Client debugger instance
 */
function trimTrailingSlashes(str) {
  if (!str) return '';
  let end = str.length;
  while (end > 0 && str.charCodeAt(end - 1) === 47) {
    end--;
  }
  return end === str.length ? str : str.slice(0, end);
}

function createApiClient(config = {}) {
  const fetchImpl =
    config.fetch || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const baseUrl = config.baseUrl ? trimTrailingSlashes(String(config.baseUrl)) : '';
  const lifecycleSignal = config.lifecycleSignal || null;
  const isConnected = typeof config.isConnected === 'function' ? config.isConnected : () => true;
  const debug = config.debug || null;
  const onInvalidate = typeof config.onInvalidate === 'function' ? config.onInvalidate : null;
  const onRefreshError = typeof config.onRefreshError === 'function' ? config.onRefreshError : null;

  // Concurrency state maps per request key
  const latestMap = new Map(); // key -> { seq: number, controller: AbortController, requestId: string }
  const inFlightMap = new Map(); // key -> Set<string> (active requestIds)
  const queueMap = new Map(); // key -> Promise<unknown>
  let reqCounter = 0;
  let lastRefreshPromise = null;

  function resolvePolicy(policy) {
    if (!policy) return 'parallel';
    const normalized = String(policy).toLowerCase();
    if (!VALID_POLICIES.has(normalized)) {
      throw new Error(
        `Invalid request concurrency policy "${policy}". Expected one of: latest, drop, queue, parallel.`
      );
    }
    return normalized;
  }

  /**
   * Core request executor supporting concurrency policies.
   */
  async function executeRequest(method, urlTemplate, body, options = {}) {
    if (!fetchImpl) {
      throw new Error('Global fetch is not available in this environment.');
    }

    const upperMethod = String(method || 'GET').toUpperCase();
    const policy = resolvePolicy(options.policy || options.concurrency);
    const requestUrl = buildRequestUrl(
      baseUrl ? `${baseUrl}${urlTemplate}` : urlTemplate,
      options.params,
      options.query
    );
    const baseKeyPath = String(urlTemplate || '').split('?')[0];
    const requestKey = options.key ? String(options.key) : `${upperMethod}:${baseKeyPath}`;
    const requestId = `req_${++reqCounter}_${Date.now()}`;

    // Check controller lifecycle before starting
    if (!isConnected() || (lifecycleSignal && lifecycleSignal.aborted)) {
      throw new ClientRequestError(`Request canceled: controller is disconnected (${upperMethod} ${requestUrl})`, {
        kind: 'canceled',
        method: upperMethod,
        url: requestUrl,
        key: requestKey,
        dispatched: false,
        outcomeUnknown: false,
      });
    }

    // Policy: 'drop' -> Do not start if another request with the same key is currently in flight
    const activeSet = inFlightMap.get(requestKey);
    if (policy === 'drop' && activeSet && activeSet.size > 0) {
      if (debug) {
        debug.trackDiscardedResponse({
          source: 'api',
          key: requestKey,
          url: requestUrl,
          reason: 'dropped-by-policy',
        });
      }
      throw new ClientRequestError(
        `Request dropped by 'drop' concurrency policy: "${requestKey}" is already in flight.`,
        {
          kind: 'canceled',
          code: 'REQUEST_DROPPED',
          method: upperMethod,
          url: requestUrl,
          key: requestKey,
          isDropped: true,
        }
      );
    }

    // Policy: 'queue' -> Chain onto existing queue for this key
    const retryConfig = normalizeRetryConfig(
      options.retry,
      upperMethod,
      Boolean(options.retryMutations)
    );

    async function executeWithRetry(runFn) {
      if (!retryConfig) {
        return runFn(requestId);
      }

      let attempt = 0;
      while (true) {
        attempt++;
        const currentReqId = attempt === 1 ? requestId : `req_${++reqCounter}_${Date.now()}`;
        try {
          return await runFn(currentReqId);
        } catch (err) {
          const canRetry =
            attempt <= retryConfig.count &&
            isConnected() &&
            (!lifecycleSignal || !lifecycleSignal.aborted) &&
            (!options.signal || !options.signal.aborted) &&
            isRetryableError(err, retryConfig.statusCodes);

          if (!canRetry) {
            throw err;
          }

          const delayMs = calculateRetryDelay(attempt, retryConfig);

          if (typeof retryConfig.onRetry === 'function') {
            try {
              retryConfig.onRetry(err, attempt, delayMs);
            } catch (_cbErr) {
              // Ignore callback error
            }
          }

          if (debug && typeof debug.trackRequestRetry === 'function') {
            debug.trackRequestRetry({
              requestId: currentReqId,
              key: requestKey,
              attempt,
              delay: delayMs,
              error: err,
            });
          }

          const activeSignals = [options.signal, lifecycleSignal].filter(Boolean);
          try {
            await abortableSleep(delayMs, activeSignals);
          } catch (_sleepErr) {
            throw new ClientRequestError(
              `Request canceled during retry backoff (${upperMethod} ${requestUrl}).`,
              {
                kind: 'canceled',
                code: 'REQUEST_CANCELED',
                method: upperMethod,
                url: requestUrl,
                key: requestKey,
              }
            );
          }
        }
      }
    }

    if (policy === 'queue') {
      const prevTail = queueMap.get(requestKey) || Promise.resolve();
      const nextTask = prevTail
        .catch(() => {})
        .then(() =>
          executeWithRetry((subReqId) =>
            runSingleRequest(upperMethod, requestUrl, body, options, requestKey, subReqId, 'queue')
          )
        );
      queueMap.set(
        requestKey,
        nextTask.catch(() => {})
      );
      return nextTask;
    }

    return executeWithRetry((subReqId) =>
      runSingleRequest(upperMethod, requestUrl, body, options, requestKey, subReqId, policy)
    );
  }

  async function runSingleRequest(upperMethod, requestUrl, body, options, requestKey, requestId, policy) {
    const abortController = new AbortController();
    let superseded = false;
    let timedOut = false;
    let timeoutTimer = null;
    let currentSeq = 1;

    if (isNumber(options.timeout) && options.timeout > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        abortController.abort();
      }, options.timeout);
    }

    // Policy: 'latest' -> Abort previous in-flight request for this key and increment sequence
    if (policy === 'latest') {
      const prev = latestMap.get(requestKey);
      if (prev) {
        currentSeq = prev.seq + 1;
        prev.superseded = true;
        try {
          prev.controller.abort();
        } catch (_e) {
          // Ignore
        }
      }
      latestMap.set(requestKey, {
        seq: currentSeq,
        controller: abortController,
        requestId,
        superseded: false,
      });
    }

    // Link caller AbortSignal and controller lifecycleSignal
    const onCallerAbort = () => abortController.abort();
    if (options.signal) {
      if (options.signal.aborted) {
        abortController.abort();
      } else {
        options.signal.addEventListener('abort', onCallerAbort, { once: true });
      }
    }
    if (lifecycleSignal) {
      if (lifecycleSignal.aborted) {
        abortController.abort();
      } else {
        lifecycleSignal.addEventListener('abort', onCallerAbort, { once: true });
      }
    }

    if (!inFlightMap.has(requestKey)) {
      inFlightMap.set(requestKey, new Set());
    }
    inFlightMap.get(requestKey).add(requestId);

    if (debug) {
      debug.trackRequestStart({
        requestId,
        key: requestKey,
        method: upperMethod,
        url: requestUrl,
        policy,
        payload: body,
      });
    }

    const headers = {
      Accept: options.raw ? '*/*' : 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(options.headers || {}),
    };

    // Attach CSRF token on state-changing requests
    if (MUTATION_METHODS.has(upperMethod)) {
      const csrfToken =
        options.csrfToken ||
        (typeof config.getCsrfToken === 'function' ? config.getCsrfToken() : discoverCsrfToken());
      if (csrfToken && !headers['X-CSRF-Token'] && !headers['x-csrf-token']) {
        headers['X-CSRF-Token'] = csrfToken;
      }
    }

    const serializedBody =
      upperMethod === 'GET' || upperMethod === 'HEAD'
        ? undefined
        : serializeRequestBody(body, headers);

    try {
      let response;
      try {
        response = await fetchImpl(requestUrl, {
          method: upperMethod,
          headers,
          body: serializedBody,
          credentials: options.credentials || 'same-origin',
          signal: abortController.signal,
        });
      } catch (fetchErr) {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        const latestEntry = policy === 'latest' ? latestMap.get(requestKey) : null;
        if (latestEntry && (latestEntry.seq !== currentSeq || latestEntry.superseded)) {
          superseded = true;
        }

        if (timedOut) {
          if (debug) {
            debug.trackRequestEnd(requestId, { status: 'failed', errorKind: 'timeout' });
          }
          throw new ClientRequestError(
            `Request timed out after ${options.timeout}ms (${upperMethod} ${requestUrl}).`,
            {
              kind: 'timeout',
              status: 408,
              code: 'REQUEST_TIMED_OUT',
              method: upperMethod,
              url: requestUrl,
              key: requestKey,
              isTimedOut: true,
              dispatched: true,
              cause: fetchErr,
            }
          );
        }

        const isAbort =
          superseded ||
          abortController.signal.aborted ||
          (fetchErr && (fetchErr.name === 'AbortError' || fetchErr.code === 'ABORT_ERR'));

        if (isAbort) {
          if (debug) {
            debug.trackDiscardedResponse({
              source: 'api',
              key: requestKey,
              url: requestUrl,
              reason: superseded ? 'superseded-by-latest' : 'aborted',
              version: currentSeq,
              currentVersion: latestEntry ? latestEntry.seq : currentSeq,
            });
            debug.trackRequestEnd(requestId, { status: 'canceled', errorKind: 'canceled' });
          }
          throw new ClientRequestError(
            superseded
              ? `Request superseded by newer '${requestKey}' request.`
              : `Request canceled (${upperMethod} ${requestUrl}).`,
            {
              kind: 'canceled',
              code: superseded ? 'REQUEST_SUPERSEDED' : 'REQUEST_CANCELED',
              method: upperMethod,
              url: requestUrl,
              key: requestKey,
              isSuperseded: superseded,
              dispatched: true,
              cause: fetchErr,
            }
          );
        }

        if (debug) {
          debug.trackRequestEnd(requestId, { status: 'failed', errorKind: 'network' });
        }
        throw new ClientRequestError(
          fetchErr && fetchErr.message ? fetchErr.message : `Network error (${upperMethod} ${requestUrl})`,
          {
            kind: 'network',
            method: upperMethod,
            url: requestUrl,
            key: requestKey,
            dispatched: true,
            cause: fetchErr,
          }
        );
      }

      // Check if superseded by a newer 'latest' request while awaiting response/body
      const checkSupersededOrDisconnected = () => {
        if (policy === 'latest') {
          const latestEntry = latestMap.get(requestKey);
          if (latestEntry && (latestEntry.seq !== currentSeq || latestEntry.superseded)) {
            if (debug) {
              debug.trackDiscardedResponse({
                source: 'api',
                key: requestKey,
                url: requestUrl,
                reason: 'superseded-by-latest',
                version: currentSeq,
                currentVersion: latestEntry.seq,
              });
              debug.trackRequestEnd(requestId, {
                status: 'discarded',
                httpStatus: response.status,
                errorKind: 'canceled',
              });
            }
            throw new ClientRequestError(`Stale response discarded for '${requestKey}'.`, {
              kind: 'canceled',
              code: 'REQUEST_SUPERSEDED',
              status: response.status,
              method: upperMethod,
              url: requestUrl,
              key: requestKey,
              isSuperseded: true,
            });
          }
        }
        if (!isConnected()) {
          if (debug) {
            debug.trackDiscardedResponse({
              source: 'api',
              key: requestKey,
              url: requestUrl,
              reason: 'controller-disconnected',
            });
            debug.trackRequestEnd(requestId, {
              status: 'discarded',
              httpStatus: response.status,
              errorKind: 'canceled',
            });
          }
          throw new ClientRequestError(
            `Response discarded: controller disconnected (${upperMethod} ${requestUrl}).`,
            {
              kind: 'canceled',
              code: 'CONTROLLER_DISCONNECTED',
              status: response.status,
              method: upperMethod,
              url: requestUrl,
              key: requestKey,
            }
          );
        }
      };

      checkSupersededOrDisconnected();

      // Escape hatch: return raw Response without body consumption
      if (options.raw) {
        if (!response.ok) {
          throw new ClientRequestError(`HTTP ${response.status} (${upperMethod} ${requestUrl})`, {
            kind: 'http',
            status: response.status,
            method: upperMethod,
            url: requestUrl,
            key: requestKey,
          });
        }
        if (debug) {
          debug.trackRequestEnd(requestId, { status: 'completed', httpStatus: response.status });
        }
        return response;
      }

      // Parse response body according to wire format
      let parsedBody;
      const status = response.status;
      const contentType =
        response.headers && typeof response.headers.get === 'function'
          ? response.headers.get('content-type') || ''
          : '';

      if (status === 204 || status === 205) {
        parsedBody = undefined;
      } else if (typeof response.text === 'function') {
        let rawText;
        try {
          rawText = await response.text();
        } catch (bodyErr) {
          if (timedOut) {
            throw new ClientRequestError(
              `Request timed out after ${options.timeout}ms (${upperMethod} ${requestUrl}).`,
              {
                kind: 'timeout',
                status: 408,
                code: 'REQUEST_TIMED_OUT',
                method: upperMethod,
                url: requestUrl,
                key: requestKey,
                isTimedOut: true,
                cause: bodyErr,
              }
            );
          }
          throw bodyErr;
        }
        checkSupersededOrDisconnected();
        if (!rawText || !rawText.trim()) {
          parsedBody = undefined;
        } else if (contentType.includes('application/json') || rawText.trim().startsWith('{') || rawText.trim().startsWith('[')) {
          try {
            parsedBody = JSON.parse(rawText);
          } catch (_jsonErr) {
            parsedBody = rawText;
          }
        } else {
          parsedBody = rawText;
        }
      } else if (typeof response.json === 'function') {
        try {
          parsedBody = await response.json();
        } catch (bodyErr) {
          if (timedOut) {
            throw new ClientRequestError(
              `Request timed out after ${options.timeout}ms (${upperMethod} ${requestUrl}).`,
              {
                kind: 'timeout',
                status: 408,
                code: 'REQUEST_TIMED_OUT',
                method: upperMethod,
                url: requestUrl,
                key: requestKey,
                isTimedOut: true,
                cause: bodyErr,
              }
            );
          }
          throw bodyErr;
        }
        checkSupersededOrDisconnected();
      }

      // Handle non-2xx HTTP responses
      if (!response.ok) {
        const errPayload = parsedBody && typeof parsedBody === 'object' ? parsedBody : {};
        const errBlock = errPayload.error && typeof errPayload.error === 'object' ? errPayload.error : errPayload;
        const errCode = errBlock.code || errPayload.code || null;
        const { fieldErrors, fieldErrorList, issues, formError } = extractValidationErrors(parsedBody);

        const isValidationStatus =
          status === 422 ||
          errCode === 'VALIDATION_ERROR' ||
          (status === 400 && (issues.length > 0 || Object.keys(fieldErrors).length > 0));

        const errorKind = isValidationStatus ? 'validation' : 'http';
        const message =
          formError ||
          (typeof errBlock.message === 'string' && errBlock.message) ||
          (typeof errPayload.message === 'string' && errPayload.message) ||
          `HTTP ${status} (${upperMethod} ${requestUrl})`;

        if (debug) {
          debug.trackRequestEnd(requestId, {
            status: 'failed',
            httpStatus: status,
            errorKind,
          });
        }

        throw new ClientRequestError(message, {
          kind: errorKind,
          status,
          code: errCode || defaultCodeForKind(errorKind, status),
          method: upperMethod,
          url: requestUrl,
          key: requestKey,
          fieldErrors,
          fieldErrorList,
          issues,
          formError,
          data: parsedBody,
        });
      }

      // 2xx Success: unwrap data and check for fragment invalidations
      const { data, invalidate } = unwrapApiResultAndInvalidate(parsedBody, response.headers);

      if (debug) {
        debug.trackRequestEnd(requestId, { status: 'completed', httpStatus: status });
      }

      // Trigger two-phase fragment invalidation if tags are present.
      // IMPORTANT: Refresh failure MUST NOT reject or fail the completed mutation!
      if (invalidate.length > 0 && onInvalidate) {
        const chainId = debug
          ? debug.startCausalChain({
              method: upperMethod,
              url: requestUrl,
              requestId,
              tags: invalidate,
            })
          : null;

        const refreshTask = Promise.resolve()
          .then(() =>
            onInvalidate(invalidate, {
              method: upperMethod,
              url: requestUrl,
              requestId,
              chainId,
            })
          )
          .catch((refreshErr) => {
            const notifyErr =
              typeof options.onRefreshError === 'function' ? options.onRefreshError : onRefreshError;
            if (notifyErr) {
              try {
                notifyErr(refreshErr, { tags: invalidate, method: upperMethod, url: requestUrl, chainId });
              } catch (_e) {
                // Ignore
              }
            }
            return { ok: false, error: refreshErr };
          });

        lastRefreshPromise = refreshTask;

        if (data && typeof data === 'object') {
          Object.defineProperty(data, '__invalidate', {
            value: invalidate,
            enumerable: false,
            configurable: true,
          });
          Object.defineProperty(data, '__refreshPromise', {
            value: refreshTask,
            enumerable: false,
            configurable: true,
          });
        }
      }

      return data;
    } finally {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      const set = inFlightMap.get(requestKey);
      if (set) {
        set.delete(requestId);
        if (set.size === 0) {
          inFlightMap.delete(requestKey);
        }
      }
      if (options.signal) {
        options.signal.removeEventListener('abort', onCallerAbort);
      }
      if (lifecycleSignal) {
        lifecycleSignal.removeEventListener('abort', onCallerAbort);
      }
    }
  }

  const client = {
    get(url, inputOrOptions, explicitOptions) {
      const opts = normalizeGetArgs(inputOrOptions, explicitOptions);
      return executeRequest('GET', url, undefined, opts);
    },

    post(url, body, options = {}) {
      return executeRequest('POST', url, body, options);
    },

    put(url, body, options = {}) {
      return executeRequest('PUT', url, body, options);
    },

    patch(url, body, options = {}) {
      return executeRequest('PATCH', url, body, options);
    },

    delete(url, bodyOrOptions, explicitOptions) {
      if (explicitOptions && typeof explicitOptions === 'object') {
        return executeRequest('DELETE', url, bodyOrOptions, explicitOptions);
      }
      if (
        bodyOrOptions &&
        typeof bodyOrOptions === 'object' &&
        Object.keys(bodyOrOptions).every((k) => RESERVED_OPTION_KEYS.has(k))
      ) {
        return executeRequest('DELETE', url, undefined, bodyOrOptions);
      }
      return executeRequest('DELETE', url, bodyOrOptions, {});
    },

    request(method, url, body, options = {}) {
      return executeRequest(method, url, body, options);
    },

    /**
     * Escape hatch for arbitrary raw responses (blobs, downloads, custom headers).
     */
    raw(url, options = {}) {
      const method = options.method || 'GET';
      return executeRequest(method, url, options.body, { ...options, raw: true });
    },

    /**
     * Escape hatch for streaming endpoints (chunked text / NDJSON / SSE).
     * Yields decoded UTF-8 string chunks as an async generator.
     */
    async *stream(url, options = {}) {
      const response = await client.raw(url, options);
      if (!response.body) {
        const text = await response.text();
        if (text) yield text;
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          yield decoder.decode(value, { stream: true });
        }
        const tail = decoder.decode();
        if (tail) yield tail;
      } finally {
        try {
          reader.releaseLock();
        } catch (_e) {
          // Ignore
        }
      }
    },

    isInFlight(key) {
      if (key) {
        const set = inFlightMap.get(key);
        return Boolean(set && set.size > 0);
      }
      return inFlightMap.size > 0;
    },

    get lastRefreshPromise() {
      return lastRefreshPromise;
    },
  };

  return client;
}

module.exports = {
  ClientRequestError,
  createApiClient,
  discoverCsrfToken,
  buildRequestUrl,
  extractValidationErrors,
  unwrapApiResultAndInvalidate,
  normalizeRetryConfig,
  isRetryableError,
  calculateRetryDelay,
  abortableSleep,
};


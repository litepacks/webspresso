'use strict';

/**
 * Webspresso Server-Side SSR Fragment Engine & Mutation Invalidation Helpers
 *
 * Responsibilities:
 * - Unified fragment execution & rendering pipeline shared between initial SSR and refresh requests
 * - Request-scoped loader data memoization (`ctx.memo(key, fn)`) with zero cross-request global cache
 * - Fragment input validation via Webspresso's Zod schema compiler
 * - Security enforcement: page cascading middlewares, route middlewares, and auth/bouncer guards
 *   run on refresh requests; unregistered fragments or arbitrary template paths are rejected
 * - `apiResult(data, { invalidate, status, headers })` helper with ambient transaction commit safety
 */

const { z } = require('../validation');
const { ValidationError, NotFoundError, BadRequestError, UnauthorizedError, ForbiddenError } = require('../errors');
const { onTransactionCommit, getAmbientTransaction } = require('../orm/transaction');
const { isArray, isNumber } = require('./utils');

/**
 * Execute an array of Express-style middlewares sequentially.
 */
async function runMiddlewares(middlewares, req, res) {
  if (!isArray(middlewares) || middlewares.length === 0) return;
  for (const mw of middlewares) {
    if (typeof mw !== 'function') continue;
    await new Promise((resolve, reject) => {
      try {
        const maybePromise = mw(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(resolve).catch(reject);
        } else if (mw.length < 3) {
          resolve();
        }
      } catch (err) {
        reject(err);
      }
    });
    if (res && res.headersSent) return;
  }
}

/**
 * Escape HTML attribute value safely.
 */
function escapeHtmlAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Wrap a string in a Nunjucks-compatible SafeString object so `{{ fsy.fragment(...) }}`
 * renders unescaped HTML even without `| safe`.
 */
function markSafeHtml(str) {
  try {
    const nunjucks = require('nunjucks');
    if (nunjucks && nunjucks.runtime && typeof nunjucks.runtime.SafeString === 'function') {
      return new nunjucks.runtime.SafeString(str);
    }
  } catch (_e) {
    // Fallback
  }
  const s = new String(str);
  s.val = str;
  s.__isSafeString = true;
  return s;
}

/**
 * Define a fragment configuration object with validation.
 *
 * @param {object} config
 * @param {string} config.template - Relative template path in `views/` (e.g. `'partials/notes-list.njk'`)
 * @param {string[]} [config.dependsOn] - Invalidation tags that trigger refresh for this fragment
 * @param {Function|object} [config.schema] - Optional Zod schema validating fragment refresh input
 * @param {boolean|string|string[]|Function} [config.auth] - Optional auth guard
 * @param {Array} [config.middleware] - Optional fragment-specific middlewares
 * @param {(ctx: object) => Promise<object>|object} [config.load] - Fragment data loader
 */
function defineFragment(config = {}) {
  if (!config || typeof config !== 'object' || typeof config.template !== 'string' || !config.template.trim()) {
    throw new Error('defineFragment() requires a non-empty `template` string.');
  }
  return {
    template: config.template.trim(),
    dependsOn: isArray(config.dependsOn) ? config.dependsOn.map(String) : [],
    schema: config.schema || null,
    auth: config.auth !== undefined ? config.auth : null,
    middleware: isArray(config.middleware) ? config.middleware : [],
    load: typeof config.load === 'function' ? config.load : null,
    staleTime: config.staleTime !== undefined ? config.staleTime : undefined,
    refetchOnWindowFocus:
      config.refetchOnWindowFocus !== undefined
        ? config.refetchOnWindowFocus
        : config.refetchOnFocus !== undefined
          ? config.refetchOnFocus
          : undefined,
    refetchOnReconnect: config.refetchOnReconnect !== undefined ? config.refetchOnReconnect : undefined,
    refetchOnMount:
      config.refetchOnMount !== undefined
        ? config.refetchOnMount
        : config.refetchOnVisit !== undefined
          ? config.refetchOnVisit
          : undefined,
    refetchInterval: config.refetchInterval !== undefined ? config.refetchInterval : undefined,
    refetchIntervalInBackground:
      config.refetchIntervalInBackground !== undefined ? config.refetchIntervalInBackground : undefined,
    persistInput:
      config.persistInput !== undefined
        ? config.persistInput
        : config.persist !== undefined
          ? config.persist
          : undefined,
  };
}

/**
 * Create a structured API mutation result with optional fragment invalidation tags.
 *
 * Example:
 * ```js
 * return apiResult({ id: created.id }, { invalidate: ['notes'], status: 201 });
 * ```
 *
 * @template T
 * @param {T} data - Application response data
 * @param {object} [meta]
 * @param {string[]} [meta.invalidate] - Fragment dependency tags to invalidate on commit
 * @param {number} [meta.status] - Optional HTTP status code (default 200)
 * @param {Record<string, string>} [meta.headers] - Optional extra response headers
 * @returns {{ __isWebspressoApiResult: true, data: T, invalidate: string[], status?: number, headers?: Record<string, string> }}
 */
function apiResult(data, meta = {}) {
  const rawInvalidate = meta && isArray(meta.invalidate) ? meta.invalidate : [];
  const invalidate = Array.from(
    new Set(rawInvalidate.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()))
  );
  return {
    __isWebspressoApiResult: true,
    data,
    invalidate,
    status: meta && isNumber(meta.status) ? meta.status : undefined,
    headers: meta && meta.headers && typeof meta.headers === 'object' ? { ...meta.headers } : undefined,
  };
}

/**
 * Check whether a value returned by an API handler is an `apiResult` or `{ data, invalidate }` envelope.
 */
function isApiResultEnvelope(val) {
  if (!val || typeof val !== 'object' || isArray(val)) return false;
  if (val.__isWebspressoApiResult === true) return true;
  if (
    'data' in val &&
    isArray(val.invalidate) &&
    val.invalidate.every((item) => typeof item === 'string')
  ) {
    return true;
  }
  return false;
}

/**
 * Send an `apiResult` envelope on `res`, ensuring invalidation metadata is only emitted
 * after any active ambient database transaction commits!
 *
 * @param {object} req
 * @param {object} res
 * @param {object} rawResult
 */
function sendApiResult(req, res, rawResult) {
  const status = rawResult.status || (res.statusCode && res.statusCode !== 200 ? res.statusCode : 200);
  const rawTags = isArray(rawResult.invalidate) ? rawResult.invalidate : [];
  const tags = Array.from(
    new Set(rawTags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()))
  );

  // If called while an ambient transaction is still uncommitted, defer invalidation emission
  // until onTransactionCommit fires; if the transaction rolls back, this callback never runs.
  const activeTrx = getAmbientTransaction();
  if (activeTrx && tags.length > 0) {
    if (!req.__deferredInvalidations) {
      req.__deferredInvalidations = new Set();
    }
    onTransactionCommit(() => {
      for (const t of tags) {
        req.__deferredInvalidations.add(t);
      }
    });
  }

  if (rawResult.headers && typeof res.setHeader === 'function') {
    for (const [k, v] of Object.entries(rawResult.headers)) {
      res.setHeader(k, v);
    }
  }

  const emitResponse = (committedTags) => {
    if (res.headersSent) return;
    if (committedTags.length > 0 && typeof res.setHeader === 'function') {
      res.setHeader('X-Webspresso-Invalidate', committedTags.join(', '));
    }
    if (typeof res.status === 'function') {
      res.status(status);
    } else {
      res.statusCode = status;
    }

    if (committedTags.length > 0) {
      return res.json({
        data: rawResult.data,
        invalidate: committedTags,
      });
    }
    return res.json(rawResult.data);
  };

  if (activeTrx) {
    // Wait for transaction commit before flushing invalidation response if res.apiResult was called inside db.transaction
    onTransactionCommit(() => {
      const committed = req.__deferredInvalidations ? Array.from(req.__deferredInvalidations) : tags;
      emitResponse(committed);
    });
    return res;
  }

  const finalTags = req && req.__deferredInvalidations
    ? Array.from(new Set([...req.__deferredInvalidations, ...tags]))
    : tags;
  return emitResponse(finalTags);
}

/**
 * Attach request-scoped memoization (`ctx.memo(key, fn)` and `ctx.shared`) to `req` and `ctx`.
 * Never caches across requests.
 *
 * @param {object} req
 * @param {object} ctx
 */
function ensureRequestMemo(req, ctx) {
  if (!req.__webspressoRequestMemo) {
    req.__webspressoRequestMemo = new Map();
  }
  const memoMap = req.__webspressoRequestMemo;

  function memo(key, factoryFn) {
    const cacheKey = String(key);
    if (memoMap.has(cacheKey)) {
      return memoMap.get(cacheKey);
    }
    if (typeof factoryFn !== 'function') {
      return undefined;
    }
    const result = factoryFn();
    // If factoryFn returns a Promise, remove from cache if it rejects so retries inside the same request can recover
    if (result && typeof result.catch === 'function') {
      result.catch(() => {
        if (memoMap.get(cacheKey) === result) {
          memoMap.delete(cacheKey);
        }
      });
    }
    memoMap.set(cacheKey, result);
    return result;
  }

  req.memo = memo;
  req.shared = memoMap;
  if (ctx && typeof ctx === 'object') {
    ctx.memo = memo;
    ctx.shared = memoMap;
  }
  return memo;
}

/**
 * Compile and validate fragment input against optional fragment `schema`.
 *
 * @param {string} fragmentName
 * @param {object} fragmentDef
 * @param {Record<string, unknown>} rawInput
 * @returns {Record<string, unknown>}
 */
function validateFragmentInput(fragmentName, fragmentDef, rawInput = {}) {
  const inputObj = rawInput && typeof rawInput === 'object' && !isArray(rawInput) ? rawInput : {};
  if (!fragmentDef || !fragmentDef.schema) {
    return { ...inputObj };
  }

  let resolvedSchema =
    typeof fragmentDef.schema === 'function' ? fragmentDef.schema({ z }) : fragmentDef.schema;

  if (!resolvedSchema) {
    return { ...inputObj };
  }

  // Unwrap `{ query: ... }` or `{ input: ... }` if provided in route-style schema object
  if (
    typeof resolvedSchema === 'object' &&
    typeof resolvedSchema.safeParse !== 'function'
  ) {
    if (resolvedSchema.input && typeof resolvedSchema.input.safeParse === 'function') {
      resolvedSchema = resolvedSchema.input;
    } else if (resolvedSchema.query && typeof resolvedSchema.query.safeParse === 'function') {
      resolvedSchema = resolvedSchema.query;
    } else {
      resolvedSchema = z.object(resolvedSchema);
    }
  }

  if (typeof resolvedSchema.safeParse === 'function') {
    const parsed = resolvedSchema.safeParse(inputObj);
    if (!parsed.success) {
      const issues = (parsed.error && parsed.error.issues ? parsed.error.issues : []).map((iss) => ({
        path: isArray(iss.path) ? iss.path.join('.') : String(iss.path || ''),
        message: iss.message,
        code: iss.code,
      }));
      throw new ValidationError(
        `Invalid input for fragment "${fragmentName}": ${issues.map((i) => `${i.path || 'input'}: ${i.message}`).join(', ')}`,
        { issues }
      );
    }
    return parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
  }

  return { ...inputObj };
}

/**
 * Verify fragment-level `auth` guard (`true`, role string, role array, or predicate `(user, ctx) => boolean`).
 */
async function enforceFragmentAuth(fragmentName, fragmentDef, req, ctx) {
  if (!fragmentDef || !fragmentDef.auth) return;
  const authRule = fragmentDef.auth;
  const user = (req && req.user) || (ctx && ctx.user) || (req && req.session && req.session.user) || null;

  if (authRule === true) {
    if (!user) {
      throw new UnauthorizedError(`Authentication required to access fragment "${fragmentName}".`);
    }
    return;
  }

  if (typeof authRule === 'string') {
    if (!user) {
      throw new UnauthorizedError(`Authentication required to access fragment "${fragmentName}".`);
    }
    const roles = isArray(user.roles) ? user.roles : user.role ? [user.role] : [];
    if (!roles.includes(authRule)) {
      throw new ForbiddenError(`Role "${authRule}" required to access fragment "${fragmentName}".`);
    }
    return;
  }

  if (isArray(authRule)) {
    if (!user) {
      throw new UnauthorizedError(`Authentication required to access fragment "${fragmentName}".`);
    }
    const roles = isArray(user.roles) ? user.roles : user.role ? [user.role] : [];
    if (!authRule.some((r) => roles.includes(r))) {
      throw new ForbiddenError(`Insufficient role to access fragment "${fragmentName}".`);
    }
    return;
  }

  if (typeof authRule === 'function') {
    const allowed = await authRule(user, ctx || { req });
    if (!allowed) {
      if (!user) {
        throw new UnauthorizedError(`Authentication required to access fragment "${fragmentName}".`);
      }
      throw new ForbiddenError(`Access denied to fragment "${fragmentName}".`);
    }
  }
}

/**
 * Wrap rendered inner HTML in the canonical `<div data-w-fragment="...">` root element.
 * Notice: ONLY validated filter/pagination `input` is serialized in `data-w-fragment-input`.
 * Server loader data (`fragmentData`) is NEVER serialized as props!
 */
function wrapFragmentRootHtml({
  name,
  instanceId,
  pagePath,
  dependsOn,
  validatedInput,
  innerHtml,
  tag = 'div',
  className = '',
  staleTime,
  refetchOnWindowFocus,
  refetchOnReconnect,
  refetchOnMount,
  refetchInterval,
  refetchIntervalInBackground,
  persistInput,
}) {
  const safeTag = /^[a-zA-Z][a-zA-Z0-9-]*$/.test(tag || 'div') ? tag : 'div';
  const attrs = [
    `data-w-fragment="${escapeHtmlAttr(name)}"`,
    `data-w-fragment-id="${escapeHtmlAttr(instanceId)}"`,
    `data-w-fragment-page="${escapeHtmlAttr(pagePath || '/')}"`,
  ];

  if (isArray(dependsOn) && dependsOn.length > 0) {
    attrs.push(`data-w-depends-on="${escapeHtmlAttr(dependsOn.join(','))}"`);
  }

  if (validatedInput && typeof validatedInput === 'object' && Object.keys(validatedInput).length > 0) {
    attrs.push(`data-w-fragment-input="${escapeHtmlAttr(JSON.stringify(validatedInput))}"`);
  }

  if (staleTime !== undefined && staleTime !== null && staleTime !== false) {
    attrs.push(`data-w-stale-time="${escapeHtmlAttr(String(staleTime))}"`);
  }

  if (refetchOnWindowFocus !== undefined && refetchOnWindowFocus !== null) {
    attrs.push(`data-w-refetch-on-focus="${escapeHtmlAttr(String(refetchOnWindowFocus))}"`);
  }

  if (refetchOnReconnect !== undefined && refetchOnReconnect !== null) {
    attrs.push(`data-w-refetch-on-reconnect="${escapeHtmlAttr(String(refetchOnReconnect))}"`);
  }

  if (refetchOnMount !== undefined && refetchOnMount !== null) {
    attrs.push(`data-w-refetch-on-mount="${escapeHtmlAttr(String(refetchOnMount))}"`);
  }

  if (refetchInterval !== undefined && refetchInterval !== null && refetchInterval !== false) {
    attrs.push(`data-w-refetch-interval="${escapeHtmlAttr(String(refetchInterval))}"`);
  }

  if (refetchIntervalInBackground !== undefined && refetchIntervalInBackground !== null) {
    attrs.push(`data-w-refetch-in-background="${escapeHtmlAttr(String(refetchIntervalInBackground))}"`);
  }

  if (persistInput !== undefined && persistInput !== null && persistInput !== false) {
    const persistAttrVal =
      persistInput === true || persistInput === 'input' ? 'session' : String(persistInput);
    attrs.push(`data-w-persist-input="${escapeHtmlAttr(persistAttrVal)}"`);
  }

  if (className) {
    attrs.push(`class="${escapeHtmlAttr(className)}"`);
  }

  return `<${safeTag} ${attrs.join(' ')}>${innerHtml}</${safeTag}>`;
}

/**
 * Execute a single fragment's auth, validation, `load()` and Nunjucks template render.
 * Can run synchronously if `fragmentDef.load` is sync and has no async auth/middlewares,
 * or asynchronously when `load` returns a Promise.
 *
 * @param {object} params
 * @param {string} params.name - Fragment name
 * @param {object} params.fragmentDef - Fragment definition from page module
 * @param {string} params.instanceId - DOM instance ID
 * @param {string} params.pagePath - Canonical page route path
 * @param {Record<string, unknown>} params.rawInput - Filter/pagination input
 * @param {object} params.req - HTTP request
 * @param {object} params.res - HTTP response
 * @param {object} params.ctx - Route context
 * @param {object} params.nunjucksEnv - Nunjucks Environment
 * @param {object} [params.baseRenderCtx] - Base template variables (fsy, user, etc.)
 * @param {object} [params.options] - Optional wrapper options ({ tag, class })
 * @param {Set<string>} [params.renderedInstanceIds] - Tracks rendered instanceIds in current pass for parent/child dedup
 */
async function executeAndRenderFragment({
  name,
  fragmentDef,
  instanceId,
  pagePath,
  rawInput = {},
  req,
  res,
  ctx,
  nunjucksEnv,
  baseRenderCtx = {},
  options = {},
  renderedInstanceIds = null,
}) {
  if (!fragmentDef || typeof fragmentDef !== 'object' || typeof fragmentDef.template !== 'string') {
    throw new NotFoundError(`Fragment "${name}" is not registered on page "${pagePath}".`);
  }

  // Prevent path traversal or arbitrary template injection
  const cleanTemplate = fragmentDef.template.trim().replace(/^\/+/, '');
  if (cleanTemplate.includes('..')) {
    throw new BadRequestError(`Invalid template path for fragment "${name}".`);
  }

  ensureRequestMemo(req, ctx);

  // 1. Run fragment-specific middlewares if any
  if (isArray(fragmentDef.middleware) && fragmentDef.middleware.length > 0) {
    await runMiddlewares(fragmentDef.middleware, req, res);
  }

  // 2. Enforce fragment-level auth guard
  await enforceFragmentAuth(name, fragmentDef, req, ctx);

  // 3. Validate & coerce fragment input
  const validatedInput = validateFragmentInput(name, fragmentDef, rawInput);

  // 4. Execute fragment loader (`load(fragmentCtx)`)
  const loadStart = Date.now();
  let fragmentData = {};
  if (typeof fragmentDef.load === 'function') {
    const fragmentCtx = {
      ...ctx,
      req,
      res,
      input: validatedInput,
      fragment: {
        name,
        instanceId,
        pagePath,
        input: validatedInput,
      },
    };
    const loaded = await fragmentDef.load(fragmentCtx);
    if (loaded && typeof loaded === 'object') {
      fragmentData = loaded;
    }
  }
  const loadMs = Math.max(0, Date.now() - loadStart);

  // 5. Render fragment template via Nunjucks
  const renderStart = Date.now();
  const templateCtx = {
    ...(res && res.locals ? res.locals : {}),
    ...baseRenderCtx,
    ...fragmentData,
    fragmentInput: validatedInput,
    fragmentId: instanceId,
    fragmentName: name,
  };

  let innerHtml = nunjucksEnv.render(cleanTemplate, templateCtx);
  // Resolve any nested async SSR fragments inside this fragment
  innerHtml = await resolvePendingSsrFragments(innerHtml, req);
  const renderMs = Math.max(0, Date.now() - renderStart);

  if (renderedInstanceIds) {
    renderedInstanceIds.add(instanceId);
  }

  const html = wrapFragmentRootHtml({
    name,
    instanceId,
    pagePath,
    dependsOn: fragmentDef.dependsOn || [],
    validatedInput,
    innerHtml,
    tag: options.tag || 'div',
    className: options.class || options.className || '',
    staleTime: options.staleTime !== undefined ? options.staleTime : fragmentDef.staleTime,
    refetchOnWindowFocus:
      options.refetchOnWindowFocus !== undefined
        ? options.refetchOnWindowFocus
        : options.refetchOnFocus !== undefined
          ? options.refetchOnFocus
          : fragmentDef.refetchOnWindowFocus,
    refetchOnReconnect:
      options.refetchOnReconnect !== undefined ? options.refetchOnReconnect : fragmentDef.refetchOnReconnect,
    refetchOnMount:
      options.refetchOnMount !== undefined
        ? options.refetchOnMount
        : options.refetchOnVisit !== undefined
          ? options.refetchOnVisit
          : fragmentDef.refetchOnMount,
    refetchInterval:
      options.refetchInterval !== undefined ? options.refetchInterval : fragmentDef.refetchInterval,
    refetchIntervalInBackground:
      options.refetchIntervalInBackground !== undefined
        ? options.refetchIntervalInBackground
        : fragmentDef.refetchIntervalInBackground,
    persistInput:
      options.persistInput !== undefined
        ? options.persistInput
        : options.persist !== undefined
          ? options.persist
          : fragmentDef.persistInput,
  });

  return {
    instanceId,
    name,
    html,
    innerHtml,
    input: validatedInput,
    loadMs,
    renderMs,
  };
}

/**
 * Create the `fsy.fragment(name, input?, options?)` template helper for a page render pass.
 * Uses the exact same `executeAndRenderFragment` pipeline for initial SSR as subsequent refreshes!
 */
function attachSsrFragmentHelper({ req, res, ctx, pageMod, pagePath, nunjucksEnv, fsy, getRenderCtx }) {
  if (!req.__pendingSsrFragments) {
    req.__pendingSsrFragments = [];
  }
  if (!req.__ssrFragmentCounts) {
    req.__ssrFragmentCounts = new Map();
  }
  if (!req.__renderedFragmentInstances) {
    req.__renderedFragmentInstances = new Set();
  }

  const fragmentsMap = (pageMod && pageMod.fragments) || {};

  function renderFragmentHelper(name, rawInput = {}, options = {}) {
    const cleanName = String(name || '').trim();
    const fragmentDef = fragmentsMap[cleanName];
    if (!fragmentDef) {
      throw new NotFoundError(
        `Fragment "${cleanName}" is not defined in fragments export for page "${pagePath}".`
      );
    }

    const count = (req.__ssrFragmentCounts.get(cleanName) || 0) + 1;
    req.__ssrFragmentCounts.set(cleanName, count);

    const instanceId =
      (options && (options.id || options.instanceId)) ||
      (count === 1 ? `${cleanName}:default` : `${cleanName}:${count}`);

    const currentRenderCtx = typeof getRenderCtx === 'function' ? getRenderCtx() : { fsy };

    // If refreshing a parent fragment that contains this nested child fragment,
    // merge the active client-side child input (`req.__fragmentChildInputs`) over static template defaults
    const childInputs = req && req.__fragmentChildInputs;
    let effectiveRawInput = rawInput || {};
    if (childInputs && typeof childInputs === 'object') {
      const override = Object.prototype.hasOwnProperty.call(childInputs, instanceId)
        ? childInputs[instanceId]
        : instanceId === `${cleanName}:default` && Object.prototype.hasOwnProperty.call(childInputs, cleanName)
          ? childInputs[cleanName]
          : undefined;
      if (override && typeof override === 'object' && !isArray(override)) {
        effectiveRawInput =
          effectiveRawInput && typeof effectiveRawInput === 'object' && !isArray(effectiveRawInput)
            ? { ...effectiveRawInput, ...override }
            : { ...override };
      }
    }

    // Queue execution on `req.__pendingSsrFragments` and return placeholder token
    const placeholderIndex = req.__pendingSsrFragments.length;
    const token = `<!--__WEBSPRESSO_SSR_FRAGMENT_${placeholderIndex}__-->`;

    const promise = executeAndRenderFragment({
      name: cleanName,
      fragmentDef,
      instanceId,
      pagePath,
      rawInput: effectiveRawInput,
      req,
      res,
      ctx,
      nunjucksEnv,
      baseRenderCtx: { ...currentRenderCtx, fsy },
      options: options || {},
      renderedInstanceIds: req.__renderedFragmentInstances,
    });

    req.__pendingSsrFragments.push({
      token,
      promise,
    });

    return markSafeHtml(token);
  }

  if (fsy && typeof fsy === 'object') {
    fsy.fragment = renderFragmentHelper;
  }
  if (ctx && typeof ctx === 'object') {
    ctx.fragment = renderFragmentHelper;
  }

  return renderFragmentHelper;
}

/**
 * Resolve all `<!--__WEBSPRESSO_SSR_FRAGMENT_N__-->` placeholders generated during Nunjucks rendering.
 * Loops until all nested fragments are also resolved.
 *
 * @param {string} html
 * @param {object} req
 * @returns {Promise<string>}
 */
async function resolvePendingSsrFragments(html, req) {
  if (typeof html !== 'string' || !req || !isArray(req.__pendingSsrFragments)) {
    return html;
  }

  let output = html;
  while (req.__pendingSsrFragments.length > 0 && output.includes('<!--__WEBSPRESSO_SSR_FRAGMENT_')) {
    const batch = req.__pendingSsrFragments.splice(0, req.__pendingSsrFragments.length);
    const resolvedList = await Promise.all(
      batch.map(async (item) => {
        const res = await item.promise;
        return { token: item.token, html: res.html };
      })
    );
    for (const item of resolvedList) {
      output = output.split(item.token).join(item.html);
    }
  }

  return output;
}

function trimTrailingSlashes(str) {
  if (!str) return '';
  let end = str.length;
  while (end > 0 && str.charCodeAt(end - 1) === 47) {
    end--;
  }
  return end === str.length ? str : str.slice(0, end);
}

/**
 * Match a concrete request pathname (e.g. `/notes/42`) against discovered page route entries.
 * Extracts route `:params` when matched.
 *
 * @param {string} pagePath
 * @param {Array<object>} pageEntries
 * @returns {{ entry: object, params: Record<string, string> }|null}
 */
function matchPageEntryByPath(pagePath, pageEntries) {
  if (!pagePath || !isArray(pageEntries)) return null;
  const cleanPath = trimTrailingSlashes(String(pagePath).split('?')[0]) || '/';

  // 1. Exact static match
  for (const entry of pageEntries) {
    const routePattern = trimTrailingSlashes(entry.routePath) || '/';
    if (routePattern === cleanPath) {
      return { entry, params: {} };
    }
  }

  // 2. Dynamic `:param` match
  for (const entry of pageEntries) {
    const routePattern = trimTrailingSlashes(entry.routePath) || '/';
    if (!routePattern.includes(':')) continue;
    const paramNames = [];
    const regexSource =
      '^' +
      routePattern
        .split('/')
        .map((seg) => {
          if (seg.startsWith(':')) {
            paramNames.push(seg.slice(1));
            return '([^/]+)';
          }
          return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/') +
      '$';
    const match = new RegExp(regexSource).exec(cleanPath);
    if (match) {
      const params = {};
      for (let i = 0; i < paramNames.length; i++) {
        try {
          params[paramNames[i]] = decodeURIComponent(match[i + 1]);
        } catch (_e) {
          params[paramNames[i]] = match[i + 1];
        }
      }
      return { entry, params };
    }
  }

  return null;
}

/**
 * Create the `/__webspresso/fragments` HTTP handler for refreshing one or more registered fragments.
 *
 * @param {object} config
 * @param {() => Array<object>} config.getPageEntries - Returns discovered page route descriptors
 * @param {object} config.nunjucksEnv - Nunjucks Environment
 * @param {Function} config.buildFsy - `(req) => fsy` helper builder
 * @param {Function} config.buildContext - `(req, res, extra) => ctx` context builder
 * @param {Function} [config.resolveMiddlewareList] - Resolves named middlewares
 */
function createFragmentRefreshHandler(config) {
  const {
    getPageEntries,
    nunjucksEnv,
    buildFsy,
    buildContext,
    resolveMiddlewareList,
  } = config;

  return async function handleFragmentRefresh(req, res, next) {
    const startTotal = Date.now();
    try {
      const isGet = req.method === 'GET';
      if (!isGet && req.headers && req.headers['sec-fetch-site'] === 'cross-site') {
        throw new ForbiddenError('Cross-site fragment refresh requests are forbidden.');
      }
      const payload = isGet ? req.query || {} : req.body || {};

      const pagePath = payload.pagePath || payload.page || req.headers['x-webspresso-page'] || '/';
      let requestedFragments = [];

      if (isGet) {
        const name = payload.name || payload.fragment;
        if (!name) {
          throw new BadRequestError('Fragment refresh request requires a fragment `name` or `fragments` array.');
        }
        let parsedInput = {};
        if (typeof payload.input === 'string' && payload.input.trim()) {
          try {
            parsedInput = JSON.parse(payload.input);
          } catch (_e) {
            throw new BadRequestError('Invalid JSON in fragment `input` query parameter.');
          }
        }
        requestedFragments = [
          {
            instanceId: payload.instanceId || `${name}:default`,
            name: String(name),
            input: parsedInput,
          },
        ];
      } else {
        if (!isArray(payload.fragments) || payload.fragments.length === 0) {
          throw new BadRequestError('Fragment refresh request requires a non-empty `fragments` array.');
        }
        requestedFragments = payload.fragments;
      }

      const pageEntries = typeof getPageEntries === 'function' ? getPageEntries() : [];
      const matched = matchPageEntryByPath(pagePath, pageEntries);
      if (!matched) {
        throw new NotFoundError(`No registered page route matches "${pagePath}".`);
      }

      const { entry, params } = matched;
      req.params = { ...(req.params || {}), ...params };

      const pageMod = typeof entry.getPageMod === 'function' ? entry.getPageMod() : entry.pageMod;
      const fragmentsMap = (pageMod && pageMod.fragments) || {};

      // Validate that all requested fragments are registered on this page BEFORE running loaders
      // (Rejects arbitrary template paths or unknown fragment names)
      for (const item of requestedFragments) {
        if (!item || typeof item.name !== 'string' || !item.name.trim()) {
          throw new BadRequestError('Each fragment refresh item must specify a registered fragment `name`.');
        }
        if (item.template) {
          throw new BadRequestError('Client cannot specify arbitrary template paths in fragment refresh requests.');
        }
        if (!Object.prototype.hasOwnProperty.call(fragmentsMap, item.name)) {
          throw new NotFoundError(`Fragment "${item.name}" is not registered on page "${entry.routePath}".`);
        }
      }

      // 1. Execute page-level cascading middlewares (`_hooks.js`) and page route `middleware`
      if (isArray(entry.cascadingMiddlewares) && entry.cascadingMiddlewares.length > 0) {
        await runMiddlewares(entry.cascadingMiddlewares, req, res);
        if (res.headersSent) return;
      }

      if (pageMod && isArray(pageMod.middleware) && pageMod.middleware.length > 0) {
        const resolvedPageMws =
          typeof resolveMiddlewareList === 'function'
            ? resolveMiddlewareList(pageMod.middleware)
            : pageMod.middleware;
        await runMiddlewares(resolvedPageMws, req, res);
        if (res.headersSent) return;
      }

      // 2. Enforce page-level `auth` if configured on `pageMod`
      if (pageMod && pageMod.auth) {
        await enforceFragmentAuth(entry.routePath, { auth: pageMod.auth }, req, { req, res });
      }

      // 3. Build request context & `fsy` helper with request-scoped memoization
      const fsy = typeof buildFsy === 'function' ? buildFsy(req) : {};
      const ctx = typeof buildContext === 'function' ? buildContext(req, res, { fsy }) : { req, res, fsy };
      ensureRequestMemo(req, ctx);

      req.__fragmentChildInputs =
        payload.childInputs && typeof payload.childInputs === 'object' && !isArray(payload.childInputs)
          ? payload.childInputs
          : null;

      const renderedInstanceIds = new Set();
      attachSsrFragmentHelper({
        req,
        res,
        ctx,
        pageMod,
        pagePath,
        nunjucksEnv,
        fsy,
        getRenderCtx: () => ({ fsy }),
      });

      const results = {};
      const fragmentErrors = {};
      let firstError = null;

      for (const reqItem of requestedFragments) {
        const fragName = reqItem.name.trim();
        const instanceId = reqItem.instanceId ? String(reqItem.instanceId).trim() : `${fragName}:default`;

        // Parent/child deduplication: if a parent fragment rendered earlier in this batch
        // already rendered this child `instanceId`, skip redundant child execution!
        if (renderedInstanceIds.has(instanceId)) {
          continue;
        }

        const rawFragDef = fragmentsMap[fragName];
        const fragDef = {
          ...rawFragDef,
          middleware:
            rawFragDef.middleware && typeof resolveMiddlewareList === 'function'
              ? resolveMiddlewareList(rawFragDef.middleware)
              : rawFragDef.middleware || [],
        };

        try {
          const rendered = await executeAndRenderFragment({
            name: fragName,
            fragmentDef: fragDef,
            instanceId,
            pagePath,
            rawInput: reqItem.input || {},
            req,
            res,
            ctx,
            nunjucksEnv,
            baseRenderCtx: { fsy },
            renderedInstanceIds,
          });

          results[instanceId] = {
            instanceId: rendered.instanceId,
            name: rendered.name,
            html: rendered.html,
            input: rendered.input,
            loadMs: rendered.loadMs,
            renderMs: rendered.renderMs,
          };
        } catch (fragErr) {
          if (!firstError) firstError = fragErr;
          fragmentErrors[instanceId] = {
            instanceId,
            name: fragName,
            status: fragErr.statusCode || fragErr.status || 500,
            code: fragErr.code || 'FRAGMENT_REFRESH_ERROR',
            message: fragErr.message || `Failed to render fragment "${fragName}"`,
          };
        }
      }

      if (firstError && Object.keys(results).length === 0) {
        return next(firstError);
      }

      const totalMs = Math.max(0, Date.now() - startTotal);
      res.setHeader('Cache-Control', 'no-store');
      const hasPartialErrors = Object.keys(fragmentErrors).length > 0;
      return res.status(200).json({
        ok: !hasPartialErrors,
        ...(hasPartialErrors ? { partial: true, errors: fragmentErrors } : {}),
        pagePath,
        totalMs,
        fragments: results,
      });
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  defineFragment,
  apiResult,
  isApiResultEnvelope,
  sendApiResult,
  ensureRequestMemo,
  validateFragmentInput,
  enforceFragmentAuth,
  wrapFragmentRootHtml,
  executeAndRenderFragment,
  attachSsrFragmentHelper,
  resolvePendingSsrFragments,
  matchPageEntryByPath,
  createFragmentRefreshHandler,
};


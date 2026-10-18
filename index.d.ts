/**
 * Type definitions for webspresso (CommonJS package).
 */

import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';
import type { Knex } from 'knex';
import type { ZodObject, ZodTypeAny } from 'zod';
import type { EventEmitter } from 'events';

/** Registered as createApp middlewares[name]: plain handler or (options) => handler (for middleware: ['name', options]). */
export type WebspressoRegisteredMiddleware =
  | RequestHandler
  | ((options: unknown) => RequestHandler);

// --- Express / app ---

export interface ErrorPageContext {
  fsy: Record<string, unknown>;
  locale: string;
  isDev: boolean;
  url: string;
  method: string;
  [key: string]: unknown;
}

export interface CreateAppOptions {
  pagesDir: string;
  viewsDir?: string;
  publicDir?: string;
  logging?: boolean;
  helmet?: boolean | Record<string, unknown>;
  middlewares?: Record<string, WebspressoRegisteredMiddleware>;
  plugins?: WebspressoPlugin[];
  assets?: {
    version?: string;
    manifestPath?: string;
    prefix?: string;
    publicDir?: string;
  };
  /**
   * If truthy, route load() return values for stylesheets and scripts are promoted to pageHead
   */
  pageAssets?:
    | boolean
    | {
        enabled?: boolean;
        stylesheets?: boolean;
        scripts?: boolean;
        auto?: boolean;
      };
  /** Trust proxy configuration (default: 1) */
  trustProxy?: boolean | number | string;
  /**
   * Custom 404 / 500 / 503 handlers. File-based route errors are forwarded with `next(err)` and hit `serverError` / `timeout`.
   * When `serverError` / `timeout` is a template path, it is not used for paths under `/api` (default JSON instead).
   */
  errorPages?: {
    notFound?: string | ((req: Request, res: Response, ctx: ErrorPageContext) => unknown);
    serverError?:
      | string
      | ((err: unknown, req: Request, res: Response, ctx: ErrorPageContext) => unknown);
    timeout?: string | ((req: Request, res: Response, ctx: ErrorPageContext) => unknown);
  };
  timeout?: string | false;
  /** Global timeouts configuration across server, services, background jobs, outgoing fetch, webhooks, and shutdown */
  timeouts?: {
    request?: number | string | false;
    service?: number | string | false;
    queue?: number | string | false;
    fetch?: number | string | false;
    webhook?: number | string | false;
    shutdown?: number | string | false;
    loader?: number | string | false;
  };
  auth?: unknown;
  db?: DatabaseInstance | null;
  /** HTTP response compression options */
  compression?: boolean | CompressionOptions;
  /** HTTP 103 Early Hints options (preloads CSS/JS before SSR finish) */
  earlyHints?: boolean | (string | EarlyHintLink)[] | EarlyHintsOptions;
  /** Payload size limits and DoS protection for JSON, URL-encoded, raw, and text bodies */
  limits?: string | number | PayloadLimitsConfig;
  /** Cloud & Kubernetes Health check probes (/healthz & /readyz) */
  healthCheck?: boolean | string | HealthCheckConfig;
  /** High-Performance In-Memory LRU & Tagged Cache options */
  cache?: boolean | LruCacheConfig;
  /** Shutdown and lifecycle configuration */
  shutdown?: ShutdownOptions;
  /**
   * Ahead-Of-Time (AOT) route manifest: boolean to enable/disable loading, or explicit path to manifest JSON file
   */
  routesManifest?: boolean | string;
  /**
   * Precompiled Nunjucks templates: boolean to enable/disable loading, or explicit path to compiled bundle file
   */
  precompiledTemplates?: boolean | string;
  /** Development tooling and DX options */
  dev?: {
    banner?: boolean;
    routeTable?: boolean;
    profiler?: boolean;
    nPlusOne?: boolean;
    nPlusOneThreshold?: number;
    slowQueryMs?: number;
    verbose?: boolean;
    colors?: boolean;
  };
  server?: {
    port?: number;
    shutdown?: ShutdownOptions;
    compression?: boolean | CompressionOptions;
    earlyHints?: boolean | (string | EarlyHintLink)[] | EarlyHintsOptions;
    limits?: string | number | PayloadLimitsConfig;
    healthCheck?: boolean | string | HealthCheckConfig;
    cache?: boolean | LruCacheConfig;
    trustProxy?: boolean | number | string;
    [key: string]: unknown;
  };
  /** Opt-in Alpine / swup assets under `/__webspresso/client-runtime/*`. Env: WEBSPRESSO_ALPINE, WEBSPRESSO_SWUP. */
  clientRuntime?: {
    alpine?: boolean | Record<string, unknown>;
    swup?: boolean | Record<string, unknown>;
  };
  /** Path to services directory (auto-discovered) */
  servicesDir?: string;
  services?: {
    dir?: string;
  };
  /** Development SSE live/hot reload configuration */
  devReload?: boolean | DevReloadOptions;
  /** Client-side JS incremental bundler (esbuild context() API) */
  bundle?: boolean | DevBundlerOptions;
  setupRoutes?: (app: Application, ctx: SetupRoutesContext) => void;
  [key: string]: unknown;
}

export interface DevReloadOptions {
  enabled?: boolean;
  watch?: string[];
  watchCss?: boolean;
  watchTemplates?: boolean;
  watchPublicAll?: boolean;
  templateExtensions?: string[];
  pageExtensions?: string[];
  autoInject?: boolean;
  debounce?: number;
}

export interface DevReloadHub {
  broadcast(type: 'css' | 'full' | 'error' | 'clear-error' | string, payload?: Record<string, unknown>): void;
  close(): void;
  getClientsCount(): number;
  getWatchersCount(): number;
  getWatchedPaths(): string[];
  attachNunjucks(env: unknown): void;
  setOnTemplateChange(fn: (file?: string) => void): void;
  invalidateTemplateCache(file?: string): void;
  triggerTemplateReload(filename?: string, reason?: string): void;
  triggerCssReload(filename?: string): void;
  handleSse(req: any, res: any): void;
  handleScript(req: any, res: any): void;
  autoInjectMiddleware(req: any, res: any, next: () => void): void;
}

export interface DevBundlerOptions {
  enabled?: boolean;
  entryPoints?: string[] | Record<string, string>;
  outdir?: string;
  bundle?: boolean;
  sourcemap?: boolean;
  minify?: boolean;
  target?: string | string[];
  format?: string;
  metafile?: boolean;
  plugins?: any[];
  esbuild?: any;
  watch?: boolean;
  esbuildOptions?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DevBundler {
  isAvailable(): boolean;
  isWatching(): boolean;
  isDisposed(): boolean;
  getEntryPoints(): string[] | Record<string, string>;
  getOutdir(): string;
  startWatch(): Promise<any>;
  rebuild(): Promise<any>;
  dispose(): Promise<void>;
  getContext(): any;
}

export interface BuildBundleResult {
  result: unknown;
  manifest: Record<string, unknown>;
  manifestPath: string;
}

export function createDevBundler(options?: DevBundlerOptions, devReloadHub?: unknown): DevBundler;
export function buildBundle(options?: DevBundlerOptions): Promise<BuildBundleResult>;
export function generateManifest(metafile: unknown, options?: unknown): Record<string, unknown>;
export function createManifestPlugin(options?: unknown): unknown;
export function findDefaultEntryPoints(cwd?: string): string[] | Record<string, string>;
export function findPageEntryPoints(cwd?: string): Record<string, string>;

export interface ServiceContext {
  req?: Request;
  res?: Response;
  db?: DatabaseInstance | null;
  fsy?: Record<string, unknown>;
  locale?: string;
  t?: unknown;
  service?: {
    <T = unknown>(name: string, input?: unknown, options?: unknown): Promise<T>;
    invalidate?: (name: string, input?: unknown, ctx?: unknown) => boolean;
    clearCache?: (name?: string) => boolean;
  };
  [key: string]: unknown;
}

export type ServiceHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  ctx: ServiceContext
) => Promise<TOutput> | TOutput;

export interface ServiceDefinition<TInput = unknown, TOutput = unknown> {
  schema?: import('zod').ZodType<any> | Record<string, unknown> | ((input: unknown) => unknown) | null;
  handler: ServiceHandler<TInput, TOutput>;
  metadata?: Record<string, unknown>;
  auth?: boolean | string | string[] | ((user: unknown, ctx: ServiceContext) => boolean | Promise<boolean>);
  cache?:
    | boolean
    | string
    | number
    | {
        ttl?: string | number;
        key?: string | ((input: unknown, ctx: ServiceContext) => string);
      };
  timeout?: number | string;
  transaction?: boolean;
  [key: string]: unknown;
}

export class ServiceRegistry {
  constructor(options?: { servicesDir?: string; isDev?: boolean; logger?: unknown });
  readonly services: Map<string, ServiceDefinition>;
  load(): this;
  register(name: string, definition: ServiceDefinition | ServiceHandler): this;
  get(name: string): ServiceDefinition | undefined;
  has(name: string): boolean;
  list(): string[];
  invalidate(name: string, input?: unknown, ctx?: unknown): boolean;
  clearCache(name?: string): boolean;
  call<T = unknown>(name: string, input?: unknown, ctx?: unknown, options?: unknown): Promise<T>;
  reload(): this;
}

export function createServiceRegistry(options?: {
  servicesDir?: string;
  isDev?: boolean;
  logger?: unknown;
  autoLoad?: boolean;
}): ServiceRegistry;

export type InferServiceInput<T> = T extends ServiceDefinition<infer TInput, any>
  ? TInput
  : T extends { schema: import('zod').ZodType<infer TInput> }
    ? TInput
    : T extends (input: infer TInput, ...args: any[]) => any
      ? TInput
      : unknown;

export type InferServiceOutput<T> = T extends ServiceDefinition<any, infer TOutput>
  ? TOutput
  : T extends (...args: any[]) => Promise<infer TOutput>
    ? TOutput
    : T extends (...args: any[]) => infer TOutput
      ? TOutput
      : unknown;

export function defineService<TInput = unknown, TOutput = unknown>(
  definition: ServiceDefinition<TInput, TOutput> | ServiceHandler<TInput, TOutput>
): ServiceDefinition<TInput, TOutput>;

export const service: typeof defineService;

export interface MemoizeOptions {
  ttl?: string | number | boolean;
  maxSize?: number;
  key?: (input: unknown, ctx?: unknown) => string;
}

export interface MemoizedFunction<TArgs extends unknown[], TReturn> {
  (...args: TArgs): Promise<TReturn>;
  invalidate(...args: TArgs): boolean;
  delete(...args: TArgs): boolean;
  clear(): void;
  has(...args: TArgs): boolean;
  readonly size: number;
}

export function memoize<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn> | TReturn,
  options?: MemoizeOptions
): MemoizedFunction<TArgs, TReturn>;

export function parseTtlMs(ttl: string | number | boolean): number;

export function stableCacheKey(input: unknown): string;

export function sanitizeInput<T = unknown>(input: T): T;

export function maskSensitiveData<T = unknown>(data: T, customRedactKeys?: string[]): T;

export function discoverServices(
  servicesDir: string
): Array<{ name: string; aliases: string[]; filePath: string; relativePath: string }>;

export function filePathToServiceName(relativePath: string): { name: string; aliases: string[] };

export function toCamelCase(str: string): string;

export function createAuthServices(options?: {
  userModel?: string;
  fields?: Record<string, string>;
}): Record<string, ServiceDefinition>;

export function createMailServices(options?: {
  emailService: unknown;
  registry?: unknown;
  db?: unknown;
  tableName?: string;
}): Record<string, ServiceDefinition>;

export function createMediaServices(options?: {
  provider?: unknown;
  destDir?: string;
  publicBasePath?: string;
}): Record<string, ServiceDefinition>;

export function createFileManagerServices(options?: {
  baseDir?: string;
  publicBasePath?: string;
}): Record<string, ServiceDefinition>;

export function createSystemServices(options?: {
  db?: unknown;
  serviceRegistry?: unknown;
  pluginManager?: unknown;
}): Record<string, ServiceDefinition>;

export function createExchangeServices(options?: {
  db?: unknown;
}): Record<string, ServiceDefinition>;

export function validateServiceInput(schema: unknown, input: unknown, serviceName: string): unknown;

export function executeService(
  registry: ServiceRegistry,
  name: string,
  input?: unknown,
  ctx?: unknown,
  options?: unknown
): Promise<unknown>;

export interface CompressionOptions {
  enabled?: boolean;
  threshold?: number;
  level?: number;
  encodings?: string[];
  filter?: (req: Request, res: Response) => boolean;
  brotli?: Record<string, unknown>;
  gzip?: Record<string, unknown>;
  deflate?: Record<string, unknown>;
}

export interface ShutdownOptions {
  enabled?: boolean;
  mode?: 'graceful' | 'force';
  timeout?: number;
  signals?: string[];
  logger?: unknown;
  exitOnSignal?: boolean;
}

export interface EarlyHintLink {
  url?: string;
  href?: string;
  rel?: 'preload' | 'preconnect' | 'prefetch' | 'modulepreload' | 'dns-prefetch' | string;
  as?: 'style' | 'script' | 'font' | 'image' | 'fetch' | 'video' | 'audio' | string;
  crossOrigin?: boolean | '' | 'anonymous' | 'use-credentials';
  crossorigin?: boolean | '' | 'anonymous' | 'use-credentials';
  type?: string;
  media?: string;
  fetchPriority?: 'high' | 'low' | 'auto';
  fetchpriority?: 'high' | 'low' | 'auto';
  noPush?: boolean;
  nopush?: boolean;
}

export interface EarlyHintsOptions {
  enabled?: boolean;
  auto?: boolean;
  links?: (string | EarlyHintLink)[] | ((req: Request) => (string | EarlyHintLink)[]);
}

export interface ServerAdapter {
  close(): Promise<void>;
  forceClose?(): void;
  closeIdleConnections?(): void;
}

export class NodeHttpAdapter implements ServerAdapter {
  constructor(server: unknown);
  close(): Promise<void>;
  forceClose(): void;
  closeIdleConnections(): void;
  destroy(): void;
  readonly isListening: boolean;
}

export class ShutdownManager {
  constructor(options?: ShutdownOptions);
  readonly isShuttingDown: boolean;
  readonly isClosed: boolean;
  mode: 'graceful' | 'force';
  timeout: number;
  onShutdown(fn: () => Promise<void> | void): this;
  registerDisposer(nameOrFn: string | (() => Promise<void> | void), maybeFn?: () => Promise<void> | void): this;
  registerAdapter(adapter: ServerAdapter): this;
  enableShutdownHooks(): this;
  disableShutdownHooks(): this;
  close(reason?: string): Promise<void>;
}

export interface SetupRoutesContext {
  nunjucksEnv: unknown;
  authMiddleware?: RequestHandler;
  pluginManager: PluginManager;
  options: CreateAppOptions;
  clientRuntime: { alpine: boolean; swup: boolean };
}

export interface WebspressoApplication extends Application {
  server?: unknown;
  readonly isShuttingDown: boolean;
  shutdownManager: ShutdownManager;
  serviceRegistry: ServiceRegistry;
  onShutdown(fn: () => Promise<void> | void): this;
  close(reason?: string): Promise<void>;
  enableShutdownHooks(): this;
  disableShutdownHooks(): this;
  setErrorHandler(handler: (error: unknown, req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown): this;
  broadcastDevReload?(type: 'css' | 'full' | string, payload?: Record<string, unknown>): void;
  devReloadHub?: DevReloadHub;
  devBundler?: DevBundler;
  printDevBanner?(opts?: Record<string, unknown>): void;
  formatDevBanner?(opts?: Record<string, unknown>): { bannerText: string; plainText: string; summary: Record<string, unknown> };
}

export interface CreateAppResult {
  app: WebspressoApplication;
  nunjucksEnv: unknown;
  pluginManager: PluginManager;
  authMiddleware?: RequestHandler;
  shutdownManager: ShutdownManager;
}

export function createApp(options?: CreateAppOptions): CreateAppResult;

export function formatDevBanner(context?: Record<string, unknown>, options?: Record<string, unknown>): { bannerText: string; plainText: string; summary: Record<string, unknown> };
export function printDevBanner(context?: Record<string, unknown>, options?: Record<string, unknown>): void;
export function formatRouteTable(routeTable: unknown, options?: Record<string, unknown>): string;
export function createDevProfilerMiddleware(options?: Record<string, unknown>): RequestHandler;

// --- Exceptions & Errors ---

export interface ErrorOptions {
  code?: string;
  details?: unknown;
  cause?: unknown;
  status?: number;
  headers?: Record<string, string>;
  expose?: boolean;
  [key: string]: unknown;
}

export class WebspressoError extends Error {
  name: string;
  code?: string;
  details?: unknown;
  cause?: unknown;
  status?: number;
  constructor(message: string, options?: ErrorOptions);
}

export class HttpError extends WebspressoError {
  status: number;
  headers: Record<string, string>;
  expose: boolean;
  constructor(status?: number, message?: string, options?: ErrorOptions);
}

export class BadRequestError extends HttpError { constructor(message?: string, options?: ErrorOptions); }
export class UnauthorizedError extends HttpError { constructor(message?: string, options?: ErrorOptions); }
export class ForbiddenError extends HttpError { constructor(message?: string, options?: ErrorOptions); }
export class NotFoundError extends HttpError { constructor(message?: string, options?: ErrorOptions); }
export class MethodNotAllowedError extends HttpError { constructor(message?: string, options?: ErrorOptions); }
export class ConflictError extends HttpError { constructor(message?: string, options?: ErrorOptions); }
export class PayloadTooLargeError extends HttpError { constructor(message?: string, options?: ErrorOptions); }
export class UnsupportedMediaTypeError extends HttpError { constructor(message?: string, options?: ErrorOptions); }
export class UnprocessableEntityError extends HttpError { constructor(message?: string, options?: ErrorOptions); }
export class RequestTimeoutError extends HttpError { constructor(message?: string, options?: ErrorOptions); }
export class TooManyRequestsError extends HttpError { constructor(message?: string, options?: ErrorOptions); }
export class ServiceUnavailableError extends HttpError { constructor(message?: string, options?: ErrorOptions); }
export class GatewayTimeoutError extends HttpError { constructor(message?: string, options?: ErrorOptions); }

export class ValidationError extends HttpError {
  fields: Record<string, string[] | string>;
  constructor(message?: string, options?: ErrorOptions & { fields?: Record<string, string[] | string> });
}

export class ConfigurationError extends WebspressoError { constructor(message: string, options?: ErrorOptions); }
export class PluginError extends WebspressoError { plugin?: string | null; constructor(message: string, options?: ErrorOptions & { plugin?: string }); }
export class SecurityError extends HttpError { constructor(message?: string, options?: ErrorOptions); }
export class RequestError extends HttpError { constructor(status?: number, message?: string, options?: ErrorOptions); }
export class RequestAbortedError extends RequestError { constructor(message?: string, options?: ErrorOptions); }
export class RouterError extends WebspressoError { constructor(message: string, options?: ErrorOptions); }
export class RouteNotFoundError extends NotFoundError { path?: string; constructor(pathOrMessage?: string, options?: ErrorOptions); }
export class RouteGenerationError extends RouterError { constructor(message: string, options?: ErrorOptions); }

export function normalizeError(err: unknown, isDev?: boolean): HttpError | WebspressoError;
export function toErrorResponseObject(error: unknown, isDev?: boolean): Record<string, unknown>;

export function createCompressionMiddleware(options?: CompressionOptions): RequestHandler;

export namespace compression {
  export function supportsBrotli(): boolean;
  export function getDefaultSupportedEncodings(includeBrotli?: boolean): string[];
  export function parseAcceptEncoding(header?: string | null): Array<{ encoding: string; q: number; index: number }>;
  export function selectEncoding(acceptEncoding?: string | null, supportedEncodings?: string[]): string | null;
  export function isCompressible(contentType?: string | null): boolean;
  export function createCompressionStream(encoding: string, options?: CompressionOptions): unknown;
  export function createCompressionMiddleware(options?: CompressionOptions): RequestHandler;
  export function appendVary(res: unknown, field: string): void;
}

export function createEarlyHintsMiddleware(options?: boolean | EarlyHintsOptions): RequestHandler;
export function sendEarlyHints(
  res: unknown,
  hints: string | EarlyHintLink | (string | EarlyHintLink)[] | Record<string, unknown>,
  callback?: (err?: Error | null) => void
): boolean;
export function formatLink(item: string | EarlyHintLink): string | null;
export function formatLinkHeader(links: string | EarlyHintLink | (string | EarlyHintLink)[]): string[];
export function inferAsType(url: string): string | null;

export namespace earlyHints {
  export const EXTENSION_AS_MAP: Record<string, string>;
  export function inferAsType(url: string): string | null;
  export function formatLink(item: string | EarlyHintLink): string | null;
  export function formatLinkHeader(links: string | EarlyHintLink | (string | EarlyHintLink)[]): string[];
  export function sendEarlyHints(
    res: unknown,
    hints: string | EarlyHintLink | (string | EarlyHintLink)[] | Record<string, unknown>,
    callback?: (err?: Error | null) => void
  ): boolean;
  export function createEarlyHintsMiddleware(options?: boolean | EarlyHintsOptions): RequestHandler;
}

export interface PayloadLimitParserConfig {
  enabled?: boolean;
  limit?: string | number;
  strict?: boolean;
  extended?: boolean;
  parameterLimit?: number;
  type?: string | ((req: Request) => boolean);
  verify?: (req: Request, res: Response, buf: Buffer, encoding: string) => void;
  [key: string]: unknown;
}

export interface PayloadLimitsConfig {
  /** Size limit for application/json (default: '1mb') or false to disable */
  json?: string | number | boolean | PayloadLimitParserConfig;
  /** Size limit for application/x-www-form-urlencoded (default: '1mb') or false to disable */
  urlencoded?: string | number | boolean | PayloadLimitParserConfig;
  /** Size limit for application/octet-stream (default: false / disabled) */
  raw?: string | number | boolean | PayloadLimitParserConfig;
  /** Size limit for text/plain (default: false / disabled) */
  text?: string | number | boolean | PayloadLimitParserConfig;
  /** Maximum number of URL-encoded parameters (default: 1000) */
  parameterLimit?: number;
  /** Capture raw request body Buffer to req.rawBody (e.g. for webhook signatures) */
  captureRawBody?: boolean | (string | RegExp)[] | ((req: Request) => boolean);
  /** Path prefixes or patterns excluded from global body parsing */
  exclude?: (string | RegExp)[];
  /** Per-route payload limits or false to disable body parsing */
  routes?: Record<string, string | number | boolean | PayloadLimitsConfig>;
}

export function normalizeLimits(options?: unknown): unknown;
export function setupLimitsMiddleware(app: Application, options?: unknown): unknown;
export function createLimitsMiddleware(routeOptions?: unknown): RequestHandler;
export function parseByteSize(value: string | number): number | string;

export namespace limits {
  export const DEFAULT_LIMITS: Record<string, unknown>;
  export function parseByteSize(value: string | number): number | string;
  export function normalizeLimits(options?: unknown): unknown;
  export function matchesPath(pattern: string | RegExp | Function, pathname: string): boolean;
  export function shouldSkipBodyParser(req: Request, excludeList?: unknown[]): boolean;
  export function shouldCaptureRawBody(req: Request, captureSetting?: unknown): boolean;
  export function createLimitsMiddleware(routeOptions?: unknown): RequestHandler;
  export function setupLimitsMiddleware(app: Application, options?: unknown): unknown;
}

export interface HealthCheckConfig {
  /** Enable or disable health check endpoints (default: true if healthCheck option is provided) */
  enabled?: boolean;
  /** Liveness endpoint path (default: '/healthz', or false to disable) */
  path?: string | false;
  /** Readiness endpoint path (default: '/readyz', or false to disable) */
  readyPath?: string | false;
  /** Combined status endpoint path (default: '/health', or false to disable) */
  combinedPath?: string | false;
  /** Probe database connectivity in readiness (default: true) */
  db?: boolean;
  /** Probe worker queue readiness (default: true) */
  queue?: boolean;
  /** Monitor event loop delay/lag (default: true) */
  eventLoopLag?: boolean;
  /** Event loop delay threshold in ms before marking degraded (default: 300) */
  eventLoopThresholdMs?: number;
  /** Timeout in ms for DB and custom checks (default: 3000) */
  timeoutMs?: number;
  /** Map of custom async health checks */
  checks?: Record<string, (context: unknown) => Promise<unknown> | unknown>;
  /** Custom headers to attach to health probe responses */
  headers?: Record<string, string>;
}

export function normalizeHealthConfig(options?: unknown): unknown;
export function setupHealthMiddleware(app: Application, options?: unknown, context?: unknown): unknown;
export function createHealthManager(config: unknown, context?: unknown): unknown;

export namespace health {
  export const DEFAULT_HEALTH_CONFIG: Record<string, unknown>;
  export function normalizeHealthConfig(options?: unknown): unknown;
  export function formatMb(bytes: number): string;
  export function createEventLoopMonitor(): unknown;
  export function getSystemMetrics(monitor?: unknown): unknown;
  export function probeDatabase(db: unknown, timeoutMs?: number): Promise<{ status: string; latencyMs?: number; error?: string }>;
  export function probeQueue(queue: unknown): Promise<{ status: string; stats?: unknown; error?: string }>;
  export function probeCustomChecks(checks?: Record<string, Function>, context?: unknown, timeoutMs?: number): Promise<{ isHealthy: boolean; results: Record<string, unknown> }>;
  export function createHealthManager(config: unknown, context?: unknown): unknown;
  export function setupHealthMiddleware(app: Application, options?: unknown, context?: unknown): unknown;
}

// --- In-Memory & Tagged LRU Cache Engine ---

export interface LruCacheConfig {
  /** Maximum number of entries before LRU eviction (default: 1000, 0 = unlimited) */
  maxEntries?: number;
  /** Maximum byte budget (default: 0 = unlimited) */
  maxBytes?: number;
  /** Maximum megabytes budget (converts to bytes) */
  maxMemoryMb?: number;
  /** Default TTL in milliseconds or duration string ('5m', '1h', default: 0 = no expiry) */
  defaultTtl?: string | number;
  /** Whether to deep-clone cached values on read/write to prevent accidental mutation (default: false) */
  clone?: boolean;
  /** Custom byte sizer function (default: approximateByteSize) */
  sizeCalculation?: (value: unknown, key: string) => number;
  /** Callback fired when an entry is evicted, expired, or deleted */
  onEvict?: (key: string, value: unknown, reason: 'evict' | 'expire' | 'delete' | 'clear') => void;
}

export class LruCache<V = unknown> {
  constructor(options?: LruCacheConfig);
  readonly size: number;
  readonly currentBytes: number;
  readonly maxBytes: number;
  readonly maxEntries: number;
  readonly hits: number;
  readonly misses: number;
  readonly hitRate: number;
  readonly evictions: number;
  readonly expirations: number;
  get(key: string): V | undefined;
  peek(key: string): V | undefined;
  has(key: string): boolean;
  set(key: string, value: V, options?: { ttl?: string | number; ttlMs?: number; size?: number }): this;
  delete(key: string): boolean;
  del(key: string): boolean;
  clear(): this;
  pruneExpired(): number;
  getOrSet(key: string, asyncFactory: (key: string) => Promise<V>, options?: { ttl?: string | number; ttlMs?: number; size?: number }): Promise<V>;
  getStats(): Record<string, number>;
  resetStats(): void;
  keys(): IterableIterator<string>;
  values(): IterableIterator<V>;
  entries(): IterableIterator<[string, V]>;
  [Symbol.iterator](): IterableIterator<[string, V]>;
  forEach(callback: (value: V, key: string, cache: this) => void, thisArg?: unknown): void;
}

export class TaggedLruCache<V = unknown> {
  constructor(options?: LruCacheConfig);
  readonly size: number;
  readonly currentBytes: number;
  readonly maxBytes: number;
  readonly maxEntries: number;
  readonly hits: number;
  readonly misses: number;
  readonly hitRate: number;
  readonly evictions: number;
  readonly expirations: number;
  get(key: string): V | undefined;
  peek(key: string): V | undefined;
  has(key: string): boolean;
  set(key: string, value: V, options?: { tags?: string | string[]; ttl?: string | number; ttlMs?: number; size?: number }): this;
  delete(key: string): boolean;
  del(key: string): boolean;
  invalidateTag(tag: string): number;
  invalidateTags(tags: string | string[]): number;
  hasTag(tag: string): boolean;
  getKeysForTag(tag: string): string[];
  clear(): this;
  pruneExpired(): number;
  getOrSet(key: string, asyncFactory: (key: string) => Promise<V>, options?: { tags?: string | string[]; ttl?: string | number; ttlMs?: number; size?: number }): Promise<V>;
  getSizeStats(): Record<string, number>;
  getStats(): Record<string, number>;
  resetStats(): void;
  keys(): IterableIterator<string>;
  values(): IterableIterator<V>;
  entries(): IterableIterator<[string, V]>;
  [Symbol.iterator](): IterableIterator<[string, V]>;
  forEach(callback: (value: V, key: string, cache: this) => void, thisArg?: unknown): void;
}

export function createLruCache<V = unknown>(options?: LruCacheConfig): LruCache<V>;
export function createTaggedLruCache<V = unknown>(options?: LruCacheConfig): TaggedLruCache<V>;
export function approximateByteSize(value: unknown): number;

export namespace cache {
  export { LruCache, TaggedLruCache, createLruCache, createTaggedLruCache, approximateByteSize };
}

export function resolveClientRuntime(options?: {
  clientRuntime?: {
    alpine?: boolean | Record<string, unknown>;
    swup?: boolean | Record<string, unknown>;
  };
}): { alpine: boolean; swup: boolean };

export const CLIENT_RUNTIME_BASE: string;

// --- App context ---

export function attachDbMiddleware(req: Request, res: Response, next: NextFunction): void;

export function getAppContext(): {
  db: DatabaseInstance | null;
  shutdownManager: ShutdownManager | null;
  serviceRegistry: ServiceRegistry | null;
  events?: any;
  mailer?: Mailer | null;
  cache?: TaggedLruCache | null;
};

export function getCache(): TaggedLruCache | null;
export function hasCache(): boolean;

export function getDb(): DatabaseInstance;

export function hasDb(): boolean;

export function getShutdownManager(): ShutdownManager | null;

export function hasShutdownManager(): boolean;

export function getServiceRegistry(): ServiceRegistry | null;

export function hasServiceRegistry(): boolean;

export function getMailer(): Mailer | null;

export function hasMailer(): boolean;

export function resetAppContext(): void;

export function setAppContext(partial: {
  db?: DatabaseInstance | null;
  shutdownManager?: ShutdownManager | null;
  serviceRegistry?: ServiceRegistry | null;
  events?: any;
  mailer?: Mailer | null;
}): void;

// --- File router ---

export function mountPages(
  app: Application,
  options: Record<string, unknown>
): {
  routeMetadata: unknown[];
  registerDynamicFileRoutes: () => void;
};

export interface CascadingLayoutInfo {
  layoutRelPath: string;
  fullPath: string;
  configPath: string | null;
}

export interface CascadingErrorBoundaryInfo {
  dirSegment: string;
  errorRelPath: string;
  fullPath: string;
  configPath: string | null;
}

export interface CascadingLoadingInfo {
  dirSegment: string;
  loadingRelPath: string;
  fullPath: string;
}

export namespace cascading {
  export function getDirectoryChain(relativeFilePath: string): string[];
  export function templateHasExtends(templateBody?: string | null, fullPath?: string): boolean;
  export function findCascadingMiddlewareFiles(baseDir: string, relativeFilePath: string, isDev?: boolean): string[];
  export function loadCascadingMiddlewares(
    baseDir: string,
    relativeFilePath: string,
    middlewareRegistry?: Record<string, unknown>,
    isDev?: boolean
  ): Array<(req: any, res: any, next: (err?: any) => void) => void>;
  export function runMiddleware(mw: Function, req: any, res: any): Promise<void>;
  export function runMiddlewareChain(chain: Function[], req: any, res: any): Promise<void>;
  export function findCascadingLayouts(baseDir: string, relativeFilePath: string, isDev?: boolean): CascadingLayoutInfo[];
  export function executeCascadingLayoutLoads(layouts: CascadingLayoutInfo[], req: any, ctx: any, isDev?: boolean): Promise<void>;
  export function applyCascadingLayouts(
    nunjucksEnv: any,
    layouts: CascadingLayoutInfo[],
    pageHtml: string,
    renderContext: Record<string, unknown>,
    isDev?: boolean
  ): string;
  export function findNearestErrorBoundary(
    baseDir: string,
    relativeFilePath: string,
    isDev?: boolean
  ): CascadingErrorBoundaryInfo | null;
  export function findNearestLoadingTemplate(
    baseDir: string,
    relativeFilePath: string,
    isDev?: boolean
  ): CascadingLoadingInfo | null;
  export function clearCascadingCaches(): void;
}

export function resolveMiddlewares(
  middlewareConfig: unknown[] | null | undefined,
  middlewareRegistry?: Record<string, unknown>
): Array<(req: any, res: any, next: (err?: any) => void) => void>;

export function filePathToRoute(filePath: string, pagesDir: string): string;

export function isRouteGroupSegment(segment: string): boolean;

export function stripRouteGroups(route: string): string;

export function extractMethodFromFilename(filename: string): {
  method: string;
  baseName: string;
};

export function scanDirectory(
  dir: string,
  options?: Record<string, unknown>
): unknown[];

export function loadI18n(pagesDir: string, routePath?: string): Record<string, unknown>;

export interface Translator {
  (key: string, params?: Record<string, unknown> | string, defaultVal?: string | null): string;
  locale: string;
  translations: Record<string, unknown>;
  number(num: number | string | null | undefined, options?: Intl.NumberFormatOptions): string;
  formatNumber(num: number | string | null | undefined, options?: Intl.NumberFormatOptions): string;
  currency(amount: number | string | null | undefined, currency?: string, options?: Intl.NumberFormatOptions): string;
  formatCurrency(amount: number | string | null | undefined, currency?: string, options?: Intl.NumberFormatOptions): string;
  date(date: Date | string | number | null | undefined, options?: Intl.DateTimeFormatOptions): string;
  formatDate(date: Date | string | number | null | undefined, options?: Intl.DateTimeFormatOptions): string;
  relativeTime(val: number | string | null | undefined, unit?: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions): string;
  formatRelativeTime(val: number | string | null | undefined, unit?: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions): string;
  plural(count: number | string, forms: Record<string, string>, params?: Record<string, unknown>): string;
}

export interface CreateTranslatorOptions {
  locale?: string;
  fallbackTranslations?: Record<string, unknown>;
  fallbackLocale?: string;
}

export function createTranslator(
  dictionaries?: Record<string, unknown>,
  options?: CreateTranslatorOptions | string
): Translator;

export function detectLocale(
  req: Request,
  supportedLocales: string[],
  defaultLocale: string
): string;

export interface TranslateValidationIssuesOptions {
  req?: Request;
  t?: Translator;
  locale?: string;
  pagesDir?: string;
  routeDir?: string;
  isDev?: boolean;
}

export function translateValidationIssues<T = unknown>(
  issues: T[],
  options?: TranslateValidationIssuesOptions
): T[];

export function getTranslatorForRequest(
  req?: Request,
  options?: { pagesDir?: string; routeDir?: string; isDev?: boolean }
): { t: Translator; locale: string };

export function parseNjkFrontmatter(content: string): {
  body: string;
  fm: Record<string, unknown> | null;
  hasDelimiter: boolean;
};

export function frontmatterToPatches(fm: unknown): {
  metaPatch: Record<string, unknown>;
  dataPatch: Record<string, unknown>;
};

export function loadNjkRouteTemplate(
  absPath: string,
  isDev: boolean
): {
  useStringRender: boolean;
  templateBody: string | null;
  metaPatch: Record<string, unknown>;
  dataPatch: Record<string, unknown>;
};

export function clearNjkFrontmatterCaches(): void;

// --- Forms & Flash subsystem (AdonisJS & Django-inspired) ---

export interface FlashMessages {
  old?: Record<string, any>;
  errors?: Record<string, string[]>;
  [key: string]: any;
}

export function createFlashMiddleware(options?: { cookieName?: string }): import('express').RequestHandler;

export function normalizeErrors(errors: any): Record<string, string[]>;

export interface FieldRenderOptions {
  label?: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  readonly?: boolean;
  className?: string;
  wrapperClass?: string;
  errorClass?: string;
  showError?: boolean;
  rows?: number;
  selectOptions?: (string | { label: string; value: any })[];
  helpText?: string;
  value?: any;
  default?: any;
  attributes?: Record<string, string>;
}

export function renderField(name: string, options?: FieldRenderOptions, ctx?: { req?: any; res?: any }): string;

export interface FormForOptions {
  action?: string;
  method?: string;
  exclude?: string[];
  include?: string[];
  submitLabel?: string;
  csrf?: boolean;
  formClass?: string;
}

export function renderFormFor(modelOrRepo: any, options?: FormForOptions, ctx?: { req?: any; res?: any }): string;

// --- Authorization & Bouncer (AdonisJS Bouncer & Django Permissions-inspired) ---

export class Bouncer {
  constructor(user?: any, policyManager?: any);
  user: any;
  forUser(user: any): Bouncer;
  allows(actionOrPolicy: string | Function, ...args: any[]): boolean;
  denies(actionOrPolicy: string | Function, ...args: any[]): boolean;
  authorize(actionOrPolicy: string | Function, ...args: any[]): boolean;
}

export function createBouncer(user?: any, policyManager?: any): Bouncer;

export function createBouncerMiddleware(options?: { policyManager?: any }): import('express').RequestHandler;

export function definePolicy(name: string, rules: Record<string, (user: any, ...args: any[]) => boolean | Promise<boolean>>): void;

export function defineGate(name: string, callback: (user: any, ...args: any[]) => boolean | Promise<boolean>): void;

export function can(user: any, action: string, policy?: string | null, resource?: any): boolean;

export function cannot(user: any, action: string, policy?: string | null, resource?: any): boolean;

export function authorize(user: any, action: string, policy?: string | null, resource?: any): void;

// --- Decoupled Events & Signals (AdonisJS Events & Django Signals-inspired) ---

export interface EventListenerOptions {
  sender?: any;
  priority?: number;
  once?: boolean;
}

export class EventDispatcher {
  constructor(options?: { queue?: any; maxListeners?: number; logger?: any });
  on(event: string, handler: Function, options?: EventListenerOptions): () => void;
  once(event: string, handler: Function, options?: EventListenerOptions): () => void;
  off(event: string, handler: Function): this;
  onAny(handler: (eventName: string, data: any, meta: any) => any, options?: { priority?: number; once?: boolean }): () => void;
  emit(eventOrInstance: string | object, data?: any, options?: { sender?: any }): boolean;
  emitAsync(eventOrInstance: string | object, data?: any, options?: { sender?: any }): Promise<Array<{ status: 'fulfilled' | 'rejected'; value?: any; reason?: any }>>;
  emitParallel(eventOrInstance: string | object, data?: any, options?: { sender?: any }): Promise<Array<{ status: 'fulfilled' | 'rejected'; value?: any; reason?: any }>>;
  emitSerial(eventOrInstance: string | object, data?: any, options?: { sender?: any }): Promise<any[]>;
  emitWaterfall(eventOrInstance: string | object, initialData: any, options?: { sender?: any }): Promise<any>;
  listenAndQueue(event: string, jobName: string, queueOptions?: Record<string, unknown>): () => void;
  bridgeOrm(modelEvents?: any): () => void;
  setQueue(queueManager: any): this;
  eventNames(): string[];
  listenerCount(event?: string): number;
  removeAllListeners(event?: string): this;
  clear(): void;
}

export function createEventDispatcher(options?: { queue?: any; maxListeners?: number; logger?: any }): EventDispatcher;

export const events: EventDispatcher;

export class Signal {
  constructor(name: string, dispatcher: EventDispatcher);
  name: string;
  dispatcher: EventDispatcher;
  connect(receiver: Function, options?: EventListenerOptions): () => void;
  disconnect(receiver: Function): this;
  send(data?: any, options?: { sender?: any }): boolean;
  sendAsync(data?: any, options?: { sender?: any }): Promise<Array<{ status: 'fulfilled' | 'rejected'; value?: any; reason?: any }>>;
  sendSerial(data?: any, options?: { sender?: any }): Promise<any[]>;
}

export function defineSignal(name: string, dispatcher?: EventDispatcher): Signal;

export function defineListener(event: string | string[], handler: Function, options?: EventListenerOptions): { event: string | string[]; handle: Function; [key: string]: any };

export function loadListeners(dirPath: string, dispatcher: EventDispatcher, options?: { logger?: any }): Array<{ file: string; event: string; handler: Function }>;

// --- Helpers / assets ---

export function createHelpers(context: Record<string, unknown>): Record<string, unknown>;

export interface FetchWithTimeoutOptions extends RequestInit {
  timeout?: number;
}

export function fetchWithTimeout(url: string | URL | Request, options?: FetchWithTimeoutOptions): Promise<Response>;
export function safeCompare(a: string | Buffer | null | undefined, b: string | Buffer | null | undefined): boolean;
export function sha256(data: string | Buffer | unknown, encoding?: import('crypto').BinaryToTextEncoding | 'buffer'): string | Buffer;
export function hmacSha256(data: string | Buffer | unknown, secret: string | Buffer, encoding?: import('crypto').BinaryToTextEncoding | 'buffer'): string | Buffer;
export function randomToken(byteLength?: number, encoding?: import('crypto').BinaryToTextEncoding | 'buffer'): string | Buffer;
export function randomId(prefix?: string, byteLength?: number, encoding?: import('crypto').BinaryToTextEncoding): string;
export function randomTimestampedId(prefix?: string, byteLength?: number, encoding?: import('crypto').BinaryToTextEncoding): string;
export function base64UrlEncode(input: string | Buffer | unknown): string;
export function base64UrlDecode(input: string): string;
export function escapeHtml(value: unknown): string;
export function unescapeHtml(value: unknown): string;
export function getClientIp<T = string>(req?: any, fallback?: T): string | T;

export interface WalkDirectoryOptions {
  extensions?: string[] | Set<string> | null;
  recursive?: boolean;
  ignoreTests?: boolean;
  ignorePrefixes?: string[];
  ignoreNames?: string[];
  filter?: (fullPath: string, dirent: import('fs').Dirent) => boolean;
  baseDir?: string;
  detailed?: boolean;
}

export interface WalkDirectoryItem {
  absolutePath: string;
  relativePath: string;
  name: string;
  ext: string;
}

export function walkDirectory(dir: string, options?: WalkDirectoryOptions & { detailed?: false }): string[];
export function walkDirectory(dir: string, options: WalkDirectoryOptions & { detailed: true }): WalkDirectoryItem[];
export function walkDirectory(dir: string, options?: WalkDirectoryOptions): string[] | WalkDirectoryItem[];
export function walkDirectoryDetailed(dir: string, options?: WalkDirectoryOptions): WalkDirectoryItem[];

export interface StripTrailingSlashOptions {
  preserveRoot?: boolean;
}

export function stripTrailingSlash(input: string | unknown, options?: StripTrailingSlashOptions): string;
export function ensureLeadingSlash(input: string | unknown): string;
export function ensureTrailingSlash(input: string | unknown): string;
export function stripLeadingSlash(input: string | unknown): string;
export function joinUrl(base: string, ...paths: string[]): string;

export interface GlobToRegExpOptions {
  separator?: '/' | '.' | null;
  exact?: boolean;
  flags?: string;
}

export function escapeRegExp(str: string | unknown): string;
export function escapeRegex(str: string | unknown): string;
export function globToRegExp(pattern: string, options?: GlobToRegExpOptions): RegExp;

export function parseDurationSec(duration: string | number | unknown, defaultSec?: number): number;
export function parseDuration(duration: string | number | unknown, defaultSec?: number): number;
export function parseDurationMs(ttl: string | number | boolean | unknown, defaultMs?: number): number;
export function sleep(ms: number): Promise<void>;

export function safeJsonParse<T = unknown>(input: string | unknown, fallback?: T, reviver?: (this: any, key: string, value: any) => any): any | T;
export function safeJsonStringify(value: unknown, space?: string | number | null, fallback?: string): string;
export function isValidJson(str: string | unknown): boolean;

export function toSnakeCase(str: string | unknown): string;
export function snakeToCamel(str: string | unknown): string;
export function camelToSnake(str: string | unknown): string;
export function toKebabCase(str: string | unknown): string;
export function toPascalCase(str: string | unknown): string;

export function ensureArray<T>(value: T | T[] | null | undefined): T[];
export function pick<T extends object, K extends keyof T>(obj: T | null | undefined, keys: K[] | K): Pick<T, K>;
export function omit<T extends object, K extends keyof T>(obj: T | null | undefined, keys: K[] | K): Omit<T, K>;
export function deepClone<T>(obj: T): T;

export const DEFAULT_TIMEOUTS: Readonly<{
  request: number;
  service: number;
  queue: number;
  fetch: number;
  webhook: number;
  shutdown: number;
  loader: number;
}>;

export interface NormalizedTimeouts {
  request: number | false;
  service: number | false;
  queue: number | false;
  fetch: number | false;
  webhook: number | false;
  shutdown: number | false;
  loader: number | false;
}

export function normalizeTimeouts(options?: {
  timeouts?: Partial<Record<keyof NormalizedTimeouts, number | string | false>>;
  timeout?: number | string | false;
  [key: string]: unknown;
}): Readonly<NormalizedTimeouts>;

export class TimeoutError extends WebspressoError {
  status: number;
  statusCode: number;
  timeout?: number | null;
  scope: string;
  constructor(message?: string, options?: ErrorOptions & { timeout?: number; status?: number; statusCode?: number; scope?: string });
}

export function withTimeout<T>(
  promiseOrFn: Promise<T> | ((signal?: AbortSignal) => Promise<T> | T),
  timeout: number | string | boolean,
  options?: {
    controller?: AbortController;
    signal?: AbortSignal;
    errorMessage?: string;
    errorCode?: string;
    statusCode?: number;
    scope?: string;
    unref?: boolean;
    createError?: (timeoutMs: number) => Error;
  }
): Promise<T>;

export function createTimeoutMiddleware(
  timeoutConfig: number | string | boolean,
  options?: { respond?: boolean }
): (req: Request, res: Response, next: (err?: unknown) => void) => void;

export const utils: Record<string, unknown>;

export class AssetManager {
  constructor(options?: Record<string, unknown>);
  resolve(assetPath: string): string;
  asset(assetPath: string): string;
  js(src: string, attributes?: Record<string, unknown>): string;
  css(href: string, attributes?: Record<string, unknown>): string;
  pageJs(name: string, attributes?: Record<string, unknown>): string;
  pageJsUrl(name: string): string;
  pageCss(name: string, attributes?: Record<string, unknown>): string;
  pageCssUrl(name: string): string;
  hasPageJs(name: string): boolean;
  hasPageCss(name: string): boolean;
  getRouteAssetCandidates(routeFile?: string, routePath?: string): string[];
  pageAssets(nameOrOptions?: string | Record<string, unknown>, attributes?: Record<string, unknown>): string;
  pageAssetsForRoute(routeFile?: string, routePath?: string, options?: Record<string, unknown>): string;
  [key: string]: unknown;
}

export function configureAssets(
  nunjucksEnv: unknown,
  options?: Record<string, unknown>
): void;

export function getAssetManager(): AssetManager | null;

// --- Plugins ---

export interface RoutesReadyContext {
  app: Application;
  nunjucksEnv: unknown;
  options: CreateAppOptions;
  /** Same object as `createApp({ middlewares })` — plugins may register named handlers before or after routes. */
  middlewares: Record<string, WebspressoRegisteredMiddleware>;
  db: DatabaseInstance | null;
  routes: unknown;
  usePlugin(name: string): unknown;
  addHelper(name: string, fn: (...args: unknown[]) => unknown): void;
  addFilter(name: string, fn: (...args: unknown[]) => unknown): void;
  addRoute(method: string, path: string, ...handlers: RequestHandler[]): void;
  [key: string]: unknown;
}

export interface PluginRegisterContext {
  app: Application;
  nunjucksEnv: unknown;
  options: Record<string, unknown>;
  /** Same object as `createApp({ middlewares })` for registering named route middleware. */
  middlewares: Record<string, WebspressoRegisteredMiddleware>;
  db: DatabaseInstance | null;
  usePlugin(name: string): unknown;
  addHelper(name: string, fn: (...args: unknown[]) => unknown): void;
  addFilter(name: string, fn: (...args: unknown[]) => unknown): void;
  addRoute(method: string, path: string, ...handlers: RequestHandler[]): void;
  routes: unknown;
  [key: string]: unknown;
}

export interface WebspressoPlugin {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  register?(ctx: PluginRegisterContext): void | Promise<void>;
  onRoutesReady?(ctx: RoutesReadyContext): void;
  onReady?(): void | Promise<void>;
  api?: Record<string, unknown>;
  csp?: Record<string, unknown>;
  [key: string]: unknown;
}

export class PluginManager {
  [key: string]: unknown;
}

export function createPluginManager(): PluginManager;

export function getPluginManager(): PluginManager | null;

export function resetPluginManager(): void;

// --- ORM: scopes & model ---

export interface ScopeContext {
  tenantId?: unknown;
  withTrashed?: boolean;
  onlyTrashed?: boolean;
  user?: Record<string, any> | null;
  rlsDisabled?: boolean;
  [key: string]: unknown;
}

export type ModelRlsAction = 'read' | 'update' | 'delete' | 'create';

export type ModelRlsRuleCallback<T = any> = (
  user: Record<string, any> | null,
  qb: import('knex').Knex.QueryBuilder,
  action?: ModelRlsAction,
  context?: ScopeContext
) => boolean | Record<string, any> | ((q: import('knex').Knex.QueryBuilder) => any) | void;

export interface ModelRlsConfig<T = any> {
  userColumn?: string;
  tenantColumn?: string;
  bypassRoles?: string[] | ((user: Record<string, any> | null, action?: string) => boolean) | false;
  bypass?: (user: Record<string, any> | null, action: string, context?: ScopeContext) => boolean;
  read?: ModelRlsRuleCallback<T> | Record<string, any> | boolean;
  update?: ModelRlsRuleCallback<T> | Record<string, any> | boolean;
  delete?: ModelRlsRuleCallback<T> | Record<string, any> | boolean;
  create?: ((user: Record<string, any> | null, data: Partial<T>, context?: ScopeContext) => boolean | Partial<T> | Promise<boolean | Partial<T>>) | boolean;
  rule?: ModelRlsRuleCallback<T>;
  filter?: ModelRlsRuleCallback<T>;
  validateUpdate?: (user: Record<string, any> | null, data: Partial<T>, context?: ScopeContext) => boolean | void;
}

export type RelationType = 'belongsTo' | 'hasMany' | 'hasOne';

export type RelationCascadeOption =
  | boolean
  | 'delete'
  | 'restore'
  | 'all'
  | ('delete' | 'restore' | 'all')[]
  | { delete?: boolean; restore?: boolean };

export interface RelationDefinition {
  type: RelationType;
  model: string | (() => ModelDefinition<any> | string);
  foreignKey: string;
  localKey?: string;
  cascade?: RelationCascadeOption;
}

export interface AdminPermissions {
  create?: boolean;
  edit?: boolean;
  delete?: boolean;
}

export interface AdminSortConfig {
  column: string;
  direction?: 'asc' | 'desc';
}

export type AdminBadgeColor =
  | 'green'
  | 'red'
  | 'blue'
  | 'amber'
  | 'yellow'
  | 'purple'
  | 'violet'
  | 'indigo'
  | 'gray'
  | string;

export interface AdminColumnConfig {
  label?: string;
  badge?: Record<string, AdminBadgeColor>;
  hidden?: boolean;
  readonly?: boolean;
  sortable?: boolean;
  [key: string]: unknown;
}

export interface AdminActionConfig {
  id: string;
  label: string;
  icon?: string;
  color?: string;
  models?: string | string[];
  confirm?: boolean;
  confirmMessage?: string;
  showWhen?: Record<string, unknown>;
  handler?: (record: any, modelName: string, ctx: any) => Promise<unknown> | unknown;
  visible?: (record: any, modelName: string) => boolean;
}

export interface AdminBulkActionConfig {
  id: string;
  label: string;
  icon?: string;
  color?: string;
  models?: string | string[];
  confirm?: boolean;
  confirmMessage?: string;
  handler?: (records: any[], modelName: string, ctx: any) => Promise<unknown> | unknown;
}

export interface AdminHookContext<TData = any, TRecord = any> {
  model: string;
  data?: TData;
  record?: TRecord;
  id?: string | number;
  req?: any;
  user?: any;
  db?: any;
  stats?: any;
}

export interface AdminHooksConfig {
  beforeCreate?: (ctx: AdminHookContext) => Promise<void> | void;
  afterCreate?: (ctx: AdminHookContext) => Promise<void> | void;
  beforeUpdate?: (ctx: AdminHookContext) => Promise<void> | void;
  afterUpdate?: (ctx: AdminHookContext) => Promise<void> | void;
  beforeDelete?: (ctx: AdminHookContext) => Promise<void> | void;
  afterDelete?: (ctx: AdminHookContext) => Promise<void> | void;
  beforeRestore?: (ctx: AdminHookContext) => Promise<void> | void;
  afterRestore?: (ctx: AdminHookContext) => Promise<void> | void;
  onRecordView?: (ctx: AdminHookContext) => Promise<void> | void;
  onDashboardLoad?: (ctx: AdminHookContext) => Promise<void> | void;
  [key: string]: ((ctx: AdminHookContext) => Promise<void> | void) | undefined;
}

export interface AdminRelationConfig {
  displayField?: string;
  searchFields?: string[];
  limit?: number;
  [key: string]: unknown;
}

export interface AdminMetadata {
  enabled?: boolean;
  label?: string;
  icon?: string | null;
  group?: string | null;
  menuOrder?: number | null;
  listColumns?: string[];
  searchFields?: string[];
  displayField?: string;
  readOnly?: boolean;
  permissions?: AdminPermissions;
  defaultSort?: AdminSortConfig;
  columns?: Record<string, AdminColumnConfig>;
  actions?: AdminActionConfig[];
  bulkActions?: AdminBulkActionConfig[];
  hooks?: AdminHooksConfig;
  relations?: Record<string, AdminRelationConfig>;
  customFields?: Record<string, unknown>;
  queries?: Record<string, (repo: Repository) => Promise<unknown>>;
}

export interface RestMetadata {
  enabled?: boolean;
  path?: string;
  allowInclude?: string[];
}

export interface ScopeOptions {
  softDelete?: boolean;
  timestamps?: boolean;
  tenant?: string | null;
}

// --- ORM: Type Inference Helpers ---

export type InferModel<T> = T extends ModelDefinition<infer TModel>
  ? TModel
  : T extends ZodObject<infer TShape>
    ? import('zod').z.infer<T>
    : T extends ZodTypeAny
      ? import('zod').z.infer<T>
      : Record<string, any>;

export type InferModelCreate<T> = Partial<InferModel<T>> & Record<string, any>;
export type InferModelUpdate<T> = Partial<InferModel<T>>;

export interface ModelOptions<TSchema = ZodObject<Record<string, ZodTypeAny>>> {
  name: string;
  table: string;
  schema: TSchema | Record<string, any>;
  primaryKey?: string;
  timestamps?: boolean | { createdAt?: string; updatedAt?: string; snakeCase?: boolean };
  softDelete?: boolean | { deletedAt?: string; snakeCase?: boolean };
  softDeletes?: boolean | { deletedAt?: string; snakeCase?: boolean };
  options?: {
    timestamps?: boolean | { createdAt?: string; updatedAt?: string; snakeCase?: boolean };
    softDelete?: boolean | { deletedAt?: string; snakeCase?: boolean };
    softDeletes?: boolean | { deletedAt?: string; snakeCase?: boolean };
    [key: string]: unknown;
  };
  relations?: Record<string, RelationDefinition>;
  scopes?: ScopeOptions;
  admin?: AdminMetadata;
  rest?: RestMetadata;
  hooks?: Record<string, (...args: unknown[]) => unknown>;
  hidden?: string[];
  queryLimits?: {
    maxLimit?: number;
    defaultLimit?: number;
    maxIncludes?: number;
    maxFilterConditions?: number;
  };
  searchable?: string[];
  cache?: boolean | 'auto' | 'smart' | { strategy: 'auto' | 'smart' };
  rls?: ModelRlsConfig<any> | ModelRlsRuleCallback<any> | null;
}

export interface ModelDefinition<TModel = Record<string, any>> {
  name: string;
  table: string;
  schema: ZodObject<Record<string, ZodTypeAny>>;
  primaryKey: string;
  relations: Record<string, RelationDefinition>;
  scopes: {
    softDelete: boolean;
    timestamps: boolean;
    tenant: string | null;
  };
  options?: {
    timestamps?: boolean | { createdAt?: string; updatedAt?: string; snakeCase?: boolean };
    softDelete?: boolean | { deletedAt?: string; snakeCase?: boolean };
    [key: string]: unknown;
  };
  columns: Map<string, unknown>;
  admin: {
    enabled: boolean;
    label: string;
    icon: string | null;
    customFields: Record<string, unknown>;
    queries: Record<string, (repo: Repository<TModel>) => Promise<unknown>>;
  };
  rest: {
    enabled: boolean;
    path: string | null;
    allowInclude: string[] | null;
  };
  hidden: string[];
  queryLimits: {
    maxLimit?: number;
    defaultLimit?: number;
    maxIncludes?: number;
    maxFilterConditions?: number;
  };
  searchable?: string[];
  hooks: Record<string, unknown>;
  cache?: boolean | 'auto' | 'smart' | { strategy: 'auto' | 'smart' };
  rls?: ModelRlsConfig<any> | ModelRlsRuleCallback<any> | null;
}

export function defineModel<TSchema = ZodObject<any>>(
  options: ModelOptions<TSchema>
): ModelDefinition<any>;

export function getModel<T = Record<string, any>>(name: string): ModelDefinition<T> | undefined;

export function getAllModels(): Map<string, ModelDefinition<any>>;

export function hasModel(name: string): boolean;

export function clearRegistry(): void;

export function isCascadeEnabled(relation: RelationDefinition, operation: 'delete' | 'restore'): boolean;

// --- ORM: schema & columns ---

/** zdb column helpers (id, string, timestamp, …) + `schema()` */
export type Zdb = Record<string, any> & {
  schema(shape: Record<string, any>): ZodObject<Record<string, ZodTypeAny>>;
  timestamps(options?: { snakeCase?: boolean; createdAt?: string; updatedAt?: string }): Record<string, any>;
  softDelete(options?: Record<string, any>): any;
  softDeletes(options?: { snakeCase?: boolean; deletedAt?: string }): Record<string, any>;
};

export const zdb: Zdb;
export const z: typeof import('zod').z;

export function createSchemaHelpers(z: typeof import('zod').z): Zdb;

export function extractColumnsFromSchema(schema: ZodObject<Record<string, ZodTypeAny>>): Map<string, unknown>;

export function getColumnMeta(schema: ZodTypeAny): unknown;

// --- ORM: query / repository ---

export interface FindOptions {
  with?: string[];
  include?: string[];
  select?: string[];
  limit?: number;
  offset?: number;
}

export interface PaginatedResult<T = Record<string, any>> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface SearchOptions {
  mode?: 'auto' | 'fts' | 'like';
  language?: string;
  matchAllWords?: boolean;
  exact?: boolean;
  rank?: boolean;
  ftsTable?: string;
  boolean?: 'and' | 'or';
}

export interface QueryBuilder<T = Record<string, any>> {
  where(column: keyof T | string, value: unknown): this;
  where(column: keyof T | string, operator: string, value: unknown): this;
  where(conditions: Partial<T> | Record<string, unknown>): this;
  orWhere(...args: unknown[]): this;
  whereIn(column: keyof T | string, values: unknown[]): this;
  whereBetween(column: keyof T | string, range: [unknown, unknown]): this;
  select(...columns: (keyof T | string)[]): this;
  orderBy(column: keyof T | string, direction?: 'asc' | 'desc'): this;
  orderByRaw(sql: string, bindings?: unknown[]): this;
  search(term: string, columns?: string | string[], options?: SearchOptions): this;
  orSearch(term: string, columns?: string | string[], options?: SearchOptions): this;
  limit(n: number): this;
  offset(n: number): this;
  with(...relations: string[]): this;
  include(...relations: string[]): this;
  withTrashed(): this;
  onlyTrashed(): this;
  forUser(user: Record<string, any> | null): this;
  withoutRls(): this;
  forTenant(tenantId: unknown): this;
  withContext(customContext: Partial<ScopeContext>): this;
  asAction(action: ModelRlsAction): this;
  first(): Promise<T | null>;
  list(): Promise<T[]>;
  get(): Promise<T[]>;
  find(): Promise<T[]>;
  count(): Promise<number>;
  paginate(page?: number, perPage?: number): Promise<PaginatedResult<T>>;
  exists(): Promise<boolean>;
  clone(): QueryBuilder<T>;
  getWiths(): string[];
  delete(): Promise<number>;
  update(data: Partial<T> | Record<string, unknown>): Promise<number>;
  [key: string]: unknown;
}

export interface BatchOptions {
  chunkSize?: number;
  transaction?: boolean;
  validate?: boolean;
  hooks?: boolean;
  returning?: boolean;
}

export interface UpsertOptions extends BatchOptions {
  updateColumns?: string[] | Record<string, unknown>;
}

export interface BatchUpsertOptions extends BatchOptions {
  updateColumns?: string[] | Record<string, unknown>;
}

export interface Repository<T = Record<string, any>> {
  findById(id: string | number, options?: FindOptions): Promise<T | null>;
  findOne(conditions: Partial<T> | Record<string, unknown>, options?: FindOptions): Promise<T | null>;
  findAll(options?: FindOptions): Promise<T[]>;
  find(conditions?: Partial<T> | Record<string, unknown>, options?: FindOptions): Promise<T[]>;
  create(data: Partial<T> | Record<string, unknown>): Promise<T>;
  createMany(data: (Partial<T> | Record<string, unknown>)[], options?: BatchOptions): Promise<T[]>;
  createBatch(data: (Partial<T> | Record<string, unknown>)[], options?: BatchOptions): Promise<T[]>;
  upsert(
    data: Partial<T> | Record<string, unknown>,
    conflictTarget?: string | string[],
    updateColumns?: string[] | Record<string, unknown>,
    options?: UpsertOptions
  ): Promise<T | null>;
  upsertBatch(
    data: (Partial<T> | Record<string, unknown>)[],
    conflictTarget?: string | string[],
    options?: BatchUpsertOptions
  ): Promise<T[]>;
  update(id: string | number, data: Partial<T> | Record<string, unknown>): Promise<T | null>;
  updateWhere(conditions: Partial<T> | Record<string, unknown>, data: Partial<T> | Record<string, unknown>): Promise<number>;
  delete(id: string | number, options?: { cascade?: boolean; deletedAt?: Date }): Promise<boolean>;
  forceDelete(id: string | number, options?: { cascade?: boolean }): Promise<boolean>;
  restore(id: string | number, options?: { cascade?: boolean; allChildren?: boolean }): Promise<T | null>;
  query(): QueryBuilder<T>;
  raw(sql: string, bindings?: unknown[]): Promise<unknown>;
  count(conditions?: Partial<T> | Record<string, unknown>): Promise<number>;
  exists(conditions: Partial<T> | Record<string, unknown>): Promise<boolean>;
  with(...relations: string[]): QueryBuilder<T>;
  include(...relations: string[]): QueryBuilder<T>;
  search(term: string, columns?: string | string[], options?: SearchOptions): QueryBuilder<T>;
  forUser(user: Record<string, any> | null): Repository<T>;
  withoutRls(): Repository<T>;
  forTenant(tenantId: unknown): Repository<T>;
  withContext(customContext: Partial<ScopeContext>): Repository<T>;
  getScopeContext(): ScopeContext;
  model: ModelDefinition<T>;
}

// --- ORM: database ---

export interface MigrationConfig {
  directory?: string;
  tableName?: string;
}

export interface OrmMemoryCacheOptions {
  maxEntries?: number;
  defaultTtlMs?: number;
}

export interface OrmDatabaseCacheConfig {
  enabled?: boolean;
  defaultStrategy?: 'auto' | 'smart';
  provider?: {
    get(key: string): unknown;
    set(key: string, value: unknown, opts?: { tags?: string[]; ttlMs?: number }): void;
    invalidateTags(tags: string[]): void;
    clear(): void;
    getSizeStats(): { entries: number; tags: number };
  };
  memory?: OrmMemoryCacheOptions;
}

export interface DatabaseConfig {
  client?: string;
  connection?: string | Record<string, unknown>;
  models?: string;
  migrations?: MigrationConfig;
  pool?: Record<string, unknown>;
  useNullAsDefault?: boolean;
  cache?: boolean | OrmDatabaseCacheConfig;
  [key: string]: unknown;
}

export interface OrmCachePublicApi {
  purge(): void;
  invalidateTags(tags: string[]): void;
  invalidateModel(modelName: string): void;
  getMetrics(): Record<string, unknown>;
  resetMetrics(): void;
}

export interface MigrationStatus {
  name: string;
  completed: boolean;
  ran_at: Date | null;
  batch: number | null;
}

export interface MigrationResult {
  batch: number;
  migrations: string[];
}

export interface MakeMigrationResult {
  filename: string;
  filepath: string;
  content: string | null;
}

export interface MigrationManager {
  latest(): Promise<MigrationResult>;
  rollback(options?: { all?: boolean }): Promise<MigrationResult>;
  currentVersion(): Promise<string>;
  status(): Promise<MigrationStatus[]>;
  make(name: string, options?: { content?: string }): Promise<string | MakeMigrationResult>;
  up(name: string): Promise<void>;
  down(name: string): Promise<void>;
  getConfig(): MigrationConfig & { directory: string; tableName: string };
  hasTable(): Promise<boolean>;
  unlock(): Promise<void>;
  diff(options?: { models?: ModelDefinition<any>[]; includeDrops?: boolean }): Promise<{ hasChanges: boolean; changes: Array<any> }>;
  makeMigrations(options?: { modelsDir?: string; dryRun?: boolean; includeDrops?: boolean; name?: string }): Promise<{ hasChanges: boolean; created: Array<any>; skipped: Array<any> }>;
}

export interface WebspressoModels {
  [key: string]: Record<string, any>;
}

export interface WebspressoServices {
  [key: string]: { input: any; output: any };
}

export interface WebspressoServiceCaller {
  <K extends keyof WebspressoServices>(
    name: K,
    input?: WebspressoServices[K]['input'],
    opts?: unknown
  ): Promise<WebspressoServices[K]['output']>;
  <TInput = unknown, TOutput = unknown>(
    name: string,
    input?: TInput,
    opts?: unknown
  ): Promise<TOutput>;
}

export interface TransactionContext {
  trx: Knex.Transaction;
  getRepository<K extends keyof WebspressoModels>(modelName: K, scopeContext?: ScopeContext): Repository<WebspressoModels[K]>;
  getRepository<T = Record<string, any>>(modelName: string, scopeContext?: ScopeContext): Repository<T>;
  createRepository<T = Record<string, any>>(model: ModelDefinition<T>, scopeContext?: ScopeContext): Repository<T>;
  forTenant(tenantId: unknown): this;
  forUser(user: Record<string, any> | null): this;
  withoutRls(): this;
  getScopeContext(): ScopeContext;
}

export interface DatabaseInstance {
  knex: Knex;
  migrate: MigrationManager;
  getModel<T = Record<string, any>>(name: string): ModelDefinition<T>;
  hasModel(name: string): boolean;
  getAllModels(): ModelDefinition<any>[];
  registerModel<T = Record<string, any>>(model: ModelDefinition<T>): void;
  getRepository<K extends keyof WebspressoModels>(modelName: K, scopeContext?: ScopeContext): Repository<WebspressoModels[K]>;
  getRepository<T = Record<string, any>>(modelName: string, scopeContext?: ScopeContext): Repository<T>;
  createRepository<T = Record<string, any>>(model: ModelDefinition<T>, scopeContext?: ScopeContext): Repository<T>;
  query<T = Record<string, any>>(modelName: string, scopeContext?: ScopeContext): QueryBuilder<T>;
  forUser(user: Record<string, any> | null): {
    getRepository<K extends keyof WebspressoModels>(modelName: K, scopeContext?: ScopeContext): Repository<WebspressoModels[K]>;
    getRepository<T = Record<string, any>>(modelName: string, scopeContext?: ScopeContext): Repository<T>;
    query<T = Record<string, any>>(modelName: string, scopeContext?: ScopeContext): QueryBuilder<T>;
  };
  withoutRls(): {
    getRepository<K extends keyof WebspressoModels>(modelName: K, scopeContext?: ScopeContext): Repository<WebspressoModels[K]>;
    getRepository<T = Record<string, any>>(modelName: string, scopeContext?: ScopeContext): Repository<T>;
    query<T = Record<string, any>>(modelName: string, scopeContext?: ScopeContext): QueryBuilder<T>;
  };
  forTenant(tenantId: unknown): {
    getRepository<K extends keyof WebspressoModels>(modelName: K, scopeContext?: ScopeContext): Repository<WebspressoModels[K]>;
    getRepository<T = Record<string, any>>(modelName: string, scopeContext?: ScopeContext): Repository<T>;
    query<T = Record<string, any>>(modelName: string, scopeContext?: ScopeContext): QueryBuilder<T>;
  };
  transaction<T>(callback: (ctx: TransactionContext) => Promise<T>, scopeContext?: ScopeContext): Promise<T>;
  runInTransaction<T>(callback: (ctx: TransactionContext) => Promise<T>, scopeContext?: ScopeContext): Promise<T>;
  getAmbientTransaction(): Knex.Transaction | null;
  hasActiveTransaction(): boolean;
  createSeeder(): unknown;
  cache: OrmCachePublicApi | null;
  destroy(): Promise<void>;
}

export function createDatabase(config: DatabaseConfig): DatabaseInstance;

export function runWithAmbientTransaction<T>(trx: Knex.Transaction, callback: () => Promise<T> | T): Promise<T>;
export function getAmbientTransaction(): Knex.Transaction | null;
export function hasAmbientTransaction(): boolean;
export function createTransactionContext(trx: Knex.Transaction, scopeContext?: ScopeContext): TransactionContext;
export function runTransaction<T>(knex: Knex, callback: (ctx: TransactionContext) => Promise<T>, scopeContext?: ScopeContext): Promise<T>;
export function calculateSafeChunkSize(knexInstance: unknown, columnCount?: number, requestedChunkSize?: number | null): number;
export function chunkArray<T>(array: T[], size: number): T[][];

export function createMemoryCacheProvider(options?: OrmMemoryCacheOptions): {
  get(key: string): unknown;
  set(key: string, value: unknown, opts?: { tags?: string[]; ttlMs?: number }): void;
  invalidateTags(tags: string[]): void;
  clear(): void;
  getSizeStats(): { entries: number; tags: number };
};

// --- ORM: Model Factory & Seeding (AdonisJS Lucid-inspired) ---

export interface FactoryBuilder<T = Record<string, any>> {
  count(n: number): FactoryBuilder<T>;
  state(...stateNames: string[]): FactoryBuilder<T>;
  apply(...stateNames: string[]): FactoryBuilder<T>;
  merge(overrides: Partial<T>): FactoryBuilder<T>;
  make(overrides?: Partial<T>): T | T[];
  create(options: { db?: DatabaseInstance | Repository<T>; merge?: Partial<T> } | DatabaseInstance | Repository<T>): Promise<T | T[]>;
}

export function defineFactory<T = Record<string, any>>(
  modelName: string,
  definitionFn: (ctx: { faker: any; index: number }) => Partial<T>
): FactoryBuilder<T> & {
  state(name: string, handler: ((ctx: { faker: any; index: number; current: Partial<T> }) => Partial<T>) | Partial<T>): FactoryBuilder<T>;
  registerState(name: string, handler: ((ctx: { faker: any; index: number; current: Partial<T> }) => Partial<T>) | Partial<T>): FactoryBuilder<T>;
};

// --- ORM: Schema Diff & Makemigrations (Django-inspired) ---

export function diffSchema(options: { knex: Knex; models?: ModelDefinition<any>[]; includeDrops?: boolean }): Promise<{ hasChanges: boolean; changes: Array<any> }>;
export function makeMigrations(options: { knex: Knex; modelsDir?: string; migrationDir?: string; dryRun?: boolean; includeDrops?: boolean; name?: string }): Promise<{ hasChanges: boolean; created: Array<any>; skipped: Array<any> }>;

// --- ORM: nanoid / zod ---

export function generateNanoid(options?: { maxLength?: number } | number): string;

export const zodNanoid: ZodTypeAny;

export function extendZ(z: typeof import('zod').z): typeof import('zod').z;

// --- ORM: sanitize ---

export function omitHiddenColumns(record: unknown, model: ModelDefinition): unknown;

export function sanitizeForOutput(
  records: unknown,
  model: ModelDefinition
): unknown;

// --- ORM: events ---

export const ModelEvents: {
  on(event: string, handler: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
  emitAsync?(event: string, ...args: unknown[]): Promise<void>;
  [key: string]: unknown;
};

export const Hooks: Record<string, string>;

export class HookCancellationError extends Error {
  reason: string;
  model: string;
  hook: string;
  constructor(reason: string, model: string, hook: string);
}

export function createEventContext(
  model: string,
  operation: string,
  trx?: unknown | null
): {
  model: string;
  operation: string;
  trx: unknown | null;
  isCancelled: boolean;
  cancelReason: string | null;
  cancel(reason?: string): void;
};

// --- ORM: Query Complexity & DoS Protection ---

export class QueryComplexityError extends BadRequestError {
  code: string;
}

export const DEFAULT_QUERY_LIMITS: {
  maxLimit: number;
  defaultLimit: number;
  maxIncludes: number;
  maxFilterConditions: number;
};

export function resolveQueryLimits(model?: ModelDefinition): typeof DEFAULT_QUERY_LIMITS;

export function validateQueryComplexity(
  model?: ModelDefinition,
  params?: {
    perPage?: number;
    limit?: number;
    includes?: string[];
    filterCount?: number;
    strict?: boolean;
  }
): {
  limit: number;
  perPage: number;
  includes: string[];
};

export function buildSearchClause(params: {
  knex: any;
  model: any;
  term: string;
  columns?: string | string[];
  options?: SearchOptions;
}): {
  raw: true;
  sql: string;
  bindings: any[];
  boolean: 'and' | 'or';
  rankClause: { sql: string; bindings: any[] } | null;
} | null;

export function tokenizeSearchTerm(term: string): string[];

export function detectDialect(knex: any): 'sqlite' | 'postgres' | 'mysql' | 'generic';

export interface SchemaExplorerPluginOptions {
  /** Raw JSON API endpoint path (default: '/_schema') */
  path?: string;
  /** Force enable/disable raw API (default: auto based on NODE_ENV) */
  enabled?: boolean;
  /** Model names to exclude from schema exploration */
  exclude?: string[];
  /** Include column metadata (default: true) */
  includeColumns?: boolean;
  /** Include relation metadata (default: true) */
  includeRelations?: boolean;
  /** Include scope configuration (default: true) */
  includeScopes?: boolean;
  /** Custom authorization check for raw endpoint */
  authorize?: (req: any) => boolean;
  /** Register interactive page in Admin Panel when adminPanelPlugin is present (default: true) */
  admin?: boolean;
  /** Path within admin panel (default: '/schema') */
  adminPath?: string;
  /** Admin sidebar menu label (default: 'Schema Explorer') */
  menuLabel?: string;
  /** Admin sidebar icon (default: 'database') */
  menuIcon?: string;
  /** Admin sidebar menu order (default: 85) */
  menuOrder?: number;
  /** Admin page title (default: menuLabel or 'Schema Explorer') */
  title?: string;
  /** Admin page title alias */
  adminTitle?: string;
  /** Admin API prefix (default: '/schema') */
  apiPrefix?: string;
}

export interface DashboardPluginOptions {
  /** Base URL path for the developer dashboard (default: '/_webspresso') */
  path?: string;
  /** Custom dashboard title displayed in HTML <title> and header (default: 'Webspresso Developer Dashboard') */
  title?: string;
  /** Enable or disable the plugin (default: true) */
  enabled?: boolean;
}

export function dashboardPlugin(options?: DashboardPluginOptions): WebspressoPlugin;
export function devToolbarPlugin(options?: DashboardPluginOptions): WebspressoPlugin;
export function devtoolsPlugin(options?: DashboardPluginOptions): WebspressoPlugin;

export function schemaExplorerPlugin(options?: SchemaExplorerPluginOptions): WebspressoPlugin;

export interface AdminPanelPluginOptions {
  /** Database instance (required) */
  db?: any;
  /** Base URL path for the admin panel (default: '/_admin') */
  path?: string;
  /** Enable or disable the plugin (default: true) */
  enabled?: boolean;
  /** Custom admin panel title displayed in HTML <title> and header (default: 'Admin Panel') */
  title?: string;
  /** Dynamic page title template where %s is page title and %b is base title (default: '%s | %b') */
  titleTemplate?: string;
  /** Session secret for admin auth cookie encryption */
  sessionSecret?: string;
  /** Auth manager instance for optional user management integration */
  auth?: any;
  /** User management configuration */
  userManagement?: {
    enabled?: boolean;
    model?: string;
    fields?: Record<string, string>;
  };
  /** Staff user management option (default: true) */
  adminUsers?: boolean | { enabled?: boolean };
  /** Custom registry configuration callback */
  configure?: (registry: any) => void;
  /** POST URL for file uploads */
  uploadUrl?: string;
  /** Sanitize rich-text HTML values (default: true) */
  richTextSanitize?: boolean;
  /** Auto-register data exchange export/import services (default: true) */
  dataExchange?: boolean;
  /** Admin login brute-force protection / rate limiting (default: enabled with 5 attempts per 15 mins) */
  loginRateLimit?: boolean | {
    enabled?: boolean;
    maxAttempts?: number;
    windowMs?: number;
    blockDurationMs?: number;
  };
  /** Lazy / On-Demand mount: defers plugin initialization until first request to adminPath or service execution */
  lazy?: boolean | LazyPluginOptions;
  [key: string]: unknown;
}

export interface LazyPluginOptions {
  name?: string;
  prefix?: string | string[];
  services?: string[];
  helpers?: string[];
  events?: string[];
  dependencies?: Record<string, string> | string[];
  csp?: Record<string, string[]>;
  onHydrate?: (realPlugin: WebspressoPlugin) => void;
}

export interface LazyPlugin extends WebspressoPlugin {
  isLazy: true;
  readonly isHydrated: boolean;
  hydrate(): WebspressoPlugin;
}

export function lazyPlugin(
  pluginFactory: (() => WebspressoPlugin) | WebspressoPlugin,
  lazyOptions?: LazyPluginOptions
): LazyPlugin;

export function defineLazyPlugin(
  pluginFactory: (() => WebspressoPlugin) | WebspressoPlugin,
  lazyOptions?: LazyPluginOptions
): LazyPlugin;

export function adminPanelPlugin(options?: AdminPanelPluginOptions): WebspressoPlugin;

export function dataExchangePlugin(options?: Record<string, unknown>): WebspressoPlugin;

export interface SiteAnalyticsRetentionConfig {
  enabled?: boolean;
  days?: number;
  errorDays?: number;
  intervalMs?: number;
  runOnStart?: boolean;
}

export interface SiteAnalyticsPurgeResult {
  viewsDeleted: number;
  errorsDeleted: number;
  viewsCutoff: string;
  errorsCutoff: string;
}

export interface SiteAnalyticsPurgeOptions {
  days?: number;
  errorDays?: number;
  olderThan?: Date;
  errorsOlderThan?: Date;
  tableName?: string;
  errorsTableName?: string;
}

export interface SiteAnalyticsPluginOptions {
  db?: any;
  tableName?: string;
  errorsTableName?: string;
  excludePaths?: (string | RegExp)[];
  excludeBots?: boolean;
  customBots?: string[];
  anonymizeIp?: boolean;
  trustProxy?: boolean;
  collectErrors?: boolean;
  dashboard?: boolean;
  retentionDays?: number;
  errorRetentionDays?: number;
  cleanupIntervalMs?: number;
  autoCleanup?: boolean;
  cleanupOnStart?: boolean;
  retention?: boolean | SiteAnalyticsRetentionConfig;
  [key: string]: unknown;
}

export function siteAnalyticsPlugin(options?: SiteAnalyticsPluginOptions): WebspressoPlugin & {
  api?: {
    purge(options?: SiteAnalyticsPurgeOptions): Promise<SiteAnalyticsPurgeResult>;
    purgeAnalyticsData(knex: any, options?: SiteAnalyticsPurgeOptions): Promise<SiteAnalyticsPurgeResult>;
    startCleanup(intervalMs?: number): void;
    stopCleanup(): void;
    getRetentionConfig(): SiteAnalyticsRetentionConfig;
  };
  dispose?(): void;
  shutdown?(): void;
};

export interface AuditLogRetentionConfig {
  enabled?: boolean;
  autoCleanup?: boolean;
  days?: number;
  intervalMs?: number;
  runOnStart?: boolean;
}

export interface AuditLogPluginOptions {
  db: any;
  title?: string;
  adminTitle?: string;
  pageTitle?: string;
  adminPath?: string;
  tableName?: string;
  includeDefaultPage?: boolean;
  apiPrefix?: string;
  registerRecordAction?: boolean;
  retentionDays?: number;
  cleanupIntervalMs?: number;
  autoCleanup?: boolean;
  cleanupOnStart?: boolean;
  cleanupStartDelayMs?: number;
  retention?: boolean | AuditLogRetentionConfig;
  [key: string]: unknown;
}

export function auditLogPlugin(options?: AuditLogPluginOptions): WebspressoPlugin & {
  api?: {
    purge(options?: { tableName?: string; days?: number; retentionDays?: number; olderThan?: Date | string | number }): Promise<number>;
    purgeAuditLogs(knex?: any, options?: { tableName?: string; days?: number; retentionDays?: number; olderThan?: Date | string | number }): Promise<number>;
    startCleanup(intervalMs?: number): void;
    stopCleanup(): void;
    getRetentionConfig(): AuditLogRetentionConfig;
    queryLogs(filters?: Record<string, unknown>): Promise<any[]>;
    queryTimeline(model: string, recordId: string | number): Promise<any[]>;
    getRecordTimeline(model: string, recordId: string | number): Promise<any[]>;
    getMigrationTemplate(tableName?: string): string;
  };
  dispose?(): void;
  shutdown?(): void;
};

export interface EmailRetentionConfig {
  enabled?: boolean;
  autoCleanup?: boolean;
  days?: number;
  intervalMs?: number;
  runOnStart?: boolean;
}

export interface EmailPluginOptions {
  db?: any;
  title?: string;
  adminTitle?: string;
  transport?: any;
  smtp?: any;
  defaults?: Record<string, unknown>;
  templatesDir?: string;
  templates?: Record<string, string>;
  tableName?: string;
  includeAdminPage?: boolean;
  adminPath?: string;
  apiPrefix?: string;
  auth?: any;
  authEmails?: any;
  emailTemplates?: any;
  manifest?: any;
  logToDb?: boolean;
  retentionDays?: number;
  cleanupIntervalMs?: number;
  autoCleanup?: boolean;
  cleanupOnStart?: boolean;
  cleanupStartDelayMs?: number;
  retention?: boolean | EmailRetentionConfig;
  [key: string]: unknown;
}

export function emailPlugin(options?: EmailPluginOptions): WebspressoPlugin & {
  api?: {
    send(options: Record<string, unknown>): Promise<any>;
    sendTemplate(name: string, options: Record<string, unknown>): Promise<any>;
    preview(nameOrOpts: any, data?: Record<string, unknown>): Promise<any>;
    registerTemplate(id: string, source: string): void;
    listTemplates(): any[];
    verifyConnection(): Promise<any>;
    queryLogs(filters?: Record<string, unknown>): Promise<any>;
    purge(options?: { tableName?: string; days?: number; retentionDays?: number; olderThan?: Date | string | number }): Promise<number>;
    purgeLogs(options?: { tableName?: string; days?: number; retentionDays?: number; olderThan?: Date | string | number }): Promise<number>;
    startCleanup(intervalMs?: number): void;
    stopCleanup(): void;
    getRetentionConfig(): EmailRetentionConfig;
    getMigrationTemplate(tableName?: string): string;
    isTransportReady(): boolean;
    loadFromManifest(chunks: any): void;
    emailPluginOptionsFromManifest(manifest: any): any;
    mailer?: Mailer;
    Mailable?: typeof Mailable;
    getOutbox?(): any[];
    clearOutbox?(): void;
    lastMessage?(): any;
  };
  dispose?(): void;
  shutdown?(): void;
};

export class Mailable {
  constructor();
  to(recipient: string | string[] | any, name?: string): this;
  from(address: string, name?: string): this;
  replyTo(address: string): this;
  cc(recipient: string | string[]): this;
  bcc(recipient: string | string[]): this;
  subject(subj: string): this;
  template(tplName: string): this;
  html(htmlContent: string): this;
  text(textContent: string): this;
  mjml(mjmlContent: string): this;
  view(templateOrData: string | Record<string, unknown>, data?: Record<string, unknown>): this;
  data(keyOrObj: string | Record<string, unknown>, value?: any): this;
  attach(attachment: any): this;
  header(key: string, value: string): this;
  prepare(): void;
  build(): void;
  toMessage(): Record<string, any>;
}

export class Mailer {
  constructor(options?: any);
  send(mailableOrOptions: Mailable | Record<string, any>): Promise<any>;
  preview(mailableOrOptions: Mailable | Record<string, any>): Promise<any>;
  getOutbox(): any[];
  clearOutbox(): void;
  lastMessage(): any;
  verify(): Promise<any>;
}

export function createMailer(options?: any): Mailer;

export class MemoryTransport {
  outbox: any[];
  constructor(options?: any);
  sendMail(mailOptions: any): Promise<any>;
  getOutbox(): any[];
  clearOutbox(): void;
  lastMessage(): any;
  findById(id: string): any;
  verify(): Promise<boolean>;
}

export class ConsoleTransport {
  constructor(options?: any);
  sendMail(mailOptions: any): Promise<any>;
  verify(): Promise<boolean>;
}

export class FileTransport {
  dir: string;
  constructor(options?: any);
  sendMail(mailOptions: any): Promise<any>;
  verify(): Promise<boolean>;
}

export function recaptchaPlugin(options?: Record<string, unknown>): WebspressoPlugin;

export interface SwaggerPluginOptions {
  /** Base path for docs (default: '/_swagger') */
  path?: string;
  /** UI playground engine: 'swagger' or 'scalar' (default: 'swagger') */
  ui?: 'swagger' | 'scalar';
  /** Enable plugin (defaults to true in development) */
  enabled?: boolean;
  /** Custom authorization guard */
  authorize?: (req: any) => boolean;
  /** Automatically merge ORM model schemas into components.schemas */
  includeOrmSchemas?: boolean;
  /** Exclude specific ORM models from documentation */
  ormExclude?: string[];
  /** OpenAPI info.title override */
  title?: string;
  /** OpenAPI info.version override */
  version?: string;
  /** OpenAPI info.description override */
  description?: string;
  /** Primary server URL in spec */
  serverUrl?: string;
  /** Theme for Scalar UI ('default', 'purple', 'solarized', etc.) */
  theme?: string;
  /** Dark mode default for Scalar UI */
  darkMode?: boolean;
  /** Auto-register in Admin Panel if admin-panel plugin is present (default: true) */
  admin?: boolean;
  /** Admin menu and page title (default: 'API Docs') */
  adminTitle?: string;
  /** Admin menu sort order (default: 92) */
  adminOrder?: number;
  /** Custom options passed to Scalar */
  scalarOptions?: Record<string, unknown>;
  /** Custom options passed to Swagger UI */
  swaggerOptions?: Record<string, unknown>;
}

export function swaggerPlugin(options?: SwaggerPluginOptions): WebspressoPlugin;
export function openapiPlugin(options?: SwaggerPluginOptions): WebspressoPlugin;
export function apiDocsPlugin(options?: SwaggerPluginOptions): WebspressoPlugin;

export function healthCheckPlugin(options?: Record<string, unknown>): WebspressoPlugin;

export interface CorsPluginOptions {
  origin?:
    | string
    | string[]
    | RegExp
    | ((
        origin: string,
        callback: (err: Error | null, allow?: boolean | string) => void
      ) => void);
  methods?: string | string[];
  allowedHeaders?: string | string[];
  exposedHeaders?: string | string[];
  credentials?: boolean;
  maxAge?: number;
  preflightContinue?: boolean;
  optionsSuccessStatus?: number;
  routes?: string | string[] | boolean;
  global?: boolean;
}

export function corsPlugin(options?: CorsPluginOptions): WebspressoPlugin;

export interface RedirectRule {
  from: string | RegExp;
  to: string;
  status?: number;
  /** Use `'*'` to match any HTTP method; default follows `defaultMethods` on the plugin. */
  methods?: string[] | '*';
}

export interface RedirectPluginOptions {
  rules?: RedirectRule[];
  /** Default when a rule omits `status`. Must be 301, 302, 303, 307, or 308. Default 302. */
  defaultStatus?: number;
  /** Append request query string to `to` when `to` has no `?`. Default true. */
  preserveQuery?: boolean;
  /** Allow `to` starting with http(s): or //. Default false. */
  allowExternal?: boolean;
  /** Normalize path before matching: strip/add trailing slash. Default false (still allows /old vs /old/ match for string rules). */
  trailingSlash?: 'strip' | 'add' | false;
  /** Methods matched when a rule has no `methods`. Default GET and HEAD. */
  defaultMethods?: string[];
}

export function redirectPlugin(options?: RedirectPluginOptions): WebspressoPlugin;

/** Options for `rateLimitPlugin`: `express-rate-limit` fields plus plugin-only keys. */
export interface RateLimitPluginOptions {
  /** Mount a global limiter on the Express app (named route middleware is always registered). */
  global?: boolean;
  /** Shallow merge applied only to the global limiter. */
  globalOverrides?: Record<string, unknown>;
  /** Extra path prefixes skipped by the global limiter (builtin skips dev routes, favicon, robots, health). */
  globalSkipPaths?: string[];
  [key: string]: unknown;
}

export function rateLimitPlugin(options?: RateLimitPluginOptions): WebspressoPlugin;

export interface CsrfCookieOptions {
  key?: string;
  signed?: boolean;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  maxAge?: number;
  [key: string]: unknown;
}

export interface CsrfPluginOptions {
  cookie?: boolean | CsrfCookieOptions;
  sessionKey?: string;
  methods?: string[];
  ignorePaths?: Array<string | RegExp | ((req: Request) => boolean)>;
  global?: boolean;
  errorMessage?: string;
  errorStatus?: number;
}

export function csrfPlugin(options?: CsrfPluginOptions): WebspressoPlugin;

export interface CorsPluginOptions {
  origin?: string | string[] | RegExp | ((origin: string, cb: (err: Error | null, allow?: boolean | string) => void) => void) | boolean;
  methods?: string | string[];
  allowedHeaders?: string | string[];
  exposedHeaders?: string | string[];
  credentials?: boolean;
  maxAge?: number;
  preflightContinue?: boolean;
  optionsSuccessStatus?: number;
  routes?: string | string[] | boolean;
  global?: boolean;
}

export function corsPlugin(options?: CorsPluginOptions): WebspressoPlugin;

export interface BasicAuthCredentials {
  username: string;
  password?: string;
  [key: string]: unknown;
}

export interface BasicAuthPluginOptions {
  /** Apply basic auth as a global middleware across the application. Default false. */
  global?: boolean;
  /** Static username-password dictionary. */
  users?: Record<string, string>;
  /** Custom async/sync credential verification function. */
  verify?: (
    username: string,
    password: string,
    req: Request
  ) => boolean | BasicAuthCredentials | Promise<boolean | BasicAuthCredentials>;
  /** Realm string included in WWW-Authenticate header. Default 'Restricted Area'. */
  realm?: string;
  /** Whether to send WWW-Authenticate header on 401. Default true. */
  challenge?: boolean;
  /** Route prefixes to protect when global: true. Default true (all routes). */
  routes?: string | string[] | boolean;
  /** Path prefixes to bypass basic authentication. */
  skipPaths?: string[];
  /** Custom predicate function to skip basic authentication. */
  skip?: (req: Request) => boolean;
  /** Custom 401 Unauthorized response handler, string, or object. */
  unauthorizedResponse?: ((req: Request, res: Response) => unknown) | string | Record<string, unknown>;
  /** Callback hook on successful authentication. */
  onAuthenticated?: (req: Request, user: BasicAuthCredentials) => void;
}

export function basicAuthPlugin(options?: BasicAuthPluginOptions): WebspressoPlugin;

export interface ApiKeyRecord {
  id?: number | string;
  name: string;
  key_hash: string;
  key_hint: string;
  prefix?: string;
  user_id?: number | string | null;
  scopes?: string[] | string | null;
  rate_limit?: number | null;
  metadata?: any;
  expires_at?: Date | string | null;
  last_used_at?: Date | string | null;
  revoked_at?: Date | string | null;
  created_at?: Date | string;
  updated_at?: Date | string;
  user?: any;
  [key: string]: any;
}

export interface ApiKeyPluginOptions {
  /** Database instance or Knex instance. */
  db?: any;
  /** Knex instance. */
  knex?: any;
  /** Table name for API keys. Default 'api_keys'. */
  tableName?: string;
  /** Default key prefix. Default 'wsp_live_'. */
  prefix?: string;
  /** Random byte length for key generation. Default 24. */
  byteLength?: number;
  /** Protect all matching routes globally. Default false. */
  global?: boolean;
  /** Route prefixes to protect when global: true. Default true (all routes). */
  routes?: string | string[] | boolean;
  /** Path prefixes to bypass authentication. */
  skipPaths?: string[];
  /** Custom predicate function to skip authentication. */
  skip?: (req: Request) => boolean;
  /** Static in-memory keys for testing, serverless, or microservices. */
  keys?: Array<{ key?: string; key_hash?: string; name?: string; scopes?: string[] | string; [key: string]: any }> | Record<string, any>;
  /** Automatically update last_used_at timestamp. Default true. */
  trackUsage?: boolean;
  /** Throttle interval in milliseconds for last_used_at updates. Default 60000. */
  updateLastUsedThrottleMs?: number;
  /** Allow query parameter extraction (?apiKey=...). Default false. */
  allowQueryParam?: boolean;
  /** Query parameter name. Default 'apiKey'. */
  queryParamName?: string;
  /** Custom key extraction function. */
  extractKey?: (req: Request) => string | null;
  /** Custom key lookup by SHA-256 hash. */
  findKeyByHash?: (hash: string, req?: Request) => Promise<ApiKeyRecord | null> | ApiKeyRecord | null;
  /** Custom verification hook. */
  verify?: (rawKey: string, req?: Request) => Promise<ApiKeyRecord | null> | ApiKeyRecord | null;
  /** Custom user loader for key. */
  getUser?: (record: ApiKeyRecord, req?: Request) => Promise<any> | any;
  /** Callback hook on successful authentication. */
  onAuthenticated?: (req: Request, record: ApiKeyRecord) => void | Promise<void>;
  /** Custom 401 Unauthorized response handler, string, or object. */
  unauthorizedResponse?: ((req: Request, res: Response, info?: any) => unknown) | string | Record<string, unknown>;
  /** Custom 403 Forbidden response handler, string, or object. */
  forbiddenResponse?: ((req: Request, res: Response, info?: any) => unknown) | string | Record<string, unknown>;
}

export interface ApiKeyRouteOptions {
  /** Required scope(s) for this route. Supports wildcards ('*', 'reports:*'). */
  scopes?: string | string[];
  /** Whether all required scopes must be present (true) or any scope (false). Default true. */
  requireAllScopes?: boolean;
  /** If true, allows requests without API key to pass through without error. Default false. */
  optional?: boolean;
  /** Custom 401 Unauthorized response. */
  unauthorizedResponse?: ((req: Request, res: Response, info?: any) => unknown) | string | Record<string, unknown>;
  /** Custom 403 Forbidden response. */
  forbiddenResponse?: ((req: Request, res: Response, info?: any) => unknown) | string | Record<string, unknown>;
}

export function apiKeyPlugin(options?: ApiKeyPluginOptions): WebspressoPlugin;
export function createApiKeyMiddleware(options?: ApiKeyPluginOptions & ApiKeyRouteOptions): RequestHandler;

export interface WebhookEndpoint {
  id?: number | string;
  name: string;
  url: string;
  secret?: string;
  events?: string[] | string;
  is_active?: boolean;
  description?: string | null;
  headers?: Record<string, string> | string | null;
  metadata?: Record<string, any> | string | null;
  created_at?: Date | string;
  updated_at?: Date | string;
  [key: string]: any;
}

export interface WebhookDelivery {
  id?: number | string;
  endpoint_id: number | string;
  event: string;
  payload: string;
  status_code?: number | null;
  success: boolean;
  duration_ms?: number | null;
  error?: string | null;
  response_body?: string | null;
  attempt?: number;
  max_attempts?: number;
  next_retry_at?: Date | string | null;
  created_at?: Date | string;
  updated_at?: Date | string;
  [key: string]: any;
}

export interface WebhooksPluginOptions {
  db?: any;
  knex?: any;
  endpointsTable?: string;
  deliveriesTable?: string;
  maxAttempts?: number;
  backoffBaseMs?: number;
  timeoutMs?: number;
  wrapPayload?: boolean;
  queue?: any;
  endpoints?: WebhookEndpoint[];
  apiPrefix?: string;
  includeDefaultPage?: boolean;
  pageTitle?: string;
  menuOrder?: number;
}

export interface WebhookDispatchResult {
  dispatched: number;
  deliveries: WebhookDelivery[];
  results?: Array<{ success?: boolean; statusCode?: number; error?: string; [key: string]: any }>;
}

export interface WebhookDispatcherInstance {
  dispatch(event: string, payload: any, options?: { wait?: boolean; endpointId?: number | string }): Promise<WebhookDispatchResult>;
  pingEndpoint(endpointId: number | string): Promise<any>;
  retryDelivery(deliveryId: number | string): Promise<any>;
  createEndpoint(data: Partial<WebhookEndpoint>): Promise<WebhookEndpoint>;
  getEndpoint(id: number | string): Promise<WebhookEndpoint | null>;
  updateEndpoint(id: number | string, data: Partial<WebhookEndpoint>): Promise<WebhookEndpoint | null>;
  deleteEndpoint(id: number | string): Promise<boolean>;
  listEndpoints(filters?: { active?: boolean; search?: string; limit?: number; offset?: number }): Promise<WebhookEndpoint[]>;
  listDeliveries(filters?: { endpointId?: number | string; event?: string; success?: boolean | string; page?: number; limit?: number }): Promise<{ items: WebhookDelivery[]; total: number; page: number; limit: number; pages: number }>;
  getDelivery(id: number | string): Promise<WebhookDelivery | null>;
  purgeDeliveries(options?: { days?: number }): Promise<number>;
  dispose(): void;
  on(event: string, listener: (...args: any[]) => void): this;
}

export function webhooksPlugin(options?: WebhooksPluginOptions): WebspressoPlugin & {
  dispatcher: WebhookDispatcherInstance;
};

export interface ContentPluginOptions {
  db: import('./index').Database;
  adminPath?: string;
  publicApiPath?: string;
  inlineEdit?: boolean;
  cacheTtlMs?: number | null;
}

export function contentPlugin(options: ContentPluginOptions): WebspressoPlugin;

export const content: {
  createContentService: typeof import('./core/content').createContentService;
  parseContentTypeSchema: typeof import('./core/content').parseContentTypeSchema;
  validateEntryData: typeof import('./core/content').validateEntryData;
  wrapEditable: typeof import('./core/content').wrapEditable;
};

export interface RestResourcePluginOptions {
  path?: string;
  middleware?: RequestHandler[];
  models?: string[] | null;
  excludeModels?: string[];
  filter?: (model: ModelDefinition) => boolean;
}

export function restResourcePlugin(options?: RestResourcePluginOptions): WebspressoPlugin;

export function ormCacheAdminPlugin(options: { db: DatabaseInstance }): WebspressoPlugin;

/** Multipart upload storage (e.g. local disk or S3). */
export interface UploadStorageProvider {
  put(args: {
    buffer?: Buffer;
    stream?: NodeJS.ReadableStream;
    originalName: string;
    mimeType: string;
    size: number;
    req: Request;
  }): Promise<{ publicUrl: string; key?: string }>;
}

export interface UploadPluginOptions {
  path?: string;
  provider?: UploadStorageProvider;
  local?: { destDir?: string; publicBasePath?: string };
  maxBytes?: number;
  mimeAllowlist?: string[] | null;
  extensionAllowlist?: string[] | null;
  middleware?: RequestHandler | RequestHandler[];
  fieldName?: string;
}

export function uploadPlugin(options?: UploadPluginOptions): WebspressoPlugin;

export function createLocalFileProvider(options?: {
  destDir?: string;
  publicBasePath?: string;
}): UploadStorageProvider;

export interface OrphanedUploadsResult {
  destDir: string;
  totalFiles: number;
  totalBytes: number;
  totalBytesFormatted: string;
  referencedCount: number;
  orphanedCount: number;
  orphanedBytes: number;
  orphanedBytesFormatted: string;
  orphanedFiles: Array<{
    relativePath: string;
    absolutePath: string;
    size: number;
    publicUrl: string;
    mtime: Date;
  }>;
  dryRun?: boolean;
  deletedCount?: number;
  deletedBytes?: number;
  deletedBytesFormatted?: string;
  deletedFiles?: string[];
}

export function scanOrphanedUploads(options?: {
  db?: any;
  destDir?: string;
  publicBasePath?: string;
}): Promise<OrphanedUploadsResult>;

export function pruneOrphanedUploads(options?: {
  db?: any;
  destDir?: string;
  publicBasePath?: string;
  dryRun?: boolean;
}): Promise<OrphanedUploadsResult>;

// --- Realtime Layer Types ---

export interface RealtimeSubscriptionCallbacks {
  connected?: () => void;
  disconnected?: () => void;
  rejected?: (error: Error) => void;
  received?: (data: unknown) => void;
}

export interface RealtimeSubscription {
  id: string;
  identifier: string;
  params: Record<string, unknown>;
  send(data: unknown): void;
  perform(action: string, data?: unknown): void;
  unsubscribe(): void;
}

export interface RealtimeAdapter {
  capabilities?: {
    send?: boolean;
    perform?: boolean;
    multiplexing?: boolean;
    serverEvents?: boolean;
    binary?: boolean;
    [key: string]: boolean | undefined;
  };
  connect(context: { auth: Record<string, unknown>; client: RealtimeClient }): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  subscribe(
    identifier: string,
    params: Record<string, unknown>,
    callbacks: RealtimeSubscriptionCallbacks
  ): {
    send?(data: unknown): void;
    perform?(action: string, data?: unknown): void;
    unsubscribe(): void;
  };
  send?(identifier: string, data: unknown, sub?: RealtimeSubscription): void;
  perform?(identifier: string, action: string, data?: unknown, sub?: RealtimeSubscription): void;
  unsubscribe?(identifier: string, params: Record<string, unknown>, sub?: RealtimeSubscription): void;
  on?(event: string, handler: (...args: any[]) => void): () => void;
  destroy?(): void;
}

export type RealtimeAuthStrategy =
  | false
  | {
      strategy: 'cookie';
    }
  | {
      strategy: 'token';
      getToken: () => string | Promise<string>;
      refreshToken?: () => string | Promise<string>;
      onUnauthorized?: (error: Error) => void;
    }
  | {
      strategy: 'custom';
      resolve: () => Record<string, unknown> | Promise<Record<string, unknown>>;
    };

export interface RealtimeReconnectOptions {
  enabled?: boolean;
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
  factor?: number;
  jitter?: boolean;
}

export interface RealtimeOptions {
  adapter: RealtimeAdapter;
  auth?: RealtimeAuthStrategy;
  autoConnect?: boolean;
  reconnect?: RealtimeReconnectOptions;
  isBrowser?: boolean;
}

export interface RealtimeClient {
  capabilities: Record<string, boolean>;
  isConnected(): boolean;
  connect(overrideAuth?: Record<string, unknown> | null): Promise<void>;
  disconnect(): void;
  reconnect(): Promise<void>;
  reauthenticate(): Promise<void>;
  subscribe(
    identifier: string,
    params?: Record<string, unknown>,
    callbacks?: RealtimeSubscriptionCallbacks
  ): RealtimeSubscription;
  on(event: 'connected' | 'disconnected' | 'reconnecting' | 'reconnected' | 'unauthorized' | 'error', handler: (...args: any[]) => void): () => void;
  once(event: string, handler: (...args: any[]) => void): () => void;
  off(event: string, handler: (...args: any[]) => void): () => void;
  destroy(): void;
}

export function createRealtime(options: RealtimeOptions): RealtimeClient;
export function realtime(options: RealtimeOptions): RealtimeClient & { plugin: WebspressoPlugin };
export function realtimePlugin(options: RealtimeOptions): WebspressoPlugin;

export interface WebSocketAdapterOptions {
  url: string | ((context: { auth: Record<string, unknown> }) => string | Promise<string>);
  authTransport?: 'query' | 'header' | 'protocol' | 'message';
  queryParamName?: string;
  protocols?: string | string[];
  WebSocket?: any;
  messages?: {
    subscribe?: (args: { identifier: string; params: Record<string, unknown> }) => unknown;
    unsubscribe?: (args: { identifier: string; params: Record<string, unknown> }) => unknown;
    perform?: (args: { identifier: string; action: string; data?: unknown }) => unknown;
    send?: (args: { identifier: string; data: unknown }) => unknown;
    auth?: (args: { token: string; metadata: Record<string, unknown> }) => unknown;
  };
  capabilities?: Record<string, boolean>;
}

export function websocket(options: WebSocketAdapterOptions): RealtimeAdapter;
export function createWebSocketAdapter(options: WebSocketAdapterOptions): RealtimeAdapter;

export interface SseAdapterOptions {
  url: string | ((context: { auth: Record<string, unknown> }) => string | Promise<string>);
  queryParamName?: string;
  EventSource?: any;
  capabilities?: Record<string, boolean>;
}

export function sse(options: SseAdapterOptions): RealtimeAdapter;
export function createSseAdapter(options: SseAdapterOptions): RealtimeAdapter;

export interface SocketIoAdapterOptions {
  url?: string | ((context: { auth: Record<string, unknown> }) => string | Promise<string>);
  path?: string;
  io?: any;
  socketOptions?: Record<string, unknown>;
  capabilities?: Record<string, boolean>;
}

export function socketIo(options: SocketIoAdapterOptions): RealtimeAdapter;
export function createSocketIoAdapter(options: SocketIoAdapterOptions): RealtimeAdapter;

export interface RedisAdapterOptions {
  pubClient?: any;
  subClient?: any;
  redis?: any;
  channelPrefix?: string;
  nodeId?: string;
  serialize?: (envelope: unknown) => string;
  deserialize?: (raw: string) => unknown;
  inMemory?: boolean;
  capabilities?: Record<string, boolean>;
}

export interface RedisRealtimeAdapter extends RealtimeAdapter {
  publish(identifier: string, data: unknown): Promise<void>;
  perform(identifier: string, action: string, data?: unknown): Promise<void>;
  readonly isInMemory: boolean;
  readonly nodeId: string;
}

export function redis(options?: RedisAdapterOptions): RedisRealtimeAdapter;
export function createRedisAdapter(options?: RedisAdapterOptions): RedisRealtimeAdapter;

// --- Application kernel (use `kernel.createApp`; not the SSR `createApp`) ---

export type KernelEventSource = 'orm' | 'auth' | 'route' | 'plugin' | 'system';

export interface KernelEventMeta {
  requestId?: string;
  userId?: string;
  source: KernelEventSource;
  createdAt: Date;
}

export interface KernelEventContext {
  payload: unknown;
  meta: KernelEventMeta;
}

export interface KernelEventBus {
  dispatch(eventName: string, ctx: KernelEventContext): Promise<unknown>;
  publish(eventName: string, ctx: KernelEventContext): Promise<void>;
  on(eventName: string, handler: (ctx: KernelEventContext) => unknown): void;
  off(eventName: string, handler: (ctx: KernelEventContext) => unknown): void;
  buildContext(
    payload: unknown,
    meta: Partial<Omit<KernelEventMeta, 'createdAt'>> & Pick<KernelEventMeta, 'source'>
  ): KernelEventContext;
}

export interface KernelViewEngine {
  registerPluginViews(
    pluginName: string,
    bundle: {
      namespace: string;
      layouts?: Record<string, string>;
      pages?: Record<string, string>;
      partials?: Record<string, string>;
    }
  ): void;
  renderView(
    qualifiedName: string,
    data: Record<string, unknown>,
    options?: { layout?: string }
  ): string;
  renderPartial(qualifiedName: string, data: Record<string, unknown>): string;
}

export interface KernelPluginDescriptor {
  name: string;
  events?: (app: KernelAppShell) => void | Promise<void>;
  views?: () => {
    namespace: string;
    layouts?: Record<string, string>;
    pages?: Record<string, string>;
    partials?: Record<string, string>;
  };
}

export interface KernelFlowDefinition {
  id?: string;
  trigger: string;
  when?: (ctx: KernelEventContext) => boolean;
  actions?: Array<(ctx: KernelEventContext, app: KernelAppShell) => void | Promise<void>>;
}

export interface KernelAppShell {
  events: KernelEventBus;
  view: KernelViewEngine;
  flows: Array<{ id?: string; trigger: string }>;
  registerPlugin(plugin: KernelPluginDescriptor): void;
  registerFlow(flow: KernelFlowDefinition): () => void;
  paths: Record<string, string | undefined>;
  options?: Record<string, unknown>;
}

export interface KernelBaseRepository {
  events: KernelEventBus;
  resource: string;
  create(data: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(id: string, data: Partial<Record<string, unknown>>): Promise<Record<string, unknown>>;
  delete(id: string): Promise<void>;
}

export interface KernelBaseRepositoryConstructor {
  new (events: KernelEventBus, options: { resource: string; source?: KernelEventSource }): KernelBaseRepository;
}

export interface WebspressoKernel {
  createApp(options?: { paths?: { appViews?: string; themeViews?: string } }): KernelAppShell;
  definePlugin(plugin: KernelPluginDescriptor): KernelPluginDescriptor;
  defineFlow(flow: KernelFlowDefinition): KernelFlowDefinition;
  BaseRepository: KernelBaseRepositoryConstructor;
  createEventBus(): KernelEventBus;
  buildContext: KernelEventBus['buildContext'];
  randomUUID(): string;
  createViewEngine(paths?: { appViews?: string; themeViews?: string }): KernelViewEngine;
  renderTemplate(template: string, data: Record<string, unknown>): string;
  parseQualified(qualified: string): { namespace: string; name: string };
}

export const kernel: WebspressoKernel;

// --- Background Job Queue ---

export interface JobJSON {
  id: string | number;
  name: string;
  data: unknown;
  status: 'pending' | 'running' | 'completed' | 'failed';
  attempts: number;
  maxAttempts: number;
  backoff: unknown;
  priority: number;
  timeout: number;
  progress: number;
  result: unknown;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  runAt: string;
}

export class Job {
  id: string | number;
  name: string;
  data: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
  attempts: number;
  maxAttempts: number;
  backoff: number | { type?: 'exponential' | 'fixed'; delay?: number };
  priority: number;
  timeout: number;
  progressValue: number;
  result: any;
  error: any;
  createdAt: Date;
  updatedAt: Date;
  runAt: Date;
  constructor(options?: Record<string, any>);
  progress(percent: number, message?: string): void;
  getNextRetryDelay(): number;
  toJSON(): JobJSON;
}

export interface QueueAdapter {
  enqueue(job: Job): Promise<Job>;
  dequeue(jobNames?: string[]): Promise<Job | null>;
  complete(jobId: string | number, result?: unknown): Promise<Job | null>;
  fail(jobId: string | number, error?: unknown): Promise<Job | null>;
  retry(jobId: string | number, delayMs: number, error?: unknown): Promise<Job | null>;
  getJob(jobId: string | number): Promise<Job | null>;
  getStats(): Promise<{ pending: number; running: number; completed: number; failed: number; total: number }>;
  clear(): Promise<void>;
}

export class MemoryQueueAdapter implements QueueAdapter {
  enqueue(job: Job): Promise<Job>;
  dequeue(jobNames?: string[]): Promise<Job | null>;
  complete(jobId: string | number, result?: unknown): Promise<Job | null>;
  fail(jobId: string | number, error?: unknown): Promise<Job | null>;
  retry(jobId: string | number, delayMs: number, error?: unknown): Promise<Job | null>;
  getJob(jobId: string | number): Promise<Job | null>;
  getStats(): Promise<{ pending: number; running: number; completed: number; failed: number; total: number }>;
  clear(): Promise<void>;
  clean?(options?: {
    status?: string | string[];
    days?: number;
    retentionDays?: number;
    olderThan?: Date | string | number;
    limit?: number;
  }): Promise<number>;
}

export class DatabaseQueueAdapter implements QueueAdapter {
  constructor(options: { knex: Knex; tableName?: string });
  ensureTable(): Promise<void>;
  enqueue(job: Job): Promise<Job>;
  dequeue(jobNames?: string[]): Promise<Job | null>;
  complete(jobId: string | number, result?: unknown): Promise<Job | null>;
  fail(jobId: string | number, error?: unknown): Promise<Job | null>;
  retry(jobId: string | number, delayMs: number, error?: unknown): Promise<Job | null>;
  getJob(jobId: string | number): Promise<Job | null>;
  getStats(): Promise<{ pending: number; running: number; completed: number; failed: number; total: number }>;
  clear(): Promise<void>;
  clean(options?: {
    status?: string | string[];
    days?: number;
    retentionDays?: number;
    olderThan?: Date | string | number;
    limit?: number;
  }): Promise<number>;
}

export class RedisQueueAdapter implements QueueAdapter {
  constructor(options: { client: unknown; prefix?: string });
  enqueue(job: Job): Promise<Job>;
  dequeue(jobNames?: string[]): Promise<Job | null>;
  complete(jobId: string | number, result?: unknown): Promise<Job | null>;
  fail(jobId: string | number, error?: unknown): Promise<Job | null>;
  retry(jobId: string | number, delayMs: number, error?: unknown): Promise<Job | null>;
  getJob(jobId: string | number): Promise<Job | null>;
  getStats(): Promise<{ pending: number; running: number; completed: number; failed: number; total: number }>;
  clear(): Promise<void>;
  clean(options?: {
    status?: string | string[];
    days?: number;
    retentionDays?: number;
    olderThan?: Date | string | number;
    limit?: number;
  }): Promise<number>;
}

export interface DispatchOptions {
  delay?: number | Date;
  attempts?: number;
  priority?: number;
  timeout?: number;
  backoff?: number | { type?: 'exponential' | 'fixed'; delay?: number };
}

export interface QueueRetentionConfig {
  enabled?: boolean;
  autoCleanup?: boolean;
  days?: number;
  statuses?: string[];
  intervalMs?: number;
  runOnStart?: boolean;
}

export interface ScheduleOptions {
  id?: string;
  overlap?: boolean;
  preventOverlap?: boolean;
  maxRuns?: number;
  utc?: boolean;
  timezone?: string;
  tz?: string;
  runImmediately?: boolean;
  delay?: number | Date;
  attempts?: number;
  priority?: number;
  timeout?: number;
  backoff?: number | { type?: 'exponential' | 'fixed'; delay?: number };
  [key: string]: unknown;
}

export interface ScheduleInfo {
  id: string;
  name: string;
  cronExpression: string;
  cron?: CronExpression;
  data: unknown;
  options: ScheduleOptions;
  runsCount: number;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  isRunning: boolean;
  activeJobId: string | number | null;
  activeJobIds?: (string | number)[];
  registeredAt: Date;
}

export class CronExpression {
  rawExpression: string;
  resolvedExpression: string;
  utc: boolean;
  timezone: string | null;
  minutes: Set<number>;
  hours: Set<number>;
  doms: Set<number>;
  months: Set<number>;
  dows: Set<number>;
  constructor(expression: string, options?: { utc?: boolean; timezone?: string; tz?: string });
  match(date?: Date | string | number): boolean;
  getNextDate(fromDate?: Date | string | number): Date | null;
  getNextDates(count?: number, fromDate?: Date | string | number): Date[];
  static isValid(expression: string, options?: { utc?: boolean; timezone?: string; tz?: string }): boolean;
  static parse(expression: string, options?: { utc?: boolean; timezone?: string; tz?: string }): CronExpression;
}

export function parseCron(expression: string, options?: { utc?: boolean; timezone?: string; tz?: string }): CronExpression;
export function isValidCron(expression: string, options?: { utc?: boolean; timezone?: string; tz?: string }): boolean;
export function resolveCronAlias(str: string): string;
export const CRON_ALIASES: Record<string, string>;

export class TaskScheduler {
  queue: QueueManager;
  maxIntervalMs: number;
  isRunning: boolean;
  schedules: Map<string, any>;
  constructor(queue: QueueManager, options?: { autoStart?: boolean; maxIntervalMs?: number });
  schedule(cronExpression: string | CronExpression, jobName: string, data?: unknown, options?: ScheduleOptions): ScheduleInfo;
  cron(cronExpression: string | CronExpression, jobName: string, data?: unknown, options?: ScheduleOptions): ScheduleInfo;
  unschedule(idOrJobName: string): boolean;
  getSchedules(): ScheduleInfo[];
  getSchedule(idOrJobName: string): ScheduleInfo | null;
  trigger(idOrJobName: string): Promise<Job | null>;
  start(): this;
  stop(): this;
  pause(): this;
  resume(): this;
  clear(): void;
  destroy(): void;
}

export class QueueManager extends EventEmitter {
  adapter: QueueAdapter;
  concurrency: number;
  pollInterval: number;
  isRunning: boolean;
  isPaused: boolean;
  isDraining: boolean;
  retentionConfig: QueueRetentionConfig;
  scheduler: TaskScheduler;
  constructor(options?: {
    adapter?: QueueAdapter;
    concurrency?: number;
    pollInterval?: number;
    jobsDir?: string | null;
    autoStart?: boolean;
    retention?: boolean | QueueRetentionConfig;
    retentionDays?: number;
    retentionStatuses?: string[];
    cleanupIntervalMs?: number;
    autoCleanup?: boolean;
    cleanupOnStart?: boolean;
  });
  define(name: string, handler: (job: Job, ctx: { queue: QueueManager }) => Promise<any> | any, options?: DispatchOptions): this;
  has(name: string): boolean;
  dispatch(name: string, data?: unknown, options?: DispatchOptions): Promise<Job>;
  schedule(cronExpression: string | CronExpression, name: string, data?: unknown, options?: ScheduleOptions): ScheduleInfo;
  cron(cronExpression: string | CronExpression, name: string, data?: unknown, options?: ScheduleOptions): ScheduleInfo;
  unschedule(idOrJobName: string): boolean;
  getSchedules(): ScheduleInfo[];
  getSchedule(idOrJobName: string): ScheduleInfo | null;
  triggerSchedule(idOrJobName: string): Promise<Job | null>;
  triggerCron(idOrJobName: string): Promise<Job | null>;
  start(): this;
  pause(): this;
  resume(): this;
  drain(timeoutMs?: number): Promise<void>;
  stop(): Promise<void>;
  clean(options?: {
    status?: string | string[];
    days?: number;
    retentionDays?: number;
    olderThan?: Date | string | number;
    limit?: number;
  }): Promise<number>;
  runCleanup(): Promise<number>;
  startCleanup(customIntervalMs?: number): void;
  stopCleanup(): void;
  getRetentionConfig(): QueueRetentionConfig;
  getStats(): Promise<Record<string, unknown>>;
  getJob(jobId: string | number): Promise<Job | null>;
  loadJobsFromDirectory(dirPath: string): void;
}

export function createQueueManager(options?: {
  adapter?: QueueAdapter;
  concurrency?: number;
  pollInterval?: number;
  jobsDir?: string | null;
  autoStart?: boolean;
  retention?: boolean | QueueRetentionConfig;
  retentionDays?: number;
  retentionStatuses?: string[];
  cleanupIntervalMs?: number;
  autoCleanup?: boolean;
  cleanupOnStart?: boolean;
}): QueueManager;

export function queuePlugin(options?: {
  adapter?: 'memory' | 'database' | 'db' | 'redis' | QueueAdapter;
  db?: { knex: Knex };
  knex?: Knex;
  redisClient?: unknown;
  tableName?: string;
  concurrency?: number;
  pollInterval?: number;
  jobsDir?: string;
  autoStart?: boolean;
  retention?: boolean | QueueRetentionConfig;
  retentionDays?: number;
  retentionStatuses?: string[];
  cleanupIntervalMs?: number;
  autoCleanup?: boolean;
  cleanupOnStart?: boolean;
}): WebspressoPlugin & {
  api?: {
    getQueueManager(): QueueManager | null;
    clean(options?: {
      status?: string | string[];
      days?: number;
      retentionDays?: number;
      olderThan?: Date | string | number;
      limit?: number;
    }): Promise<number>;
    schedule(cronExpression: string | CronExpression, name: string, data?: unknown, options?: ScheduleOptions): ScheduleInfo | undefined;
    cron(cronExpression: string | CronExpression, name: string, data?: unknown, options?: ScheduleOptions): ScheduleInfo | undefined;
    unschedule(idOrJobName: string): boolean | undefined;
    getSchedules(): ScheduleInfo[];
  };
};

// --- SSR Streaming & Chunked Transfer ---

export interface HtmlStreamOptions {
  env: import('nunjucks').Environment;
  templatePath: string;
  context?: Record<string, unknown>;
  defer?: Record<string, Promise<unknown> | { promise: Promise<unknown>; template?: string; loadingTemplate?: string }>;
  nonce?: string;
  loadingTemplate?: string | null;
  layouts?: CascadingLayoutInfo[];
}

export interface RenderStreamOptions {
  env?: import('nunjucks').Environment;
  defer?: Record<string, Promise<unknown> | { promise: Promise<unknown>; template?: string; loadingTemplate?: string }>;
  status?: number;
  flushImmediately?: boolean;
  nonce?: string;
  loadingTemplate?: string | null;
  layouts?: CascadingLayoutInfo[];
}

export function createHtmlStream(options: HtmlStreamOptions): import('stream').Readable;
export function renderStream(
  res: import('express').Response,
  templatePath: string,
  context?: Record<string, unknown>,
  options?: RenderStreamOptions
): Promise<void>;

export const ssr: {
  createHtmlStream: typeof createHtmlStream;
  renderStream: typeof renderStream;
};

// --- Server-Sent Events (SSE) Streaming ---

export interface SseOptions {
  status?: number;
  headers?: Record<string, string>;
  heartbeat?: number | boolean;
  heartbeatComment?: string;
  retry?: number;
  map?: (chunk: any) => any;
}

export interface SseEventObject {
  data?: any;
  event?: string;
  id?: string | number;
  retry?: number;
}

export class ServerSentEventsStream extends EventEmitter {
  req: import('http').IncomingMessage;
  res: import('http').ServerResponse;
  options: SseOptions;
  isOpen: boolean;
  isClosed: boolean;

  constructor(req: import('http').IncomingMessage, res: import('http').ServerResponse, options?: SseOptions);
  send(payloadOrData: any | SseEventObject, event?: string, id?: string | number): Promise<boolean>;
  comment(text: string): boolean;
  heartbeat(comment?: string): boolean;
  retry(ms: number): boolean;
  pipe(source: AsyncIterable<any> | Iterable<any> | import('stream').Readable, mapFn?: (chunk: any) => any): Promise<void>;
  stream(generatorFn: (stream: ServerSentEventsStream) => any): Promise<void>;
  close(): void;
}

export function createSseStream(
  req: import('http').IncomingMessage,
  res: import('http').ServerResponse,
  sourceOrOptions?: SseOptions | AsyncIterable<any> | Iterable<any> | import('stream').Readable | ((stream: ServerSentEventsStream) => any),
  maybeOptions?: SseOptions
): ServerSentEventsStream | Promise<void>;

export const sseStream: {
  ServerSentEventsStream: typeof ServerSentEventsStream;
  createSseStream: typeof createSseStream;
  formatSseFrame: (data?: any, event?: string, id?: string | number, retry?: number) => string;
};

// --- Model Context Protocol (MCP) Plugin ---

export interface McpPluginOptions {
  path?: string;
  enabled?: boolean;
  auth?: {
    token?: string;
    localhostOnly?: boolean;
    verify?: (req: import('express').Request) => boolean | Promise<boolean>;
  };
  services?: boolean | {
    include?: string[];
    exclude?: string[];
    readOnly?: boolean;
    role?: string | string[];
  };
  orm?: boolean | {
    readOnly?: boolean;
    models?: string[];
  };
  system?: boolean;
  tools?: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    handler: (args: any, ctx: any) => Promise<any> | any;
  }>;
  resources?: Array<{
    uri?: string;
    uriTemplate?: string;
    name?: string;
    description?: string;
    mimeType?: string;
    handler: (uri: string, paramsOrCtx: any, ctx?: any) => Promise<any> | any;
  }>;
  prompts?: Array<{
    name: string;
    description?: string;
    arguments?: Array<{ name: string; description?: string; required?: boolean }>;
    handler: (args: any, ctx: any) => Promise<any> | any;
  }>;
  discovery?: boolean;
  name?: string;
  version?: string;
  instructions?: string;
}

export class McpServer {
  name: string;
  version: string;
  instructions: string;
  constructor(options?: { name?: string; version?: string; instructions?: string; context?: Record<string, unknown> });
  registerTool(toolDef: any): this;
  registerTools(toolDefs: any[]): this;
  unregisterTool(name: string): boolean;
  registerResource(resourceDef: any): this;
  registerResourceTemplate(templateDef: any): this;
  registerPrompt(promptDef: any): this;
  handleMessage(message: any, callContext?: any): Promise<any>;
}

export function mcpPlugin(options?: McpPluginOptions): WebspressoPlugin;
export function createMcpServer(options?: McpPluginOptions): McpServer;

// --- File Manager Plugin ---

export interface FileManagerPluginOptions {
  baseDir?: string;
  publicBasePath?: string;
  apiPrefix?: string;
  pageTitle?: string;
  menuLabel?: string;
  menuOrder?: number;
  maxUploadBytes?: number;
  allowedExtensions?: string[] | null;
  allowedMimeTypes?: string[] | null;
  includePage?: boolean;
}

export function fileManagerPlugin(options?: FileManagerPluginOptions): WebspressoPlugin;

// --- XLSX Plugin & Toolkit ---

export interface XlsxColumn {
  header?: string;
  key: string;
  width?: number;
  style?: Record<string, unknown>;
}

export interface XlsxHeaderStyle {
  fill?: string;
  bg?: string;
  color?: string;
  textColor?: string;
  fontName?: string;
  fontSize?: number;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  height?: number;
}

export interface XlsxSheetConfig {
  name?: string;
  columns?: XlsxColumn[];
  rows?: Record<string, unknown>[];
  data?: Record<string, unknown>[];
  autoWidth?: boolean;
  striped?: boolean;
  headerStyle?: XlsxHeaderStyle;
  views?: Array<Record<string, unknown>>;
}

export interface XlsxGenerateOptions {
  creator?: string;
  title?: string;
  created?: Date;
  sanitizeFormulas?: boolean;
  headerStyle?: XlsxHeaderStyle;
  sheets?: XlsxSheetConfig[] | XlsxSheetConfig;
  name?: string;
  columns?: XlsxColumn[];
  rows?: Record<string, unknown>[];
  data?: Record<string, unknown>[];
}

export interface XlsxParseOptions {
  sheet?: string | number;
  headerRow?: number;
  dataStartRow?: number;
  raw?: boolean;
  transformRow?: (row: Record<string, unknown>, index: number) => Record<string, unknown>;
}

export interface XlsxModelExportOptions {
  sheetName?: string;
  name?: string;
  creator?: string;
  title?: string;
  columns?: XlsxColumn[];
  headerStyle?: XlsxHeaderStyle;
}

export interface XlsxPluginOptions {
  enabled?: boolean;
  sanitizeFormulas?: boolean;
  headerStyle?: XlsxHeaderStyle;
  db?: unknown;
}

export interface XlsxToolkit {
  MIME_TYPE: string;
  generate(options: XlsxGenerateOptions): Promise<Buffer>;
  parse(input: Buffer | import('stream').Readable, options?: XlsxParseOptions): Promise<Record<string, unknown>[] | Record<string, Record<string, unknown>[]>>;
  fromModel(repository: unknown, filterOrQuery?: unknown, options?: XlsxModelExportOptions): Promise<Buffer>;
  createStreamWriter(outputStream: import('stream').Writable, options?: Record<string, unknown>): unknown;
  sanitizeFormula(value: unknown): unknown;
  applyHeaderStyle(worksheet: unknown, style?: XlsxHeaderStyle): void;
  applyAutoWidths(worksheet: unknown, columns: XlsxColumn[], rows: Record<string, unknown>[]): void;
  hexToArgb(hex: string): string;
  createMiddleware(globalOptions?: XlsxPluginOptions): import('express').RequestHandler;
  createServices(options?: Record<string, unknown>): Record<string, unknown>;
}

export const xlsx: XlsxToolkit;
export function xlsxPlugin(options?: XlsxPluginOptions): WebspressoPlugin;

// --- CSV Plugin & Toolkit ---

export interface CsvColumn {
  header?: string;
  key: string;
}

export interface CsvGenerateOptions {
  rows?: Record<string, unknown>[];
  data?: Record<string, unknown>[];
  columns?: (CsvColumn | string)[];
  delimiter?: string;
  eol?: string;
  header?: boolean;
  bom?: boolean;
  sanitizeFormulas?: boolean;
  asBuffer?: boolean;
}

export interface CsvParseOptions {
  delimiter?: string;
  columns?: boolean | string[];
  skip_empty_lines?: boolean;
  trim?: boolean;
  relax_column_count?: boolean;
  transformRow?: (row: Record<string, unknown>, index: number) => Record<string, unknown>;
  [key: string]: unknown;
}

export interface CsvModelExportOptions {
  columns?: (CsvColumn | string)[];
  delimiter?: string;
  eol?: string;
  bom?: boolean;
  sanitizeFormulas?: boolean;
  asBuffer?: boolean;
}

export interface CsvPluginOptions {
  enabled?: boolean;
  delimiter?: string;
  bom?: boolean;
  sanitizeFormulas?: boolean;
  db?: unknown;
}

export interface CsvStreamWriter {
  writeHeader(columns?: (CsvColumn | string)[]): void;
  writeRow(row: Record<string, unknown>): void;
  writeRows(rows: Record<string, unknown>[]): void;
  end(): void;
  stream: import('stream').Writable;
}

export interface CsvToolkit {
  MIME_TYPE: string;
  UTF8_BOM: string;
  generate(options?: CsvGenerateOptions): Buffer | string;
  parse(input: Buffer | string | import('stream').Readable, options?: CsvParseOptions): Promise<Record<string, unknown>[]>;
  fromModel(repository: unknown, filterOrQuery?: unknown, options?: CsvModelExportOptions): Promise<Buffer>;
  createStreamWriter(outputStream: import('stream').Writable, options?: Record<string, unknown>): CsvStreamWriter;
  sanitizeFormula(value: unknown): unknown;
  escapeCsvField(value: unknown, options?: Record<string, unknown>): string;
  createMiddleware(globalOptions?: CsvPluginOptions): import('express').RequestHandler;
  createServices(options?: Record<string, unknown>): Record<string, unknown>;
}

export const csv: CsvToolkit;
export function csvPlugin(options?: CsvPluginOptions): WebspressoPlugin;

// --- Discovery, Pages, API & Modules ---

export interface PageContext<TParams = Record<string, string>, TQuery = Record<string, string>> {
  req: import('express').Request;
  res: import('express').Response;
  params: TParams;
  query: TQuery;
  service: WebspressoServiceCaller;
  module: string | null;
  config: Record<string, unknown>;
  logger: Console;
  redirect: (url: string, status?: number) => { __redirected: boolean };
  error: (status?: number, message?: string) => never;
  earlyHints?: (links: string | EarlyHintLink | (string | EarlyHintLink)[], callback?: (err?: Error | null) => void) => boolean;
  fsy: Record<string, unknown>;
  locale: string;
  t: (key: string, params?: Record<string, unknown>) => string;
  db: unknown;
}

export interface DefinePageOptions<TData = any, TParams = Record<string, string>, TQuery = Record<string, string>> {
  middleware?: (string | import('express').RequestHandler | [string, Record<string, unknown>])[];
  earlyHints?: boolean | (string | EarlyHintLink)[] | EarlyHintsOptions;
  load?: (ctx: PageContext<TParams, TQuery>) => Promise<TData> | TData;
  head?: (data: TData, ctx: PageContext<TParams, TQuery>) => Record<string, unknown>;
  render?: (data: TData, ctx: PageContext<TParams, TQuery>) => string | Promise<string>;
  layout?: string | boolean;
  hooks?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export function definePage<TData = any, TParams = Record<string, string>, TQuery = Record<string, string>>(
  config: DefinePageOptions<TData, TParams, TQuery> | ((ctx: PageContext<TParams, TQuery>) => Promise<TData> | TData)
): DefinePageOptions<TData, TParams, TQuery>;

export interface ApiContext<TBody = any, TParams = Record<string, string>, TQuery = Record<string, string>> {
  req: import('express').Request;
  res: import('express').Response;
  params: TParams;
  query: TQuery;
  body: TBody;
  input: { body?: TBody; params?: TParams; query?: TQuery; headers?: Record<string, string> };
  locale: string;
  t: Translator;
  service: WebspressoServiceCaller;
  module: string | null;
  config: Record<string, unknown>;
  logger: Console;
  db: unknown;
  sse?: (sourceOrOptions?: any, maybeOptions?: any) => any;
}

export interface DefineApiOptions<TResult = any, TBody = any, TParams = Record<string, string>, TQuery = Record<string, string>> {
  description?: string;
  tags?: string[];
  middleware?: (string | import('express').RequestHandler | [string, Record<string, unknown>])[];
  schema?: {
    params?: unknown;
    query?: unknown;
    body?: unknown;
    headers?: unknown;
  } | ((helpers: { z: typeof import('zod').z }) => Record<string, unknown>);
  response?: Record<number | string, unknown>;
  handler: (req: import('express').Request, ctx: ApiContext<TBody, TParams, TQuery>) => Promise<TResult> | TResult;
  [key: string]: unknown;
}

export function defineApi<TResult = any, TBody = any, TParams = Record<string, string>, TQuery = Record<string, string>>(
  config: DefineApiOptions<TResult, TBody, TParams, TQuery> | ((req: import('express').Request, ctx: ApiContext<TBody, TParams, TQuery>) => Promise<TResult> | TResult)
): DefineApiOptions<TResult, TBody, TParams, TQuery>;

export interface DefineModuleOptions {
  name: string;
  version?: string;
  description?: string;
  imports?: string[];
  dependencies?: string[];
  pages?: boolean | { dir?: string; prefix?: string };
  api?: boolean | { dir?: string; prefix?: string };
  services?: Record<string, unknown> | boolean | { dir?: string };
  middlewares?: Record<string, import('express').RequestHandler> | boolean | { dir?: string };
  exports?: Record<string, unknown>;
  apiExports?: Record<string, unknown>;
  onInit?: (ctx: unknown) => void | Promise<void>;
  onDestroy?: (ctx: unknown) => void | Promise<void>;
  [key: string]: unknown;
}

export function defineModule(config: DefineModuleOptions): (userOptions?: Record<string, unknown>) => WebspressoPlugin;

export interface RouteDescriptor {
  type: 'page' | 'api';
  method: string;
  path: string;
  file: string;
  source?: string;
  module?: string | null;
  description?: string;
  tags?: string[];
  moduleConfig?: unknown;
}

export class RouteTable {
  routes: ReadonlyArray<RouteDescriptor>;
  constructor(routes?: RouteDescriptor[]);
  list(): Array<{ method: string; path: string; type: string; module: string | null; source: string; description?: string; tags?: string[] }>;
  get(method: string, path: string): RouteDescriptor | undefined;
  has(method: string, path: string): boolean;
  get size(): number;
}

export function scanRoutes(options?: {
  rootDir?: string;
  pages?: boolean | { dir?: string; prefix?: string };
  api?: boolean | { dir?: string; prefix?: string };
  modules?: boolean | { dir?: string };
}): RouteDescriptor[] & { scannedPagesFiles?: string[]; scannedPagesDir?: string | null };

export function discoverAppRoutes(options?: {
  rootDir?: string;
  pages?: boolean | { dir?: string; prefix?: string };
  api?: boolean | { dir?: string; prefix?: string };
  modules?: boolean | { dir?: string };
  routes?: Array<{ method?: string; path: string }>;
  isDev?: boolean;
}): {
  descriptors: RouteDescriptor[];
  routeTable: RouteTable;
  scannedPagesFiles: string[];
  scannedPagesDir: string | null;
};

export function parseFileRoute(
  relativePath: string,
  options?: { type?: 'page' | 'api'; prefix?: string }
): { path: string; method: string; isValid: boolean; isPrivate: boolean; originalMethodPart?: string };

export function compileRouteTable(
  descriptors?: RouteDescriptor[],
  options?: { explicitRoutes?: Array<{ method?: string; path: string }>; isDev?: boolean }
): RouteTable;

export function generateRouteManifest(options?: {
  rootDir?: string;
  pages?: boolean | string | { dir?: string; prefix?: string };
  api?: boolean | string | { dir?: string; prefix?: string };
  modules?: boolean | { dir?: string };
  pagesDir?: string;
  outDir?: string;
  outFile?: string;
  silent?: boolean;
}): {
  manifest: {
    version: number;
    generatedAt: string;
    pagesDirRel: string;
    scannedPagesFiles: string[];
    routes: Array<{
      type: 'page' | 'api';
      method: string;
      path: string;
      source: string;
      module?: string | null;
      moduleConfig?: { name?: string } | null;
    }>;
  };
  manifestPath: string;
  routeCount: number;
  scannedFilesCount: number;
};

export function loadRouteManifest(options?: {
  rootDir?: string;
  manifestPath?: string;
}): {
  manifest: {
    version: number;
    generatedAt: string;
    pagesDirRel: string;
    scannedPagesFiles: string[];
    routes: Array<{
      type: 'page' | 'api';
      method: string;
      path: string;
      source: string;
      module?: string | null;
      moduleConfig?: { name?: string } | null;
    }>;
  };
  descriptors: RouteDescriptor[] & { scannedPagesFiles?: string[]; scannedPagesDir?: string | null };
} | null;

export function precompileTemplates(options?: {
  rootDir?: string;
  viewsDir?: string;
  pagesDir?: string;
  outDir?: string;
  outFile?: string;
  env?: any;
}): {
  templateCount: number;
  manifestPath: string;
  bundle: {
    version: number;
    generatedAt: string;
    templates: Record<string, string>;
    frontmatter: Record<string, any>;
  };
};

export function loadPrecompiledTemplates(options?: {
  rootDir?: string;
  bundlePath?: string;
}): {
  loader: any;
  templateCount: number;
  bundle: {
    version: number;
    generatedAt: string;
    templates: Record<string, string>;
    frontmatter: Record<string, any>;
  };
} | null;

export interface GenerateTypesOptions {
  /** Root directory of the project (default: process.cwd()) */
  rootDir?: string;
  /** Alias for rootDir */
  cwd?: string;
  /** Models directory relative to root (default: 'models') */
  modelsDir?: string;
  /** Services directory relative to root (default: 'services') */
  servicesDir?: string;
  /** Pages directory relative to root (default: 'pages') */
  pagesDir?: string;
  /** Output directory (default: '.webspresso') */
  outDir?: string;
  /** Custom output file path (default: '.webspresso/types.d.ts') */
  outFile?: string;
  /** Create companion webspresso-env.d.ts at project root (default: true) */
  createEnvFile?: boolean;
  /** Write declaration files to disk (default: true) */
  write?: boolean;
  /** Suppress console output (default: false) */
  silent?: boolean;
}

export interface GenerateTypesResult {
  code: string;
  modelsCount: number;
  servicesCount: number;
  routesCount: number;
  outFile: string;
  envFile: string | null;
}

export function generateTypes(options?: GenerateTypesOptions): GenerateTypesResult;

// --- OAuth 2.0 & Social Login Plugin ---

export class OAuthError extends Error {
  code: string;
  details?: any;
  constructor(message: string, code?: string, details?: any);
}

export interface OAuthUserProfile {
  provider: string;
  id: string;
  email?: string | null;
  emailVerified?: boolean;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  location?: string | null;
  locale?: string | null;
  raw: Record<string, any>;
  [key: string]: any;
}

export interface OAuthProviderConfig {
  name?: string;
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  scopes?: string[] | string;
  defaultScopes?: string[];
  params?: Record<string, any>;
  normalizeProfile?: (raw: any, extra?: any) => OAuthUserProfile;
  fetchExtra?: (tokens: any) => Promise<any>;
}

export interface OAuthClientConfig {
  secret?: string;
  stateTtlMs?: number;
  providers?: Record<string, OAuthProviderConfig>;
}

export class OAuthClient {
  secret: string;
  stateTtlMs: number;
  providers: Record<string, OAuthProviderConfig>;
  constructor(config?: OAuthClientConfig);
  registerProvider(name: string, options?: OAuthProviderConfig): this;
  getProvider(name: string): OAuthProviderConfig;
  getProviderNames(): string[];
  getAuthorizationUrl(providerName: string, options?: {
    redirectUri?: string;
    scopes?: string[] | string;
    stateData?: Record<string, any>;
    pkce?: boolean;
    extraParams?: Record<string, any>;
  }): { url: string; state: string; codeVerifier?: string };
  exchangeCode(providerName: string, params: {
    code: string;
    redirectUri?: string;
    codeVerifier?: string;
  }): Promise<Record<string, any>>;
  fetchUserProfile(providerName: string, tokens: Record<string, any>): Promise<OAuthUserProfile>;
  handleCallback(providerName: string, params: {
    code: string;
    state: string;
    redirectUri?: string;
  }): Promise<{ provider: string; user: OAuthUserProfile; tokens: Record<string, any>; stateData: Record<string, any> }>;
}

export function createOAuthClient(config?: OAuthClientConfig): OAuthClient;
export function generatePKCE(): { codeVerifier: string; codeChallenge: string; codeChallengeMethod: 'S256' };
export function createSignedState(payload: Record<string, any>, secret: string): string;
export function verifySignedState(stateString: string, secret: string, maxAgeMs?: number): Record<string, any>;

export interface OAuthPluginOptions {
  client?: OAuthClient;
  providers?: Record<string, OAuthProviderConfig>;
  secret?: string;
  pathPrefix?: string;
  routes?: boolean;
  pkce?: boolean;
  stateTtlMs?: number;
  defaultReturnTo?: string;
  failureRedirect?: string;
  findOrCreateUser?: (params: {
    provider: string;
    profile: OAuthUserProfile;
    tokens: Record<string, any>;
    stateData: Record<string, any>;
    req: any;
    res: any;
    db?: any;
  }) => Promise<any>;
  onSuccess?: (params: {
    provider: string;
    user: any;
    profile: OAuthUserProfile;
    tokens: Record<string, any>;
    stateData: Record<string, any>;
    req: any;
    res: any;
    client: OAuthClient;
  }) => Promise<void | any>;
  onError?: (params: {
    error: Error | OAuthError;
    provider: string;
    req: any;
    res: any;
    client: OAuthClient;
  }) => Promise<void | any>;
  db?: any;
}

export function oauthPlugin(options?: OAuthPluginOptions): WebspressoPlugin;

// ==========================================
// 2FA / TOTP (RFC 6238, RFC 4226, RFC 4648)
// ==========================================

export interface Base32EncodeOptions {
  padding?: boolean;
}

export interface TotpSecretOptions extends Base32EncodeOptions {
  length?: number;
}

export interface HotpOptions {
  digits?: number;
  algorithm?: 'sha1' | 'sha256' | 'sha512' | string;
  encoding?: 'base32' | 'ascii' | 'utf8' | 'hex';
}

export interface TotpOptions extends HotpOptions {
  time?: number | Date;
  step?: number;
  epoch?: number;
}

export interface TotpVerifyOptions extends TotpOptions {
  window?: number;
  detailed?: boolean;
}

export interface TotpUriOptions {
  secret: string;
  account?: string;
  issuer?: string;
  label?: string;
  algorithm?: string;
  digits?: number;
  period?: number;
}

export interface QrSvgOptions {
  size?: number;
  margin?: number;
  darkColor?: string;
  lightColor?: string;
  version?: number;
  ecc?: 'L' | 'M' | 'Q' | 'H';
  mask?: number;
}

export interface RecoveryCodeOptions {
  count?: number;
  length?: number;
  hyphen?: boolean;
}

export interface TotpSetupOptions extends TotpSecretOptions {
  user?: any;
  account?: string;
  issuer?: string;
  recoveryCodeCount?: number;
  qrOptions?: QrSvgOptions;
  algorithm?: string;
  digits?: number;
  period?: number;
}

export interface TotpSetupResult {
  secret: string;
  uri: string;
  qrSvg: string;
  qrDataUri: string;
  recoveryCodes: string[];
  recoveryCodesHashed: string[];
}

export function base32Encode(buffer: Buffer | string, options?: Base32EncodeOptions): string;
export function base32Decode(input: string): Buffer;
export function generateTotpSecret(options?: TotpSecretOptions): string;
export function generateHotp(secret: string | Buffer, counter: number | bigint, options?: HotpOptions): string;
export function verifyHotp(token: string, secret: string | Buffer, counter: number | bigint, options?: HotpOptions): boolean;
export function generateTotp(secret: string | Buffer, options?: TotpOptions): string;
export function verifyTotp(token: string, secret: string | Buffer, options?: TotpVerifyOptions): boolean | { valid: boolean; delta: number | null };
export function generateTotpUri(options: TotpUriOptions): string;
export function generateTotpQrSvg(uriOrOptions: string | TotpUriOptions, svgOptions?: QrSvgOptions): string;
export function generateTotpQrDataUri(uriOrOptions: string | TotpUriOptions, svgOptions?: QrSvgOptions): string;
export function generateRecoveryCodes(options?: RecoveryCodeOptions): string[];
export function hashRecoveryCode(code: string): string;
export function verifyRecoveryCode(code: string, hashedCodes: string[]): { valid: boolean; matchedIndex: number; remainingHashedCodes: string[] };
export function createTotpSetup(options?: TotpSetupOptions): TotpSetupResult;

export function createQrMatrix(text: string, options?: QrSvgOptions): { matrix: boolean[][]; size: number; version: number };
export function generateQrSvg(text: string, options?: QrSvgOptions): string;
export function generateQrDataUri(text: string, options?: QrSvgOptions): string;

export namespace totp {
  export {
    base32Encode,
    base32Decode,
    generateTotpSecret,
    generateHotp,
    verifyHotp,
    generateTotp,
    verifyTotp,
    generateTotpUri,
    generateTotpQrSvg,
    generateTotpQrDataUri,
    generateRecoveryCodes,
    hashRecoveryCode,
    verifyRecoveryCode,
    createTotpSetup,
    createQrMatrix,
    generateQrSvg,
    generateQrDataUri,
  };
}

// --- Magic Link / Passwordless Authentication ---

export interface BuildMagicLinkUrlOptions {
  baseUrl?: string;
  path?: string;
  token: string;
}

export interface FormatMagicLinkHtmlOptions {
  name?: string;
  magicLinkUrl: string;
  expiresMinutes?: number;
}

export interface MagicLinkVerifyMiddlewareOptions {
  tokenParam?: string;
  redirectTo?: string;
  failureRedirect?: string;
  markEmailVerified?: boolean;
  jwt?: boolean;
}

export interface MagicLinkRequestOptions {
  baseUrl?: string;
  path?: string;
  tokenTtlMs?: number;
  hideUserNotFound?: boolean;
  buildMagicLinkUrl?: (token: string) => string;
}

export interface MagicLinkRequestResult {
  sent: boolean;
  userFound: boolean;
  expiresAt?: Date;
  token?: string;
  magicLinkUrl?: string;
}

export interface MagicLinkVerifyResult {
  ok: true;
  user: any;
  userId: string | number;
  accessToken?: string;
  refreshToken?: string;
}

export function buildMagicLinkUrl(options: BuildMagicLinkUrlOptions): string;
export function formatMagicLinkHtml(options: FormatMagicLinkHtmlOptions): string;
export function createMagicLinkVerifyMiddleware(authManager: any, options?: MagicLinkVerifyMiddlewareOptions): (req: any, res: any, next: any) => Promise<any>;
export function createMagicLinkRequestHandler(authManager: any, options?: MagicLinkRequestOptions): (req: any, res: any) => Promise<any>;

export namespace magicLink {
  export {
    buildMagicLinkUrl,
    formatMagicLinkHtml,
    createMagicLinkVerifyMiddleware,
    createMagicLinkRequestHandler,
  };
}

// Active Devices & Session Management
export interface DeviceInfo {
  browser: string;
  os: string;
  device: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isBot: boolean;
}

export interface UserSession {
  id?: number | string;
  session_id: string;
  user_id: number | string;
  ip_address?: string | null;
  user_agent?: string | null;
  browser?: string | null;
  os?: string | null;
  device?: string | null;
  last_active_at: Date;
  created_at?: Date;
  is_current?: boolean;
}

export interface SessionTracker {
  track(sessionId: string, userId: string | number, metadata?: { ip?: string; userAgent?: string; browser?: string; os?: string; device?: string }): Promise<UserSession | null>;
  touch(sessionId: string): Promise<boolean>;
  get(sessionId: string): Promise<UserSession | null>;
  list(userId: string | number, currentSessionId?: string | null): Promise<UserSession[]>;
  isSessionValid(sessionId: string, userId?: string | number | null): Promise<boolean>;
  revoke(sessionId: string): Promise<boolean>;
  revokeOthers(userId: string | number, currentSessionId?: string | null): Promise<number>;
  revokeAll(userId: string | number): Promise<number>;
  purgeExpired(maxAgeMs: number): Promise<number>;
}

export interface SessionManagerOptions {
  tracker?: SessionTracker;
  sessionStore?: any;
  touchThrottleMs?: number;
  emitter?: any;
}

export class SessionManager {
  constructor(options?: SessionManagerOptions);
  tracker: SessionTracker;
  sessionStore?: any;
  touchThrottleMs: number;
  emitter?: any;
  track(sessionId: string, userId: string | number, req?: any): Promise<UserSession | null>;
  touch(sessionId: string): Promise<boolean>;
  isSessionValid(sessionId: string, userId?: string | number | null): Promise<boolean>;
  listSessions(userId: string | number, currentSessionId?: string | null): Promise<UserSession[]>;
  revokeSession(sessionId: string, options?: { userId?: string | number; revokedBy?: string }): Promise<boolean>;
  revokeOtherSessions(userId: string | number, currentSessionId: string): Promise<number>;
  revokeAllSessions(userId: string | number): Promise<number>;
}

export function parseUserAgent(userAgent?: string): DeviceInfo;
export function getClientIp<T = string>(req?: any, fallback?: T): string | T;
export function createUserSessionsTable(knex: any): Promise<void>;
export function dropUserSessionsTable(knex: any): Promise<void>;
export function createKnexSessionTracker(db: any, options?: { tableName?: string }): SessionTracker;
export function createMemorySessionTracker(): SessionTracker;
export function createListSessionsHandler(authManager: any): (req: any, res: any) => Promise<any>;
export function createRevokeSessionHandler(authManager: any): (req: any, res: any) => Promise<any>;

export namespace sessions {
  export {
    SessionManager,
    createUserSessionsTable,
    dropUserSessionsTable,
    createKnexSessionTracker,
    createMemorySessionTracker,
    getClientIp,
    parseUserAgent,
    createListSessionsHandler,
    createRevokeSessionHandler,
  };
}

// Custom Management Commands (Django & Adonis Ace-inspired)
export interface CommandOption {
  flags: string;
  description?: string;
  defaultValue?: any;
}

export interface CommandExecutionContext {
  db: any;
  queue: any;
  services: any;
  mailer: any;
  events: any;
  logger: any;
  args: string[];
  flags: Record<string, any>;
}

export interface CommandDefinition {
  name: string;
  description?: string;
  options?: CommandOption[];
  handle: (ctx: CommandExecutionContext) => Promise<any> | any;
}

export interface CommandRegistry {
  register(cmd: CommandDefinition): CommandDefinition;
  reload(): void;
  has(name: string): boolean;
  get(name: string): CommandDefinition | null;
  list(): CommandDefinition[];
  names(): string[];
  readonly commandsDir: string;
}

export function defineCommand(definition: CommandDefinition): CommandDefinition;
export function createCommandRegistry(options?: { commandsDir?: string; autoLoad?: boolean }): CommandRegistry;
export function executeCommand(
  commandDef: CommandDefinition,
  executionOptions?: Partial<CommandExecutionContext>
): Promise<{ success: boolean; result?: any; error?: Error; durationMs: number }>;

export namespace commands {
  export {
    defineCommand,
    createCommandRegistry,
    executeCommand,
  };
}

// --- Row Level Security Plugin ---
export interface RlsPluginOptions {
  bypassRoles?: string[] | ((user: Record<string, any> | null, req: any) => boolean) | false;
  getUser?: (req: any) => Record<string, any> | null;
  getTenantId?: (req: any, user: Record<string, any> | null) => unknown;
  global?: boolean;
  enabled?: boolean;
}

export function rlsPlugin(options?: RlsPluginOptions): import('./src/plugin-manager').Plugin;
export function createRlsMiddleware(options?: RlsPluginOptions): (req: any, res: any, next: (err?: any) => void) => void;




/**
 * Type definitions for webspresso (CommonJS package).
 */

import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';
import type { Knex } from 'knex';
import type { ZodObject, ZodTypeAny } from 'zod';

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
  auth?: unknown;
  db?: DatabaseInstance | null;
  /** HTTP response compression options */
  compression?: boolean | CompressionOptions;
  /** Shutdown and lifecycle configuration */
  shutdown?: ShutdownOptions;
  server?: {
    port?: number;
    shutdown?: ShutdownOptions;
    compression?: boolean | CompressionOptions;
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
  setupRoutes?: (app: Application, ctx: SetupRoutesContext) => void;
  [key: string]: unknown;
}

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
}

export interface CreateAppResult {
  app: WebspressoApplication;
  nunjucksEnv: unknown;
  pluginManager: PluginManager;
  authMiddleware?: RequestHandler;
  shutdownManager: ShutdownManager;
}

export function createApp(options?: CreateAppOptions): CreateAppResult;

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
export class TooManyRequestsError extends HttpError { constructor(message?: string, options?: ErrorOptions); }

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
};

export function getDb(): DatabaseInstance;

export function hasDb(): boolean;

export function getShutdownManager(): ShutdownManager | null;

export function hasShutdownManager(): boolean;

export function getServiceRegistry(): ServiceRegistry | null;

export function hasServiceRegistry(): boolean;

export function resetAppContext(): void;

export function setAppContext(partial: {
  db?: DatabaseInstance | null;
  shutdownManager?: ShutdownManager | null;
  serviceRegistry?: ServiceRegistry | null;
}): void;

// --- File router ---

export function mountPages(
  app: Application,
  options: Record<string, unknown>
): {
  routeMetadata: unknown[];
  registerDynamicFileRoutes: () => void;
};

export function filePathToRoute(filePath: string, pagesDir: string): string;

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

// --- Helpers / assets ---

export function createHelpers(context: Record<string, unknown>): Record<string, unknown>;

export const utils: Record<string, unknown>;

export class AssetManager {
  constructor(options?: Record<string, unknown>);
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
  [key: string]: unknown;
}

export type RelationType = 'belongsTo' | 'hasMany' | 'hasOne';

export interface RelationDefinition {
  type: RelationType;
  model: () => ModelDefinition;
  foreignKey: string;
  localKey?: string;
}

export interface AdminMetadata {
  enabled?: boolean;
  label?: string;
  icon?: string | null;
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

export interface ModelOptions<TSchema extends ZodObject<any> = ZodObject<Record<string, ZodTypeAny>>> {
  name: string;
  table: string;
  schema: TSchema;
  primaryKey?: string;
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
  cache?: boolean | 'auto' | 'smart' | { strategy: 'auto' | 'smart' };
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
  hooks: Record<string, unknown>;
  cache?: boolean | 'auto' | 'smart' | { strategy: 'auto' | 'smart' };
}

export function defineModel<TSchema extends ZodObject<any>>(
  options: ModelOptions<TSchema>
): ModelDefinition<import('zod').z.infer<TSchema>>;

export function getModel<T = Record<string, any>>(name: string): ModelDefinition<T> | undefined;

export function getAllModels(): Map<string, ModelDefinition<any>>;

export function hasModel(name: string): boolean;

export function clearRegistry(): void;

// --- ORM: schema & columns ---

/** zdb column helpers (id, string, timestamp, …) + `schema()` */
export type Zdb = Record<string, any> & {
  schema(shape: Record<string, ZodTypeAny>): ZodObject<Record<string, ZodTypeAny>>;
};

export const zdb: Zdb;

export function createSchemaHelpers(z: typeof import('zod').z): Zdb;

export function extractColumnsFromSchema(schema: ZodObject<Record<string, ZodTypeAny>>): Map<string, unknown>;

export function getColumnMeta(schema: ZodTypeAny): unknown;

// --- ORM: query / repository ---

export interface FindOptions {
  with?: string[];
  select?: string[];
}

export interface PaginatedResult<T = Record<string, any>> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
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
  limit(n: number): this;
  offset(n: number): this;
  with(...relations: string[]): this;
  withTrashed(): this;
  onlyTrashed(): this;
  first(): Promise<T | null>;
  list(): Promise<T[]>;
  get(): Promise<T[]>;
  count(): Promise<number>;
  paginate(page?: number, perPage?: number): Promise<PaginatedResult<T>>;
  exists(): Promise<boolean>;
  clone(): QueryBuilder<T>;
  getWiths(): string[];
  delete(): Promise<number>;
  update(data: Partial<T> | Record<string, unknown>): Promise<number>;
  [key: string]: unknown;
}

export interface Repository<T = Record<string, any>> {
  findById(id: string | number, options?: FindOptions): Promise<T | null>;
  findOne(conditions: Partial<T> | Record<string, unknown>, options?: FindOptions): Promise<T | null>;
  findAll(options?: FindOptions): Promise<T[]>;
  create(data: Partial<T> | Record<string, unknown>): Promise<T>;
  createMany(data: (Partial<T> | Record<string, unknown>)[]): Promise<T[]>;
  update(id: string | number, data: Partial<T> | Record<string, unknown>): Promise<T | null>;
  updateWhere(conditions: Partial<T> | Record<string, unknown>, data: Partial<T> | Record<string, unknown>): Promise<number>;
  delete(id: string | number): Promise<boolean>;
  forceDelete(id: string | number): Promise<boolean>;
  restore(id: string | number): Promise<T | null>;
  query(): QueryBuilder<T>;
  raw(sql: string, bindings?: unknown[]): Promise<unknown>;
  count(conditions?: Partial<T> | Record<string, unknown>): Promise<number>;
  exists(conditions: Partial<T> | Record<string, unknown>): Promise<boolean>;
  with(...relations: string[]): QueryBuilder<T>;
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
}

export interface TransactionContext {
  trx: Knex.Transaction;
  getRepository<T = Record<string, any>>(modelName: string, scopeContext?: ScopeContext): Repository<T>;
  createRepository<T = Record<string, any>>(model: ModelDefinition<T>, scopeContext?: ScopeContext): Repository<T>;
}

export interface DatabaseInstance {
  knex: Knex;
  migrate: MigrationManager;
  getModel<T = Record<string, any>>(name: string): ModelDefinition<T>;
  hasModel(name: string): boolean;
  getAllModels(): ModelDefinition<any>[];
  registerModel<T = Record<string, any>>(model: ModelDefinition<T>): void;
  getRepository<T = Record<string, any>>(modelName: string, scopeContext?: ScopeContext): Repository<T>;
  createRepository<T = Record<string, any>>(model: ModelDefinition<T>, scopeContext?: ScopeContext): Repository<T>;
  query<T = Record<string, any>>(modelName: string, scopeContext?: ScopeContext): QueryBuilder<T>;
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

export function createMemoryCacheProvider(options?: OrmMemoryCacheOptions): {
  get(key: string): unknown;
  set(key: string, value: unknown, opts?: { tags?: string[]; ttlMs?: number }): void;
  invalidateTags(tags: string[]): void;
  clear(): void;
  getSizeStats(): { entries: number; tags: number };
};

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

// --- Built-in plugins (subset re-exported from main index.js) ---

export function schemaExplorerPlugin(options?: Record<string, unknown>): WebspressoPlugin;

export function adminPanelPlugin(options?: Record<string, unknown>): WebspressoPlugin;

export function dataExchangePlugin(options?: Record<string, unknown>): WebspressoPlugin;

export function siteAnalyticsPlugin(options?: Record<string, unknown>): WebspressoPlugin;

export function auditLogPlugin(options?: Record<string, unknown>): WebspressoPlugin;

export function recaptchaPlugin(options?: Record<string, unknown>): WebspressoPlugin;

export function swaggerPlugin(options?: Record<string, unknown>): WebspressoPlugin;

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
}

export interface DispatchOptions {
  delay?: number | Date;
  attempts?: number;
  priority?: number;
  timeout?: number;
  backoff?: number | { type?: 'exponential' | 'fixed'; delay?: number };
}

export class QueueManager extends import('events').EventEmitter {
  adapter: QueueAdapter;
  concurrency: number;
  pollInterval: number;
  isRunning: boolean;
  isPaused: boolean;
  isDraining: boolean;
  constructor(options?: {
    adapter?: QueueAdapter;
    concurrency?: number;
    pollInterval?: number;
    jobsDir?: string | null;
    autoStart?: boolean;
  });
  define(name: string, handler: (job: Job, ctx: { queue: QueueManager }) => Promise<any> | any, options?: DispatchOptions): this;
  has(name: string): boolean;
  dispatch(name: string, data?: unknown, options?: DispatchOptions): Promise<Job>;
  start(): this;
  pause(): this;
  resume(): this;
  drain(timeoutMs?: number): Promise<void>;
  stop(): Promise<void>;
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
}): PluginDefinition;

// --- SSR Streaming & Chunked Transfer ---

export interface HtmlStreamOptions {
  env: import('nunjucks').Environment;
  templatePath: string;
  context?: Record<string, unknown>;
  defer?: Record<string, Promise<unknown> | { promise: Promise<unknown>; template?: string }>;
}

export interface RenderStreamOptions {
  env?: import('nunjucks').Environment;
  defer?: Record<string, Promise<unknown> | { promise: Promise<unknown>; template?: string }>;
  status?: number;
  flushImmediately?: boolean;
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



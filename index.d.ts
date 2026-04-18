/**
 * Type definitions for webspresso (CommonJS package).
 */

import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';
import type { Knex } from 'knex';
import type { ZodObject, ZodTypeAny } from 'zod';

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
  middlewares?: Record<string, RequestHandler>;
  plugins?: WebspressoPlugin[];
  assets?: {
    version?: string;
    manifestPath?: string;
    prefix?: string;
  };
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
  setupRoutes?: (app: Application, ctx: SetupRoutesContext) => void;
  [key: string]: unknown;
}

export interface SetupRoutesContext {
  nunjucksEnv: unknown;
  authMiddleware?: RequestHandler;
  pluginManager: PluginManager;
  options: CreateAppOptions;
}

export interface CreateAppResult {
  app: Application;
  nunjucksEnv: unknown;
  pluginManager: PluginManager;
  authMiddleware?: RequestHandler;
}

export function createApp(options?: CreateAppOptions): CreateAppResult;

// --- App context ---

export function attachDbMiddleware(req: Request, res: Response, next: NextFunction): void;

export function getAppContext(): { db: DatabaseInstance | null };

export function getDb(): DatabaseInstance;

export function hasDb(): boolean;

export function resetAppContext(): void;

export function setAppContext(partial: { db?: DatabaseInstance | null }): void;

// --- File router ---

export function mountPages(
  app: Application,
  options: Record<string, unknown>
): unknown;

export function filePathToRoute(filePath: string, pagesDir: string): string;

export function extractMethodFromFilename(filename: string): string | null;

export function scanDirectory(
  dir: string,
  options?: Record<string, unknown>
): unknown[];

export function loadI18n(pagesDir: string, routePath?: string): Record<string, unknown>;

export function createTranslator(
  dictionaries: Record<string, unknown>,
  locale: string
): (key: string, params?: Record<string, unknown>) => string;

export function detectLocale(
  req: Request,
  supportedLocales: string[],
  defaultLocale: string
): string;

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

export interface ModelOptions {
  name: string;
  table: string;
  schema: ZodObject<Record<string, ZodTypeAny>>;
  primaryKey?: string;
  relations?: Record<string, RelationDefinition>;
  scopes?: ScopeOptions;
  admin?: AdminMetadata;
  rest?: RestMetadata;
  hooks?: Record<string, (...args: unknown[]) => unknown>;
  hidden?: string[];
  cache?: boolean | 'auto' | 'smart' | { strategy: 'auto' | 'smart' };
}

export interface ModelDefinition {
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
    queries: Record<string, (repo: Repository) => Promise<unknown>>;
  };
  rest: {
    enabled: boolean;
    path: string | null;
    allowInclude: string[] | null;
  };
  hidden: string[];
  hooks: Record<string, unknown>;
  cache?: boolean | 'auto' | 'smart' | { strategy: 'auto' | 'smart' };
}

export function defineModel(options: ModelOptions): ModelDefinition;

export function getModel(name: string): ModelDefinition | undefined;

export function getAllModels(): Map<string, ModelDefinition>;

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

export interface PaginatedResult {
  data: Record<string, unknown>[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface QueryBuilder {
  where(column: string, value: unknown): this;
  where(column: string, operator: string, value: unknown): this;
  where(conditions: Record<string, unknown>): this;
  orWhere(...args: unknown[]): this;
  whereIn(column: string, values: unknown[]): this;
  whereBetween(column: string, range: [unknown, unknown]): this;
  select(...columns: string[]): this;
  orderBy(column: string, direction?: 'asc' | 'desc'): this;
  limit(n: number): this;
  offset(n: number): this;
  with(...relations: string[]): this;
  withTrashed(): this;
  onlyTrashed(): this;
  first(): Promise<Record<string, unknown> | null>;
  list(): Promise<Record<string, unknown>[]>;
  get(): Promise<Record<string, unknown>[]>;
  count(): Promise<number>;
  paginate(page?: number, perPage?: number): Promise<PaginatedResult>;
  exists(): Promise<boolean>;
  clone(): QueryBuilder;
  getWiths(): string[];
  delete(): Promise<number>;
  update(data: Record<string, unknown>): Promise<number>;
  [key: string]: unknown;
}

export interface Repository {
  findById(id: string | number, options?: FindOptions): Promise<Record<string, unknown> | null>;
  findOne(conditions: Record<string, unknown>, options?: FindOptions): Promise<Record<string, unknown> | null>;
  findAll(options?: FindOptions): Promise<Record<string, unknown>[]>;
  create(data: Record<string, unknown>): Promise<Record<string, unknown>>;
  createMany(data: Record<string, unknown>[]): Promise<Record<string, unknown>[]>;
  update(id: string | number, data: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  updateWhere(conditions: Record<string, unknown>, data: Record<string, unknown>): Promise<number>;
  delete(id: string | number): Promise<boolean>;
  forceDelete(id: string | number): Promise<boolean>;
  restore(id: string | number): Promise<Record<string, unknown> | null>;
  query(): QueryBuilder;
  raw(sql: string, bindings?: unknown[]): Promise<unknown>;
  count(conditions?: Record<string, unknown>): Promise<number>;
  exists(conditions: Record<string, unknown>): Promise<boolean>;
  with(...relations: string[]): QueryBuilder;
  model: ModelDefinition;
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
  getRepository(modelName: string, scopeContext?: ScopeContext): Repository;
  createRepository(model: ModelDefinition, scopeContext?: ScopeContext): Repository;
}

export interface DatabaseInstance {
  knex: Knex;
  migrate: MigrationManager;
  getModel(name: string): ModelDefinition;
  hasModel(name: string): boolean;
  getAllModels(): ModelDefinition[];
  registerModel(model: ModelDefinition): void;
  getRepository(modelName: string, scopeContext?: ScopeContext): Repository;
  createRepository(model: ModelDefinition, scopeContext?: ScopeContext): Repository;
  query(modelName: string, scopeContext?: ScopeContext): QueryBuilder;
  transaction<T>(callback: (ctx: TransactionContext) => Promise<T>): Promise<T>;
  createSeeder(): unknown;
  cache: OrmCachePublicApi | null;
  destroy(): Promise<void>;
}

export function createDatabase(config: DatabaseConfig): DatabaseInstance;

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

// --- Built-in plugins (subset re-exported from main index.js) ---

export function schemaExplorerPlugin(options?: Record<string, unknown>): WebspressoPlugin;

export function adminPanelPlugin(options?: Record<string, unknown>): WebspressoPlugin;

export function siteAnalyticsPlugin(options?: Record<string, unknown>): WebspressoPlugin;

export function auditLogPlugin(options?: Record<string, unknown>): WebspressoPlugin;

export function recaptchaPlugin(options?: Record<string, unknown>): WebspressoPlugin;

export function swaggerPlugin(options?: Record<string, unknown>): WebspressoPlugin;

export function healthCheckPlugin(options?: Record<string, unknown>): WebspressoPlugin;

export interface RestResourcePluginOptions {
  path?: string;
  middleware?: RequestHandler[];
  models?: string[] | null;
  excludeModels?: string[];
  filter?: (model: ModelDefinition) => boolean;
}

export function restResourcePlugin(options?: RestResourcePluginOptions): WebspressoPlugin;

export function ormCacheAdminPlugin(options: { db: DatabaseInstance }): WebspressoPlugin;

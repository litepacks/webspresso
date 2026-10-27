/**
 * Typecheck smoke: ensures index.d.ts matches public exports and generic inference.
 */
import type { Application } from 'express';
import {
  createApp,
  createCoreApp,
  CoreApp,
  createDatabase,
  defineModel,
  defineService,
  defineApi,
  api,
  zdb,
  restResourcePlugin,
  corsPlugin,
  apiKeyPlugin,
  createApiKeyMiddleware,
  webhooksPlugin,
  getAllModels,
  type InferModel,
  type InferModelCreate,
  type InferModelUpdate,
  type InferServiceInput,
  type InferServiceOutput,
  type InferApiBody,
  type InferApiQuery,
  type InferApiParams,
  type InferApiHeaders,
  type InferApiInput,
  type InferApiOutput,
  type Repository,
  type PaginatedResult,
  type WebspressoApplication,
} from '../..';
import { z } from 'zod';

const { app }: { app: WebspressoApplication } = createApp({
  pagesDir: 'tests/fixtures/pages',
  viewsDir: 'tests/fixtures/views',
  pageAssets: { enabled: true, stylesheets: true, scripts: true },
  trustProxy: 1,
  plugins: [
    restResourcePlugin({ path: '/api/rest' }),
    corsPlugin({ origin: ['https://example.com'], credentials: true }),
    apiKeyPlugin({ prefix: 'wsp_live_', tableName: 'api_keys' }),
    webhooksPlugin({ endpointsTable: 'webhook_endpoints' }),
  ],
});

const _apiKeyMw = createApiKeyMiddleware({ scopes: ['users:read'] });
void _apiKeyMw;

void app;
void app.serviceRegistry;

const userSchema = zdb.schema({
  id: zdb.id(),
  email: zdb.string({ unique: true }),
  name: z.string().optional(),
  age: z.number().default(18),
});

const UserModel = defineModel({
  name: 'TsSmokeUser',
  table: 'ts_smoke_users',
  schema: userSchema,
  queryLimits: {
    maxLimit: 50,
    defaultLimit: 10,
    maxIncludes: 3,
  },
});

type User = InferModel<typeof UserModel>;
type CreateUser = InferModelCreate<typeof UserModel>;
type UpdateUser = InferModelUpdate<typeof UserModel>;

const db = createDatabase({
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true,
  models: './tests/fixtures/models-empty',
});

// Generic repository type checks
const userRepo: Repository<User> = db.getRepository<User>('TsSmokeUser');

async function testRepositoryInference(): Promise<void> {
  const user: User | null = await userRepo.findById(1);
  if (user) {
    const id: string | number = user.id;
    const email: string = user.email;
    const name: string | undefined = user.name;
    const age: number = user.age;
    void id;
    void email;
    void name;
    void age;
  }

  const newUserData: CreateUser = { email: 'test@example.com', name: 'John' };
  const created: User = await userRepo.create(newUserData);
  void created.email;

  const updateData: UpdateUser = { name: 'Updated John' };
  await userRepo.update(1, updateData);

  const queryResult: User | null = await userRepo.query().where('email', 'test@example.com').first();
  void queryResult;

  const paginated: PaginatedResult<User> = await userRepo.query().paginate(1, 10);
  const total: number = paginated.total;
  const firstItem: User | undefined = paginated.data[0];
  void total;
  void firstItem;
}

// Service inference type checks
const createUserDto = z.object({
  email: z.string().email(),
  name: z.string(),
});

const createUserService = defineService({
  schema: createUserDto,
  auth: (user, ctx) => Boolean(user || ctx.req),
  cache: { ttl: '5m', key: (input) => `user-${(input as { email: string }).email}` },
  timeout: '10s',
  transaction: true,
  handler: async (input: { email: string; name: string }) => {
    return { success: true, userId: 123, email: input.email };
  },
});

type CreateUserInput = InferServiceInput<typeof createUserService>;
type CreateUserOutput = InferServiceOutput<typeof createUserService>;

async function testServiceInference(): Promise<void> {
  const input: CreateUserInput = { email: 'service@example.com', name: 'Service User' };
  const output: CreateUserOutput = await createUserService.handler(input, {});
  const success: boolean = output.success;
  const userId: number = output.userId;
  void success;
  void userId;
}

void testRepositoryInference();
void testServiceInference();
void db.knex;
void getAllModels();

const core: CoreApp = createCoreApp();
void core.services;
void core.service('some.service', { foo: 'bar' });
void app.service('some.service', { foo: 'bar' });
void app.core;

import { createSecretManager, loadSecrets, resolveSecret, SecretManager, createMetricsRegistry, MetricsRegistry } from '../..';
const sm: SecretManager = createSecretManager({ provider: 'memory' });
void sm.get('KEY');
void loadSecrets({ provider: 'auto', secrets: { DB: 'db-key' } });
void resolveSecret('MY_SECRET');

const metricsReg: MetricsRegistry = createMetricsRegistry();
metricsReg.counter('requests_total', 'Requests').inc({ status: 200 }, 1);
metricsReg.gauge('active_conns', 'Connections').set(5);
metricsReg.histogram('req_latency', 'Latency').observe(0.045);
void metricsReg.formatPrometheus();
void metricsReg.formatJson();

const metricsApp = createApp({
  pagesDir: './pages',
  metrics: {
    enabled: true,
    path: '/custom-metrics',
    collectDefault: true,
    traceHeader: true,
  },
});
void metricsApp.app.metrics;

// ==========================================
// defineApi Type Inference Smoke Tests
// ==========================================

// 1. Direct object schema inference
const createNoteApi = defineApi({
  description: 'Create a note with validated body and query',
  schema: {
    body: z.object({
      title: z.string().min(1),
      content: z.string(),
      priority: z.number().default(1),
    }),
    query: z.object({
      notify: z.enum(['true', 'false']).optional(),
    }),
    params: z.object({
      folderId: z.string(),
    }),
  },
  handler: async (req, res, ctx) => {
    // Automatic inference on req.input
    const title: string = req.input.body.title;
    const content: string = req.input.body.content;
    const priority: number = req.input.body.priority;
    const notify: 'true' | 'false' | undefined = req.input.query.notify;
    const folderId: string = req.input.params.folderId;

    // Automatic inference on req.body and req.query
    const bodyTitle: string = req.body.title;
    const queryNotify: 'true' | 'false' | undefined = req.query.notify;

    // Automatic inference on ctx
    const ctxTitle: string = ctx.body.title;
    const ctxFolder: string = ctx.params.folderId;

    void title;
    void content;
    void priority;
    void notify;
    void folderId;
    void bodyTitle;
    void queryNotify;
    void ctxTitle;
    void ctxFolder;

    return {
      success: true,
      noteId: 42,
    };
  },
});

type NoteApiInput = InferApiInput<typeof createNoteApi>;
type NoteApiBody = InferApiBody<typeof createNoteApi>;
type NoteApiQuery = InferApiQuery<typeof createNoteApi>;
type NoteApiParams = InferApiParams<typeof createNoteApi>;
type NoteApiOutput = InferApiOutput<typeof createNoteApi>;

const testNoteInput: NoteApiInput = {
  body: { title: 'Hello', content: 'World', priority: 2 },
  query: { notify: 'true' },
  params: { folderId: 'folder_123' },
};
void testNoteInput;

const testNoteOutput: NoteApiOutput = { success: true, noteId: 101 };
void testNoteOutput;

// 2. Functional schema inference
const updateUserApi = api({
  schema: ({ z }) => ({
    body: z.object({
      email: z.string().email(),
      age: z.number().optional(),
    }),
    headers: z.object({
      'x-api-version': z.string().default('v1'),
    }),
  }),
  handler: async (req) => {
    const email: string = req.input.body.email;
    const age: number | undefined = req.input.body.age;
    const apiVer: string | undefined = req.input.headers?.['x-api-version'];
    void email;
    void age;
    void apiVer;
    return { updated: true };
  },
});

type UpdateUserBody = InferApiBody<typeof updateUserApi>;
type UpdateUserHeaders = InferApiHeaders<typeof updateUserApi>;
const sampleUserBody: UpdateUserBody = { email: 'user@example.com', age: 30 };
void sampleUserBody;

const sampleUserHeaders: UpdateUserHeaders = { 'x-api-version': 'v2' };
void sampleUserHeaders;

// 3. Schema-less API
const pingApi = defineApi({
  handler: async (req, res, ctx) => {
    return { pong: true, url: req.url, method: req.method, locale: ctx.locale };
  },
});
void pingApi;




/**
 * Typecheck smoke: ensures index.d.ts matches public exports and generic inference.
 */
import type { Application } from 'express';
import {
  createApp,
  createDatabase,
  defineModel,
  defineService,
  zdb,
  restResourcePlugin,
  corsPlugin,
  getAllModels,
  type InferModel,
  type InferModelCreate,
  type InferModelUpdate,
  type InferServiceInput,
  type InferServiceOutput,
  type Repository,
  type PaginatedResult,
} from '../..';
import { z } from 'zod';

const { app }: { app: Application } = createApp({
  pagesDir: 'tests/fixtures/pages',
  viewsDir: 'tests/fixtures/views',
  plugins: [
    restResourcePlugin({ path: '/api/rest' }),
    corsPlugin({ origin: ['https://example.com'], credentials: true }),
  ],
});

void app;

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
  auth: true,
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

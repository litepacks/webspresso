/**
 * Typecheck smoke: ensures index.d.ts matches public exports (not executed in Vitest).
 */
import type { WebspressoCompatApp } from '../..';
import {
  createApp,
  createDatabase,
  defineModel,
  zdb,
  restResourcePlugin,
  getAllModels,
} from '../..';

const { app }: { app: WebspressoCompatApp } = createApp({
  pagesDir: 'tests/fixtures/pages',
  viewsDir: 'tests/fixtures/views',
  plugins: [restResourcePlugin({ path: '/api/rest' })],
});

void app.listen;
void app.fetch;
void app._hono;

const schema = zdb.schema({
  id: zdb.id(),
  email: zdb.string({ unique: true }),
});

defineModel({
  name: 'TsSmokeUser',
  table: 'ts_smoke_users',
  schema,
});

const db = createDatabase({
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true,
  models: './tests/fixtures/models-empty',
});

void db.knex;
void getAllModels();

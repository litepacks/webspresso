/**
 * Typecheck smoke: ensures index.d.ts matches public exports (not executed in Vitest).
 */
import type { Application } from 'express';
import {
  createApp,
  createDatabase,
  defineModel,
  zdb,
  restResourcePlugin,
  getAllModels,
} from '../..';

const { app }: { app: Application } = createApp({
  pagesDir: 'tests/fixtures/pages',
  viewsDir: 'tests/fixtures/views',
  plugins: [restResourcePlugin({ path: '/api/rest' })],
});

void app;

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

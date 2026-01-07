
module.exports = {
  client: 'better-sqlite3',
  connection: {
    filename: '/Users/ahmet/projects/webspresso/tests/fixtures/cli-test-project/test.db',
  },
  useNullAsDefault: true,
  migrations: {
    directory: '/Users/ahmet/projects/webspresso/tests/fixtures/cli-test-project/migrations',
    tableName: 'knex_migrations',
  },
};

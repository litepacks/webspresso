module.exports = {
  client: 'better-sqlite3',
  connection: {
    filename: process.env.DATABASE_URL?.replace('sqlite:', '') || './database.sqlite',
  },
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations',
  },
  useNullAsDefault: true,
};

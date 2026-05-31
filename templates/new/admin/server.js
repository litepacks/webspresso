const { loadEnv } = require('./config/load-env');
loadEnv();

const { createApp } = require('webspresso');
const getCreateAppOptions = require('./config/app');
const { parseEnv } = require('./config/env.schema');

const env = parseEnv();
const { app } = createApp(getCreateAppOptions());

app.listen(env.PORT, () => {
  console.log(`Server running at http://localhost:${env.PORT}`);
});

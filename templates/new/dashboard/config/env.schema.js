const { z } = require('zod');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().optional(),
});

let _parsed = null;

function parseEnv() {
  if (_parsed) return _parsed;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.format());
    process.exit(1);
  }
  _parsed = result.data;
  return _parsed;
}

module.exports = { envSchema, parseEnv };

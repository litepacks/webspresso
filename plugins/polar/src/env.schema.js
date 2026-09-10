'use strict';

const { z } = require('zod');

const polarEnvSchema = z.object({
  POLAR_ACCESS_TOKEN: z.string().min(1).optional(),
  POLAR_WEBHOOK_SECRET: z.string().min(1).optional(),
  POLAR_PRO_PRODUCT_ID: z.string().optional(),
  POLAR_PRO_YEARLY_PRODUCT_ID: z.string().optional(),
  POLAR_PRO_PRICE_ID: z.string().optional(),
  POLAR_ORG_SLUG: z.string().optional(),
  POLAR_SANDBOX: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
  POLAR_CHECKOUT_URL: z.string().url().optional(),
  BASE_URL: z.string().url().optional(),
});

/**
 * Parse Polar-related env vars (process.env or overrides).
 * @param {Record<string, string|undefined>} [source=process.env]
 */
function parsePolarEnv(source = process.env) {
  const parsed = polarEnvSchema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid Polar env: ${msg}`);
  }
  return parsed.data;
}

module.exports = {
  polarEnvSchema,
  parsePolarEnv,
};

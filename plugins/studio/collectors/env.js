const fs = require('fs');
const path = require('path');
const { maskEnvObject, isSensitiveKey } = require('../../../core/studio/secret-mask');

const KNOWN_VARS = [
  'NODE_ENV',
  'PORT',
  'BASE_URL',
  'SESSION_SECRET',
  'AUTH_SESSION_SECRET',
  'DATABASE_URL',
  'DEFAULT_LOCALE',
  'SUPPORTED_LOCALES',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'MAIL_FROM',
];

const UNSAFE_PATTERNS = [
  { key: 'SESSION_SECRET', match: /webspresso-dev-secret|change-me/i },
];

/**
 * @param {object} ctx
 */
function collectEnv(ctx) {
  const exposeValues = ctx.studioConfig?.exposeEnv === true;
  const entries = maskEnvObject(process.env, { exposeValues });

  const knownSet = new Set(KNOWN_VARS);
  const required = [];
  const optional = [];
  const missing = [];
  const warnings = [];

  for (const key of KNOWN_VARS) {
    const present = process.env[key] !== undefined && String(process.env[key]).length > 0;
    const item = { key, present, sensitive: isSensitiveKey(key) };
    if (['SESSION_SECRET', 'DATABASE_URL'].includes(key) && !present) {
      missing.push(item);
    } else if (present) {
      optional.push(item);
    } else {
      optional.push(item);
    }
    if (key === 'SESSION_SECRET' || key === 'AUTH_SESSION_SECRET') {
      required.push(item);
    }
  }

  for (const { key, match } of UNSAFE_PATTERNS) {
    const val = process.env[key];
    if (val && match.test(val)) {
      warnings.push({ key, message: 'Unsafe default value detected' });
    }
  }

  const appConfig = path.join(process.cwd(), 'config', 'env.schema.js');
  let schemaNote = null;
  if (fs.existsSync(appConfig)) {
    schemaNote = 'config/env.schema.js present — validate with parseEnv()';
  }

  return {
    exposeValues,
    entries: entries.filter((e) => knownSet.has(e.key) || e.present),
    required,
    missing: missing.filter((m) => !m.present),
    warnings,
    schemaNote,
  };
}

module.exports = { collectEnv };

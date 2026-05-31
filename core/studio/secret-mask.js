/**
 * Mask sensitive environment variable keys and values for Studio.
 */

const SENSITIVE_KEY_RE =
  /SECRET|PASSWORD|PASS|TOKEN|CREDENTIAL|PRIVATE|DATABASE_URL|API_KEY|AUTH_KEY/i;

/**
 * @param {string} key
 * @returns {boolean}
 */
function isSensitiveKey(key) {
  return SENSITIVE_KEY_RE.test(String(key));
}

/**
 * @param {string} key
 * @param {string} [value]
 * @param {{ exposeValues?: boolean }} [opts]
 * @returns {{ key: string, present: boolean, value?: string, masked?: boolean, sensitive: boolean }}
 */
function maskEnvEntry(key, value, opts = {}) {
  const sensitive = isSensitiveKey(key);
  const present = value !== undefined && value !== null && String(value).length > 0;
  const entry = { key, present, sensitive };

  if (!present) {
    return entry;
  }

  if (sensitive || !opts.exposeValues) {
    entry.masked = true;
    entry.value = sensitive ? '••••••••' : undefined;
    return entry;
  }

  entry.value = String(value);
  return entry;
}

/**
 * @param {Record<string, string|undefined>} env
 * @param {{ exposeValues?: boolean }} [opts]
 * @returns {Array<{ key: string, present: boolean, value?: string, masked?: boolean, sensitive: boolean }>}
 */
function maskEnvObject(env, opts = {}) {
  return Object.keys(env)
    .sort()
    .map((key) => maskEnvEntry(key, env[key], opts));
}

module.exports = {
  isSensitiveKey,
  maskEnvEntry,
  maskEnvObject,
  SENSITIVE_KEY_RE,
};

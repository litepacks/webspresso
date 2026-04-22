/**
 * Resolve clientRuntime flags from createApp({ clientRuntime }) and optional env overrides.
 * Env: WEBSPRESSO_ALPINE=1|true, WEBSPRESSO_SWUP=1|true (override explicit false from options when set).
 */

function envTruthy(name) {
  const v = process.env[name];
  if (v == null || v === '') return undefined;
  return v === '1' || /^true$/i.test(String(v));
}

function optionEnabled(v) {
  if (v === true) return true;
  if (v && typeof v === 'object') return true;
  return false;
}

/**
 * @param {object} [options]
 * @param {object} [options.clientRuntime]
 * @param {boolean|object} [options.clientRuntime.alpine]
 * @param {boolean|object} [options.clientRuntime.swup]
 * @returns {{ alpine: boolean, swup: boolean }}
 */
function resolveClientRuntime(options = {}) {
  const cr = options.clientRuntime;
  let alpine = false;
  let swup = false;
  if (cr && typeof cr === 'object') {
    alpine = optionEnabled(cr.alpine);
    swup = optionEnabled(cr.swup);
  }
  const envA = envTruthy('WEBSPRESSO_ALPINE');
  const envS = envTruthy('WEBSPRESSO_SWUP');
  if (envA !== undefined) alpine = envA;
  if (envS !== undefined) swup = envS;
  return { alpine, swup };
}

module.exports = { resolveClientRuntime };

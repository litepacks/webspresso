/**
 * @module core/kernel/plugin
 */

/**
 * Plugin descriptor consumed by {@link createApp}.
 *
 * @param {{
 *   name: string,
 *   events?: (app: Record<string, unknown>) => void,
 *   views?: () => {
 *     namespace: string,
 *     layouts?: Record<string, string>,
 *     pages?: Record<string, string>,
 *     partials?: Record<string, string>,
 *   },
 * }} definition
 */
function definePlugin(definition) {
  return definition;
}

module.exports = { definePlugin };

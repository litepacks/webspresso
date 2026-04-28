/**
 * @module core/kernel/flow
 */

/**
 * @param {{
 *   id?: string,
 *   trigger: string,
 *   when?: (ctx: import('./events').KernelEventContext) => boolean,
 *   actions: Array<
 *     (
 *       ctx: import('./events').KernelEventContext,
 *       app: Record<string, unknown>,
 *     ) => Promise<void> | void
 *   >,
 * }} definition
 */
function defineFlow(definition) {
  return definition;
}

module.exports = { defineFlow };

/**
 * Adapter type helpers
 * @module adapters/types
 */

/**
 * @param {object} caps
 * @returns {string[]}
 */
function capabilityList(caps) {
  return Object.entries(caps)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
}

module.exports = { capabilityList };

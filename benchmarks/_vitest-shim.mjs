/**
 * Minimal `vitest` stand-in used by scripts/profile-bench.mjs to run bench files in plain Node.
 * Not a bench file (vitest only collects `*.bench.mjs`).
 */
const shim = globalThis.__webspressoBenchShim;

export const describe = (...args) => shim.describe(...args);
export const bench = (...args) => shim.bench(...args);
export const afterAll = (...args) => shim.afterAll(...args);


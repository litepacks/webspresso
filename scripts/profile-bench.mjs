#!/usr/bin/env node
/**
 * Plain-Node driver for the fullstack benchmark scenarios, for function-level profiling.
 *
 * Vitest executes bench files inside its own module runner/worker pool, which external
 * profilers (softscope's Node loader hooks) cannot instrument. This script loads the very same
 * `benchmarks/*.bench.mjs` files with a minimal `bench`/`describe` shim and runs every scenario
 * for a fixed number of iterations in the main process.
 *
 *   npm run bench:profile                       # softscope report (terminal)
 *   npm run bench:profile -- --ai               # AI-oriented diagnosis
 *   BENCH_PROFILE_ITERATIONS=500 npm run bench:profile
 *   BENCH_PROFILE_FILTER=http-ssr npm run bench:profile
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BENCH_DIR = path.join(ROOT, 'benchmarks');
const ITERATIONS = Number(process.env.BENCH_PROFILE_ITERATIONS || 200);
const WARMUP = Number(process.env.BENCH_PROFILE_WARMUP || 20);
const FILTER = process.env.BENCH_PROFILE_FILTER || '';

// Minimal vitest surface used by the bench files.
const registry = { tasks: [], afterAll: [], prefix: [] };
globalThis.__webspressoBenchShim = {
  describe(name, fn) {
    registry.prefix.push(name);
    try { fn(); } finally { registry.prefix.pop(); }
  },
  bench(name, fn) {
    registry.tasks.push({ name: [...registry.prefix, name].join(' > '), fn });
  },
  afterAll(fn) {
    registry.afterAll.push(fn);
  },
};

const files = fs
  .readdirSync(BENCH_DIR)
  .filter((f) => f.endsWith('.bench.mjs') && f.includes(FILTER))
  .sort();

const results = [];

for (const file of files) {
  registry.tasks = [];
  registry.afterAll = [];
  // Rewrite `from 'vitest'` to the shim so the bench file runs unmodified.
  const source = fs
    .readFileSync(path.join(BENCH_DIR, file), 'utf8')
    .replace(/from\s+['"]vitest['"]/, `from ${JSON.stringify(pathToFileURL(path.join(BENCH_DIR, '_vitest-shim.mjs')).href)}`);
  const tmpFile = path.join(BENCH_DIR, `.profile-${file}`);
  fs.writeFileSync(tmpFile, source);

  try {
    await import(pathToFileURL(tmpFile).href);
    for (const task of registry.tasks) {
      for (let i = 0; i < WARMUP; i++) await task.fn();
      const cpuStart = process.cpuUsage();
      const start = process.hrtime.bigint();
      for (let i = 0; i < ITERATIONS; i++) await task.fn();
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const cpu = process.cpuUsage(cpuStart);
      results.push({
        file,
        name: task.name,
        meanMs: ms / ITERATIONS,
        // Process CPU time (server + client in one process) — far less sensitive to machine load
        cpuMs: (cpu.user + cpu.system) / 1000 / ITERATIONS,
      });
    }
  } finally {
    for (const fn of registry.afterAll) await fn();
    fs.rmSync(tmpFile, { force: true });
  }
}

console.error(`\nScenario means (${ITERATIONS} iterations; wall | CPU per iteration):`);
for (const r of results.sort((a, b) => b.cpuMs - a.cpuMs)) {
  console.error(`  ${r.meanMs.toFixed(3).padStart(9)} ms | ${r.cpuMs.toFixed(3).padStart(8)} ms cpu  ${r.file} :: ${r.name}`);
}
if (process.env.BENCH_PROFILE_JSON) {
  fs.writeFileSync(process.env.BENCH_PROFILE_JSON, JSON.stringify({ iterations: ITERATIONS, results }, null, 2));
}
process.exit(0);


#!/usr/bin/env node
/**
 * Compare two Vitest --outputJson benchmark reports (hz).
 *
 * Env:
 *   BENCH_MIN_RATIO — flag regressions when current hz < baseline * ratio (default 0.70)
 *   BENCH_FAIL_ON_REGRESSION — if "1", exit non-zero on hz regressions (noisy on shared runners)
 *   BENCH_FAIL_ON_MISSING — if "0", do not exit when baseline keys disappear (default: fail in CI)
 */

import fs from 'node:fs';
import path from 'node:path';

const BASELINE = process.argv[2] || path.join('benchmarks', 'ci-baseline.json');
const CURRENT = process.argv[3] || path.join('benchmarks', 'current-benchmark.json');

const MIN_RATIO = Number(process.env.BENCH_MIN_RATIO || '0.7');
const FAIL_REGRESSION = process.env.BENCH_FAIL_ON_REGRESSION === '1';
const FAIL_MISSING =
  process.env.BENCH_FAIL_ON_MISSING !== '0' &&
  (process.env.CI === 'true' || process.env.BENCH_FAIL_ON_MISSING === '1');

function normalizeFilepath(fp) {
  const s = String(fp).replace(/\\/g, '/');
  const i = s.lastIndexOf('/benchmarks/');
  if (i >= 0) return s.slice(i + 1);
  return path.basename(s);
}

/** @param {string} jsonPath */
function loadMap(jsonPath) {
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  /** @type {Map<string, number|undefined>} */
  const map = new Map();
  for (const file of raw.files || []) {
    const fp = normalizeFilepath(file.filepath);
    for (const group of file.groups || []) {
      const fullName = group.fullName || '';
      for (const b of group.benchmarks || []) {
        const key = `${fp}::${fullName}::${b.name}`;
        map.set(key, typeof b.hz === 'number' && Number.isFinite(b.hz) ? b.hz : undefined);
      }
    }
  }
  return map;
}

function main() {
  if (!fs.existsSync(BASELINE)) {
    console.error(`Baseline missing: ${BASELINE}`);
    process.exit(1);
  }
  if (!fs.existsSync(CURRENT)) {
    console.error(`Current report missing: ${CURRENT} (run vitest bench --run --outputJson … first)`);
    process.exit(1);
  }

  const base = loadMap(BASELINE);
  const cur = loadMap(CURRENT);

  const regressions = [];
  const missingInCurrent = [];
  const newBenchmarks = [];
  const skippedNoHz = [];

  for (const [key, baseHz] of base) {
    if (!cur.has(key)) {
      missingInCurrent.push(key);
      continue;
    }
    const cHz = cur.get(key);
    if (baseHz === undefined || cHz === undefined) {
      skippedNoHz.push(key);
      continue;
    }
    const ratio = cHz / baseHz;
    if (ratio < MIN_RATIO) {
      regressions.push({ key, baseHz, cHz, ratio });
    }
  }

  for (const key of cur.keys()) {
    if (!base.has(key)) newBenchmarks.push(key);
  }

  const lines = [
    '## Benchmark comparison (baseline vs this run)',
    '',
    `| Threshold (info) | ${MIN_RATIO} — counts as regression if current hz < baseline × this ratio |`,
    `| Baseline | \`${BASELINE}\` |`,
    `| This run | \`${CURRENT}\` |`,
    '',
  ];

  if (skippedNoHz.length) {
    lines.push(
      `*No hz in Vitest output for ${skippedNoHz.length} row(s) (often too fast / not measured) — hz comparison skipped for those.*`,
      '',
    );
  }

  if (newBenchmarks.length) {
    lines.push(
      `**New benchmarks** (not in baseline; refresh baseline with \`npm run bench:baseline\`): **${newBenchmarks.length}**`,
    );
    for (const k of newBenchmarks.slice(0, 15)) lines.push(`- \`${k}\``);
    if (newBenchmarks.length > 15) lines.push(`- … +${newBenchmarks.length - 15} more`);
    lines.push('');
  }

  if (missingInCurrent.length) {
    lines.push(`**In baseline but missing in this run** (rename / file change?): **${missingInCurrent.length}**`);
    for (const k of missingInCurrent.slice(0, 20)) lines.push(`- \`${k}\``);
    if (missingInCurrent.length > 20) lines.push(`- … +${missingInCurrent.length - 20} more`);
    lines.push('');
  }

  if (regressions.length) {
    lines.push(`**Possible hz regressions** (current < ${MIN_RATIO}× baseline)`);
    lines.push('');
    lines.push('| Benchmark | baseline hz | this run hz | ratio |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const r of regressions.sort((a, b) => a.ratio - b.ratio)) {
      lines.push(`| \`${r.key}\` | ${r.baseHz.toFixed(0)} | ${r.cHz.toFixed(0)} | ${r.ratio.toFixed(2)} |`);
    }
    lines.push('');
    lines.push(
      '*hz varies on shared CI runners; set `BENCH_FAIL_ON_REGRESSION=1` in the workflow to fail the job on regressions.*',
    );
  } else {
    lines.push(`**No hz regressions** (per ${MIN_RATIO}× threshold, entries with hz only).`);
  }

  const summary = lines.join('\n');
  console.log(summary);

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }

  if (missingInCurrent.length && FAIL_MISSING) {
    console.error(
      '\ncheck-bench-regression: some baseline benchmarks are missing in this run; if benches were renamed, refresh the baseline (`npm run bench:baseline`).',
    );
    process.exit(1);
  }

  if (regressions.length && FAIL_REGRESSION) {
    console.error(
      `\ncheck-bench-regression: ${regressions.length} hz regression(s) below threshold ${MIN_RATIO}. Unset BENCH_FAIL_ON_REGRESSION in the workflow for report-only mode.`,
    );
    process.exit(1);
  }

  process.exit(0);
}

main();

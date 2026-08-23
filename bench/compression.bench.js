/**
 * Webspresso HTTP Response Compression Benchmark
 * Compares uncompressed, gzip, and Brotli compression across various payload sizes.
 * Run with: node bench/compression.bench.js
 */

const zlib = require('zlib');
const { supportsBrotli } = require('../core/compression/negotiate');

const payloadSizes = [
  { name: '1 KB', size: 1024 },
  { name: '10 KB', size: 10 * 1024 },
  { name: '100 KB', size: 100 * 1024 },
  { name: '1 MB', size: 1024 * 1024 },
];

function generatePayload(size) {
  const sample = JSON.stringify({
    title: 'Webspresso Performance Benchmark Sample Record',
    description: 'A lightweight Express SSR framework with zero-dependency dual auth and knex ORM.',
    timestamp: new Date().toISOString(),
    tags: ['express', 'framework', 'ssr', 'compression', 'orm'],
    metrics: { requestsPerSec: 15400, latencyMs: 0.42, p99: 1.2 },
  }) + '\n';

  let result = '';
  while (Buffer.byteLength(result, 'utf8') < size) {
    result += sample;
  }
  return Buffer.from(result.slice(0, size), 'utf8');
}

function benchmarkSync(name, fn, iterations = 100) {
  // Warmup
  for (let i = 0; i < 5; i++) fn();

  const memBefore = process.memoryUsage().heapUsed;
  const start = process.hrtime.bigint();

  for (let i = 0; i < iterations; i++) {
    fn();
  }

  const end = process.hrtime.bigint();
  const memAfter = process.memoryUsage().heapUsed;

  const totalMs = Number(end - start) / 1e6;
  const avgMs = totalMs / iterations;
  const opsPerSec = Math.round((iterations / totalMs) * 1000);
  const memDeltaKb = Math.max(0, Math.round((memAfter - memBefore) / 1024));

  return { avgMs: avgMs.toFixed(3), opsPerSec, memDeltaKb };
}

console.log('================================================================================');
console.log(' Webspresso HTTP Compression Benchmark');
console.log(` Node: ${process.version} | Brotli Supported: ${supportsBrotli() ? 'YES' : 'NO'}`);
console.log('================================================================================\n');

for (const { name, size } of payloadSizes) {
  const payload = generatePayload(size);
  const iterations = size > 100 * 1024 ? 30 : 100;

  console.log(`--- Payload Size: ${name} (${size} bytes) ---`);

  // 1. Uncompressed
  const uncompressedSize = payload.length;
  console.log(`  [Identity] Raw Size: ${uncompressedSize} bytes (100%)`);

  // 2. Gzip (Level 6)
  const gzipped = zlib.gzipSync(payload, { level: 6 });
  const gzipRatio = ((gzipped.length / uncompressedSize) * 100).toFixed(1);
  const gzipBench = benchmarkSync('gzip', () => zlib.gzipSync(payload, { level: 6 }), iterations);

  console.log(`  [Gzip L6]  Size: ${gzipped.length} bytes (${gzipRatio}%) | Avg: ${gzipBench.avgMs}ms | ${gzipBench.opsPerSec} ops/sec`);

  // 3. Brotli (Quality 4 - standard web dynamic)
  if (supportsBrotli()) {
    const brotliOpts = {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
    };
    const brotli = zlib.brotliCompressSync(payload, brotliOpts);
    const brotliRatio = ((brotli.length / uncompressedSize) * 100).toFixed(1);
    const brotliBench = benchmarkSync('brotli', () => zlib.brotliCompressSync(payload, brotliOpts), iterations);

    console.log(`  [Brotli Q4] Size: ${brotli.length} bytes (${brotliRatio}%) | Avg: ${brotliBench.avgMs}ms | ${brotliBench.opsPerSec} ops/sec`);
  }

  console.log('');
}

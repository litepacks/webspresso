import { describe, it, expect } from 'vitest';

const {
  parseByteSize,
  normalizeLimits,
  matchesPath,
  shouldSkipBodyParser,
  shouldCaptureRawBody,
} = require('../../../core/limits');

describe('Payload Limits Stress Lab', () => {
  it('1. parses and normalizes byte sizes across B/KB/MB/GB/TB and shorthand configs', () => {
    expect(parseByteSize('512b')).toBe(512);
    expect(parseByteSize('256kb')).toBe(256 * 1024);
    expect(parseByteSize('5mb')).toBe(5 * 1024 * 1024);
    expect(parseByteSize('2gb')).toBe(2 * 1024 * 1024 * 1024);
    expect(parseByteSize(4096)).toBe(4096);

    const shorthand = normalizeLimits('2mb');
    expect(shorthand.json.enabled).toBe(true);
    expect(shorthand.json.limit).toBe(2 * 1024 * 1024);
    expect(shorthand.urlencoded.limit).toBe(2 * 1024 * 1024);

    const fromApp = normalizeLimits({
      limits: {
        json: '10mb',
        urlencoded: '512kb',
        raw: '20mb',
        text: '1mb',
        parameterLimit: 2500,
        captureRawBody: ['/api/webhooks/*'],
        exclude: ['/api/upload/*'],
        routes: {
          '/api/import': { json: '50mb' },
        },
      },
    });

    expect(fromApp.json.limit).toBe(10 * 1024 * 1024);
    expect(fromApp.urlencoded.limit).toBe(512 * 1024);
    expect(fromApp.parameterLimit).toBe(2500);
    expect(fromApp.raw.enabled).toBe(true);
    expect(fromApp.text.enabled).toBe(true);
  });

  it('2. matches 500 route paths against wildcard exclusions and raw-body capture patterns', () => {
    const excludes = ['/api/upload/*', '/api/stream/**'];
    const rawTargets = ['/api/webhooks/stripe', '/api/webhooks/polar'];

    let skippedCount = 0;
    let rawCaptureCount = 0;

    for (let i = 0; i < 250; i++) {
      const uploadPath = `/api/upload/file-${i}`;
      const normalPath = `/api/users/${i}`;
      if (shouldSkipBodyParser({ path: uploadPath, url: uploadPath }, excludes)) skippedCount += 1;
      if (shouldSkipBodyParser({ path: normalPath, url: normalPath }, excludes)) skippedCount += 1;
    }

    for (let i = 0; i < 100; i++) {
      const target = i % 2 === 0 ? '/api/webhooks/stripe' : '/api/orders';
      if (shouldCaptureRawBody({ path: target, url: target }, rawTargets)) {
        rawCaptureCount += 1;
      }
    }

    expect(skippedCount).toBe(250);
    expect(rawCaptureCount).toBe(50);
    expect(matchesPath('/api/webhooks/*', '/api/webhooks/stripe')).toBe(true);
    expect(matchesPath('/api/webhooks/*', '/api/other')).toBe(false);
  });
});

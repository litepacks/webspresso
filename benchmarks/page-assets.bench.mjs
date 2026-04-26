/**
 * Microbenchmarks: resolvePageAssets, applyPageAssetsToTemplateData
 */

import { bench, describe } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolvePageAssets, applyPageAssetsToTemplateData } = require('../src/file-router.js');

const templateData = {
  title: 'Demo',
  stylesheets: ['/a.css', '/b.css'],
  scripts: [{ src: '/app.js' }],
};

describe('resolvePageAssets', () => {
  bench('true (all on)', () => {
    resolvePageAssets(true);
  });

  bench('object partial', () => {
    resolvePageAssets({ enabled: true, stylesheets: true, scripts: false });
  });

  bench('disabled', () => {
    resolvePageAssets(false);
  });
});

describe('applyPageAssetsToTemplateData', () => {
  const cfgOn = resolvePageAssets(true);

  bench('enabled with styles + scripts', () => {
    applyPageAssetsToTemplateData(cfgOn, { ...templateData });
  });

  bench('disabled (early return)', () => {
    applyPageAssetsToTemplateData(resolvePageAssets(false), { ...templateData });
  });
});

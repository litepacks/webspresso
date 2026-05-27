/**
 * Phase 6 — Compatibility validation
 * @module core/build/phases/06-validate
 */

const { BuildError } = require('../errors/build-error');

/**
 * @param {object} graphCtx
 * @param {object} manifest
 * @param {import('../../adapters/types').BuildAdapter} adapter
 * @param {object[]} edgeIssues
 */
function validateBuild(graphCtx, manifest, adapter, edgeIssues = []) {
  /** @type {object[]} */
  const errors = [...edgeIssues];
  /** @type {object[]} */
  const warnings = [];

  const adapterResult = adapter.validate(manifest);
  errors.push(...adapterResult.errors);
  warnings.push(...adapterResult.warnings);

  for (const route of manifest.routes) {
    if (route.type === 'ssr' && route.template) {
      const tpl = manifest.templates[route.template.id];
      if (!tpl) {
        errors.push({
          code: 'WS_BUILD_NJK_MISSING',
          message: `Template ${route.template.id} not found in manifest`,
          file: route.source?.page,
        });
      }
    }
  }

  if (graphCtx.unresolvedTemplates && graphCtx.unresolvedTemplates.length) {
    for (const u of graphCtx.unresolvedTemplates) {
      errors.push({
        code: 'WS_BUILD_NJK_UNRESOLVED_INCLUDE',
        message: `Unresolved template include: ${u}`,
        hint: 'Check views/ path or file name.',
      });
    }
  }

  const ok = errors.length === 0;
  return { ok, errors, warnings };
}

/**
 * @param {object} result
 * @param {{ failOnWarnings?: boolean }} opts
 */
function assertValid(result, opts = {}) {
  if (!result.ok) {
    const msg = result.errors.map((e) => `${e.code}: ${e.message}`).join('\n');
    throw new BuildError('WS_BUILD_VALIDATION_FAILED', msg, { errors: result.errors });
  }
  if (opts.failOnWarnings && result.warnings.length) {
    throw new BuildError('WS_BUILD_WARNINGS', 'Build completed with warnings treated as errors', {
      warnings: result.warnings,
    });
  }
}

module.exports = { validateBuild, assertValid };

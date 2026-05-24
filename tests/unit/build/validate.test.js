/**
 * Build validation phase tests
 */

const { validateBuild, assertValid } = require('../../../core/build/phases/06-validate');
const { BuildError } = require('../../../core/build/errors/build-error');
const { resolveAdapter } = require('../../../core/build');

describe('build validate phase', () => {
  const adapter = resolveAdapter('node');

  it('validateBuild passes for minimal valid manifest', () => {
    const manifest = {
      routes: [],
      templates: {},
    };
    const result = validateBuild({}, manifest, adapter, []);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validateBuild fails when SSR template id is missing', () => {
    const manifest = {
      routes: [
        {
          type: 'ssr',
          template: { id: 'missing-tpl' },
          source: { page: 'pages/x.njk' },
        },
      ],
      templates: {},
    };
    const result = validateBuild({}, manifest, adapter, []);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'WS_BUILD_NJK_MISSING')).toBe(true);
  });

  it('assertValid throws BuildError on validation failure', () => {
    expect(() =>
      assertValid({ ok: false, errors: [{ code: 'X', message: 'bad' }], warnings: [] })
    ).toThrow(BuildError);
  });

  it('assertValid throws when failOnWarnings and warnings present', () => {
    expect(() =>
      assertValid(
        { ok: true, errors: [], warnings: [{ code: 'W', message: 'warn' }] },
        { failOnWarnings: true }
      )
    ).toThrow(BuildError);
  });
});

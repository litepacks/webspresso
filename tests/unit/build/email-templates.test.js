/**
 * Email template build compile tests
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { BuildGraph } = require('../../../core/build/graph/build-graph');
const {
  compileEmailTemplates,
  buildEmailTemplatesMjs,
  emailPluginOptionsFromManifest,
} = require('../../../core/build/phases/03-compile/email-templates');
const { assembleManifest } = require('../../../core/build/phases/04-manifest');
const { resolveAdapter } = require('../../../core/build');
const { emailPluginOptionsFromManifest: pluginManifestHelper } = require('../../../plugins/email/manifest');

function mkProject(structure = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-email-tpl-'));
  for (const [rel, content] of Object.entries(structure)) {
    const fp = path.join(root, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  }
  return root;
}

describe('compileEmailTemplates', () => {
  it('includes bundled auth templates and project emails/*.mjml', () => {
    const root = mkProject({
      'emails/welcome.mjml': '<mjml><mj-body><mj-text>Welcome {{name}}</mj-text></mj-body></mjml>',
    });
    const graph = new BuildGraph();
    const { emailTemplates } = compileEmailTemplates({
      cwd: root,
      config: { emailDir: 'emails' },
      graph,
    });

    expect(emailTemplates['auth-password-reset']?.kind).toBe('bundled');
    expect(emailTemplates.welcome?.kind).toBe('project');
    expect(emailTemplates.welcome?.mjml).toContain('Welcome {{name}}');
    expect(emailTemplates.welcome?.source).toBe('emails/welcome.mjml');
  });

  it('project template overrides bundled id when same name', () => {
    const root = mkProject({
      'emails/auth-welcome.mjml': '<mjml><mj-body><mj-text>Custom welcome</mj-text></mj-body></mjml>',
    });
    const graph = new BuildGraph();
    const { emailTemplates } = compileEmailTemplates({
      cwd: root,
      config: { emailDir: 'emails' },
      graph,
    });

    expect(emailTemplates['auth-welcome'].mjml).toContain('Custom welcome');
    expect(emailTemplates['auth-welcome'].kind).toBe('project');
  });

  it('buildEmailTemplatesMjs emits importable ESM', () => {
    const mjs = buildEmailTemplatesMjs({
      welcome: { id: 'welcome', mjml: '<mjml></mjml>', kind: 'project', hash: 'abc' },
    });
    expect(mjs).toContain('export const emailTemplates');
    expect(mjs).toContain('"welcome"');
  });

  it('manifest helpers map chunks to emailPlugin options', () => {
    const manifest = {
      emailTemplates: {
        welcome: { mjml: '<mjml><mj-body><mj-text>Hi</mj-text></mj-body></mjml>' },
      },
    };

    const fromBuild = emailPluginOptionsFromManifest(manifest);
    const fromPlugin = pluginManifestHelper(manifest);

    expect(fromBuild.templates.welcome.mjml).toContain('<mjml>');
    expect(fromPlugin.templates.welcome.mjml).toContain('<mjml>');
  });

  it('assembleManifest includes emailTemplates field', () => {
    const root = mkProject({});
    const adapter = resolveAdapter('node');
    const graph = new BuildGraph();
    const { emailTemplates } = compileEmailTemplates({
      cwd: root,
      config: { emailDir: 'emails' },
      graph,
    });

    const manifest = assembleManifest(
      { cwd: root, config: {}, adapter, graph },
      {
        routeEntries: [],
        templates: {},
        emailTemplates,
        i18n: {},
        middleware: {},
        plugins: [],
        hooks: {},
      }
    );

    expect(manifest.emailTemplates['auth-password-reset']).toBeTruthy();
  });
});

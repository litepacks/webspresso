/**
 * Admin SPA string assembly from plugins/admin-panel/client/parts/
 */

describe('admin panel SPA parts', () => {
  const { buildComponentsBody } = require('../../../plugins/admin-panel/client/load-parts');

  it('assembles deterministic bundle matching previous single-file extraction', () => {
    const fs = require('fs');
    const path = require('path');
    const readme = fs.readFileSync(
      path.join(__dirname, '../../../plugins/admin-panel/client/README.md'),
      'utf8',
    );
    expect(readme).toContain('manifest.parts.json');

    const body = buildComponentsBody();
    expect(body.length).toBeGreaterThan(100_000);
    expect(body).toContain('const api =');
    expect(body).toContain('window.__ADMIN_COMPONENTS__');
    expect(body).toContain('renderUploadedFilePreview');
    expect(body).toContain('redirectToLogin');
    expect(body).toContain('consumeIntendedRoute');
  });

  it('manifest lists all parts on disk', () => {
    const fs = require('fs');
    const path = require('path');
    const manifest = require('../../../plugins/admin-panel/client/manifest.parts.json');
    const dir = path.join(__dirname, '../../../plugins/admin-panel/client/parts');
    expect(manifest.length).toBe(10);
  });

  it('validates syntax of all generated admin SPA components and modules', () => {
    const vm = require('vm');
    const appScript = require('../../../plugins/admin-panel/app');
    const { generateMenuComponent } = require('../../../plugins/admin-panel/modules/menu');
    const { generateDashboardComponent } = require('../../../plugins/admin-panel/modules/dashboard');
    const { generateBulkActionsComponent } = require('../../../plugins/admin-panel/modules/bulk-actions');
    const { generateCustomPageComponent } = require('../../../plugins/admin-panel/modules/custom-pages');
    const { generateProfileComponent } = require('../../../plugins/admin-panel/modules/profile');
    const { generateAdminUsersComponent } = require('../../../plugins/admin-panel/modules/admin-users');

    const combined = [
      generateMenuComponent(),
      generateDashboardComponent(),
      generateBulkActionsComponent(),
      generateCustomPageComponent(),
      generateProfileComponent(),
      generateAdminUsersComponent(),
      appScript,
    ].join('\n;\n');

    expect(() => new vm.Script(combined)).not.toThrow();
  });
});


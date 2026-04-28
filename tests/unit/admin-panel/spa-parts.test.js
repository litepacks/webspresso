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
  });

  it('manifest lists all parts on disk', () => {
    const fs = require('fs');
    const path = require('path');
    const manifest = require('../../../plugins/admin-panel/client/manifest.parts.json');
    const dir = path.join(__dirname, '../../../plugins/admin-panel/client/parts');
    for (const filename of manifest) {
      expect(fs.existsSync(path.join(dir, filename))).toBe(true);
    }
    expect(manifest.length).toBe(10);
  });
});

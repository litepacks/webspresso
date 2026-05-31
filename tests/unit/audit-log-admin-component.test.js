import { describe, it, expect } from 'vitest';
import { generateAuditLogComponent } from '../../plugins/audit-log/admin-component';

describe('audit-log admin component', () => {
  it('calls m.redraw after async load completes', () => {
    const src = generateAuditLogComponent({ apiPrefix: '/audit-logs' });
    expect(src).toContain('m.redraw()');
    expect(src).toMatch(/loading = false[\s\S]*m\.redraw\(\)/);
    expect(src).toContain('m(Layout');
  });
});

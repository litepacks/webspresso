/**
 * Audit log path parsing
 */
const { parseAdminModelAudit } = require('../../../plugins/audit-log/parse');

describe('parseAdminModelAudit', () => {
  const base = '/_admin';

  it('parses create', () => {
    expect(parseAdminModelAudit(base, 'POST', '/_admin/api/models/Post/records')).toEqual({
      action: 'create',
      resourceModel: 'Post',
      resourceId: null,
    });
  });

  it('parses update', () => {
    expect(parseAdminModelAudit(base, 'PUT', '/_admin/api/models/Product/records/12')).toEqual({
      action: 'update',
      resourceModel: 'Product',
      resourceId: '12',
    });
  });

  it('parses delete', () => {
    expect(parseAdminModelAudit(base, 'DELETE', '/_admin/api/models/Post/records/3')).toEqual({
      action: 'delete',
      resourceModel: 'Post',
      resourceId: '3',
    });
  });

  it('parses restore', () => {
    expect(parseAdminModelAudit(base, 'POST', '/_admin/api/models/Post/records/9/restore')).toEqual({
      action: 'restore',
      resourceModel: 'Post',
      resourceId: '9',
    });
  });

  it('returns null for GET list', () => {
    expect(parseAdminModelAudit(base, 'GET', '/_admin/api/models/Post/records')).toBeNull();
  });

  it('returns null outside admin', () => {
    expect(parseAdminModelAudit(base, 'POST', '/api/models/Post/records')).toBeNull();
  });

  it('supports custom admin base path', () => {
    expect(parseAdminModelAudit('/cms', 'DELETE', '/cms/api/models/X/records/1')).toEqual({
      action: 'delete',
      resourceModel: 'X',
      resourceId: '1',
    });
  });
});

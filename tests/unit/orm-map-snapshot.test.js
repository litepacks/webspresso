/**
 * ORM map snapshot + Mermaid (CLI introspect helpers)
 */

const { getAllModels } = require('../../core/orm');
const { initModels } = require('../fixtures/orm/models');
const { buildSnapshot, buildMermaidErDiagram } = require('../../bin/utils/orm-map-snapshot');

describe('orm-map snapshot', () => {
  beforeEach(() => {
    initModels(true);
  });

  it('builds JSON snapshot with columns and relations', () => {
    const snap = buildSnapshot(getAllModels());

    expect(snap.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snap.models.map((m) => m.name).sort()).toEqual(['Company', 'Post', 'User']);

    const user = snap.models.find((m) => m.name === 'User');
    expect(user.table).toBe('users');
    expect(user.hidden).toEqual(['metadata']);
    expect(user.scopes.softDelete).toBe(true);
    expect(user.scopes.timestamps).toBe(true);
    expect(user.rest.enabled).toBe(true);
    expect(user.rest.allowInclude).toEqual(['company']);

    const emailCol = user.columns.find((c) => c.name === 'email');
    expect(emailCol.type).toBe('string');
    expect(emailCol.unique).toBe(true);

    const companyRel = user.relations.find((r) => r.name === 'company');
    expect(companyRel.type).toBe('belongsTo');
    expect(companyRel.targetModel).toBe('Company');
    expect(companyRel.foreignKey).toBe('company_id');

    const postsRel = user.relations.find((r) => r.name === 'posts');
    expect(postsRel.type).toBe('hasMany');
    expect(postsRel.targetModel).toBe('Post');
  });

  it('builds Mermaid erDiagram with relationship lines', () => {
    const snap = buildSnapshot(getAllModels());
    const mer = buildMermaidErDiagram(snap);

    expect(mer).toContain('erDiagram');
    expect(mer).toContain('User {');
    expect(mer).toContain('Post {');
    expect(mer).toMatch(/User\s+\|\|--o\{\s+Post/);
    expect(mer).toMatch(/Post\s+\}o--\|\|\s+User/);
  });
});

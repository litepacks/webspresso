/**
 * Serialize ORM registry to JSON-safe snapshot + Mermaid erDiagram source.
 */

/**
 * @param {string} name
 * @returns {string}
 */
function mermaidEntityId(name) {
  return String(name).replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * @param {import('../../../core/orm/types').ColumnMeta} meta
 * @returns {Record<string, unknown>}
 */
function sanitizeColumnMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const out = {};
  const keys = [
    'type',
    'nullable',
    'primary',
    'autoIncrement',
    'unique',
    'index',
    'default',
    'maxLength',
    'precision',
    'scale',
    'enumValues',
    'references',
    'referenceColumn',
    'auto',
  ];
  for (const k of keys) {
    if (meta[k] !== undefined) out[k] = meta[k];
  }
  if (meta.validations && typeof meta.validations === 'object') {
    out.validations = { ...meta.validations };
  }
  if (meta.ui && typeof meta.ui === 'object') {
    out.ui = { ...meta.ui };
  }
  return out;
}

/**
 * @param {import('../../../core/orm/types').ModelDefinition} def
 * @returns {object}
 */
function serializeModel(def) {
  const columns = [];
  for (const [colName, meta] of def.columns) {
    columns.push({
      name: colName,
      ...sanitizeColumnMeta(meta),
    });
  }
  columns.sort((a, b) => a.name.localeCompare(b.name));

  const relations = [];
  for (const [relName, rel] of Object.entries(def.relations || {})) {
    let targetModel = null;
    try {
      if (typeof rel.model === 'function') {
        const tgt = rel.model();
        targetModel = tgt && tgt.name ? tgt.name : null;
      }
    } catch {
      targetModel = null;
    }
    relations.push({
      name: relName,
      type: rel.type,
      foreignKey: rel.foreignKey,
      localKey: rel.localKey || 'id',
      targetModel,
    });
  }
  relations.sort((a, b) => a.name.localeCompare(b.name));

  let cache = def.cache;
  if (cache !== undefined && typeof cache === 'object' && cache !== null) {
    try {
      JSON.stringify(cache);
    } catch {
      cache = '[object]';
    }
  }

  return {
    name: def.name,
    table: def.table,
    primaryKey: def.primaryKey,
    scopes: { ...def.scopes },
    hidden: [...def.hidden],
    admin: {
      enabled: def.admin.enabled,
      label: def.admin.label,
      icon: def.admin.icon,
    },
    rest: {
      enabled: def.rest.enabled,
      path: def.rest.path,
      allowInclude: def.rest.allowInclude,
    },
    columns,
    relations,
    cache,
  };
}

/**
 * @param {Map<string, import('../../../core/orm/types').ModelDefinition>} modelsMap
 * @param {{ generatedAt?: string }} [opts]
 * @returns {{ generatedAt: string, models: object[] }}
 */
function buildSnapshot(modelsMap, opts = {}) {
  const models = [];
  for (const [, def] of modelsMap) {
    models.push(serializeModel(def));
  }
  models.sort((a, b) => a.name.localeCompare(b.name));
  return {
    generatedAt: opts.generatedAt || new Date().toISOString(),
    models,
  };
}

/**
 * Mermaid erDiagram: entity blocks + relationship lines (deduped).
 * @param {{ models: object[] }} snapshot
 * @returns {string}
 */
function buildMermaidErDiagram(snapshot) {
  const lines = ['erDiagram'];

  for (const m of snapshot.models) {
    const id = mermaidEntityId(m.name);
    lines.push(`    ${id} {`);
    for (const col of m.columns) {
      const t = col.type != null ? String(col.type) : 'unknown';
      const nm = col.name.replace(/[^\w]/g, '_');
      lines.push(`        ${t} ${nm}`);
    }
    lines.push('    }');
  }

  const seen = new Set();
  for (const m of snapshot.models) {
    const srcId = mermaidEntityId(m.name);
    for (const r of m.relations) {
      if (!r.targetModel) continue;
      const tgtId = mermaidEntityId(r.targetModel);
      let mid;
      if (r.type === 'hasMany') mid = `${srcId} ||--o{ ${tgtId}`;
      else if (r.type === 'hasOne') mid = `${srcId} ||--|| ${tgtId}`;
      else if (r.type === 'belongsTo') mid = `${srcId} }o--|| ${tgtId}`;
      else continue;

      const label = String(r.name).replace(/"/g, "'");
      const full = `${mid} : "${label}"`;
      const key = `${srcId}|${tgtId}|${mid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`    ${full}`);
    }
  }

  return lines.join('\n');
}

module.exports = {
  mermaidEntityId,
  buildSnapshot,
  buildMermaidErDiagram,
  serializeModel,
};

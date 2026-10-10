/**
 * Relations Graph & ER Diagram Utilities for Schema Explorer
 * Analyzes ORM models, builds bidirectional relationship links, and generates Mermaid ER diagrams.
 */

'use strict';

/**
 * Extracts and unifies all relationships and foreign keys across all models
 * @param {Array<Object>} models - Serialized models list
 * @returns {Array<Object>} List of relationship edge descriptors
 */
function extractAllRelationships(models = []) {
  const modelByName = new Map();
  const modelByTable = new Map();

  for (const m of models) {
    if (m && m.name) {
      modelByName.set(m.name, m);
    }
    if (m && m.table) {
      modelByTable.set(m.table, m);
    }
  }

  const relationships = [];
  const seenKeys = new Set();

  for (const model of models) {
    if (!model) continue;

    // 1. Process explicit ORM relations
    const relations = model.relations || [];
    for (const rel of relations) {
      if (!rel || !rel.name) continue;

      let targetModelName = rel.relatedModel || null;
      let targetTableName = rel.relatedTable || null;

      if (targetModelName && modelByName.has(targetModelName)) {
        targetTableName = targetTableName || modelByName.get(targetModelName).table;
      } else if (targetTableName && modelByTable.has(targetTableName)) {
        targetModelName = targetModelName || modelByTable.get(targetTableName).name;
      }

      const key = `${model.name}:${rel.name}:${targetModelName || targetTableName}:${rel.foreignKey || ''}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      relationships.push({
        id: `rel-${model.name}-${rel.name}-${targetModelName || targetTableName || 'unknown'}`,
        sourceModel: model.name,
        sourceTable: model.table,
        name: rel.name,
        type: rel.type || 'belongsTo',
        targetModel: targetModelName,
        targetTable: targetTableName,
        foreignKey: rel.foreignKey || null,
        localKey: rel.localKey || 'id',
        pivotTable: rel.pivotTable || null,
        pivotForeignKey: rel.pivotForeignKey || null,
        pivotRelatedForeignKey: rel.pivotRelatedForeignKey || null,
        inferred: false,
      });
    }

    // 2. Process column references (foreign keys defined directly on columns)
    const columns = model.columns || [];
    for (const col of columns) {
      if (!col || !col.references) continue;

      const targetTableName = col.references;
      const targetModel = modelByTable.get(targetTableName);
      const targetModelName = targetModel ? targetModel.name : targetTableName;

      // Check if an explicit relation already covers this column
      const alreadyCovered = relationships.some(
        r => r.sourceModel === model.name && r.foreignKey === col.name
      );

      if (!alreadyCovered) {
        const key = `${model.name}:col_fk:${targetTableName}:${col.name}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          relationships.push({
            id: `col-fk-${model.name}-${col.name}-${targetTableName}`,
            sourceModel: model.name,
            sourceTable: model.table,
            name: col.name.replace(/_id$/i, ''),
            type: 'belongsTo',
            targetModel: targetModelName,
            targetTable: targetTableName,
            foreignKey: col.name,
            localKey: col.referenceColumn || 'id',
            inferred: true,
          });
        }
      }
    }
  }

  return relationships;
}

/**
 * Enriches model objects with incomingRelations, outgoingRelations, and connectedModels
 * @param {Array<Object>} models - Serialized models list
 * @param {Array<Object>} [relationships] - Precomputed relationships
 * @returns {Array<Object>} Enriched models list
 */
function enrichModelsWithGraph(models = [], relationships = null) {
  const rels = relationships || extractAllRelationships(models);

  return models.map(model => {
    const outgoing = rels.filter(r => r.sourceModel === model.name);
    const incoming = rels.filter(r => r.targetModel === model.name);

    const connectedSet = new Set();
    for (const r of outgoing) {
      if (r.targetModel && r.targetModel !== model.name) connectedSet.add(r.targetModel);
    }
    for (const r of incoming) {
      if (r.sourceModel && r.sourceModel !== model.name) connectedSet.add(r.sourceModel);
    }

    return {
      ...model,
      outgoingRelations: outgoing,
      incomingRelations: incoming,
      connectedModels: Array.from(connectedSet),
    };
  });
}

/**
 * Generates valid Mermaid ER diagram syntax from models and relationships
 * @param {Array<Object>} models - Serialized models
 * @param {Array<Object>} [relationships] - Precomputed relationships
 * @returns {string} Mermaid erDiagram code
 */
function generateMermaidErDiagram(models = [], relationships = null) {
  const rels = relationships || extractAllRelationships(models);
  const lines = ['erDiagram'];

  // 1. Entities & Attributes
  for (const m of models) {
    if (!m || !m.name) continue;
    const safeModelName = m.name.replace(/[^a-zA-Z0-9_]/g, '_');
    lines.push(`    ${safeModelName} {`);

    const cols = m.columns || [];
    for (const col of cols) {
      const colName = (col.name || 'unnamed').replace(/[^a-zA-Z0-9_]/g, '_');
      const colType = (col.type || 'string').replace(/[^a-zA-Z0-9_]/g, '_');

      let marker = '';
      if (col.primary) {
        marker = ' PK';
      } else if (col.references || rels.some(r => r.sourceModel === m.name && r.foreignKey === col.name)) {
        marker = ' FK';
      } else if (col.unique) {
        marker = ' UK';
      }

      lines.push(`        ${colType} ${colName}${marker}`);
    }

    lines.push('    }');
  }

  // 2. Relations
  const seenRelPairs = new Set();
  for (const rel of rels) {
    if (!rel.sourceModel || !rel.targetModel) continue;

    const source = rel.sourceModel.replace(/[^a-zA-Z0-9_]/g, '_');
    const target = rel.targetModel.replace(/[^a-zA-Z0-9_]/g, '_');
    const pairKey = `${source}:${rel.type}:${target}:${rel.foreignKey || ''}`;

    if (seenRelPairs.has(pairKey)) continue;
    seenRelPairs.add(pairKey);

    let symbol = '}o--||'; // default belongsTo
    if (rel.type === 'hasMany') {
      symbol = '||--o{';
    } else if (rel.type === 'hasOne') {
      symbol = '||--||';
    } else if (rel.type === 'manyToMany') {
      symbol = '}o--o{';
    } else if (rel.type === 'belongsTo') {
      symbol = '}o--||';
    }

    const label = (rel.name || rel.foreignKey || rel.type || 'relates').replace(/"/g, "'");
    lines.push(`    ${source} ${symbol} ${target} : "${label}"`);
  }

  return lines.join('\n');
}

module.exports = {
  extractAllRelationships,
  enrichModelsWithGraph,
  generateMermaidErDiagram,
};

/**
 * Webspresso ORM - Universal Full-Text Search (FTS)
 * Database-agnostic full-text search abstraction for SQLite, PostgreSQL, and MySQL
 * @module core/orm/search
 */

const { ensureArray } = require('./utils');

/**
 * Detect database dialect from Knex instance
 * @param {import('knex').Knex} knex
 * @returns {'sqlite'|'postgres'|'mysql'|'generic'}
 */
function detectDialect(knex) {
  const client = knex?.client?.config?.client || knex?.client?.dialect || '';
  const s = String(client).toLowerCase();
  if (s.includes('sqlite')) return 'sqlite';
  if (s.includes('pg') || s.includes('postgres')) return 'postgres';
  if (s.includes('mysql') || s.includes('maria')) return 'mysql';
  return 'generic';
}

/**
 * Tokenize search term into clean tokens, supporting quoted exact phrases
 * e.g. 'apple "macbook pro" laptop' -> ['apple', 'macbook pro', 'laptop']
 * @param {string} term
 * @returns {string[]}
 */
function tokenizeSearchTerm(term) {
  if (!term || typeof term !== 'string') return [];
  const matches = term.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return matches
    .map((t) => t.replace(/^"|"$/g, '').trim())
    .filter(Boolean);
}

/**
 * Normalize and validate search columns for a model
 * @param {Object} model
 * @param {string|string[]} [columns]
 * @returns {string[]}
 */
function normalizeSearchColumns(model, columns) {
  if (columns != null && (Array.isArray(columns) ? columns.length > 0 : Boolean(columns))) {
    return ensureArray(columns);
  }

  // Fallback to model searchable fields if configured
  if (Array.isArray(model?.searchable) && model.searchable.length > 0) {
    return model.searchable;
  }
  if (Array.isArray(model?.admin?.searchFields) && model.admin.searchFields.length > 0) {
    return model.admin.searchFields;
  }

  throw new Error(
    `No searchable columns specified for model "${model?.name || 'Unknown'}". Pass columns to .search(term, columns) or define searchable: [...] on the model.`
  );
}

/**
 * Build SQL search clause and parameter bindings
 * @param {Object} params
 * @param {import('knex').Knex} params.knex - Knex instance
 * @param {Object} params.model - Model definition
 * @param {string} params.term - Search query
 * @param {string|string[]} [params.columns] - Columns to search
 * @param {Object} [params.options] - Search options
 * @param {'auto'|'fts'|'like'} [params.options.mode='auto'] - Search mode
 * @param {string} [params.options.language='english'] - PostgreSQL text search configuration
 * @param {boolean} [params.options.matchAllWords=true] - Require all words to match (AND vs OR)
 * @param {boolean} [params.options.exact=false] - Treat entire term as exact substring
 * @param {boolean} [params.options.rank=false] - Order by search relevance rank (Postgres)
 * @param {string} [params.options.ftsTable] - Separate SQLite FTS virtual table name
 * @param {'and'|'or'} [params.options.boolean='and'] - Where condition boolean operator
 * @returns {{ raw: true, sql: string, bindings: any[], boolean: 'and'|'or', rankClause: Object|null }|null}
 */
function buildSearchClause({ knex, model, term, columns, options = {} }) {
  if (!term || typeof term !== 'string' || !term.trim()) {
    return null;
  }

  const cleanTerm = term.trim();
  const searchColumns = normalizeSearchColumns(model, columns);
  const dialect = detectDialect(knex);
  const mode = options.mode || 'auto';
  const language = options.language || 'english';
  const matchAllWords = options.matchAllWords !== false;
  const exact = options.exact === true;
  const boolean = options.boolean === 'or' ? 'or' : 'and';
  const rank = options.rank === true;

  // 1. PostgreSQL Full-Text Search (when mode is 'fts' or 'auto' on postgres)
  if (dialect === 'postgres' && (mode === 'fts' || mode === 'auto')) {
    const colsSql = searchColumns
      .map((c) => `COALESCE(${knex.ref(c)}::text, '')`)
      .join(" || ' ' || ");

    const queryFn = exact || cleanTerm.includes('"')
      ? 'websearch_to_tsquery'
      : 'plainto_tsquery';

    const sql = `to_tsvector(?, ${colsSql}) @@ ${queryFn}(?, ?)`;
    const bindings = [language, language, cleanTerm];

    let rankClause = null;
    if (rank) {
      rankClause = {
        sql: `ts_rank(to_tsvector(?, ${colsSql}), ${queryFn}(?, ?)) DESC`,
        bindings: [language, language, cleanTerm],
      };
    }

    return {
      raw: true,
      sql,
      bindings,
      boolean,
      rankClause,
    };
  }

  // 2. SQLite Native FTS5 (when mode is 'fts' on sqlite)
  if (dialect === 'sqlite' && mode === 'fts') {
    if (options.ftsTable) {
      const ftsRef = knex.ref(options.ftsTable).toString();
      const sql = `rowid IN (SELECT rowid FROM ${ftsRef} WHERE ${ftsRef} MATCH ?)`;
      return {
        raw: true,
        sql,
        bindings: [cleanTerm],
        boolean,
        rankClause: null,
      };
    }

    const tableRef = knex.ref(model.table).toString();
    const sql = `${tableRef} MATCH ?`;
    return {
      raw: true,
      sql,
      bindings: [cleanTerm],
      boolean,
      rankClause: null,
    };
  }

  // 3. MySQL FullText (when mode is 'fts' on mysql)
  if (dialect === 'mysql' && mode === 'fts') {
    const colsList = searchColumns.map((c) => knex.ref(c).toString()).join(', ');
    const sql = `MATCH(${colsList}) AGAINST(? IN BOOLEAN MODE)`;
    return {
      raw: true,
      sql,
      bindings: [cleanTerm],
      boolean,
      rankClause: null,
    };
  }

  // 4. Universal Tokenized LIKE Search (default for SQLite, MySQL, and mode: 'like')
  if (exact) {
    const pattern = `%${cleanTerm}%`;
    const bindings = [];
    const colClauses = searchColumns.map((c) => {
      bindings.push(pattern);
      return `LOWER(${knex.ref(c)}) LIKE LOWER(?)`;
    });

    return {
      raw: true,
      sql: `(${colClauses.join(' OR ')})`,
      bindings,
      boolean,
      rankClause: null,
    };
  }

  const tokens = tokenizeSearchTerm(cleanTerm);
  if (tokens.length === 0) {
    return null;
  }

  const wordClauses = [];
  const bindings = [];

  for (const token of tokens) {
    const pattern = `%${token}%`;
    const colClauses = searchColumns.map((c) => {
      bindings.push(pattern);
      return `LOWER(${knex.ref(c)}) LIKE LOWER(?)`;
    });
    wordClauses.push(`(${colClauses.join(' OR ')})`);
  }

  const joinOp = matchAllWords ? ' AND ' : ' OR ';
  const sql = `(${wordClauses.join(joinOp)})`;

  return {
    raw: true,
    sql,
    bindings,
    boolean,
    rankClause: null,
  };
}

module.exports = {
  detectDialect,
  tokenizeSearchTerm,
  normalizeSearchColumns,
  buildSearchClause,
};

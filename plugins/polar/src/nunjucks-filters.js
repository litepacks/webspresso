'use strict';

function dateLabel(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  }
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? str.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function createSafeTruncateFilter(originalTruncate) {
  return function safeTruncate(value, length, end) {
    if (value == null) return '';
    if (value instanceof Date) {
      return dateLabel(value);
    }
    if (typeof value === 'object') {
      try {
        return originalTruncate(JSON.stringify(value), length, end);
      } catch {
        return originalTruncate(String(value), length, end);
      }
    }
    return originalTruncate(String(value), length, end);
  };
}

function defaultTruncate(value, length = 20, end = '…') {
  const str = value instanceof Date ? dateLabel(value) : String(value ?? '');
  if (str.length <= length) return str;
  return `${str.slice(0, length)}${end}`;
}

function registerNunjucksFilters(nunjucksEnv) {
  nunjucksEnv.addFilter('dateLabel', dateLabel);

  let existing = null;
  if (typeof nunjucksEnv.getFilter === 'function') {
    existing = nunjucksEnv.getFilter('truncate');
  }

  const truncateFn = typeof existing === 'function'
    ? createSafeTruncateFilter(existing)
    : defaultTruncate;

  nunjucksEnv.addFilter('truncate', truncateFn, true);
}

module.exports = {
  dateLabel,
  createSafeTruncateFilter,
  registerNunjucksFilters,
};

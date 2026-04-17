/**
 * Append dark: Tailwind utilities (token-safe). Run: node tools/apply-admin-dark-tailwind.js
 */
const fs = require('fs');
const path = require('path');

const files = [
  'plugins/admin-panel/modules/menu.js',
  'plugins/admin-panel/components.js',
  'plugins/admin-panel/modules/dashboard.js',
  'plugins/admin-panel/modules/bulk-actions.js',
  'plugins/admin-panel/modules/custom-pages.js',
  'plugins/admin-panel/field-renderers/basic.js',
  'plugins/admin-panel/field-renderers/rich-text.js',
  'plugins/admin-panel/field-renderers/json.js',
  'plugins/admin-panel/field-renderers/array.js',
  'plugins/admin-panel/field-renderers/file-upload.js',
  'plugins/admin-panel/field-renderers/relations.js',
];

const rules = [
  ['hover:bg-gray-300', 'hover:bg-gray-300 dark:hover:bg-slate-600'],
  ['hover:bg-gray-200', 'hover:bg-gray-200 dark:hover:bg-slate-600'],
  ['hover:bg-gray-100', 'hover:bg-gray-100 dark:hover:bg-slate-700'],
  ['hover:bg-gray-50', 'hover:bg-gray-50 dark:hover:bg-slate-800/50'],
  ['hover:text-gray-900', 'hover:text-gray-900 dark:hover:text-slate-100'],
  ['hover:text-gray-700', 'hover:text-gray-700 dark:hover:text-slate-200'],
  ['hover:text-gray-600', 'hover:text-gray-600 dark:hover:text-slate-300'],
  ['hover:shadow-md', 'hover:shadow-md dark:hover:shadow-slate-900/40'],
  ['placeholder-gray-400', 'placeholder-gray-400 dark:placeholder-slate-500'],
  ['border-gray-200', 'border-gray-200 dark:border-slate-600'],
  ['border-gray-300', 'border-gray-300 dark:border-slate-600'],
  ['border-gray-100', 'border-gray-100 dark:border-slate-700'],
  ['text-gray-900', 'text-gray-900 dark:text-slate-100'],
  ['text-gray-800', 'text-gray-800 dark:text-slate-200'],
  ['text-gray-700', 'text-gray-700 dark:text-slate-300'],
  ['text-gray-600', 'text-gray-600 dark:text-slate-400'],
  ['text-gray-500', 'text-gray-500 dark:text-slate-400'],
  ['text-gray-400', 'text-gray-400 dark:text-slate-500'],
  ['text-gray-300', 'text-gray-300 dark:text-slate-600'],
  ['bg-gray-200', 'bg-gray-200 dark:bg-slate-700'],
  ['bg-gray-100', 'bg-gray-100 dark:bg-slate-800'],
  ['bg-gray-50', 'bg-gray-50 dark:bg-slate-900'],
  ['bg-white', 'bg-white dark:bg-slate-800'],
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceToken(s, from, to) {
  if (/^(hover:|dark:|focus:|active:|group-hover:|sm:|md:|lg:|xl:)/.test(from)) {
    return s.split(from).join(to);
  }
  const e = escapeRe(from);
  const re = new RegExp(`(^|[\\s.])(${e})(?=[\\s.'"]|$)`, 'g');
  return s.replace(re, (m, p1, p2) => p1 + to);
}

function dedupeAdjacentDark(s) {
  let prev;
  do {
    prev = s;
    s = s.replace(/(dark:[a-z0-9/.%-]+)( \1)+/g, '$1');
  } while (s !== prev);
  return s;
}

function apply(content) {
  let s = content;
  for (const [from, to] of rules) {
    s = replaceToken(s, from, to);
  }
  return dedupeAdjacentDark(s);
}

const root = path.join(__dirname, '..');
for (const rel of files) {
  const fp = path.join(root, rel);
  if (!fs.existsSync(fp)) {
    console.warn('skip', rel);
    continue;
  }
  const before = fs.readFileSync(fp, 'utf8');
  const after = apply(before);
  if (after !== before) {
    fs.writeFileSync(fp, after);
    console.log('patched', rel);
  }
}

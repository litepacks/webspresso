'use strict';

/**
 * Webspresso API Validation i18n & Error Translator
 * Automatically localizes Zod validation error messages and keys based on request locale
 * @module src/api/validation-i18n
 */

const path = require('path');

const EMPTY_OBJECT = Object.freeze({});

let _fileRouter = null;
function getFileRouter() {
  if (!_fileRouter) {
    _fileRouter = require('../file-router');
  }
  return _fileRouter;
}

/**
 * Resolves or creates a cached translator function for the given request and directory context
 * @param {import('express').Request} req - Express request
 * @param {Object} [options]
 * @param {string} [options.pagesDir] - Pages directory path
 * @param {string} [options.routeDir] - Route-specific directory
 * @param {boolean} [options.isDev] - Is development environment
 * @returns {{ t: Function, locale: string }}
 */
function getTranslatorForRequest(req, options = {}) {
  if (req && req.t && req.locale) {
    return { t: req.t, locale: req.locale };
  }

  const {
    loadI18n,
    createTranslator,
    detectLocale,
    translatorCache,
  } = getFileRouter();

  const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
  const locale = (req && req.locale) ? req.locale : (req ? detectLocale(req) : defaultLocale);

  const rawPagesDir = options.pagesDir || (req?.app?.get?.('pagesDir')) || 'pages';
  const pagesDir = path.resolve(rawPagesDir);
  const routeDir = options.routeDir ? path.resolve(options.routeDir) : '';
  const isDev = options.isDev !== undefined ? options.isDev : process.env.NODE_ENV !== 'production';

  let t;
  if (!isDev && translatorCache) {
    const transKey = `${pagesDir}::${routeDir}::${locale}::${defaultLocale}`;
    t = translatorCache.get(transKey);
    if (!t) {
      const translations = loadI18n(pagesDir, routeDir, locale, false);
      const fallbackTranslations = (locale !== defaultLocale)
        ? loadI18n(pagesDir, routeDir, defaultLocale, false)
        : EMPTY_OBJECT;
      t = createTranslator(translations, {
        locale,
        fallbackTranslations,
        fallbackLocale: defaultLocale,
      });
      translatorCache.set(transKey, t);
    }
  } else {
    const translations = loadI18n(pagesDir, routeDir, locale, true);
    const fallbackTranslations = (locale !== defaultLocale)
      ? loadI18n(pagesDir, routeDir, defaultLocale, true)
      : EMPTY_OBJECT;
    t = createTranslator(translations, {
      locale,
      fallbackTranslations,
      fallbackLocale: defaultLocale,
    });
  }

  if (req) {
    req.locale = locale;
    req.t = t;
  }

  return { t, locale };
}

/**
 * Translates a single Zod issue using candidate keys and parameter interpolation
 * @param {Object} issue - Zod issue
 * @param {Function} t - Translator function
 * @returns {Object} Translated issue clone
 */
function translateSingleIssue(issue, t) {
  if (!issue || typeof issue !== 'object') return issue;

  const pathKey = Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join('.') : '';
  const field = Array.isArray(issue.path) && issue.path.length > 0 ? issue.path[issue.path.length - 1] : '';
  const isRequired = (issue.code === 'invalid_type' && (issue.received === 'undefined' || issue.message === 'Required'))
    || issue.message === 'Required';

  const params = Object.assign(
    {
      path: pathKey,
      field,
      min: issue.minimum !== undefined ? issue.minimum : undefined,
      max: issue.maximum !== undefined ? issue.maximum : undefined,
      minimum: issue.minimum !== undefined ? issue.minimum : undefined,
      maximum: issue.maximum !== undefined ? issue.maximum : undefined,
      limit: issue.minimum !== undefined ? issue.minimum : (issue.maximum !== undefined ? issue.maximum : undefined),
      expected: issue.expected,
      received: issue.received,
      type: issue.type,
      validation: issue.validation,
    },
    issue
  );

  const candidates = [];

  // 1. Explicit key in custom message (e.g. z.string({ message: 'auth.email_required' }))
  if (typeof issue.message === 'string' && typeof t.has === 'function' && t.has(issue.message)) {
    candidates.push(issue.message);
  } else if (typeof issue.message === 'string' && issue.message.includes('{{')) {
    const interpolated = issue.message.replace(/{{\s*(\w+)\s*}}/g, (_, k) =>
      params[k] !== undefined ? String(params[k]) : ''
    );
    return Object.assign({}, issue, { message: interpolated });
  }

  // 2. Field-specific overrides (e.g. validation.fields.email.required or validation.email.required)
  if (pathKey) {
    if (isRequired) {
      candidates.push(`validation.fields.${pathKey}.required`);
      candidates.push(`validation.${pathKey}.required`);
      candidates.push(`validation.fields.${pathKey}`);
      candidates.push(`validation.${pathKey}`);
    } else {
      if (issue.validation) {
        candidates.push(`validation.fields.${pathKey}.${issue.validation}`);
        candidates.push(`validation.${pathKey}.${issue.validation}`);
      }
      candidates.push(`validation.fields.${pathKey}.${issue.code}`);
      candidates.push(`validation.${pathKey}.${issue.code}`);
      candidates.push(`validation.fields.${pathKey}`);
      candidates.push(`validation.${pathKey}`);
    }
  }

  // 3. General validation code translations
  if (isRequired) {
    candidates.push('validation.required');
    candidates.push('zod.required');
    candidates.push('validation.invalid_type');
    candidates.push('zod.invalid_type');
  } else if (issue.code === 'invalid_string' && issue.validation) {
    candidates.push(`validation.invalid_string.${issue.validation}`);
    candidates.push(`validation.${issue.validation}`);
    candidates.push(`zod.invalid_string.${issue.validation}`);
    candidates.push(`zod.${issue.validation}`);
    candidates.push('validation.invalid_string');
    candidates.push('zod.invalid_string');
  } else {
    candidates.push(`validation.${issue.code}`);
    candidates.push(`zod.${issue.code}`);
  }

  let matchedKey = null;
  if (typeof t.has === 'function') {
    for (const key of candidates) {
      if (t.has(key)) {
        matchedKey = key;
        break;
      }
    }
  }

  if (matchedKey) {
    return Object.assign({}, issue, {
      message: t(matchedKey, params),
      key: matchedKey,
    });
  }

  // If no translation found, interpolate params in custom message if it contains placeholders
  if (typeof issue.message === 'string' && issue.message.includes('{{')) {
    const interpolated = issue.message.replace(/{{\s*(\w+)\s*}}/g, (_, k) =>
      params[k] !== undefined ? String(params[k]) : ''
    );
    return Object.assign({}, issue, { message: interpolated });
  }

  return Object.assign({}, issue);
}

/**
 * Translates an array of Zod validation issues using the active request locale
 * @param {Array<Object>} issues - Zod error issues array
 * @param {Object} [options]
 * @param {import('express').Request} [options.req] - Express request
 * @param {Function} [options.t] - Optional direct translator
 * @param {string} [options.locale] - Optional direct locale
 * @param {string} [options.pagesDir] - Pages directory path
 * @param {string} [options.routeDir] - Route directory path
 * @param {boolean} [options.isDev] - Is development environment
 * @returns {Array<Object>} Translated issues
 */
function translateValidationIssues(issues, options = {}) {
  if (!Array.isArray(issues) || issues.length === 0) {
    return issues;
  }

  let t = options.t || options.req?.t;
  let locale = options.locale || options.req?.locale;

  if (!t && options.req) {
    const tr = getTranslatorForRequest(options.req, options);
    t = tr.t;
    locale = tr.locale;
  }

  if (!t) {
    return issues;
  }

  return issues.map((issue) => translateSingleIssue(issue, t));
}

module.exports = {
  getTranslatorForRequest,
  translateSingleIssue,
  translateValidationIssues,
};

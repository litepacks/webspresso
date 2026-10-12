/**
 * Webspresso Native Cron Expression Parser & Matcher
 * Pure Node.js standard 5-part cron implementation (zero external dependencies)
 * @module core/queue/cron
 */

'use strict';

const MONTH_NAMES = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

const DAY_NAMES = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6
};

const CRON_ALIASES = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
  '@every_minute': '* * * * *',
  '@minutely': '* * * * *',
};

/**
 * Resolves alias string (e.g. '@daily', '@every 5m') into a 5-part cron expression.
 * @param {string} str
 * @returns {string}
 */
function resolveCronAlias(str) {
  const trimmed = str.trim();
  const lower = trimmed.toLowerCase();

  if (CRON_ALIASES[lower]) {
    return CRON_ALIASES[lower];
  }

  // Support '@every 5m', '@every 15m', '@every 2h'
  const everyMatch = lower.match(/^@every\s+(\d+)\s*([mh])$/);
  if (everyMatch) {
    const amount = parseInt(everyMatch[1], 10);
    const unit = everyMatch[2];
    if (unit === 'm' && amount >= 1 && amount <= 59) {
      return `*/${amount} * * * *`;
    }
    if (unit === 'h' && amount >= 1 && amount <= 23) {
      return `0 */${amount} * * *`;
    }
  }

  return trimmed;
}

/**
 * Parse a single cron field with ranges, steps, and lists.
 * @param {string} field
 * @param {number} min
 * @param {number} max
 * @param {Record<string, number>} [nameMap]
 * @returns {Set<number>}
 */
function parseField(field, min, max, nameMap = null) {
  let str = field.trim().toLowerCase();

  if (nameMap) {
    for (const [name, val] of Object.entries(nameMap)) {
      str = str.replace(new RegExp(`\\b${name}\\b`, 'g'), String(val));
    }
  }

  const values = new Set();
  const parts = str.split(',');

  for (const part of parts) {
    if (!part) {
      throw new Error(`Invalid empty cron segment in '${field}'`);
    }

    let step = 1;
    let rangeStr = part;

    if (part.includes('/')) {
      const sub = part.split('/');
      if (sub.length !== 2) {
        throw new Error(`Invalid step syntax in '${part}'`);
      }
      rangeStr = sub[0];
      step = parseInt(sub[1], 10);
      if (isNaN(step) || step <= 0) {
        throw new Error(`Invalid step value '${sub[1]}' in '${part}'`);
      }
    }

    let start;
    let end;

    if (rangeStr === '*' || rangeStr === '') {
      start = min;
      end = max;
    } else if (rangeStr.includes('-')) {
      const sub = rangeStr.split('-');
      if (sub.length !== 2) {
        throw new Error(`Invalid range syntax in '${rangeStr}'`);
      }
      start = parseInt(sub[0], 10);
      end = parseInt(sub[1], 10);
      if (isNaN(start) || isNaN(end) || start > end) {
        throw new Error(`Invalid range boundary '${rangeStr}' in '${part}'`);
      }
    } else {
      start = parseInt(rangeStr, 10);
      end = start;
      if (isNaN(start)) {
        throw new Error(`Invalid numeric value '${rangeStr}' in '${part}'`);
      }
    }

    // Day of week special case: 7 is Sunday (same as 0)
    if (max === 6 && (start === 7 || end === 7)) {
      if (start === 7) start = 0;
      if (end === 7) end = 0;
    }

    if (start < min || end > max) {
      throw new Error(`Cron value out of range [${min}-${max}]: '${part}'`);
    }

    for (let i = start; i <= end; i += step) {
      values.add(i === 7 && max === 6 ? 0 : i);
    }
  }

  return values;
}

class CronExpression {
  /**
   * @param {string} expression - Standard 5-field cron or alias
   * @param {Object} [options]
   * @param {boolean} [options.utc=false] - Evaluate dates in UTC instead of local time
   */
  constructor(expression, options = {}) {
    if (typeof expression !== 'string' || !expression.trim()) {
      throw new Error('Cron expression must be a non-empty string');
    }

    this.rawExpression = expression;
    this.resolvedExpression = resolveCronAlias(expression);
    this.utc = !!options.utc;

    const parts = this.resolvedExpression.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(
        `Invalid cron expression '${expression}': expected 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}`
      );
    }

    this.domAny = parts[2] === '*';
    this.dowAny = parts[4] === '*';

    this.minutes = parseField(parts[0], 0, 59);
    this.hours = parseField(parts[1], 0, 23);
    this.doms = parseField(parts[2], 1, 31);
    this.months = parseField(parts[3], 1, 12, MONTH_NAMES);
    this.dows = parseField(parts[4], 0, 6, DAY_NAMES);
  }

  /**
   * Check if a given Date matches the cron expression
   * @param {Date} [date=new Date()]
   * @returns {boolean}
   */
  match(date = new Date()) {
    const minute = this.utc ? date.getUTCMinutes() : date.getMinutes();
    const hour = this.utc ? date.getUTCHours() : date.getHours();
    const month = (this.utc ? date.getUTCMonth() : date.getMonth()) + 1;
    const dom = this.utc ? date.getUTCDate() : date.getDate();
    const dow = this.utc ? date.getUTCDay() : date.getDay();

    if (!this.minutes.has(minute)) return false;
    if (!this.hours.has(hour)) return false;
    if (!this.months.has(month)) return false;

    // Standard POSIX / crontab union behavior:
    // If either dom or dow is '*', the other specifies matching day.
    // If both are specified (neither is '*'), either match satisfies.
    if (this.domAny && this.dowAny) return true;
    if (!this.domAny && this.dowAny) return this.doms.has(dom);
    if (this.domAny && !this.dowAny) return this.dows.has(dow);
    return this.doms.has(dom) || this.dows.has(dow);
  }

  /**
   * Calculate next matching Date after fromDate (default: now)
   * Uses jumping skips to avoid long iteration loops.
   *
   * @param {Date} [fromDate=new Date()]
   * @returns {Date|null}
   */
  getNextDate(fromDate = new Date()) {
    const d = new Date(fromDate.getTime());

    if (this.utc) {
      d.setUTCSeconds(0, 0);
      d.setUTCMinutes(d.getUTCMinutes() + 1);
    } else {
      d.setSeconds(0, 0);
      d.setMinutes(d.getMinutes() + 1);
    }

    const startYear = this.utc ? d.getUTCFullYear() : d.getFullYear();
    const maxYear = startYear + 5;

    while ((this.utc ? d.getUTCFullYear() : d.getFullYear()) <= maxYear) {
      const month = (this.utc ? d.getUTCMonth() : d.getMonth()) + 1;
      if (!this.months.has(month)) {
        if (this.utc) {
          d.setUTCMonth(d.getUTCMonth() + 1, 1);
          d.setUTCHours(0, 0, 0, 0);
        } else {
          d.setMonth(d.getMonth() + 1, 1);
          d.setHours(0, 0, 0, 0);
        }
        continue;
      }

      const dom = this.utc ? d.getUTCDate() : d.getDate();
      const dow = this.utc ? d.getUTCDay() : d.getDay();

      const dayMatch = (this.domAny && this.dowAny)
        ? true
        : (!this.domAny && this.dowAny)
        ? this.doms.has(dom)
        : (this.domAny && !this.dowAny)
        ? this.dows.has(dow)
        : (this.doms.has(dom) || this.dows.has(dow));

      if (!dayMatch) {
        if (this.utc) {
          d.setUTCDate(d.getUTCDate() + 1);
          d.setUTCHours(0, 0, 0, 0);
        } else {
          d.setDate(d.getDate() + 1);
          d.setHours(0, 0, 0, 0);
        }
        continue;
      }

      const hour = this.utc ? d.getUTCHours() : d.getHours();
      if (!this.hours.has(hour)) {
        if (this.utc) {
          d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0);
        } else {
          d.setHours(d.getHours() + 1, 0, 0, 0);
        }
        continue;
      }

      const minute = this.utc ? d.getUTCMinutes() : d.getMinutes();
      if (!this.minutes.has(minute)) {
        if (this.utc) {
          d.setUTCMinutes(d.getUTCMinutes() + 1);
        } else {
          d.setMinutes(d.getMinutes() + 1);
        }
        continue;
      }

      return d;
    }

    return null;
  }

  /**
   * Return the next N matching Dates
   * @param {number} count
   * @param {Date} [fromDate=new Date()]
   * @returns {Date[]}
   */
  getNextDates(count = 5, fromDate = new Date()) {
    const dates = [];
    let current = fromDate;

    for (let i = 0; i < count; i++) {
      const next = this.getNextDate(current);
      if (!next) break;
      dates.push(next);
      current = next;
    }

    return dates;
  }

  /**
   * Static helper to validate a cron expression string
   * @param {string} expression
   * @returns {boolean}
   */
  static isValid(expression) {
    try {
      new CronExpression(expression);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Parse expression into a CronExpression instance
   * @param {string} expression
   * @param {Object} [options]
   * @returns {CronExpression}
   */
  static parse(expression, options) {
    return new CronExpression(expression, options);
  }
}

module.exports = {
  CronExpression,
  resolveCronAlias,
  isValidCron: CronExpression.isValid,
  parseCron: CronExpression.parse,
  CRON_ALIASES,
};

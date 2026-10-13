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
  '@weekdays': '0 0 * * 1-5',
  '@workdays': '0 0 * * 1-5',
  '@weekends': '0 0 * * 6,0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
  '@every_hour': '0 * * * *',
  '@every_minute': '* * * * *',
  '@minutely': '* * * * *',
};

/**
 * Resolves alias string (e.g. '@daily', '@every 5m', '@every 2h', '@every 1d') into a 5-part cron expression.
 * @param {string} str
 * @returns {string}
 */
function resolveCronAlias(str) {
  if (typeof str !== 'string') return str;
  const trimmed = str.trim();
  const lower = trimmed.toLowerCase();

  if (CRON_ALIASES[lower]) {
    return CRON_ALIASES[lower];
  }

  // Support '@every 5m', '@every 15m', '@every 2h', '@every 1d'
  const everyMatch = lower.match(/^@every\s+(\d+)\s*([mhd])$/);
  if (everyMatch) {
    const amount = parseInt(everyMatch[1], 10);
    const unit = everyMatch[2];
    if (unit === 'm' && amount >= 1 && amount <= 59) {
      return `*/${amount} * * * *`;
    }
    if (unit === 'h' && amount >= 1 && amount <= 23) {
      return `0 */${amount} * * *`;
    }
    if (unit === 'd' && amount >= 1 && amount <= 30) {
      return `0 0 */${amount} * *`;
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
 * @param {boolean} [isDow=false]
 * @returns {Set<number>}
 */
function parseField(field, min, max, nameMap = null, isDow = false) {
  if (typeof field !== 'string' || !field.trim()) {
    throw new Error(`Invalid empty cron segment in '${field}'`);
  }

  let str = field.trim().toLowerCase();

  if (isDow) {
    // When Sunday is at the end of a range (e.g. MON-SUN, FRI-SUN, 1-SUN), map SUN to 7
    str = str.replace(/-\s*sun\b/g, '-7');
    // When Sunday is at the start of a range (e.g. SUN-WED), map SUN to 0
    str = str.replace(/\bsun\s*-/g, '0-');
  }

  if (nameMap) {
    for (const [name, val] of Object.entries(nameMap)) {
      str = str.replace(new RegExp(`\\b${name}\\b`, 'g'), String(val));
    }
  }

  const values = new Set();
  const parts = str.split(',');

  for (let rawPart of parts) {
    const part = rawPart.trim();
    if (!part) {
      throw new Error(`Invalid empty cron segment in '${field}'`);
    }

    let step = 1;
    let rangeStr = part;
    let hasStep = false;

    if (part.includes('/')) {
      const sub = part.split('/');
      if (sub.length !== 2) {
        throw new Error(`Invalid step syntax in '${part}'`);
      }
      rangeStr = sub[0].trim();
      const stepStr = sub[1].trim();
      if (!/^\d+$/.test(stepStr)) {
        throw new Error(`Invalid step value '${sub[1]}' in '${part}'`);
      }
      step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) {
        throw new Error(`Invalid step value '${sub[1]}' in '${part}'`);
      }
      hasStep = true;
    }

    let start;
    let end;

    if (rangeStr === '*' || rangeStr === '?' || rangeStr === '') {
      start = min;
      end = max;
    } else if (rangeStr.includes('-')) {
      const sub = rangeStr.split('-');
      if (sub.length !== 2) {
        throw new Error(`Invalid range syntax in '${rangeStr}'`);
      }
      const startStr = sub[0].trim();
      const endStr = sub[1].trim();
      if (!/^\d+$/.test(startStr) || !/^\d+$/.test(endStr)) {
        throw new Error(`Invalid range boundary '${rangeStr}' in '${part}'`);
      }
      start = parseInt(startStr, 10);
      end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end) || start > end) {
        throw new Error(`Invalid range boundary '${rangeStr}' in '${part}'`);
      }
    } else {
      if (!/^\d+$/.test(rangeStr)) {
        throw new Error(`Invalid numeric value '${rangeStr}' in '${part}'`);
      }
      start = parseInt(rangeStr, 10);
      // In standard crontab, N/step means start at N through max (e.g. 10/15 -> 10,25,40,55)
      end = hasStep ? max : start;
      if (isNaN(start)) {
        throw new Error(`Invalid numeric value '${rangeStr}' in '${part}'`);
      }
    }

    if (start < min || end > max) {
      throw new Error(`Cron value out of range [${min}-${max}]: '${part}'`);
    }

    for (let i = start; i <= end; i += step) {
      // In standard cron, day of week 7 is Sunday, same as 0
      values.add(isDow && i === 7 ? 0 : i);
    }
  }

  return values;
}

/**
 * Helper to extract date components according to UTC, Timezone, or Local time
 * @param {Date} date
 * @param {boolean} utc
 * @param {string|null} timezone
 * @returns {{ year: number, month: number, dom: number, hour: number, minute: number, second: number, dow: number }}
 */
function getDateParts(date, utc, timezone) {
  if (timezone && timezone.toUpperCase() !== 'UTC') {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
      hourCycle: 'h23',
    });
    const parts = dtf.formatToParts(date);
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    return {
      year: parseInt(map.year, 10),
      month: parseInt(map.month, 10),
      dom: parseInt(map.day, 10),
      hour: parseInt(map.hour, 10),
      minute: parseInt(map.minute, 10),
      second: parseInt(map.second, 10),
      dow: DAY_NAMES[map.weekday.toLowerCase()] ?? 0,
    };
  }

  if (utc) {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      dom: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
      dow: date.getUTCDay(),
    };
  }

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    dom: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
    dow: date.getDay(),
  };
}

/**
 * Finds the smallest element in set strictly greater than current
 * @param {Set<number>} set
 * @param {number} current
 * @returns {number|null}
 */
function findNextInSet(set, current) {
  let best = Infinity;
  for (const v of set) {
    if (v > current && v < best) {
      best = v;
    }
  }
  return best === Infinity ? null : best;
}

class CronExpression {
  /**
   * @param {string} expression - Standard 5-field cron or alias
   * @param {Object} [options]
   * @param {boolean} [options.utc=false] - Evaluate dates in UTC instead of local time
   * @param {string} [options.timezone] - IANA Timezone (e.g. 'America/New_York', 'Europe/Istanbul')
   * @param {string} [options.tz] - Alias for timezone
   */
  constructor(expression, options = {}) {
    if (typeof expression !== 'string' || !expression.trim()) {
      throw new Error('Cron expression must be a non-empty string');
    }

    this.rawExpression = expression;
    this.resolvedExpression = resolveCronAlias(expression);
    this.utc = !!options.utc;
    this.timezone = options.timezone || options.tz || (this.utc ? 'UTC' : null);

    if (this.timezone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: this.timezone });
      } catch (_) {
        throw new Error(`Invalid timeZone specified: '${this.timezone}'`);
      }
    }

    const parts = this.resolvedExpression.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(
        `Invalid cron expression '${expression}': expected 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}`
      );
    }

    this.domAny = parts[2] === '*' || parts[2] === '?';
    this.dowAny = parts[4] === '*' || parts[4] === '?';

    this.minutes = parseField(parts[0], 0, 59);
    this.hours = parseField(parts[1], 0, 23);
    this.doms = parseField(parts[2], 1, 31);
    this.months = parseField(parts[3], 1, 12, MONTH_NAMES);
    this.dows = parseField(parts[4], 0, 7, DAY_NAMES, true);
  }

  /**
   * Check if a given Date matches the cron expression
   * @param {Date|string|number} [date=new Date()]
   * @returns {boolean}
   */
  match(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return false;

    const parts = getDateParts(d, this.utc, this.timezone);
    const { minute, hour, month, dom, dow } = parts;

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
   * @param {Date|string|number} [fromDate=new Date()]
   * @returns {Date|null}
   */
  getNextDate(fromDate = new Date()) {
    const baseDate = fromDate instanceof Date ? fromDate : (fromDate ? new Date(fromDate) : new Date());
    if (isNaN(baseDate.getTime())) {
      throw new Error(`Invalid fromDate passed to getNextDate: '${fromDate}'`);
    }

    const d = new Date(baseDate.getTime());

    // Timezone-aware calculation path
    if (this.timezone && this.timezone.toUpperCase() !== 'UTC') {
      return this._getNextDateTimezone(d);
    }

    // Fast native path for UTC or Local time
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
        const nextHour = findNextInSet(this.hours, hour);
        if (nextHour !== null) {
          if (this.utc) {
            d.setUTCHours(nextHour, 0, 0, 0);
          } else {
            d.setHours(nextHour, 0, 0, 0);
          }
        } else {
          if (this.utc) {
            d.setUTCDate(d.getUTCDate() + 1);
            d.setUTCHours(0, 0, 0, 0);
          } else {
            d.setDate(d.getDate() + 1);
            d.setHours(0, 0, 0, 0);
          }
        }
        continue;
      }

      const minute = this.utc ? d.getUTCMinutes() : d.getMinutes();
      if (!this.minutes.has(minute)) {
        const nextMinute = findNextInSet(this.minutes, minute);
        if (nextMinute !== null) {
          if (this.utc) {
            d.setUTCMinutes(nextMinute, 0, 0);
          } else {
            d.setMinutes(nextMinute, 0, 0);
          }
        } else {
          if (this.utc) {
            d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0);
          } else {
            d.setHours(d.getHours() + 1, 0, 0, 0);
          }
        }
        continue;
      }

      return d;
    }

    return null;
  }

  /**
   * Timezone-aware next date solver
   * @private
   */
  _getNextDateTimezone(fromDate) {
    // Advance 1 minute from fromDate in UTC
    const d = new Date(fromDate.getTime());
    d.setUTCSeconds(0, 0);
    d.setUTCMinutes(d.getUTCMinutes() + 1);

    const initialParts = getDateParts(d, false, this.timezone);
    const startYear = initialParts.year;
    const maxYear = startYear + 5;

    // Fast scan jumping through timezone parts
    while (true) {
      const parts = getDateParts(d, false, this.timezone);
      if (parts.year > maxYear) return null;

      if (!this.months.has(parts.month)) {
        d.setUTCDate(d.getUTCDate() + 1);
        d.setUTCHours(0, 0, 0, 0);
        continue;
      }

      const dayMatch = (this.domAny && this.dowAny)
        ? true
        : (!this.domAny && this.dowAny)
        ? this.doms.has(parts.dom)
        : (this.domAny && !this.dowAny)
        ? this.dows.has(parts.dow)
        : (this.doms.has(parts.dom) || this.dows.has(parts.dow));

      if (!dayMatch) {
        d.setUTCDate(d.getUTCDate() + 1);
        d.setUTCHours(0, 0, 0, 0);
        continue;
      }

      if (!this.hours.has(parts.hour)) {
        const nextH = findNextInSet(this.hours, parts.hour);
        if (nextH !== null) {
          d.setUTCHours(d.getUTCHours() + (nextH - parts.hour), 0, 0, 0);
        } else {
          d.setUTCDate(d.getUTCDate() + 1);
          d.setUTCHours(0, 0, 0, 0);
        }
        continue;
      }

      if (!this.minutes.has(parts.minute)) {
        const nextM = findNextInSet(this.minutes, parts.minute);
        if (nextM !== null) {
          d.setUTCMinutes(d.getUTCMinutes() + (nextM - parts.minute), 0, 0);
        } else {
          d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0);
        }
        continue;
      }

      return d;
    }
  }

  /**
   * Return the next N matching Dates
   * @param {number} count
   * @param {Date|string|number} [fromDate=new Date()]
   * @returns {Date[]}
   */
  getNextDates(count = 5, fromDate = new Date()) {
    const dates = [];
    let current = fromDate;
    const limit = Math.max(1, parseInt(count, 10) || 5);

    for (let i = 0; i < limit; i++) {
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
   * @param {Object} [options]
   * @returns {boolean}
   */
  static isValid(expression, options) {
    try {
      new CronExpression(expression, options);
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


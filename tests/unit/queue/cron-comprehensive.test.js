/**
 * Comprehensive Unit Tests for core/queue/cron.js
 * Exercises all branches: aliases, error conditions, boundary checks, step/range parsing,
 * timezones, UTC/local date calculations, and multi-date generations.
 */

const {
  CronExpression,
  resolveCronAlias,
  isValidCron,
  parseCron,
  CRON_ALIASES,
} = require('../../../core/queue/cron');

describe('CronExpression Comprehensive Branch Coverage', () => {
  describe('resolveCronAlias and aliases', () => {
    it('returns non-string or unknown strings as-is', () => {
      expect(resolveCronAlias(123)).toBe(123);
      expect(resolveCronAlias(null)).toBe(null);
      expect(resolveCronAlias('unknown_alias')).toBe('unknown_alias');
    });

    it('resolves all standard predefined aliases', () => {
      for (const [alias, expr] of Object.entries(CRON_ALIASES)) {
        expect(resolveCronAlias(alias)).toBe(expr);
        expect(resolveCronAlias(`  ${alias.toUpperCase()}  `)).toBe(expr);
      }
    });

    it('resolves @every aliases for m, h, d', () => {
      expect(resolveCronAlias('@every 5m')).toBe('*/5 * * * *');
      expect(resolveCronAlias('@every 2h')).toBe('0 */2 * * *');
      expect(resolveCronAlias('@every 10d')).toBe('0 0 */10 * *');
      // out of range / invalid units fall through
      expect(resolveCronAlias('@every 60m')).toBe('@every 60m');
      expect(resolveCronAlias('@every 24h')).toBe('@every 24h');
      expect(resolveCronAlias('@every 31d')).toBe('@every 31d');
      expect(resolveCronAlias('@every 5s')).toBe('@every 5s');
    });
  });

  describe('Validation & Constructor Error Branches', () => {
    it('throws on non-string or empty expression', () => {
      expect(() => new CronExpression('')).toThrow(/non-empty string/);
      expect(() => new CronExpression('   ')).toThrow(/non-empty string/);
      expect(() => new CronExpression(null)).toThrow(/non-empty string/);
    });

    it('throws on invalid timezone', () => {
      expect(() => new CronExpression('* * * * *', { timezone: 'Fake/Timezone_Not_Real' })).toThrow(/Invalid timeZone/);
      expect(() => new CronExpression('* * * * *', { tz: 'Invalid/Zone' })).toThrow(/Invalid timeZone/);
    });

    it('throws on wrong number of cron fields', () => {
      expect(() => new CronExpression('* * * *')).toThrow(/expected 5 fields/);
      expect(() => new CronExpression('* * * * * *')).toThrow(/expected 5 fields/);
    });

    it('throws on invalid field syntax or empty segments', () => {
      expect(() => new CronExpression(' , * * * *')).toThrow(/Invalid empty cron segment/);
      expect(() => new CronExpression('1//2 * * * *')).toThrow(/Invalid step syntax/);
      expect(() => new CronExpression('1/abc * * * *')).toThrow(/Invalid step value/);
      expect(() => new CronExpression('1/0 * * * *')).toThrow(/Invalid step value/);
      expect(() => new CronExpression('1-2-3 * * * *')).toThrow(/Invalid range syntax/);
      expect(() => new CronExpression('10-5 * * * *')).toThrow(/Invalid range boundary/);
      expect(() => new CronExpression('abc-10 * * * *')).toThrow(/Invalid range boundary/);
      expect(() => new CronExpression('5-abc * * * *')).toThrow(/Invalid range boundary/);
      expect(() => new CronExpression('abc * * * *')).toThrow(/Invalid numeric value/);
      expect(() => new CronExpression('65 * * * *')).toThrow(/out of range/);
      expect(() => new CronExpression('* 25 * * *')).toThrow(/out of range/);
      expect(() => new CronExpression('* * 32 * *')).toThrow(/out of range/);
      expect(() => new CronExpression('* * * 13 *')).toThrow(/out of range/);
      expect(() => new CronExpression('* * * * 8')).toThrow(/out of range/);
    });
  });

  describe('Field parsing with month/day names and Sunday variations', () => {
    it('parses named months and day names with Sunday boundaries', () => {
      const expr = new CronExpression('0 0 1-5 JAN,FEB,DEC MON-WED,FRI-SUN');
      expect(expr.months.has(1)).toBe(true);
      expect(expr.months.has(2)).toBe(true);
      expect(expr.months.has(12)).toBe(true);
      expect(expr.dows.has(1)).toBe(true); // Mon
      expect(expr.dows.has(0)).toBe(true); // Sun mapped
    });

    it('parses SUN at the beginning and end of ranges and 7 as Sunday', () => {
      const e1 = new CronExpression('0 0 * * SUN-TUE');
      expect(e1.dows.has(0)).toBe(true);
      expect(e1.dows.has(1)).toBe(true);
      expect(e1.dows.has(2)).toBe(true);

      const e2 = new CronExpression('0 0 * * 7');
      expect(e2.dows.has(0)).toBe(true);

      const e3 = new CronExpression('10/15 * * * *');
      expect(e3.minutes.has(10)).toBe(true);
      expect(e3.minutes.has(25)).toBe(true);
      expect(e3.minutes.has(40)).toBe(true);
      expect(e3.minutes.has(55)).toBe(true);
      expect(e3.minutes.has(5)).toBe(false);
    });
  });

  describe('Static isValid and parse helpers', () => {
    it('validates expressions correctly', () => {
      expect(isValidCron('* * * * *')).toBe(true);
      expect(isValidCron('@daily')).toBe(true);
      expect(isValidCron('invalid-cron')).toBe(false);
      expect(isValidCron('* * * * *', { timezone: 'Invalid/Zone' })).toBe(false);

      const parsed = parseCron('0 0 * * *');
      expect(parsed).toBeInstanceOf(CronExpression);
    });
  });

  describe('match() branches', () => {
    it('returns false for invalid date input', () => {
      const expr = new CronExpression('* * * * *');
      expect(expr.match('invalid-date-string')).toBe(false);
      expect(expr.match(new Date(NaN))).toBe(false);
    });

    it('matches UTC dates properly', () => {
      const expr = new CronExpression('15 10 5 6 *', { utc: true });
      const matching = new Date(Date.UTC(2025, 5, 5, 10, 15, 0));
      const nonMatchingMinute = new Date(Date.UTC(2025, 5, 5, 10, 16, 0));
      const nonMatchingHour = new Date(Date.UTC(2025, 5, 5, 11, 15, 0));
      const nonMatchingMonth = new Date(Date.UTC(2025, 6, 5, 10, 15, 0));

      expect(expr.match(matching)).toBe(true);
      expect(expr.match(nonMatchingMinute)).toBe(false);
      expect(expr.match(nonMatchingHour)).toBe(false);
      expect(expr.match(nonMatchingMonth)).toBe(false);
    });

    it('matches local dates properly', () => {
      const now = new Date();
      const m = now.getMinutes();
      const h = now.getHours();
      const expr = new CronExpression(`${m} ${h} * * *`);
      expect(expr.match(now)).toBe(true);
    });

    it('tests standard POSIX day-of-month and day-of-week combinations', () => {
      // 1. domAny && dowAny (* * * * *)
      const eBothAny = new CronExpression('0 0 * * *', { utc: true });
      expect(eBothAny.match(new Date(Date.UTC(2025, 0, 15, 0, 0, 0)))).toBe(true);

      // 2. !domAny && dowAny (15 * * * *)
      const eDomOnly = new CronExpression('0 0 15 * *', { utc: true });
      expect(eDomOnly.match(new Date(Date.UTC(2025, 0, 15, 0, 0, 0)))).toBe(true);
      expect(eDomOnly.match(new Date(Date.UTC(2025, 0, 16, 0, 0, 0)))).toBe(false);

      // 3. domAny && !dowAny (* * * * 1) -> Monday only
      const eDowOnly = new CronExpression('0 0 * * 1', { utc: true });
      // 2025-01-06 is Monday
      expect(eDowOnly.match(new Date(Date.UTC(2025, 0, 6, 0, 0, 0)))).toBe(true);
      // 2025-01-07 is Tuesday
      expect(eDowOnly.match(new Date(Date.UTC(2025, 0, 7, 0, 0, 0)))).toBe(false);

      // 4. !domAny && !dowAny (either satisfies: dom 15 OR Monday)
      const eBothSpecific = new CronExpression('0 0 15 * 1', { utc: true });
      // 15th (Wednesday) -> matches dom
      expect(eBothSpecific.match(new Date(Date.UTC(2025, 0, 15, 0, 0, 0)))).toBe(true);
      // 6th (Monday) -> matches dow
      expect(eBothSpecific.match(new Date(Date.UTC(2025, 0, 6, 0, 0, 0)))).toBe(true);
      // 7th (Tuesday) -> neither matches
      expect(eBothSpecific.match(new Date(Date.UTC(2025, 0, 7, 0, 0, 0)))).toBe(false);
    });

    it('matches with IANA timezone option', () => {
      const expr = new CronExpression('30 18 * * *', { timezone: 'Europe/Istanbul' });
      // 18:30 in Istanbul is 15:30 UTC (UTC+3)
      const dateUtc = new Date(Date.UTC(2025, 5, 10, 15, 30, 0));
      expect(expr.match(dateUtc)).toBe(true);

      const nonMatch = new Date(Date.UTC(2025, 5, 10, 18, 30, 0));
      expect(expr.match(nonMatch)).toBe(false);
    });
  });

  describe('getNextDate() and getNextDates() branches', () => {
    it('throws on invalid fromDate', () => {
      const expr = new CronExpression('* * * * *');
      expect(() => expr.getNextDate('not-a-valid-date')).toThrow(/Invalid fromDate/);
    });

    it('calculates next UTC date correctly with skips', () => {
      const expr = new CronExpression('30 14 15 5 *', { utc: true });
      const from = new Date(Date.UTC(2025, 0, 1, 0, 0, 0));
      const next = expr.getNextDate(from);
      expect(next.getUTCFullYear()).toBe(2025);
      expect(next.getUTCMonth()).toBe(4); // May (0-indexed 4)
      expect(next.getUTCDate()).toBe(15);
      expect(next.getUTCHours()).toBe(14);
      expect(next.getUTCMinutes()).toBe(30);
    });

    it('skips months, days, hours, and minutes cleanly in UTC and local', () => {
      // Test month skipping
      const eMonth = new CronExpression('0 0 1 12 *', { utc: true });
      const fMonth = new Date(Date.UTC(2025, 0, 1, 0, 0, 0));
      const nextMonth = eMonth.getNextDate(fMonth);
      expect(nextMonth.getUTCMonth()).toBe(11);

      // Test day skipping
      const eDay = new CronExpression('0 0 20 * *', { utc: true });
      const fDay = new Date(Date.UTC(2025, 0, 5, 0, 0, 0));
      const nextDay = eDay.getNextDate(fDay);
      expect(nextDay.getUTCDate()).toBe(20);

      // Test hour skipping
      const eHour = new CronExpression('0 18 * * *', { utc: true });
      const fHour = new Date(Date.UTC(2025, 0, 5, 10, 0, 0));
      const nextHour = eHour.getNextDate(fHour);
      expect(nextHour.getUTCHours()).toBe(18);

      // Test minute skipping
      const eMin = new CronExpression('45 * * * *', { utc: true });
      const fMin = new Date(Date.UTC(2025, 0, 5, 10, 10, 0));
      const nextMin = eMin.getNextDate(fMin);
      expect(nextMin.getUTCMinutes()).toBe(45);
      expect(nextMin.getUTCHours()).toBe(10);
    });

    it('handles local time next date calculation', () => {
      const expr = new CronExpression('0 12 1 * *'); // local
      const from = new Date(2025, 0, 1, 0, 0, 0);
      const next = expr.getNextDate(from);
      expect(next.getDate()).toBe(1);
      expect(next.getHours()).toBe(12);
    });

    it('handles timezone-aware calculation (_getNextDateTimezone)', () => {
      const exprIstanbul = new CronExpression('0 12 * * *', { timezone: 'Europe/Istanbul' });
      const from = new Date('2026-10-13T08:00:00.000Z');
      const next = exprIstanbul.getNextDate(from);
      expect(next).toBeInstanceOf(Date);
      expect(exprIstanbul.match(next)).toBe(true);

      const exprMin = new CronExpression('30 * * * *', { timezone: 'Europe/Istanbul' });
      const nextMin = exprMin.getNextDate(from);
      expect(nextMin).toBeInstanceOf(Date);
      expect(exprMin.match(nextMin)).toBe(true);
    });

    it('generates multiple dates with getNextDates', () => {
      const expr = new CronExpression('0 0 * * *', { utc: true });
      const from = new Date(Date.UTC(2025, 0, 1, 0, 0, 0));
      const dates = expr.getNextDates(3, from);
      expect(dates).toHaveLength(3);
      expect(dates[0].getUTCDate()).toBe(2);
      expect(dates[1].getUTCDate()).toBe(3);
      expect(dates[2].getUTCDate()).toBe(4);

      // Test default count
      const defaults = expr.getNextDates();
      expect(defaults).toHaveLength(5);
    });
  });
});

'use strict';

import { describe, it, expect } from 'vitest';
import nunjucks from 'nunjucks';

const { dateLabel, registerNunjucksFilters } = require('../../../plugins/polar/src/nunjucks-filters');

describe('Polar Nunjucks filters', () => {
  it('dateLabel formats ISO dates', () => {
    expect(dateLabel('2026-09-04T12:00:00.000Z')).toBe('2026-09-04');
    expect(dateLabel(new Date('2026-09-04T12:00:00.000Z'))).toBe('2026-09-04');
    expect(dateLabel(null)).toBe('');
  });

  it('safe truncate handles Date objects without throwing', () => {
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader('/'));
    registerNunjucksFilters(env);

    const truncate = env.getFilter('truncate');
    expect(truncate(new Date('2026-09-04T12:00:00.000Z'), 10)).toBe('2026-09-04');
    expect(() => truncate(new Date('2026-09-04T12:00:00.000Z'), 10)).not.toThrow();
  });
});

/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  buildHeaderMapping,
  dataRowsToObjects,
  normalizeHeaderCell,
} from '../../../plugins/data-exchange/parse-table.js';

describe('data-exchange parse-table', () => {
  it('normalizes BOM and whitespace on headers', () => {
    expect(normalizeHeaderCell('\uFEFF Name ')).toBe('Name');
  });

  it('maps headers case-insensitively with space/underscore equivalence', () => {
    const allowed = ['email', 'full_name'];
    const map = buildHeaderMapping(['Email', 'Full Name', 'Unknown'], allowed);
    expect(map[0]).toBe('email');
    expect(map[1]).toBe('full_name');
    expect(map[2]).toBe(null);
  });

  it('dataRowsToObjects skips empty cells and tracks row numbers', () => {
    const rows = [
      ['a', 'b'],
      [1, 'x'],
      ['', 2],
    ];
    const mapping = ['col_a', 'col_b'];
    const objs = dataRowsToObjects(rows, mapping);
    expect(objs).toHaveLength(2);
    expect(objs[0]).toEqual({ rowNumber: 2, data: { col_a: 1, col_b: 'x' } });
    expect(objs[1]).toEqual({ rowNumber: 3, data: { col_b: 2 } });
  });
});

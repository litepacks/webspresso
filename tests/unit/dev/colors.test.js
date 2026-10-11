import { describe, it, expect } from 'vitest';
const { colors, createColors, stripAnsi } = require('../../../src/dev/colors');

describe('src/dev/colors', () => {
  it('strips ANSI escape sequences correctly', () => {
    const raw = '\x1b[31mError:\x1b[39m \x1b[1mSomething failed\x1b[22m';
    expect(stripAnsi(raw)).toBe('Error: Something failed');
  });

  it('handles null, undefined, and non-strings safely in stripAnsi', () => {
    expect(stripAnsi(null)).toBe('');
    expect(stripAnsi(undefined)).toBe('');
    expect(stripAnsi('')).toBe('');
  });

  it('formats strings when colors are enabled', () => {
    const c = createColors(true);
    expect(c.cyan('hello')).toContain('hello');
    expect(c.cyan('hello')).toContain('\x1b[36m');
    expect(c.green('success')).toContain('\x1b[32m');
    expect(c.red('fail')).toContain('\x1b[31m');
    expect(c.yellow('warn')).toContain('\x1b[33m');
    expect(c.bold('title')).toContain('\x1b[1m');
  });

  it('returns raw string when colors are disabled', () => {
    const c = createColors(false);
    expect(c.cyan('hello')).toBe('hello');
    expect(c.green('success')).toBe('success');
    expect(c.red('fail')).toBe('fail');
    expect(c.bold('title')).toBe('title');
  });

  it('handles empty, null or undefined input in color formatters gracefully', () => {
    const c = createColors(true);
    expect(c.cyan(null)).toBe('');
    expect(c.cyan(undefined)).toBe('');
    expect(c.cyan('')).toBe('');
  });
});

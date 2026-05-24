/**
 * helpers.js pure utils tests
 */

const { utils } = require('../../src/helpers');

describe('helpers utils', () => {
  it('slugify normalizes strings', () => {
    expect(utils.slugify('Hello World!')).toBe('hello-world');
    expect(utils.slugify('')).toBe('');
  });

  it('truncate shortens long strings', () => {
    expect(utils.truncate('abcdef', 5)).toBe('ab...');
    expect(utils.truncate('ab', 5)).toBe('ab');
    expect(utils.truncate('', 3)).toBe('');
  });

  it('prettyBytes formats sizes', () => {
    expect(utils.prettyBytes(0)).toBe('0 B');
    expect(utils.prettyBytes(1024)).toContain('KB');
  });

  it('prettyMs formats durations', () => {
    expect(utils.prettyMs(500)).toBe('500ms');
    expect(utils.prettyMs(5000)).toBe('5.0s');
    expect(utils.prettyMs(120000)).toBe('2.0m');
    expect(utils.prettyMs(7200000)).toBe('2.0h');
  });

  it('isDev and isProd reflect NODE_ENV', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    expect(utils.isDev()).toBe(true);
    expect(utils.isProd()).toBe(false);
    process.env.NODE_ENV = 'production';
    expect(utils.isDev()).toBe(false);
    expect(utils.isProd()).toBe(true);
    process.env.NODE_ENV = prev;
  });
});

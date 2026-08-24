const { deepClone } = require('../../core/orm/utils');

describe('Security: Prototype Pollution Defense', () => {
  it('should not pollute global Object.prototype when deepClone is passed __proto__ payload', () => {
    const malicious = JSON.parse('{"__proto__": {"pollutedKey": true}}');
    const cloned = deepClone(malicious);

    expect({}.pollutedKey).toBeUndefined();
    expect(Object.prototype.pollutedKey).toBeUndefined();
    expect(cloned.pollutedKey).toBeUndefined();
  });

  it('should not pollute prototype when constructor.prototype payload is cloned', () => {
    const malicious = JSON.parse('{"constructor": {"prototype": {"pollutedConstructor": true}}}');
    const cloned = deepClone(malicious);

    expect({}.pollutedConstructor).toBeUndefined();
    expect(Object.prototype.pollutedConstructor).toBeUndefined();
  });
});

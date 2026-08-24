const {
  filePathToServiceName,
  toCamelCase,
  createServiceRegistry,
  ServiceRegistry,
} = require('../../index');

describe('Services Discovery & Portability Edge Cases (Section 4 Hardened)', () => {
  describe('Cross-Platform Path Normalization (Windows \\ vs Linux /)', () => {
    it('should normalize Windows backslashes into dot-separated service names', () => {
      const res1 = filePathToServiceName('user\\get.js');
      expect(res1.name).toBe('user.get');

      const res2 = filePathToServiceName('nested\\deep\\feature\\run.js');
      expect(res2.name).toBe('nested.deep.feature.run');

      const res3 = filePathToServiceName('user\\profile\\index.js');
      expect(res3.name).toBe('user.profile');
      expect(res3.aliases).toContain('user.profile.index');
    });

    it('should trim leading and trailing slashes correctly', () => {
      expect(filePathToServiceName('/user/get.js').name).toBe('user.get');
      expect(filePathToServiceName('\\user\\get.js').name).toBe('user.get');
    });
  });

  describe('Kebab-case and Snake_case to camelCase Aliases', () => {
    it('toCamelCase helper should convert kebab and snake cases', () => {
      expect(toCamelCase('order-items')).toBe('orderItems');
      expect(toCamelCase('get_by_id')).toBe('getById');
      expect(toCamelCase('user_profile_data')).toBe('userProfileData');
      expect(toCamelCase('simple')).toBe('simple');
    });

    it('should generate camelCase aliases for hyphenated and underscored paths', () => {
      const res1 = filePathToServiceName('order-items/get-by-id.js');
      expect(res1.name).toBe('order-items.get-by-id');
      expect(res1.aliases).toContain('orderItems.getById');

      const res2 = filePathToServiceName('user_profile/get_data.js');
      expect(res2.name).toBe('user_profile.get_data');
      expect(res2.aliases).toContain('userProfile.getData');
    });

    it('should allow invoking services using both primary name and camelCase alias', async () => {
      const registry = new ServiceRegistry();

      registry.register('order-items.get-by-id', {
        async handler({ orderId }) {
          return { orderId, found: true };
        },
      });
      // Register camelCase alias
      registry.aliases.set('orderItems.getById', 'order-items.get-by-id');

      // Call via primary name
      const primaryRes = await registry.call('order-items.get-by-id', { orderId: 101 });
      expect(primaryRes.found).toBe(true);

      // Call via camelCase alias
      const aliasRes = await registry.call('orderItems.getById', { orderId: 101 });
      expect(aliasRes.found).toBe(true);
    });
  });
});

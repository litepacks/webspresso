const {
  validateServiceInput,
  sanitizeInput,
  ServiceRegistry,
  ValidationError,
} = require('../../index');
const { maskSensitiveData } = require('../../src/services/executor');
const z = require('zod');

describe('Services Validation & Security Edge Cases (Section 3 Hardened)', () => {
  describe('Async Zod & Custom Validation', () => {
    it('should support async Zod schema refinements (.refine(async ...))', async () => {
      const asyncSchema = z.object({
        email: z.string().email().refine(async (val) => {
          // Simulate DB lookup
          await new Promise((r) => setTimeout(r, 10));
          return val !== 'taken@example.com';
        }, { message: 'Email is already registered' }),
      });

      const res = await validateServiceInput(asyncSchema, { email: 'available@example.com' }, 'user.register');
      expect(res.email).toBe('available@example.com');

      await expect(
        validateServiceInput(asyncSchema, { email: 'taken@example.com' }, 'user.register')
      ).rejects.toThrow(ValidationError);
    });

    it('should support async custom validator functions', async () => {
      const asyncValidator = async (input) => {
        await new Promise((r) => setTimeout(r, 5));
        return input.token === 'valid_secret';
      };

      const res = await validateServiceInput(asyncValidator, { token: 'valid_secret' }, 'auth.verify');
      expect(res.token).toBe('valid_secret');

      await expect(
        validateServiceInput(asyncValidator, { token: 'invalid' }, 'auth.verify')
      ).rejects.toThrow(ValidationError);
    });

    it('should execute service with async schema via registry.call()', async () => {
      const registry = new ServiceRegistry();

      registry.register('user.checkHandle', {
        schema: ({ z }) => z.object({
          handle: z.string().refine(async (h) => h.startsWith('@'), { message: 'Handle must start with @' }),
        }),
        async handler({ handle }) {
          return { available: true, handle };
        },
      });

      const success = await registry.call('user.checkHandle', { handle: '@webspresso' });
      expect(success.available).toBe(true);

      await expect(
        registry.call('user.checkHandle', { handle: 'invalid_handle' })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('Prototype Pollution Defense', () => {
    it('should strip __proto__, constructor, and prototype from input payloads', () => {
      const evilPayload = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"evil":true},"safe":"value"}');

      const clean = sanitizeInput(evilPayload);
      expect(clean.safe).toBe('value');
      expect(Object.prototype.hasOwnProperty.call(clean, '__proto__')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(clean, 'constructor')).toBe(false);
      expect(({}).polluted).toBeUndefined();
    });

    it('should sanitize nested objects and arrays against prototype pollution', () => {
      const nestedPayload = JSON.parse('{"users":[{"name":"alice","__proto__":{"admin":true}}]}');

      const clean = sanitizeInput(nestedPayload);
      expect(clean.users[0].name).toBe('alice');
      expect(Object.prototype.hasOwnProperty.call(clean.users[0], '__proto__')).toBe(false);
      expect(({}).admin).toBeUndefined();
    });
  });

  describe('Sensitive Data Masking (Log Protection)', () => {
    it('should mask default sensitive keys (password, token, apiKey, cvv, creditCard)', () => {
      const sensitivePayload = {
        email: 'user@example.com',
        password: 'mySecretPassword123',
        token: 'jwt.token.here',
        apiKey: 'sk_live_123456789',
        card: {
          cardNumber: '4111222233334444',
          cvv: '123',
          expiry: '12/28',
        },
      };

      const masked = maskSensitiveData(sensitivePayload);
      expect(masked.email).toBe('user@example.com');
      expect(masked.password).toBe('[REDACTED]');
      expect(masked.token).toBe('[REDACTED]');
      expect(masked.apiKey).toBe('[REDACTED]');
      expect(masked.card.cardNumber).toBe('[REDACTED]');
      expect(masked.card.cvv).toBe('[REDACTED]');
      expect(masked.card.expiry).toBe('12/28');
    });

    it('should support custom redaction keys', () => {
      const payload = {
        ssn: '123-45-6789',
        nationalId: '987654321',
        name: 'John Doe',
      };

      const masked = maskSensitiveData(payload, ['nationalId']);
      expect(masked.name).toBe('John Doe');
      expect(masked.ssn).toBe('[REDACTED]');
      expect(masked.nationalId).toBe('[REDACTED]');
    });
  });
});

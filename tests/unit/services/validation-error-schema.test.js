/**
 * Tests for Services Layer Zod & Validation Error Schema Integrity
 * Verifies code = 'VALIDATION_ERROR', statusCode = 400, service = serviceName,
 * fields mapping, fieldErrors, issues normalization, and prototype security
 */

'use strict';

const z = require('zod');
const {
  ServiceRegistry,
  defineService,
  ValidationError,
  validateServiceInput,
  createServiceValidationError,
  normalizeValidationIssues,
  formatZodErrors,
} = require('../../../src/services');

describe('Services Zod & Validation Error Schema Integrity (Item 6)', () => {
  describe('Zod Schema Validation Failure Integrity', () => {
    it('should attach code, statusCode, status, service, fields, and normalizedIssues on sync Zod errors', () => {
      const schema = z.object({
        username: z.string().min(3, 'Username must be at least 3 chars'),
        email: z.string().email('Invalid email address'),
        age: z.number().int().min(18, 'Must be at least 18'),
      });

      let caughtErr = null;
      try {
        validateServiceInput(schema, { username: 'al', email: 'not-an-email', age: 15 }, 'user.register');
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(ValidationError);
      expect(caughtErr.name).toBe('ValidationError');
      expect(caughtErr.code).toBe('VALIDATION_ERROR');
      expect(caughtErr.statusCode).toBe(400);
      expect(caughtErr.status).toBe(400);
      expect(caughtErr.service).toBe('user.register');

      // Fields map
      expect(caughtErr.fields).toBeDefined();
      expect(caughtErr.fields.username).toBe('Username must be at least 3 chars');
      expect(caughtErr.fields.email).toBe('Invalid email address');
      expect(caughtErr.fields.age).toBe('Must be at least 18');

      // FieldErrors array map
      expect(caughtErr.fieldErrors).toBeDefined();
      expect(Array.isArray(caughtErr.fieldErrors.username)).toBe(true);
      expect(caughtErr.fieldErrors.username).toContain('Username must be at least 3 chars');

      // Details and issues
      expect(Array.isArray(caughtErr.details)).toBe(true);
      expect(caughtErr.details.length).toBe(3);
      expect(caughtErr.issues).toBe(caughtErr.details);

      // Normalized issues
      expect(Array.isArray(caughtErr.normalizedIssues)).toBe(true);
      expect(caughtErr.normalizedIssues[0]).toMatchObject({
        path: 'username',
        message: 'Username must be at least 3 chars',
      });
    });

    it('should format multiple issues on the same field into fieldErrors', () => {
      const schema = z.object({
        code: z.string().min(5, 'Minimum 5 characters').regex(/^[A-Z]+$/, 'Must be uppercase'),
      });

      let caught = null;
      try {
        validateServiceInput(schema, { code: 'ab' }, 'coupon.verify');
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ValidationError);
      expect(caught.service).toBe('coupon.verify');
      expect(caught.code).toBe('VALIDATION_ERROR');
      expect(caught.statusCode).toBe(400);
      expect(caught.fields.code).toBe('Minimum 5 characters');
      expect(caught.fieldErrors.code.length).toBe(2);
      expect(caught.fieldErrors.code).toContain('Minimum 5 characters');
      expect(caught.fieldErrors.code).toContain('Must be uppercase');
    });
  });

  describe('Async Zod & Promise Refinements', () => {
    it('should attach standardized error attributes on async refinement failures', async () => {
      const asyncSchema = z.object({
        email: z.string().email().refine(async (val) => {
          await new Promise((r) => setTimeout(r, 5));
          return val !== 'taken@example.com';
        }, { message: 'Email address already in use' }),
      });

      let caught = null;
      try {
        await validateServiceInput(asyncSchema, { email: 'taken@example.com' }, 'auth.register');
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ValidationError);
      expect(caught.name).toBe('ValidationError');
      expect(caught.code).toBe('VALIDATION_ERROR');
      expect(caught.statusCode).toBe(400);
      expect(caught.status).toBe(400);
      expect(caught.service).toBe('auth.register');
      expect(caught.fields.email).toBe('Email address already in use');
      expect(caught.details.length).toBe(1);
    });

    it('should catch unhandled rejection inside async refinement and format as ValidationError', async () => {
      const crashingSchema = z.object({
        id: z.string().refine(async () => {
          throw new Error('Database connection failed in validator');
        }),
      });

      let caught = null;
      try {
        await validateServiceInput(crashingSchema, { id: '123' }, 'user.check');
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ValidationError);
      expect(caught.code).toBe('VALIDATION_ERROR');
      expect(caught.statusCode).toBe(400);
      expect(caught.service).toBe('user.check');
      expect(caught.message).toContain('Database connection failed in validator');
    });
  });

  describe('Custom Validator Functions', () => {
    it('should standardize errors when custom validator returns false (sync)', () => {
      const validator = (input) => input && input.active === true;

      let caught = null;
      try {
        validateServiceInput(validator, { active: false }, 'account.activate');
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ValidationError);
      expect(caught.code).toBe('VALIDATION_ERROR');
      expect(caught.statusCode).toBe(400);
      expect(caught.status).toBe(400);
      expect(caught.service).toBe('account.activate');
      expect(caught.fields._root).toContain('custom validation rejected input');
    });

    it('should standardize errors when custom validator resolves to false (async)', async () => {
      const asyncValidator = async (input) => {
        await new Promise((r) => setTimeout(r, 2));
        return Boolean(input.token && input.token === 'valid_secret');
      };

      let caught = null;
      try {
        await validateServiceInput(asyncValidator, { token: 'bad_token' }, 'token.inspect');
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ValidationError);
      expect(caught.code).toBe('VALIDATION_ERROR');
      expect(caught.statusCode).toBe(400);
      expect(caught.service).toBe('token.inspect');
      expect(caught.fields._root).toBeDefined();
    });

    it('should wrap arbitrary errors thrown by custom validator into ValidationError', () => {
      const throwingValidator = () => {
        throw new TypeError('Invalid payload format in custom check');
      };

      let caught = null;
      try {
        validateServiceInput(throwingValidator, {}, 'order.submit');
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ValidationError);
      expect(caught.code).toBe('VALIDATION_ERROR');
      expect(caught.statusCode).toBe(400);
      expect(caught.service).toBe('order.submit');
      expect(caught.cause).toBeInstanceOf(TypeError);
    });

    it('should enrich ValidationError if thrown manually without service or code', () => {
      const manualValError = () => {
        throw new ValidationError('Custom business validation failed', { status: 400 });
      };

      let caught = null;
      try {
        validateServiceInput(manualValError, {}, 'payment.charge');
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ValidationError);
      expect(caught.code).toBe('VALIDATION_ERROR');
      expect(caught.statusCode).toBe(400);
      expect(caught.service).toBe('payment.charge');
    });
  });

  describe('Dangerous Prototype Keys Strict Rejection Option', () => {
    it('should reject dangerous prototype pollution keys when rejectDangerousKeys is enabled', () => {
      const malicious = JSON.parse('{"safe":"ok","__proto__":{"polluted":true}}');

      let caught = null;
      try {
        validateServiceInput(null, malicious, 'security.audit', { rejectDangerousKeys: true });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ValidationError);
      expect(caught.code).toBe('VALIDATION_ERROR');
      expect(caught.statusCode).toBe(400);
      expect(caught.service).toBe('security.audit');
      expect(caught.message).toContain('dangerous prototype keys detected');
    });

    it('should safely strip dangerous keys without throwing by default', () => {
      const malicious = JSON.parse('{"safe":"ok","__proto__":{"polluted":true}}');
      const sanitized = validateServiceInput(null, malicious, 'security.audit');
      expect(sanitized.safe).toBe('ok');
      expect(Object.prototype.hasOwnProperty.call(sanitized, '__proto__')).toBe(false);
    });
  });

  describe('Validation Utility Functions', () => {
    it('createServiceValidationError creates a fully populated error instance', () => {
      const err = createServiceValidationError('Test validation failure', {
        serviceName: 'test.svc',
        fields: { name: 'Name required' },
        details: [{ path: ['name'], message: 'Name required', code: 'too_small' }],
      });

      expect(err).toBeInstanceOf(ValidationError);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.status).toBe(400);
      expect(err.statusCode).toBe(400);
      expect(err.service).toBe('test.svc');
      expect(err.fields.name).toBe('Name required');
      expect(err.normalizedIssues[0]).toEqual({
        path: 'name',
        message: 'Name required',
        code: 'too_small',
      });
    });

    it('normalizeValidationIssues handles empty, string, and array paths', () => {
      expect(normalizeValidationIssues(null)).toEqual([]);
      expect(normalizeValidationIssues([])).toEqual([]);

      const normalized = normalizeValidationIssues([
        { path: ['user', 'profile', 'name'], message: 'Missing', code: 'required' },
        { path: 'email', message: 'Invalid', code: 'custom' },
        { path: [], message: 'Root failure' },
      ]);

      expect(normalized).toEqual([
        { path: 'user.profile.name', message: 'Missing', code: 'required' },
        { path: 'email', message: 'Invalid', code: 'custom' },
        { path: '_root', message: 'Root failure', code: 'invalid_type' },
      ]);
    });
  });

  describe('Service Registry & Executor Integration', () => {
    it('should propagate code=VALIDATION_ERROR, statusCode=400, and service on registry.call()', async () => {
      const registry = new ServiceRegistry();

      registry.register('billing.invoice', defineService({
        schema: ({ z }) => z.object({
          amount: z.number().positive('Amount must be positive'),
          currency: z.enum(['USD', 'EUR', 'TRY'], { errorMap: () => ({ message: 'Unsupported currency' }) }),
        }),
        async handler(input) {
          return { billed: true, amount: input.amount };
        },
      }));

      let caught = null;
      try {
        await registry.call('billing.invoice', { amount: -50, currency: 'XYZ' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ValidationError);
      expect(caught.code).toBe('VALIDATION_ERROR');
      expect(caught.statusCode).toBe(400);
      expect(caught.status).toBe(400);
      expect(caught.service).toBe('billing.invoice');
      expect(caught.fields.amount).toBe('Amount must be positive');
      expect(caught.fields.currency).toBe('Unsupported currency');
    });

    it('should pass service:error event with normalized error details', async () => {
      const registry = new ServiceRegistry();
      const emittedEvents = [];

      registry.setEventDispatcher({
        emit(event, data) {
          emittedEvents.push({ event, data });
        },
      });

      registry.register('item.fetch', {
        schema: ({ z }) => z.object({ id: z.number() }),
        async handler({ id }) { return { id }; },
      });

      await expect(registry.call('item.fetch', { id: 'not-a-number' })).rejects.toThrow(ValidationError);

      const errorEvent = emittedEvents.find((e) => e.event === 'service:error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.data.name).toBe('item.fetch');
      expect(errorEvent.data.error.code).toBe('VALIDATION_ERROR');
      expect(errorEvent.data.error.statusCode).toBe(400);
      expect(errorEvent.data.error.service).toBe('item.fetch');
    });

    it('should not log ValidationError as internal server error', async () => {
      const logs = [];
      const mockLogger = {
        error: (msg) => logs.push(msg),
        info: () => {},
        warn: () => {},
      };

      const registry = new ServiceRegistry({ logger: mockLogger });
      registry.register('test.validate', {
        schema: ({ z }) => z.object({ value: z.string() }),
        async handler() { return {}; },
      });

      await expect(registry.call('test.validate', { value: 12345 })).rejects.toThrow(ValidationError);

      // Logger should NOT have recorded any execution failed error for ValidationError
      expect(logs.length).toBe(0);
    });
  });
});

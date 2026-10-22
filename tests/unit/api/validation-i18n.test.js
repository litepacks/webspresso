import { cleanupDir, createTempDir } from '../../utils';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import { createApp, defineApi } from '../../../index';
import {
  translateSingleIssue,
  translateValidationIssues,
  getTranslatorForRequest,
} from '../../../src/api/validation-i18n';
import { createTranslator } from '../../../src/file-router';

describe('API Validation i18n & Error Translation', () => {
  describe('translateSingleIssue Unit Tests', () => {
    const translationsTr = {
      auth: {
        email_required: 'E-posta adresi zorunludur',
        min_age: 'Yaşınız en az {{ min }} olmalıdır',
      },
      validation: {
        required: 'Bu alan zorunludur',
        too_small: 'Bu alan en az {{ min }} karakter olmalıdır',
        too_big: 'Bu alan en fazla {{ max }} karakter olabilir',
        invalid_string: {
          email: 'Geçerli bir e-posta adresi giriniz',
        },
        fields: {
          username: {
            required: 'Kullanıcı adı alanı boş bırakılamaz',
          },
        },
      },
    };

    const tTr = createTranslator(translationsTr, { locale: 'tr' });

    it('translates explicit custom message key with interpolation', () => {
      const issue = {
        code: 'too_small',
        minimum: 18,
        type: 'number',
        message: 'auth.min_age',
        path: ['age'],
      };

      const translated = translateSingleIssue(issue, tTr);
      expect(translated.message).toBe('Yaşınız en az 18 olmalıdır');
      expect(translated.key).toBe('auth.min_age');
    });

    it('translates explicit custom message key without parameters', () => {
      const issue = {
        code: 'invalid_type',
        expected: 'string',
        received: 'undefined',
        message: 'auth.email_required',
        path: ['email'],
      };

      const translated = translateSingleIssue(issue, tTr);
      expect(translated.message).toBe('E-posta adresi zorunludur');
      expect(translated.key).toBe('auth.email_required');
    });

    it('falls back to field-specific required translation when no custom key provided', () => {
      const issue = {
        code: 'invalid_type',
        expected: 'string',
        received: 'undefined',
        message: 'Required',
        path: ['username'],
      };

      const translated = translateSingleIssue(issue, tTr);
      expect(translated.message).toBe('Kullanıcı adı alanı boş bırakılamaz');
      expect(translated.key).toBe('validation.fields.username.required');
    });

    it('falls back to general validation.required for missing fields', () => {
      const issue = {
        code: 'invalid_type',
        expected: 'string',
        received: 'undefined',
        message: 'Required',
        path: ['password'],
      };

      const translated = translateSingleIssue(issue, tTr);
      expect(translated.message).toBe('Bu alan zorunludur');
      expect(translated.key).toBe('validation.required');
    });

    it('falls back to general validation.too_small with min interpolation', () => {
      const issue = {
        code: 'too_small',
        minimum: 5,
        type: 'string',
        message: 'String must contain at least 5 character(s)',
        path: ['title'],
      };

      const translated = translateSingleIssue(issue, tTr);
      expect(translated.message).toBe('Bu alan en az 5 karakter olmalıdır');
      expect(translated.key).toBe('validation.too_small');
    });

    it('falls back to general validation.invalid_string.email for email validation', () => {
      const issue = {
        code: 'invalid_string',
        validation: 'email',
        message: 'Invalid email',
        path: ['contactEmail'],
      };

      const translated = translateSingleIssue(issue, tTr);
      expect(translated.message).toBe('Geçerli bir e-posta adresi giriniz');
      expect(translated.key).toBe('validation.invalid_string.email');
    });

    it('interpolates placeholders in non-key custom messages', () => {
      const issue = {
        code: 'too_small',
        minimum: 10,
        message: 'Length must be at least {{ min }}',
        path: ['code'],
      };

      const translated = translateSingleIssue(issue, tTr);
      expect(translated.message).toBe('Length must be at least 10');
      expect(translated.key).toBeUndefined();
    });

    it('preserves original message if no translation key matches', () => {
      const issue = {
        code: 'custom',
        message: 'Something very specific failed',
        path: ['field'],
      };

      const translated = translateSingleIssue(issue, tTr);
      expect(translated.message).toBe('Something very specific failed');
    });

    it('handles nested path dot-notation keys correctly', () => {
      const issue = {
        code: 'invalid_type',
        expected: 'string',
        received: 'undefined',
        message: 'Required',
        path: ['user', 'profile', 'name'],
      };

      const customTr = createTranslator({
        validation: {
          fields: {
            user: {
              profile: {
                name: {
                  required: 'Profil ismi zorunludur',
                },
              },
            },
          },
        },
      }, { locale: 'tr' });

      const translated = translateSingleIssue(issue, customTr);
      expect(translated.message).toBe('Profil ismi zorunludur');
      expect(translated.key).toBe('validation.fields.user.profile.name.required');
    });

    it('handles non-array or empty issues safely in translateValidationIssues', () => {
      expect(translateValidationIssues(null)).toBeNull();
      expect(translateValidationIssues([])).toEqual([]);
      expect(translateValidationIssues(undefined)).toBeUndefined();
    });

    it('accepts direct t option in translateValidationIssues', () => {
      const issues = [
        { code: 'too_small', minimum: 3, path: ['name'], message: 'String must contain at least 3 character(s)' },
      ];
      const res = translateValidationIssues(issues, { t: tTr });
      expect(res[0].message).toBe('Bu alan en az 3 karakter olmalıdır');
      expect(res[0].key).toBe('validation.too_small');
    });
  });

  describe('Full HTTP Integration with createApp & defineApi', () => {
    const tempDir = createTempDir('temp-api-i18n-test');
    let origSupported;

    let app;

    beforeAll(() => {
      origSupported = process.env.SUPPORTED_LOCALES;
      process.env.SUPPORTED_LOCALES = 'en,tr,de';
      fs.mkdirSync(path.join(tempDir, 'pages', 'locales'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'pages', 'api'), { recursive: true });

      // Turkish dictionary
      fs.writeFileSync(
        path.join(tempDir, 'pages', 'locales', 'tr.json'),
        JSON.stringify({
          welcome: 'Hoş geldiniz',
          auth: {
            email_required: 'E-posta adresi zorunludur',
            min_length: 'En az {{ min }} karakter giriniz',
          },
          validation: {
            required: 'Lütfen bu alanı doldurunuz',
            too_small: 'Bu alan en az {{ min }} olmalıdır',
          },
        }, null, 2)
      );

      // English dictionary
      fs.writeFileSync(
        path.join(tempDir, 'pages', 'locales', 'en.json'),
        JSON.stringify({
          welcome: 'Welcome',
          auth: {
            email_required: 'Email is required',
            min_length: 'Please enter at least {{ min }} characters',
          },
          validation: {
            required: 'Please fill in this field',
            too_small: 'This field must be at least {{ min }}',
          },
        }, null, 2)
      );

      // Create API endpoint
      fs.writeFileSync(
        path.join(tempDir, 'pages', 'api', 'register.post.js'),
        `
        const { defineApi } = require('${path.resolve(__dirname, '../../../index')}');

        module.exports = defineApi({
          schema: ({ z }) => ({
            body: z.object({
              email: z.string({ message: 'auth.email_required' }),
              password: z.string().min(6, { message: 'auth.min_length' }),
              age: z.number().min(18),
            }),
          }),
          handler: async (req, res, { t, locale }) => {
            return res.json({
              success: true,
              greeting: t('welcome'),
              locale,
            });
          },
        });
        `
      );

      const serverInstance = createApp({
        rootDir: tempDir,
        pagesDir: path.join(tempDir, 'pages'),
        silent: true,
        server: { port: 0, shutdown: { enabled: false } },
        helmet: false,
        compression: false,
        cache: false,
        healthCheck: false,
        metrics: false,
        lazyRoutes: true,
      });
      app = serverInstance.app;
    });

    afterAll(() => {
      if (origSupported !== undefined) {
        process.env.SUPPORTED_LOCALES = origSupported;
      } else {
        delete process.env.SUPPORTED_LOCALES;
      }
      try {
        cleanupDir(tempDir);
      } catch {}
    });

    it('returns Turkish validation messages with Accept-Language: tr', async () => {

      const res = await request(app)
        .post('/api/register')
        .set('Accept-Language', 'tr-TR,tr;q=0.9')
        .send({
          email: 'test@example.com',
          password: '123', // < 6
          // age missing
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation Error');
      expect(Array.isArray(res.body.issues)).toBe(true);

      const pwdIssue = res.body.issues.find((i) => i.path.includes('password'));
      expect(pwdIssue).toBeDefined();
      expect(pwdIssue.message).toBe('En az 6 karakter giriniz');
      expect(pwdIssue.key).toBe('auth.min_length');

      const ageIssue = res.body.issues.find((i) => i.path.includes('age'));
      expect(ageIssue).toBeDefined();
      expect(ageIssue.message).toBe('Lütfen bu alanı doldurunuz');
      expect(ageIssue.key).toBe('validation.required');
    });

    it('returns English validation messages with Accept-Language: en', async () => {

      const res = await request(app)
        .post('/api/register')
        .set('Accept-Language', 'en-US,en;q=0.9')
        .send({
          email: 'test@example.com',
          password: '123',
          age: 10, // < 18
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation Error');

      const pwdIssue = res.body.issues.find((i) => i.path.includes('password'));
      expect(pwdIssue.message).toBe('Please enter at least 6 characters');
      expect(pwdIssue.key).toBe('auth.min_length');

      const ageIssue = res.body.issues.find((i) => i.path.includes('age'));
      expect(ageIssue.message).toBe('This field must be at least 18');
      expect(ageIssue.key).toBe('validation.too_small');
    });

    it('switches locale dynamically via query string ?lang=tr', async () => {

      const res = await request(app)
        .post('/api/register?lang=tr')
        .set('Accept-Language', 'en-US') // Query string takes precedence over header
        .send({});

      expect(res.status).toBe(400);
      const emailIssue = res.body.issues.find((i) => i.path.includes('email'));
      expect(emailIssue.message).toBe('E-posta adresi zorunludur');
      expect(emailIssue.key).toBe('auth.email_required');
    });

    it('passes t and locale to apiCtx on successful valid requests', async () => {

      const res = await request(app)
        .post('/api/register?lang=tr')
        .send({
          email: 'user@example.com',
          password: 'securePassword123',
          age: 25,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.greeting).toBe('Hoş geldiniz');
      expect(res.body.locale).toBe('tr');
    });

    describe('getTranslatorForRequest & translateSingleIssue Edge Cases', () => {
      it('handles getTranslatorForRequest with pre-existing req.t and req.locale', () => {
        const mockT = (key) => key;
        const req = { t: mockT, locale: 'de' };
        const result = getTranslatorForRequest(req);
        expect(result.locale).toBe('de');
        expect(result.t).toBe(mockT);
      });

      it('handles getTranslatorForRequest when req is null/undefined', () => {
        const result = getTranslatorForRequest(null);
        expect(result.locale).toBe(process.env.DEFAULT_LOCALE || 'en');
        expect(typeof result.t).toBe('function');
      });

      it('handles getTranslatorForRequest caching in production mode', () => {
        const pagesDir = path.join(tempDir, 'pages');
        const routeDir = path.join(pagesDir, 'api');

        // First call (cache miss)
        const res1 = getTranslatorForRequest(
          { locale: 'tr', headers: {} },
          { pagesDir, routeDir, isDev: false }
        );
        expect(res1.locale).toBe('tr');

        // Second call (cache hit)
        const res2 = getTranslatorForRequest(
          { locale: 'tr', headers: {} },
          { pagesDir, routeDir, isDev: false }
        );
        expect(res2.locale).toBe('tr');
      });

      it('handles translateSingleIssue edge cases (null, non-object, missing path)', () => {
        expect(translateSingleIssue(null, () => '')).toBeNull();
        expect(translateSingleIssue('string-issue', () => '')).toBe('string-issue');

        const nonArrayPath = { code: 'custom', path: null, message: 'Custom msg' };
        const res = translateSingleIssue(nonArrayPath, (k) => k);
        expect(res.message).toBe('Custom msg');
      });

      it('handles translateSingleIssue with maximum and limit parameters', () => {
        const translations = {
          validation: {
            too_big: 'En fazla {{ max }} olmalıdır (limit: {{ limit }})',
          },
        };
        const t = createTranslator(translations, { locale: 'tr' });

        const issue = {
          code: 'too_big',
          maximum: 100,
          path: ['count'],
          message: 'Number must be <= 100',
        };

        const res = translateSingleIssue(issue, t);
        expect(res.message).toBe('En fazla 100 olmalıdır (limit: 100)');
      });

      it('handles translateValidationIssues with options.req and fallback when no translator', () => {
        const issues = [{ code: 'invalid_type', path: ['name'], message: 'Required' }];

        // Pre-set translator on req
        const customReq = {
          t: createTranslator({ validation: { required: 'Özel Çeviri' } }, { locale: 'tr' }),
          locale: 'tr',
        };
        const translated1 = translateValidationIssues(issues, { req: customReq });
        expect(translated1[0].message).toBe('Özel Çeviri');

        // Fallback when no translator resolved
        const translated2 = translateValidationIssues(issues, {});
        expect(translated2[0].message).toBe('Required');
      });
    });
  });
});

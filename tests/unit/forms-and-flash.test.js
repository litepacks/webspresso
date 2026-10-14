import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { z } from 'zod';
import {
  createFlashMiddleware,
  normalizeErrors,
  renderField,
  renderFormFor,
  defineModel,
  zdb,
  createHelpers,
  clearRegistry,
} from '../../index.js';

describe('Forms & Flash Subsystem (AdonisJS & Django-inspired)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  describe('normalizeErrors', () => {
    it('normalizes ZodError instances to { field: string[] }', () => {
      const schema = z.object({
        email: z.string().email('Invalid email address'),
        age: z.number().min(18, 'Must be at least 18 years old'),
      });

      const parsed = schema.safeParse({ email: 'not-an-email', age: 12 });
      expect(parsed.success).toBe(false);

      const normalized = normalizeErrors(parsed.error);
      expect(normalized).toHaveProperty('email');
      expect(normalized.email).toContain('Invalid email address');
      expect(normalized).toHaveProperty('age');
      expect(normalized.age).toContain('Must be at least 18 years old');
    });

    it('normalizes string and object errors', () => {
      expect(normalizeErrors('General failure')).toEqual({ _form: ['General failure'] });
      expect(normalizeErrors({ name: 'Name is required' })).toEqual({ name: ['Name is required'] });
      expect(normalizeErrors(['Error 1', 'Error 2'])).toEqual({ _form: ['Error 1', 'Error 2'] });
    });
  });

  describe('Flash Middleware Lifecycle across Requests', () => {
    it('persists old input and errors via cookie when redirected, and clears on consumption', async () => {
      const app = express();
      app.use(express.urlencoded({ extended: true }));
      app.use(express.json());
      app.use(require('cookie-parser')());
      app.use(createFlashMiddleware());

      // POST endpoint that fails validation and redirects with old input and errors
      app.post('/submit', (req, res) => {
        const { email, password } = req.body;
        if (!email || !email.includes('@')) {
          return res
            .withInput()
            .withErrors({ email: 'Please enter a valid email address' })
            .withFlash('warning', 'Please fix the errors below')
            .redirect('/form');
        }
        res.send('Success');
      });

      // GET endpoint rendering page using fsy helpers
      app.get('/form', (req, res) => {
        const fsy = createHelpers({ req, res });
        res.json({
          oldEmail: fsy.old('email'),
          hasEmailError: fsy.hasError('email'),
          emailError: fsy.error('email'),
          warningFlash: fsy.flash('warning'),
          allErrors: fsy.allErrors(),
          oldPassword: fsy.old('password'), // should be sanitized/omitted
        });
      });

      const client = supertest(app);

      // Step 1: Submit invalid form
      const postRes = await client
        .post('/submit')
        .send({ email: 'invalid-email', password: 'secretpassword123' })
        .expect(302);

      const cookies = postRes.headers['set-cookie'];
      expect(cookies).toBeDefined();

      // Step 2: Follow redirect with flash cookie
      const getRes = await client
        .get('/form')
        .set('Cookie', cookies)
        .expect(200);

      expect(getRes.body.oldEmail).toBe('invalid-email');
      expect(getRes.body.hasEmailError).toBe(true);
      expect(getRes.body.emailError).toBe('Please enter a valid email address');
      expect(getRes.body.warningFlash).toBe('Please fix the errors below');
      expect(getRes.body.oldPassword).toBeNull(); // sensitive field removed, returns default null

      // Step 3: Next request without cookie should NOT have flash data (one-time consumption)
      const nextRes = await client.get('/form').expect(200);
      expect(nextRes.body.oldEmail).toBeNull();
      expect(nextRes.body.hasEmailError).toBe(false);
      expect(nextRes.body.emailError).toBeNull();
    });
  });

  describe('Field & Form Rendering (Django-inspired)', () => {
    it('renders a single field with label, input, and validation error', () => {
      const mockReq = {
        old: (name) => (name === 'username' ? 'ahmet_dev' : null),
        __flash: {
          errors: {
            username: ['Username already taken'],
          },
        },
      };

      const html = renderField(
        'username',
        {
          label: 'Your Username',
          placeholder: 'Choose a username',
          required: true,
        },
        { req: mockReq }
      );

      expect(html).toContain('<label for="field_username" class="form-label">Your Username <span class="text-danger">*</span></label>');
      expect(html).toContain('value="ahmet_dev"');
      expect(html).toContain('is-invalid');
      expect(html).toContain('Username already taken');
      expect(html).toContain('placeholder="Choose a username"');
    });

    it('renders textarea, select, and checkbox fields properly', () => {
      // Textarea
      const textarea = renderField('bio', { type: 'textarea', rows: 5, value: 'Hello world' });
      expect(textarea).toContain('<textarea');
      expect(textarea).toContain('rows="5"');
      expect(textarea).toContain('>Hello world</textarea>');

      // Select
      const select = renderField('country', {
        type: 'select',
        selectOptions: [
          { label: 'Turkey', value: 'TR' },
          { label: 'United States', value: 'US' },
        ],
        value: 'TR',
      });
      expect(select).toContain('<select');
      expect(select).toContain('<option value="TR" selected>Turkey</option>');

      // Checkbox
      const checkbox = renderField('terms', {
        type: 'checkbox',
        label: 'I accept terms',
        value: true,
      });
      expect(checkbox).toContain('<input type="checkbox"');
      expect(checkbox).toContain('checked');
      expect(checkbox).toContain('I accept terms');
    });

    it('renders complete HTML form from an ORM model definition (Django ModelForm)', () => {
      const ArticleModel = defineModel({
        name: 'Article',
        table: 'articles',
        schema: zdb.schema({
          id: zdb.id(),
          title: zdb.string({ maxLength: 255 }),
          content: zdb.text({ nullable: true }),
          isPublished: zdb.boolean({ default: false }),
          category: zdb.enum(['tech', 'design', 'business']),
          created_at: zdb.timestamp({ auto: 'create' }),
        }),
      });

      const mockReq = {
        old: (name) => (name === 'title' ? 'My First Post' : null),
        csrfToken: () => 'mock-csrf-token-123',
        __flash: {},
      };

      const formHtml = renderFormFor(
        ArticleModel,
        {
          action: '/articles/create',
          submitLabel: 'Publish Article',
        },
        { req: mockReq }
      );

      expect(formHtml).toContain('<form action="/articles/create" method="POST"');
      expect(formHtml).toContain('<input type="hidden" name="_csrf" value="mock-csrf-token-123">');
      // ID and created_at should be excluded automatically
      expect(formHtml).not.toContain('name="id"');
      expect(formHtml).not.toContain('name="created_at"');
      // Fields should be generated with appropriate widgets
      expect(formHtml).toContain('name="title"');
      expect(formHtml).toContain('value="My First Post"');
      expect(formHtml).toContain('name="content"');
      expect(formHtml).toContain('<textarea');
      expect(formHtml).toContain('name="isPublished"');
      expect(formHtml).toContain('type="checkbox"');
      expect(formHtml).toContain('name="category"');
      expect(formHtml).toContain('<select');
      expect(formHtml).toContain('Publish Article');
    });

    it('exposes form helpers directly on fsy helper object', () => {
      const mockReq = {
        old: (name) => (name ? { email: 'test@example.com' }[name] : { email: 'test@example.com' }),
        __flash: {
          errors: {
            email: ['Invalid format'],
          },
          success: 'Saved successfully!',
        },
      };

      const fsy = createHelpers({ req: mockReq });

      expect(fsy.old('email')).toBe('test@example.com');
      expect(fsy.hasError('email')).toBe(true);
      expect(fsy.error('email')).toBe('Invalid format');
      expect(fsy.hasFlash('success')).toBe(true);
      expect(fsy.flash('success')).toBe('Saved successfully!');
      expect(typeof fsy.field).toBe('function');
      expect(typeof fsy.formFor).toBe('function');
    });
  });
});

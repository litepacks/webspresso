/**
 * Tests for Client-Side Dynamic Form Validation & Inline Field Errors in Admin Panel SPA
 */

const fs = require('fs');
const path = require('path');

const mockM = (tag, attrsOrChildren, ...children) => {
  let attrs = {};
  let childList = [];
  if (attrsOrChildren && typeof attrsOrChildren === 'object' && !Array.isArray(attrsOrChildren)) {
    attrs = attrsOrChildren;
    childList = children.flat();
  } else if (attrsOrChildren !== undefined) {
    childList = [attrsOrChildren, ...children].flat();
  }
  return { tag, attrs, children: childList };
};

describe('Admin Panel SPA Form Validation & Field Errors', () => {
  let validateField, validateForm, FieldRenderers, isRichTextEmpty;

  beforeAll(() => {
    isRichTextEmpty = require('../../../plugins/admin-panel/lib/is-rich-text-empty').isRichTextEmpty;

    // Load 04-field-renderers.js
    const renderersSrc = fs.readFileSync(
      path.join(__dirname, '../../../plugins/admin-panel/client/parts/04-field-renderers.js'),
      'utf8'
    );
    const formatColumnLabel = (str) => (str ? str.replace(/_/g, ' ') : '');
    const api = {};
    const evalRenderers = new Function('m', 'formatColumnLabel', 'api', renderersSrc + '\nreturn FieldRenderers;');
    FieldRenderers = evalRenderers(mockM, formatColumnLabel, api);

    // Load 05-rich-text-file-helpers.js for isAutoColumn
    const helpersSrc = fs.readFileSync(
      path.join(__dirname, '../../../plugins/admin-panel/client/parts/05-rich-text-file-helpers.js'),
      'utf8'
    );
    const evalHelpers = new Function('m', 'formatColumnLabel', 'api', helpersSrc + '\nreturn { isAutoColumn };');
    const { isAutoColumn } = evalHelpers(mockM, formatColumnLabel, api);

    // Load 09-record-form.js
    const formSrc = fs.readFileSync(
      path.join(__dirname, '../../../plugins/admin-panel/client/parts/09-record-form.js'),
      'utf8'
    );
    const evalForm = new Function(
      'm',
      'formatColumnLabel',
      'isRichTextEmpty',
      'isAutoColumn',
      'getFieldRenderer',
      'Layout',
      'api',
      'state',
      formSrc + '\nreturn { validateField, validateForm, RecordForm };'
    );
    const formExports = evalForm(
      mockM,
      formatColumnLabel,
      isRichTextEmpty,
      isAutoColumn,
      () => () => mockM('div'),
      () => mockM('div'),
      {},
      {}
    );
    validateField = formExports.validateField;
    validateForm = formExports.validateForm;
  });

  describe('validateField unit tests', () => {
    it('validates non-nullable required fields', () => {
      const col = { name: 'title', type: 'string', nullable: false };
      expect(validateField(col, '', {})).toContain('required');
      expect(validateField(col, null, {})).toContain('required');
      expect(validateField(col, undefined, {})).toContain('required');
      expect(validateField(col, '   ', {})).toContain('required');
      expect(validateField(col, 'Valid Title', {})).toBeNull();
    });

    it('allows empty values on nullable fields', () => {
      const col = { name: 'bio', type: 'string', nullable: true };
      expect(validateField(col, '', {})).toBeNull();
      expect(validateField(col, null, {})).toBeNull();
      expect(validateField(col, undefined, {})).toBeNull();
    });

    it('validates integer columns', () => {
      const col = { name: 'stock', type: 'integer', nullable: false };
      expect(validateField(col, 'abc', {})).toContain('must be an integer');
      expect(validateField(col, '12.34', {})).toContain('must be an integer');
      expect(validateField(col, 12, {})).toBeNull();
      expect(validateField(col, '42', {})).toBeNull();
    });

    it('validates float/decimal columns', () => {
      const col = { name: 'price', type: 'float', nullable: false };
      expect(validateField(col, 'invalid_num', {})).toContain('valid number');
      expect(validateField(col, 19.99, {})).toBeNull();
      expect(validateField(col, '49.95', {})).toBeNull();
    });

    it('validates JSON columns', () => {
      const col = { name: 'metadata', type: 'json', nullable: false };
      expect(validateField(col, '{ invalid json }', {})).toContain('valid JSON');
      expect(validateField(col, '{"key": "value"}', {})).toBeNull();
      expect(validateField(col, { key: 'value' }, {})).toBeNull();
    });

    it('validates minLength and maxLength constraints', () => {
      const col = {
        name: 'username',
        type: 'string',
        nullable: false,
        validations: { minLength: 3, maxLength: 10 },
      };
      expect(validateField(col, 'ab', {})).toContain('at least 3 characters');
      expect(validateField(col, 'abcdefghijk', {})).toContain('at most 10 characters');
      expect(validateField(col, 'johndoe', {})).toBeNull();
    });

    it('validates email format', () => {
      const col = {
        name: 'email',
        type: 'string',
        nullable: false,
        validations: { email: true },
      };
      expect(validateField(col, 'not-an-email', {})).toContain('valid email address');
      expect(validateField(col, 'user@domain', {})).toContain('valid email address');
      expect(validateField(col, 'user@domain.com', {})).toBeNull();
    });

    it('validates URL format', () => {
      const col = {
        name: 'website',
        type: 'string',
        nullable: true,
        validations: { url: true },
      };
      expect(validateField(col, 'not_a_url', {})).toContain('valid URL');
      expect(validateField(col, 'https://example.com', {})).toBeNull();
    });

    it('validates regex pattern', () => {
      const col = {
        name: 'sku',
        type: 'string',
        nullable: false,
        validations: { pattern: '^[A-Z]{3}-\\d{3}$' },
      };
      expect(validateField(col, 'abc-123', {})).toContain('invalid');
      expect(validateField(col, 'ABC-123', {})).toBeNull();
    });

    it('validates numeric min and max bounds', () => {
      const col = {
        name: 'age',
        type: 'integer',
        nullable: false,
        validations: { min: 18, max: 65 },
      };
      expect(validateField(col, 16, {})).toContain('at least 18');
      expect(validateField(col, 70, {})).toContain('at most 65');
      expect(validateField(col, 25, {})).toBeNull();
    });

    it('validates enum values', () => {
      const col = {
        name: 'status',
        type: 'enum',
        enumValues: ['draft', 'published', 'archived'],
        nullable: false,
      };
      expect(validateField(col, 'deleted', {})).toContain('must be one of');
      expect(validateField(col, 'published', {})).toBeNull();
    });

    it('supports customField.validate hook', () => {
      const col = {
        name: 'confirm_password',
        type: 'string',
        nullable: false,
        customField: {
          validate: (val, formData) => (val !== formData.password ? 'Passwords do not match' : null),
        },
      };
      expect(validateField(col, 'pass1', { password: 'pass2' })).toBe('Passwords do not match');
      expect(validateField(col, 'pass1', { password: 'pass1' })).toBeNull();
    });
  });

  describe('validateForm unit tests', () => {
    it('returns an object containing all invalid field messages', () => {
      const columns = [
        { name: 'id', primary: true, autoIncrement: true },
        { name: 'title', type: 'string', nullable: false },
        { name: 'email', type: 'string', nullable: false, validations: { email: true } },
        { name: 'price', type: 'float', nullable: false },
        { name: 'created_at', auto: 'create' },
      ];

      const formData = {
        title: '',
        email: 'invalid-email',
        price: 'not-a-number',
      };

      const errors = validateForm(columns, formData);
      expect(errors.title).toBeDefined();
      expect(errors.email).toBeDefined();
      expect(errors.price).toBeDefined();
      expect(errors.id).toBeUndefined();
      expect(errors.created_at).toBeUndefined();
    });

    it('returns empty object when all fields are valid', () => {
      const columns = [
        { name: 'name', type: 'string', nullable: false },
        { name: 'age', type: 'integer', nullable: true },
      ];

      const formData = {
        name: 'Alice',
        age: 30,
      };

      const errors = validateForm(columns, formData);
      expect(Object.keys(errors).length).toBe(0);
    });
  });

  describe('Inline Field Error rendering in FieldRenderers', () => {
    it('string renderer displays error styling and message when error is provided', () => {
      const col = { name: 'email', nullable: false };
      const vnode = FieldRenderers.string(col, 'bad', () => {}, false, 'Invalid email format');
      const input = vnode.children[1];
      const errorMsg = vnode.children[2];

      expect(input.attrs.class).toContain('border-red-500');
      expect(errorMsg.children).toContain('Invalid email format');
    });

    it('integer renderer displays error styling and message when error is provided', () => {
      const col = { name: 'count', nullable: false };
      const vnode = FieldRenderers.integer(col, 'bad', () => {}, false, 'Must be an integer');
      const input = vnode.children[1];
      const errorMsg = vnode.children[2];

      expect(input.attrs.class).toContain('border-red-500');
      expect(errorMsg.children).toContain('Must be an integer');
    });

    it('enum renderer displays error styling and message when error is provided', () => {
      const col = { name: 'status', enumValues: ['a', 'b'], nullable: false };
      const vnode = FieldRenderers.enum(col, 'invalid', () => {}, false, 'Invalid option');
      const select = vnode.children[1];
      const errorMsg = vnode.children[2];

      expect(select.attrs.class).toContain('border-red-500');
      expect(errorMsg.children).toContain('Invalid option');
    });
  });
});

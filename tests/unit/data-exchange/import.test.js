/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import ExcelJS from 'exceljs';
import {
  allowedImportColumns,
  buildPayloadForRow,
  parseCsvToRows,
  parseXlsxToRows,
  createMulter,
  createImportHandler,
} from '../../../plugins/data-exchange/import.js';

describe('data-exchange import unit tests', () => {
  describe('allowedImportColumns', () => {
    it('returns empty array when model has no columns or schema', () => {
      expect(allowedImportColumns({})).toEqual([]);
    });

    it('collects columns from model.columns and model.schema while excluding hidden', () => {
      const colsMap = new Map([
        ['id', {}],
        ['email', {}],
        ['password_hash', {}],
      ]);
      const model = {
        hidden: ['password_hash', 'secret_token'],
        columns: colsMap,
        schema: {
          shape: {
            email: {},
            username: {},
            secret_token: {},
          },
        },
      };

      const allowed = allowedImportColumns(model);
      expect(allowed.sort()).toEqual(['email', 'id', 'username'].sort());
      expect(allowed).not.toContain('password_hash');
      expect(allowed).not.toContain('secret_token');
    });
  });

  describe('buildPayloadForRow and cell coercion', () => {
    const columnsMap = new Map([
      ['id', { type: 'integer', autoIncrement: true }],
      ['name', { type: 'string' }],
      ['age', { type: 'integer' }],
      ['score', { type: 'float' }],
      ['is_active', { type: 'boolean' }],
      ['created_at', { type: 'datetime' }],
      ['metadata', { type: 'json' }],
      ['notes', {}], // no type
    ]);

    const model = {
      name: 'User',
      primaryKey: 'id',
      columns: columnsMap,
      hidden: ['secret'],
    };

    it('coerces various types correctly', () => {
      const rowData = {
        id: 123,
        name: '  Alice  ',
        age: '42',
        score: '98.5',
        is_active: 'yes',
        created_at: new Date('2026-01-01T00:00:00Z'),
        metadata: '{"role":"admin"}',
        notes: '123', // converts string number without meta
      };

      const payload = buildPayloadForRow(model, rowData, 'upsert');
      expect(payload).toEqual({
        id: 123,
        name: 'Alice',
        age: 42,
        score: 98.5,
        is_active: true,
        created_at: expect.any(Date),
        metadata: { role: 'admin' },
        notes: 123,
      });
    });

    it('removes auto-increment primary key in insert mode', () => {
      const rowData = {
        id: 999,
        name: 'Bob',
      };
      const payload = buildPayloadForRow(model, rowData, 'insert');
      expect(payload.id).toBeUndefined();
      expect(payload.name).toBe('Bob');
    });

    it('preserves non-autoincrement primary key in insert mode if specified', () => {
      const customModel = {
        name: 'Tag',
        primaryKey: 'code',
        columns: new Map([
          ['code', { type: 'string' }],
          ['label', { type: 'string' }],
        ]),
      };
      const payload = buildPayloadForRow(customModel, { code: 'VIP', label: 'Very Important' }, 'insert');
      expect(payload.code).toBe('VIP');
      expect(payload.label).toBe('Very Important');
    });

    it('throws on invalid integer', () => {
      expect(() => {
        buildPayloadForRow(model, { age: 'not-a-number' }, 'insert');
      }).toThrow('Invalid integer for age');
    });

    it('throws on invalid float', () => {
      expect(() => {
        buildPayloadForRow(model, { score: 'abc' }, 'insert');
      }).toThrow('Invalid number for score');
    });

    it('throws on invalid boolean', () => {
      expect(() => {
        buildPayloadForRow(model, { is_active: 'maybe' }, 'insert');
      }).toThrow('Invalid boolean for is_active');
    });

    it('throws on invalid date', () => {
      expect(() => {
        buildPayloadForRow(model, { created_at: 'not-a-date' }, 'insert');
      }).toThrow('Invalid date for created_at');
    });

    it('throws on invalid JSON', () => {
      expect(() => {
        buildPayloadForRow(model, { metadata: '{invalid json' }, 'insert');
      }).toThrow('Invalid JSON for metadata');
    });

    it('handles boolean variants (true/false/1/0/yes/no)', () => {
      expect(buildPayloadForRow(model, { is_active: '1' }, 'insert').is_active).toBe(true);
      expect(buildPayloadForRow(model, { is_active: '0' }, 'insert').is_active).toBe(false);
      expect(buildPayloadForRow(model, { is_active: 'no' }, 'insert').is_active).toBe(false);
      expect(buildPayloadForRow(model, { is_active: false }, 'insert').is_active).toBe(false);
    });

    it('skips empty, null, undefined, or NaN cells', () => {
      const payload = buildPayloadForRow(
        model,
        {
          name: '',
          age: null,
          score: NaN,
          is_active: undefined,
        },
        'insert'
      );
      expect(payload).toEqual({});
    });
  });

  describe('parseCsvToRows', () => {
    it('returns empty array for empty buffer', () => {
      const rows = parseCsvToRows(Buffer.from(''));
      expect(rows).toEqual([]);
    });

    it('parses valid CSV buffer', () => {
      const csv = 'name,age\nAlice,30\nBob,25\n';
      const rows = parseCsvToRows(Buffer.from(csv));
      expect(rows).toEqual([
        ['name', 'age'],
        ['Alice', '30'],
        ['Bob', '25'],
      ]);
    });
  });

  describe('parseXlsxToRows', () => {
    it('returns empty array for workbook with no worksheets', async () => {
      const wb = new ExcelJS.Workbook();
      const buffer = await wb.xlsx.writeBuffer();
      const rows = await parseXlsxToRows(Buffer.from(buffer));
      expect(rows).toEqual([]);
    });

    it('parses XLSX workbook and extracts various cell types', async () => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Sheet1');

      ws.addRow(['Name', 'Score', 'Rich', 'Link', 'Formula', 'Empty']);
      const row2 = ws.addRow([
        'Alice',
        100,
        { richText: [{ text: 'Hello ' }, { text: 'World' }] },
        { text: 'Site', hyperlink: 'https://example.com' },
        { formula: '1+1', result: 2 },
        null,
      ]);

      const buffer = await wb.xlsx.writeBuffer();
      const rows = await parseXlsxToRows(Buffer.from(buffer));

      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual(['Name', 'Score', 'Rich', 'Link', 'Formula', 'Empty']);
      expect(rows[1][0]).toBe('Alice');
      expect(rows[1][1]).toBe(100);
      expect(rows[1][2]).toBe('Hello World');
      expect(rows[1][3]).toBe('Site');
      expect(rows[1][4]).toBe(2);
    });
  });

  describe('createMulter', () => {
    it('creates multer middleware with configured file limit', () => {
      const m = createMulter(1024 * 1024);
      expect(m).toBeDefined();
      expect(typeof m.single).toBe('function');
    });
  });

  describe('createImportHandler', () => {
    function createMockRes() {
      let resolveDone;
      const done = new Promise((resolve) => {
        resolveDone = resolve;
      });
      const res = {
        done,
        statusCode: 200,
        status: vi.fn((code) => {
          res.statusCode = code;
          return res;
        }),
        json: vi.fn((body) => {
          res.body = body;
          resolveDone(res);
          return res;
        }),
      };
      return res;
    }

    const testModel = {
      name: 'Item',
      primaryKey: 'id',
      admin: { enabled: true },
      hidden: ['secret'],
      columns: new Map([
        ['id', { type: 'integer', autoIncrement: true }],
        ['sku', { type: 'string' }],
        ['name', { type: 'string' }],
        ['secret', { type: 'string' }],
      ]),
    };

    it('returns 404 when model is not found or admin is disabled', async () => {
      const db = {
        getModel: vi.fn().mockReturnValue(null),
      };
      const handler = createImportHandler({ db, maxRows: 100, maxFileBytes: 1024 });

      const req = {
        params: { model: 'Unknown' },
        query: {},
        headers: {},
      };
      const res = createMockRes();

      handler(req, res);
      await res.done;
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.body.error).toContain('Model not found');
    });

    it('returns 400 when upsertKey is not a valid or allowed column', async () => {
      const db = {
        getModel: vi.fn().mockReturnValue(testModel),
      };
      const handler = createImportHandler({ db, maxRows: 100, maxFileBytes: 1024 });

      // Invalid column
      const req1 = {
        params: { model: 'Item' },
        query: { upsertKey: 'non_existent' },
        headers: {},
      };
      const res1 = createMockRes();
      handler(req1, res1);
      await res1.done;
      expect(res1.status).toHaveBeenCalledWith(400);
      expect(res1.body.error).toContain('is not a column');

      // Hidden column (not in allowedImportColumns)
      const req2 = {
        params: { model: 'Item' },
        query: { upsertKey: 'secret' },
        headers: {},
      };
      const res2 = createMockRes();
      handler(req2, res2);
      await res2.done;
      expect(res2.status).toHaveBeenCalledWith(400);
      expect(res2.body.error).toContain('is not a column');
    });

    it('returns 400 when file is missing', async () => {
      const db = {
        getModel: vi.fn().mockReturnValue(testModel),
      };
      const handler = createImportHandler({ db, maxRows: 100, maxFileBytes: 1024 });

      const req = {
        params: { model: 'Item' },
        query: { upsertKey: 'sku' },
        headers: {},
      };
      const res = createMockRes();
      handler(req, res);
      await res.done;
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.body.error).toContain('Missing file field');
    });

    it('returns 400 when spreadsheet is less than 2 rows (header + data)', async () => {
      const db = {
        getModel: vi.fn().mockReturnValue(testModel),
      };
      const handler = createImportHandler({ db, maxRows: 100, maxFileBytes: 1024 });

      const req = {
        params: { model: 'Item' },
        query: { upsertKey: 'sku' },
        headers: {},
        file: {
          originalname: 'items.csv',
          mimetype: 'text/csv',
          buffer: Buffer.from('sku,name\n'), // only header
        },
      };
      const res = createMockRes();
      handler(req, res);
      await res.done;
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.body.error).toContain('File must include a header row and at least one data row');
    });

    it('returns 400 when rows exceed maxRows limit', async () => {
      const db = {
        getModel: vi.fn().mockReturnValue(testModel),
      };
      const handler = createImportHandler({ db, maxRows: 1, maxFileBytes: 1024 });

      const req = {
        params: { model: 'Item' },
        query: { upsertKey: 'sku' },
        headers: {},
        file: {
          originalname: 'items.csv',
          mimetype: 'text/csv',
          buffer: Buffer.from('sku,name\nSKU1,Item 1\nSKU2,Item 2\n'),
        },
      };
      const res = createMockRes();
      handler(req, res);
      await res.done;
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.body.error).toContain('Too many data rows');
    });

    it('performs successful insert mode import', async () => {
      const mockCreate = vi.fn().mockResolvedValue({});
      const mockRepo = {
        create: mockCreate,
      };
      const db = {
        getModel: vi.fn().mockReturnValue(testModel),
        getRepository: vi.fn().mockReturnValue(mockRepo),
      };
      const handler = createImportHandler({ db, maxRows: 100, maxFileBytes: 1024 });

      const req = {
        params: { model: 'Item' },
        query: { mode: 'insert' },
        headers: {},
        file: {
          originalname: 'items.csv',
          mimetype: 'text/csv',
          buffer: Buffer.from('sku,name\nSKU1,Item 1\nSKU2,Item 2\n'),
        },
      };
      const res = createMockRes();
      handler(req, res);
      await res.done;

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        success: true,
        created: 2,
        updated: 0,
        failed: 0,
        errors: [],
      });
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(mockCreate).toHaveBeenCalledWith({ sku: 'SKU1', name: 'Item 1' });
      expect(mockCreate).toHaveBeenCalledWith({ sku: 'SKU2', name: 'Item 2' });
    });

    it('performs upsert mode updating existing records and creating new ones', async () => {
      const mockFindOne = vi.fn().mockImplementation(async ({ sku }) => {
        if (sku === 'SKU1') return { id: 10, sku: 'SKU1', name: 'Old Item 1' };
        return null;
      });
      const mockUpdate = vi.fn().mockResolvedValue({});
      const mockCreate = vi.fn().mockResolvedValue({});
      const mockRepo = {
        findOne: mockFindOne,
        update: mockUpdate,
        create: mockCreate,
      };
      const db = {
        getModel: vi.fn().mockReturnValue(testModel),
        getRepository: vi.fn().mockReturnValue(mockRepo),
      };
      const handler = createImportHandler({ db, maxRows: 100, maxFileBytes: 1024 });

      const req = {
        params: { model: 'Item' },
        query: { mode: 'upsert', upsertKey: 'sku' },
        headers: {},
        file: {
          originalname: 'items.csv',
          mimetype: 'text/csv',
          buffer: Buffer.from('sku,name\nSKU1,Item 1 Updated\nSKU2,Item 2 New\n'),
        },
      };
      const res = createMockRes();
      handler(req, res);
      await res.done;

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        success: true,
        created: 1,
        updated: 1,
        failed: 0,
        errors: [],
      });
      expect(mockUpdate).toHaveBeenCalledWith(10, { sku: 'SKU1', name: 'Item 1 Updated' });
      expect(mockCreate).toHaveBeenCalledWith({ sku: 'SKU2', name: 'Item 2 New' });
    });

    it('rolls back atomic import on error when atomic=true', async () => {
      const mockRepo = {
        create: vi.fn().mockImplementation(async ({ sku }) => {
          if (sku === 'SKU_FAIL') throw new Error('DB write error');
          return {};
        }),
      };
      const db = {
        getModel: vi.fn().mockReturnValue(testModel),
        getRepository: vi.fn().mockReturnValue(mockRepo),
        transaction: vi.fn(async (callback) => {
          const trxContext = { getRepository: () => mockRepo };
          await callback(trxContext);
        }),
      };
      const handler = createImportHandler({ db, maxRows: 100, maxFileBytes: 1024 });

      const req = {
        params: { model: 'Item' },
        query: { mode: 'insert', atomic: 'true' },
        headers: {},
        file: {
          originalname: 'items.csv',
          mimetype: 'text/csv',
          buffer: Buffer.from('sku,name\nSKU1,Item 1\nSKU_FAIL,Item 2\n'),
        },
      };
      const res = createMockRes();
      handler(req, res);
      await res.done;

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Atomic import rolled back');
    });

    it('handles row error in non-atomic import by tracking error and continuing', async () => {
      const mockRepo = {
        create: vi.fn().mockImplementation(async ({ sku }) => {
          if (sku === 'SKU_FAIL') throw new Error('DB write error');
          return {};
        }),
      };
      const db = {
        getModel: vi.fn().mockReturnValue(testModel),
        getRepository: vi.fn().mockReturnValue(mockRepo),
      };
      const handler = createImportHandler({ db, maxRows: 100, maxFileBytes: 1024 });

      const req = {
        params: { model: 'Item' },
        query: { mode: 'insert', atomic: 'false' },
        headers: {},
        file: {
          originalname: 'items.csv',
          mimetype: 'text/csv',
          buffer: Buffer.from('sku,name\nSKU1,Item 1\nSKU_FAIL,Item 2\n'),
        },
      };
      const res = createMockRes();
      handler(req, res);
      await res.done;

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.created).toBe(1);
      expect(res.body.failed).toBe(1);
      expect(res.body.errors).toHaveLength(1);
      expect(res.body.errors[0]).toEqual({ row: 3, message: 'DB write error' });
    });
  });
});

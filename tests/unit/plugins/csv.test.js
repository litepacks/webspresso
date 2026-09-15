import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PassThrough, Readable } from 'stream';
import {
  csv,
  csvPlugin,
  createCsvMiddleware,
  createCsvServices,
  CSV_MIME_TYPE,
  UTF8_BOM,
} from '../../../plugins/csv';

describe('CSV Plugin & Toolkit', () => {
  describe('Formula Sanitization & Field Escaping', () => {
    it('should sanitize dangerous formula injection prefixes', () => {
      expect(csv.sanitizeFormula('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
      expect(csv.sanitizeFormula('+12345')).toBe("'+12345");
      expect(csv.sanitizeFormula('-cmd|/C calc')).toBe("'-cmd|/C calc");
      expect(csv.sanitizeFormula('@SUM(1,2)')).toBe("'@SUM(1,2)");
      expect(csv.sanitizeFormula('\tTabbed')).toBe("'\tTabbed");
      expect(csv.sanitizeFormula('\rCarriage')).toBe("'\rCarriage");
      expect(csv.sanitizeFormula('Safe Text')).toBe('Safe Text');
      expect(csv.sanitizeFormula(12345)).toBe(12345);
      expect(csv.sanitizeFormula(null)).toBe(null);
    });

    it('should properly escape fields with commas, quotes, and newlines', () => {
      expect(csv.escapeCsvField('Hello, World')).toBe('"Hello, World"');
      expect(csv.escapeCsvField('Hello "Quotes"')).toBe('"Hello ""Quotes"""');
      expect(csv.escapeCsvField('Line 1\nLine 2')).toBe('"Line 1\nLine 2"');
      expect(csv.escapeCsvField(' Trailing or Leading ')).toBe('" Trailing or Leading "');
      expect(csv.escapeCsvField(100)).toBe('100');
      expect(csv.escapeCsvField(null)).toBe('');
      expect(csv.escapeCsvField(undefined)).toBe('');
    });
  });

  describe('csv.generate & csv.parse', () => {
    it('should generate a valid CSV buffer and parse it back with Turkish/Unicode characters', async () => {
      const rows = [
        { id: '1', name: 'Ahmet Çelik', city: 'İstanbul', score: '95.5' },
        { id: '2', name: 'Şule Öğretmen', city: 'İzmir', score: '88.0' },
        { id: '3', name: 'Ömer Güneş', city: 'Ankara', score: '92.3' },
      ];

      const buffer = csv.generate({
        rows,
        bom: true,
      });

      expect(Buffer.isBuffer(buffer)).toBe(true);
      // Verify UTF-8 BOM is present
      expect(buffer.toString('utf8').startsWith(UTF8_BOM)).toBe(true);

      const parsed = await csv.parse(buffer);
      expect(parsed.length).toBe(3);
      expect(parsed[0].id).toBe('1');
      expect(parsed[0].name).toBe('Ahmet Çelik');
      expect(parsed[0].city).toBe('İstanbul');
      expect(parsed[1].name).toBe('Şule Öğretmen');
      expect(parsed[2].name).toBe('Ömer Güneş');
    });

    it('should support custom delimiters (semicolon, tab, pipe) and auto-detect them on parse', async () => {
      const rows = [
        { code: 'A1', title: 'Product 1', price: '10' },
        { code: 'B2', title: 'Product 2', price: '20' },
      ];

      // Semicolon
      const semiCsv = csv.generate({ rows, delimiter: ';', asBuffer: false, bom: false });
      expect(semiCsv).toContain('code;title;price');
      const parsedSemi = await csv.parse(semiCsv);
      expect(parsedSemi.length).toBe(2);
      expect(parsedSemi[0].code).toBe('A1');
      expect(parsedSemi[1].title).toBe('Product 2');

      // Pipe
      const pipeCsv = csv.generate({ rows, delimiter: '|', asBuffer: false, bom: false });
      expect(pipeCsv).toContain('code|title|price');
      const parsedPipe = await csv.parse(pipeCsv);
      expect(parsedPipe.length).toBe(2);
      expect(parsedPipe[0].code).toBe('A1');
      expect(parsedPipe[1].title).toBe('Product 2');

      // Tab
      const tabCsv = csv.generate({ rows, delimiter: '\t', asBuffer: false, bom: false });
      const parsedTab = await csv.parse(tabCsv);
      expect(parsedTab.length).toBe(2);
      expect(parsedTab[0].code).toBe('A1');
    });

    it('should sanitize formula injection during CSV generation', async () => {
      const rows = [
        { id: '1', note: '=cmd|/C calc.exe!A0' },
        { id: '2', note: '+12345' },
      ];

      const buffer = csv.generate({ rows, sanitizeFormulas: true });
      const parsed = await csv.parse(buffer);

      expect(parsed[0].note).toBe("'=cmd|/C calc.exe!A0");
      expect(parsed[1].note).toBe("'+12345");
    });

    it('should support transformRow option in csv.parse', async () => {
      const rows = [{ val: '10' }, { val: '20' }];
      const buffer = csv.generate({ rows });

      const parsed = await csv.parse(buffer, {
        transformRow: (row, idx) => ({
          ...row,
          doubled: Number(row.val) * 2,
          index: idx,
        }),
      });

      expect(parsed[0].doubled).toBe(20);
      expect(parsed[0].index).toBe(0);
      expect(parsed[1].doubled).toBe(40);
      expect(parsed[1].index).toBe(1);
    });

    it('should parse Readable Stream input', async () => {
      const csvData = 'id,name\n101,John\n102,Jane\n';
      const stream = Readable.from([csvData]);

      const parsed = await csv.parse(stream);
      expect(parsed.length).toBe(2);
      expect(parsed[0].id).toBe('101');
      expect(parsed[0].name).toBe('John');
      expect(parsed[1].id).toBe('102');
      expect(parsed[1].name).toBe('Jane');
    });
  });

  describe('csv.fromModel ORM Exporter', () => {
    it('should export records from a mock ORM model repository', async () => {
      const mockRepo = {
        model: {
          name: 'User',
          hidden: ['passwordHash'],
          schema: {
            shape: {
              id: {},
              username: {},
              email: {},
              passwordHash: {},
            },
          },
        },
        find: async (filter) => [
          { id: 1, username: 'admin', email: 'admin@example.com', passwordHash: 'SECRET' },
          { id: 2, username: 'moderator', email: 'mod@example.com', passwordHash: 'SECRET2' },
        ],
      };

      const buffer = await csv.fromModel(mockRepo, { active: true });
      expect(Buffer.isBuffer(buffer)).toBe(true);

      const parsed = await csv.parse(buffer);
      expect(parsed.length).toBe(2);
      expect(parsed[0].id).toBe('1');
      expect(parsed[0].username).toBe('admin');
      expect(parsed[0].email).toBe('admin@example.com');
      // Hidden column passwordHash should NOT be present
      expect(parsed[0]).not.toHaveProperty('passwordHash');
    });

    it('should support query builder function in fromModel', async () => {
      const mockRepo = {
        model: { name: 'Customer' },
        query: () => ({
          where: () => ({
            orderBy: () => [{ id: '1', email: 'customer@test.com' }],
          }),
        }),
      };

      const buffer = await csv.fromModel(mockRepo, (qb) => qb.where().orderBy(), {
        columns: [{ header: 'Email Address', key: 'email' }],
      });

      const parsed = await csv.parse(buffer);
      expect(parsed[0]['Email Address']).toBe('customer@test.com');
    });
  });

  describe('createStreamWriter', () => {
    it('should stream large datasets chunk by chunk to a writable stream', async () => {
      const chunks = [];
      const pass = new PassThrough();
      pass.on('data', (c) => chunks.push(c));

      const writer = csv.createStreamWriter(pass, {
        columns: [
          { header: 'ID', key: 'id' },
          { header: 'Message', key: 'msg' },
        ],
      });

      writer.writeRow({ id: 1, msg: 'Streaming row 1' });
      writer.writeRow({ id: 2, msg: 'Streaming row 2' });
      writer.end();

      const fullBuffer = Buffer.concat(chunks);
      expect(fullBuffer.length).toBeGreaterThan(0);

      const parsed = await csv.parse(fullBuffer);
      expect(parsed.length).toBe(2);
      expect(parsed[0].ID).toBe('1');
      expect(parsed[0].Message).toBe('Streaming row 1');
      expect(parsed[1].ID).toBe('2');
      expect(parsed[1].Message).toBe('Streaming row 2');
    });
  });

  describe('Express Middleware & res.csv() Response Helper', () => {
    it('should decorate res.csv() and serve downloadable CSV attachment', async () => {
      const app = express();
      app.use(createCsvMiddleware());

      app.get('/export/users', (req, res) => {
        const users = [
          { name: 'John Doe', email: 'john@example.com' },
          { name: 'Ayşe Kaya', email: 'ayse@example.com' },
        ];
        return res.csv(users, 'users_list.csv');
      });

      const res = await request(app)
        .get('/export/users')
        .buffer()
        .parse((res, cb) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe(CSV_MIME_TYPE);
      expect(res.headers['content-disposition']).toContain('filename="users_list.csv"');

      const parsed = await csv.parse(res.body);
      expect(parsed.length).toBe(2);
      expect(parsed[0].name).toBe('John Doe');
      expect(parsed[1].name).toBe('Ayşe Kaya');
    });

    it('should auto-append .csv extension if omitted in res.csv()', async () => {
      const app = express();
      app.use(createCsvMiddleware());

      app.get('/export/test', (req, res) => {
        return res.csv([{ a: '1' }], 'report');
      });

      const res = await request(app).get('/export/test');
      expect(res.headers['content-disposition']).toContain('filename="report.csv"');
    });
  });

  describe('Built-in CSV Services', () => {
    const services = createCsvServices();

    it('should execute csv.generate and csv.parse services', async () => {
      const result = await services['csv.generate'].handler({
        rows: [
          { item: 'Widget', qty: 5 },
          { item: 'Gadget', qty: 12 },
        ],
      });

      expect(result).toHaveProperty('csv');
      expect(result).toHaveProperty('base64');
      expect(result).toHaveProperty('size');
      expect(result.mimeType).toBe(CSV_MIME_TYPE);

      const parseResult = await services['csv.parse'].handler({
        text: result.csv,
      });

      expect(parseResult.rowCount).toBe(2);
      expect(parseResult.data[0].item).toBe('Widget');
      expect(parseResult.data[0].qty).toBe('5');
      expect(parseResult.data[1].item).toBe('Gadget');
      expect(parseResult.data[1].qty).toBe('12');
    });

    it('should execute csv.exportModel service with mock db', async () => {
      const mockDb = {
        getRepository: (name) => ({
          model: {
            name,
            schema: { shape: { id: {}, title: {} } },
          },
          find: async () => [{ id: '1', title: 'Item 1' }],
        }),
      };

      const modelServices = createCsvServices({ db: mockDb });
      const result = await modelServices['csv.exportModel'].handler(
        { model: 'Product', filename: 'products.csv' },
        { db: mockDb }
      );

      expect(result.filename).toBe('products.csv');
      expect(result).toHaveProperty('csv');
      expect(result).toHaveProperty('base64');

      const parsed = await csv.parse(result.csv);
      expect(parsed.length).toBe(1);
      expect(parsed[0].title).toBe('Item 1');
    });
  });

  describe('Plugin lifecycle integration', () => {
    it('should register plugin on App and attach services & middleware', () => {
      const plugin = csvPlugin();
      expect(plugin.name).toBe('csv');

      const registeredServices = {};
      const middlewares = [];

      const fakeApp = {
        serviceRegistry: {
          has: (name) => false,
          register: (name, def) => {
            registeredServices[name] = def;
          },
        },
        use: (fn) => middlewares.push(fn),
      };

      const ctx = {
        app: fakeApp,
        middlewares: {},
      };

      plugin.register(ctx);

      expect(ctx.csv).toBeDefined();
      expect(fakeApp.csv).toBeDefined();
      expect(ctx.middlewares.csv).toBeDefined();
      expect(registeredServices).toHaveProperty('csv.generate');
      expect(registeredServices).toHaveProperty('csv.parse');
      expect(registeredServices).toHaveProperty('csv.exportModel');
    });
  });
});

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PassThrough } from 'stream';
import {
  xlsx,
  xlsxPlugin,
  createXlsxMiddleware,
  createXlsxServices,
  XLSX_MIME_TYPE,
} from '../../../plugins/xlsx';
import { createApp } from '../../../src/server';

describe('XLSX Plugin & Toolkit', () => {
  describe('Formula Sanitization & Helpers', () => {
    it('should sanitize dangerous formula injection prefixes', () => {
      expect(xlsx.sanitizeFormula('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
      expect(xlsx.sanitizeFormula('+12345')).toBe("'+12345");
      expect(xlsx.sanitizeFormula('-cmd|/C calc')).toBe("'-cmd|/C calc");
      expect(xlsx.sanitizeFormula('@SUM(1,2)')).toBe("'@SUM(1,2)");
      expect(xlsx.sanitizeFormula('\tTabbed')).toBe("'\tTabbed");
      expect(xlsx.sanitizeFormula('\rCarriage')).toBe("'\rCarriage");
      expect(xlsx.sanitizeFormula('Safe Text')).toBe('Safe Text');
      expect(xlsx.sanitizeFormula(12345)).toBe(12345);
      expect(xlsx.sanitizeFormula(null)).toBe(null);
    });

    it('should convert hex colors to ARGB', () => {
      expect(xlsx.hexToArgb('4F46E5')).toBe('FF4F46E5');
      expect(xlsx.hexToArgb('#4F46E5')).toBe('FF4F46E5');
      expect(xlsx.hexToArgb('#FFF')).toBe('FFFFFFFF');
      expect(xlsx.hexToArgb('FF00FF00')).toBe('FF00FF00');
      expect(xlsx.hexToArgb(null)).toBe('FF4F46E5');
    });
  });

  describe('xlsx.generate & xlsx.parse', () => {
    it('should generate a valid XLSX buffer and parse it back', async () => {
      const rows = [
        { id: 1, name: 'Alice', role: 'Admin', score: 95.5 },
        { id: 2, name: 'Bob', role: 'User', score: 82.0 },
        { id: 3, name: 'Charlie', role: 'Editor', score: 88.0 },
      ];

      const buffer = await xlsx.generate({
        title: 'User Report',
        rows,
      });

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);

      const parsed = await xlsx.parse(buffer);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(3);
      expect(parsed[0].id).toBe(1);
      expect(parsed[0].name).toBe('Alice');
      expect(parsed[0].role).toBe('Admin');
      expect(parsed[0].score).toBe(95.5);
    });

    it('should handle multi-sheet workbooks', async () => {
      const buffer = await xlsx.generate({
        sheets: [
          {
            name: 'Users',
            columns: [
              { header: 'User ID', key: 'id' },
              { header: 'Full Name', key: 'name' },
            ],
            rows: [
              { id: 101, name: 'John Doe' },
              { id: 102, name: 'Jane Smith' },
            ],
          },
          {
            name: 'Orders',
            columns: [
              { header: 'Order ID', key: 'orderId' },
              { header: 'Amount', key: 'amount' },
            ],
            rows: [
              { orderId: 'ORD-1', amount: 250 },
              { orderId: 'ORD-2', amount: 500 },
            ],
          },
        ],
      });

      const parsedAll = await xlsx.parse(buffer);
      expect(parsedAll).toHaveProperty('Users');
      expect(parsedAll).toHaveProperty('Orders');
      expect(parsedAll.Users.length).toBe(2);
      expect(parsedAll.Orders.length).toBe(2);
      expect(parsedAll.Users[0]['User ID']).toBe(101);
      expect(parsedAll.Orders[1].Amount).toBe(500);

      // Parse specific sheet by name
      const ordersSheet = await xlsx.parse(buffer, { sheet: 'Orders' });
      expect(Array.isArray(ordersSheet)).toBe(true);
      expect(ordersSheet.length).toBe(2);
      expect(ordersSheet[0]['Order ID']).toBe('ORD-1');
    });

    it('should sanitize formulas during generation by default', async () => {
      const rows = [
        { id: 1, comment: '=CMD|/C calc.exe!A0' },
        { id: 2, comment: '+12345' },
      ];

      const buffer = await xlsx.generate({ rows });
      const parsed = await xlsx.parse(buffer);

      expect(parsed[0].comment).toBe("'=CMD|/C calc.exe!A0");
      expect(parsed[1].comment).toBe("'+12345");
    });

    it('should support transformRow option in parse', async () => {
      const rows = [{ val: 10 }, { val: 20 }];
      const buffer = await xlsx.generate({ rows });

      const parsed = await xlsx.parse(buffer, {
        transformRow: (row, idx) => ({
          ...row,
          doubled: row.val * 2,
          index: idx,
        }),
      });

      expect(parsed[0].doubled).toBe(20);
      expect(parsed[0].index).toBe(0);
      expect(parsed[1].doubled).toBe(40);
      expect(parsed[1].index).toBe(1);
    });
  });

  describe('xlsx.fromModel ORM Exporter', () => {
    it('should export records directly from a mock ORM repository', async () => {
      const mockRepo = {
        model: {
          name: 'Product',
          hidden: ['secretCode'],
          schema: {
            shape: {
              id: {},
              title: {},
              price: {},
              secretCode: {},
            },
          },
        },
        find: async (filter) => [
          { id: 1, title: 'Laptop', price: 999.99, secretCode: 'SUPER_SECRET' },
          { id: 2, title: 'Mouse', price: 29.99, secretCode: 'SECRET_2' },
        ],
      };

      const buffer = await xlsx.fromModel(mockRepo, { category: 'electronics' });
      expect(Buffer.isBuffer(buffer)).toBe(true);

      const parsed = await xlsx.parse(buffer);
      expect(parsed.length).toBe(2);
      expect(parsed[0].Id).toBe(1);
      expect(parsed[0].Title).toBe('Laptop');
      expect(parsed[0].Price).toBe(999.99);
      // Hidden column should not be exported
      expect(parsed[0]).not.toHaveProperty('Secret Code');
    });

    it('should support query builder function in fromModel', async () => {
      const mockRepo = {
        model: { name: 'Customer' },
        query: () => ({
          where: () => ({
            orderBy: () => [
              { id: 1, email: 'test@example.com' },
            ],
          }),
        }),
      };

      const buffer = await xlsx.fromModel(mockRepo, (qb) => qb.where().orderBy(), {
        columns: [{ header: 'Email Address', key: 'email' }],
      });

      const parsed = await xlsx.parse(buffer);
      expect(parsed[0]['Email Address']).toBe('test@example.com');
    });
  });

  describe('createStreamWriter', () => {
    it('should stream large datasets to a writable stream', async () => {
      const chunks = [];
      const pass = new PassThrough();
      pass.on('data', (c) => chunks.push(c));

      const writer = xlsx.createStreamWriter(pass);
      const sheet = writer.addWorksheet('StreamingSheet');

      sheet.columns = [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Message', key: 'msg', width: 30 },
      ];

      sheet.addRow({ id: 1, msg: 'Streaming row 1' }).commit();
      sheet.addRow({ id: 2, msg: 'Streaming row 2' }).commit();
      sheet.commit();
      await writer.commit();

      const fullBuffer = Buffer.concat(chunks);
      expect(fullBuffer.length).toBeGreaterThan(0);

      const parsed = await xlsx.parse(fullBuffer);
      expect(parsed.length).toBe(2);
      expect(parsed[0].ID).toBe(1);
      expect(parsed[1].Message).toBe('Streaming row 2');
    });
  });

  describe('Express Middleware & res.xlsx() Response Helper', () => {
    it('should decorate res.xlsx() and serve downloadable spreadsheet', async () => {
      const app = express();
      app.use(createXlsxMiddleware());

      app.get('/export/users', (req, res) => {
        const users = [
          { name: 'John', email: 'john@example.com' },
          { name: 'Sarah', email: 'sarah@example.com' },
        ];
        return res.xlsx(users, 'users_list.xlsx');
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
      expect(res.headers['content-type']).toBe(XLSX_MIME_TYPE);
      expect(res.headers['content-disposition']).toContain('filename="users_list.xlsx"');

      const parsed = await xlsx.parse(res.body);
      expect(parsed.length).toBe(2);
      expect(parsed[0].name).toBe('John');
      expect(parsed[1].email).toBe('sarah@example.com');
    });

    it('should auto-append .xlsx extension if omitted in res.xlsx()', async () => {
      const app = express();
      app.use(createXlsxMiddleware());

      app.get('/export/test', (req, res) => {
        return res.xlsx([{ a: 1 }], 'report');
      });

      const res = await request(app).get('/export/test');
      expect(res.headers['content-disposition']).toContain('filename="report.xlsx"');
    });
  });

  describe('Built-in XLSX Services', () => {
    const services = createXlsxServices();

    it('should execute xlsx.generate service and return base64 output', async () => {
      const result = await services['xlsx.generate'].handler({
        title: 'Service Generated',
        sheets: {
          name: 'Items',
          rows: [
            { item: 'Widget', qty: 5 },
            { item: 'Gadget', qty: 12 },
          ],
        },
      });

      expect(result).toHaveProperty('base64');
      expect(result).toHaveProperty('size');
      expect(result.mimeType).toBe(XLSX_MIME_TYPE);

      // Verify parse service
      const parseResult = await services['xlsx.parse'].handler({
        base64: result.base64,
      });

      expect(parseResult.rowCount).toBe(2);
      expect(parseResult.data[0].item).toBe('Widget');
      expect(parseResult.data[1].qty).toBe(12);
    });

    it('should execute xlsx.exportModel service with mock db', async () => {
      const mockDb = {
        getRepository: (name) => ({
          model: {
            name,
            schema: { shape: { id: {}, title: {} } },
          },
          find: async () => [{ id: 1, title: 'Item 1' }],
        }),
      };

      const modelServices = createXlsxServices({ db: mockDb });
      const result = await modelServices['xlsx.exportModel'].handler(
        { model: 'Product', filename: 'products.xlsx' },
        { db: mockDb }
      );

      expect(result.filename).toBe('products.xlsx');
      expect(result).toHaveProperty('base64');

      const parsed = await xlsx.parse(Buffer.from(result.base64, 'base64'));
      expect(parsed.length).toBe(1);
      expect(parsed[0].Title).toBe('Item 1');
    });
  });

  describe('Plugin lifecycle integration', () => {
    it('should register plugin on App and attach services & middleware', () => {
      const plugin = xlsxPlugin();
      expect(plugin.name).toBe('xlsx');

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

      expect(ctx.xlsx).toBeDefined();
      expect(fakeApp.xlsx).toBeDefined();
      expect(ctx.middlewares.xlsx).toBeDefined();
      expect(registeredServices).toHaveProperty('xlsx.generate');
      expect(registeredServices).toHaveProperty('xlsx.parse');
      expect(registeredServices).toHaveProperty('xlsx.exportModel');
    });
  });
});

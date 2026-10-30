/**
 * Built-in Data Exchange & Spreadsheet Services
 * @module src/services/builtins/exchange
 */

'use strict';

const { z } = require('zod');
const { ValidationError, NotFoundError } = require('../../errors');
const { getModel } = require('../../orm/model');
const { buildXlsxBuffer, buildCsvBuffer } = require('../../../plugins/data-exchange/export');
const {
  parseCsvToRows,
  parseXlsxToRows,
  buildPayloadForRow,
  allowedImportColumns,
} = require('../../../plugins/data-exchange/import');
const { buildHeaderMapping, dataRowsToObjects } = require('../../../plugins/data-exchange/parse-table');
const {
  generateCsvTemplate,
  generateXlsxTemplate,
} = require('../../../plugins/data-exchange/template');
const {
  analyzeSpreadsheetPreview,
} = require('../../../plugins/data-exchange/preview');

/**
 * Convert base64 data to Buffer
 * @param {string} base64Str
 * @returns {Buffer}
 */
function parseBase64Buffer(base64Str) {
  const match = base64Str.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return Buffer.from(match[2], 'base64');
  }
  return Buffer.from(base64Str, 'base64');
}

/**
 * Create built-in exchange services map
 * @param {Object} [options]
 * @param {Object} [options.db]
 * @returns {Record<string, Object>}
 */
function createExchangeServices(options = {}) {
  const db = options.db || null;

  return {
    'exchange.template': {
      schema: z.object({
        model: z.string().min(1, 'Model name is required'),
        format: z.enum(['csv', 'xlsx']).default('csv'),
        mode: z.enum(['insert', 'upsert']).default('insert'),
        includeSampleRow: z.boolean().default(true),
      }),
      auth: 'admin',
      async handler(input, ctx) {
        const { model: modelName, format, mode, includeSampleRow } = input;
        const activeDb = ctx.db || db;
        if (!activeDb) {
          throw new Error('Database instance is required in context for exchange.template');
        }

        const model = activeDb.getModel ? activeDb.getModel(modelName) : getModel(modelName);
        if (!model) {
          throw new NotFoundError(`Model "${modelName}" not found`);
        }

        const safeName = String(model.name).replace(/[^\w.-]+/g, '_');

        if (format === 'xlsx') {
          const buffer = await generateXlsxTemplate(model, { mode, includeSampleRow });
          return {
            buffer,
            filename: `${safeName}_template.xlsx`,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            format: 'xlsx',
            model: modelName,
          };
        }

        const buffer = generateCsvTemplate(model, { mode, includeSampleRow });
        return {
          buffer,
          filename: `${safeName}_template.csv`,
          contentType: 'text/csv; charset=utf-8',
          format: 'csv',
          model: modelName,
        };
      },
    },

    'exchange.preview': {
      schema: z.object({
        model: z.string().min(1, 'Model name is required'),
        buffer: z.any().optional(),
        base64: z.string().optional(),
        csvText: z.string().optional(),
        maxPreviewRows: z.number().int().positive().default(10),
      }),
      auth: 'admin',
      async handler(input, ctx) {
        const { model: modelName, buffer: rawBuffer, base64, csvText, maxPreviewRows } = input;
        const activeDb = ctx.db || db;
        if (!activeDb) {
          throw new Error('Database instance is required in context for exchange.preview');
        }

        const model = activeDb.getModel ? activeDb.getModel(modelName) : getModel(modelName);
        if (!model) {
          throw new NotFoundError(`Model "${modelName}" not found`);
        }

        let buffer;
        let isCsv = false;

        if (csvText) {
          buffer = Buffer.from(csvText, 'utf8');
          isCsv = true;
        } else if (rawBuffer) {
          buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);
        } else if (base64) {
          buffer = parseBase64Buffer(base64);
        }

        if (!buffer || buffer.length === 0) {
          throw new ValidationError('Missing spreadsheet file content', [
            { field: 'buffer', message: 'Spreadsheet content is required' },
          ]);
        }

        let rows = [];
        if (isCsv) {
          rows = parseCsvToRows(buffer);
        } else {
          try {
            rows = await parseXlsxToRows(buffer);
          } catch (err) {
            try {
              rows = parseCsvToRows(buffer);
            } catch {
              throw new ValidationError(`Invalid spreadsheet format: ${err.message}`, [
                { field: 'buffer', message: 'Could not parse spreadsheet' },
              ]);
            }
          }
        }

        return analyzeSpreadsheetPreview(model, rows, maxPreviewRows);
      },
    },

    'exchange.export': {
      schema: z.object({
        model: z.string().min(1, 'Model name is required'),
        format: z.enum(['xlsx', 'csv']).default('xlsx'),
        columns: z.array(z.string()).optional(),
        ids: z.array(z.union([z.string(), z.number()])).optional(),
        where: z.record(z.any()).optional(),
        limit: z.number().int().positive().default(10000),
      }),
      auth: 'admin',
      async handler(input, ctx) {
        const { model: modelName, format, columns, ids, where, limit } = input;
        const activeDb = ctx.db || db;
        if (!activeDb) {
          throw new Error('Database instance is required in context for exchange.export');
        }

        const model = activeDb.getModel ? activeDb.getModel(modelName) : getModel(modelName);
        if (!model) {
          throw new NotFoundError(`Model "${modelName}" not found`);
        }

        const repo = activeDb.getRepository(modelName);
        let records = [];

        if (ids && ids.length > 0) {
          records = await repo.query().whereIn(model.primaryKey, ids).limit(limit).list();
        } else if (where && Object.keys(where).length > 0) {
          records = await repo.findAll(where, { limit });
        } else {
          records = await repo.query().limit(limit).list();
        }

        const safeName = String(model.name).replace(/[^\w.-]+/g, '_');

        if (format === 'csv') {
          const buffer = buildCsvBuffer(model, records, { columns });
          return {
            buffer,
            filename: `${safeName}_export.csv`,
            contentType: 'text/csv; charset=utf-8',
            rowCount: records.length,
            model: modelName,
            format: 'csv',
          };
        }

        const buffer = await buildXlsxBuffer(model, records, { columns });
        return {
          buffer,
          filename: `${safeName}_export.xlsx`,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          rowCount: records.length,
          model: modelName,
          format: 'xlsx',
        };
      },
    },

    'exchange.import': {
      schema: z.object({
        model: z.string().min(1, 'Model name is required'),
        buffer: z.any().optional(),
        base64: z.string().optional(),
        csvText: z.string().optional(),
        mode: z.enum(['insert', 'upsert']).default('insert'),
        upsertKey: z.string().optional(),
        columnMapping: z.record(z.string().nullable()).optional(),
        atomic: z.boolean().default(false),
      }),
      auth: 'admin',
      transaction: true,
      async handler(input, ctx) {
        const {
          model: modelName,
          buffer: rawBuffer,
          base64,
          csvText,
          mode,
          upsertKey: userUpsertKey,
          columnMapping,
          atomic: isAtomic,
        } = input;
        const activeDb = ctx.db || db;
        const trx = ctx.trx;
        if (!activeDb) {
          throw new Error('Database instance is required in context for exchange.import');
        }

        const model = activeDb.getModel ? activeDb.getModel(modelName) : getModel(modelName);
        if (!model) {
          throw new NotFoundError(`Model "${modelName}" not found`);
        }

        let buffer;
        let isCsv = false;

        if (csvText) {
          buffer = Buffer.from(csvText, 'utf8');
          isCsv = true;
        } else if (rawBuffer) {
          buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);
        } else if (base64) {
          buffer = parseBase64Buffer(base64);
        }

        if (!buffer || buffer.length === 0) {
          throw new ValidationError('Missing spreadsheet file content (buffer, base64, or csvText)', [
            { field: 'buffer', message: 'Spreadsheet content is required' },
          ]);
        }

        let rows = [];
        if (isCsv) {
          rows = parseCsvToRows(buffer);
        } else {
          try {
            rows = await parseXlsxToRows(buffer);
          } catch (err) {
            // Fallback to CSV parsing
            try {
              rows = parseCsvToRows(buffer);
            } catch (csvErr) {
              throw new ValidationError(`Invalid spreadsheet format: ${err.message}`, [
                { field: 'buffer', message: 'Could not parse Excel or CSV file' },
              ]);
            }
          }
        }

        if (rows.length < 2) {
          throw new ValidationError('File must include a header row and at least one data row', [
            { field: 'buffer', message: 'File is empty or missing data rows' },
          ]);
        }

        const isColumnAllowed = (col) => {
          if (model.columns && typeof model.columns.has === 'function' && model.columns.has(col)) return true;
          if (model.schema && model.schema.shape && col in model.schema.shape) return true;
          return false;
        };

        let upsertKey = String(userUpsertKey || model.primaryKey);
        if (!isColumnAllowed(upsertKey)) {
          throw new ValidationError(`upsertKey "${upsertKey}" is not a column on model ${modelName}`);
        }

        const allowedKeys = model.columns && model.columns.size
          ? allowedImportColumns(model)
          : Object.keys(model.schema?.shape || {}).filter(c => !model.hidden?.includes(c));

        let headerMapping;
        if (columnMapping && typeof columnMapping === 'object') {
          headerMapping = {};
          const fileHeaders = rows[0].map(h => String(h || '').trim());
          for (let idx = 0; idx < fileHeaders.length; idx++) {
            const h = fileHeaders[idx];
            const targetCol = columnMapping[h];
            if (targetCol && allowedKeys.includes(targetCol)) {
              headerMapping[idx] = targetCol;
            }
          }
        } else {
          headerMapping = buildHeaderMapping(rows[0], allowedKeys);
        }

        const objects = dataRowsToObjects(rows, headerMapping);

        const repo = activeDb.getRepository(modelName);
        const summary = {
          success: true,
          created: 0,
          updated: 0,
          failed: 0,
          totalRows: objects.length,
          errors: [],
        };

        for (const item of objects) {
          const { rowNumber, data } = item;
          let payload;
          try {
            payload = buildPayloadForRow(model, data, mode);
          } catch (e) {
            summary.failed++;
            summary.errors.push({
              row: rowNumber,
              column: e.column || null,
              value: e.value !== undefined ? e.value : null,
              message: e.message || String(e),
            });
            if (isAtomic) throw e;
            continue;
          }

          try {
            if (mode === 'insert') {
              await repo.create(payload, { trx });
              summary.created++;
              continue;
            }

            // Upsert mode
            const keyVal = payload[upsertKey];
            if (keyVal === undefined || keyVal === null || keyVal === '') {
              const insertPayload = { ...payload };
              delete insertPayload[upsertKey];
              await repo.create(insertPayload, { trx });
              summary.created++;
              continue;
            }

            const existing = await repo.findOne({ [upsertKey]: keyVal }, { trx });
            if (existing) {
              const id = existing[model.primaryKey];
              await repo.update(id, payload, { trx });
              summary.updated++;
            } else {
              await repo.create({ ...payload, [upsertKey]: keyVal }, { trx });
              summary.created++;
            }
          } catch (e) {
            summary.failed++;
            summary.errors.push({
              row: rowNumber,
              column: e.column || null,
              value: e.value !== undefined ? e.value : null,
              message: e.message || String(e),
            });
            if (isAtomic) throw e;
          }
        }

        summary.success = summary.failed === 0;
        return summary;
      },
    },
  };
}

module.exports = {
  createExchangeServices,
};

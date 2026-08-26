/**
 * Built-in Data Exchange & Spreadsheet Services
 * @module src/services/builtins/exchange
 */

const { z } = require('zod');
const { ValidationError, NotFoundError } = require('../../../core/errors');
const { getModel } = require('../../../core/orm/model');
const { buildXlsxBuffer } = require('../../../plugins/data-exchange/export-xlsx');
const {
  parseCsvToRows,
  parseXlsxToRows,
  buildPayloadForRow,
  allowedImportColumns,
} = require('../../../plugins/data-exchange/import');
const { buildHeaderMapping, dataRowsToObjects } = require('../../../plugins/data-exchange/parse-table');

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
    'exchange.export': {
      schema: z.object({
        model: z.string().min(1, 'Model name is required'),
        ids: z.array(z.union([z.string(), z.number()])).optional(),
        where: z.record(z.any()).optional(),
        limit: z.number().int().positive().default(10000),
      }),
      auth: 'admin',
      async handler(input, ctx) {
        const { model: modelName, ids, where, limit } = input;
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

        const buffer = await buildXlsxBuffer(model, records);
        const safeName = String(model.name).replace(/[^\w.-]+/g, '_');

        return {
          buffer,
          filename: `${safeName}_export.xlsx`,
          rowCount: records.length,
          model: modelName,
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
      }),
      auth: 'admin',
      transaction: true,
      async handler(input, ctx) {
        const { model: modelName, buffer: rawBuffer, base64, csvText, mode, upsertKey: userUpsertKey } = input;
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
        const headerMapping = buildHeaderMapping(rows[0], allowedKeys);
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
            summary.errors.push({ row: rowNumber, message: e.message || String(e) });
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
            summary.errors.push({ row: rowNumber, message: e.message || String(e) });
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

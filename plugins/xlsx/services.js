'use strict';

/**
 * Built-in XLSX Services
 * Exposed via ctx.service('xlsx.*') and req.service('xlsx.*')
 * @module plugins/xlsx/services
 */

const { z } = require('zod');
const { generate, parse, fromModel } = require('./engine');

/**
 * Creates built-in services for the XLSX plugin
 * @param {Object} [options]
 * @param {Object} [options.db]
 * @returns {Object.<string, Object>}
 */
function createXlsxServices(options = {}) {
  return {
    'xlsx.generate': {
      schema: z.object({
        sheets: z.array(
          z.object({
            name: z.string().optional(),
            columns: z.array(z.object({ header: z.string(), key: z.string(), width: z.number().optional() })).optional(),
            rows: z.array(z.record(z.any())),
          })
        ).or(z.object({
          name: z.string().optional(),
          columns: z.array(z.object({ header: z.string(), key: z.string(), width: z.number().optional() })).optional(),
          rows: z.array(z.record(z.any())),
        })),
        creator: z.string().optional(),
        title: z.string().optional(),
      }),
      handler: async (input) => {
        const buffer = await generate(input);
        return {
          base64: buffer.toString('base64'),
          size: buffer.length,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        };
      },
    },

    'xlsx.parse': {
      schema: z.object({
        base64: z.string().optional(),
        sheet: z.union([z.string(), z.number()]).optional(),
        headerRow: z.number().optional(),
      }),
      handler: async (input) => {
        if (!input.base64 && !input.buffer) {
          throw new Error('xlsx.parse requires base64 string or buffer');
        }
        const buffer = input.buffer || Buffer.from(input.base64, 'base64');
        const data = await parse(buffer, {
          sheet: input.sheet,
          headerRow: input.headerRow,
        });

        const rowCount = Array.isArray(data)
          ? data.length
          : Object.values(data).reduce((acc, sheetRows) => acc + sheetRows.length, 0);

        return {
          data,
          rowCount,
        };
      },
    },

    'xlsx.exportModel': {
      schema: z.object({
        model: z.string().min(1),
        filter: z.record(z.any()).optional().default({}),
        columns: z.array(z.string()).optional(),
        filename: z.string().optional(),
      }),
      handler: async (input, ctx) => {
        const db = ctx.db || options.db;
        if (!db || typeof db.getRepository !== 'function') {
          throw new Error('xlsx.exportModel requires an active database connection');
        }

        const repo = db.getRepository(input.model);
        if (!repo) {
          throw new Error(`Model repository "${input.model}" not found`);
        }

        let customColumns;
        if (input.columns) {
          customColumns = input.columns.map((c) => ({
            header: c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, ' '),
            key: c,
          }));
        }

        const buffer = await fromModel(repo, input.filter, {
          columns: customColumns,
          title: `${input.model} Export`,
        });

        const filename = input.filename || `${input.model.toLowerCase()}_export.xlsx`;

        return {
          filename: filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`,
          base64: buffer.toString('base64'),
          size: buffer.length,
        };
      },
    },
  };
}

module.exports = {
  createXlsxServices,
};

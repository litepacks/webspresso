'use strict';

/**
 * Built-in CSV Services
 * Exposed via ctx.service('csv.*') and req.service('csv.*')
 * @module plugins/csv/services
 */

const { z } = require('zod');
const { generate, parse, fromModel, CSV_MIME_TYPE } = require('./engine');

/**
 * Creates built-in services for the CSV plugin
 * @param {Object} [options]
 * @param {Object} [options.db]
 * @returns {Object.<string, Object>}
 */
function createCsvServices(options = {}) {
  return {
    'csv.generate': {
      schema: z.object({
        rows: z.array(z.record(z.any())).optional(),
        data: z.array(z.record(z.any())).optional(),
        columns: z
          .array(
            z.union([
              z.string(),
              z.object({
                header: z.string().optional(),
                key: z.string(),
              }),
            ])
          )
          .optional(),
        delimiter: z.string().optional().default(','),
        eol: z.string().optional().default('\r\n'),
        header: z.boolean().optional().default(true),
        bom: z.boolean().optional().default(true),
        sanitizeFormulas: z.boolean().optional().default(true),
      }),
      handler: async (input) => {
        const buffer = generate(input);
        const csvString = buffer.toString('utf8');
        return {
          csv: csvString,
          base64: buffer.toString('base64'),
          size: buffer.length,
          mimeType: CSV_MIME_TYPE,
        };
      },
    },

    'csv.parse': {
      schema: z.object({
        text: z.string().optional(),
        base64: z.string().optional(),
        delimiter: z.string().optional(),
        columns: z.union([z.boolean(), z.array(z.string())]).optional().default(true),
        skip_empty_lines: z.boolean().optional().default(true),
        trim: z.boolean().optional().default(true),
      }),
      handler: async (input) => {
        let target;
        if (input.text !== undefined) {
          target = input.text;
        } else if (input.base64) {
          target = Buffer.from(input.base64, 'base64');
        } else if (input.buffer) {
          target = input.buffer;
        } else {
          throw new Error('csv.parse requires text, base64, or buffer');
        }

        const data = await parse(target, {
          delimiter: input.delimiter,
          columns: input.columns,
          skip_empty_lines: input.skip_empty_lines,
          trim: input.trim,
        });

        return {
          data,
          rowCount: data.length,
        };
      },
    },

    'csv.exportModel': {
      schema: z.object({
        model: z.string().min(1),
        filter: z.record(z.any()).optional().default({}),
        columns: z.array(z.string()).optional(),
        filename: z.string().optional(),
        delimiter: z.string().optional().default(','),
        bom: z.boolean().optional().default(true),
      }),
      handler: async (input, ctx) => {
        const db = ctx.db || options.db;
        if (!db || typeof db.getRepository !== 'function') {
          throw new Error('csv.exportModel requires an active database connection');
        }

        const repo = db.getRepository(input.model);
        if (!repo) {
          throw new Error(`Model repository "${input.model}" not found`);
        }

        let customColumns;
        if (input.columns) {
          customColumns = input.columns.map((c) => ({
            header: c,
            key: c,
          }));
        }

        const buffer = await fromModel(repo, input.filter, {
          columns: customColumns,
          delimiter: input.delimiter,
          bom: input.bom,
        });

        const filename = input.filename || `${input.model.toLowerCase()}_export.csv`;

        return {
          filename: filename.endsWith('.csv') ? filename : `${filename}.csv`,
          csv: buffer.toString('utf8'),
          base64: buffer.toString('base64'),
          size: buffer.length,
          mimeType: CSV_MIME_TYPE,
        };
      },
    },
  };
}

module.exports = {
  createCsvServices,
};

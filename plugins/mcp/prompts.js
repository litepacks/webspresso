/**
 * Webspresso MCP Built-in Prompt Templates
 * Provides standard LLM prompt templates following Webspresso architectural guidelines.
 * @module plugins/mcp/prompts
 */

/**
 * Generates built-in prompt definitions
 * @returns {Array<Object>}
 */
function createBuiltinPrompts() {
  return [
    {
      name: 'scaffold_service',
      description: 'Generates a Webspresso service file adhering to strict architecture guidelines.',
      arguments: [
        {
          name: 'serviceName',
          description: 'Dot-notation service name (e.g. "order.cancel" or "user.invite")',
          required: true,
        },
        {
          name: 'description',
          description: 'Brief description of what the service does',
          required: false,
        },
      ],
      handler: async ({ serviceName, description = '' }) => {
        const parts = serviceName.split('.');
        const domain = parts.slice(0, -1).join('/');
        const action = parts[parts.length - 1];
        const filePath = `services/${domain ? `${domain}/` : ''}${action}.js`;

        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Please generate a Webspresso service file for "${serviceName}" at path "${filePath}".
Description: ${description || 'N/A'}

Follow Webspresso rules:
- Export an object with { schema, auth, timeout, transaction, handler }.
- Use Zod (const { z } = require('zod');) for schema validation.
- Set transaction: true if multi-step mutation.
- Use req.db / ctx.db.getRepository('ModelName') to access data. NEVER write raw knex table queries.
- Throw semantic errors: NotFoundError, ValidationError, UnauthorizedError, ForbiddenError.
- Do NOT use controllers.`,
              },
            },
          ],
        };
      },
    },
    {
      name: 'scaffold_model',
      description: 'Generates an ORM model file using defineModel and zdb schema builder.',
      arguments: [
        {
          name: 'modelName',
          description: 'PascalCase model name (e.g. "Product", "Invoice")',
          required: true,
        },
        {
          name: 'tableName',
          description: 'Database table name (e.g. "products", "invoices")',
          required: false,
        },
      ],
      handler: async ({ modelName, tableName }) => {
        const table = tableName || `${modelName.toLowerCase()}s`;
        const filePath = `models/${modelName.toLowerCase()}.js`;

        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Please generate a Webspresso ORM model for "${modelName}" (table: "${table}") at path "${filePath}".

Follow Webspresso rules:
- Use const { defineModel, zdb } = require('webspresso');
- Use defineModel({ name, table, schema, relations, scopes, hidden, admin }).
- Build schema with zdb: zdb.id(), zdb.string(), zdb.integer(), zdb.boolean(), zdb.json(), zdb.dateTime().
- Define relations if relevant (hasMany, belongsTo).
- Enable admin: { enabled: true, icon: '...' } if appropriate.`,
              },
            },
          ],
        };
      },
    },
    {
      name: 'scaffold_api',
      description: 'Generates a file-based API route module inside pages/api/...',
      arguments: [
        {
          name: 'endpoint',
          description: 'API endpoint route (e.g. "/api/notes" or "/api/notes/[id]")',
          required: true,
        },
        {
          name: 'method',
          description: 'HTTP method (GET, POST, PUT, PATCH, DELETE)',
          required: true,
        },
      ],
      handler: async ({ endpoint, method }) => {
        const m = method.toLowerCase();
        let relativePath = endpoint.replace(/^\/api\//, '');
        const filePath = `pages/api/${relativePath}.${m}.js`;

        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Please generate a Webspresso API route file at "${filePath}".
Endpoint: ${method.toUpperCase()} ${endpoint}

Follow Webspresso rules:
- 100% File-Based Routing: NEVER create a routes/ folder or use express.Router().
- Standard API Route Module Contract:
  module.exports = {
    schema: ({ z }) => ({
      body: z.object({...}),
      params: z.object({...}),
    }),
    middleware: [],
    handler: async (req, res) => {
      // req.db and req.service are injected
      // req.input contains validated { body, query, params }
    }
  };`,
              },
            },
          ],
        };
      },
    },
  ];
}

module.exports = {
  createBuiltinPrompts,
};

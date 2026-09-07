/**
 * Webspresso MCP Services Provider
 * Bridges Webspresso ServiceRegistry to MCP Tools with automatic Zod -> JSON Schema conversion.
 * @module plugins/mcp/providers/services
 */

const { zodToJsonSchema } = require('zod-to-json-schema');

/**
 * Normalizes a dot-separated service name to an MCP-safe tool name
 * e.g. "user.create" -> "service__user__create"
 * @param {string} serviceName
 * @returns {string}
 */
function serviceNameToToolName(serviceName) {
  return `service__${serviceName.replace(/\./g, '__').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/**
 * Reconstructs original service name from tool name
 * @param {string} toolName
 * @returns {string|null}
 */
function toolNameToServiceName(toolName) {
  if (!toolName.startsWith('service__')) return null;
  return toolName.slice('service__'.length).replace(/__/g, '.');
}

/**
 * Check if a service name matches any pattern in a list (e.g. ['user.*', 'order.get'])
 * @param {string} name
 * @param {Array<string>} patterns
 * @returns {boolean}
 */
function matchesPattern(name, patterns) {
  if (!patterns || patterns.length === 0) return true;
  return patterns.some((pattern) => {
    if (pattern === '*' || pattern === name) return true;
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return name.startsWith(prefix);
    }
    return false;
  });
}

/**
 * Checks if a service is likely a mutation (create, update, delete, remove, post, send, prune, etc.)
 * @param {string} serviceName
 * @param {Object} [serviceDef]
 * @returns {boolean}
 */
function isMutationService(serviceName, serviceDef) {
  if (serviceDef?.mutation !== undefined) {
    return Boolean(serviceDef.mutation);
  }
  const parts = serviceName.toLowerCase().split('.');
  const lastPart = parts[parts.length - 1];
  const mutationKeywords = [
    'create',
    'add',
    'insert',
    'update',
    'patch',
    'edit',
    'delete',
    'remove',
    'destroy',
    'prune',
    'reset',
    'send',
    'dispatch',
    'cancel',
    'pay',
    'checkout',
    'execute',
    'import',
    'clear',
    'flush',
    'purge',
    'drop',
    'truncate',
  ];
  return mutationKeywords.some((kw) => lastPart.includes(kw));
}

/**
 * Converts a Webspresso Zod schema to a clean MCP inputSchema
 * @param {import('zod').ZodTypeAny} schema
 * @returns {Object}
 */
function convertZodToInputSchema(schema) {
  if (!schema) {
    return {
      type: 'object',
      properties: {},
      additionalProperties: true,
    };
  }

  try {
    const rawSchema = zodToJsonSchema(schema, {
      $refStrategy: 'none',
      removeAdditionalStrategy: 'strict',
    });

    // Clean up definition wrapper if present
    if (rawSchema && typeof rawSchema === 'object') {
      const { $schema, ...clean } = rawSchema;
      if (!clean.type) {
        clean.type = 'object';
      }
      return clean;
    }
    return { type: 'object', properties: {} };
  } catch (err) {
    return {
      type: 'object',
      properties: {},
      description: `Input schema auto-conversion error: ${err.message}`,
    };
  }
}

/**
 * Generates MCP tool definitions from a Webspresso ServiceRegistry
 * @param {Object} options
 * @param {import('../../src/services').ServiceRegistry} options.registry
 * @param {Array<string>} [options.include] - Whitelist of service patterns
 * @param {Array<string>} [options.exclude] - Blacklist of service patterns
 * @param {boolean} [options.readOnly=false] - When true, filters out mutation services
 * @param {string|Array<string>} [options.role] - Simulated user role for auth
 * @returns {Array<Object>}
 */
function createServiceTools(options = {}) {
  const { registry, include, exclude, readOnly = false, role = 'admin' } = options;
  if (!registry) return [];

  const tools = [];
  const serviceNames = registry.list();

  for (const name of serviceNames) {
    // Check include / exclude patterns
    if (include && !matchesPattern(name, include)) continue;
    if (exclude && matchesPattern(name, exclude)) continue;

    const def = registry.get(name);
    if (!def) continue;

    const isMutation = isMutationService(name, def);
    if (readOnly && isMutation) {
      continue;
    }

    const toolName = serviceNameToToolName(name);
    const inputSchema = convertZodToInputSchema(def.schema);

    const description =
      def.description ||
      def.metadata?.description ||
      `Executes Webspresso service '${name}'.${isMutation ? ' (Mutation)' : ' (Query)'}`;

    tools.push({
      name: toolName,
      description,
      inputSchema,
      handler: async (args, ctx) => {
        // Execute service via registry
        const execCtx = {
          ...ctx,
          user: ctx.user || (role ? { id: 'mcp-agent', role } : null),
        };

        const result = await registry.execute(name, args, execCtx);
        return result;
      },
    });
  }

  return tools;
}

module.exports = {
  createServiceTools,
  serviceNameToToolName,
  toolNameToServiceName,
  convertZodToInputSchema,
  isMutationService,
  matchesPattern,
};

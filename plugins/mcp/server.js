/**
 * Webspresso MCP Server Engine
 * Implements Model Context Protocol (MCP) specification version 2024-11-05
 * Pure Node.js JSON-RPC 2.0 router with tools, resources, and prompts registry.
 * @module plugins/mcp/server
 */

const EventEmitter = require('events');

const PROTOCOL_VERSION = '2024-11-05';

// Standard JSON-RPC 2.0 error codes
const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

/**
 * Creates a standard JSON-RPC 2.0 success response
 * @param {string|number|null} id
 * @param {*} result
 * @returns {Object}
 */
function createJsonRpcResponse(id, result) {
  return {
    jsonrpc: '2.0',
    id: id !== undefined ? id : null,
    result,
  };
}

/**
 * Creates a standard JSON-RPC 2.0 error response
 * @param {string|number|null} id
 * @param {number} code
 * @param {string} message
 * @param {*} [data]
 * @returns {Object}
 */
function createJsonRpcError(id, code, message, data) {
  const errorObj = { code, message };
  if (data !== undefined) {
    errorObj.data = data;
  }
  return {
    jsonrpc: '2.0',
    id: id !== undefined ? id : null,
    error: errorObj,
  };
}

class McpServer extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {string} [options.name='webspresso-mcp']
   * @param {string} [options.version='1.0.0']
   * @param {string} [options.instructions]
   * @param {Object} [options.context]
   */
  constructor(options = {}) {
    super();
    this.name = options.name || 'webspresso-mcp';
    this.version = options.version || '1.0.0';
    this.instructions =
      options.instructions ||
      'Webspresso Model Context Protocol server exposing services, ORM models, and system capabilities.';
    this.context = options.context || {};

    // Registries
    this.tools = new Map();
    this.resources = new Map();
    this.resourceTemplates = [];
    this.prompts = new Map();

    // Client session info after initialize
    this.clientInfo = null;
    this.isInitialized = false;
  }

  /**
   * Register an MCP tool
   * @param {Object} toolDef
   * @param {string} toolDef.name
   * @param {string} [toolDef.description]
   * @param {Object} [toolDef.inputSchema] - JSON Schema object
   * @param {function(Object, Object): Promise<*>|*} toolDef.handler
   * @returns {this}
   */
  registerTool(toolDef) {
    if (!toolDef || !toolDef.name) {
      throw new Error('Tool must have a name');
    }
    if (typeof toolDef.handler !== 'function') {
      throw new Error(`Tool "${toolDef.name}" must have a handler function`);
    }

    this.tools.set(toolDef.name, {
      name: toolDef.name,
      description: toolDef.description || '',
      inputSchema: toolDef.inputSchema || {
        type: 'object',
        properties: {},
        additionalProperties: true,
      },
      handler: toolDef.handler,
    });
    return this;
  }

  /**
   * Register multiple tools
   * @param {Array<Object>} toolDefs
   * @returns {this}
   */
  registerTools(toolDefs = []) {
    for (const tool of toolDefs) {
      this.registerTool(tool);
    }
    return this;
  }

  /**
   * Remove a registered tool
   * @param {string} name
   * @returns {boolean}
   */
  unregisterTool(name) {
    return this.tools.delete(name);
  }

  /**
   * Register an MCP resource
   * @param {Object} resourceDef
   * @param {string} resourceDef.uri
   * @param {string} [resourceDef.name]
   * @param {string} [resourceDef.description]
   * @param {string} [resourceDef.mimeType='application/json']
   * @param {function(string, Object): Promise<*>|*} resourceDef.handler
   * @returns {this}
   */
  registerResource(resourceDef) {
    if (!resourceDef || !resourceDef.uri) {
      throw new Error('Resource must have a uri');
    }
    if (typeof resourceDef.handler !== 'function') {
      throw new Error(`Resource "${resourceDef.uri}" must have a handler function`);
    }

    this.resources.set(resourceDef.uri, {
      uri: resourceDef.uri,
      name: resourceDef.name || resourceDef.uri,
      description: resourceDef.description || '',
      mimeType: resourceDef.mimeType || 'application/json',
      handler: resourceDef.handler,
    });
    return this;
  }

  /**
   * Register a parameterized resource template
   * @param {Object} templateDef
   * @param {string} templateDef.uriTemplate - e.g. "webspresso://models/{model}"
   * @param {string} [templateDef.name]
   * @param {string} [templateDef.description]
   * @param {string} [templateDef.mimeType='application/json']
   * @param {function(string, Object, Object): Promise<*>|*} templateDef.handler - (uri, params, ctx)
   * @returns {this}
   */
  registerResourceTemplate(templateDef) {
    if (!templateDef || !templateDef.uriTemplate) {
      throw new Error('Resource template must have a uriTemplate');
    }
    if (typeof templateDef.handler !== 'function') {
      throw new Error(`Resource template "${templateDef.uriTemplate}" must have a handler function`);
    }

    // Convert uriTemplate to regex for matching
    const paramNames = [];
    const patternStr = templateDef.uriTemplate.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    const regex = new RegExp(`^${patternStr}$`);

    this.resourceTemplates.push({
      uriTemplate: templateDef.uriTemplate,
      name: templateDef.name || templateDef.uriTemplate,
      description: templateDef.description || '',
      mimeType: templateDef.mimeType || 'application/json',
      handler: templateDef.handler,
      regex,
      paramNames,
    });
    return this;
  }

  /**
   * Register an MCP prompt template
   * @param {Object} promptDef
   * @param {string} promptDef.name
   * @param {string} [promptDef.description]
   * @param {Array<Object>} [promptDef.arguments]
   * @param {function(Object, Object): Promise<*>|*} promptDef.handler
   * @returns {this}
   */
  registerPrompt(promptDef) {
    if (!promptDef || !promptDef.name) {
      throw new Error('Prompt must have a name');
    }
    if (typeof promptDef.handler !== 'function') {
      throw new Error(`Prompt "${promptDef.name}" must have a handler function`);
    }

    this.prompts.set(promptDef.name, {
      name: promptDef.name,
      description: promptDef.description || '',
      arguments: promptDef.arguments || [],
      handler: promptDef.handler,
    });
    return this;
  }

  /**
   * Handle incoming JSON-RPC 2.0 message
   * @param {Object} message - Parsed JSON-RPC message object
   * @param {Object} [callContext={}] - Extra context per call (e.g. req, db)
   * @returns {Promise<Object|null>} Response object or null if notification
   */
  async handleMessage(message, callContext = {}) {
    if (!message || typeof message !== 'object') {
      return createJsonRpcError(null, ERROR_CODES.INVALID_REQUEST, 'Invalid Request: Message must be an object');
    }

    const { id, method, params } = message;
    const isNotification = id === undefined || id === null;

    // Notifications without response
    if (method === 'notifications/initialized') {
      this.isInitialized = true;
      this.emit('initialized', params);
      return null;
    }

    if (method === 'notifications/cancelled') {
      this.emit('cancelled', params);
      return null;
    }

    // Request handlers
    try {
      switch (method) {
        case 'initialize': {
          this.clientInfo = params?.clientInfo || null;
          return createJsonRpcResponse(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {
              tools: { listChanged: true },
              resources: { subscribe: false, listChanged: true },
              prompts: { listChanged: true },
              logging: {},
            },
            serverInfo: {
              name: this.name,
              version: this.version,
            },
            instructions: this.instructions,
          });
        }

        case 'ping': {
          return createJsonRpcResponse(id, {});
        }

        case 'tools/list': {
          const toolsList = [];
          for (const tool of this.tools.values()) {
            toolsList.push({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            });
          }
          return createJsonRpcResponse(id, { tools: toolsList });
        }

        case 'tools/call': {
          if (!params || !params.name) {
            return createJsonRpcError(id, ERROR_CODES.INVALID_PARAMS, 'Missing tool name in params');
          }

          const tool = this.tools.get(params.name);
          if (!tool) {
            return createJsonRpcResponse(id, {
              content: [
                {
                  type: 'text',
                  text: `Error: Tool "${params.name}" not found.`,
                },
              ],
              isError: true,
            });
          }

          try {
            const mergedCtx = { ...this.context, ...callContext };
            const args = params.arguments || {};
            const result = await tool.handler(args, mergedCtx);

            // Format result according to MCP specs
            let content;
            if (result && Array.isArray(result.content)) {
              content = result.content;
            } else if (typeof result === 'string') {
              content = [{ type: 'text', text: result }];
            } else {
              content = [{ type: 'text', text: JSON.stringify(result, null, 2) }];
            }

            return createJsonRpcResponse(id, {
              content,
              isError: Boolean(result?.isError),
            });
          } catch (err) {
            return createJsonRpcResponse(id, {
              content: [
                {
                  type: 'text',
                  text: `Tool execution failed: ${err.message}`,
                },
              ],
              isError: true,
            });
          }
        }

        case 'resources/list': {
          const resourceList = [];
          for (const res of this.resources.values()) {
            resourceList.push({
              uri: res.uri,
              name: res.name,
              description: res.description,
              mimeType: res.mimeType,
            });
          }
          return createJsonRpcResponse(id, { resources: resourceList });
        }

        case 'resources/templates/list': {
          const templateList = this.resourceTemplates.map((t) => ({
            uriTemplate: t.uriTemplate,
            name: t.name,
            description: t.description,
            mimeType: t.mimeType,
          }));
          return createJsonRpcResponse(id, { resourceTemplates: templateList });
        }

        case 'resources/read': {
          if (!params || !params.uri) {
            return createJsonRpcError(id, ERROR_CODES.INVALID_PARAMS, 'Missing uri in params');
          }

          const uri = params.uri;
          const mergedCtx = { ...this.context, ...callContext };

          // Direct resource match
          if (this.resources.has(uri)) {
            const res = this.resources.get(uri);
            const data = await res.handler(uri, mergedCtx);
            const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
            return createJsonRpcResponse(id, {
              contents: [
                {
                  uri,
                  mimeType: res.mimeType,
                  text,
                },
              ],
            });
          }

          // Template matching
          for (const tmpl of this.resourceTemplates) {
            const match = uri.match(tmpl.regex);
            if (match) {
              const matchedParams = {};
              tmpl.paramNames.forEach((name, idx) => {
                matchedParams[name] = match[idx + 1];
              });

              const data = await tmpl.handler(uri, matchedParams, mergedCtx);
              const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
              return createJsonRpcResponse(id, {
                contents: [
                  {
                    uri,
                    mimeType: tmpl.mimeType,
                    text,
                  },
                ],
              });
            }
          }

          return createJsonRpcError(id, ERROR_CODES.INVALID_PARAMS, `Resource not found: ${uri}`);
        }

        case 'prompts/list': {
          const promptsList = [];
          for (const prompt of this.prompts.values()) {
            promptsList.push({
              name: prompt.name,
              description: prompt.description,
              arguments: prompt.arguments,
            });
          }
          return createJsonRpcResponse(id, { prompts: promptsList });
        }

        case 'prompts/get': {
          if (!params || !params.name) {
            return createJsonRpcError(id, ERROR_CODES.INVALID_PARAMS, 'Missing prompt name in params');
          }

          const prompt = this.prompts.get(params.name);
          if (!prompt) {
            return createJsonRpcError(id, ERROR_CODES.INVALID_PARAMS, `Prompt "${params.name}" not found`);
          }

          const mergedCtx = { ...this.context, ...callContext };
          const args = params.arguments || {};
          const result = await prompt.handler(args, mergedCtx);

          return createJsonRpcResponse(id, {
            description: prompt.description,
            messages: Array.isArray(result?.messages)
              ? result.messages
              : [
                  {
                    role: 'user',
                    content: {
                      type: 'text',
                      text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                    },
                  },
                ],
          });
        }

        default: {
          if (isNotification) return null;
          return createJsonRpcError(id, ERROR_CODES.METHOD_NOT_FOUND, `Method "${method}" not found`);
        }
      }
    } catch (err) {
      if (isNotification) return null;
      return createJsonRpcError(id, ERROR_CODES.INTERNAL_ERROR, err.message);
    }
  }
}

module.exports = {
  McpServer,
  PROTOCOL_VERSION,
  ERROR_CODES,
  createJsonRpcResponse,
  createJsonRpcError,
};

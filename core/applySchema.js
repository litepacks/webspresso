/**
 * Schema Applicator
 * Parses and validates request input against compiled schemas
 */

/**
 * Apply compiled schema to request
 * Parses body, params, and query against their respective schemas
 * Stores validated results in req.input
 * 
 * @param {Object} req - Express request object
 * @param {Object|null} compiledSchema - Compiled schema from compileSchema
 * @returns {void}
 * @throws {ZodError} If validation fails
 */
function applySchema(req, compiledSchema) {
  // Initialize req.input
  req.input = {
    body: undefined,
    params: undefined,
    query: undefined
  };

  // No schema means no validation
  if (!compiledSchema) {
    return;
  }

  // Parse body if schema exists
  if (compiledSchema.body) {
    req.input.body = compiledSchema.body.parse(req.body);
  }

  // Parse params if schema exists
  if (compiledSchema.params) {
    req.input.params = compiledSchema.params.parse(req.params);
  }

  // Parse query if schema exists
  if (compiledSchema.query) {
    req.input.query = compiledSchema.query.parse(req.query);
  }
}

module.exports = {
  applySchema
};



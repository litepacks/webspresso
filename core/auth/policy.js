/**
 * Webspresso Auth - Policy/Authorization System
 * Simple policy-based authorization (similar to Laravel Gates/Policies)
 * @module core/auth/policy
 */

/**
 * Authorization error thrown when access is denied
 */
class AuthorizationError extends Error {
  constructor(message = 'This action is unauthorized', action = null, policy = null) {
    super(message);
    this.name = 'AuthorizationError';
    this.action = action;
    this.policy = policy;
    this.status = 403;
  }
}

/**
 * PolicyManager - Manages authorization policies
 */
class PolicyManager {
  constructor() {
    /** @type {Map<string, Object>} */
    this.policies = new Map();
    
    /** @type {Map<string, Function>} */
    this.gates = new Map();
    
    /** @type {Function|null} */
    this.beforeCallback = null;
  }

  /**
   * Register a "before" callback that runs before all checks
   * If it returns true/false, that result is used. If null/undefined, normal check continues.
   * @param {Function} callback - (user, action, policy) => boolean|null
   */
  before(callback) {
    this.beforeCallback = callback;
  }

  /**
   * Define a simple gate (single authorization check)
   * @param {string} name - Gate name
   * @param {Function} callback - (user, ...args) => boolean
   */
  defineGate(name, callback) {
    if (typeof callback !== 'function') {
      throw new Error('Gate callback must be a function');
    }
    this.gates.set(name, callback);
  }

  /**
   * Define a policy with multiple actions
   * @param {string} name - Policy name (e.g., 'post', 'comment')
   * @param {Object} rules - Object with action names as keys and callbacks as values
   * @example
   * definePolicy('post', {
   *   view: (user, post) => true,
   *   edit: (user, post) => user.id === post.user_id,
   *   delete: (user, post) => user.role === 'admin'
   * });
   */
  definePolicy(name, rules) {
    if (typeof rules !== 'object' || rules === null) {
      throw new Error('Policy rules must be an object');
    }
    
    // Validate all rules are functions
    for (const [action, callback] of Object.entries(rules)) {
      if (typeof callback !== 'function') {
        throw new Error(`Policy rule "${action}" must be a function`);
      }
    }
    
    this.policies.set(name, rules);
  }

  /**
   * Check if user can perform an action
   * @param {Object|null} user - Current user (null for guests)
   * @param {string} action - Action name
   * @param {string} [policy] - Policy name (optional for gates)
   * @param {*} [resource] - Resource to check against
   * @returns {boolean}
   */
  can(user, action, policy = null, resource = null) {
    // Run "before" callback if defined
    if (this.beforeCallback) {
      const beforeResult = this.beforeCallback(user, action, policy);
      if (beforeResult === true || beforeResult === false) {
        return beforeResult;
      }
    }

    // If no policy specified, check gates
    if (!policy) {
      const gate = this.gates.get(action);
      if (gate) {
        try {
          return Boolean(gate(user, resource));
        } catch {
          return false;
        }
      }
      return false;
    }

    // Check policy
    const policyRules = this.policies.get(policy);
    if (!policyRules) {
      console.warn(`Policy "${policy}" is not defined`);
      return false;
    }

    const rule = policyRules[action];
    if (!rule) {
      console.warn(`Action "${action}" is not defined in policy "${policy}"`);
      return false;
    }

    try {
      return Boolean(rule(user, resource));
    } catch {
      return false;
    }
  }

  /**
   * Check if user cannot perform an action
   * @param {Object|null} user - Current user
   * @param {string} action - Action name
   * @param {string} [policy] - Policy name
   * @param {*} [resource] - Resource to check against
   * @returns {boolean}
   */
  cannot(user, action, policy = null, resource = null) {
    return !this.can(user, action, policy, resource);
  }

  /**
   * Authorize an action - throws if unauthorized
   * @param {Object|null} user - Current user
   * @param {string} action - Action name
   * @param {string} [policy] - Policy name
   * @param {*} [resource] - Resource to check against
   * @throws {AuthorizationError} If unauthorized
   */
  authorize(user, action, policy = null, resource = null) {
    if (this.cannot(user, action, policy, resource)) {
      throw new AuthorizationError(
        `You are not authorized to ${action}${policy ? ` this ${policy}` : ''}`,
        action,
        policy
      );
    }
  }

  /**
   * Get all defined policy names
   * @returns {string[]}
   */
  getPolicies() {
    return Array.from(this.policies.keys());
  }

  /**
   * Get all defined gate names
   * @returns {string[]}
   */
  getGates() {
    return Array.from(this.gates.keys());
  }

  /**
   * Check if a policy is defined
   * @param {string} name - Policy name
   * @returns {boolean}
   */
  hasPolicy(name) {
    return this.policies.has(name);
  }

  /**
   * Check if a gate is defined
   * @param {string} name - Gate name
   * @returns {boolean}
   */
  hasGate(name) {
    return this.gates.has(name);
  }

  /**
   * Clear all policies and gates (useful for testing)
   */
  clear() {
    this.policies.clear();
    this.gates.clear();
    this.beforeCallback = null;
  }
}

// Create default instance
const defaultPolicyManager = new PolicyManager();

module.exports = {
  PolicyManager,
  AuthorizationError,
  // Default instance methods for convenience
  definePolicy: (name, rules) => defaultPolicyManager.definePolicy(name, rules),
  defineGate: (name, callback) => defaultPolicyManager.defineGate(name, callback),
  before: (callback) => defaultPolicyManager.before(callback),
  can: (user, action, policy, resource) => defaultPolicyManager.can(user, action, policy, resource),
  cannot: (user, action, policy, resource) => defaultPolicyManager.cannot(user, action, policy, resource),
  authorize: (user, action, policy, resource) => defaultPolicyManager.authorize(user, action, policy, resource),
  // Access to default instance
  defaultPolicyManager,
};

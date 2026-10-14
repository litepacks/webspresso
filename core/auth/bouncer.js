/**
 * Webspresso Auth - Bouncer & Policy Authorization Engine (AdonisJS Bouncer & Django Permissions-inspired)
 * Context-aware authorization helper for routes, handlers, and templates
 * @module core/auth/bouncer
 */

const { defaultPolicyManager, AuthorizationError } = require('./policy');
const { ForbiddenError, UnauthorizedError } = require('../errors');

/**
 * Context-aware Bouncer instance bound to a specific user
 */
class Bouncer {
  /**
   * @param {Object|null} user - The subject user (or null for guest)
   * @param {import('./policy').PolicyManager} [policyManager]
   */
  constructor(user = null, policyManager = defaultPolicyManager) {
    this.user = user;
    this.policyManager = policyManager;
  }

  /**
   * Create a new Bouncer instance for another user
   * @param {Object|null} user
   * @returns {Bouncer}
   */
  forUser(user) {
    return new Bouncer(user, this.policyManager);
  }

  /**
   * Parse policy and action from arguments
   * Supports:
   * 1. ('Post.update', post) -> policy='Post', action='update', resource=post
   * 2. ('Post', 'update', post) -> policy='Post', action='update', resource=post
   * 3. ('gate-name', resource) -> policy=null, action='gate-name', resource=resource
   * 4. (functionRule, resource) -> direct function check
   * @protected
   */
  _parseArgs(actionOrPolicy, ...rest) {
    if (typeof actionOrPolicy === 'function') {
      return {
        isFn: true,
        fn: actionOrPolicy,
        resource: rest[0],
      };
    }

    if (typeof actionOrPolicy === 'string') {
      // 1. Dot-notation: 'Post.update'
      if (actionOrPolicy.includes('.')) {
        const parts = actionOrPolicy.split('.');
        const policy = parts[0];
        const action = parts.slice(1).join('.');
        return { policy, action, resource: rest[0] };
      }

      // 2. Separate strings: ('Post', 'update', post)
      if (rest.length > 0 && typeof rest[0] === 'string') {
        const policy = actionOrPolicy;
        const action = rest[0];
        const resource = rest[1];
        return { policy, action, resource };
      }

      // 3. Single gate / permission name: ('edit-settings', setting)
      return { policy: null, action: actionOrPolicy, resource: rest[0] };
    }

    return { policy: null, action: String(actionOrPolicy), resource: rest[0] };
  }

  /**
   * Check if current user is allowed to perform an action
   * @param {string|Function} actionOrPolicy
   * @param {...any} rest
   * @returns {boolean}
   */
  allows(actionOrPolicy, ...rest) {
    const parsed = this._parseArgs(actionOrPolicy, ...rest);

    // Direct function rule
    if (parsed.isFn) {
      try {
        return Boolean(parsed.fn(this.user, parsed.resource));
      } catch {
        return false;
      }
    }

    const { policy, action, resource } = parsed;

    // 1. Check Policy Manager (Gates & Policies)
    if (policy) {
      if (this.policyManager.hasPolicy(policy)) {
        return this.policyManager.can(this.user, action, policy, resource);
      }
    } else {
      if (this.policyManager.hasGate(action)) {
        return this.policyManager.can(this.user, action, null, resource);
      }
    }

    // 2. Django-style user permissions matrix check
    // e.g. user.permissions = ['post.create', 'post.update'] or user.hasPerm(...)
    if (this.user) {
      const fullPerm = policy ? `${policy.toLowerCase()}.${action.toLowerCase()}` : action.toLowerCase();

      // Check hasPerm / hasPermission method on user object
      if (typeof this.user.hasPerm === 'function') {
        if (this.user.hasPerm(fullPerm, resource)) return true;
      }
      if (typeof this.user.hasPermission === 'function') {
        if (this.user.hasPermission(fullPerm, resource)) return true;
      }

      // Check permissions array or set
      const perms = this.user.permissions;
      if (Array.isArray(perms) || perms instanceof Set) {
        const permSet = perms instanceof Set ? perms : new Set(perms);
        if (permSet.has('*') || permSet.has(fullPerm)) {
          return true;
        }
        if (policy && permSet.has(`${policy.toLowerCase()}.*`)) {
          return true;
        }
      }

      // If user has superuser / is_admin flag
      if (this.user.isSuperuser || this.user.is_superuser) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if current user is denied from performing an action
   * @param {string|Function} actionOrPolicy
   * @param {...any} rest
   * @returns {boolean}
   */
  denies(actionOrPolicy, ...rest) {
    return !this.allows(actionOrPolicy, ...rest);
  }

  /**
   * Authorize an action. Throws ForbiddenError (or UnauthorizedError) if access is denied.
   * @param {string|Function} actionOrPolicy
   * @param {...any} rest
   * @throws {ForbiddenError|UnauthorizedError}
   */
  authorize(actionOrPolicy, ...rest) {
    if (this.denies(actionOrPolicy, ...rest)) {
      if (!this.user) {
        throw new UnauthorizedError('Authentication required to perform this action');
      }
      const label = typeof actionOrPolicy === 'string' ? actionOrPolicy : 'action';
      throw new ForbiddenError(`You are not authorized to perform "${label}"`);
    }
    return true;
  }
}

/**
 * Create a Bouncer instance for a user
 * @param {Object|null} user
 * @param {import('./policy').PolicyManager} [policyManager]
 * @returns {Bouncer}
 */
function createBouncer(user = null, policyManager = defaultPolicyManager) {
  return new Bouncer(user, policyManager);
}

/**
 * Express middleware that attaches `req.bouncer` automatically
 * @param {Object} [options={}]
 * @returns {import('express').RequestHandler}
 */
function createBouncerMiddleware(options = {}) {
  const policyManager = options.policyManager || defaultPolicyManager;

  return function bouncerMiddleware(req, res, next) {
    const user = req.user || req.auth?.user || null;
    req.bouncer = new Bouncer(user, policyManager);
    next();
  };
}

module.exports = {
  Bouncer,
  createBouncer,
  createBouncerMiddleware,
};

/**
 * Realtime Authentication Strategy Manager
 * @module core/realtime/auth-manager
 */

const { RealtimeError } = require('./errors');

class AuthManager {
  /**
   * @param {Object|boolean} [authConfig=false]
   */
  constructor(authConfig = false) {
    this.config = authConfig;
  }

  /**
   * Check if authentication is enabled
   * @returns {boolean}
   */
  isEnabled() {
    return Boolean(this.config && this.config !== false);
  }

  /**
   * Get active auth strategy ('token' | 'cookie' | 'custom' | 'none')
   * @returns {'token' | 'cookie' | 'custom' | 'none'}
   */
  getStrategy() {
    if (!this.isEnabled()) return 'none';
    return this.config.strategy || 'token';
  }

  /**
   * Resolve framework-agnostic connection auth metadata before establishing connection
   * 
   * @returns {Promise<Object>} Metadata to pass to adapter
   */
  async resolveAuthMetadata() {
    if (!this.isEnabled()) {
      return { type: 'none' };
    }

    const strategy = this.getStrategy();

    if (strategy === 'cookie') {
      return { type: 'cookie' };
    }

    if (strategy === 'token') {
      if (typeof this.config.getToken !== 'function') {
        throw new RealtimeError(
          'UNAUTHORIZED',
          'Auth strategy "token" requires a getToken() function'
        );
      }
      try {
        const token = await this.config.getToken();
        if (!token) {
          throw new RealtimeError('UNAUTHORIZED', 'No authentication token provided by getToken()');
        }
        return {
          type: 'token',
          token,
        };
      } catch (err) {
        if (err instanceof RealtimeError) throw err;
        throw new RealtimeError('UNAUTHORIZED', 'Failed to retrieve authentication token', err);
      }
    }

    if (strategy === 'custom') {
      if (typeof this.config.resolve !== 'function') {
        throw new RealtimeError(
          'UNAUTHORIZED',
          'Auth strategy "custom" requires a resolve() function'
        );
      }
      try {
        const metadata = await this.config.resolve();
        return {
          type: 'custom',
          ...(metadata && typeof metadata === 'object' ? metadata : {}),
        };
      } catch (err) {
        if (err instanceof RealtimeError) throw err;
        throw new RealtimeError('UNAUTHORIZED', 'Custom auth resolution failed', err);
      }
    }

    throw new RealtimeError('UNAUTHORIZED', `Unsupported auth strategy "${strategy}"`);
  }

  /**
   * Handle token refresh or re-authentication
   * 
   * @returns {Promise<Object>} New auth metadata
   */
  async refreshToken() {
    if (!this.isEnabled()) {
      return { type: 'none' };
    }

    const strategy = this.getStrategy();

    if (strategy === 'token' && typeof this.config.refreshToken === 'function') {
      try {
        const token = await this.config.refreshToken();
        if (!token) {
          throw new RealtimeError('TOKEN_REFRESH_FAILED', 'refreshToken() returned empty token');
        }
        return {
          type: 'token',
          token,
        };
      } catch (err) {
        if (err instanceof RealtimeError) throw err;
        throw new RealtimeError('TOKEN_REFRESH_FAILED', 'Failed to refresh token', err);
      }
    }

    // Fallback to standard resolve
    return this.resolveAuthMetadata();
  }

  /**
   * Notify unauthorized handler if configured
   * @param {RealtimeError} error
   */
  handleUnauthorized(error) {
    if (this.config && typeof this.config.onUnauthorized === 'function') {
      try {
        this.config.onUnauthorized(error);
      } catch (e) {
        console.error('[realtime] Error in onUnauthorized handler:', e);
      }
    }
  }
}

module.exports = { AuthManager };

'use strict';

/**
 * In-memory brute-force rate limiter for admin login.
 * Zero external dependencies.
 */
class LoginRateLimiter {
  constructor(options = {}) {
    if (options === false) {
      this.enabled = false;
      this.maxAttempts = 5;
      this.windowMs = 15 * 60 * 1000;
    } else {
      const opts = typeof options === 'object' && options !== null ? options : {};
      this.enabled = opts.enabled !== false;
      this.maxAttempts = typeof opts.maxAttempts === 'number' && opts.maxAttempts > 0 ? opts.maxAttempts : 5;
      this.windowMs = typeof opts.windowMs === 'number' && opts.windowMs > 0 ? opts.windowMs : (15 * 60 * 1000);
    }
    this.attempts = new Map();
  }

  getClientIp(req) {
    if (!req) return '127.0.0.1';
    if (req.ip) return String(req.ip);
    if (req.headers && req.headers['x-forwarded-for']) {
      const forwarded = String(req.headers['x-forwarded-for']).split(',')[0].trim();
      if (forwarded) return forwarded;
    }
    if (req.connection && req.connection.remoteAddress) {
      return String(req.connection.remoteAddress);
    }
    if (req.socket && req.socket.remoteAddress) {
      return String(req.socket.remoteAddress);
    }
    return '127.0.0.1';
  }

  isBlocked(req) {
    if (!this.enabled) return { blocked: false, remaining: Infinity, count: 0 };
    const ip = this.getClientIp(req);
    const now = Date.now();
    const entry = this.attempts.get(ip);
    if (!entry) return { blocked: false, remaining: this.maxAttempts, count: 0 };

    if (now >= entry.resetAt) {
      this.attempts.delete(ip);
      return { blocked: false, remaining: this.maxAttempts, count: 0 };
    }

    if (entry.count >= this.maxAttempts) {
      const remainingMs = Math.max(0, entry.resetAt - now);
      const waitMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
      const retryAfter = Math.max(1, Math.ceil(remainingMs / 1000));
      return {
        blocked: true,
        remaining: 0,
        count: entry.count,
        waitMinutes,
        retryAfter,
        message: `Too many failed login attempts. Please try again in ${waitMinutes} ${waitMinutes === 1 ? 'minute' : 'minutes'}.`,
      };
    }

    return {
      blocked: false,
      remaining: Math.max(0, this.maxAttempts - entry.count),
      count: entry.count,
    };
  }

  recordFailure(req) {
    if (!this.enabled) return { blocked: false, remaining: Infinity, count: 0 };
    const ip = this.getClientIp(req);
    const now = Date.now();
    const entry = this.attempts.get(ip);

    if (!entry || now >= entry.resetAt) {
      this.attempts.set(ip, {
        count: 1,
        resetAt: now + this.windowMs,
      });
    } else {
      entry.count += 1;
    }

    if (this.attempts.size > 500) {
      this.cleanup();
    }

    return this.isBlocked(req);
  }

  recordSuccess(req) {
    if (!this.enabled) return;
    const ip = this.getClientIp(req);
    this.attempts.delete(ip);
  }

  reset(ip) {
    if (ip) {
      this.attempts.delete(ip);
    } else {
      this.attempts.clear();
    }
  }

  cleanup() {
    const now = Date.now();
    for (const [ip, entry] of this.attempts.entries()) {
      if (now >= entry.resetAt) {
        this.attempts.delete(ip);
      }
    }

    // Hard ceiling to prevent unbounded memory growth under distributed IP attacks
    const MAX_ENTRIES = 5000;
    if (this.attempts.size > MAX_ENTRIES) {
      const excess = this.attempts.size - MAX_ENTRIES;
      let count = 0;
      for (const ip of this.attempts.keys()) {
        this.attempts.delete(ip);
        count++;
        if (count >= excess) break;
      }
    }
  }
}

module.exports = {
  LoginRateLimiter,
};

'use strict';

/**
 * In-memory sliding-window rate limiter for IP connections and per-client messages.
 */
class RateLimiter {
  constructor(options = {}) {
    this.maxRequests = options.maxRequests || 60;
    this.windowMs = options.windowMs || 60 * 1000;
    // Map of key -> Array<timestamp>
    this.hits = new Map();

    // Periodic cleanup every minute to prevent memory leak
    this.cleanupTimer = setInterval(() => this.cleanup(), 60 * 1000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Check if an action is allowed for a given key.
   * If allowed, records the action and returns true.
   * If exceeded, returns false.
   *
   * @param {string} key Identifier (e.g. IP address or client ID)
   * @param {number} [limit] Optional custom limit overriding instance default
   * @returns {boolean} True if allowed, false if rate limited
   */
  allow(key, limit = this.maxRequests) {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let timestamps = this.hits.get(key);
    if (!timestamps) {
      timestamps = [];
      this.hits.set(key, timestamps);
    }

    // Retain only timestamps within the sliding window
    let i = 0;
    while (i < timestamps.length && timestamps[i] <= windowStart) {
      i++;
    }
    if (i > 0) {
      timestamps.splice(0, i);
    }

    if (timestamps.length >= limit) {
      return false;
    }

    timestamps.push(now);
    return true;
  }

  /**
   * Cleans up expired entries.
   */
  cleanup() {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [key, timestamps] of this.hits.entries()) {
      const active = timestamps.filter(ts => ts > windowStart);
      if (active.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, active);
      }
    }
  }

  /**
   * Resets rate limit counts for a key or all keys.
   * @param {string} [key]
   */
  reset(key) {
    if (key) {
      this.hits.delete(key);
    } else {
      this.hits.clear();
    }
  }

  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.hits.clear();
  }
}

module.exports = RateLimiter;

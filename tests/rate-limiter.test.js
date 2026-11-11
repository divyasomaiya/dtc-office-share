'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const RateLimiter = require('../src/rate-limiter');

describe('Rate Limiter', () => {
  test('allows requests within threshold limit', () => {
    const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 });

    for (let i = 0; i < 5; i++) {
      assert.strictEqual(limiter.allow('192.168.1.50'), true, `Request ${i + 1} should be allowed`);
    }

    limiter.destroy();
  });

  test('blocks requests that exceed threshold limit', () => {
    const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1000 });

    assert.strictEqual(limiter.allow('client-A'), true);
    assert.strictEqual(limiter.allow('client-A'), true);
    assert.strictEqual(limiter.allow('client-A'), true);
    // 4th request must be rejected
    assert.strictEqual(limiter.allow('client-A'), false);

    // Another client must remain unaffected
    assert.strictEqual(limiter.allow('client-B'), true);

    limiter.destroy();
  });

  test('resets keys correctly', () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000 });

    assert.strictEqual(limiter.allow('key-1'), true);
    assert.strictEqual(limiter.allow('key-1'), true);
    assert.strictEqual(limiter.allow('key-1'), false);

    limiter.reset('key-1');
    assert.strictEqual(limiter.allow('key-1'), true);

    limiter.destroy();
  });
});

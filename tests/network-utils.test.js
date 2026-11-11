'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { getLocalNetworkAddresses, getAccessUrls } = require('../src/network-utils');

describe('Network Utilities', () => {
  test('returns array of network interfaces with IPv4 addresses', () => {
    const addrs = getLocalNetworkAddresses();
    assert.ok(Array.isArray(addrs));
    for (const item of addrs) {
      assert.ok(item.address);
      assert.notStrictEqual(item.address, '127.0.0.1');
      assert.ok(item.interface);
    }
  });

  test('formats access URLs for 0.0.0.0', () => {
    const urls = getAccessUrls('0.0.0.0', 3000, false);
    assert.ok(Array.isArray(urls));
    assert.ok(urls.some(u => u.includes('http://localhost:3000')));
  });

  test('formats access URLs for specific host with https', () => {
    const urls = getAccessUrls('192.168.1.100', 8443, true);
    assert.strictEqual(urls.length, 1);
    assert.strictEqual(urls[0], 'https://192.168.1.100:8443');
  });
});

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { validateTransferMetadata, isValidOrigin } = require('../src/server');
const TransferEngine = require('../public/js/transfer');

describe('Transfer Limits & Metadata Validation', () => {
  const defaultLimits = {
    maxFileSizeBytes: 1024 * 1024,
    maxBatchFiles: 3,
    maxFilenameLength: 50
  };

  test('accepts valid transfer metadata', () => {
    const valid = {
      transferId: 'tx_valid123',
      files: [
        { name: 'document.pdf', size: 5000 },
        { name: 'image.png', size: 10000 }
      ],
      totalSize: 15000
    };
    assert.strictEqual(validateTransferMetadata(valid, defaultLimits), null);
  });

  test('rejects malformed transfer ID', () => {
    const invalidId = {
      transferId: 'bad/id/../../traversal',
      files: [{ name: 'file.txt', size: 10 }],
      totalSize: 10
    };
    assert.ok(validateTransferMetadata(invalidId, defaultLimits).includes('transfer ID'));
  });

  test('rejects excessive batch file count', () => {
    const excessiveBatch = {
      transferId: 'tx_batch123',
      files: [
        { name: '1.txt', size: 1 },
        { name: '2.txt', size: 1 },
        { name: '3.txt', size: 1 },
        { name: '4.txt', size: 1 }
      ],
      totalSize: 4
    };
    assert.ok(validateTransferMetadata(excessiveBatch, defaultLimits).includes('maximum limit'));
  });

  test('rejects single file exceeding size limit', () => {
    const oversized = {
      transferId: 'tx_oversize12',
      files: [{ name: 'huge.iso', size: 50 * 1024 * 1024 }],
      totalSize: 50 * 1024 * 1024
    };
    assert.ok(validateTransferMetadata(oversized, defaultLimits).includes('exceeds maximum limit'));
  });

  test('rejects total size mismatch', () => {
    const mismatch = {
      transferId: 'tx_mismatch1',
      files: [{ name: 'doc.txt', size: 100 }],
      totalSize: 200 // does not match sum of 100
    };
    assert.ok(validateTransferMetadata(mismatch, defaultLimits).includes('does not match sum'));
  });
});

describe('Origin Header Validation', () => {
  test('allows requests when no origin header is present (non-browser client)', () => {
    const req = { headers: { host: 'localhost:3000' } };
    assert.strictEqual(isValidOrigin(req, null), true);
  });

  test('validates matching origin and host on LAN', () => {
    const req = {
      headers: {
        origin: 'http://192.168.1.50:3000',
        host: '192.168.1.50:3000'
      },
      socket: { encrypted: false }
    };
    assert.strictEqual(isValidOrigin(req, null), true);
  });

  test('rejects mismatched origin', () => {
    const req = {
      headers: {
        origin: 'http://evil-attacker.com',
        host: '192.168.1.50:3000'
      },
      socket: { encrypted: false }
    };
    assert.strictEqual(isValidOrigin(req, null), false);
  });

  test('honors explicit allowedOrigins whitelist', () => {
    const req1 = {
      headers: { origin: 'http://trusted-office.local' },
      socket: { encrypted: false }
    };
    const req2 = {
      headers: { origin: 'http://untrusted-site.com' },
      socket: { encrypted: false }
    };
    const whitelist = ['http://trusted-office.local'];
    assert.strictEqual(isValidOrigin(req1, whitelist), true);
    assert.strictEqual(isValidOrigin(req2, whitelist), false);
  });
});

describe('Recipient Authorization Registry in TransferEngine', () => {
  test('rejects unsolicited file streams without prior authorization', async () => {
    let errorReported = false;
    let errorMessage = '';

    const engine = new TransferEngine({
      onError: (txId, msg) => {
        errorReported = true;
        errorMessage = msg;
      }
    });

    const fakeChannel = {
      readyState: 'open',
      send: () => {},
      close: () => {}
    };

    engine.bindReceiverChannel('peer-attacker', fakeChannel);

    // Simulate attacker sending unsolicited file-header
    await fakeChannel.onmessage({
      data: JSON.stringify({
        protocol: 'dtc-share-v2',
        action: 'file-header',
        transferId: 'tx_unsolicited',
        fileIndex: 0,
        totalFiles: 1,
        name: 'exploit.sh',
        size: 100,
        type: 'text/plain'
      })
    });

    assert.strictEqual(errorReported, true);
    assert.ok(errorMessage.includes('unauthorized'));
  });

  test('allows file stream when explicitly approved by recipient', async () => {
    let errorReported = false;
    let progressReported = false;

    const engine = new TransferEngine({
      onError: () => { errorReported = true; },
      onProgress: () => { progressReported = true; }
    });

    const fakeChannel = {
      readyState: 'open',
      send: () => {},
      close: () => {}
    };

    engine.bindReceiverChannel('peer-legit', fakeChannel);

    // Recipient approves transfer
    engine.authorizeIncomingTransfer('tx_approved123', 'peer-legit', [{ name: 'notes.txt', size: 10 }], 10);

    // Sender sends file-header
    await fakeChannel.onmessage({
      data: JSON.stringify({
        protocol: 'dtc-share-v2',
        action: 'file-header',
        transferId: 'tx_approved123',
        fileIndex: 0,
        totalFiles: 1,
        name: 'notes.txt',
        size: 10,
        type: 'text/plain'
      })
    });

    assert.strictEqual(errorReported, false);
    assert.strictEqual(progressReported, true);
  });
});

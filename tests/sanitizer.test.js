'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { sanitizeFilename, formatFileSize } = require('../src/sanitizer');

describe('Filename Sanitizer', () => {
  test('strips unix path traversal sequences', () => {
    assert.strictEqual(sanitizeFilename('../../../etc/passwd'), 'passwd');
    assert.strictEqual(sanitizeFilename('./../../secret.pdf'), 'secret.pdf');
  });

  test('strips windows backslash path traversal sequences', () => {
    assert.strictEqual(sanitizeFilename('..\\..\\Windows\\System32\\cmd.exe'), 'cmd.exe');
    assert.strictEqual(sanitizeFilename('C:\\Documents\\Confidential.docx'), 'Confidential.docx');
  });

  test('replaces illegal OS and control characters', () => {
    assert.strictEqual(sanitizeFilename('hello:world*?.txt'), 'hello_world__.txt');
    assert.strictEqual(sanitizeFilename('file<name>|"foo".dat'), 'file_name___foo_.dat');
  });

  test('handles Windows reserved names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)', () => {
    assert.strictEqual(sanitizeFilename('CON'), 'safe_CON');
    assert.strictEqual(sanitizeFilename('aux.txt'), 'safe_aux.txt');
    assert.strictEqual(sanitizeFilename('NUL.tar.gz'), 'safe_NUL.tar.gz');
    assert.strictEqual(sanitizeFilename('com1.bin'), 'safe_com1.bin');
  });

  test('trims leading/trailing dots and whitespace', () => {
    assert.strictEqual(sanitizeFilename('   .hidden_file   '), 'hidden_file');
    assert.strictEqual(sanitizeFilename('...test.zip...'), 'test.zip');
  });

  test('falls back safely for empty or invalid inputs', () => {
    assert.strictEqual(sanitizeFilename(''), 'download');
    assert.strictEqual(sanitizeFilename(null), 'download');
    assert.strictEqual(sanitizeFilename(undefined), 'download');
    assert.strictEqual(sanitizeFilename('///'), 'download');
    assert.strictEqual(sanitizeFilename(':::'), 'download');
  });

  test('truncates overly long filenames while preserving extension', () => {
    const longName = 'a'.repeat(300) + '.pdf';
    const sanitized = sanitizeFilename(longName);
    assert.ok(sanitized.length <= 255);
    assert.ok(sanitized.endsWith('.pdf'));
  });
});

describe('File Size Formatter', () => {
  test('formats bytes properly into human-readable units', () => {
    assert.strictEqual(formatFileSize(0), '0 B');
    assert.strictEqual(formatFileSize(500), '500 B');
    assert.strictEqual(formatFileSize(1024), '1 KB');
    assert.strictEqual(formatFileSize(1024 * 1024), '1 MB');
    assert.strictEqual(formatFileSize(1536 * 1024), '1.5 MB');
    assert.strictEqual(formatFileSize(1024 * 1024 * 1024), '1 GB');
  });

  test('handles edge case inputs', () => {
    assert.strictEqual(formatFileSize(-10), '0 B');
    assert.strictEqual(formatFileSize(NaN), '0 B');
    assert.strictEqual(formatFileSize('not a number'), '0 B');
  });
});

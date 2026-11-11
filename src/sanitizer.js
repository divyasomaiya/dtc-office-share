'use strict';

const path = require('path');

// Windows reserved filenames (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// Dangerous/invalid characters across OS filesystems: < > : " / \ | ? * and control chars
const FORBIDDEN_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;

/**
 * Sanitizes a user-supplied filename to prevent path traversal,
 * reserved filename abuse, hidden/malicious execution, and filesystem issues.
 *
 * @param {string} rawFilename
 * @param {string} fallback
 * @returns {string} Sanitized safe filename
 */
function sanitizeFilename(rawFilename, fallback = 'download') {
  if (typeof rawFilename !== 'string') {
    return fallback;
  }

  // 1. Strip path components (handles both POSIX and Windows separators)
  let name = rawFilename.replace(/\\/g, '/');
  name = path.posix.basename(name);

  // 2. Replace null bytes and control chars / invalid file characters
  name = name.replace(FORBIDDEN_CHARS, '_');

  // 3. Remove leading and trailing dots and spaces (prevents hidden unix files or "..")
  name = name.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');

  // 4. Check for Windows reserved names (e.g. CON, AUX, NUL.txt)
  if (WINDOWS_RESERVED_NAMES.test(name)) {
    name = `safe_${name}`;
  }

  // 5. Truncate long filenames (max 255 bytes/chars)
  if (name.length > 255) {
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    name = base.slice(0, 255 - ext.length) + ext;
  }

  // 6. If result is empty or just underscores, return fallback
  if (!name || /^_+$/.test(name)) {
    return fallback;
  }

  return name;
}

/**
 * Formats byte size into human readable string (e.g. 1.25 MB).
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  if (typeof bytes !== 'number' || isNaN(bytes) || bytes < 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = bytes / Math.pow(k, i);
  return `${parseFloat(val.toFixed(2))} ${sizes[i]}`;
}

module.exports = {
  sanitizeFilename,
  formatFileSize,
  WINDOWS_RESERVED_NAMES
};

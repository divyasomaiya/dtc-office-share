'use strict';

/**
 * Server and application configuration.
 * Configurable via environment variables or CLI flags.
 */
module.exports = {
  // Network binding: defaults to 0.0.0.0 for LAN accessibility
  host: process.env.HOST || '0.0.0.0',
  port: parseInt(process.env.PORT || '3000', 10),

  // Optional shared office access code to prevent unauthorized LAN devices
  // from joining trusted sessions without the office passcode
  accessCode: process.env.ACCESS_CODE || process.env.OFFICE_CODE || '',

  // Optional allowed origins for WebSocket connections (comma-separated)
  // If empty, origin checking allows requests with matching Host headers or no Origin (non-browser)
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim().toLowerCase())
    : null,

  // Optional HTTPS settings for secure-context requirements on mobile browsers
  https: {
    enabled: process.env.USE_HTTPS === 'true',
    keyPath: process.env.SSL_KEY_PATH || '',
    certPath: process.env.SSL_CERT_PATH || ''
  },

  // Limits
  limits: {
    // Max WebSocket signaling message frame size in bytes (e.g. 64 KB)
    maxSignalMessageBytes: 64 * 1024,
    // Suggested maximum peer-to-peer single file size limit for Phase 1 in bytes (e.g. 4 GB)
    maxFileSizeBytes: 4 * 1024 * 1024 * 1024,
    // Browser RAM accumulation limit (e.g. 200 MB for Safari/iOS without streaming)
    memoryFallbackMaxSizeBytes: 200 * 1024 * 1024,
    // Max files per single transfer batch
    maxBatchFiles: 50,
    // Max filename length
    maxFilenameLength: 255
  },

  // Timeouts (ms)
  timeouts: {
    // Transfer approval request expiration (60 seconds)
    transferRequestTimeoutMs: 60 * 1000,
    // Data channel inactivity timeout (45 seconds)
    dataChannelInactivityMs: 45 * 1000
  },

  // Rate Limiting
  rateLimiter: {
    // Max connections per client IP in a sliding window
    connectionsPerMinute: 60,
    // Max signaling messages per peer per second
    messagesPerSecond: 30,
    // Window duration in ms
    windowMs: 60 * 1000
  },

  // Heartbeat / ping interval (ms)
  heartbeatIntervalMs: 30 * 1000
};

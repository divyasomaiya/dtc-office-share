'use strict';

/**
 * Server and application configuration.
 * Configurable via environment variables or CLI flags.
 */
module.exports = {
  // Network binding: defaults to 0.0.0.0 for LAN accessibility
  host: process.env.HOST || '0.0.0.0',
  port: parseInt(process.env.PORT || '3000', 10),

  // Optional HTTPS settings for secure-context requirements on mobile browsers
  https: {
    enabled: process.env.USE_HTTPS === 'true',
    keyPath: process.env.SSL_KEY_PATH || '',
    certPath: process.env.SSL_CERT_PATH || ''
  },

  // Limits
  limits: {
    // Max WebSocket signaling message size (in bytes, e.g. 64 KB)
    maxSignalMessageBytes: 64 * 1024,
    // Suggested maximum peer-to-peer single file size limit for Phase 1 in bytes (e.g. 4 GB)
    // In WebRTC chunked data channel transfer, this guards the metadata declaration
    maxFileSizeBytes: 4 * 1024 * 1024 * 1024,
    // Max files per single transfer batch
    maxBatchFiles: 50
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

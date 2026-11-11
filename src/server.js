'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('crypto');

const config = require('./config');
const { getLocalNetworkAddresses, getAccessUrls } = require('./network-utils');
const RateLimiter = require('./rate-limiter');
const { sanitizeFilename } = require('./sanitizer');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

/**
 * Validates WebSocket origin header against host and allowedOrigins whitelist.
 * Returns true if valid, false if rejected.
 */
function isValidOrigin(req, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin) {
    // Non-browser client or direct connection
    return true;
  }

  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch (e) {
    return false;
  }

  // If explicit allowedOrigins whitelist is provided
  if (allowedOrigins && allowedOrigins.length > 0) {
    return allowedOrigins.includes(originUrl.origin.toLowerCase()) ||
           allowedOrigins.includes(originUrl.hostname.toLowerCase());
  }

  // Default LAN validation: origin host must match HTTP Host header
  const hostHeader = req.headers.host;
  if (!hostHeader) return false;

  const [expectedHost, expectedPort] = hostHeader.split(':');
  const originHost = originUrl.hostname;
  const originPort = originUrl.port || (originUrl.protocol === 'https:' ? '443' : '80');
  const defaultPort = req.socket.encrypted ? '443' : '80';
  const effectiveExpectedPort = expectedPort || defaultPort;

  // Allow localhost / loopback matching
  const isLoopback = (host) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  if (isLoopback(originHost) && isLoopback(expectedHost)) {
    return originPort === effectiveExpectedPort;
  }

  return originHost === expectedHost && originPort === effectiveExpectedPort;
}

/**
 * Static file HTTP request handler.
 */
function handleHttpRequest(req, res, activeConfig) {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  // Basic API endpoint to check server health & network IPs
  if (req.url === '/api/info' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      name: 'DTC Office Share',
      version: '1.0.0',
      requiresAccessCode: !!activeConfig.accessCode,
      addresses: getLocalNetworkAddresses(),
      limits: activeConfig.limits
    }));
    return;
  }

  // Sanitize requested file path
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') {
    reqPath = '/index.html';
  }

  const safePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  // Security check: ensure path is within PUBLIC_DIR
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
}

/**
 * Validates transfer metadata payload against defined limits and types.
 */
function validateTransferMetadata(data, limits) {
  if (!data || typeof data !== 'object') return 'Payload must be an object.';
  if (typeof data.transferId !== 'string' || !/^tx_[a-zA-Z0-9_-]{4,32}$/.test(data.transferId)) {
    return 'Invalid transfer ID format.';
  }
  if (!Array.isArray(data.files) || data.files.length === 0) {
    return 'Transfer must contain at least one file.';
  }
  if (data.files.length > limits.maxBatchFiles) {
    return `Batch exceeds maximum limit of ${limits.maxBatchFiles} files.`;
  }

  let calculatedTotal = 0;
  for (const f of data.files) {
    if (!f || typeof f !== 'object') return 'Invalid file entry.';
    if (typeof f.name !== 'string' || f.name.length === 0 || f.name.length > limits.maxFilenameLength) {
      return 'Invalid file name length.';
    }
    if (typeof f.size !== 'number' || isNaN(f.size) || f.size < 0) {
      return 'Invalid file size.';
    }
    if (f.size > limits.maxFileSizeBytes) {
      return `File ${f.name} exceeds maximum limit of ${limits.maxFileSizeBytes} bytes.`;
    }
    calculatedTotal += f.size;
  }

  if (typeof data.totalSize === 'number' && data.totalSize !== calculatedTotal) {
    return 'Declared totalSize does not match sum of file sizes.';
  }

  return null;
}

/**
 * Creates and starts the DTC Office Share server.
 *
 * @param {object} [customConfig] Optional configuration overrides for testing
 * @returns {{ server: http.Server|https.Server, wss: WebSocketServer, close: Function, start: Function, peers: Map }}
 */
function createServer(customConfig = {}) {
  const activeConfig = { ...config, ...customConfig };
  let server;

  const requestListener = (req, res) => handleHttpRequest(req, res, activeConfig);

  if (activeConfig.https && activeConfig.https.enabled) {
    const key = fs.readFileSync(activeConfig.https.keyPath);
    const cert = fs.readFileSync(activeConfig.https.certPath);
    server = https.createServer({ key, cert }, requestListener);
  } else {
    server = http.createServer(requestListener);
  }

  // Enforce maxPayload directly on WebSocketServer to drop oversized frames at socket level
  const wss = new WebSocketServer({
    server,
    maxPayload: activeConfig.limits.maxSignalMessageBytes
  });

  // Rate limiters
  const connectionLimiter = new RateLimiter({
    maxRequests: activeConfig.rateLimiter.connectionsPerMinute,
    windowMs: activeConfig.rateLimiter.windowMs
  });

  const messageLimiter = new RateLimiter({
    maxRequests: activeConfig.rateLimiter.messagesPerSecond,
    windowMs: 1000
  });

  // Connected peers map: id -> { ws, id, name, deviceType, ip, joinedAt, isAuthenticated, isAlive }
  const peers = new Map();

  // Track active pending transfers for authorization routing: transferId -> { senderId, targetId, files, totalSize, createdAt, authorized }
  const transferRegistry = new Map();

  function broadcastPeerList() {
    const peerList = Array.from(peers.values())
      .filter(p => p.isAuthenticated)
      .map(p => ({
        id: p.id,
        name: p.name,
        deviceType: p.deviceType,
        joinedAt: p.joinedAt
      }));

    for (const peer of peers.values()) {
      if (peer.isAuthenticated && peer.ws.readyState === WebSocket.OPEN) {
        const others = peerList.filter(p => p.id !== peer.id);
        peer.ws.send(JSON.stringify({
          type: 'peers',
          self: { id: peer.id, name: peer.name, deviceType: peer.deviceType },
          peers: others
        }));
      }
    }
  }

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress || 'unknown';

    // 1. Validate Origin header
    if (!isValidOrigin(req, activeConfig.allowedOrigins)) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'ORIGIN_FORBIDDEN',
        message: 'Origin not allowed to connect to this office share server.'
      }));
      ws.close(1008, 'Origin forbidden');
      return;
    }

    // 2. IP rate limit check
    if (!connectionLimiter.allow(ip)) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Connection rate limit exceeded. Please wait a moment.'
      }));
      ws.close(1008, 'Rate limit exceeded');
      return;
    }

    const peerId = crypto.randomUUID();
    let currentPeer = {
      id: peerId,
      ws,
      name: `Device-${peerId.slice(0, 4)}`,
      deviceType: 'unknown',
      ip,
      joinedAt: Date.now(),
      isAuthenticated: !activeConfig.accessCode, // Automatically authenticated if no access code configured
      isAlive: true
    };

    peers.set(peerId, currentPeer);

    ws.on('pong', () => {
      currentPeer.isAlive = true;
    });

    ws.on('message', (rawMessage) => {
      // Message rate limit check per peer
      if (!messageLimiter.allow(peerId)) {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Signaling rate limit exceeded. Slow down.'
        }));
        return;
      }

      let data;
      try {
        data = JSON.parse(rawMessage.toString());
      } catch (e) {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'INVALID_JSON',
          message: 'Malformed signaling payload.'
        }));
        return;
      }

      if (!data || typeof data.type !== 'string') {
        return;
      }

      // Handle Join / Authentication
      if (data.type === 'join') {
        if (activeConfig.accessCode) {
          if (!data.accessCode || data.accessCode !== activeConfig.accessCode) {
            ws.send(JSON.stringify({
              type: 'auth-error',
              code: 'INVALID_ACCESS_CODE',
              message: 'Invalid office access code.'
            }));
            return;
          }
          currentPeer.isAuthenticated = true;
        }

        if (data.name && typeof data.name === 'string') {
          currentPeer.name = sanitizeFilename(data.name.slice(0, 40), currentPeer.name);
        }
        if (data.deviceType && typeof data.deviceType === 'string') {
          currentPeer.deviceType = data.deviceType.slice(0, 20);
        }

        ws.send(JSON.stringify({
          type: 'joined-success',
          self: { id: peerId, name: currentPeer.name, deviceType: currentPeer.deviceType }
        }));

        broadcastPeerList();
        return;
      }

      // All subsequent messages require client to be authenticated
      if (!currentPeer.isAuthenticated) {
        ws.send(JSON.stringify({
          type: 'auth-error',
          code: 'UNAUTHORIZED',
          message: 'Must authenticate with office access code first.'
        }));
        return;
      }

      switch (data.type) {
        case 'update-name': {
          if (data.name && typeof data.name === 'string') {
            currentPeer.name = sanitizeFilename(data.name.slice(0, 40), currentPeer.name);
            broadcastPeerList();
          }
          break;
        }

        case 'transfer-request': {
          const targetId = data.target;
          const validationError = validateTransferMetadata(data, activeConfig.limits);
          if (validationError) {
            ws.send(JSON.stringify({
              type: 'transfer-rejected-server',
              transferId: data.transferId,
              message: validationError
            }));
            return;
          }

          if (!targetId || !peers.has(targetId) || !peers.get(targetId).isAuthenticated) {
            ws.send(JSON.stringify({
              type: 'peer-not-found',
              target: targetId,
              message: 'Target peer is not available.'
            }));
            return;
          }

          // Register pending transfer
          transferRegistry.set(data.transferId, {
            transferId: data.transferId,
            senderId: peerId,
            targetId: targetId,
            files: data.files,
            totalSize: data.totalSize,
            createdAt: Date.now(),
            authorized: false
          });

          // Forward to target recipient
          const targetPeer = peers.get(targetId);
          targetPeer.ws.send(JSON.stringify({
            type: 'transfer-request',
            from: peerId,
            fromName: currentPeer.name,
            fromDeviceType: currentPeer.deviceType,
            transferId: data.transferId,
            files: data.files,
            totalSize: data.totalSize
          }));
          break;
        }

        case 'transfer-response': {
          const rec = transferRegistry.get(data.transferId);
          if (!rec) {
            ws.send(JSON.stringify({
              type: 'error',
              code: 'TRANSFER_UNKNOWN',
              message: 'Transfer request expired or does not exist.'
            }));
            return;
          }

          // Only the intended target peer can respond to a transfer request
          if (rec.targetId !== peerId) {
            ws.send(JSON.stringify({
              type: 'error',
              code: 'FORBIDDEN',
              message: 'You are not the designated recipient for this transfer.'
            }));
            return;
          }

          if (data.accepted === true) {
            rec.authorized = true;
          } else {
            transferRegistry.delete(data.transferId);
          }

          const sender = peers.get(rec.senderId);
          if (sender && sender.ws.readyState === WebSocket.OPEN) {
            sender.ws.send(JSON.stringify({
              type: 'transfer-response',
              from: peerId,
              transferId: data.transferId,
              accepted: data.accepted === true
            }));
          }
          break;
        }

        case 'transfer-cancel': {
          if (data.transferId) {
            const rec = transferRegistry.get(data.transferId);
            if (rec) {
              const otherId = rec.senderId === peerId ? rec.targetId : rec.senderId;
              const other = peers.get(otherId);
              if (other && other.ws.readyState === WebSocket.OPEN) {
                other.ws.send(JSON.stringify({
                  type: 'transfer-cancel',
                  from: peerId,
                  transferId: data.transferId,
                  reason: data.reason || 'Transfer cancelled by user.'
                }));
              }
              transferRegistry.delete(data.transferId);
            }
          }
          break;
        }

        case 'signal-offer':
        case 'signal-answer':
        case 'ice-candidate': {
          const targetId = data.target;
          if (!targetId || !peers.has(targetId)) {
            ws.send(JSON.stringify({
              type: 'peer-not-found',
              target: targetId,
              message: 'Target peer is no longer connected.'
            }));
            return;
          }

          const targetPeer = peers.get(targetId);
          if (targetPeer && targetPeer.ws.readyState === WebSocket.OPEN) {
            targetPeer.ws.send(JSON.stringify({
              ...data,
              from: peerId,
              fromName: currentPeer.name,
              fromDeviceType: currentPeer.deviceType
            }));
          }
          break;
        }

        case 'ping': {
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        }

        default:
          break;
      }
    });

    ws.on('close', () => {
      peers.delete(peerId);
      // Clean up any transfers involving this peer
      for (const [txId, rec] of transferRegistry.entries()) {
        if (rec.senderId === peerId || rec.targetId === peerId) {
          transferRegistry.delete(txId);
        }
      }
      broadcastPeerList();
    });

    ws.on('error', () => {
      peers.delete(peerId);
      broadcastPeerList();
    });
  });

  // Heartbeat and transfer expiration timer
  const heartbeatTimer = setInterval(() => {
    const now = Date.now();

    // Expire stale transfers exceeding timeout
    for (const [txId, rec] of transferRegistry.entries()) {
      if (!rec.authorized && now - rec.createdAt > activeConfig.timeouts.transferRequestTimeoutMs) {
        const sender = peers.get(rec.senderId);
        if (sender && sender.ws.readyState === WebSocket.OPEN) {
          sender.ws.send(JSON.stringify({
            type: 'transfer-timeout',
            transferId: txId,
            message: 'Transfer request timed out waiting for recipient response.'
          }));
        }
        transferRegistry.delete(txId);
      }
    }

    // Ping peers
    for (const [id, peer] of peers.entries()) {
      if (peer.isAlive === false) {
        peer.ws.terminate();
        peers.delete(id);
        broadcastPeerList();
        continue;
      }
      peer.isAlive = false;
      try {
        peer.ws.ping();
      } catch (e) {
        peers.delete(id);
      }
    }
  }, activeConfig.heartbeatIntervalMs);

  if (heartbeatTimer.unref) {
    heartbeatTimer.unref();
  }

  function start(callback) {
    server.listen(activeConfig.port, activeConfig.host, () => {
      const isHttps = !!(activeConfig.https && activeConfig.https.enabled);
      const urls = getAccessUrls(activeConfig.host, activeConfig.port, isHttps);

      console.log('====================================================');
      console.log('           DTC Office Share - Phase 1               ');
      console.log('====================================================');
      console.log(`Server bound to: ${activeConfig.host}:${activeConfig.port}`);
      if (activeConfig.accessCode) {
        console.log(`Office Access Code: [ENABLED]`);
      }
      console.log('Open any of the following URLs in your browser:');
      for (const url of urls) {
        console.log(`  -> ${url}`);
      }
      console.log('----------------------------------------------------');
      console.log('Transfer method: Direct WebRTC P2P (LAN Encrypted)');
      console.log('====================================================');

      if (callback) callback();
    });
  }

  function close(callback) {
    clearInterval(heartbeatTimer);
    connectionLimiter.destroy();
    messageLimiter.destroy();

    for (const peer of peers.values()) {
      try {
        peer.ws.terminate();
      } catch (e) {}
    }
    peers.clear();
    transferRegistry.clear();

    wss.close(() => {
      server.close(callback);
    });
  }

  return {
    server,
    wss,
    start,
    close,
    peers,
    transferRegistry
  };
}

// Direct execution
if (require.main === module) {
  const app = createServer();
  app.start();

  process.on('SIGINT', () => {
    console.log('\nShutting down DTC Office Share server...');
    app.close(() => {
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    app.close(() => {
      process.exit(0);
    });
  });
}

module.exports = {
  createServer,
  isValidOrigin,
  validateTransferMetadata
};

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
 * Static file HTTP request handler.
 */
function handleHttpRequest(req, res) {
  // CORS / Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  // Basic API endpoint to check server health & network IPs
  if (req.url === '/api/info' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      name: 'DTC Office Share',
      version: '1.0.0',
      addresses: getLocalNetworkAddresses(),
      limits: config.limits
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
 * Creates and starts the DTC Office Share server.
 *
 * @param {object} [customConfig] Optional configuration overrides for testing
 * @returns {{ server: http.Server|https.Server, wss: WebSocketServer, close: Function }}
 */
function createServer(customConfig = {}) {
  const activeConfig = { ...config, ...customConfig };
  let server;

  if (activeConfig.https && activeConfig.https.enabled) {
    const key = fs.readFileSync(activeConfig.https.keyPath);
    const cert = fs.readFileSync(activeConfig.https.certPath);
    server = https.createServer({ key, cert }, handleHttpRequest);
  } else {
    server = http.createServer(handleHttpRequest);
  }

  const wss = new WebSocketServer({ server });

  // Rate limiters
  const connectionLimiter = new RateLimiter({
    maxRequests: activeConfig.rateLimiter.connectionsPerMinute,
    windowMs: activeConfig.rateLimiter.windowMs
  });

  const messageLimiter = new RateLimiter({
    maxRequests: activeConfig.rateLimiter.messagesPerSecond,
    windowMs: 1000
  });

  // Connected peers map: id -> { ws, id, name, deviceType, ip, joinedAt }
  const peers = new Map();

  /**
   * Broadcast current peer list to all connected clients.
   */
  function broadcastPeerList() {
    const peerList = Array.from(peers.values()).map(p => ({
      id: p.id,
      name: p.name,
      deviceType: p.deviceType,
      joinedAt: p.joinedAt
    }));

    for (const peer of peers.values()) {
      if (peer.ws.readyState === WebSocket.OPEN) {
        // Send everyone else excluding themselves as targetable peers
        const others = peerList.filter(p => p.id !== peer.id);
        peer.ws.send(JSON.stringify({
          type: 'peers',
          self: { id: peer.id, name: peer.name, deviceType: peer.deviceType },
          peers: others
        }));
      }
    }
  }

  /**
   * Handle incoming WebSocket connections.
   */
  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress || 'unknown';

    // IP rate limit check
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
      isAlive: true
    };

    peers.set(peerId, currentPeer);

    ws.on('pong', () => {
      currentPeer.isAlive = true;
    });

    ws.on('message', (rawMessage) => {
      // 1. Message size check
      if (rawMessage.length > activeConfig.limits.maxSignalMessageBytes) {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Signaling message size exceeded limit.'
        }));
        return;
      }

      // 2. Message rate limit check per peer
      if (!messageLimiter.allow(peerId)) {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Signaling rate limit exceeded. Slow down.'
        }));
        return;
      }

      // 3. Parse JSON
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

      // 4. Handle message types
      switch (data.type) {
        case 'join': {
          if (data.name && typeof data.name === 'string') {
            currentPeer.name = sanitizeFilename(data.name.slice(0, 40), currentPeer.name);
          }
          if (data.deviceType && typeof data.deviceType === 'string') {
            currentPeer.deviceType = data.deviceType.slice(0, 20);
          }
          broadcastPeerList();
          break;
        }

        case 'update-name': {
          if (data.name && typeof data.name === 'string') {
            currentPeer.name = sanitizeFilename(data.name.slice(0, 40), currentPeer.name);
            broadcastPeerList();
          }
          break;
        }

        // WebRTC signaling relay messages
        case 'signal-offer':
        case 'signal-answer':
        case 'ice-candidate':
        case 'transfer-request':
        case 'transfer-response':
        case 'transfer-cancel': {
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
      broadcastPeerList();
    });

    ws.on('error', (err) => {
      peers.delete(peerId);
      broadcastPeerList();
    });
  });

  // Heartbeat interval to detect stale/dead connections
  const heartbeatTimer = setInterval(() => {
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

    wss.close(() => {
      server.close(callback);
    });
  }

  return {
    server,
    wss,
    start,
    close,
    peers
  };
}

// If executed directly, run the server
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
  createServer
};

/**
 * DTC Office Share - WebSocket Signaling Client (Harden V2)
 */

class SignalingClient {
  constructor(options = {}) {
    this.url = options.url || this.getDefaultWsUrl();
    this.onPeersUpdate = options.onPeersUpdate || (() => {});
    this.onSignal = options.onSignal || (() => {});
    this.onTransferRequest = options.onTransferRequest || (() => {});
    this.onTransferResponse = options.onTransferResponse || (() => {});
    this.onTransferCancel = options.onTransferCancel || (() => {});
    this.onTransferTimeout = options.onTransferTimeout || (() => {});
    this.onAuthRequired = options.onAuthRequired || (() => {});
    this.onAuthSuccess = options.onAuthSuccess || (() => {});
    this.onError = options.onError || (() => {});
    this.onOpen = options.onOpen || (() => {});
    this.onClose = options.onClose || (() => {});

    this.ws = null;
    this.self = null;
    this.peers = [];
    this.reconnectTimer = null;
    this.shouldReconnect = true;
    this.accessCode = options.accessCode || '';
  }

  getDefaultWsUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  }

  setAccessCode(code) {
    this.accessCode = code;
  }

  connect(deviceProfile) {
    this.shouldReconnect = true;
    try {
      this.ws = new WebSocket(this.url);
    } catch (e) {
      this.onError('Failed to open WebSocket connection');
      this.scheduleReconnect(deviceProfile);
      return;
    }

    this.ws.onopen = () => {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      // Send join message including optional accessCode
      this.send({
        type: 'join',
        name: deviceProfile.name,
        deviceType: deviceProfile.deviceType,
        accessCode: this.accessCode || ''
      });
      this.onOpen();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg, deviceProfile);
      } catch (err) {
        console.error('Signaling parse error:', err);
      }
    };

    this.ws.onclose = () => {
      this.onClose();
      if (this.shouldReconnect) {
        this.scheduleReconnect(deviceProfile);
      }
    };

    this.ws.onerror = (err) => {
      console.warn('Signaling WebSocket error:', err);
    };
  }

  scheduleReconnect(deviceProfile) {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(deviceProfile);
    }, 2500);
  }

  handleMessage(msg, deviceProfile) {
    switch (msg.type) {
      case 'joined-success':
        this.self = msg.self;
        this.onAuthSuccess(msg.self);
        break;

      case 'auth-error':
        this.onAuthRequired(msg.message);
        break;

      case 'peers':
        this.self = msg.self;
        this.peers = msg.peers || [];
        this.onPeersUpdate(this.peers, this.self);
        break;

      case 'signal-offer':
      case 'signal-answer':
      case 'ice-candidate':
        this.onSignal(msg);
        break;

      case 'transfer-request':
        this.onTransferRequest(msg);
        break;

      case 'transfer-response':
        this.onTransferResponse(msg);
        break;

      case 'transfer-cancel':
        this.onTransferCancel(msg);
        break;

      case 'transfer-timeout':
        this.onTransferTimeout(msg);
        break;

      case 'transfer-rejected-server':
        this.onError(`Transfer rejected: ${msg.message}`);
        break;

      case 'error':
        this.onError(msg.message || 'Server error');
        break;

      case 'peer-not-found':
        this.onError(`Peer unavailable: ${msg.message}`);
        break;

      default:
        break;
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  updateName(name) {
    this.send({
      type: 'update-name',
      name
    });
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
    }
  }
}

if (typeof window !== 'undefined') {
  window.SignalingClient = SignalingClient;
}

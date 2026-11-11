/**
 * DTC Office Share - WebRTC Peer Connection Manager
 * Direct peer-to-peer connection establishment on local LAN (no external STUN/TURN).
 */

class PeerConnectionManager {
  constructor(options = {}) {
    this.signaling = options.signaling;
    this.onDataChannel = options.onDataChannel || (() => {});
    this.onConnectionStateChange = options.onConnectionStateChange || (() => {});
    this.onError = options.onError || (() => {});

    // Active peer connections: targetPeerId -> RTCPeerConnection
    this.connections = new Map();
    // Active data channels: targetPeerId -> RTCDataChannel
    this.dataChannels = new Map();
    // Pending ICE candidate queues: targetPeerId -> Array<candidate>
    this.pendingCandidates = new Map();

    // In a pure local LAN office setting without internet, we use empty iceServers
    // to strictly force local host candidate discovery and avoid external DNS lookups.
    this.rtcConfig = {
      iceServers: []
    };
  }

  /**
   * Get or create an RTCPeerConnection for a target peer.
   */
  getOrCreateConnection(targetId) {
    if (this.connections.has(targetId)) {
      const pc = this.connections.get(targetId);
      if (pc.signalingState !== 'closed' && pc.connectionState !== 'closed' && pc.connectionState !== 'failed') {
        return pc;
      }
      this.closeConnection(targetId);
    }

    let pc;
    try {
      pc = new RTCPeerConnection(this.rtcConfig);
    } catch (e) {
      console.error('Failed to create RTCPeerConnection:', e);
      this.onError(targetId, 'WebRTC is not supported or accessible in this context.');
      return null;
    }

    this.connections.set(targetId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.send({
          type: 'ice-candidate',
          target: targetId,
          candidate: event.candidate
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`Peer ${targetId} connection state:`, pc.connectionState);
      this.onConnectionStateChange(targetId, pc.connectionState);

      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        // Fail safely if peer-to-peer connectivity cannot be established
        this.onError(targetId, `LAN P2P connection to peer ${pc.connectionState}. Ensure client isolation is off.`);
      }
    };

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      this.setupDataChannel(targetId, channel);
    };

    return pc;
  }

  /**
   * Configure an RTCDataChannel with backpressure and message handlers.
   */
  setupDataChannel(targetId, channel) {
    channel.binaryType = 'arraybuffer';
    this.dataChannels.set(targetId, channel);

    channel.onopen = () => {
      console.log(`RTCDataChannel open with ${targetId}`);
      this.onDataChannel(targetId, channel);
    };

    channel.onclose = () => {
      console.log(`RTCDataChannel closed with ${targetId}`);
      this.dataChannels.delete(targetId);
    };

    channel.onerror = (err) => {
      console.warn(`RTCDataChannel error with ${targetId}:`, err);
    };
  }

  /**
   * Initiates a connection to targetId (as the caller).
   */
  async createOffer(targetId) {
    const pc = this.getOrCreateConnection(targetId);
    if (!pc) return null;

    // Caller creates the RTCDataChannel
    const channel = pc.createDataChannel('fileTransfer', {
      ordered: true
    });
    this.setupDataChannel(targetId, channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.signaling.send({
      type: 'signal-offer',
      target: targetId,
      sdp: pc.localDescription
    });

    return pc;
  }

  /**
   * Handles incoming signaling messages (offer, answer, ice-candidate).
   */
  async handleSignal(msg) {
    const fromId = msg.from;

    if (msg.type === 'signal-offer') {
      const pc = this.getOrCreateConnection(fromId);
      if (!pc) return;

      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));

      // Process any pending candidates buffered while awaiting remote description
      const pending = this.pendingCandidates.get(fromId) || [];
      for (const candidate of pending) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);
      }
      this.pendingCandidates.delete(fromId);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.signaling.send({
        type: 'signal-answer',
        target: fromId,
        sdp: pc.localDescription
      });
    } else if (msg.type === 'signal-answer') {
      const pc = this.connections.get(fromId);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));

        const pending = this.pendingCandidates.get(fromId) || [];
        for (const candidate of pending) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);
        }
        this.pendingCandidates.delete(fromId);
      }
    } else if (msg.type === 'ice-candidate') {
      const pc = this.connections.get(fromId);
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(console.warn);
      } else {
        // Buffer candidate until remote description is set
        if (!this.pendingCandidates.has(fromId)) {
          this.pendingCandidates.set(fromId, []);
        }
        this.pendingCandidates.get(fromId).push(msg.candidate);
      }
    }
  }

  getDataChannel(targetId) {
    return this.dataChannels.get(targetId);
  }

  closeConnection(targetId) {
    if (this.dataChannels.has(targetId)) {
      try {
        this.dataChannels.get(targetId).close();
      } catch (e) {}
      this.dataChannels.delete(targetId);
    }

    if (this.connections.has(targetId)) {
      try {
        this.connections.get(targetId).close();
      } catch (e) {}
      this.connections.delete(targetId);
    }

    this.pendingCandidates.delete(targetId);
  }

  destroy() {
    for (const targetId of this.connections.keys()) {
      this.closeConnection(targetId);
    }
  }
}

window.PeerConnectionManager = PeerConnectionManager;

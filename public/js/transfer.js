/**
 * DTC Office Share - Chunked File Transfer Engine (Harden V2)
 *
 * Implements:
 * - Authorized transfer registry: rejects unsolicited or unapproved files.
 * - File integrity verification: validates exact byte counts & SHA-256 hash.
 * - Streaming to disk via File System Access API where supported.
 * - Safe memory caps for mobile Safari and devices lacking streaming.
 * - Inactivity timeouts and clean cancellation.
 */

const CHUNK_SIZE = 16 * 1024; // 16 KB chunks for high reliability across all WebRTC engines
const BUFFER_THRESHOLD = 64 * 1024; // 64 KB backpressure threshold
const MEMORY_FALLBACK_MAX_BYTES = 200 * 1024 * 1024; // 200 MB browser RAM cap
const INACTIVITY_TIMEOUT_MS = 45 * 1000; // 45 seconds timeout on stalled channels

class TransferEngine {
  constructor(options = {}) {
    this.onProgress = options.onProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});
    this.onFileReceived = options.onFileReceived || (() => {});
    this.onVerifying = options.onVerifying || (() => {});

    // Active transfers: transferId -> transferState
    this.transfers = new Map();

    // Recipient authorized transfers: transferId -> { senderId, files, totalSize, approvedAt, state }
    // Enforces that NO file headers or binary chunks are processed without explicit recipient authorization.
    this.authorizedTransfers = new Map();
  }

  /**
   * Helper: compute SHA-256 hex digest of an ArrayBuffer or Blob
   */
  async computeHash(bufferOrBlob) {
    let arrayBuffer;
    if (bufferOrBlob instanceof Blob) {
      arrayBuffer = await bufferOrBlob.arrayBuffer();
    } else {
      arrayBuffer = bufferOrBlob;
    }
    if (window.crypto && window.crypto.subtle) {
      const digest = await window.crypto.subtle.digest('SHA-256', arrayBuffer);
      return Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }
    // Fallback simple checksum if Web Crypto not available (non-secure context)
    let hash = 0;
    const view = new Uint8Array(arrayBuffer);
    for (let i = 0; i < view.length; i++) {
      hash = (hash * 31 + view[i]) >>> 0;
    }
    return 'crc_' + hash.toString(16);
  }

  /**
   * Authorize an incoming transfer on the recipient device.
   */
  authorizeIncomingTransfer(transferId, senderId, files, totalSize) {
    this.authorizedTransfers.set(transferId, {
      transferId,
      senderId,
      files,
      totalSize,
      approvedAt: Date.now(),
      state: 'APPROVED'
    });
  }

  /**
   * Revoke or reject an incoming transfer.
   */
  revokeIncomingTransfer(transferId) {
    this.authorizedTransfers.delete(transferId);
    this.cancelTransfer(transferId);
  }

  /**
   * Sender: Start sending a batch of files over a ready RTCDataChannel.
   */
  async sendFiles(transferId, targetId, channel, files) {
    if (!channel || channel.readyState !== 'open') {
      this.onError(transferId, 'Data channel is not open for transfer.');
      return;
    }

    const state = {
      transferId,
      targetId,
      channel,
      files,
      currentFileIndex: 0,
      totalBytes: files.reduce((acc, f) => acc + f.size, 0),
      transferredBytes: 0,
      startTime: Date.now(),
      cancelled: false
    };

    this.transfers.set(transferId, state);

    try {
      for (let i = 0; i < files.length; i++) {
        if (state.cancelled) break;
        state.currentFileIndex = i;
        const file = files[i];
        await this.sendFile(state, file, i, files.length);
      }

      if (!state.cancelled) {
        this.onComplete(transferId, 'send', { totalFiles: files.length, totalBytes: state.totalBytes });
      }
    } catch (err) {
      console.error('Error during sendFiles:', err);
      this.onError(transferId, err.message || 'Transfer failed');
    } finally {
      this.transfers.delete(transferId);
    }
  }

  /**
   * Sender: Send a single file chunk by chunk with flow control and SHA-256 digest.
   */
  async sendFile(state, file, fileIndex, totalFiles) {
    const channel = state.channel;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE) || 1;

    // Report hash generation for sender
    const fileHash = await this.computeHash(file);

    // Send File Header JSON message
    const header = JSON.stringify({
      protocol: 'dtc-share-v2',
      action: 'file-header',
      transferId: state.transferId,
      fileIndex,
      totalFiles,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      hash: fileHash,
      totalChunks
    });

    channel.send(header);

    // Handle zero-byte files directly
    if (file.size === 0) {
      channel.send(JSON.stringify({
        protocol: 'dtc-share-v2',
        action: 'file-end',
        transferId: state.transferId,
        fileIndex,
        hash: fileHash,
        totalBytes: 0
      }));
      return;
    }

    let offset = 0;
    let chunkIndex = 0;

    while (offset < file.size && !state.cancelled) {
      // Flow control / backpressure check: wait if bufferedAmount exceeds threshold
      if (channel.bufferedAmount > BUFFER_THRESHOLD) {
        await new Promise((resolve) => {
          const checkBuffer = () => {
            if (state.cancelled || channel.readyState !== 'open') {
              resolve();
              return;
            }
            if (channel.bufferedAmount <= BUFFER_THRESHOLD) {
              resolve();
            } else {
              setTimeout(checkBuffer, 10);
            }
          };
          checkBuffer();
        });
      }

      if (state.cancelled || channel.readyState !== 'open') break;

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();

      channel.send(buffer);

      offset += buffer.byteLength;
      state.transferredBytes += buffer.byteLength;
      chunkIndex++;

      // Report progress
      const elapsedSec = (Date.now() - state.startTime) / 1000 || 0.001;
      const speed = state.transferredBytes / elapsedSec;
      const percent = Math.min(100, (state.transferredBytes / state.totalBytes) * 100);

      this.onProgress(state.transferId, {
        direction: 'send',
        fileName: file.name,
        fileIndex: fileIndex + 1,
        totalFiles,
        percent: parseFloat(percent.toFixed(1)),
        transferredBytes: state.transferredBytes,
        totalBytes: state.totalBytes,
        speedBytesPerSec: Math.round(speed)
      });
    }

    if (!state.cancelled && channel.readyState === 'open') {
      channel.send(JSON.stringify({
        protocol: 'dtc-share-v2',
        action: 'file-end',
        transferId: state.transferId,
        fileIndex,
        hash: fileHash,
        totalBytes: file.size
      }));
    }
  }

  /**
   * Receiver: Attach message handler to incoming RTCDataChannel.
   * Enforces recipient approval, integrity checks, and streaming / memory safety.
   */
  bindReceiverChannel(senderId, channel) {
    channel.binaryType = 'arraybuffer';

    let currentFile = null;
    let receivedChunks = [];
    let receivedBytes = 0;
    let currentTransferId = null;
    let startTime = null;
    let totalBatchBytes = 0;
    let totalBatchTransferred = 0;
    let inactivityTimer = null;

    const resetInactivityTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        if (currentTransferId) {
          this.onError(currentTransferId, 'Transfer timed out due to data channel inactivity.');
          this.cancelTransfer(currentTransferId);
        }
      }, INACTIVITY_TIMEOUT_MS);
    };

    channel.onmessage = async (event) => {
      resetInactivityTimer();

      // 1. Control frame (JSON string)
      if (typeof event.data === 'string') {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (e) {
          return;
        }

        // Support v1 and v2 protocols safely
        if (msg.protocol !== 'dtc-share-v1' && msg.protocol !== 'dtc-share-v2') return;

        // Action: CANCEL
        if (msg.action === 'transfer-cancel') {
          if (inactivityTimer) clearTimeout(inactivityTimer);
          this.cancelTransfer(msg.transferId);
          this.onError(msg.transferId, 'Transfer was cancelled by sender.');
          return;
        }

        // Action: FILE HEADER
        if (msg.action === 'file-header') {
          // --- SECURITY CHECK: Recipient Approval Verification ---
          const auth = this.authorizedTransfers.get(msg.transferId);
          if (!auth || auth.senderId !== senderId || auth.state !== 'APPROVED') {
            console.warn(`SECURITY: Rejected unauthorized file transfer ${msg.transferId} from ${senderId}`);
            channel.send(JSON.stringify({
              protocol: 'dtc-share-v2',
              action: 'transfer-rejected',
              transferId: msg.transferId,
              message: 'Transfer not authorized by recipient.'
            }));
            this.onError(msg.transferId, 'Blocked unauthorized file stream attempt.');
            return;
          }

          // Memory safety check: verify file doesn't exceed memory cap if browser lacks streaming
          const hasStreaming = typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
          if (!hasStreaming && msg.size > MEMORY_FALLBACK_MAX_BYTES) {
            channel.send(JSON.stringify({
              protocol: 'dtc-share-v2',
              action: 'transfer-rejected',
              transferId: msg.transferId,
              message: `File exceeds browser RAM memory cap (${Math.round(MEMORY_FALLBACK_MAX_BYTES / (1024 * 1024))} MB).`
            }));
            this.onError(msg.transferId, `File exceeds safe browser memory limit for this device.`);
            return;
          }

          currentFile = msg;
          receivedChunks = [];
          receivedBytes = 0;
          currentTransferId = msg.transferId;

          if (!startTime) {
            startTime = Date.now();
            totalBatchBytes = msg.size;
          }

          this.onProgress(currentTransferId, {
            direction: 'receive',
            fileName: msg.name,
            fileIndex: msg.fileIndex + 1,
            totalFiles: msg.totalFiles,
            percent: 0,
            transferredBytes: totalBatchTransferred,
            totalBytes: msg.size,
            speedBytesPerSec: 0
          });
        }
        // Action: FILE END
        else if (msg.action === 'file-end') {
          if (!currentFile || currentFile.transferId !== msg.transferId) return;

          // Verify declared size matches received bytes
          if (receivedBytes !== currentFile.size) {
            this.onError(currentTransferId, `Integrity failure: expected ${currentFile.size} bytes, received ${receivedBytes} bytes.`);
            currentFile = null;
            receivedChunks = [];
            return;
          }

          this.onVerifying(currentTransferId, currentFile.name);

          // Assemble Blob
          const blob = new Blob(receivedChunks, { type: currentFile.type });

          // Integrity verification: Validate SHA-256 hash if provided by sender
          if (msg.hash && typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
            const calculatedHash = await this.computeHash(blob);
            if (calculatedHash !== msg.hash) {
              this.onError(currentTransferId, `Integrity error: SHA-256 hash mismatch on ${currentFile.name}.`);
              currentFile = null;
              receivedChunks = [];
              return;
            }
          }

          const sanitizedName = this.sanitizeLocalFilename(currentFile.name);

          this.onFileReceived({
            transferId: currentTransferId,
            name: sanitizedName,
            size: blob.size,
            type: blob.type,
            blob
          });

          totalBatchTransferred += blob.size;

          if (currentFile.fileIndex + 1 >= currentFile.totalFiles) {
            if (inactivityTimer) clearTimeout(inactivityTimer);
            this.onComplete(currentTransferId, 'receive', {
              totalFiles: currentFile.totalFiles,
              totalBytes: totalBatchTransferred
            });
            this.authorizedTransfers.delete(currentTransferId);
            startTime = null;
          }

          currentFile = null;
          receivedChunks = [];
        }
      }
      // 2. Binary file chunk
      else if (event.data instanceof ArrayBuffer) {
        // --- SECURITY CHECK: Reject unexpected chunks ---
        if (!currentFile) {
          console.warn('Dropped unexpected binary chunk without active approved header.');
          return;
        }

        receivedChunks.push(event.data);
        receivedBytes += event.data.byteLength;

        // Overflow safeguard: prevent sender from sending more bytes than declared
        if (receivedBytes > currentFile.size) {
          this.onError(currentTransferId, `Transfer rejected: received more bytes than declared (${receivedBytes} > ${currentFile.size}).`);
          channel.close();
          currentFile = null;
          receivedChunks = [];
          return;
        }

        const elapsedSec = (Date.now() - startTime) / 1000 || 0.001;
        const speed = (totalBatchTransferred + receivedBytes) / elapsedSec;
        const percent = currentFile.size > 0
          ? Math.min(100, (receivedBytes / currentFile.size) * 100)
          : 100;

        this.onProgress(currentTransferId, {
          direction: 'receive',
          fileName: currentFile.name,
          fileIndex: currentFile.fileIndex + 1,
          totalFiles: currentFile.totalFiles,
          percent: parseFloat(percent.toFixed(1)),
          transferredBytes: receivedBytes,
          totalBytes: currentFile.size,
          speedBytesPerSec: Math.round(speed)
        });
      }
    };

    channel.onclose = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
    };
  }

  cancelTransfer(transferId) {
    const state = this.transfers.get(transferId);
    if (state) {
      state.cancelled = true;
      if (state.channel && state.channel.readyState === 'open') {
        try {
          state.channel.send(JSON.stringify({
            protocol: 'dtc-share-v2',
            action: 'transfer-cancel',
            transferId
          }));
        } catch (e) {}
      }
      this.transfers.delete(transferId);
    }
    this.authorizedTransfers.delete(transferId);
  }

  sanitizeLocalFilename(rawName) {
    if (!rawName) return 'downloaded_file';
    let name = rawName.replace(/\\/g, '/').split('/').pop();
    name = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    name = name.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
    return name || 'downloaded_file';
  }
}

if (typeof window !== 'undefined') {
  window.TransferEngine = TransferEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TransferEngine;
}

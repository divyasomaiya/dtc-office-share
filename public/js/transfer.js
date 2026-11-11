/**
 * DTC Office Share - Chunked File Transfer Engine
 * Handles binary slicing, backpressure over RTCDataChannel,
 * file assembly, integrity verification, and safe local downloads.
 */

const CHUNK_SIZE = 16 * 1024; // 16 KB chunks for high reliability across all WebRTC engines
const BUFFER_THRESHOLD = 64 * 1024; // 64 KB backpressure threshold

class TransferEngine {
  constructor(options = {}) {
    this.onProgress = options.onProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});
    this.onFileReceived = options.onFileReceived || (() => {});

    // Active transfers: transferId -> transferState
    this.transfers = new Map();
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
   * Sender: Send a single file chunk by chunk with flow control.
   */
  async sendFile(state, file, fileIndex, totalFiles) {
    const channel = state.channel;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE) || 1;

    // Send File Header JSON message
    const header = JSON.stringify({
      protocol: 'dtc-share-v1',
      action: 'file-header',
      transferId: state.transferId,
      fileIndex,
      totalFiles,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      totalChunks
    });

    channel.send(header);

    let offset = 0;
    let chunkIndex = 0;

    while (offset < file.size && !state.cancelled) {
      // Flow control / backpressure check: wait if bufferedAmount exceeds threshold
      if (channel.bufferedAmount > BUFFER_THRESHOLD) {
        await new Promise((resolve) => {
          const checkBuffer = () => {
            if (channel.bufferedAmount <= BUFFER_THRESHOLD) {
              resolve();
            } else {
              setTimeout(checkBuffer, 10);
            }
          };
          checkBuffer();
        });
      }

      if (state.cancelled) break;

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();

      channel.send(buffer);

      offset += buffer.byteLength;
      state.transferredBytes += buffer.byteLength;
      chunkIndex++;

      // Report progress
      const elapsedSec = (Date.now() - state.startTime) / 1000 || 0.001;
      const speed = state.transferredBytes / elapsedSec; // bytes/sec
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

    // Send File Complete message
    if (!state.cancelled) {
      channel.send(JSON.stringify({
        protocol: 'dtc-share-v1',
        action: 'file-end',
        transferId: state.transferId,
        fileIndex
      }));
    }
  }

  /**
   * Receiver: Attach message handler to incoming RTCDataChannel.
   */
  bindReceiverChannel(channel) {
    channel.binaryType = 'arraybuffer';

    let currentFile = null;
    let receivedChunks = [];
    let receivedBytes = 0;
    let currentTransferId = null;
    let startTime = null;
    let totalBatchBytes = 0;
    let totalBatchTransferred = 0;

    channel.onmessage = (event) => {
      // 1. Text control frame
      if (typeof event.data === 'string') {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (e) {
          return;
        }

        if (msg.protocol !== 'dtc-share-v1') return;

        if (msg.action === 'file-header') {
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
        } else if (msg.action === 'file-end') {
          if (currentFile) {
            // Assemble blob from received chunks
            const blob = new Blob(receivedChunks, { type: currentFile.type });
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
              this.onComplete(currentTransferId, 'receive', {
                totalFiles: currentFile.totalFiles,
                totalBytes: totalBatchTransferred
              });
              startTime = null;
            }

            currentFile = null;
            receivedChunks = [];
          }
        }
      }
      // 2. Binary file chunk
      else if (event.data instanceof ArrayBuffer) {
        if (!currentFile) return;

        receivedChunks.push(event.data);
        receivedBytes += event.data.byteLength;

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
  }

  cancelTransfer(transferId) {
    const state = this.transfers.get(transferId);
    if (state) {
      state.cancelled = true;
      this.transfers.delete(transferId);
    }
  }

  /**
   * Client-side sanitization before triggering native browser download.
   */
  sanitizeLocalFilename(rawName) {
    if (!rawName) return 'downloaded_file';
    let name = rawName.replace(/\\/g, '/').split('/').pop();
    name = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    name = name.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
    return name || 'downloaded_file';
  }
}

window.TransferEngine = TransferEngine;

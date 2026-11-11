/**
 * DTC Office Share - Main Frontend Application Logic
 */

(function () {
  'use strict';

  // --- Utility Functions ---
  function getDeviceType() {
    const ua = navigator.userAgent;
    if (/iPad|tablet/i.test(ua)) return 'tablet';
    if (/iPhone|Android|Mobile/i.test(ua)) return 'phone';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
    if (/Windows/i.test(ua)) return 'windows';
    if (/Linux/i.test(ua)) return 'linux';
    return 'desktop';
  }

  function getDeviceIconSvg(type) {
    switch (type) {
      case 'phone':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>`;
      case 'tablet':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>`;
      case 'mac':
      case 'windows':
      case 'linux':
      case 'desktop':
      default:
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`;
    }
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (typeof bytes !== 'number' || isNaN(bytes) || bytes < 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const val = bytes / Math.pow(k, i);
    return `${parseFloat(val.toFixed(2))} ${sizes[i]}`;
  }

  function formatSpeed(bytesPerSec) {
    return `${formatBytes(bytesPerSec)}/s`;
  }

  function showToast(message, duration = 3500) {
    const toast = document.getElementById('toast');
    const msg = document.getElementById('toast-message');
    msg.textContent = message;
    toast.style.display = 'block';
    if (window._toastTimer) clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => {
      toast.style.display = 'none';
    }, duration);
  }

  // --- Initial Profile Setup ---
  const deviceType = getDeviceType();
  const savedName = localStorage.getItem('dtc_device_name');
  const defaultName = savedName || `${deviceType.charAt(0).toUpperCase() + deviceType.slice(1)}-${Math.floor(1000 + Math.random() * 9000)}`;

  let currentProfile = {
    name: defaultName,
    deviceType: deviceType
  };

  // --- DOM Elements ---
  const myDeviceNameEl = document.getElementById('my-device-name');
  const myDeviceMetaEl = document.getElementById('my-device-meta');
  const myDeviceIconEl = document.getElementById('my-device-icon');
  const peerCountEl = document.getElementById('peer-count');
  const peersGridEl = document.getElementById('peers-grid');
  const emptyStateEl = document.getElementById('empty-state');
  const fileInputEl = document.getElementById('file-input');

  const btnEditName = document.getElementById('btn-edit-name');
  const modalEditName = document.getElementById('modal-edit-name');
  const inputDeviceName = document.getElementById('input-device-name');
  const btnSaveName = document.getElementById('btn-save-name');
  const btnCancelName = document.getElementById('btn-cancel-name');

  const btnNetworkInfo = document.getElementById('btn-network-info');
  const modalNetworkInfo = document.getElementById('modal-network-info');
  const btnCloseNetworkInfo = document.getElementById('btn-close-network-info');
  const networkUrlsList = document.getElementById('network-urls-list');

  const modalRequest = document.getElementById('modal-request');
  const requestSenderName = document.getElementById('request-sender-name');
  const requestFilesSummary = document.getElementById('request-files-summary');
  const requestFileCount = document.getElementById('request-file-count');
  const requestTotalSize = document.getElementById('request-total-size');
  const btnAcceptTransfer = document.getElementById('btn-accept-transfer');
  const btnRejectTransfer = document.getElementById('btn-reject-transfer');

  const transfersSection = document.getElementById('transfers-section');
  const transfersList = document.getElementById('transfers-list');
  const completedSection = document.getElementById('completed-section');
  const completedList = document.getElementById('completed-list');

  // Update UI with initial profile
  myDeviceNameEl.textContent = currentProfile.name;
  myDeviceIconEl.innerHTML = getDeviceIconSvg(currentProfile.deviceType);
  myDeviceMetaEl.textContent = `Connected as ${currentProfile.deviceType.toUpperCase()} on LAN`;

  // --- Application State ---
  let selectedTargetPeerId = null;
  let pendingIncomingTransfer = null; // { transferId, from, files, totalSize }

  // --- Transfer Engine ---
  const transferEngine = new TransferEngine({
    onProgress: (transferId, progress) => {
      renderTransferProgress(transferId, progress);
    },
    onComplete: (transferId, direction, info) => {
      removeTransferCard(transferId);
      showToast(`${direction === 'send' ? 'Sent' : 'Received'} ${info.totalFiles} file(s) (${formatBytes(info.totalBytes)}) successfully!`);
    },
    onError: (transferId, errMessage) => {
      removeTransferCard(transferId);
      showToast(`Transfer error: ${errMessage}`);
    },
    onFileReceived: (fileData) => {
      triggerDownload(fileData);
      renderCompletedItem(fileData);
    }
  });

  // --- Signaling Client ---
  const signaling = new SignalingClient({
    onOpen: () => {
      myDeviceMetaEl.textContent = `Online • ${currentProfile.deviceType.toUpperCase()} on LAN`;
    },
    onClose: () => {
      myDeviceMetaEl.textContent = 'Disconnected • Reconnecting to local server...';
    },
    onPeersUpdate: (peers, self) => {
      if (self) {
        currentProfile.name = self.name;
        myDeviceNameEl.textContent = self.name;
      }
      renderPeers(peers);
    },
    onSignal: (msg) => {
      peerManager.handleSignal(msg);
    },
    onTransferRequest: (msg) => {
      handleIncomingTransferRequest(msg);
    },
    onTransferResponse: (msg) => {
      handleTransferResponse(msg);
    },
    onTransferCancel: (msg) => {
      handleTransferCancel(msg);
    },
    onError: (err) => {
      showToast(err);
    }
  });

  // --- WebRTC Peer Connection Manager ---
  const peerManager = new PeerConnectionManager({
    signaling,
    onDataChannel: (targetId, channel) => {
      // Receiver binds incoming data channel
      transferEngine.bindReceiverChannel(channel);
    },
    onError: (targetId, errMessage) => {
      showToast(errMessage);
    }
  });

  // Connect to Signaling server
  signaling.connect(currentProfile);

  // --- UI Renderers ---
  function renderPeers(peers) {
    peerCountEl.textContent = `${peers.length} nearby device${peers.length === 1 ? '' : 's'}`;

    // Clean current peers (leave empty-state element)
    const existingButtons = peersGridEl.querySelectorAll('.peer-btn');
    existingButtons.forEach(btn => btn.remove());

    if (peers.length === 0) {
      emptyStateEl.style.display = 'block';
      return;
    }

    emptyStateEl.style.display = 'none';

    peers.forEach(peer => {
      const btn = document.createElement('button');
      btn.className = 'peer-btn';
      btn.dataset.peerId = peer.id;
      btn.title = `Click or drop files to send to ${peer.name}`;

      btn.innerHTML = `
        <div class="peer-icon-wrap">
          ${getDeviceIconSvg(peer.deviceType)}
        </div>
        <span class="peer-label">${escapeHtml(peer.name)}</span>
        <span class="peer-platform">${escapeHtml(peer.deviceType)}</span>
      `;

      // Click to select files for this peer
      btn.addEventListener('click', () => {
        selectedTargetPeerId = peer.id;
        fileInputEl.value = '';
        fileInputEl.click();
      });

      // Drag and drop onto specific peer
      btn.addEventListener('dragover', (e) => {
        e.preventDefault();
        btn.classList.add('drag-over');
      });

      btn.addEventListener('dragleave', () => {
        btn.classList.remove('drag-over');
      });

      btn.addEventListener('drop', (e) => {
        e.preventDefault();
        btn.classList.remove('drag-over');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          initiateSendFiles(peer.id, Array.from(e.dataTransfer.files));
        }
      });

      peersGridEl.appendChild(btn);
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m]));
  }

  // --- File Selection & Transfer Flow ---
  fileInputEl.addEventListener('change', () => {
    if (fileInputEl.files && fileInputEl.files.length > 0 && selectedTargetPeerId) {
      initiateSendFiles(selectedTargetPeerId, Array.from(fileInputEl.files));
    }
  });

  async function initiateSendFiles(targetPeerId, files) {
    if (!files || files.length === 0) return;

    const transferId = 'tx_' + Math.random().toString(36).substring(2, 9);
    const fileSummaries = files.map(f => ({ name: f.name, size: f.size, type: f.type }));
    const totalSize = files.reduce((acc, f) => acc + f.size, 0);

    // Save pending outgoing transfer state
    window._pendingSend = {
      transferId,
      targetId: targetPeerId,
      files,
      totalSize
    };

    showToast(`Requesting transfer approval from recipient...`);

    // Ensure WebRTC connection and data channel is initiated
    await peerManager.createOffer(targetPeerId);

    // Send transfer-request over signaling
    signaling.send({
      type: 'transfer-request',
      target: targetPeerId,
      transferId,
      files: fileSummaries,
      totalSize
    });
  }

  function handleIncomingTransferRequest(msg) {
    pendingIncomingTransfer = msg;
    requestSenderName.textContent = msg.fromName || 'Office Device';
    requestFileCount.textContent = `${msg.files.length} file${msg.files.length > 1 ? 's' : ''}`;
    requestTotalSize.textContent = formatBytes(msg.totalSize);

    requestFilesSummary.innerHTML = msg.files.map(f => `
      <div class="transfer-file-row">
        <span>${escapeHtml(f.name)}</span>
        <span>${formatBytes(f.size)}</span>
      </div>
    `).join('');

    modalRequest.style.display = 'flex';
  }

  btnAcceptTransfer.addEventListener('click', () => {
    if (!pendingIncomingTransfer) return;
    modalRequest.style.display = 'none';

    signaling.send({
      type: 'transfer-response',
      target: pendingIncomingTransfer.from,
      transferId: pendingIncomingTransfer.transferId,
      accepted: true
    });

    showToast('Transfer accepted! Receiving files...');
    pendingIncomingTransfer = null;
  });

  btnRejectTransfer.addEventListener('click', () => {
    if (!pendingIncomingTransfer) return;
    modalRequest.style.display = 'none';

    signaling.send({
      type: 'transfer-response',
      target: pendingIncomingTransfer.from,
      transferId: pendingIncomingTransfer.transferId,
      accepted: false
    });

    showToast('Transfer declined.');
    pendingIncomingTransfer = null;
  });

  async function handleTransferResponse(msg) {
    const pending = window._pendingSend;
    if (!pending || pending.transferId !== msg.transferId) return;

    if (!msg.accepted) {
      showToast('Transfer request was declined by recipient.');
      window._pendingSend = null;
      return;
    }

    showToast('Transfer accepted! Sending files...');
    const channel = peerManager.getDataChannel(pending.targetId);

    if (channel && channel.readyState === 'open') {
      transferEngine.sendFiles(pending.transferId, pending.targetId, channel, pending.files);
    } else {
      // If channel is still opening, wait for it
      let attempts = 0;
      const waitInterval = setInterval(() => {
        attempts++;
        const chan = peerManager.getDataChannel(pending.targetId);
        if (chan && chan.readyState === 'open') {
          clearInterval(waitInterval);
          transferEngine.sendFiles(pending.transferId, pending.targetId, chan, pending.files);
        } else if (attempts > 50) {
          clearInterval(waitInterval);
          showToast('Failed to establish peer data channel. Transfer aborted.');
        }
      }, 100);
    }

    window._pendingSend = null;
  }

  function handleTransferCancel(msg) {
    transferEngine.cancelTransfer(msg.transferId);
    removeTransferCard(msg.transferId);
    showToast('Transfer was cancelled by the other device.');
  }

  // --- Transfer UI Updates ---
  function renderTransferProgress(transferId, p) {
    transfersSection.style.display = 'block';

    let card = document.getElementById(`tx-${transferId}`);
    if (!card) {
      card = document.createElement('div');
      card.id = `tx-${transferId}`;
      card.className = 'transfer-card';
      card.innerHTML = `
        <div class="transfer-header">
          <span class="transfer-filename" id="tx-name-${transferId}">Starting...</span>
          <span class="transfer-meta" id="tx-meta-${transferId}">0%</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" id="tx-bar-${transferId}"></div>
        </div>
        <div class="transfer-footer">
          <span id="tx-speed-${transferId}">0 KB/s</span>
          <button class="btn-cancel-transfer" id="tx-cancel-${transferId}">Cancel</button>
        </div>
      `;

      card.querySelector(`#tx-cancel-${transferId}`).addEventListener('click', () => {
        transferEngine.cancelTransfer(transferId);
        removeTransferCard(transferId);
        showToast('Transfer cancelled.');
      });

      transfersList.appendChild(card);
    }

    const directionLabel = p.direction === 'send' ? 'Sending' : 'Receiving';
    card.querySelector(`#tx-name-${transferId}`).textContent = `${directionLabel} ${p.fileName} (${p.fileIndex}/${p.totalFiles})`;
    card.querySelector(`#tx-meta-${transferId}`).textContent = `${p.percent}% of ${formatBytes(p.totalBytes)}`;
    card.querySelector(`#tx-bar-${transferId}`).style.width = `${p.percent}%`;
    card.querySelector(`#tx-speed-${transferId}`).textContent = `${formatBytes(p.transferredBytes)} • ${formatSpeed(p.speedBytesPerSec)}`;
  }

  function removeTransferCard(transferId) {
    const card = document.getElementById(`tx-${transferId}`);
    if (card) card.remove();
    if (transfersList.children.length === 0) {
      transfersSection.style.display = 'none';
    }
  }

  function triggerDownload(fileData) {
    const url = URL.createObjectURL(fileData.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileData.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function renderCompletedItem(fileData) {
    completedSection.style.display = 'block';
    const item = document.createElement('div');
    item.className = 'completed-item';
    item.innerHTML = `
      <div class="completed-details">
        <span class="completed-name">${escapeHtml(fileData.name)}</span>
        <span class="completed-size">${formatBytes(fileData.size)}</span>
      </div>
      <button class="btn btn-secondary btn-mini" title="Download again">Download</button>
    `;

    item.querySelector('button').addEventListener('click', () => {
      triggerDownload(fileData);
    });

    completedList.prepend(item);
  }

  // --- Modals & User Preferences ---
  btnEditName.addEventListener('click', () => {
    inputDeviceName.value = currentProfile.name;
    modalEditName.style.display = 'flex';
    inputDeviceName.focus();
  });

  btnCancelName.addEventListener('click', () => {
    modalEditName.style.display = 'none';
  });

  btnSaveName.addEventListener('click', () => {
    const newName = inputDeviceName.value.trim();
    if (newName) {
      currentProfile.name = newName;
      localStorage.setItem('dtc_device_name', newName);
      myDeviceNameEl.textContent = newName;
      signaling.updateName(newName);
    }
    modalEditName.style.display = 'none';
  });

  btnNetworkInfo.addEventListener('click', async () => {
    modalNetworkInfo.style.display = 'flex';
    try {
      const res = await fetch('/api/info');
      const data = await res.json();
      const currentPort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
      const proto = window.location.protocol;

      if (data.addresses && data.addresses.length > 0) {
        networkUrlsList.innerHTML = data.addresses.map(addr => `
          <div><code>${proto}//${addr.address}:${currentPort}</code> (${addr.interface})</div>
        `).join('');
      } else {
        networkUrlsList.innerHTML = `<code>${window.location.origin}</code>`;
      }
    } catch (e) {
      networkUrlsList.innerHTML = `<code>${window.location.origin}</code>`;
    }
  });

  btnCloseNetworkInfo.addEventListener('click', () => {
    modalNetworkInfo.style.display = 'none';
  });
})();

# DTC Office Share

> **Phase 1: Free, Self-Hosted, LAN-Based Peer-to-Peer File Sharing for Office Networks**
> Inspired by Snapdrop and ToffeeShare.

DTC Office Share is a lightweight, zero-cloud web application designed for fast, direct, encrypted file transfers between Windows PCs, MacBooks, iPhones, iPads, and Android devices connected to the same office network (Ethernet or Wi-Fi).

No Bluetooth or internet connection is required. Files never leave your local office network.

---

## Key Features in Phase 1

- **Local Device Discovery:** Automatically discovers other office devices connected to the same local network and displays them in a clean radar interface.
- **Direct WebRTC P2P Transfers:** Files are transferred directly between devices using encrypted `RTCDataChannel` streams with automatic chunking and flow control.
- **Cross-Platform & Cross-Medium:** Seamless transfers between Ethernet-connected Windows PCs, Wi-Fi MacBooks, Android devices, and iOS iPhones/iPads.
- **Transfer Authorization:** Recipients must explicitly accept or reject file transfer requests before transfers begin.
- **Multi-File Batch Support:** Queue and send multiple files simultaneously with individual and aggregate progress tracking.
- **Real-Time Transfer Metrics:** Displays filename, transfer speed (KB/s or MB/s), percentage, and bytes transferred.
- **Safe Filename Sanitization:** Protects against path traversal attacks (`../`), Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`), and illegal characters.
- **Rate Limiting & Safety Limits:** In-memory sliding-window rate limiters prevent connection floods and message spam.
- **Zero Cloud / Zero External CDN:** Purely self-hosted with no external dependencies or external signaling servers.

---

## Architecture Overview

```text
+-----------------------+              +-----------------------+
|  Windows Office PC    |              |      MacBook /        |
|  (Wired Ethernet)     |              |   Mobile (Wi-Fi)      |
|                       |              |                       |
|   Web Browser         |              |   Web Browser         |
+-----------+-----------+              +-----------+-----------+
            |                                      |
            |   1. WebSocket Signaling             |
            +------------+            +------------+
                         |            |
                         v            v
                 +----------------------------+
                 |  Node.js Signaling Server  |
                 |  Bound to 0.0.0.0:3000     |
                 |  (Local LAN Office Server) |
                 +----------------------------+
                               |
   2. WebRTC Peer Connection   |
   (Direct DTLS/SCTP Channel)  |
            +------------------+-------------------+
            |                                      |
            |<==== Encrypted Direct File Data ====>|
```

---

## Quick Start

### 1. Requirements
- Node.js version 18.0 or later installed on the host office computer.

### 2. Installation
Clone the repository and install the single lightweight dependency (`ws`):
```bash
git clone <repository-url>
cd dtc-office-share
npm install
```

### 3. Starting the Server

#### On Windows (One-Click)
- Double-click `scripts\start.bat`
  *or* run `powershell -File scripts\start.ps1`

#### On Linux / macOS / Terminal
```bash
npm start
```

By default, the server binds to `0.0.0.0:3000`. You can customize the host or port using environment variables:
```bash
PORT=8080 HOST=0.0.0.0 npm start
```

---

## Documentation

- [Local Network & Device Setup Guide](docs/NETWORK_SETUP.md) (Windows, macOS, iOS, Android, Firewall settings, AP isolation)
- [Security & Privacy Documentation](docs/SECURITY.md) (Local encryption, secure context, filename sanitization, rate limiting)
- [Manual Real-Device Testing Checklist](docs/MANUAL_TESTING_CHECKLIST.md) (Cross-platform acceptance matrix)

---

## Automated Tests

Run the comprehensive automated test suite (uses Node.js native test runner):
```bash
npm test
```

Tests cover:
- Path traversal & filename sanitization (`tests/sanitizer.test.js`)
- Rate limiting & flood protection (`tests/rate-limiter.test.js`)
- Network interface & IP detection (`tests/network-utils.test.js`)
- WebSocket signaling & WebRTC handshake relay (`tests/signaling.test.js`)

---

## License

MIT

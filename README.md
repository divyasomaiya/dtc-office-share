# DTC Office Share

> **Phase 1: Free, Self-Hosted, LAN-Based Peer-to-Peer File Sharing for Office Networks**
> Inspired by Snapdrop and ToffeeShare.

DTC Office Share is a lightweight, zero-cloud web application designed for fast, direct, encrypted file transfers between Windows PCs, MacBooks, iPhones, iPads, and Android devices connected to the same office network (Ethernet or Wi-Fi).

No Bluetooth or internet connection is required. Files never leave your local office network.

---

## Key Features in Phase 1

- **Local Device Discovery:** Automatically discovers other office devices connected to the same local network and displays them in a clean radar interface.
- **Enforced Recipient Authorization:** Recipient must explicitly approve incoming transfer requests. An authorized transfer registry prevents unsolicited or unapproved binary data transmission.
- **Direct WebRTC P2P Transfers:** Files are transferred directly between devices using encrypted `RTCDataChannel` streams with automatic chunking and flow control.
- **File Integrity Verification:** Exact byte count and cryptographic SHA-256 digest validation prevents truncated or corrupted downloads.
- **Cross-Platform & Cross-Medium:** Seamless transfers between Ethernet-connected Windows PCs, Wi-Fi MacBooks, Android devices, and iOS iPhones/iPads.
- **Memory Safety & Streaming:** Direct-to-disk streaming where supported (File System Access API) and safe RAM limits (200 MB fallback cap) for mobile browsers such as iOS Safari.
- **Multi-File Batch Support:** Queue and send multiple files simultaneously with individual and aggregate progress tracking.
- **Safe Filename Handling:** Protects against path traversal attacks (`../`), Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`), and illegal characters.
- **Security & Access Control:** Optional shared office access code (`ACCESS_CODE`), Origin header verification, and in-memory rate limiting.
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
Clone the repository and install dependencies:
```bash
git clone <repository-url>
cd dtc-office-share
npm install
```

### 3. Starting the Server

#### On Windows (One-Click)
- Double-click `scripts\start.bat`
  *or* run `powershell -File scripts\start.ps1`

The startup script automatically changes directory to the repository root and checks for Node.js and npm before launching.

#### On Linux / macOS / Terminal
```bash
npm start
```

#### Configuration Options
Customize server configuration via environment variables:
```bash
PORT=8080 HOST=0.0.0.0 ACCESS_CODE=OfficeSecret123 npm start
```

- `PORT`: Server port (default: `3000`).
- `HOST`: Server bind address (default: `0.0.0.0`).
- `ACCESS_CODE`: Optional shared office passcode required for devices to join.
- `USE_HTTPS`: Set to `true` to enable TLS with `SSL_KEY_PATH` and `SSL_CERT_PATH`.
- `ALLOWED_ORIGINS`: Optional comma-separated list of allowed origins.

---

## Documentation

- [Local Network & Device Setup Guide](docs/NETWORK_SETUP.md) (Windows, macOS, iOS, Android, Firewall settings, AP isolation)
- [Security & Privacy Documentation](docs/SECURITY.md) (Recipient authorization, integrity checks, secure context, memory limits, Origin checks)
- [Manual Real-Device Testing Checklist](docs/MANUAL_TESTING_CHECKLIST.md) (Cross-platform acceptance matrix with status disclaimers)

---

## Automated Tests

Run the unit and protocol test suite using Node.js native test runner:
```bash
npm test
```

Run the end-to-end browser WebRTC transfer test:
```bash
python3 tests/e2e_webrtc_transfer.py
```

Tests cover:
- Recipient authorization registry and unsolicited file rejection
- Path traversal & filename sanitization (`tests/sanitizer.test.js`)
- Rate limiting & flood protection (`tests/rate-limiter.test.js`)
- Transfer metadata & file limits (`tests/transfer-limits.test.js`)
- Network interface & IP detection (`tests/network-utils.test.js`)
- WebSocket signaling, access code auth, and relay (`tests/signaling.test.js`)
- Browser E2E WebRTC transfer and integrity verification (`tests/e2e_webrtc_transfer.py`)

---

## License

This project is licensed under the [MIT License](LICENSE).

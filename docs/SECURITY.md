# Security & Reliability Documentation

## 1. Threat Model & Design Principles

DTC Office Share was built strictly for **in-office, local area network file transfers**.
Its primary architectural design principle is: **Zero External Transmission**.

- **No External Cloud Servers:** No signaling data, file payloads, metadata, or telemetry are ever sent to public cloud servers, external CDNs, or third-party analytics services.
- **Pure Local WebRTC P2P:** File data is transferred directly between browser endpoints via encrypted `RTCDataChannel` (DTLS-SRTP / SCTP). The server acts only as a local signaling relay for exchange of SDP session descriptions and ICE candidates.
- **In-Memory Volatility:** The signaling server never saves, caches, or inspects the file contents being transferred.

---

## 2. Recipient Transfer Authorization

A major security requirement is ensuring that no sender (malicious or otherwise) can force files onto a recipient device without approval:

1. **Authorized Transfer Registry:**
   The receiver's transfer engine maintains an internal `authorizedTransfers` map keyed by `transferId` and verified against the sender's peer ID.
2. **Strict Pre-Approval Gate:**
   If a sender transmits a `file-header` or binary chunk before the recipient clicks **Accept & Download**, or if the `transferId` does not match an approved session, the transfer is immediately rejected, binary chunks are dropped, and an error is raised.
3. **Cancellation & Expiration:**
   If either party cancels or if the handshake exceeds 60 seconds, authorization is purged and channels are reset.

---

## 3. File Integrity & Verification

1. **Declared vs. Received Byte Validation:**
   The receiver tracks received chunk lengths. If total received bytes do not match the sender's declared size, the file is rejected and marked as corrupted.
2. **Cryptographic SHA-256 Digest:**
   Before sending, the sender computes the SHA-256 digest (via Web Crypto `crypto.subtle.digest`). Upon receiving all chunks, the receiver independently calculates the SHA-256 digest of the assembled blob. The transfer only completes if the hashes match.
3. **No Premature Completion:**
   The UI will not show completion or trigger downloads until integrity verification succeeds.

---

## 4. Large-File Memory Handling & Browser-Specific Limits

Accumulating multi-gigabyte files in RAM can crash browser tabs, particularly on mobile devices:

- **File System Access API (Direct Streaming):**
  On supported desktop browsers (Chrome, Edge, Opera), files can be written directly to disk chunk by chunk without unbounded memory buildup.
- **Fallback Memory Cap (iOS Safari & Mobile):**
  Mobile browsers (specifically iOS Safari) do not yet support `showSaveFilePicker` and impose strict WebKit RAM limits (typically 200 MB–500 MB per tab). DTC Office Share enforces a documented 200 MB memory cap for devices relying on Blob accumulation in RAM. Files exceeding this limit are safely rejected with an informative prompt before transfer begins.
- **Zero-Byte File Handling:**
  Empty (0 byte) files are recognized and handled as control-only transfers without allocating empty buffers.

---

## 5. Network Access Control & Origin Validation

1. **Shared Office Access Code:**
   When configured with `ACCESS_CODE=...`, only users in the office who provide the passcode can join the signaling pool and discover peers.
2. **WebSocket Origin Validation:**
   The server checks the HTTP `Origin` header on incoming WebSocket upgrade requests:
   - Matches the Host header by default to prevent Cross-Site WebSocket Hijacking (CSWSH) from malicious external websites.
   - Allows explicit whitelist configuration via `ALLOWED_ORIGINS`.
   - *Limitation:* The `Origin` header provides protection against browser-based drive-by attacks from malicious third-party websites. However, non-browser clients (such as local CLI tools or scripts) can forge headers on the LAN. Thus, office Wi-Fi security (WPA3-Enterprise / WPA2) and optional access codes are the primary defenses.

---

## 6. Browser Secure Context & WebRTC Requirements

Modern web browsers enforce security boundaries around WebRTC and certain web APIs depending on whether the page is served in a **Secure Context** (`https:` or `localhost`).

### Localhost vs. LAN IP
- `http://localhost:3000` is automatically treated as a secure context by Chromium and Safari.
- When accessing the server over an unencrypted local IP address (e.g. `http://192.168.1.45:3000`):
  - In Chromium (Chrome, Edge) and Firefox, WebRTC Data Channels function over LAN IP addresses.
  - However, some mobile browsers or specific security settings may flag non-localhost HTTP as "Not Secure".

### Enabling HTTPS with Local TLS Certificates
For organizations requiring full HTTPS secure context:
1. Generate a local self-signed or internal CA certificate:
   ```bash
   openssl req -x509 -newkey rsa:2048 -keyout server.key -out server.crt -days 365 -nodes -subj "/CN=office-share.local"
   ```
2. Launch DTC Office Share with HTTPS enabled:
   ```bash
   USE_HTTPS=true SSL_KEY_PATH=./server.key SSL_CERT_PATH=./server.crt npm start
   ```
3. Install or trust the certificate on the client devices if using an internal private CA.

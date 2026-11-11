# Security Documentation

## 1. Threat Model & Design Principles

DTC Office Share was built strictly for **in-office, local area network file transfers**.
Its primary architectural design principle is: **Zero External Transmission**.

- **No External Cloud Servers:** No signaling data, file payloads, metadata, or telemetry are ever sent to public cloud servers, external CDNs, or third-party analytics services.
- **Pure Local WebRTC P2P:** File data is transferred directly between browser endpoints via encrypted `RTCDataChannel` (DTLS-SRTP / SCTP). The server acts only as a local signaling relay for exchange of SDP session descriptions and ICE candidates.
- **In-Memory Volatility:** The signaling server never saves, caches, or inspects the file contents being transferred.

---

## 2. Browser Secure Context & WebRTC Requirements

Modern web browsers enforce security boundaries around WebRTC and certain web APIs depending on whether the page is served in a **Secure Context** (`https:` or `localhost`).

### Localhost vs. LAN IP
- `http://localhost:3000` is automatically treated as a secure context by Chromium and Safari.
- When accessing the server over an unencrypted local IP address (e.g. `http://192.168.1.45:3000`):
  - In Chromium (Chrome, Edge) and Firefox, WebRTC Data Channels function over LAN IP addresses.
  - However, some mobile browsers or specific security settings may flag non-localhost HTTP as "Not Secure".

### Enabling HTTPS with Local TLS Certificates
For organizations with strict mobile browser policies requiring full HTTPS secure context:
1. Generate a local self-signed or internal CA certificate:
   ```bash
   openssl req -x509 -newkey rsa:2048 -keyout server.key -out server.crt -days 365 -nodes -subj "/CN=office-share.local"
   ```
2. Launch DTC Office Share with HTTPS enabled:
   ```bash
   USE_HTTPS=true SSL_KEY_PATH=./server.key SSL_CERT_PATH=./server.crt npm start
   ```
3. Install or trust the certificate on the client devices if using an internal private CA.

---

## 3. Filename Sanitization & Path Traversal Prevention

When files are received across devices, their filenames originate from the sender's device. To prevent security vulnerabilities on recipient machines:

1. **Path Traversal Protection:**
   All forward slashes (`/`) and backward slashes (`\`) are stripped via `path.posix.basename`. Files cannot write outside the user's default browser download directory.
2. **Forbidden Character Cleansing:**
   Characters forbidden across operating systems (`< > : " / \ | ? *` and ASCII control characters `\x00-\x1F`) are replaced with underscores (`_`).
3. **Windows Reserved Name Prevention:**
   DOS/Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1` through `COM9`, `LPT1` through `LPT9`) are automatically prefixed with `safe_` to prevent file system lockup or execution vulnerabilities.
4. **Filename Length Clamping:**
   Filenames exceeding 255 characters are truncated to maintain filesystem safety while preserving file extensions.

---

## 4. Rate Limiting & Denial of Service Protection

The signaling server implements in-memory sliding-window rate limiting:
- **Connection Rate Limiter:** Protects against connection flood attacks by limiting client IP handshakes.
- **Message Frequency Limiter:** Prevents misbehaving clients or scripts from flooding the signaling channel with high-frequency messages.
- **Payload Size Capping:** Restricts WebSocket message frames to 64 KB, rejecting oversized or malformed frames before JSON deserialization.

---

## 5. Network Isolation & AP Isolation Considerations

1. **Client Isolation:**
   Many enterprise guest networks isolate wireless stations to prevent client-to-client communication. DTC Office Share requires peer-to-peer communication. Ensure users connect to the trusted office LAN or disable AP isolation.
2. **VLAN Segmentation:**
   If desktop PCs are on a wired VLAN and mobile devices are on a Wi-Fi VLAN, router firewall rules must allow TCP traffic on port 3000 as well as peer-to-peer UDP traffic for WebRTC.

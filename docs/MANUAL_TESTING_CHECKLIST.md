# Real-Device Manual Acceptance Testing Checklist

> **Disclaimer:**
> This checklist details the test procedures and acceptance criteria required for physical real-device verification. Automated tests have verified the server, signaling protocol, sanitization, and rate limiter. In accordance with testing guidelines, real-device test items are **marked pending until physical hardware validation is performed in the target office environment**.

---

## Device Test Matrix

| Device ID | Platform & Model | Operating System | Web Browser | Status |
|:---|:---|:---|:---|:---|
| DEV-01 | Host PC (Windows 10/11) | Windows 10/11 Pro | Google Chrome / Microsoft Edge | Pending Physical Test |
| DEV-02 | MacBook Pro / Air | macOS Sonoma / Sequoia | Safari / Google Chrome | Pending Physical Test |
| DEV-03 | Android Smartphone | Android 13+ | Google Chrome Mobile | Pending Physical Test |
| DEV-04 | iPhone / iPad | iOS / iPadOS 16+ | Mobile Safari | Pending Physical Test |

---

## Acceptance Test Scenarios

### 1. Server Startup & Network Binding
- [ ] Run `scripts\start.bat` on Windows host PC.
- [ ] Verify console displays correct local IP addresses (e.g. `192.168.1.x:3000`).
- [ ] Confirm Windows Firewall rule permits inbound traffic on port 3000.

### 2. Device Discovery & Identification
- [ ] Open `http://<HOST-IP>:3000` on Windows PC (DEV-01) and MacBook (DEV-02).
- [ ] Verify DEV-01 displays DEV-02 in the radar grid, and vice versa.
- [ ] Verify device type icons accurately reflect desktop, laptop, or mobile platforms.
- [ ] Edit device name on DEV-01 (e.g., "Office-Desktop"); verify DEV-02 sees the name change in real-time.

### 3. Cross-Platform Single File Transfer (Desktop to Desktop)
- [ ] From DEV-01 (Windows), select a single file (e.g. 25 MB PDF or ZIP) targeting DEV-02 (MacBook).
- [ ] Verify DEV-02 displays the incoming transfer prompt showing sender name, filename, and file size.
- [ ] Click **Decline**; verify DEV-01 receives immediate cancellation notification.
- [ ] Re-initiate transfer and click **Accept & Download** on DEV-02.
- [ ] Verify real-time progress bar, percentage, and transfer speed updates on both devices.
- [ ] Verify downloaded file on DEV-02 matches exact size and checksum of original file.

### 4. Cross-Medium Transfer (Ethernet PC to Wi-Fi Phone/Tablet)
- [ ] Ensure Windows PC is connected via Ethernet cable and Android/iPhone via office Wi-Fi.
- [ ] Send a 50 MB video file from phone (DEV-03) to Windows PC (DEV-01).
- [ ] Accept transfer on Windows PC.
- [ ] Verify transfer completes without dropouts.

### 5. Multi-File Batch Transfer
- [ ] Select 5 files of varying sizes (e.g. PNGs, documents, audio) on DEV-02.
- [ ] Send to DEV-04 (iPhone/iPad).
- [ ] Accept transfer on DEV-04.
- [ ] Verify all 5 files stream sequentially, showing overall and per-file progress, and download to the device.

### 6. Filename Safety Verification
- [ ] Send a file with characters such as `test:report*2026?.pdf` or path sequences `../../secret.txt`.
- [ ] Verify recipient browser sanitizes the filename to `test_report_2026_.pdf` or `secret.txt` without path traversal.
- [ ] Send a file named `CON.txt` or `aux.dat` to a Windows recipient; verify it saves safely as `safe_CON.txt` / `safe_aux.dat`.

### 7. Failure Handling & Disconnect Recovery
- [ ] Start a transfer of a large file (e.g., 500 MB).
- [ ] Disconnect Wi-Fi on the sender mid-transfer.
- [ ] Verify recipient displays a clean transfer cancellation message without infinite hang.
- [ ] Re-enable Wi-Fi and confirm device automatically reconnects to signaling and re-appears in the peer list.

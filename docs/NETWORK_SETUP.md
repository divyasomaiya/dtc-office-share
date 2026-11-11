# Local Network Setup Instructions

This document provides step-by-step instructions for running and testing **DTC Office Share** across various operating systems and mobile devices on an office local area network (LAN/Wi-Fi).

---

## 1. Prerequisites
- One computer hosting the server (Windows, macOS, or Linux).
- Node.js (version 18 or newer).
- All devices (PCs, MacBooks, iPhones, iPads, Android) must be connected to the **same local network subnet** (either via Wi-Fi or Ethernet cable).

---

## 2. Server Host Setup (Windows Office PC)

1. **Clone or copy the DTC Office Share repository** to the host PC:
   ```cmd
   git clone <repo-url>
   cd dtc-office-share
   ```
2. **Install dependencies:**
   ```cmd
   npm install
   ```
3. **Start the server:**
   - Either double-click `scripts\start.bat`
   - Or open PowerShell / Command Prompt and run:
     ```cmd
     npm start
     ```
4. **Identify the host IP address:**
   When the server starts, it prints all detected network URLs in the terminal, for example:
   ```text
   ====================================================
              DTC Office Share - Phase 1
   ====================================================
   Server bound to: 0.0.0.0:3000
   Open any of the following URLs in your browser:
     -> http://localhost:3000
     -> http://192.168.1.45:3000 (Ethernet)
     -> http://192.168.1.88:3000 (Wi-Fi)
   ====================================================
   ```
   Take note of your LAN IPv4 address (e.g. `192.168.1.45`).

---

## 3. Windows Firewall Configuration

By default, Windows Defender Firewall may prompt to allow Node.js network access when running on `0.0.0.0`.
If other office devices cannot connect to the server's IP address:

1. Open **Windows Defender Firewall with Advanced Security**.
2. Click **Inbound Rules** > **New Rule...**.
3. Select **Port** > Click **Next**.
4. Choose **TCP** and specify port **`3000`** (or your custom port) > Click **Next**.
5. Select **Allow the connection** > Click **Next**.
6. Check **Private** (and Domain if in active domain) > Click **Next**.
7. Name it `DTC Office Share (Port 3000)` and click **Finish**.

Alternatively, via Administrator PowerShell:
```powershell
New-NetFirewallRule -DisplayName "DTC Office Share" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

---

## 4. Connecting Office Devices

### A. Windows PCs & MacBooks (Chrome, Edge, Safari, Firefox, Brave)
1. Open any modern web browser.
2. Navigate to `http://<HOST-IP>:3000` (e.g. `http://192.168.1.45:3000`).
3. You will immediately see other connected devices in the device radar.
4. Click any device to select files, or drag and drop files onto the peer button.

### B. Android Devices (Chrome, Firefox, Samsung Internet)
1. Ensure the phone or tablet is connected to the same office Wi-Fi SSID.
2. Open Chrome or Firefox.
3. Enter `http://<HOST-IP>:3000` in the address bar.
4. You will see your device appear and can tap any peer to send photos, videos, or documents from your storage.

### C. iPhone & iPad (Safari, Chrome on iOS)
1. Connect iPhone or iPad to the office Wi-Fi network.
2. Open Safari.
3. If prompted about "Local Network" permissions, tap **Allow**.
4. Enter `http://<HOST-IP>:3000`.
5. When a file is sent to your device, tap **Accept & Download**. Safari will prompt to download and save the file to your Files app.

---

## 5. Network Isolation & AP Client Isolation Troubleshooting

- **Symptom:** Devices can load the website, but see 0 devices or peer connection fails.
- **Cause:** Enterprise or guest Wi-Fi networks often have **AP Client Isolation** (also called Wireless Client Isolation or Station Isolation) enabled. This blocks devices on the Wi-Fi network from communicating directly with each other.
- **Resolution:**
  - Connect to the primary office/internal Wi-Fi network instead of guest Wi-Fi.
  - If administering the office router/AP, disable "Client Isolation" or "AP Isolation" for the office subnet.
  - Ensure Ethernet PCs and Wi-Fi devices reside on the same VLAN/subnet (e.g., `192.168.1.x`).

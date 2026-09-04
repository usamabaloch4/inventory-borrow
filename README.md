# GearTrack — Local Studio Equipment & Checkout Tracker

An offline-first, high-precision inventory tracking and gear checkout portal designed for photography studios and production crews.

---

## Quick Start

### Windows (One-Click)
1. Double-click [`start_geartrack.bat`](./start_geartrack.bat).
2. It automatically installs dependencies (first time only) and opens `http://localhost:3000` in your default browser.

### macOS (One-Click)
1. Double-click [`start_geartrack.command`](./start_geartrack.command).
2. It starts the server and opens `http://localhost:3000`.

### Manual Start (Any OS)
```bash
# 1. Install dependencies (Node.js 18+ required)
npm install

# 2. Start the local server
npm start
```

---

## Windows Firewall & Mobile Access Setup

If you run GearTrack on a Windows desktop and want to use your mobile phone as a wireless barcode scanner, run this command once in **Command Prompt (or PowerShell) as Administrator** to allow incoming LAN traffic:

```cmd
netsh advfirewall firewall add rule name="GearTrack" dir=in action=allow protocol=TCP localport=3000,3443
```

### Network Profile Configuration
1. Open **Windows Settings** &rarr; **Network & Internet** &rarr; **Wi-Fi** (or **Ethernet**).
2. Click on your active connection properties.
3. Ensure Network Profile is set to **Private network** (Windows blocks incoming device connections on "Public network").

---

## Connecting a Mobile Phone as a Scanner

1. Ensure your smartphone is on the **same local Wi-Fi** as your computer.
2. Click **"Connect Phone"** in the top navigation bar of the desktop portal.
3. If your desktop has multiple network adapters (e.g. Wi-Fi + WSL/VirtualBox/VPN), select your physical **Wi-Fi IP** from the dropdown.
4. Scan the pairing QR code with your phone camera to open `https://<desktop-ip>:3443/camera`.
5. **Accept the Local SSL Certificate** on your mobile browser (required for camera access):
   - **iPhone (Safari)**: Tap **"Show Details"** &rarr; **"visit this website"** &rarr; **"Visit Website"**.
   - **Android (Chrome)**: Tap **"Advanced"** &rarr; **"Proceed to `<ip>` (unsafe)"**.
6. The phone will now stream scans in real-time directly into the desktop checkout station.

---

## Access URLs & Ports

| Service | Protocol / URL | Purpose |
| :--- | :--- | :--- |
| **Desktop Web Portal** | `http://localhost:3000` | Main inventory, crew directory, audit log, label studio |
| **Local Network (LAN)** | `http://<desktop-ip>:3000` | Secondary desktop/laptop browser access |
| **Mobile Companion Camera** | `https://<desktop-ip>:3443/camera` | Wireless mobile phone camera barcode/QR scanner |

---

## Data Protection & Backup Engine

* **Persistent SQLite Database**: Stored in `data/geartrack.db` with Write-Ahead Logging (`WAL` mode) for crash durability.
* **Automated Hourly Snapshots**: Safe online backups are saved to `data/backups/` every 60 minutes with automated 10-file rotation.
* **One-Click Backup**: Click **"Backup DB"** in the Gear Inventory tab to download an instant `.db` snapshot.
* **CSV Export**: Click **"Export CSV"** in the Gear Inventory tab for spreadsheet reports.

---

## Key Features

* **360° All-Angle Optical Decoding**: Powered by WebAssembly (`ZXing-WASM`) with consensus filtering for damaged, low-contrast, or rotated 1D/2D barcodes (Code 128, QR Code, Data Matrix, EAN-13, etc.).
* **Zero Emojis / Studio Design**: Vector SVG iconography and modern dark slate UI.
* **Real-time Live Sync**: Instant WebSocket communication between desktop and mobile devices.
* **Printable Sticky Label Studio**: Built-in SVG barcode label generator for printing gear tags and crew ID badges.

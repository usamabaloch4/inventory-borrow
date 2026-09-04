const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const os = require('os');
const fs = require('fs');
const cors = require('cors');
const qrcode = require('qrcode');
const selfsigned = require('selfsigned');
const { WebSocketServer, WebSocket } = require('ws');

const { readBarcodes } = require('zxing-wasm/reader');
const db = require('./db');

const app = express();
const HTTP_PORT = process.env.HTTP_PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Prevent aggressive mobile caching so phones always run the latest WASM scanner code
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: false,
  maxAge: 0
}));

// Create HTTP server
const httpServer = http.createServer(app);

// Generate self-signed certificate for HTTPS (crucial for mobile phone camera access)
let httpsServer = null;
try {
  const pems = selfsigned.generate(
    [{ name: 'commonName', value: 'GearTrack Local' }],
    { days: 365, keySize: 2048 }
  );
  httpsServer = https.createServer({ key: pems.private, cert: pems.cert }, app);
} catch (err) {
  console.warn('Could not generate self-signed cert for HTTPS:', err.message);
}

// Serve dedicated Remote Camera Companion view (with no-cache headers)
app.get('/camera', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.sendFile(path.join(__dirname, '..', 'public', 'camera.html'));
});

// WebSocket setup for real-time live sync across devices
const wss = new WebSocketServer({ noServer: true });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.action === 'scan' && msg.code) {
        console.log(`📡 Remote scan received from mobile: ${msg.code} (${msg.format || 'code'})`);
        broadcast('remote_code_scanned', {
          code: msg.code,
          format: msg.format || 'Auto',
          timestamp: new Date().toISOString()
        });
      }
    } catch (e) {
      console.warn('WS message parse error:', e);
    }
  });

  ws.on('close', () => clients.delete(ws));
});

function broadcast(event, data) {
  const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// Handle WebSocket upgrade on both HTTP and HTTPS servers
function handleUpgrade(request, socket, head) {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
}
httpServer.on('upgrade', handleUpgrade);
if (httpsServer) httpsServer.on('upgrade', handleUpgrade);

// Helper to get local LAN IP addresses with intelligent priority sorting
function getLocalNetworkInterfaces() {
  const interfaces = os.networkInterfaces();
  const list = [];
  
  for (const name of Object.keys(interfaces)) {
    const isVirtual = /vethernet|virtual|vbox|vmware|docker|tailscale|loopback|wsl|hyper-v|bluetooth|tap|tun/i.test(name);
    for (const iface of interfaces[name]) {
      if (!iface.internal && iface.family === 'IPv4' && !iface.address.startsWith('169.254.')) {
        list.push({
          name,
          address: iface.address,
          isVirtual,
          isWiFi: /wi-?fi|wireless|wlan|airport/i.test(name),
          isEthernet: /ethernet|eth|en/i.test(name)
        });
      }
    }
  }

  // Sort priority: Physical Wi-Fi -> Physical Ethernet -> other physical -> virtual adapters
  list.sort((a, b) => {
    if (a.isVirtual !== b.isVirtual) return a.isVirtual ? 1 : -1;
    if (a.isWiFi !== b.isWiFi) return a.isWiFi ? -1 : 1;
    if (a.isEthernet !== b.isEthernet) return a.isEthernet ? -1 : 1;
    return 0;
  });

  return list;
}

function getLocalIPs() {
  const ifaces = getLocalNetworkInterfaces();
  return ifaces.map(i => i.address);
}

// --- API ROUTES ---

// Network info & QR code for mobile pairing (points directly to /camera)
app.get('/api/network-info', async (req, res) => {
  try {
    const ifaces = getLocalNetworkInterfaces();
    const ips = ifaces.map(i => i.address);
    const queryIp = (typeof req.query.ip === 'string' && !req.query.ip.includes('object') && req.query.ip.trim()) ? req.query.ip.trim() : null;
    const selectedIp = queryIp || (ifaces.length > 0 ? ifaces[0].address : '127.0.0.1');

    const httpsUrl = `https://${selectedIp}:${HTTPS_PORT}/camera`;
    const httpUrl = `http://${selectedIp}:${HTTP_PORT}/camera`;

    // Generate QR code for HTTPS pairing
    const qrDataUrl = await qrcode.toDataURL(httpsUrl, { width: 320, margin: 2 });

    res.json({
      primaryIp: selectedIp,
      ips,
      interfaces: ifaces,
      httpPort: HTTP_PORT,
      httpsPort: HTTPS_PORT,
      httpsUrl,
      httpUrl,
      qrDataUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remote Scan HTTP Endpoint (for mobile phone camera)
app.post('/api/scan/remote', (req, res) => {
  try {
    const { code, format } = req.body;
    if (!code) return res.status(400).json({ error: 'Code is required' });
    console.log(`📡 Remote scan HTTP received: ${code}`);
    broadcast('remote_code_scanned', { code, format: format || 'Auto', timestamp: new Date().toISOString() });
    res.json({ success: true, message: `Sent "${code}" to laptop portal` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stats summary
app.get('/api/stats', (req, res) => {
  try {
    const allGear = db.getAllGear();
    const photographers = db.getAllPhotographers();
    const available = allGear.filter(g => g.status === 'available').length;
    const inUse = allGear.filter(g => g.status === 'checked_out').length;
    const maintenance = allGear.filter(g => g.status === 'maintenance').length;

    res.json({
      totalGear: allGear.length,
      available,
      inUse,
      maintenance,
      totalPhotographers: photographers.length,
      activePhotographers: photographers.filter(p => p.activeGearCount > 0).length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Gear endpoints
app.get('/api/gear', (req, res) => {
  try {
    const { category, status, search } = req.query;
    const gear = db.getAllGear({ category, status, search });
    res.json(gear);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/gear/:id', (req, res) => {
  try {
    const item = db.getGearById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Gear not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/gear', (req, res) => {
  try {
    const { barcode, name, category, serial_number, notes } = req.body;
    const newGear = db.addGear({ barcode, name, category, serial_number, notes });
    broadcast('gear_created', newGear);
    res.status(201).json(newGear);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/gear/:id', (req, res) => {
  try {
    const updated = db.updateGear(req.params.id, req.body);
    broadcast('gear_updated', updated);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/gear/:id', (req, res) => {
  try {
    db.deleteGear(req.params.id);
    broadcast('gear_deleted', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Photographers endpoints
app.get('/api/photographers', (req, res) => {
  try {
    const photographers = db.getAllPhotographers();
    res.json(photographers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/photographers/:id', (req, res) => {
  try {
    const p = db.getPhotographerById(req.params.id);
    if (!p) return res.status(404).json({ error: 'Photographer not found' });
    const allGear = db.getAllGear();
    p.assignedGear = allGear.filter(g => g.current_photographer_id == p.id);
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/photographers', (req, res) => {
  try {
    const { barcode, name, role, phone, email, notes } = req.body;
    const newP = db.addPhotographer({ barcode, name, role, phone, email, notes });
    broadcast('photographer_created', newP);
    res.status(201).json(newP);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/photographers/:id', (req, res) => {
  try {
    const updated = db.updatePhotographer(req.params.id, req.body);
    broadcast('photographer_updated', updated);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/photographers/:id', (req, res) => {
  try {
    db.deletePhotographer(req.params.id);
    broadcast('photographer_deleted', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Unified Code Lookup (Used by Smart Camera Scanner)
app.post('/api/scan/lookup', (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code is required' });
    const result = db.lookupCode(code);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

let sharp = null;
try {
  sharp = require('sharp');
} catch (e) {
  console.warn('sharp optional module not loaded:', e.message);
}

// Deep Image Barcode / MicroQR / DataMatrix Decoder Endpoint
app.post('/api/scan/image', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'Image data is required' });

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    let results = await readBarcodes(buffer, {
      tryHarder: true,
      tryInvert: true,
      tryRotate: true,
      tryDownscale: true
    });

    // If initial pass found nothing, try auto-orient and contrast normalization with sharp
    if ((!results || results.length === 0) && sharp) {
      try {
        const enhancedBuffer = await sharp(buffer)
          .rotate() // Auto-orient using EXIF orientation
          .grayscale()
          .normalize()
          .sharpen()
          .toBuffer();

        results = await readBarcodes(enhancedBuffer, {
          tryHarder: true,
          tryInvert: true,
          tryRotate: true,
          tryDownscale: true
        });
      } catch (sharpErr) {
        console.warn('Sharp image preprocessing notice:', sharpErr.message);
      }
    }

    if (results && results.length > 0) {
      const best = results[0];
      const lookup = db.lookupCode(best.text);
      return res.json({
        found: true,
        code: best.text,
        format: best.format,
        lookup
      });
    }

    res.json({ found: false, message: 'No barcode, QR code, or DataMatrix recognized in image' });
  } catch (err) {
    console.error('Image scan error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Checkout endpoint
app.post('/api/checkout', (req, res) => {
  try {
    const { gearIds, photographerId, notes } = req.body;
    const result = db.checkoutGear({ gearIds, photographerId, notes });
    broadcast('checkout_completed', result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Return endpoint (single gear or photographer batch)
app.post('/api/return', (req, res) => {
  try {
    const { gearId, photographerId, notes } = req.body;
    if (gearId) {
      const item = db.returnGear(gearId, notes);
      broadcast('return_completed', { item });
      return res.json({ success: true, item });
    } else if (photographerId) {
      const result = db.returnAllGearForPhotographer(photographerId, notes);
      broadcast('return_completed', result);
      return res.json(result);
    } else {
      return res.status(400).json({ error: 'Either gearId or photographerId is required' });
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Activity / Transactions Log
app.get('/api/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 100;
    const logs = db.getTransactions(limit);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export CSV
app.get('/api/export/csv', (req, res) => {
  try {
    const gear = db.getAllGear();
    const rows = [
      ['ID', 'Barcode', 'Name', 'Category', 'Serial Number', 'Status', 'Current Holder', 'Checked Out At', 'Notes']
    ];
    for (const g of gear) {
      rows.push([
        g.id,
        `"${g.barcode}"`,
        `"${(g.name || '').replace(/"/g, '""')}"`,
        `"${g.category || ''}"`,
        `"${g.serial_number || ''}"`,
        g.status,
        `"${(g.current_photographer_name || '').replace(/"/g, '""')}"`,
        g.checked_out_at || '',
        `"${(g.notes || '').replace(/"/g, '""')}"`
      ]);
    }
    const csvContent = rows.map(r => r.join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="gear-inventory.csv"');
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Database Backup Endpoints
app.get('/api/backup/download', async (req, res) => {
  try {
    const backupFile = await db.backupDatabase();
    if (!backupFile || !fs.existsSync(backupFile)) {
      return res.status(500).json({ error: 'Could not generate backup file' });
    }
    const filename = path.basename(backupFile);
    res.download(backupFile, filename);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/backup/create', async (req, res) => {
  try {
    const backupFile = await db.backupDatabase();
    res.json({ success: true, backupFile: path.basename(backupFile) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Automated periodic backup (every 60 minutes) + startup snapshot
setTimeout(() => {
  db.backupDatabase().catch(e => console.warn('Startup backup notice:', e.message));
}, 5000);

setInterval(() => {
  db.backupDatabase().catch(e => console.warn('Periodic backup notice:', e.message));
}, 60 * 60 * 1000);

// Reset Sample Data
app.post('/api/reset-sample-data', (req, res) => {
  try {
    db.resetDatabase();
    broadcast('data_reset', {});
    res.json({ success: true, message: 'Database reset to sample state' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Servers
httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  const primaryIp = ips[0] || 'localhost';

  console.log('\n======================================================');
  console.log('📷 GEARTRACK - Offline Inventory & Checkout App');
  console.log('======================================================');
  console.log(`💻 Laptop Access (Local):     http://localhost:${HTTP_PORT}`);
  console.log(`🌐 Local Network (HTTP):      http://${primaryIp}:${HTTP_PORT}`);
  if (httpsServer) {
    console.log(`📱 Phone Camera Access (HTTPS): https://${primaryIp}:${HTTPS_PORT}`);
  }
  console.log('======================================================\n');
});

if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    const ips = getLocalIPs();
    const primaryIp = ips[0] || 'localhost';
    const mobileUrl = `https://${primaryIp}:${HTTPS_PORT}`;
    console.log(`✓ HTTPS Server ready for mobile phone camera scanning at: ${mobileUrl}`);
    console.log('  (Open this link on your iPhone/Android to use camera scanner)\n');
  });
}

const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const DB_PATH = path.join(DATA_DIR, 'geartrack.db');

let db;
try {
  const Database = require('better-sqlite3');
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  console.log('✓ SQLite database initialized at', DB_PATH);
} catch (err) {
  console.warn('better-sqlite3 native module not available, using JSON-backed store:', err.message);
  db = null;
}

// Initialize tables if using SQLite
if (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gear (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      serial_number TEXT,
      status TEXT DEFAULT 'available', -- 'available', 'checked_out', 'maintenance'
      current_photographer_id INTEGER,
      current_photographer_name TEXT,
      checked_out_at TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS photographers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'Photographer',
      phone TEXT,
      email TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gear_id INTEGER NOT NULL,
      gear_name TEXT NOT NULL,
      gear_barcode TEXT NOT NULL,
      photographer_id INTEGER NOT NULL,
      photographer_name TEXT NOT NULL,
      action TEXT NOT NULL, -- 'checkout', 'return'
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      notes TEXT
    );
  `);
}

// Fallback JSON Store implementation if SQLite is not available
class JsonDB {
  constructor(filepath) {
    this.filepath = filepath;
    this.data = { gear: [], photographers: [], transactions: [] };
    this.load();
  }
  load() {
    if (fs.existsSync(this.filepath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.filepath, 'utf8'));
      } catch (e) {
        console.error('Failed to parse JSON DB:', e);
      }
    } else {
      this.save();
    }
  }
  save() {
    fs.writeFileSync(this.filepath, JSON.stringify(this.data, null, 2), 'utf8');
  }
}

const jsonDb = !db ? new JsonDB(path.join(DATA_DIR, 'geartrack.json')) : null;

// Database initialization without dummy data
function initDatabase() {
  console.log('Database ready for fresh equipment and photographer registration.');
}

initDatabase();

// DB API functions
module.exports = {
  // --- GEAR ---
  getAllGear(filter = {}) {
    if (db) {
      let query = 'SELECT * FROM gear WHERE 1=1';
      const params = [];
      if (filter.status) {
        query += ' AND status = ?';
        params.push(filter.status);
      }
      if (filter.category) {
        query += ' AND category = ?';
        params.push(filter.category);
      }
      if (filter.search) {
        query += ' AND (name LIKE ? OR barcode LIKE ? OR serial_number LIKE ? OR current_photographer_name LIKE ?)';
        const s = `%${filter.search}%`;
        params.push(s, s, s, s);
      }
      query += ' ORDER BY category ASC, name ASC';
      return db.prepare(query).all(...params);
    } else {
      let list = jsonDb.data.gear;
      if (filter.status) list = list.filter(g => g.status === filter.status);
      if (filter.category) list = list.filter(g => g.category === filter.category);
      if (filter.search) {
        const s = filter.search.toLowerCase();
        list = list.filter(g =>
          (g.name && g.name.toLowerCase().includes(s)) ||
          (g.barcode && g.barcode.toLowerCase().includes(s)) ||
          (g.serial_number && g.serial_number.toLowerCase().includes(s)) ||
          (g.current_photographer_name && g.current_photographer_name.toLowerCase().includes(s))
        );
      }
      return list;
    }
  },

  getGearById(id) {
    if (db) return db.prepare('SELECT * FROM gear WHERE id = ?').get(id);
    return jsonDb.data.gear.find(g => g.id == id);
  },

  getGearByBarcode(barcode) {
    const code = (barcode || '').trim();
    if (!code) return null;
    if (db) return db.prepare('SELECT * FROM gear WHERE LOWER(barcode) = LOWER(?)').get(code);
    return jsonDb.data.gear.find(g => g.barcode && g.barcode.toLowerCase() === code.toLowerCase());
  },

  addGear({ barcode, name, category, serial_number, notes }) {
    const cleanBarcode = barcode.trim();
    if (!cleanBarcode || !name) throw new Error('Barcode and Name are required');
    if (this.getGearByBarcode(cleanBarcode)) throw new Error(`Gear with barcode "${cleanBarcode}" already exists`);

    if (db) {
      const info = db.prepare(`
        INSERT INTO gear (barcode, name, category, serial_number, status, notes)
        VALUES (?, ?, ?, ?, 'available', ?)
      `).run(cleanBarcode, name.trim(), category || 'Accessory', serial_number ? serial_number.trim() : null, notes || null);
      return this.getGearById(info.lastInsertRowid);
    } else {
      const newId = (jsonDb.data.gear.reduce((max, g) => Math.max(max, g.id || 0), 0) + 1);
      const newGear = {
        id: newId,
        barcode: cleanBarcode,
        name: name.trim(),
        category: category || 'Accessory',
        serial_number: serial_number ? serial_number.trim() : null,
        status: 'available',
        current_photographer_id: null,
        current_photographer_name: null,
        checked_out_at: null,
        notes: notes || null,
        created_at: new Date().toISOString()
      };
      jsonDb.data.gear.push(newGear);
      jsonDb.save();
      return newGear;
    }
  },

  updateGear(id, fields) {
    const gear = this.getGearById(id);
    if (!gear) throw new Error('Gear not found');

    if (db) {
      const allowed = ['barcode', 'name', 'category', 'serial_number', 'status', 'notes'];
      const updates = [];
      const params = [];
      for (const key of allowed) {
        if (fields[key] !== undefined) {
          updates.push(`${key} = ?`);
          params.push(fields[key]);
        }
      }
      if (updates.length > 0) {
        params.push(id);
        db.prepare(`UPDATE gear SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      }
      return this.getGearById(id);
    } else {
      Object.assign(gear, fields);
      jsonDb.save();
      return gear;
    }
  },

  deleteGear(id) {
    if (db) {
      return db.prepare('DELETE FROM gear WHERE id = ?').run(id);
    } else {
      const idx = jsonDb.data.gear.findIndex(g => g.id == id);
      if (idx !== -1) {
        jsonDb.data.gear.splice(idx, 1);
        jsonDb.save();
        return true;
      }
      return false;
    }
  },

  // --- PHOTOGRAPHERS ---
  getAllPhotographers() {
    if (db) {
      const photographers = db.prepare('SELECT * FROM photographers ORDER BY name ASC').all();
      // Attach active items count
      for (const p of photographers) {
        p.activeGearCount = db.prepare('SELECT COUNT(*) as c FROM gear WHERE current_photographer_id = ?').get(p.id).c;
      }
      return photographers;
    } else {
      return jsonDb.data.photographers.map(p => {
        const activeGearCount = jsonDb.data.gear.filter(g => g.current_photographer_id == p.id).length;
        return { ...p, activeGearCount };
      });
    }
  },

  getPhotographerById(id) {
    if (db) return db.prepare('SELECT * FROM photographers WHERE id = ?').get(id);
    return jsonDb.data.photographers.find(p => p.id == id);
  },

  getPhotographerByBarcode(barcode) {
    const code = (barcode || '').trim();
    if (!code) return null;
    if (db) return db.prepare('SELECT * FROM photographers WHERE LOWER(barcode) = LOWER(?)').get(code);
    return jsonDb.data.photographers.find(p => p.barcode && p.barcode.toLowerCase() === code.toLowerCase());
  },

  addPhotographer({ barcode, name, role, phone, email, notes }) {
    const cleanBarcode = barcode.trim();
    if (!cleanBarcode || !name) throw new Error('Barcode and Name are required');
    if (this.getPhotographerByBarcode(cleanBarcode)) throw new Error(`Photographer with barcode "${cleanBarcode}" already exists`);

    if (db) {
      const info = db.prepare(`
        INSERT INTO photographers (barcode, name, role, phone, email, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(cleanBarcode, name.trim(), role || 'Photographer', phone || null, email || null, notes || null);
      return this.getPhotographerById(info.lastInsertRowid);
    } else {
      const newId = (jsonDb.data.photographers.reduce((max, p) => Math.max(max, p.id || 0), 0) + 1);
      const newPhotographer = {
        id: newId,
        barcode: cleanBarcode,
        name: name.trim(),
        role: role || 'Photographer',
        phone: phone || null,
        email: email || null,
        notes: notes || null,
        created_at: new Date().toISOString()
      };
      jsonDb.data.photographers.push(newPhotographer);
      jsonDb.save();
      return newPhotographer;
    }
  },

  updatePhotographer(id, fields) {
    const p = this.getPhotographerById(id);
    if (!p) throw new Error('Photographer not found');

    if (db) {
      const allowed = ['barcode', 'name', 'role', 'phone', 'email', 'notes'];
      const updates = [];
      const params = [];
      for (const key of allowed) {
        if (fields[key] !== undefined) {
          updates.push(`${key} = ?`);
          params.push(fields[key]);
        }
      }
      if (updates.length > 0) {
        params.push(id);
        db.prepare(`UPDATE photographers SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      }
      return this.getPhotographerById(id);
    } else {
      Object.assign(p, fields);
      jsonDb.save();
      return p;
    }
  },

  deletePhotographer(id) {
    // Check if gear is currently assigned
    if (db) {
      const active = db.prepare('SELECT COUNT(*) as c FROM gear WHERE current_photographer_id = ?').get(id).c;
      if (active > 0) throw new Error('Cannot delete photographer who currently has checked-out gear. Return gear first.');
      return db.prepare('DELETE FROM photographers WHERE id = ?').run(id);
    } else {
      const active = jsonDb.data.gear.filter(g => g.current_photographer_id == id).length;
      if (active > 0) throw new Error('Cannot delete photographer who currently has checked-out gear. Return gear first.');
      const idx = jsonDb.data.photographers.findIndex(p => p.id == id);
      if (idx !== -1) {
        jsonDb.data.photographers.splice(idx, 1);
        jsonDb.save();
        return true;
      }
      return false;
    }
  },

  // --- UNIFIED LOOKUP ---
  lookupCode(code) {
    const raw = (code || '').trim();
    if (!raw) return { type: 'empty' };

    const photographer = this.getPhotographerByBarcode(raw);
    if (photographer) {
      const assignedGear = db
        ? db.prepare('SELECT * FROM gear WHERE current_photographer_id = ?').all(photographer.id)
        : jsonDb.data.gear.filter(g => g.current_photographer_id == photographer.id);
      return { type: 'photographer', data: { ...photographer, assignedGear } };
    }

    const gear = this.getGearByBarcode(raw);
    if (gear) {
      return { type: 'gear', data: gear };
    }

    return { type: 'unknown', barcode: raw };
  },

  // --- CHECKOUT FLOW ---
  checkoutGear({ gearIds, photographerId, notes }) {
    const photographer = this.getPhotographerById(photographerId);
    if (!photographer) throw new Error('Photographer not found');

    if (!Array.isArray(gearIds) || gearIds.length === 0) {
      throw new Error('At least one gear item is required for checkout');
    }

    const now = new Date().toISOString();
    const updatedGearList = [];

    for (const gearId of gearIds) {
      const gear = this.getGearById(gearId);
      if (!gear) throw new Error(`Gear item ID ${gearId} not found`);

      if (gear.status === 'checked_out' && gear.current_photographer_id != photographerId) {
        // Log auto-return from previous holder or reassign
        this.logTransaction({
          gear_id: gear.id,
          gear_name: gear.name,
          gear_barcode: gear.barcode,
          photographer_id: gear.current_photographer_id,
          photographer_name: gear.current_photographer_name || 'Previous Holder',
          action: 'transfer_out',
          notes: `Transferred to ${photographer.name}`
        });
      }

      if (db) {
        db.prepare(`
          UPDATE gear
          SET status = 'checked_out',
              current_photographer_id = ?,
              current_photographer_name = ?,
              checked_out_at = ?
          WHERE id = ?
        `).run(photographer.id, photographer.name, now, gear.id);

        this.logTransaction({
          gear_id: gear.id,
          gear_name: gear.name,
          gear_barcode: gear.barcode,
          photographer_id: photographer.id,
          photographer_name: photographer.name,
          action: 'checkout',
          notes: notes || null
        });

        updatedGearList.push(this.getGearById(gear.id));
      } else {
        gear.status = 'checked_out';
        gear.current_photographer_id = photographer.id;
        gear.current_photographer_name = photographer.name;
        gear.checked_out_at = now;

        this.logTransaction({
          gear_id: gear.id,
          gear_name: gear.name,
          gear_barcode: gear.barcode,
          photographer_id: photographer.id,
          photographer_name: photographer.name,
          action: 'checkout',
          notes: notes || null
        });

        updatedGearList.push(gear);
      }
    }

    if (!db) jsonDb.save();
    return { success: true, photographer, items: updatedGearList };
  },

  // --- RETURN FLOW ---
  returnGear(gearId, notes) {
    const gear = this.getGearById(gearId);
    if (!gear) throw new Error('Gear not found');

    const prevPhotographerId = gear.current_photographer_id;
    const prevPhotographerName = gear.current_photographer_name || 'Unknown';

    if (db) {
      db.prepare(`
        UPDATE gear
        SET status = 'available',
            current_photographer_id = NULL,
            current_photographer_name = NULL,
            checked_out_at = NULL
        WHERE id = ?
      `).run(gear.id);

      this.logTransaction({
        gear_id: gear.id,
        gear_name: gear.name,
        gear_barcode: gear.barcode,
        photographer_id: prevPhotographerId || 0,
        photographer_name: prevPhotographerName,
        action: 'return',
        notes: notes || null
      });

      return this.getGearById(gear.id);
    } else {
      gear.status = 'available';
      gear.current_photographer_id = null;
      gear.current_photographer_name = null;
      gear.checked_out_at = null;

      this.logTransaction({
        gear_id: gear.id,
        gear_name: gear.name,
        gear_barcode: gear.barcode,
        photographer_id: prevPhotographerId || 0,
        photographer_name: prevPhotographerName,
        action: 'return',
        notes: notes || null
      });

      jsonDb.save();
      return gear;
    }
  },

  returnAllGearForPhotographer(photographerId, notes) {
    const photographer = this.getPhotographerById(photographerId);
    if (!photographer) throw new Error('Photographer not found');

    const gearItems = db
      ? db.prepare('SELECT * FROM gear WHERE current_photographer_id = ?').all(photographerId)
      : jsonDb.data.gear.filter(g => g.current_photographer_id == photographerId);

    const returned = [];
    for (const g of gearItems) {
      returned.push(this.returnGear(g.id, notes));
    }
    return { success: true, count: returned.length, returned };
  },

  // --- TRANSACTIONS & LOGGING ---
  logTransaction({ gear_id, gear_name, gear_barcode, photographer_id, photographer_name, action, notes }) {
    const now = new Date().toISOString();
    if (db) {
      db.prepare(`
        INSERT INTO transactions (gear_id, gear_name, gear_barcode, photographer_id, photographer_name, action, timestamp, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(gear_id, gear_name, gear_barcode, photographer_id, photographer_name, action, now, notes);
    } else {
      const newId = (jsonDb.data.transactions.reduce((max, t) => Math.max(max, t.id || 0), 0) + 1);
      jsonDb.data.transactions.unshift({
        id: newId,
        gear_id,
        gear_name,
        gear_barcode,
        photographer_id,
        photographer_name,
        action,
        timestamp: now,
        notes
      });
      jsonDb.save();
    }
  },

  getTransactions(limit = 100) {
    if (db) {
      return db.prepare('SELECT * FROM transactions ORDER BY id DESC LIMIT ?').all(limit);
    } else {
      return jsonDb.data.transactions.slice(0, limit);
    }
  },

  resetDatabase() {
    if (db) {
      db.exec('DELETE FROM transactions; DELETE FROM gear; DELETE FROM photographers;');
    } else {
      jsonDb.data = { gear: [], photographers: [], transactions: [] };
      jsonDb.save();
    }
    return true;
  },

  // --- AUTOMATED BACKUP & SNAPSHOTS ---
  async backupDatabase() {
    const BACKUP_DIR = path.join(DATA_DIR, 'backups');
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    if (db) {
      const backupFile = path.join(BACKUP_DIR, `geartrack_backup_${timestamp}.db`);
      await db.backup(backupFile);
      this.rotateBackups(BACKUP_DIR, '.db', 10);
      return backupFile;
    } else if (jsonDb) {
      const backupFile = path.join(BACKUP_DIR, `geartrack_backup_${timestamp}.json`);
      fs.copyFileSync(jsonDb.filepath, backupFile);
      this.rotateBackups(BACKUP_DIR, '.json', 10);
      return backupFile;
    }
    return null;
  },

  rotateBackups(dir, ext, maxFiles = 10) {
    try {
      const files = fs.readdirSync(dir)
        .filter(f => f.endsWith(ext))
        .map(f => ({ name: f, path: path.join(dir, f), time: fs.statSync(path.join(dir, f)).mtime.getTime() }))
        .sort((a, b) => b.time - a.time);

      if (files.length > maxFiles) {
        for (let i = maxFiles; i < files.length; i++) {
          fs.unlinkSync(files[i].path);
        }
      }
    } catch (e) {
      console.warn('Backup rotation error:', e.message);
    }
  },

  getDbPath() {
    return DB_PATH;
  }
};

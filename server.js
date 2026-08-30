const express = require('express');
const path = require('path');
const os = require('os');

// Cloud(PostgreSQL) vs Local(SQLite) auto-detect
const USE_POSTGRES = !!process.env.DATABASE_URL;

// Short ID generator (6-char alphanumeric)
function generateShortId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ─── Database Adapter ────────────────────────────────────────────────────────
let pgPool, sqliteDb;

async function dbQuery(sql, params = []) {
  if (USE_POSTGRES) {
    let i = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++i}`);
    const result = await pgPool.query(pgSql, params);
    return result.rows;
  }
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function dbRun(sql, params = []) {
  if (USE_POSTGRES) {
    let i = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++i}`);
    await pgPool.query(pgSql, params);
  } else {
    await new Promise((resolve, reject) => {
      sqliteDb.run(sql, params, (err) => (err ? reject(err) : resolve()));
    });
  }
}

async function dbGet(sql, params = []) {
  const rows = await dbQuery(sql, params);
  return rows[0] || null;
}

async function initDb() {
  if (USE_POSTGRES) {
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    console.log('☁️  Connected to PostgreSQL (cloud mode)');
  } else {
    const sqlite3 = require('sqlite3').verbose();
    await new Promise((resolve, reject) => {
      sqliteDb = new sqlite3.Database(path.join(__dirname, 'database.sqlite'), (err) =>
        err ? reject(err) : resolve()
      );
    });
    console.log('💾 Connected to SQLite (local mode)');
  }

  await dbRun(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      dates TEXT NOT NULL
    )
  `);

  try { await dbRun("ALTER TABLE events ADD COLUMN mode TEXT DEFAULT 'dateonly'"); } catch (e) {}
  try { await dbRun("ALTER TABLE events ADD COLUMN time_start TEXT"); } catch (e) {}
  try { await dbRun("ALTER TABLE events ADD COLUMN time_end TEXT"); } catch (e) {}
  try { await dbRun("ALTER TABLE events ADD COLUMN date_mode TEXT DEFAULT 'specific'"); } catch (e) {}
  await dbRun(`
    CREATE TABLE IF NOT EXISTS availabilities (
      event_id TEXT NOT NULL,
      name TEXT NOT NULL,
      password TEXT,
      available_dates TEXT NOT NULL,
      PRIMARY KEY (event_id, name)
    )
  `);
  console.log('✅ Database tables ready.');
}

// ─── Express App ─────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 5000;
app.use(express.json());

function getLocalIpAddress() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// ─── API Routes ──────────────────────────────────────────────────────────────

// 1. Create a new event
app.post('/api/events', async (req, res) => {
  const { title, dates, mode = 'dateonly', time_start = null, time_end = null, date_mode = 'specific' } = req.body;
  if (!title || !dates || !Array.isArray(dates) || dates.length === 0) {
    return res.status(400).json({ error: 'Title and non-empty dates array are required.' });
  }
  if (mode === 'datetime' && (!time_start || !time_end)) {
    return res.status(400).json({ error: 'time_start and time_end are required for datetime mode.' });
  }
  try {
    const candidateId = generateShortId();
    const existing = await dbGet('SELECT id FROM events WHERE id = ?', [candidateId]);
    const finalId = existing ? generateShortId() + generateShortId().slice(0, 2) : candidateId;
    await dbRun('INSERT INTO events (id, title, dates, mode, time_start, time_end, date_mode) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      finalId,
      title,
      JSON.stringify(dates),
      mode,
      time_start,
      time_end,
      date_mode,
    ]);
    res.status(201).json({ id: finalId });
  } catch (err) {
    console.error('Event creation error:', err);
    res.status(500).json({ error: 'Failed to create event.' });
  }
});

// 2. Get event details
app.get('/api/events/:id', async (req, res) => {
  try {
    const event = await dbGet('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found.' });
    res.json({ id: event.id, title: event.title, dates: JSON.parse(event.dates), mode: event.mode || 'dateonly', time_start: event.time_start, time_end: event.time_end, date_mode: event.date_mode || 'specific' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve event.' });
  }
});

// 3. Get all availabilities for an event
app.get('/api/events/:id/availability', async (req, res) => {
  try {
    const rows = await dbQuery(
      'SELECT name, available_dates FROM availabilities WHERE event_id = ?',
      [req.params.id]
    );
    res.json(rows.map((row) => ({ name: row.name, available_dates: JSON.parse(row.available_dates) })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve availabilities.' });
  }
});

// 4. Submit or update availability
app.post('/api/events/:id/availability', async (req, res) => {
  const { id } = req.params;
  const { name, password, available_dates } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!Array.isArray(available_dates)) return res.status(400).json({ error: 'Available dates must be an array.' });

  const cleanedName = name.trim();
  try {
    const existing = await dbGet(
      'SELECT password FROM availabilities WHERE event_id = ? AND name = ?',
      [id, cleanedName]
    );
    if (existing) {
      if (existing.password && existing.password !== password) {
        return res.status(401).json({ error: 'Incorrect password for this user name.' });
      }
      await dbRun(
        'UPDATE availabilities SET available_dates = ?, password = ? WHERE event_id = ? AND name = ?',
        [JSON.stringify(available_dates), password, id, cleanedName]
      );
      res.json({ success: true, action: 'updated' });
    } else {
      await dbRun(
        'INSERT INTO availabilities (event_id, name, password, available_dates) VALUES (?, ?, ?, ?)',
        [id, cleanedName, password, JSON.stringify(available_dates)]
      );
      res.status(201).json({ success: true, action: 'created' });
    }
  } catch (err) {
    console.error('Availability save error:', err);
    res.status(500).json({ error: 'Failed to save availability.' });
  }
});

// ─── Static Files ─────────────────────────────────────────────────────────────
app.get('/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));
app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.sendFile(path.join(__dirname, 'sitemap.xml'));
});
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'robots.txt'));
});
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Start ───────────────────────────────────────────────────────────────────
async function main() {
  await initDb();
  app.listen(PORT, '0.0.0.0', () => {
    console.log('==================================================');
    console.log('when2meeting server is running!');
    if (!USE_POSTGRES) {
      const ip = getLocalIpAddress();
      console.log(`- Local access:   http://localhost:${PORT}`);
      console.log(`- Network access: http://${ip}:${PORT}`);
    }
    console.log('==================================================');
  });
}

main().catch(console.error);

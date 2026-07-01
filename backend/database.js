import sqlite3 from 'sqlite3';
import bcrypt from 'bcrypt';
import { open } from 'sqlite';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'delivery_tracker.db');
const DATABASE_URL = process.env.DATABASE_URL || '';
const USE_POSTGRES = Boolean(DATABASE_URL);

let dbInstance = null;

function makeUsername(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 30) || 'driver';
}

function normalizeSqlForPostgres(sql) {
  let paramIndex = 0;
  return sql
    .replace(/"available"/g, "'available'")
    .replace(/"waiting"/g, "'waiting'")
    .replace(/"inactive"/g, "'inactive'")
    .replace(/SUBSTR\(/gi, 'SUBSTRING(')
    .replace(/\?/g, () => `$${++paramIndex}`);
}

function splitSqlStatements(sql) {
  return sql
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean);
}

function createPostgresDb() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
  });

  let transactionClient = null;

  async function query(sql, params = []) {
    const normalizedSql = normalizeSqlForPostgres(sql);
    const client = transactionClient || pool;
    return client.query(normalizedSql, params);
  }

  return {
    dialect: 'postgres',
    async all(sql, params = []) {
      const result = await query(sql, params);
      return result.rows;
    },
    async get(sql, params = []) {
      const result = await query(sql, params);
      return result.rows[0];
    },
    async run(sql, params = []) {
      const trimmed = sql.trim().toUpperCase();
      if (trimmed === 'BEGIN TRANSACTION' || trimmed === 'BEGIN') {
        if (transactionClient) return { changes: 0 };
        transactionClient = await pool.connect();
        await transactionClient.query('BEGIN');
        return { changes: 0 };
      }
      if (trimmed === 'COMMIT') {
        if (!transactionClient) return { changes: 0 };
        await transactionClient.query('COMMIT');
        transactionClient.release();
        transactionClient = null;
        return { changes: 0 };
      }
      if (trimmed === 'ROLLBACK') {
        if (!transactionClient) return { changes: 0 };
        await transactionClient.query('ROLLBACK');
        transactionClient.release();
        transactionClient = null;
        return { changes: 0 };
      }

      const insertsIntoTableWithId = /^\s*INSERT\s+INTO\s+(?!settings\b)/i.test(sql);
      const needsReturningId = insertsIntoTableWithId && !/\bRETURNING\b/i.test(sql);
      const result = await query(needsReturningId ? `${sql} RETURNING id` : sql, params);
      return {
        lastID: result.rows?.[0]?.id,
        changes: result.rowCount
      };
    },
    async exec(sql) {
      for (const statement of splitSqlStatements(sql)) {
        await query(statement);
      }
    },
    async close() {
      if (transactionClient) {
        await transactionClient.query('ROLLBACK');
        transactionClient.release();
        transactionClient = null;
      }
      await pool.end();
    }
  };
}

export async function getDb() {
  if (dbInstance) return dbInstance;

  if (USE_POSTGRES) {
    dbInstance = createPostgresDb();
    return dbInstance;
  }

  dbInstance = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  dbInstance.dialect = 'sqlite';
  await dbInstance.run('PRAGMA foreign_keys = ON;');
  return dbInstance;
}

async function columnExists(db, tableName, columnName) {
  if (db.dialect === 'postgres') {
    const row = await db.get(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`,
      [tableName, columnName]
    );
    return Boolean(row);
  }

  const columns = await db.all(`PRAGMA table_info(${tableName})`);
  return columns.some(c => c.name === columnName);
}

async function initSqliteSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  await db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('directions', '[\"1\", \"3\", \"6\", \"10\"]')");
  await db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('max_orders_per_trip', '3')");
  await db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('max_waiting_minutes', '10')");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS deliverymen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      status TEXT DEFAULT 'available',
      ready_since TEXT,
      last_out_at TEXT,
      last_back_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      deliveryman_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (deliveryman_id) REFERENCES deliverymen(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deliveryman_id INTEGER,
      direction TEXT NOT NULL,
      status TEXT DEFAULT 'assigned',
      assigned_at TEXT,
      out_at TEXT,
      back_at TEXT,
      duration_minutes REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (deliveryman_id) REFERENCES deliverymen(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_number TEXT NOT NULL,
      direction TEXT NOT NULL,
      has_branch_stop INTEGER DEFAULT 0,
      status TEXT DEFAULT 'waiting',
      entered_at TEXT NOT NULL,
      assigned_at TEXT,
      out_at TEXT,
      back_at TEXT,
      deliveryman_id INTEGER,
      trip_id INTEGER,
      delivery_duration_minutes REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (deliveryman_id) REFERENCES deliverymen(id) ON DELETE SET NULL,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS trip_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER,
      order_id INTEGER,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_serial_number TEXT NOT NULL,
      order_id INTEGER,
      complaint_time TEXT NOT NULL,
      is_time_complaint INTEGER DEFAULT 0,
      is_behavior_complaint INTEGER DEFAULT 0,
      deliveryman_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
      FOREIGN KEY (deliveryman_id) REFERENCES deliverymen(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS out_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_start TEXT NOT NULL,
      period_end TEXT,
      duration_minutes INTEGER,
      pending_serials TEXT
    );

    CREATE TABLE IF NOT EXISTS assignment_delays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      direction TEXT NOT NULL,
      delay_start TEXT NOT NULL,
      delay_end TEXT,
      duration_minutes REAL,
      delayed_orders_count INTEGER DEFAULT 0,
      assigned_deliveryman_id INTEGER,
      trip_id INTEGER,
      status TEXT DEFAULT 'open',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (assigned_deliveryman_id) REFERENCES deliverymen(id) ON DELETE SET NULL,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL
    );
  `);

  if (!(await columnExists(db, 'users', 'deliveryman_id'))) {
    await db.run('ALTER TABLE users ADD COLUMN deliveryman_id INTEGER');
  }
  if (!(await columnExists(db, 'trips', 'penalty_minutes'))) {
    await db.run('ALTER TABLE trips ADD COLUMN penalty_minutes REAL DEFAULT 0');
  }
}

async function initPostgresSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deliverymen (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      status TEXT DEFAULT 'available',
      ready_since TEXT,
      last_out_at TEXT,
      last_back_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      deliveryman_id INTEGER REFERENCES deliverymen(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS trips (
      id SERIAL PRIMARY KEY,
      deliveryman_id INTEGER REFERENCES deliverymen(id) ON DELETE SET NULL,
      direction TEXT NOT NULL,
      status TEXT DEFAULT 'assigned',
      assigned_at TEXT,
      out_at TEXT,
      back_at TEXT,
      duration_minutes REAL,
      penalty_minutes REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      serial_number TEXT NOT NULL,
      direction TEXT NOT NULL,
      has_branch_stop INTEGER DEFAULT 0,
      status TEXT DEFAULT 'waiting',
      entered_at TEXT NOT NULL,
      assigned_at TEXT,
      out_at TEXT,
      back_at TEXT,
      deliveryman_id INTEGER REFERENCES deliverymen(id) ON DELETE SET NULL,
      trip_id INTEGER REFERENCES trips(id) ON DELETE SET NULL,
      delivery_duration_minutes REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS trip_orders (
      id SERIAL PRIMARY KEY,
      trip_id INTEGER REFERENCES trips(id) ON DELETE CASCADE,
      order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS complaints (
      id SERIAL PRIMARY KEY,
      order_serial_number TEXT NOT NULL,
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      complaint_time TEXT NOT NULL,
      is_time_complaint INTEGER DEFAULT 0,
      is_behavior_complaint INTEGER DEFAULT 0,
      deliveryman_id INTEGER REFERENCES deliverymen(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS out_periods (
      id SERIAL PRIMARY KEY,
      period_start TEXT NOT NULL,
      period_end TEXT,
      duration_minutes INTEGER,
      pending_serials TEXT
    );

    CREATE TABLE IF NOT EXISTS assignment_delays (
      id SERIAL PRIMARY KEY,
      direction TEXT NOT NULL,
      delay_start TEXT NOT NULL,
      delay_end TEXT,
      duration_minutes REAL,
      delayed_orders_count INTEGER DEFAULT 0,
      assigned_deliveryman_id INTEGER REFERENCES deliverymen(id) ON DELETE SET NULL,
      trip_id INTEGER REFERENCES trips(id) ON DELETE SET NULL,
      status TEXT DEFAULT 'open',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.run("INSERT INTO settings (key, value) VALUES ('directions', ?) ON CONFLICT (key) DO NOTHING", ['["1", "3", "6", "10"]']);
  await db.run("INSERT INTO settings (key, value) VALUES ('max_orders_per_trip', '3') ON CONFLICT (key) DO NOTHING");
  await db.run("INSERT INTO settings (key, value) VALUES ('max_waiting_minutes', '10') ON CONFLICT (key) DO NOTHING");

  if (!(await columnExists(db, 'users', 'deliveryman_id'))) {
    await db.run('ALTER TABLE users ADD COLUMN deliveryman_id INTEGER');
  }
  if (!(await columnExists(db, 'trips', 'penalty_minutes'))) {
    await db.run('ALTER TABLE trips ADD COLUMN penalty_minutes REAL DEFAULT 0');
  }
}

export async function initDb() {
  const db = await getDb();

  if (db.dialect === 'postgres') {
    await initPostgresSchema(db);
  } else {
    await initSqliteSchema(db);
  }

  const dmCount = await db.get('SELECT COUNT(*) as count FROM deliverymen');
  if (parseInt(dmCount.count, 10) === 0) {
    const now = new Date().toISOString();
    await db.run("INSERT INTO deliverymen (name, is_active, status, ready_since) VALUES (?, 1, 'available', ?)", ['Alex Mercer', now]);
    await db.run("INSERT INTO deliverymen (name, is_active, status, ready_since) VALUES (?, 1, 'available', ?)", ['Beatrix Kiddo', now]);
    await db.run("INSERT INTO deliverymen (name, is_active, status, ready_since) VALUES (?, 1, 'available', ?)", ['Clarice Starling', now]);
    await db.run("INSERT INTO deliverymen (name, is_active, status, ready_since) VALUES (?, 0, 'inactive', ?)", ['Danny Ocean', now]);
  }

  const saltRounds = 12;
  const managerExists = await db.get('SELECT id FROM users WHERE username = ?', ['manager']);
  if (!managerExists) {
    await db.run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', ['manager', await bcrypt.hash('manager123', saltRounds), 'manager']);
  }
  const staffExists = await db.get('SELECT id FROM users WHERE username = ?', ['staff']);
  if (!staffExists) {
    await db.run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', ['staff', await bcrypt.hash('staff123', saltRounds), 'staff']);
  }

  const deliverymen = await db.all('SELECT id, name FROM deliverymen ORDER BY id');
  for (const dm of deliverymen) {
    const linkedUser = await db.get('SELECT id FROM users WHERE role = ? AND deliveryman_id = ?', ['deliveryman', dm.id]);
    if (linkedUser) continue;

    const preferredUsername = makeUsername(dm.name);
    let username = preferredUsername;
    let suffix = 1;
    while (await db.get('SELECT id FROM users WHERE username = ?', [username])) {
      username = `${preferredUsername}${suffix++}`;
    }
    await db.run(
      'INSERT INTO users (username, password_hash, role, deliveryman_id) VALUES (?, ?, ?, ?)',
      [username, await bcrypt.hash('driver123', saltRounds), 'deliveryman', dm.id]
    );
  }
}

export async function resetDb() {
  const db = await getDb();
  await db.exec(`
    DROP TABLE IF EXISTS complaints;
    DROP TABLE IF EXISTS assignment_delays;
    DROP TABLE IF EXISTS out_periods;
    DROP TABLE IF EXISTS trip_orders;
    DROP TABLE IF EXISTS orders;
    DROP TABLE IF EXISTS trips;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS deliverymen;
    DROP TABLE IF EXISTS settings;
  `);
  await initDb();
}

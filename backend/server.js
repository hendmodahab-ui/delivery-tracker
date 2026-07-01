import express from 'express';
import cors from 'cors';
import { getDb, initDb, resetDb } from './database.js';
import { runAssignmentEngine } from './assignmentEngine.js';
import { loginHandler, authMiddleware, requireRole } from './auth.js';
import bcrypt from 'bcrypt';
import XLSX from 'xlsx';
const app = express();
const PORT = process.env.PORT || 5000;
const IS_VERCEL = Boolean(process.env.VERCEL);

app.use(cors());
app.use(express.json());

// Public route for login
app.post('/api/login', loginHandler);

// Public deploy check so we can verify Vercel is serving the expected code.
app.get('/api/deploy-info', (req, res) => {
  res.json({
    app: 'delivery-tracker-backend',
    version: 'postgres-trip-report-fix-2026-07-01',
    fixes: {
      managerTripsUsesJsOrderCounts: true,
      postgresGroupByDeliverymanNameFixed: true
    }
  });
});

// Optional cron endpoint for serverless deployments.
// Set CRON_SECRET and call with Authorization: Bearer <secret>.
app.get('/api/assignment/cron', async (req, res) => {
  const expectedSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || '';
  const providedSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.query.secret;

  if (!expectedSecret || providedSecret !== expectedSecret) {
    return res.status(403).json({ error: 'Forbidden.' });
  }

  try {
    const logs = await runAssignmentEngine();
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Protect all subsequent routes
app.use('/api', authMiddleware); // apply JWT auth to all /api routes after login

// Password change endpoint for authenticated users
app.post('/api/change-password', async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Old and new passwords required.' });
  }
  try {
    const db = await getDb();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const match = await bcrypt.compare(oldPassword, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Old password is incorrect.' });
    const saltRounds = 12;
    const newHash = await bcrypt.hash(newPassword, saltRounds);
    await db.run('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newHash, req.user.id]);
    res.json({ message: 'Password updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Vercel/serverless functions do not keep setInterval alive reliably.
// Running the engine before the deliverymen polling response preserves
// assignment behavior while users are active in the app.
app.use('/api', async (req, res, next) => {
  if (!IS_VERCEL || req.method !== 'GET' || req.path !== '/deliverymen') {
    return next();
  }

  try {
    await runAssignmentEngine();
  } catch (err) {
    console.error('[Request-Triggered Assignment] Error:', err);
  }
  next();
});

// Initialize database on startup
try {
  await initDb();
  console.log('Database initialized successfully.');
} catch (error) {
  console.error('Database initialization failed:', error);
}

// Background assignment engine: run every 60 seconds on long-running servers.
// On Vercel, use request-triggered assignment above and optional Vercel Cron.
if (!IS_VERCEL) {
  setInterval(async () => {
    try {
      const logs = await runAssignmentEngine();
      if (logs.some(log => log.includes('Successfully') || log.includes('Warning'))) {
        console.log(`[Auto-Assignment Cron] Run at ${new Date().toISOString()}:\n`, logs.join('\n'));
      }
    } catch (err) {
      console.error('[Auto-Assignment Cron] Error:', err);
    }
  }, 60000);
}

// Helper function to extract and validate query filters (Today, Date range, Deliveryman, Direction)
function getManagerFilters(req) {
  const { startDate, endDate, deliverymanId, direction } = req.query;
  return {
    startDate: startDate || null,
    endDate: endDate || null,
    deliverymanId: deliverymanId ? parseInt(deliverymanId, 10) : null,
    direction: direction || null
  };
}

// Helper to apply filters to a JS list of objects
function filterItems(items, filters, dateKey, deliverymanIdKey, directionKey) {
  return items.filter(item => {
    // Date filter (compare date portions)
    if (filters.startDate || filters.endDate) {
      const itemDateVal = item[dateKey] ? item[dateKey].substring(0, 10) : null;
      if (!itemDateVal) return false;
      if (filters.startDate && itemDateVal < filters.startDate) return false;
      if (filters.endDate && itemDateVal > filters.endDate) return false;
    }
    // Deliveryman filter
    if (filters.deliverymanId !== null) {
      const devId = item[deliverymanIdKey];
      if (devId !== filters.deliverymanId) return false;
    }
    // Direction filter
    if (filters.direction !== null) {
      const dir = item[directionKey];
      if (dir !== filters.direction) return false;
    }
    return true;
  });
}

// ==================== SETTINGS ROUTES ====================

app.get('/api/settings', async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all('SELECT key, value FROM settings');
    const settings = {};
    rows.forEach(r => {
      if (r.key === 'directions') {
        settings[r.key] = JSON.parse(r.value);
      } else if (r.key === 'max_orders_per_trip' || r.key === 'max_waiting_minutes') {
        settings[r.key] = parseInt(r.value, 10);
      } else {
        settings[r.key] = r.value;
      }
    });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/settings', requireRole('manager'), async (req, res) => {
  try {
    const db = await getDb();
    const { directions, max_orders_per_trip, max_waiting_minutes } = req.body;

    await db.run('BEGIN TRANSACTION');
    if (directions !== undefined) {
      if (!Array.isArray(directions) || directions.length !== 4) {
        throw new Error('Directions must be an array of exactly 4 names.');
      }
      await db.run('UPDATE settings SET value = ? WHERE key = ?', [JSON.stringify(directions), 'directions']);
    }
    if (max_orders_per_trip !== undefined) {
      const val = parseInt(max_orders_per_trip, 10);
      if (isNaN(val) || val <= 0) throw new Error('max_orders_per_trip must be a positive integer.');
      await db.run('UPDATE settings SET value = ? WHERE key = ?', [val.toString(), 'max_orders_per_trip']);
    }
    if (max_waiting_minutes !== undefined) {
      const val = parseInt(max_waiting_minutes, 10);
      if (isNaN(val) || val <= 0) throw new Error('max_waiting_minutes must be a positive integer.');
      await db.run('UPDATE settings SET value = ? WHERE key = ?', [val.toString(), 'max_waiting_minutes']);
    }
    await db.run('COMMIT');

    // Trigger assignment after settings change
    const logs = await runAssignmentEngine();

    res.json({ message: 'Settings updated successfully.', logs });
  } catch (err) {
    const db = await getDb();
    await db.run('ROLLBACK');
    res.status(400).json({ error: err.message });
  }
});

// ==================== DELIVERYMEN ROUTES ====================

app.get('/api/deliverymen', async (req, res) => {
  try {
    const db = await getDb();
    // Managers/staff see all deliverymen. A deliveryman only sees his own profile.
    const deliverymen = req.user.role === 'deliveryman'
      ? await db.all(`
          SELECT d.*, u.username 
          FROM deliverymen d
          LEFT JOIN users u ON u.deliveryman_id = d.id
          WHERE d.id = ?
        `, [req.user.deliveryman_id])
      : await db.all(`
          SELECT d.*, u.username 
          FROM deliverymen d
          LEFT JOIN users u ON u.deliveryman_id = d.id
        `);

    // Determine next‑in‑line deliveryman (available with earliest ready_since)
    let nextInLineId = null;
    const deliveryQueue = await db.all(`
      SELECT id, name, status, ready_since
      FROM deliverymen
      WHERE is_active = 1 AND status = 'available'
      ORDER BY ready_since ASC
    `);
    if (deliveryQueue.length) {
      nextInLineId = deliveryQueue[0].id;
    }

    const pendingDirections = await db.all(`
      SELECT direction, COUNT(*) as count, MIN(entered_at) as earliest_entered_at
      FROM orders
      WHERE status = 'waiting'
      GROUP BY direction
      ORDER BY earliest_entered_at ASC
    `);
    const primaryPendingDirection = pendingDirections[0] || null;

    // Count total pending waiting orders (overall) and earliest waiting order timestamp
    const pendingRow = await db.get('SELECT COUNT(*) as cnt FROM orders WHERE status = "waiting"');
    const pendingOrdersCount = pendingRow?.cnt ?? 0;

    // Get earliest waiting order timestamp for countdown
    const earliestRow = await db.get('SELECT entered_at FROM orders WHERE status = "waiting" ORDER BY entered_at ASC LIMIT 1');
    const earliestWaiting = earliestRow?.entered_at ?? null;

    // Get max waiting minutes setting
    const maxWaitRow = await db.get("SELECT value FROM settings WHERE key = 'max_waiting_minutes'");
    const maxWaitingMinutes = maxWaitRow ? parseInt(maxWaitRow.value, 10) : 10;

    // Compute countdown seconds for the next‑in‑line driver
    let countdownSeconds = null;
    if (earliestWaiting) {
      const elapsedMs = new Date() - new Date(earliestWaiting);
      countdownSeconds = Math.max(0, maxWaitingMinutes * 60 - Math.floor(elapsedMs / 1000));
    }

    // For each deliveryman compute stats and notification flags
    for (const d of deliverymen) {
      const avgRow = await db.get(
        `SELECT AVG(duration_minutes) as avg_duration 
         FROM trips 
         WHERE deliveryman_id = ? AND status = 'completed'`,
        [d.id]
      );
      d.average_trip_duration = avgRow?.avg_duration ? parseFloat(avgRow.avg_duration.toFixed(2)) : 0;

      if (d.status === 'assigned' || d.status === 'out') {
        const activeTrip = await db.get(
          `SELECT id, direction, status, assigned_at, out_at, penalty_minutes FROM trips 
           WHERE deliveryman_id = ? AND status != 'completed' 
           ORDER BY id DESC LIMIT 1`,
          [d.id]
        );
        if (activeTrip) {
          d.current_trip_id = activeTrip.id;
          d.current_direction = activeTrip.direction;
          d.current_trip_assigned_at = activeTrip.assigned_at;
          d.current_trip_out_at = activeTrip.out_at;
          d.current_assignment_to_pickup_minutes = activeTrip.out_at
            ? activeTrip.penalty_minutes
            : parseFloat(((new Date() - new Date(activeTrip.assigned_at)) / 1000 / 60).toFixed(2));
          const orders = await db.all(
            `SELECT serial_number, has_branch_stop FROM orders 
             WHERE trip_id = ?`,
            [activeTrip.id]
          );
          d.current_orders = orders;
        } else {
          d.current_orders = [];
        }
      } else {
        d.current_orders = [];
      }

      d.is_next_in_line = d.id === nextInLineId;
      d.pending_orders_count = d.is_next_in_line ? pendingOrdersCount : 0;
      d.pending_order_earliest = d.is_next_in_line ? earliestWaiting : null;
      d.pending_countdown_seconds = d.is_next_in_line ? countdownSeconds : null;
      d.pending_direction = d.is_next_in_line && primaryPendingDirection ? primaryPendingDirection.direction : null;
      d.pending_direction_order_count = d.is_next_in_line && primaryPendingDirection ? primaryPendingDirection.count : 0;
      d.pending_direction_earliest = d.is_next_in_line && primaryPendingDirection ? primaryPendingDirection.earliest_entered_at : null;
      d.pending_directions = d.is_next_in_line ? pendingDirections : [];

      const queueIndex = deliveryQueue.findIndex(q => q.id === d.id);
      d.queue_position = queueIndex >= 0 ? queueIndex + 1 : null;
      d.queue_total = deliveryQueue.length;
      d.queue_before = queueIndex >= 0 ? deliveryQueue.slice(0, queueIndex) : [];
      d.queue_after = queueIndex >= 0 ? deliveryQueue.slice(queueIndex + 1) : [];
      d.full_queue = req.user.role === 'deliveryman' ? [] : deliveryQueue;
    }

    res.json(deliverymen);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/deliverymen', requireRole('manager', 'staff'), async (req, res) => {
  try {
    const db = await getDb();
    const { name } = req.body;
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Name is required.' });
    }

    const nowStr = new Date().toISOString();
    const result = await db.run(
      `INSERT INTO deliverymen (name, is_active, status, ready_since, created_at, updated_at)
       VALUES (?, 1, 'available', ?, ?, ?)`,
      [name.trim(), nowStr, nowStr, nowStr]
    );

    // Also create a login user linked to this exact deliveryman.
    const baseUsername = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 30) || `driver${result.lastID}`;
    let username = baseUsername;
    let suffix = 1;
    while (await db.get('SELECT id FROM users WHERE username = ?', [username])) {
      username = `${baseUsername}${suffix++}`;
    }
    const saltRounds = 12;
    const defaultPassword = 'driver123';
    const passwordHash = await bcrypt.hash(defaultPassword, saltRounds);
    await db.run(
      `INSERT INTO users (username, password_hash, role, deliveryman_id) VALUES (?, ?, ?, ?)`,
      [username, passwordHash, 'deliveryman', result.lastID]
    );

    // Trigger assignment
    const logs = await runAssignmentEngine();

    res.status(201).json({ id: result.lastID, name, username, password: defaultPassword, is_active: 1, status: 'available', logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/deliverymen/:id', requireRole('manager', 'staff'), async (req, res) => {
  try {
    const db = await getDb();
    const { id } = req.params;
    const { name, is_active, status } = req.body;

    const deliveryman = await db.get('SELECT * FROM deliverymen WHERE id = ?', [id]);
    if (!deliveryman) {
      return res.status(404).json({ error: 'Deliveryman not found.' });
    }

    const nowStr = new Date().toISOString();
    let queryParts = [];
    let params = [];

    if (name !== undefined) {
      if (name.trim() === '') return res.status(400).json({ error: 'Name cannot be empty.' });
      queryParts.push('name = ?');
      params.push(name.trim());
    }

    if (is_active !== undefined) {
      const activeVal = is_active ? 1 : 0;
      queryParts.push('is_active = ?');
      params.push(activeVal);
      if (activeVal === 0) {
        // Deactivating makes them inactive status
        queryParts.push("status = 'inactive'");
      } else if (deliveryman.is_active === 0) {
        // Activating makes them available
        queryParts.push("status = 'available'");
        queryParts.push('ready_since = ?');
        params.push(nowStr);
      }
    }

    if (status !== undefined) {
      // Validation: "Set deliveryman as out only if he has an active assigned/out trip"
      if (status === 'out') {
        const activeTrip = await db.get(
          "SELECT id FROM trips WHERE deliveryman_id = ? AND status IN ('assigned', 'out')",
          [id]
        );
        if (!activeTrip) {
          return res.status(400).json({ error: 'Cannot set status to out: no active assigned or out trip exists for this deliveryman.' });
        }
      }
      
      // Validation: "A deliveryman cannot receive a new trip unless status is available"
      // If we manually change to available, record ready_since
      if (status === 'available') {
        queryParts.push('ready_since = ?');
        params.push(nowStr);
      }

      queryParts.push('status = ?');
      params.push(status);
    }

    if (queryParts.length === 0) {
      return res.status(400).json({ error: 'No fields to update.' });
    }

    queryParts.push('updated_at = ?');
    params.push(nowStr);
    params.push(id);

    await db.run(
      `UPDATE deliverymen SET ${queryParts.join(', ')} WHERE id = ?`,
      params
    );

    // Trigger assignment
    const logs = await runAssignmentEngine();

    const updated = await db.get('SELECT * FROM deliverymen WHERE id = ?', [id]);
    res.json({ deliveryman: updated, logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==================== ORDERS ROUTES ====================

app.get('/api/orders', async (req, res) => {
  try {
    const db = await getDb();
    const orders = req.user.role === 'deliveryman'
      ? await db.all('SELECT * FROM orders WHERE deliveryman_id = ? ORDER BY entered_at DESC', [req.user.deliveryman_id])
      : await db.all('SELECT * FROM orders ORDER BY entered_at DESC');
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders/today', async (req, res) => {
  try {
    const db = await getDb();
    const today = new Date().toISOString().substring(0, 10);
    const orders = await db.all(
      "SELECT * FROM orders WHERE SUBSTR(entered_at, 1, 10) = ? ORDER BY entered_at DESC",
      [today]
    );
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders', requireRole('staff', 'manager'), async (req, res) => {
  try {
    const db = await getDb();
    const { serial_number, direction, has_branch_stop } = req.body;

    // Validation
    if (!serial_number || serial_number.trim() === '') {
      return res.status(400).json({ error: 'Serial number is required.' });
    }
    if (!direction) {
      return res.status(400).json({ error: 'Direction is required.' });
    }

    // Verify direction is configured
    const settingsRow = await db.get("SELECT value FROM settings WHERE key = 'directions'");
    const validDirections = JSON.parse(settingsRow.value);
    if (!validDirections.includes(direction.toString().trim())) {
      return res.status(400).json({ error: `Invalid direction. Must be one of: ${validDirections.join(', ')}` });
    }

    const nowStr = new Date().toISOString();
    const todayStr = nowStr.substring(0, 10);

    // Duplicate check on the same day
    const duplicate = await db.get(
      "SELECT id FROM orders WHERE serial_number = ? AND SUBSTR(entered_at, 1, 10) = ?",
      [serial_number.trim(), todayStr]
    );
    if (duplicate) {
      return res.status(400).json({ error: `Order serial number '${serial_number}' has already been entered today.` });
    }

    const branchStopVal = has_branch_stop ? 1 : 0;

    const result = await db.run(
      `INSERT INTO orders (serial_number, direction, has_branch_stop, status, entered_at, created_at, updated_at)
       VALUES (?, ?, ?, 'waiting', ?, ?, ?)`,
      [serial_number.trim(), direction.toString().trim(), branchStopVal, nowStr, nowStr, nowStr]
    );

    // Trigger assignment run
    const logs = await runAssignmentEngine();

    const newOrder = await db.get('SELECT * FROM orders WHERE id = ?', [result.lastID]);
    res.status(201).json({ order: newOrder, logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==================== ASSIGNMENT ENGINE MANUAL ROUTE ====================

app.post('/api/assignment/run', async (req, res) => {
  try {
    const logs = await runAssignmentEngine();
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==================== TRIPS ROUTES ====================

app.get('/api/trips', async (req, res) => {
  try {
    const db = await getDb();
    const trips = req.user.role === 'deliveryman'
      ? await db.all('SELECT * FROM trips WHERE deliveryman_id = ? ORDER BY assigned_at DESC', [req.user.deliveryman_id])
      : await db.all('SELECT * FROM trips ORDER BY assigned_at DESC');
    res.json(trips);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark Out / Picked Up
app.post('/api/trips/:id/out', async (req, res) => {
  try {
    const db = await getDb();
    const { id } = req.params;
    const nowStr = new Date().toISOString();

    const trip = await db.get('SELECT * FROM trips WHERE id = ?', [id]);
    if (!trip) return res.status(404).json({ error: 'Trip not found.' });
    if (req.user.role === 'deliveryman' && trip.deliveryman_id !== req.user.deliveryman_id) {
      return res.status(403).json({ error: 'You can only access your own trip.' });
    }
    if (trip.status !== 'assigned') {
      return res.status(400).json({ error: `Cannot mark trip as out. Status is '${trip.status}', expected 'assigned'.` });
    }

    await db.run('BEGIN TRANSACTION');

    // Calculate penalty minutes (time from assignment to out)
    const assignedAt = trip.assigned_at;
    const penaltyMinutes = assignedAt ? Math.max(0, (new Date(nowStr) - new Date(assignedAt)) / 60000) : 0;

    // Update trip with out status and penalty
    await db.run(
      "UPDATE trips SET status = 'out', out_at = ?, penalty_minutes = ?, updated_at = ? WHERE id = ?",
      [nowStr, penaltyMinutes, nowStr, id]
    );

    // Update orders in the trip
    await db.run(
      "UPDATE orders SET status = 'out', out_at = ?, updated_at = ? WHERE trip_id = ?",
      [nowStr, nowStr, id]
    );

    // Update deliveryman
    await db.run(
      "UPDATE deliverymen SET status = 'out', last_out_at = ?, updated_at = ? WHERE id = ?",
      [nowStr, nowStr, trip.deliveryman_id]
    );

    await db.run('COMMIT');
    res.json({ message: 'Trip successfully marked as out.', penalty_minutes: penaltyMinutes });
  } catch (err) {
    const db = await getDb();
    await db.run('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// Mark Back / Completed
app.post('/api/trips/:id/back', async (req, res) => {
  try {
    const db = await getDb();
    const { id } = req.params;
    const nowStr = new Date().toISOString();
    const now = new Date(nowStr);

    const trip = await db.get('SELECT * FROM trips WHERE id = ?', [id]);
    if (!trip) return res.status(404).json({ error: 'Trip not found.' });
    if (req.user.role === 'deliveryman' && trip.deliveryman_id !== req.user.deliveryman_id) {
      return res.status(403).json({ error: 'You can only access your own trip.' });
    }
    if (trip.status !== 'out') {
      return res.status(400).json({ error: `Cannot mark trip as back. Status is '${trip.status}', expected 'out'.` });
    }

    const outTime = new Date(trip.out_at);
    if (now < outTime) {
      return res.status(400).json({ error: 'Back time cannot be before out time.' });
    }

    const durationMs = now - outTime;
    const durationMinutes = parseFloat((durationMs / 1000 / 60).toFixed(2));

    await db.run('BEGIN TRANSACTION');

    // Update trip
    await db.run(
      "UPDATE trips SET status = 'completed', back_at = ?, duration_minutes = ?, updated_at = ? WHERE id = ?",
      [nowStr, durationMinutes, nowStr, id]
    );

    // Update orders in the trip
    await db.run(
      "UPDATE orders SET status = 'completed', back_at = ?, delivery_duration_minutes = ?, updated_at = ? WHERE trip_id = ?",
      [nowStr, durationMinutes, nowStr, id]
    );

    // Update deliveryman: status to 'available', last_back_at and ready_since to nowStr
    await db.run(
      "UPDATE deliverymen SET status = 'available', last_back_at = ?, ready_since = ?, updated_at = ? WHERE id = ?",
      [nowStr, nowStr, nowStr, trip.deliveryman_id]
    );

    await db.run('COMMIT');

    // Trigger assignment run since a deliveryman is now available!
    const logs = await runAssignmentEngine();

    res.json({ message: 'Trip successfully marked as back.', duration_minutes: durationMinutes, logs });
  } catch (err) {
    const db = await getDb();
    await db.run('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});


// ==================== COMPLAINTS ROUTES ====================

app.get('/api/complaints', async (req, res) => {
  try {
    const db = await getDb();
    const complaints = await db.all('SELECT * FROM complaints ORDER BY complaint_time DESC');
    res.json(complaints);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/complaints', requireRole('staff', 'manager'), async (req, res) => {
  try {
    const db = await getDb();
    const { order_serial_number, is_time_complaint, is_behavior_complaint } = req.body;

    if (!order_serial_number || order_serial_number.trim() === '') {
      return res.status(400).json({ error: 'Order serial number is required.' });
    }
    
    const timeVal = is_time_complaint ? 1 : 0;
    const behaviorVal = is_behavior_complaint ? 1 : 0;

    if (timeVal === 0 && behaviorVal === 0) {
      return res.status(400).json({ error: 'At least one complaint type (Time or Behavior) must be selected.' });
    }

    const nowStr = new Date().toISOString();

    // Try to link the complaint to the most recent order with this serial number
    const matchedOrder = await db.get(
      "SELECT id, deliveryman_id FROM orders WHERE serial_number = ? ORDER BY entered_at DESC LIMIT 1",
      [order_serial_number.trim()]
    );

    const orderId = matchedOrder ? matchedOrder.id : null;
    const deliverymanId = matchedOrder ? matchedOrder.deliveryman_id : null;

    const result = await db.run(
      `INSERT INTO complaints (order_serial_number, order_id, complaint_time, is_time_complaint, is_behavior_complaint, deliveryman_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [order_serial_number.trim(), orderId, nowStr, timeVal, behaviorVal, deliverymanId, nowStr]
    );

    res.status(201).json({ id: result.lastID, order_serial_number, order_id: orderId, complaint_time: nowStr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==================== MANAGER DASHBOARD ROUTES ====================

// GET summary KPIs (protected)
app.get('/api/manager/summary', requireRole('manager'), async (req, res) => {
  try {
    const db = await getDb();
    const filters = getManagerFilters(req);
    const today = new Date().toISOString().substring(0, 10);

    // Fetch all orders, trips, and complaints to filter in JS for maximum reactivity and flexibility
    const allOrders = await db.all('SELECT * FROM orders');
    const allTrips = await db.all('SELECT * FROM trips');
    const allComplaints = await db.all('SELECT * FROM complaints');

    // Filter by Date (Today vs custom range), Deliveryman, and Direction
    const filteredOrders = filterItems(allOrders, filters, 'entered_at', 'deliveryman_id', 'direction');
    const filteredTrips = filterItems(allTrips, filters, 'assigned_at', 'deliveryman_id', 'direction');
    const filteredComplaints = filterItems(allComplaints, filters, 'complaint_time', 'deliveryman_id', 'direction');

    // 1. Total orders count in date range
    const totalOrders = filteredOrders.length;

    // Status counts
    const waitingOrders = filteredOrders.filter(o => o.status === 'waiting').length;
    const assignedOrders = filteredOrders.filter(o => o.status === 'assigned').length;
    const outOrders = filteredOrders.filter(o => o.status === 'out').length;
    const completedOrders = filteredOrders.filter(o => o.status === 'completed').length;

    // 2. Orders that waited more than 10 minutes
    // Load max waiting setting to compare
    const settingsRow = await db.get("SELECT value FROM settings WHERE key = 'max_waiting_minutes'");
    const limitMins = settingsRow ? parseInt(settingsRow.value, 10) : 10;

    let waitedOverLimitCount = 0;
    filteredOrders.forEach(o => {
      let waitMinutes = 0;
      if (o.assigned_at) {
        // If assigned, actual wait time is assigned_at - entered_at
        waitMinutes = (new Date(o.assigned_at) - new Date(o.entered_at)) / 1000 / 60;
      } else {
        // If still waiting, current wait time is now - entered_at
        waitMinutes = (new Date() - new Date(o.entered_at)) / 1000 / 60;
      }
      if (waitMinutes > limitMins) {
        waitedOverLimitCount++;
      }
    });

    // 3. Average duration of completed trips
    const completedTrips = filteredTrips.filter(t => t.status === 'completed');
    const avgDuration = completedTrips.length > 0
      ? parseFloat((completedTrips.reduce((acc, t) => acc + t.duration_minutes, 0) / completedTrips.length).toFixed(2))
      : 0;

    // 4. Counts
    const totalTrips = filteredTrips.length;
    const stopsCount = filteredOrders.filter(o => o.has_branch_stop === 1).length;
    const totalComplaints = filteredComplaints.length;
    const timeComplaints = filteredComplaints.filter(c => c.is_time_complaint === 1).length;
    const behaviorComplaints = filteredComplaints.filter(c => c.is_behavior_complaint === 1).length;

    res.json({
      total_orders_today: totalOrders,
      waiting_orders_count: waitingOrders,
      assigned_orders_count: assignedOrders,
      out_orders_count: outOrders,
      completed_orders_count: completedOrders,
      orders_waited_more_than_10_minutes: waitedOverLimitCount,
      average_delivery_duration_overall: avgDuration,
      total_trips_today: totalTrips,
      stop_at_other_branch_orders_today: stopsCount,
      total_complaints_today: totalComplaints,
      time_complaints_count: timeComplaints,
      behavior_complaints_count: behaviorComplaints
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET deliverymen performance (protected)
app.get('/api/manager/deliverymen-performance', requireRole('manager'), async (req, res) => {
  try {
    const db = await getDb();
    const filters = getManagerFilters(req);

    const deliverymen = await db.all('SELECT id, name, status, last_out_at, last_back_at FROM deliverymen');
    const allTrips = await db.all('SELECT * FROM trips WHERE status = \'completed\'');
    const allOrders = await db.all('SELECT * FROM orders WHERE status = \'completed\'');

    const performance = deliverymen.map(dm => {
      // Filter trips and orders belonging to this deliveryman AND matching filters
      const dmFilters = { ...filters, deliverymanId: dm.id };
      
      const filteredTrips = filterItems(allTrips, dmFilters, 'assigned_at', 'deliveryman_id', 'direction');
      const filteredOrders = filterItems(allOrders, dmFilters, 'entered_at', 'deliveryman_id', 'direction');

      const numTrips = filteredTrips.length;
      const numOrders = filteredOrders.length;

      let avgTrip = 0;
      let minTrip = 0;
      let maxTrip = 0;

      if (numTrips > 0) {
        const durations = filteredTrips.map(t => t.duration_minutes);
        const sum = durations.reduce((acc, val) => acc + val, 0);
        avgTrip = parseFloat((sum / numTrips).toFixed(2));
        minTrip = parseFloat(Math.min(...durations).toFixed(2));
        maxTrip = parseFloat(Math.max(...durations).toFixed(2));
      }

      return {
        id: dm.id,
        name: dm.name,
        status: dm.status,
        number_of_trips: numTrips,
        number_of_orders_delivered: numOrders,
        average_trip_duration: avgTrip,
        shortest_trip_duration: minTrip,
        longest_trip_duration: maxTrip,
        last_out_time: dm.last_out_at,
        last_back_time: dm.last_back_at
      };
    });

    res.json(performance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET trip report with assignment-to-pickup timing (protected)
app.get('/api/manager/trips', requireRole('manager'), async (req, res) => {
  try {
    const db = await getDb();
    const filters = getManagerFilters(req);
    const nowStr = new Date().toISOString();

    const trips = await db.all(`
      SELECT t.*, dm.name as deliveryman_name
      FROM trips t
      LEFT JOIN deliverymen dm ON t.deliveryman_id = dm.id
      ORDER BY t.assigned_at DESC
    `);
    const tripOrderRows = await db.all('SELECT trip_id, order_id FROM trip_orders');
    const orderCountsByTripId = tripOrderRows.reduce((acc, row) => {
      acc[row.trip_id] = (acc[row.trip_id] || 0) + 1;
      return acc;
    }, {});

    const filtered = filterItems(trips, filters, 'assigned_at', 'deliveryman_id', 'direction');

    res.json(filtered.map(trip => {
      const pickupEnd = trip.out_at || nowStr;
      const assignmentToPickup = trip.penalty_minutes !== null && trip.penalty_minutes !== undefined
        ? trip.penalty_minutes
        : parseFloat(((new Date(pickupEnd) - new Date(trip.assigned_at)) / 1000 / 60).toFixed(2));
      const tripDuration = trip.duration_minutes || 0;
      const totalTime = parseFloat((assignmentToPickup + tripDuration).toFixed(2));

      return {
        id: trip.id,
        date: trip.assigned_at,
        direction: trip.direction,
        deliveryman_name: trip.deliveryman_name || 'N/A',
        status: trip.status,
        assigned_at: trip.assigned_at,
        pickup_at: trip.out_at,
        trip_start_at: trip.out_at,
        return_at: trip.back_at,
        assignment_to_pickup_minutes: assignmentToPickup,
        orders_count: orderCountsByTripId[trip.id] || 0,
        duration_minutes: trip.duration_minutes,
        total_time_minutes: totalTime
      };
    }));
  } catch (err) {
    console.error('[Manager Trips Report] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET stop orders (protected)
app.get('/api/manager/stops', requireRole('manager'), async (req, res) => {
  try {
    const db = await getDb();
    const filters = getManagerFilters(req);

    // Get orders with stops and join with deliveryman name
    const orders = await db.all(`
      SELECT o.*, dm.name as deliveryman_name 
      FROM orders o
      LEFT JOIN deliverymen dm ON o.deliveryman_id = dm.id
      WHERE o.has_branch_stop = 1
      ORDER BY o.entered_at DESC
    `);

    const filtered = filterItems(orders, filters, 'entered_at', 'deliveryman_id', 'direction');
    
    res.json(filtered.map(o => ({
      serial_number: o.serial_number,
      direction: o.direction,
      assigned_deliveryman: o.deliveryman_name || 'N/A',
      assigned_time: o.assigned_at,
      out_at: o.out_at,
      back_at: o.back_at,
      duration: o.delivery_duration_minutes || 0,
      date: o.entered_at
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET complaints details (protected)
app.get('/api/manager/complaints', requireRole('manager'), async (req, res) => {
  try {
    const db = await getDb();
    const filters = getManagerFilters(req);

    const complaints = await db.all(`
      SELECT c.*, o.direction as order_direction, o.status as order_status, dm.name as deliveryman_name
      FROM complaints c
      LEFT JOIN orders o ON c.order_id = o.id
      LEFT JOIN deliverymen dm ON c.deliveryman_id = dm.id
      ORDER BY c.complaint_time DESC
    `);

    // We filter complaints using the linked order's direction and deliveryman
    const filtered = filterItems(complaints, filters, 'complaint_time', 'deliveryman_id', 'order_direction');

    res.json(filtered.map(c => {
      let typeStr = 'Time';
      if (c.is_time_complaint === 1 && c.is_behavior_complaint === 1) {
        typeStr = 'Time + Behavior';
      } else if (c.is_behavior_complaint === 1) {
        typeStr = 'Behavior';
      }

      return {
        id: c.id,
        complaint_time: c.complaint_time,
        order_serial_number: c.order_serial_number,
        complaint_type: typeStr,
        deliveryman_assigned: c.deliveryman_name || 'N/A',
        order_direction: c.order_direction || 'N/A',
        order_status: c.order_status || 'Unknown'
      };
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET no-available-deliveryman assignment delays (protected)
app.get('/api/manager/assignment-delays', requireRole('manager'), async (req, res) => {
  try {
    const db = await getDb();
    const filters = getManagerFilters(req);
    const nowStr = new Date().toISOString();

    const delays = await db.all(`
      SELECT ad.*, dm.name as assigned_deliveryman_name
      FROM assignment_delays ad
      LEFT JOIN deliverymen dm ON ad.assigned_deliveryman_id = dm.id
      ORDER BY ad.delay_start DESC
    `);

    const filtered = filterItems(delays, filters, 'delay_start', 'assigned_deliveryman_id', 'direction');

    res.json(filtered.map(delay => {
      const delayEnd = delay.delay_end || nowStr;
      const duration = delay.duration_minutes !== null && delay.duration_minutes !== undefined
        ? delay.duration_minutes
        : parseFloat(((new Date(delayEnd) - new Date(delay.delay_start)) / 1000 / 60).toFixed(2));

      return {
        id: delay.id,
        date: delay.delay_start,
        direction: delay.direction,
        delay_start: delay.delay_start,
        delay_end: delay.delay_end,
        delay_duration_minutes: duration,
        delayed_orders_count: delay.delayed_orders_count || 0,
        assigned_deliveryman: delay.assigned_deliveryman_name || (delay.status === 'open' ? 'Pending' : 'N/A'),
        status: delay.status
      };
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get out periods when all deliverymen are out and orders are pending
app.get('/api/manager/out-periods', requireRole('manager'), async (req, res) => {
  try {
    const db = await getDb();
    const activeCount = await db.get("SELECT COUNT(*) as cnt FROM deliverymen WHERE status != 'out'");
    const waitingCountRow = await db.get("SELECT COUNT(*) as cnt FROM orders WHERE status = 'waiting'");
    const waitingCount = waitingCountRow.cnt;
    if (activeCount.cnt === 0 && waitingCount > 0) {
        const earliest = await db.get("SELECT entered_at FROM orders WHERE status = 'waiting' ORDER BY entered_at ASC LIMIT 1");
        const now = new Date().toISOString();
        const durationMinutes = Math.round((new Date(now) - new Date(earliest.entered_at)) / 60000);
        const pendingRows = await db.all("SELECT serial_number FROM orders WHERE status = 'waiting'");
        const pendingSerials = pendingRows.map(r => r.serial_number);
        res.json({
            all_out: true,
            pending_orders: waitingCount,
            period_start: earliest.entered_at,
            period_end: now,
            duration_minutes: durationMinutes,
            pending_order_numbers: pendingSerials
        });
    } else {
        const pendingRows = await db.all("SELECT serial_number FROM orders WHERE status = 'waiting'");
        const pendingSerials = pendingRows.map(r => r.serial_number);
        res.json({
            all_out: false,
            pending_orders: waitingCount,
            pending_order_numbers: pendingSerials
        });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get historical out periods
app.get('/api/manager/out-periods/history', requireRole('manager'), async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all('SELECT * FROM out_periods ORDER BY period_start DESC');
    const data = rows.map(r => ({
      id: r.id,
      period_start: r.period_start,
      period_end: r.period_end,
      duration_minutes: r.duration_minutes,
      pending_order_numbers: r.pending_serials ? JSON.parse(r.pending_serials) : []
    }));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Export manager report to Excel (protected)
app.get('/api/manager/export', requireRole('manager'), async (req, res) => {
  try {
    const db = await getDb();
    const filters = getManagerFilters(req);

    const orders = filterItems(await db.all(`
      SELECT o.*, dm.name as deliveryman_name
      FROM orders o
      LEFT JOIN deliverymen dm ON o.deliveryman_id = dm.id
      ORDER BY o.entered_at DESC
    `), filters, 'entered_at', 'deliveryman_id', 'direction');

    const rawTrips = await db.all(`
      SELECT t.*, dm.name as deliveryman_name
      FROM trips t
      LEFT JOIN deliverymen dm ON t.deliveryman_id = dm.id
      ORDER BY t.assigned_at DESC
    `);
    const exportTripOrderRows = await db.all('SELECT trip_id, order_id FROM trip_orders');
    const exportOrderCountsByTripId = exportTripOrderRows.reduce((acc, row) => {
      acc[row.trip_id] = (acc[row.trip_id] || 0) + 1;
      return acc;
    }, {});
    const trips = filterItems(rawTrips, filters, 'assigned_at', 'deliveryman_id', 'direction');
    const exportTrips = trips.map(trip => {
      const assignmentToPickup = trip.penalty_minutes !== null && trip.penalty_minutes !== undefined
        ? trip.penalty_minutes
        : (trip.assigned_at ? parseFloat(((new Date((trip.out_at || new Date().toISOString())) - new Date(trip.assigned_at)) / 1000 / 60).toFixed(2)) : 0);
      const tripDuration = trip.duration_minutes || 0;

      return {
        ...trip,
        orders_count: exportOrderCountsByTripId[trip.id] || 0,
        assignment_time: trip.assigned_at,
        pickup_time: trip.out_at,
        assignment_to_pickup_minutes: assignmentToPickup,
        trip_start_time: trip.out_at,
        return_time: trip.back_at,
        total_time_minutes: parseFloat((assignmentToPickup + tripDuration).toFixed(2))
      };
    });

    const complaints = filterItems(await db.all(`
      SELECT c.*, dm.name as deliveryman_name, o.direction as direction, o.status as order_status
      FROM complaints c
      LEFT JOIN orders o ON c.order_id = o.id
      LEFT JOIN deliverymen dm ON c.deliveryman_id = dm.id
      ORDER BY c.complaint_time DESC
    `), filters, 'complaint_time', 'deliveryman_id', 'direction');

    const assignmentDelays = filterItems(await db.all(`
      SELECT ad.id,
             ad.direction,
             ad.delay_start,
             ad.delay_end,
             ad.duration_minutes,
             ad.delayed_orders_count,
             ad.assigned_deliveryman_id,
             ad.status,
             dm.name as assigned_deliveryman_name
      FROM assignment_delays ad
      LEFT JOIN deliverymen dm ON ad.assigned_deliveryman_id = dm.id
      ORDER BY ad.delay_start DESC
    `), filters, 'delay_start', 'assigned_deliveryman_id', 'direction');

    const performance = await db.all(`
      SELECT dm.id, dm.name, dm.status,
             COUNT(t.id) as number_of_trips,
             COALESCE(ROUND(AVG(CASE WHEN t.status = 'completed' THEN t.duration_minutes END), 2), 0) as average_trip_duration
      FROM deliverymen dm
      LEFT JOIN trips t ON t.deliveryman_id = dm.id
      GROUP BY dm.id, dm.name, dm.status
      ORDER BY dm.name
    `);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(performance), 'Performance');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(orders), 'Orders');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(exportTrips), 'Trips');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(complaints), 'Complaints');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(assignmentDelays), 'Assignment Delays');

    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    const today = new Date().toISOString().substring(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="delivery-report-${today}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset Database API (for easy testing/debugging) (protected)
app.post('/api/reset-database', requireRole('manager'), async (req, res) => {
  try {
    await resetDb();
    res.json({ message: 'Database reset successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Express Server locally / on long-running hosts. Vercel imports the app.
if (!IS_VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export default app;

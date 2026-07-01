import { getDb } from './database.js';

/**
 * Runs the assignment engine.
 * Can be called manually or automatically.
 * Returns an array of logs describing actions taken.
 */
export async function runAssignmentEngine() {
  const db = await getDb();
  const logs = [];
  const nowStr = new Date().toISOString();
  const now = new Date(nowStr);

  // 1. Load Settings
  let directions = ['1', '3', '6', '10'];
  let maxOrdersPerTrip = 3;
  let maxWaitingMinutes = 10;

  try {
    const settingsRows = await db.all('SELECT key, value FROM settings');
    for (const row of settingsRows) {
      if (row.key === 'directions') {
        directions = JSON.parse(row.value);
      } else if (row.key === 'max_orders_per_trip') {
        maxOrdersPerTrip = parseInt(row.value, 10);
      } else if (row.key === 'max_waiting_minutes') {
        maxWaitingMinutes = parseInt(row.value, 10);
      }
    }
  } catch (error) {
    logs.push(`Error loading settings: ${error.message}. Using defaults.`);
  }

  // 2. Fetch available active deliverymen ordered by ready_since ascending
  const availableDeliverymen = await db.all(
    `SELECT * FROM deliverymen 
     WHERE is_active = 1 AND status = 'available' 
     ORDER BY ready_since ASC`
  );

  // 3. For each direction, find orders that are waiting
  const batchesToAssign = [];

  for (const direction of directions) {
    const waitingOrders = await db.all(
      `SELECT * FROM orders 
       WHERE direction = ? AND status = 'waiting' 
       ORDER BY entered_at ASC`,
      [direction]
    );

    if (waitingOrders.length === 0) continue;

    // Check if we can create a batch
    const oldestOrder = waitingOrders[0];
    const oldestEntered = new Date(oldestOrder.entered_at);
    const waitTimeMinutes = (now - oldestEntered) / 1000 / 60;

    let shouldBatch = false;
    let batchSize = 0;

    if (waitingOrders.length >= maxOrdersPerTrip) {
      shouldBatch = true;
      batchSize = maxOrdersPerTrip;
      logs.push(`Direction ${direction} has ${waitingOrders.length} waiting orders (threshold ${maxOrdersPerTrip}). Batching top ${maxOrdersPerTrip}.`);
    } else if (waitTimeMinutes >= maxWaitingMinutes) {
      shouldBatch = true;
      batchSize = waitingOrders.length;
      logs.push(`Direction ${direction} oldest order (${oldestOrder.serial_number}) has waited ${waitTimeMinutes.toFixed(1)} minutes (limit ${maxWaitingMinutes}). Batching ${batchSize} orders.`);
    }

    if (shouldBatch) {
      const batchOrders = waitingOrders.slice(0, batchSize);
      batchesToAssign.push({
        direction,
        orders: batchOrders,
        oldestEnteredAt: oldestEntered
      });
    }
  }

  // Sort batches by oldest entered time so we prioritize the longest-waiting direction first
  batchesToAssign.sort((a, b) => a.oldestEnteredAt - b.oldestEnteredAt);

  let deliverymanIndex = 0;

  for (const batch of batchesToAssign) {
    if (deliverymanIndex >= availableDeliverymen.length) {
      const existingDelay = await db.get(
        `SELECT id, delayed_orders_count
         FROM assignment_delays
         WHERE direction = ? AND status = 'open'
         ORDER BY delay_start ASC
         LIMIT 1`,
        [batch.direction]
      );

      if (existingDelay) {
        await db.run(
          `UPDATE assignment_delays
           SET delayed_orders_count = ?, updated_at = ?
           WHERE id = ?`,
          [Math.max(existingDelay.delayed_orders_count || 0, batch.orders.length), nowStr, existingDelay.id]
        );
      } else {
        await db.run(
          `INSERT INTO assignment_delays
           (direction, delay_start, delayed_orders_count, status, created_at, updated_at)
           VALUES (?, ?, ?, 'open', ?, ?)`,
          [batch.direction, nowStr, batch.orders.length, nowStr, nowStr]
        );
      }

      logs.push(`Warning: Batch in Direction ${batch.direction} is ready, but no available active deliveryman is in the branch!`);
      continue;
    }

    const deliveryman = availableDeliverymen[deliverymanIndex];
    deliverymanIndex++;

    try {
      // Start transaction or sequential writes to assign this batch
      await db.run('BEGIN TRANSACTION');

      // Create a trip with status 'assigned'
      const tripResult = await db.run(
        `INSERT INTO trips (deliveryman_id, direction, status, assigned_at, created_at, updated_at)
         VALUES (?, ?, 'assigned', ?, ?, ?)`,
        [deliveryman.id, batch.direction, nowStr, nowStr, nowStr]
      );
      const tripId = tripResult.lastID;

      const openDelay = await db.get(
        `SELECT id, delay_start
         FROM assignment_delays
         WHERE direction = ? AND status = 'open'
         ORDER BY delay_start ASC
         LIMIT 1`,
        [batch.direction]
      );

      if (openDelay) {
        const delayDurationMinutes = parseFloat(((new Date(nowStr) - new Date(openDelay.delay_start)) / 1000 / 60).toFixed(2));
        await db.run(
          `UPDATE assignment_delays
           SET delay_end = ?,
               duration_minutes = ?,
               delayed_orders_count = ?,
               assigned_deliveryman_id = ?,
               trip_id = ?,
               status = 'closed',
               updated_at = ?
           WHERE id = ?`,
          [nowStr, delayDurationMinutes, batch.orders.length, deliveryman.id, tripId, nowStr, openDelay.id]
        );
      }

      // Update deliveryman status to 'assigned'
      await db.run(
        `UPDATE deliverymen 
         SET status = 'assigned', updated_at = ? 
         WHERE id = ?`,
        [nowStr, deliveryman.id]
      );

      // Update each order in the batch
      for (const order of batch.orders) {
        await db.run(
          `UPDATE orders 
           SET status = 'assigned', assigned_at = ?, deliveryman_id = ?, trip_id = ?, updated_at = ? 
           WHERE id = ?`,
          [nowStr, deliveryman.id, tripId, nowStr, order.id]
        );

        // Add to trip_orders join table
        await db.run(
          `INSERT INTO trip_orders (trip_id, order_id) 
           VALUES (?, ?)`,
          [tripId, order.id]
        );
      }

      await db.run('COMMIT');
      logs.push(`Successfully assigned trip ${tripId} (Direction ${batch.direction}) to deliveryman ${deliveryman.name} with ${batch.orders.length} orders.`);
    } catch (err) {
      await db.run('ROLLBACK');
      logs.push(`Error assigning batch to ${deliveryman.name}: ${err.message}`);
      // Put deliveryman back or exit loop
      deliverymanIndex--; 
    }
  }

  return logs;
}

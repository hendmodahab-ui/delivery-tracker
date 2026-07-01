import { getDb, resetDb } from './database.js';
import { runAssignmentEngine } from './assignmentEngine.js';

async function runTests() {
  console.log('--- Starting Backend Verification Tests ---');

  // 1. Reset Database
  await resetDb();
  console.log('✔ Database reset and seeded defaults.');

  const db = await getDb();

  // Test 1: Check initial deliverymen
  const deliverymen = await db.all('SELECT * FROM deliverymen');
  if (deliverymen.length !== 4) {
    throw new Error(`Expected 4 initial deliverymen, got ${deliverymen.length}`);
  }
  console.log('✔ Default deliverymen successfully seeded.');

  // Test 2: Check setting defaults
  const settings = await db.all('SELECT * FROM settings');
  if (settings.length !== 3) {
    throw new Error(`Expected 3 settings rows, got ${settings.length}`);
  }
  console.log('✔ Default settings successfully seeded.');

  // Test 3: Insert 2 orders in direction 1 (should remain waiting)
  const now = new Date().toISOString();
  await db.run(
    "INSERT INTO orders (serial_number, direction, status, entered_at) VALUES ('S-101', '1', 'waiting', ?)",
    [now]
  );
  await db.run(
    "INSERT INTO orders (serial_number, direction, status, entered_at) VALUES ('S-102', '1', 'waiting', ?)",
    [now]
  );

  let logs = await runAssignmentEngine();
  // Ensure no assignments happened since we only have 2 orders (< 3) and they just entered (0 wait)
  let assignedTrips = await db.all("SELECT * FROM trips WHERE status = 'assigned'");
  if (assignedTrips.length !== 0) {
    throw new Error('Should not assign trip with only 2 new waiting orders.');
  }
  console.log('✔ Two orders do not trigger assignment (below 3 count and 10 mins).');

  // Test 4: Duplicate serial check validation
  try {
    const todayStr = now.substring(0, 10);
    const duplicate = await db.get(
      "SELECT id FROM orders WHERE serial_number = ? AND SUBSTR(entered_at, 1, 10) = ?",
      ['S-101', todayStr]
    );
    if (!duplicate) throw new Error('Duplicate check failed: S-101 is not found.');
    console.log('✔ Duplicate serial lookup works.');
  } catch (err) {
    throw new Error(`Duplicate validation failed: ${err.message}`);
  }

  // Test 5: Add a 3rd order in direction 1 (should trigger assignment immediately!)
  await db.run(
    "INSERT INTO orders (serial_number, direction, status, entered_at) VALUES ('S-103', '1', 'waiting', ?)",
    [now]
  );
  logs = await runAssignmentEngine();
  console.log('Engine log:', logs.join('\n'));

  assignedTrips = await db.all("SELECT * FROM trips WHERE status = 'assigned'");
  if (assignedTrips.length !== 1) {
    throw new Error(`Expected 1 assigned trip, got ${assignedTrips.length}`);
  }

  const firstTrip = assignedTrips[0];
  if (firstTrip.direction !== '1') {
    throw new Error(`Expected trip direction to be '1', got ${firstTrip.direction}`);
  }

  const assignedOrders = await db.all("SELECT * FROM orders WHERE trip_id = ?", [firstTrip.id]);
  if (assignedOrders.length !== 3) {
    throw new Error(`Expected 3 orders assigned to trip, got ${assignedOrders.length}`);
  }
  console.log('✔ Batch of 3 waiting orders successfully auto-assigned.');

  // Check deliveryman status is now 'assigned'
  const assignedDM = await db.get('SELECT * FROM deliverymen WHERE id = ?', [firstTrip.deliveryman_id]);
  if (assignedDM.status !== 'assigned') {
    throw new Error(`Expected deliveryman status to be 'assigned', got ${assignedDM.status}`);
  }
  console.log(`✔ Deliveryman '${assignedDM.name}' correctly set to status 'assigned'.`);

  // Test 6: Mark Out
  const outTime = new Date().toISOString();
  // Simulate out API behavior
  await db.run("UPDATE trips SET status = 'out', out_at = ? WHERE id = ?", [outTime, firstTrip.id]);
  await db.run("UPDATE orders SET status = 'out', out_at = ? WHERE trip_id = ?", [outTime, firstTrip.id]);
  await db.run("UPDATE deliverymen SET status = 'out', last_out_at = ? WHERE id = ?", [outTime, firstTrip.deliveryman_id]);

  const outDM = await db.get('SELECT * FROM deliverymen WHERE id = ?', [firstTrip.deliveryman_id]);
  if (outDM.status !== 'out') {
    throw new Error(`Expected deliveryman status to be 'out', got ${outDM.status}`);
  }
  console.log('✔ Trip marked out. Deliveryman status updated to "out".');

  // Test 7: Mark Back (Calculate duration)
  const backTime = new Date(new Date(outTime).getTime() + 15 * 60 * 1000).toISOString(); // 15 minutes later
  const durationMs = new Date(backTime) - new Date(outTime);
  const durationMinutes = parseFloat((durationMs / 1000 / 60).toFixed(2)); // Should be 15

  await db.run("UPDATE trips SET status = 'completed', back_at = ?, duration_minutes = ? WHERE id = ?", [backTime, durationMinutes, firstTrip.id]);
  await db.run("UPDATE orders SET status = 'completed', back_at = ?, delivery_duration_minutes = ? WHERE trip_id = ?", [backTime, durationMinutes, firstTrip.id]);
  await db.run("UPDATE deliverymen SET status = 'available', last_back_at = ?, ready_since = ? WHERE id = ?", [backTime, backTime, firstTrip.deliveryman_id]);

  const backTrip = await db.get('SELECT * FROM trips WHERE id = ?', [firstTrip.id]);
  if (backTrip.duration_minutes !== 15) {
    throw new Error(`Expected duration 15 minutes, got ${backTrip.duration_minutes}`);
  }

  const completedDM = await db.get('SELECT * FROM deliverymen WHERE id = ?', [firstTrip.deliveryman_id]);
  if (completedDM.status !== 'available' || completedDM.ready_since !== backTime) {
    throw new Error('Deliveryman did not return to available state correctly.');
  }
  console.log(`✔ Trip marked back. Trip duration verified: ${backTrip.duration_minutes} minutes. Deliveryman available again.`);

  // Test 8: Older order waiting more than 10 minutes (should batch assign)
  // Put 1 order in Direction 3, but mock entered_at to 11 minutes ago
  const elevenMinsAgo = new Date(new Date().getTime() - 11 * 60 * 1000).toISOString();
  await db.run(
    "INSERT INTO orders (serial_number, direction, status, entered_at) VALUES ('S-201', '3', 'waiting', ?)",
    [elevenMinsAgo]
  );
  
  // Run assignment engine
  logs = await runAssignmentEngine();
  console.log('Engine log:', logs.join('\n'));

  // Should have assigned S-201 to the available deliveryman because wait time was 11 mins (> 10 max wait)
  const trip2 = await db.get("SELECT * FROM trips WHERE direction = '3' AND status = 'assigned'");
  if (!trip2) {
    throw new Error('Oldest order waiting > 10 minutes did not get assigned.');
  }
  console.log('✔ Oldest order waiting > 10 minutes successfully assigned.');

  console.log('\n--- All Backend Verification Tests Passed! ---');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

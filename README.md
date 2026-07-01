# Branch Delivery Order Tracking & Auto-Assignment Engine

A complete, production-ready delivery order tracking, batching, and auto-assignment web application designed to run locally on a branch computer. It allows staff to input orders quickly, automatically batches and assigns orders to deliverymen in FIFO order based on strict business rules, and provides a manager analytics dashboard for team performance, branch stop tracking, and customer complaints audits.

---

## 🛠 Tech Stack

- **Frontend**: React + Vite (Vanilla JS)
- **Backend**: Node.js + Express
- **Database**: SQLite (managed with standard `sqlite3` + promise wrapper `sqlite`)
- **Styling**: Modern, premium Vanilla CSS custom design system (Dark mode & glassmorphism by default)

---

## 📋 Core Business Rules

1. **Configure Directions**: Default directions are `1`, `3`, `6`, and `10`, but they can be custom renamed from the **Settings** screen.
2. **Order Constraints**: Each trip can carry a **maximum of 3 orders** (configurable) for **exactly one direction** (cannot mix directions in a single trip).
3. **Wait Time Limit**: An order should not stay waiting in the branch for more than **10 minutes** (configurable).
4. **Auto-Assignment Conditions**: A batch is assigned to a deliveryman when:
   - There are **3 waiting orders** in the same direction, OR
   - The oldest waiting order in that direction has waited **10 minutes** or more.
5. **FIFO Queue**: Batches are assigned to the available active deliveryman who has been waiting the longest (`ready_since` / last back time ascending).
6. **No Mixer Trips**: Deliverymen can only deliver to one direction per trip.
7. **Warning Indicators**: Waiting orders are highlighted:
   - 🟢 **Normal**: Waiting `< 8` minutes.
   - 🟡 **Warning**: Waiting `8 - 10` minutes.
   - 🔴 **Urgent**: Waiting `10+` minutes (flashes).

---

## 📂 Project Directory Structure

```text
delivery-tracker/
├── backend/
│   ├── database.js          # SQLite connection and schema creation
│   ├── assignmentEngine.js  # Core FIFO batch assignment logic
│   ├── server.js            # Express API routing & background timer
│   ├── test.js              # Unit tests for assignment rules
│   └── package.json
└── frontend/
    ├── src/
    │   ├── components/      # React Views (Staff, Roster, Driver, Manager, Settings)
    │   ├── App.jsx          # Main layout, polling state, & notifications
    │   ├── main.jsx         # React DOM mounting
    │   └── index.css        # Premium custom Dark UI CSS system
    ├── index.html           # Document template
    ├── vite.config.js       # API proxy settings
    └── package.json
```

---

## 🚀 Setup & Installation Instructions

### Prerequisites
- Node.js (v18 or higher recommended)
- Git (optional)

### Step 1: Install Dependencies
Open your terminal in the respective directories and run:

**For Backend:**
```bash
cd backend
npm install
```

**For Frontend:**
```bash
cd ../frontend
npm install
```

---

## 运行 App (Running the Application)

To run the application locally on a branch computer:

### 1. Start the Backend Server
Navigate to the `backend/` directory and run:
```bash
npm start
```
*The server will start on [http://localhost:5000](http://localhost:5000). The auto-assignment engine scheduler will initialize and check waiting orders every minute.*

### 2. Start the Frontend Client
Navigate to the `frontend/` directory and run:
```bash
npm run dev
```
*Vite will compile and serve the frontend at [http://localhost:3000](http://localhost:3000). It will proxy API requests to port 5000 automatically.*

Open [http://localhost:3000](http://localhost:3000) in your web browser.

---

## 🧪 Verification & Testing

### 1. Run Backend Unit Tests
We have included a test script that validates the SQLite transaction system, FIFO ordering queue, duplicate checks, and threshold triggers.

Navigate to the `backend/` directory and run:
```bash
node test.js
```
Expected output:
```text
--- Starting Backend Verification Tests ---
✔ Database reset and seeded defaults.
✔ Default deliverymen successfully seeded.
✔ Default settings successfully seeded.
✔ Two orders do not trigger assignment (below 3 count and 10 mins).
✔ Duplicate serial lookup works.
Engine log: Direction 1 has 3 waiting orders (threshold 3). Batching top 3.
Successfully assigned trip 1 (Direction 1) to deliveryman Alex Mercer with 3 orders.
✔ Batch of 3 waiting orders successfully auto-assigned.
✔ Deliveryman 'Alex Mercer' correctly set to status 'assigned'.
✔ Trip marked out. Deliveryman status updated to "out".
✔ Trip marked back. Trip duration verified: 15 minutes. Deliveryman available again.
Engine log: Direction 3 oldest order (S-201) has waited 11.0 minutes (limit 10). Batching 1 orders.
Successfully assigned trip 2 (Direction 3) to deliveryman Beatrix Kiddo with 1 orders.
✔ Oldest order waiting > 10 minutes successfully assigned.

--- All Backend Verification Tests Passed! ---
```

### 2. How to Reset the Database
You can clear all demo data, orders, trips, and complaints, resetting the SQLite DB to default settings, by navigating to the **Settings Screen** in the app and clicking the **Reset System Database** button.

Alternatively, you can manually delete the `backend/delivery_tracker.db` file and restart the server, which will re-initialize it automatically.

---

## 💡 Quick Demo Test Run

1. Open the application. Go to the **Team Roster** tab and verify the seeded deliverymen exist (`Alex Mercer`, `Beatrix Kiddo`, `Clarice Starling` are active and available).
2. Go to the **Staff Dashboard** tab. Enter order `SN-001` in Direction `1`. You will see it in the waiting column for Direction 1 with a green ticking timer.
3. Enter order `SN-002` in Direction `1`. It joins the queue.
4. Enter order `SN-003` in Direction `1`. Since the total waiting count in Direction 1 reaches 3, the engine instantly batches them. A notification toast pops up:
   *`🔔 Trip Assigned! 'Alex Mercer' has been auto-assigned orders [SN-001, SN-002, SN-003] in Direction 1.`*
5. Look at the right panel (**Trips Waiting Pickup**). The trip is listed under `Alex Mercer`. Click **Mark Out / Picked Up**.
6. Switch to the **Deliveryman Card** tab. Select `Alex Mercer` from the dropdown. You see his active trip orders. Click **I Am Out** (simulate departure) and then **I Am Back** (simulate return).
7. Go to the **Manager Center** tab. Observe the KPI summary updates, average trip duration calculation, and deliveryman performance statistics.
8. Test complaints by going to the **Staff Dashboard** and clicking **Report Complaint**. Input `SN-001`, check **Time Complaint**, and submit. See the complaint reflected in the Manager tables instantly.

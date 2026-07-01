import authFetch from '../utils/authFetch.js';
import React, { useState, useEffect } from 'react';

export default function StaffDashboard({
  orders,
  deliverymen,
  settings,
  addToast,
  refreshData
}) {
  const [serialNumber, setSerialNumber] = useState('');
  const [direction, setDirection] = useState('');
  const [hasBranchStop, setHasBranchStop] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);

  // Complaints form state
  const [showComplaintModal, setShowComplaintModal] = useState(false);
  const [complaintSerial, setComplaintSerial] = useState('');
  const [isTimeComplaint, setIsTimeComplaint] = useState(false);
  const [isBehaviorComplaint, setIsBehaviorComplaint] = useState(false);

  // Trigger clock ticker for waiting orders
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Set default direction once settings load
  useEffect(() => {
    if (settings && settings.directions && settings.directions.length > 0 && !direction) {
      setDirection(settings.directions[0]);
    }
  }, [settings]);

  const handleOrderSubmit = async (e) => {
    e.preventDefault();
    if (isSubmittingOrder) return;
    setIsSubmittingOrder(true);

    try {
      const res = await authFetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serial_number: serialNumber.trim(),
          direction,
          has_branch_stop: hasBranchStop
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to submit order.');
      }

      const data = await res.json();
      addToast(`Order ${serialNumber.trim()} added successfully!`, 'success');
      
      // If assignment was run, show logs
      if (data.logs && data.logs.length > 0) {
        data.logs.forEach(log => {
          if (log.includes('Successfully assigned')) {
            addToast(log, 'success');
          }
        });
      }

      // Reset form
      setSerialNumber('');
      setHasBranchStop(false);
      refreshData();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const handleComplaintSubmit = async (e) => {
    e.preventDefault();
    if (!complaintSerial.trim()) {
      addToast('Serial number is required for complaints.', 'error');
      return;
    }
    if (!isTimeComplaint && !isBehaviorComplaint) {
      addToast('Please select at least one complaint type.', 'error');
      return;
    }

    try {
      const res = await authFetch('/api/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_serial_number: complaintSerial.trim(),
          is_time_complaint: isTimeComplaint,
          is_behavior_complaint: isBehaviorComplaint
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save complaint.');
      }

      addToast(`Complaint saved for order ${complaintSerial.trim()}!`, 'success');
      // Reset form
      setComplaintSerial('');
      setIsTimeComplaint(false);
      setIsBehaviorComplaint(false);
      setShowComplaintModal(false);
      refreshData();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const handleMarkOut = async (tripId, dmName) => {
    try {
      const res = await authFetch(`/api/trips/${tripId}/out`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to mark out.');
      }
      addToast(`Deliveryman ${dmName} is now OUT!`, 'success');
      refreshData();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  // Group waiting orders by direction
  const waitingOrders = orders.filter(o => o.status === 'waiting');
  const dirsList = settings?.directions || ['1', '3', '6', '10'];

  const ordersByDirection = {};
  dirsList.forEach(dir => {
    ordersByDirection[dir] = waitingOrders.filter(o => o.direction === dir);
  });

  // Calculate live waiting time in seconds
  const getWaitSeconds = (enteredAtStr) => {
    const entered = new Date(enteredAtStr);
    const diffMs = now - entered;
    return diffMs > 0 ? Math.floor(diffMs / 1000) : 0;
  };

  const formatWaitTime = (totalSeconds) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const getUrgencyClass = (totalSeconds) => {
    const limitMinutes = settings?.max_waiting_minutes || 10;
    const limitSec = limitMinutes * 60;
    const warningSec = (limitMinutes - 2) * 60; // 8 minutes if limit is 10

    if (totalSeconds >= limitSec) return 'urgent';
    if (totalSeconds >= warningSec) return 'warning';
    return 'normal';
  };

  // Filter out deliverymen that have an assigned (but not yet out) trip
  // We can also find assigned trips from the deliverymen list:
  const assignedDeliverymen = deliverymen.filter(d => d.status === 'assigned');
  const fullDeliveryQueue = deliverymen.find(d => Array.isArray(d.full_queue) && d.full_queue.length > 0)?.full_queue
    || deliverymen
      .filter(d => d.is_active === 1 && d.status === 'available')
      .sort((a, b) => new Date(a.ready_since || 0) - new Date(b.ready_since || 0))
      .map(({ id, name, status, ready_since }) => ({ id, name, status, ready_since }));

  // Check if any order is close to or over wait limits but no deliveryman is available
  const hasWaitingOrdersReady = Object.values(ordersByDirection).some(dirOrders => {
    if (dirOrders.length >= (settings?.max_orders_per_trip || 3)) return true;
    if (dirOrders.length > 0) {
      const oldestSec = getWaitSeconds(dirOrders[0].entered_at);
      if (oldestSec >= (settings?.max_waiting_minutes || 10) * 60) return true;
    }
    return false;
  });
  
  const noDeliverymenAvailable = !deliverymen.some(d => d.is_active === 1 && d.status === 'available');
  const showNoDmWarning = hasWaitingOrdersReady && noDeliverymenAvailable;

  return (
    <div>
      {showNoDmWarning && (
        <div className="system-warning-banner">
          Orders are ready for assignment in one or more directions, but NO deliveryman is available in the branch!
        </div>
      )}

      <div className="dashboard-grid">
        {/* Left Column: Orders Operations */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* New Order Form */}
          <div className="card">
            <h2 className="section-title">Add New Order</h2>
            <form onSubmit={handleOrderSubmit} className="form-row" style={{ alignItems: 'flex-end' }}>
              <div className="form-group" style={{ flex: '2' }}>
                <label htmlFor="serial-input">Serial Number</label>
                <input
                  id="serial-input"
                  type="text"
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.target.value)}
                  placeholder="e.g. SN-98124"
                  required
                />
              </div>

              <div className="form-group" style={{ flex: '1' }}>
                <label htmlFor="direction-select">Direction</label>
                <select
                  id="direction-select"
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                  required
                >
                  {dirsList.map(dir => (
                    <option key={dir} value={dir}>
                      Direction {dir}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ flex: '1.5', minWidth: '180px', paddingBottom: '0.75rem' }}>
                <label className="checkbox-group">
                  <input
                    type="checkbox"
                    checked={hasBranchStop}
                    onChange={(e) => setHasBranchStop(e.target.checked)}
                  />
                  <span>Stop at other branch</span>
                </label>
              </div>

              <div className="form-group" style={{ flex: '1' }}>
                <button type="submit" className="btn" style={{ width: '100%' }} disabled={isSubmittingOrder}>
                  Add Order
                </button>
              </div>
            </form>
          </div>

          {/* Waiting Orders List grouped by Direction */}
          <div className="card">
            <div className="flex-between">
              <h2 className="section-title">Waiting Orders</h2>
              <button onClick={() => setShowComplaintModal(true)} className="btn btn-danger btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
                📢 Report Complaint
              </button>
            </div>
            
            <div className="waiting-directions-container">
              {dirsList.map(dir => {
                const dirOrders = ordersByDirection[dir] || [];
                return (
                  <div key={dir} className="direction-column">
                    <div className="direction-header">
                      <span>Direction {dir}</span>
                      <span className="direction-count">{dirOrders.length} wait</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto', maxHeight: '350px' }}>
                      {dirOrders.length === 0 ? (
                        <div style={{ color: 'var(--color-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '2rem 0' }}>
                          Empty
                        </div>
                      ) : (
                        dirOrders.map(o => {
                          const waitSec = getWaitSeconds(o.entered_at);
                          const urgency = getUrgencyClass(waitSec);
                          return (
                            <div key={o.id} className={`order-item-card order-${urgency}`}>
                              <div className="order-meta">
                                <span className="serial-text">{o.serial_number}</span>
                                <span className={`timer-text ${urgency}`}>
                                  ⏱ {formatWaitTime(waitSec)}
                                </span>
                              </div>
                              {o.has_branch_stop === 1 && (
                                <span className="branch-stop-badge">Stop other branch</span>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Assigned Trips Waiting for Pickup */}
        <div className="card">
          <div className="staff-queue-panel">
            <div className="queue-panel-header">
              <span>Deliveryman Queue</span>
              <strong>{fullDeliveryQueue.length} available</strong>
            </div>
            {fullDeliveryQueue.length === 0 ? (
              <div className="queue-empty">No available deliverymen in the queue.</div>
            ) : (
              <div className="staff-queue-list">
                {fullDeliveryQueue.map((dm, index) => (
                  <div key={dm.id} className={`staff-queue-row ${index === 0 ? 'current-turn' : ''}`}>
                    <span className="queue-position-badge">{index + 1}</span>
                    <span className="queue-name">{dm.name}</span>
                    {index === 0 && <span className="badge badge-available">Current turn</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <h2 className="section-title">Trips Waiting Pickup</h2>
          
          <div className="trips-section">
            {assignedDeliverymen.length === 0 ? (
              <div style={{ color: 'var(--color-muted)', fontStyle: 'italic', textAlign: 'center', padding: '3rem 0' }}>
                No trips currently assigned or waiting.
              </div>
            ) : (
              assignedDeliverymen.map(dm => {
                const hasStop = dm.current_orders?.some(o => o.has_branch_stop === 1);
                return (
                  <div key={dm.id} className="trip-card">
                    <div className="trip-title">
                      <span>Deliveryman: <strong style={{ color: 'var(--text-bright)' }}>{dm.name}</strong></span>
                      <span className="badge badge-assigned">Direction {dm.current_direction}</span>
                    </div>

                    <div style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>
                      Assigned Serials:
                    </div>
                    <div className="trip-orders-list">
                      {dm.current_orders?.map((o, idx) => (
                        <span key={idx} className="trip-order-tag">
                          {o.serial_number}
                        </span>
                      ))}
                    </div>

                    {hasStop && (
                      <div className="branch-stop-badge" style={{ marginTop: '0.25rem' }}>
                        ⚠ Contains stop at another branch
                      </div>
                    )}

                    <button
                      onClick={() => handleMarkOut(dm.current_trip_id, dm.name)}
                      className="btn btn-success"
                      style={{ marginTop: '0.5rem', width: '100%' }}
                    >
                      Mark Out / Picked Up
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Complaint Modal Dialog */}
      {showComplaintModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <div className="modal-title">Log Order Complaint</div>
              <button onClick={() => setShowComplaintModal(false)} className="modal-close">×</button>
            </div>
            
            <form onSubmit={handleComplaintSubmit}>
              <div className="form-group">
                <label htmlFor="complaint-serial">Order Serial Number</label>
                <input
                  id="complaint-serial"
                  type="text"
                  value={complaintSerial}
                  onChange={(e) => setComplaintSerial(e.target.value)}
                  placeholder="e.g. SN-98124"
                  required
                />
              </div>

              <div className="form-group" style={{ gap: '0.75rem', marginTop: '1rem', marginBottom: '1.5rem' }}>
                <label>Complaint Type</label>
                
                <label className="checkbox-group">
                  <input
                    type="checkbox"
                    checked={isTimeComplaint}
                    onChange={(e) => setIsTimeComplaint(e.target.checked)}
                  />
                  <span>Time Complaint (e.g. Late delivery)</span>
                </label>

                <label className="checkbox-group">
                  <input
                    type="checkbox"
                    checked={isBehaviorComplaint}
                    onChange={(e) => setIsBehaviorComplaint(e.target.checked)}
                  />
                  <span>Behavior Complaint (e.g. Staff conduct)</span>
                </label>
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setShowComplaintModal(false)}
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-danger"
                  style={{ flex: 1 }}
                >
                  Submit Complaint
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

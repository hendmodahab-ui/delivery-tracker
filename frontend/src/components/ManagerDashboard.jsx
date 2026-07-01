import authFetch from '../utils/authFetch.js';
import React, { useState, useEffect } from 'react';

export default function ManagerDashboard({ deliverymen, settings, addToast }) {
  const [dateMode, setDateMode] = useState('today'); // 'today' | 'custom'
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedDmId, setSelectedDmId] = useState('');
  const [selectedDirection, setSelectedDirection] = useState('');

  // Manager metrics state
  const [summary, setSummary] = useState(null);
  const [performance, setPerformance] = useState([]);
  const [tripReports, setTripReports] = useState([]);
  const [stops, setStops] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [assignmentDelays, setAssignmentDelays] = useState([]);
  const [loading, setLoading] = useState(true);

  // Set default dates for Custom Range input (e.g. today)
  useEffect(() => {
    const todayStr = new Date().toISOString().substring(0, 10);
    setStartDate(todayStr);
    setEndDate(todayStr);
  }, []);

  // Fetch manager data whenever filters change
  useEffect(() => {
    fetchManagerData();
  }, [dateMode, startDate, endDate, selectedDmId, selectedDirection]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchManagerData(true);
    }, 3000);
    return () => clearInterval(interval);
  }, [dateMode, startDate, endDate, selectedDmId, selectedDirection]);

  const fetchManagerData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Build query string based on filters
      const params = new URLSearchParams();

      if (dateMode === 'today') {
        const todayStr = new Date().toISOString().substring(0, 10);
        params.append('startDate', todayStr);
        params.append('endDate', todayStr);
      } else {
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
      }

      if (selectedDmId) params.append('deliverymanId', selectedDmId);
      if (selectedDirection) params.append('direction', selectedDirection);

      const queryStr = params.toString() ? `?${params.toString()}` : '';

      const [summaryRes, perfRes, tripsRes, stopsRes, complaintsRes, delaysRes] = await Promise.all([
        authFetch(`/api/manager/summary${queryStr}`),
        authFetch(`/api/manager/deliverymen-performance${queryStr}`),
        authFetch(`/api/manager/trips${queryStr}`),
        authFetch(`/api/manager/stops${queryStr}`),
        authFetch(`/api/manager/complaints${queryStr}`),
        authFetch(`/api/manager/assignment-delays${queryStr}`)
      ]);

      const failedReports = [
        ['summary', summaryRes],
        ['performance', perfRes],
        ['trips', tripsRes],
        ['stops', stopsRes],
        ['complaints', complaintsRes],
        ['assignment delays', delaysRes]
      ].filter(([, res]) => !res.ok).map(([name]) => name);

      if (failedReports.length > 0) {
        throw new Error(`Failed to retrieve manager analytics reports: ${failedReports.join(', ')}.`);
      }

      const summaryData = await summaryRes.json();
      const perfData = await perfRes.json();
      const tripsData = await tripsRes.json();
      const stopsData = await stopsRes.json();
      const complaintsData = await complaintsRes.json();
      const delaysData = await delaysRes.json();

      setSummary(summaryData);
      setPerformance(perfData);
      setTripReports(tripsData);
      setStops(stopsData);
      setComplaints(complaintsData);
      setAssignmentDelays(delaysData);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const directionsList = settings?.directions || ['1', '3', '6', '10'];

  const buildQueryString = () => {
    const params = new URLSearchParams();
    if (dateMode === 'today') {
      const todayStr = new Date().toISOString().substring(0, 10);
      params.append('startDate', todayStr);
      params.append('endDate', todayStr);
    } else {
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
    }
    if (selectedDmId) params.append('deliverymanId', selectedDmId);
    if (selectedDirection) params.append('direction', selectedDirection);
    return params.toString() ? `?${params.toString()}` : '';
  };

  const handleExportExcel = async () => {
    try {
      const res = await authFetch(`/api/manager/export${buildQueryString()}`);
      if (!res.ok) {
        let message = 'Failed to export Excel report.';
        try {
          const data = await res.json();
          message = data.error || message;
        } catch (_) {}
        throw new Error(message);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `delivery-report-${new Date().toISOString().substring(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      addToast('Excel report exported successfully.', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Filters Card */}
      <div className="card">
        <div className="flex-between" style={{ gap: '1rem', alignItems: 'center' }}>
          <h2 className="section-title" style={{ marginBottom: 0 }}>Manager Filters</h2>
          <button type="button" className="btn btn-success" onClick={handleExportExcel}>
            Export Excel
          </button>
        </div>
        <div className="form-row" style={{ alignItems: 'flex-end', marginTop: '1rem' }}>
          
          {/* Date Selector */}
          <div className="form-group" style={{ flex: '1.2' }}>
            <label htmlFor="date-mode-select">Date Filter</label>
            <select
              id="date-mode-select"
              value={dateMode}
              onChange={(e) => setDateMode(e.target.value)}
            >
              <option value="today">Today Only</option>
              <option value="custom">Custom Date Range</option>
            </select>
          </div>

          {dateMode === 'custom' && (
            <>
              <div className="form-group" style={{ flex: '1' }}>
                <label htmlFor="start-date-input">Start Date</label>
                <input
                  id="start-date-input"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="form-group" style={{ flex: '1' }}>
                <label htmlFor="end-date-input">End Date</label>
                <input
                  id="end-date-input"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            </>
          )}

          {/* Deliveryman Selector */}
          <div className="form-group" style={{ flex: '1.5' }}>
            <label htmlFor="dm-filter-select">Deliveryman</label>
            <select
              id="dm-filter-select"
              value={selectedDmId}
              onChange={(e) => setSelectedDmId(e.target.value)}
            >
              <option value="">All Deliverymen</option>
              {deliverymen.map(dm => (
                <option key={dm.id} value={dm.id}>
                  {dm.name}
                </option>
              ))}
            </select>
          </div>

          {/* Direction Selector */}
          <div className="form-group" style={{ flex: '1.2' }}>
            <label htmlFor="dir-filter-select">Direction</label>
            <select
              id="dir-filter-select"
              value={selectedDirection}
              onChange={(e) => setSelectedDirection(e.target.value)}
            >
              <option value="">All Directions</option>
              {directionsList.map(dir => (
                <option key={dir} value={dir}>
                  Direction {dir}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading && !summary ? (
        <div className="card text-center p-2">Loading Analytics Reports...</div>
      ) : (
        <>
          {/* KPI Dashboard Metrics Cards */}
          <div>
            <h3 className="section-title">Operational Summary</h3>
            <div className="kpi-grid">
              <div className="kpi-card">
                <span className="kpi-value">{summary?.total_orders_today || 0}</span>
                <span className="kpi-label">Total Orders</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-value" style={{ color: 'var(--color-muted)' }}>{summary?.waiting_orders_count || 0}</span>
                <span className="kpi-label">Waiting</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-value" style={{ color: 'var(--color-primary)' }}>{summary?.assigned_orders_count || 0}</span>
                <span className="kpi-label">Assigned</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-value" style={{ color: 'var(--color-warning)' }}>{summary?.out_orders_count || 0}</span>
                <span className="kpi-label">Out</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-value" style={{ color: 'var(--color-success)' }}>{summary?.completed_orders_count || 0}</span>
                <span className="kpi-label">Completed</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-value" style={{ color: summary?.orders_waited_more_than_10_minutes > 0 ? 'var(--color-danger)' : 'inherit' }}>
                  {summary?.orders_waited_more_than_10_minutes || 0}
                </span>
                <span className="kpi-label">Waited &gt; {settings?.max_waiting_minutes || 10}m</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-value">{summary?.average_delivery_duration_overall ? `${summary.average_delivery_duration_overall}m` : '0m'}</span>
                <span className="kpi-label">Avg. Trip Time</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-value">{summary?.total_trips_today || 0}</span>
                <span className="kpi-label">Total Trips</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-value" style={{ color: 'var(--color-accent)' }}>{summary?.stop_at_other_branch_orders_today || 0}</span>
                <span className="kpi-label">Branch Stops</span>
              </div>
              <div className="kpi-card" style={{ borderColor: summary?.total_complaints_today > 0 ? 'rgba(239, 68, 68, 0.3)' : 'var(--border-color)' }}>
                <span className="kpi-value" style={{ color: summary?.total_complaints_today > 0 ? 'var(--color-danger)' : 'inherit' }}>
                  {summary?.total_complaints_today || 0}
                </span>
                <span className="kpi-label">Complaints</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-value" style={{ fontSize: '1.25rem', padding: '0.2rem 0' }}>
                  ⏱ {summary?.time_complaints_count || 0} | 👤 {summary?.behavior_complaints_count || 0}
                </span>
                <span className="kpi-label">Late / Behavior</span>
              </div>
            </div>
          </div>

          {/* Deliverymen Performance Breakdown Table */}
          <div className="card">
            <h3 className="section-title">Delivery Team Performance</h3>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Deliveryman</th>
                    <th>Current Status</th>
                    <th>Total Trips</th>
                    <th>Delivered Orders</th>
                    <th>Avg. Trip Duration</th>
                    <th>Shortest Trip</th>
                    <th>Longest Trip</th>
                    <th>Last Out At</th>
                    <th>Last Back At</th>
                  </tr>
                </thead>
                <tbody>
                  {performance.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="text-center" style={{ color: 'var(--color-muted)', padding: '2rem' }}>
                        No delivery data matches these filters.
                      </td>
                    </tr>
                  ) : (
                    performance.map(dm => (
                      <tr key={dm.id}>
                        <td style={{ fontWeight: '600', color: 'var(--text-bright)' }}>{dm.name}</td>
                        <td>
                          <span className={`badge badge-${dm.status}`}>
                            {dm.status}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'monospace' }}>{dm.number_of_trips}</td>
                        <td style={{ fontFamily: 'monospace' }}>{dm.number_of_orders_delivered}</td>
                        <td style={{ fontWeight: '600' }}>
                          {dm.average_trip_duration ? `${dm.average_trip_duration} mins` : 'N/A'}
                        </td>
                        <td style={{ color: 'var(--color-success)' }}>
                          {dm.shortest_trip_duration ? `${dm.shortest_trip_duration} mins` : 'N/A'}
                        </td>
                        <td style={{ color: 'var(--color-danger)' }}>
                          {dm.longest_trip_duration ? `${dm.longest_trip_duration} mins` : 'N/A'}
                        </td>
                        <td style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>
                          {dm.last_out_time ? new Date(dm.last_out_time).toLocaleTimeString() : 'N/A'}
                        </td>
                        <td style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>
                          {dm.last_back_time ? new Date(dm.last_back_time).toLocaleTimeString() : 'N/A'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Trip Report Table */}
          <div className="card">
            <h3 className="section-title">Trip Report</h3>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Deliveryman</th>
                    <th>Dir</th>
                    <th>Orders</th>
                    <th>Status</th>
                    <th>Assignment Time</th>
                    <th>Pickup Time</th>
                    <th>Assignment-to-Pickup</th>
                    <th>Trip Start</th>
                    <th>Return Time</th>
                    <th>Trip Duration</th>
                    <th>Total Time</th>
                  </tr>
                </thead>
                <tbody>
                  {tripReports.length === 0 ? (
                    <tr>
                      <td colSpan="12" className="text-center" style={{ color: 'var(--color-muted)', padding: '2rem' }}>
                        No trips match these filters.
                      </td>
                    </tr>
                  ) : (
                    tripReports.map(trip => (
                      <tr key={trip.id}>
                        <td style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
                          {new Date(trip.date).toLocaleDateString()}
                        </td>
                        <td style={{ fontWeight: '600', color: 'var(--text-bright)' }}>{trip.deliveryman_name}</td>
                        <td>
                          <span className="badge badge-assigned" style={{ padding: '0.1rem 0.4rem' }}>
                            {trip.direction}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontWeight: '700' }}>{trip.orders_count}</td>
                        <td>
                          <span className={`badge badge-${trip.status}`}>{trip.status}</span>
                        </td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
                          {trip.assigned_at ? new Date(trip.assigned_at).toLocaleTimeString() : 'N/A'}
                        </td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
                          {trip.pickup_at ? new Date(trip.pickup_at).toLocaleTimeString() : (
                            <span style={{ color: 'var(--color-warning)', fontWeight: 700 }}>Pending</span>
                          )}
                        </td>
                        <td style={{ fontWeight: '700' }}>{trip.assignment_to_pickup_minutes} mins</td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
                          {trip.trip_start_at ? new Date(trip.trip_start_at).toLocaleTimeString() : (
                            <span style={{ color: 'var(--color-warning)', fontWeight: 700 }}>Pending</span>
                          )}
                        </td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
                          {trip.return_at ? new Date(trip.return_at).toLocaleTimeString() : (
                            <span style={{ color: 'var(--color-muted)', fontStyle: 'italic' }}>Pending</span>
                          )}
                        </td>
                        <td>
                          {trip.duration_minutes ? `${trip.duration_minutes} mins` : <span style={{ color: 'var(--color-muted)', fontStyle: 'italic' }}>Pending</span>}
                        </td>
                        <td style={{ fontWeight: '800', color: 'var(--text-bright)' }}>
                          {trip.total_time_minutes} mins
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom Grid: Stops & Complaints Tables */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '1.5rem', flexWrap: 'wrap' }}>
            
            {/* Stop Orders Table */}
            <div className="card">
              <h3 className="section-title" style={{ color: 'var(--color-accent)' }}>Branch Stop Orders</h3>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Serial</th>
                      <th>Dir</th>
                      <th>Deliveryman</th>
                      <th>Date / Time</th>
                      <th>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stops.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="text-center" style={{ color: 'var(--color-muted)', padding: '2rem' }}>
                          No branch stop orders recorded.
                        </td>
                      </tr>
                    ) : (
                      stops.map((o, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: '600', color: 'var(--text-bright)' }}>{o.serial_number}</td>
                          <td>
                            <span className="badge badge-assigned" style={{ padding: '0.1rem 0.4rem' }}>
                              {o.direction}
                            </span>
                          </td>
                          <td>{o.assigned_deliveryman}</td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
                            {new Date(o.date).toLocaleDateString()} {new Date(o.date).toLocaleTimeString()}
                          </td>
                          <td>
                            {o.duration ? `${o.duration} mins` : <span style={{ fontStyle: 'italic', color: 'var(--color-muted)' }}>Pending</span>}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Complaints Table */}
            <div className="card">
              <h3 className="section-title" style={{ color: 'var(--color-danger)' }}>Customer Complaints</h3>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Serial</th>
                      <th>Type</th>
                      <th>Deliveryman</th>
                      <th>Dir</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {complaints.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="text-center" style={{ color: 'var(--color-muted)', padding: '2rem' }}>
                          No customer complaints registered.
                        </td>
                      </tr>
                    ) : (
                      complaints.map(c => (
                        <tr key={c.id}>
                          <td style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
                            {new Date(c.complaint_time).toLocaleTimeString()}
                          </td>
                          <td style={{ fontWeight: '700', color: 'var(--text-bright)' }}>{c.order_serial_number}</td>
                          <td>
                            <span
                              className="badge"
                              style={{
                                background: 'rgba(239, 68, 68, 0.1)',
                                color: 'var(--color-danger)',
                                border: '1px solid rgba(239, 68, 68, 0.2)'
                              }}
                            >
                              {c.complaint_type}
                            </span>
                          </td>
                          <td>{c.deliveryman_assigned}</td>
                          <td>
                            <span className="badge badge-assigned" style={{ padding: '0.1rem 0.4rem' }}>
                              {c.order_direction}
                            </span>
                          </td>
                          <td>
                            <span className={`badge badge-${c.order_status}`}>
                              {c.order_status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>

          {/* Assignment Delays Table */}
          <div className="card">
            <h3 className="section-title" style={{ color: 'var(--color-warning)' }}>No Available Deliveryman Delays</h3>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Dir</th>
                    <th>Delay Start</th>
                    <th>Delay End</th>
                    <th>Duration</th>
                    <th>Delayed Orders</th>
                    <th>Assigned Deliveryman</th>
                  </tr>
                </thead>
                <tbody>
                  {assignmentDelays.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="text-center" style={{ color: 'var(--color-muted)', padding: '2rem' }}>
                        No deliveryman availability delays recorded.
                      </td>
                    </tr>
                  ) : (
                    assignmentDelays.map(delay => (
                      <tr key={delay.id}>
                        <td style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
                          {new Date(delay.date).toLocaleDateString()}
                        </td>
                        <td>
                          <span className="badge badge-assigned" style={{ padding: '0.1rem 0.4rem' }}>
                            {delay.direction}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
                          {new Date(delay.delay_start).toLocaleTimeString()}
                        </td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
                          {delay.delay_end ? new Date(delay.delay_end).toLocaleTimeString() : (
                            <span style={{ color: 'var(--color-warning)', fontWeight: 700 }}>Ongoing</span>
                          )}
                        </td>
                        <td style={{ fontWeight: '700', color: delay.status === 'open' ? 'var(--color-warning)' : 'var(--text-main)' }}>
                          {delay.delay_duration_minutes} mins
                        </td>
                        <td style={{ fontFamily: 'monospace', fontWeight: '700' }}>
                          {delay.delayed_orders_count}
                        </td>
                        <td>{delay.assigned_deliveryman}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

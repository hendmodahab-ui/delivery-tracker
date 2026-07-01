import authFetch from '../utils/authFetch.js';
import React, { useState } from 'react';

export default function DeliverymenManagement({ deliverymen, addToast, refreshData }) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;

    try {
      const res = await authFetch('/api/deliverymen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add deliveryman.');
      }

      const data = await res.json();
      addToast(`Deliveryman ${newName.trim()} added successfully!`, 'success');
      
      // If assignment was run, show logs
      if (data.logs && data.logs.length > 0) {
        data.logs.forEach(log => {
          if (log.includes('Successfully assigned')) {
            addToast(log, 'success');
          }
        });
      }

      setNewName('');
      refreshData();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const handleToggleActive = async (id, currentActive) => {
    try {
      const res = await authFetch(`/api/deliverymen/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !currentActive })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to toggle status.');
      }

      addToast(`Deliveryman status updated.`, 'success');
      refreshData();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const handleStatusChange = async (id, status) => {
    try {
      const res = await authFetch(`/api/deliverymen/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update status.');
      }

      addToast(`Deliveryman set to '${status}'.`, 'success');
      refreshData();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const startEditing = (id, name) => {
    setEditingId(id);
    setEditingName(name);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingName('');
  };

  const saveNameEdit = async (id) => {
    if (!editingName.trim()) return;
    try {
      const res = await authFetch(`/api/deliverymen/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingName })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update name.');
      }

      addToast(`Name updated to ${editingName.trim()}.`, 'success');
      setEditingId(null);
      setEditingName('');
      refreshData();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Add Deliveryman Card */}
      <div className="card" style={{ maxWidth: '500px' }}>
        <h2 className="section-title">Add Deliveryman</h2>
        <form onSubmit={handleAdd} className="form-row" style={{ alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: '3' }}>
            <label htmlFor="new-dm-name">Name</label>
            <input
              id="new-dm-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. John Doe"
              required
            />
          </div>
          <div className="form-group" style={{ flex: '1.2' }}>
            <button type="submit" className="btn" style={{ width: '100%' }}>
              Add Team Member
            </button>
          </div>
        </form>
      </div>

      {/* Team Roster List Card */}
      <div className="card">
        <h2 className="section-title">Delivery Team Roster</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', marginTop: '-1rem', marginBottom: '1.5rem' }}>
          Default login password for all drivers: <code style={{ background: 'rgba(255, 255, 255, 0.08)', padding: '0.1rem 0.3rem', borderRadius: '4px', color: 'var(--text-bright)' }}>driver123</code>
        </p>
        
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Status Badge</th>
                <th>Activation</th>
                <th>Manual Status</th>
                <th>Ready Since / Last Back</th>
                <th>Last Out</th>
                <th>Avg. Duration</th>
                <th>Current Trip Details</th>
              </tr>
            </thead>
            <tbody>
              {deliverymen.length === 0 ? (
                <tr>
                  <td colSpan="9" className="text-center" style={{ color: 'var(--color-muted)', padding: '3rem' }}>
                    No deliverymen registered yet.
                  </td>
                </tr>
              ) : (
                deliverymen.map(dm => {
                  const isEditing = editingId === dm.id;
                  return (
                    <tr key={dm.id}>
                      {/* Name column */}
                      <td style={{ minWidth: '180px' }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <input
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                            />
                            <button onClick={() => saveNameEdit(dm.id)} className="btn btn-success" style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem' }}>
                              Save
                            </button>
                            <button onClick={cancelEditing} className="btn btn-secondary" style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem' }}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontWeight: '600', color: dm.is_active ? 'var(--text-bright)' : 'var(--color-muted)' }}>
                              {dm.name}
                            </span>
                            <button
                              onClick={() => startEditing(dm.id, dm.name)}
                              className="btn btn-secondary"
                              style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem', opacity: 0.6 }}
                              title="Edit Name"
                            >
                              ✏️
                            </button>
                          </div>
                        )}
                      </td>

                      {/* Username column */}
                      <td>
                        <code style={{ background: 'rgba(255, 255, 255, 0.08)', padding: '0.2rem 0.5rem', borderRadius: '4px', color: 'var(--color-primary)' }}>
                          {dm.username || 'N/A'}
                        </code>
                      </td>

                      {/* Status badge */}
                      <td>
                        <span className={`badge badge-${dm.status}`}>
                          {dm.status}
                        </span>
                      </td>

                      {/* Active Toggle */}
                      <td>
                        <button
                          onClick={() => handleToggleActive(dm.id, dm.is_active === 1)}
                          className={`btn ${dm.is_active === 1 ? 'btn-danger' : 'btn-success'}`}
                          style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', width: '90px' }}
                        >
                          {dm.is_active === 1 ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>

                      {/* Manual Status selector */}
                      <td>
                        <select
                          value={dm.status}
                          disabled={dm.is_active === 0}
                          onChange={(e) => handleStatusChange(dm.id, e.target.value)}
                          style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem' }}
                        >
                          <option value="available">Set Available</option>
                          <option value="assigned" disabled={dm.status !== 'assigned'}>Assigned (Auto)</option>
                          <option value="out" disabled={dm.status !== 'out' && dm.status !== 'assigned'}>Set Out</option>
                          <option value="inactive" disabled>Inactive</option>
                        </select>
                      </td>

                      {/* Ready Since / Last Back */}
                      <td style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>
                        {dm.ready_since ? new Date(dm.ready_since).toLocaleTimeString() : 'N/A'}
                      </td>

                      {/* Last Out */}
                      <td style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>
                        {dm.last_out_at ? new Date(dm.last_out_at).toLocaleTimeString() : 'N/A'}
                      </td>

                      {/* Average trip duration */}
                      <td style={{ fontWeight: '600' }}>
                        {dm.average_trip_duration ? `${dm.average_trip_duration} mins` : '0 mins'}
                      </td>

                      {/* Current trip details */}
                      <td style={{ fontSize: '0.85rem' }}>
                        {dm.current_orders && dm.current_orders.length > 0 ? (
                          <div>
                            <div>
                              <strong style={{ color: 'var(--color-primary)' }}>Dir {dm.current_direction}</strong>
                            </div>
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                              {dm.current_orders.map(o => o.serial_number).join(', ')}
                            </span>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--color-muted)', fontStyle: 'italic' }}>None</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

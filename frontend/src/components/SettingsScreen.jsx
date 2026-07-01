import authFetch from '../utils/authFetch.js';
import React, { useState, useEffect } from 'react';

export default function SettingsScreen({ addToast, refreshData }) {
  const [directions, setDirections] = useState(['1', '3', '6', '10']);
  const [maxOrders, setMaxOrders] = useState(3);
  const [maxWait, setMaxWait] = useState(10);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await authFetch('/api/settings');
      if (!res.ok) throw new Error('Failed to fetch settings');
      const data = await res.json();
      if (data.directions) setDirections(data.directions);
      if (data.max_orders_per_trip) setMaxOrders(data.max_orders_per_trip);
      if (data.max_waiting_minutes) setMaxWait(data.max_waiting_minutes);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDirectionChange = (index, value) => {
    const next = [...directions];
    next[index] = value;
    setDirections(next);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      // Validate direction inputs are not blank and are unique
      const cleanedDirs = directions.map(d => d.trim());
      if (cleanedDirs.some(d => d === '')) {
        throw new Error('All 4 direction names must be filled out.');
      }
      if (new Set(cleanedDirs).size !== 4) {
        throw new Error('Direction names must be unique.');
      }

      const res = await authFetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          directions: cleanedDirs,
          max_orders_per_trip: maxOrders,
          max_waiting_minutes: maxWait
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to update settings');
      }

      const data = await res.json();
      addToast('Settings updated successfully!', 'success');
      
      // If assignment was run, show logs
      if (data.logs && data.logs.length > 0) {
        data.logs.forEach(log => {
          if (log.includes('Successfully assigned')) {
            addToast(log, 'success');
          }
        });
      }

      refreshData();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const handleResetDatabase = async () => {
    if (!window.confirm('WARNING: This will delete ALL orders, trips, complaints, and reset settings to defaults. Are you sure?')) {
      return;
    }
    try {
      const res = await authFetch('/api/reset-database', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to reset database');
      addToast('Database reset successfully!', 'success');
      fetchSettings();
      refreshData();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  if (loading) {
    return <div className="card text-center p-2">Loading Settings...</div>;
  }

  return (
    <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
      <h2 className="section-title">Configure Branch Settings</h2>
      
      <form onSubmit={handleSave}>
        <div className="form-group">
          <label>Delivery Directions (Exactly 4)</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.25rem' }}>
            {directions.map((dir, idx) => (
              <input
                key={idx}
                type="text"
                value={dir}
                onChange={(e) => handleDirectionChange(idx, e.target.value)}
                placeholder={`Direction ${idx + 1}`}
                required
              />
            ))}
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="max-orders">Max Orders Per Trip</label>
            <input
              id="max-orders"
              type="number"
              min="1"
              max="10"
              value={maxOrders}
              onChange={(e) => setMaxOrders(parseInt(e.target.value, 10))}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="max-wait">Max Waiting Minutes</label>
            <input
              id="max-wait"
              type="number"
              min="1"
              max="60"
              value={maxWait}
              onChange={(e) => setMaxWait(parseInt(e.target.value, 10))}
              required
            />
          </div>
        </div>

        <button type="submit" className="btn" style={{ width: '100%', marginTop: '1rem' }}>
          Save Configuration
        </button>
      </form>

      <hr style={{ margin: '2rem 0', borderColor: 'var(--border-color)' }} />

      <h3 className="section-title" style={{ color: 'var(--color-danger)' }}>Danger Zone</h3>
      <p style={{ color: 'var(--color-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
        Reset the system back to empty/default settings and clean all transaction logs.
      </p>
      <button onClick={handleResetDatabase} className="btn btn-danger" style={{ width: '100%' }}>
        Reset System Database
      </button>
    </div>
  );
}

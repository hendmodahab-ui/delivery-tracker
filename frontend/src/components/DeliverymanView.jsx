import authFetch from '../utils/authFetch.js';
import React, { useState } from 'react';

export default function DeliverymanView({ deliverymen, addToast, refreshData, loggedInDriverId }) {
  const [manualSelectedId, setManualSelectedId] = useState('');

  // Lock selected ID to loggedInDriverId if provided, otherwise fallback to manual dropdown selection
  const selectedId = loggedInDriverId || manualSelectedId;
  const currentDm = deliverymen.find(d => d.id === parseInt(selectedId, 10));
  const statusLabels = {
    available: 'متاح',
    assigned: 'تم التعيين',
    out: 'خارج الفرع',
    inactive: 'غير نشط',
    completed: 'مكتمل',
    waiting: 'قيد الانتظار'
  };

  const formatMinutes = (value) => `${value ?? 0} دقيقة`;

  const handleOut = async (tripId) => {
    if (!tripId) return;
    try {
      const res = await authFetch(`/api/trips/${tripId}/out`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'تعذر بدء الرحلة. برجاء المحاولة مرة أخرى.');
      }
      addToast('تم تسجيل خروجك للتوصيل. برجاء توصيل الطلبات بأمان.', 'success');
      refreshData();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const handleBack = async (tripId) => {
    if (!tripId) return;
    try {
      const res = await authFetch(`/api/trips/${tripId}/back`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'تعذر إنهاء الرحلة. برجاء المحاولة مرة أخرى.');
      }
      const data = await res.json();
      addToast(`تم تسجيل رجوعك للفرع. مدة الرحلة ${data.duration_minutes} دقيقة.`, 'success');
      
      // If assignment was run, show logs
      if (data.logs && data.logs.length > 0) {
        data.logs.forEach(log => {
          if (log.includes('Successfully assigned')) {
            addToast('تم تعيين الطلبات لك، برجاء استلامها من الفرع.', 'success');
          }
        });
      }
      refreshData();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  // Only active deliverymen
  const activeDeliverymen = deliverymen.filter(d => d.is_active === 1);

  return (
    <div className="deliveryman-view-grid" dir="rtl">
      {!loggedInDriverId && (
        <div className="card deliveryman-selector-card">
          <div className="form-group">
            <label htmlFor="dm-view-select">اختر حساب المندوب</label>
            <select
              id="dm-view-select"
              value={manualSelectedId}
              onChange={(e) => setManualSelectedId(e.target.value)}
            >
              <option value="">-- اختر المندوب --</option>
              {activeDeliverymen.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name} ({statusLabels[d.status] || d.status})
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {currentDm ? (
        <div className="card big-dm-card">
          <div className="big-dm-title">{currentDm.name}</div>
          <div className="big-dm-status">
            <span className={`badge badge-${currentDm.status}`}>
              الحالة: {statusLabels[currentDm.status] || currentDm.status}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', margin: '1rem 0' }}>
            <div className="card" style={{ padding: '0.75rem', background: 'rgba(0, 0, 0, 0.15)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>آخر خروج</div>
              <div style={{ fontSize: '0.95rem', fontWeight: '600' }}>
                {currentDm.last_out_at ? new Date(currentDm.last_out_at).toLocaleTimeString() : 'غير متاح'}
              </div>
            </div>
            <div className="card" style={{ padding: '0.75rem', background: 'rgba(0, 0, 0, 0.15)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>آخر رجوع</div>
              <div style={{ fontSize: '0.95rem', fontWeight: '600' }}>
                {currentDm.last_back_at ? new Date(currentDm.last_back_at).toLocaleTimeString() : 'غير متاح'}
              </div>
            </div>
          </div>

          {currentDm.is_next_in_line && currentDm.pending_direction && currentDm.pending_direction_order_count > 0 && (
            <div className="driver-turn-alert" dir="rtl">
              <strong>دورك الآن</strong>
              <span>
                توجد {currentDm.pending_direction_order_count} طلبات قيد الانتظار في اتجاه {currentDm.pending_direction}.
              </span>
            </div>
          )}

          <div className="queue-visibility-panel">
            <div className="queue-panel-header">
              <span>ترتيب الدور</span>
              {currentDm.queue_position ? (
                <strong>رقم {currentDm.queue_position} من {currentDm.queue_total}</strong>
              ) : (
                <strong>غير موجود في الدور</strong>
              )}
            </div>

            {currentDm.queue_position ? (
              <div className="queue-neighbors-grid">
                <div>
                  <div className="queue-neighbor-title">قبلك في الدور</div>
                  {currentDm.queue_before?.length ? (
                    <div className="queue-chip-list">
                      {currentDm.queue_before.map((dm, index) => (
                        <span key={dm.id} className="queue-chip">{index + 1}. {dm.name}</span>
                      ))}
                    </div>
                  ) : (
                    <div className="queue-empty">أنت أول مندوب في الدور.</div>
                  )}
                </div>
                <div>
                  <div className="queue-neighbor-title">بعدك في الدور</div>
                  {currentDm.queue_after?.length ? (
                    <div className="queue-chip-list">
                      {currentDm.queue_after.map((dm, index) => (
                        <span key={dm.id} className="queue-chip">
                          {currentDm.queue_position + index + 1}. {dm.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="queue-empty">لا يوجد مندوب بعدك.</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="queue-empty">
                ستظهر هنا عندما تكون حالتك متاح.
              </div>
            )}
          </div>

          {currentDm.current_orders && currentDm.current_orders.length > 0 ? (
            <div className="active-orders-box">
              <h4>الطلبات الحالية المعينة لك (اتجاه {currentDm.current_direction})</h4>
              <div className="pickup-timing-box">
                <div>
                  <span>وقت التعيين</span>
                  <strong>{currentDm.current_trip_assigned_at ? new Date(currentDm.current_trip_assigned_at).toLocaleTimeString() : 'غير متاح'}</strong>
                </div>
                <div>
                  <span>{currentDm.current_trip_out_at ? 'مدة الانتظار قبل الاستلام' : 'الوقت منذ التعيين'}</span>
                  <strong>{formatMinutes(currentDm.current_assignment_to_pickup_minutes)}</strong>
                </div>
              </div>
              <ul>
                {currentDm.current_orders.map((o, index) => (
                  <li key={index}>
                    <span className="serial-text">رقم الطلب: {o.serial_number}</span>
                    {o.has_branch_stop === 1 && (
                      <span className="branch-stop-badge">توقف في فرع آخر</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div style={{ padding: '2rem 0', color: 'var(--color-muted)', fontStyle: 'italic' }}>
              لا توجد طلبات معينة لك حالياً.
            </div>
          )}

          <div className="big-dm-actions">
            <button
              onClick={() => handleOut(currentDm.current_trip_id)}
              disabled={currentDm.status !== 'assigned'}
              className="btn btn-success"
            >
              خرجت للتوصيل
            </button>
            <button
              onClick={() => handleBack(currentDm.current_trip_id)}
              disabled={currentDm.status !== 'out'}
              className="btn btn-primary"
            >
              رجعت للفرع
            </button>
          </div>
        </div>
      ) : (
        <div className="card text-center p-2" style={{ color: 'var(--color-muted)' }}>
          برجاء اختيار مندوب لعرض بطاقة المتابعة الخاصة به.
        </div>
      )}
    </div>
  );
}

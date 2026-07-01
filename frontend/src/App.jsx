import React, { useState, useEffect, useRef } from 'react';
import StaffDashboard from './components/StaffDashboard.jsx';
import DeliverymenManagement from './components/DeliverymenManagement.jsx';
import DeliverymanView from './components/DeliverymanView.jsx';
import ManagerDashboard from './components/ManagerDashboard.jsx';
import SettingsScreen from './components/SettingsScreen.jsx';
import Login from './components/Login.jsx';
import authFetch from './utils/authFetch.js';

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('auth_token') || null);
  const [role, setRole] = useState(() => localStorage.getItem('user_role') || null);
  const [username, setUsername] = useState(() => localStorage.getItem('user_username') || '');
  const [deliverymanId, setDeliverymanId] = useState(() => localStorage.getItem('deliveryman_id') || null);
  const [activeTab, setActiveTab] = useState(() => {
    const savedRole = localStorage.getItem('user_role');
    if (savedRole === 'staff') return 'staff';
    if (savedRole === 'manager') return 'manager';
    if (savedRole === 'deliveryman') return 'deliveryman-view';
    return 'staff';
  });

  const [orders, setOrders] = useState([]);
  const [deliverymen, setDeliverymen] = useState([]);
  const [settings, setSettings] = useState(null);
  const [toasts, setToasts] = useState([]);

  const prevDeliverymenRef = useRef([]);
  const lastDriverPendingTurnRef = useRef('');
  const lastDriverAssignedTripRef = useRef('');

  const isArabicText = (message) => /[\u0600-\u06FF]/.test(message || '');

  const getDeliverymanToastMessage = (message, type = 'info') => {
    if (isArabicText(message)) return message;
    if (message.includes('Session expired')) return 'انتهت الجلسة. برجاء تسجيل الدخول مرة أخرى.';
    if (message.includes('Welcome')) {
      const matchedName = message.match(/Welcome,\s*(.*?)!/);
      return `مرحباً ${matchedName?.[1] || username || ''}، تم تسجيل الدخول بنجاح.`;
    }
    if (message.includes('Password changed')) return 'تم تغيير كلمة المرور بنجاح.';
    if (message.includes('Failed to change password')) return 'تعذر تغيير كلمة المرور. برجاء المحاولة مرة أخرى.';
    if (message.includes('Failed to fetch data')) return 'تعذر تحديث البيانات. برجاء التأكد من تشغيل الخادم.';
    if (message.includes('Trip completed')) return 'تم إنهاء الرحلة بنجاح.';
    if (message.includes('Successfully assigned')) return 'تم تعيين الطلبات لك، برجاء استلامها من الفرع.';
    if (type === 'error') return 'حدث خطأ. برجاء المحاولة مرة أخرى.';
    return 'تم تحديث حالة الطلبات الخاصة بك.';
  };

  // Toast notifier helper
  const addToast = (message, type = 'info') => {
    const toastMessage = localStorage.getItem('user_role') === 'deliveryman'
      ? getDeliverymanToastMessage(message, type)
      : message;
    const id = Date.now() + Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message: toastMessage, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const fetchGlobalData = async (isFirstLoad = false) => {
    if (!localStorage.getItem('auth_token')) return; // Don't fetch if not logged in
    try {
      const [ordersRes, dmRes, settingsRes] = await Promise.all([
        authFetch('/api/orders'),
        authFetch('/api/deliverymen'),
        authFetch('/api/settings')
      ]);

      // If any response is 401/403, token expired — force logout
      if (ordersRes.status === 401 || ordersRes.status === 403 ||
          dmRes.status === 401 || dmRes.status === 403 ||
          settingsRes.status === 401 || settingsRes.status === 403) {
        handleLogout();
        addToast('Session expired. Please log in again.', 'error');
        return;
      }

      if (!ordersRes.ok || !dmRes.ok || !settingsRes.ok) {
        throw new Error('Failed to fetch data from the server.');
      }

      const ordersData = await ordersRes.json();
      const dmData = await dmRes.json();
      const settingsData = await settingsRes.json();

      setOrders(ordersData);
      setSettings(settingsData);

      const currentRole = localStorage.getItem('user_role');
      const currentDeliverymanId = parseInt(localStorage.getItem('deliveryman_id') || '', 10);
      if (currentRole === 'deliveryman' && currentDeliverymanId) {
        const driver = dmData.find((dm) => dm.id === currentDeliverymanId);

        const pendingTurnKey = driver?.is_next_in_line && driver.pending_direction && driver.pending_direction_order_count > 0
          ? `${driver.id}:${driver.pending_direction}:${driver.pending_direction_order_count}:${driver.pending_direction_earliest || ''}`
          : '';

        if (pendingTurnKey && pendingTurnKey !== lastDriverPendingTurnRef.current) {
          addToast(
            `حان دورك، لديك ${driver.pending_direction_order_count} طلبات معلقة في اتجاه ${driver.pending_direction}.`,
            'info'
          );
        }
        lastDriverPendingTurnRef.current = pendingTurnKey;

        const assignedTripKey = driver?.status === 'assigned' && driver.current_trip_id
          ? `${driver.id}:${driver.current_trip_id}`
          : '';

        if (assignedTripKey && assignedTripKey !== lastDriverAssignedTripRef.current) {
          const orderSerials = driver.current_orders ? driver.current_orders.map(o => o.serial_number).join(', ') : '';
          addToast(
            `تم تعيين الطلبات لك، برجاء استلامها من الفرع. الطلبات: ${orderSerials} - اتجاه ${driver.current_direction}.`,
            'success'
          );
        }
        lastDriverAssignedTripRef.current = assignedTripKey;
      }

      // Assignment Notification Engine:
      if (currentRole !== 'deliveryman' && !isFirstLoad && prevDeliverymenRef.current.length > 0) {
        dmData.forEach((dm) => {
          const prevDm = prevDeliverymenRef.current.find((p) => p.id === dm.id);
          if (prevDm) {
            const gotAssigned = (prevDm.status !== 'assigned' && dm.status === 'assigned');
            const newTripAssigned = (dm.status === 'assigned' && dm.current_trip_id && prevDm.current_trip_id !== dm.current_trip_id);
            if (gotAssigned || newTripAssigned) {
              const orderSerials = dm.current_orders ? dm.current_orders.map(o => o.serial_number).join(', ') : '';
              addToast(
                `🔔 Trip Assigned! '${dm.name}' has been auto-assigned orders [${orderSerials}] in Direction ${dm.current_direction}.`,
                'success'
              );
            }
          }
        });
      }

      setDeliverymen(dmData);
      prevDeliverymenRef.current = dmData;
    } catch (err) {
      if (isFirstLoad) {
        addToast(err.message, 'error');
      }
    }
  };

  // Poll for updates every 3 seconds (only when logged in)
  useEffect(() => {
    if (!token) return;

    fetchGlobalData(true);
    const interval = setInterval(() => {
      fetchGlobalData(false);
    }, 3000);
    return () => clearInterval(interval);
  }, [token]);

  const handleLogin = (newToken, newRole, newUsername, newDeliverymanId) => {
    setToken(newToken);
    setRole(newRole);
    setUsername(newUsername || '');
    setDeliverymanId(newDeliverymanId || null);
    // Set initial tab based on role
    if (newRole === 'staff') setActiveTab('staff');
    else if (newRole === 'manager') setActiveTab('manager');
    else if (newRole === 'deliveryman') setActiveTab('deliveryman-view');
    addToast(`Welcome, ${newUsername}! Logged in as ${newRole}.`, 'success');
  };

  const handleLogout = () => {
    setToken(null);
    setRole(null);
    setUsername('');
    setDeliverymanId(null);
    setOrders([]);
    setDeliverymen([]);
    setSettings(null);
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_role');
    localStorage.removeItem('user_username');
    localStorage.removeItem('deliveryman_id');
    prevDeliverymenRef.current = [];
    lastDriverPendingTurnRef.current = '';
    lastDriverAssignedTripRef.current = '';
  };

  // Password Change handler (used by settings or inline)
  const handleChangePassword = async (oldPassword, newPassword) => {
    try {
      const res = await authFetch('/api/change-password', {
        method: 'POST',
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        addToast(data.error || 'Failed to change password.', 'error');
        return false;
      }
      addToast('Password changed successfully!', 'success');
      return true;
    } catch (err) {
      addToast('Failed to change password.', 'error');
      return false;
    }
  };

  const renderView = () => {
    switch (activeTab) {
      case 'staff':
        return (
          <StaffDashboard
            orders={orders}
            deliverymen={deliverymen}
            settings={settings}
            addToast={addToast}
            refreshData={fetchGlobalData}
          />
        );
      case 'deliverymen':
        return (
          <DeliverymenManagement
            deliverymen={deliverymen}
            addToast={addToast}
            refreshData={fetchGlobalData}
          />
        );
      case 'deliveryman-view':
        return (
          <DeliverymanView
            deliverymen={deliverymen}
            addToast={addToast}
            refreshData={fetchGlobalData}
            loggedInDriverId={role === 'deliveryman' ? deliverymanId : null}
          />
        );
      case 'manager':
        return (
          <ManagerDashboard
            deliverymen={deliverymen}
            settings={settings}
            addToast={addToast}
          />
        );
      case 'settings':
        return (
          <SettingsScreen
            addToast={addToast}
            refreshData={fetchGlobalData}
          />
        );
      case 'change-password':
        return <ChangePasswordView onChangePassword={handleChangePassword} isDeliveryman={role === 'deliveryman'} />;
      default:
        return <div>Tab not found.</div>;
    }
  };

  // ==================== LOGIN SCREEN ====================
  if (!token) {
    return (
      <>
        <Login onLogin={handleLogin} addToast={addToast} />
        {/* Toast container for login errors */}
        <div className="toasts-container">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.type}`} onClick={() => removeToast(t.id)}>
              <div style={{ marginRight: '0.25rem' }}>
                {t.type === 'success' ? '✔' : t.type === 'error' ? '❌' : 'ℹ'}
              </div>
              <div style={{ flex: 1 }}>{t.message}</div>
            </div>
          ))}
        </div>
      </>
    );
  }

  // ==================== AUTHENTICATED DASHBOARD ====================
  return (
    <div className="app-container">
      {/* Navigation Header */}
      <header className="nav-header">
        <div className="brand-section">
          <span className="brand-logo">🚚</span>
          <div>
            <h1 className="brand-name">Mohamed Galal</h1>
            <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>
              {role === 'deliveryman' ? 'متابعة الطلبات والتعيين التلقائي' : 'Order Tracking &amp; Auto-Assignment Engine'}
            </span>
          </div>
        </div>

        {/* Navigation Tabs - Role Restricted */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          
          {role === 'staff' && (
            <>
              <span className="badge badge-available" style={{ padding: '0.5rem 1rem', borderRadius: '8px' }}>
                📦 Staff: {username}
              </span>
              <nav className="nav-tabs">
                <button
                  onClick={() => setActiveTab('staff')}
                  className={`nav-tab ${activeTab === 'staff' ? 'active' : ''}`}
                >
                  Staff Dashboard
                </button>
                <button
                  onClick={() => setActiveTab('deliveryman-view')}
                  className={`nav-tab ${activeTab === 'deliveryman-view' ? 'active' : ''}`}
                >
                  Deliveryman Cards
                </button>
                <button
                  onClick={() => setActiveTab('deliverymen')}
                  className={`nav-tab ${activeTab === 'deliverymen' ? 'active' : ''}`}
                >
                  Team Roster
                </button>
              </nav>
            </>
          )}

          {role === 'deliveryman' && (
            <span className="badge badge-assigned" style={{ padding: '0.5rem 1rem', borderRadius: '8px' }}>
              مندوب: {username}
            </span>
          )}

          {role === 'manager' && (
            <nav className="nav-tabs">
              <button
                onClick={() => setActiveTab('manager')}
                className={`nav-tab ${activeTab === 'manager' ? 'active' : ''}`}
              >
                Manager Center
              </button>
              <button
                onClick={() => setActiveTab('deliverymen')}
                className={`nav-tab ${activeTab === 'deliverymen' ? 'active' : ''}`}
              >
                Team Roster
              </button>
              <button
                onClick={() => setActiveTab('deliveryman-view')}
                className={`nav-tab ${activeTab === 'deliveryman-view' ? 'active' : ''}`}
              >
                Deliveryman Cards
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`nav-tab ${activeTab === 'settings' ? 'active' : ''}`}
              >
                Settings
              </button>
            </nav>
          )}

          <button
            onClick={() => setActiveTab('change-password')}
            className="btn btn-secondary"
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
            title={role === 'deliveryman' ? 'تغيير كلمة المرور' : 'Change your password'}
          >
            🔑
          </button>

          <button onClick={handleLogout} className="btn btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
            {role === 'deliveryman' ? 'تسجيل الخروج' : '🚪 Logout'}
          </button>
        </div>
      </header>

      {/* Main View Container */}
      <main style={{ minHeight: '60vh' }}>
        {renderView()}
      </main>

      {/* Toast Notification Container */}
      <div className="toasts-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`} onClick={() => removeToast(t.id)}>
            <div style={{ marginRight: '0.25rem' }}>
              {t.type === 'success' ? '✔' : t.type === 'error' ? '❌' : 'ℹ'}
            </div>
            <div style={{ flex: 1 }}>{t.message}</div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeToast(t.id);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255, 255, 255, 0.4)',
                cursor: 'pointer',
                fontSize: '1rem',
                paddingLeft: '0.5rem'
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ==================== INLINE PASSWORD CHANGE VIEW ====================
function ChangePasswordView({ onChangePassword, isDeliveryman = false }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const copy = isDeliveryman ? {
    required: 'برجاء إدخال كل الحقول.',
    mismatch: 'كلمة المرور الجديدة غير متطابقة.',
    minLength: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل.',
    success: 'تم تغيير كلمة المرور بنجاح!',
    title: 'تغيير كلمة المرور',
    current: 'كلمة المرور الحالية',
    currentPlaceholder: 'اكتب كلمة المرور الحالية',
    next: 'كلمة المرور الجديدة',
    nextPlaceholder: 'اكتب كلمة المرور الجديدة',
    confirm: 'تأكيد كلمة المرور الجديدة',
    confirmPlaceholder: 'أعد كتابة كلمة المرور الجديدة',
    updating: 'جاري التحديث...',
    submit: 'تحديث كلمة المرور'
  } : {
    required: 'All fields are required.',
    mismatch: 'New passwords do not match.',
    minLength: 'New password must be at least 6 characters.',
    success: 'Password changed successfully!',
    title: 'Change Password',
    current: 'Current Password',
    currentPlaceholder: 'Enter current password',
    next: 'New Password',
    nextPlaceholder: 'Enter new password (min 6 chars)',
    confirm: 'Confirm New Password',
    confirmPlaceholder: 'Confirm new password',
    updating: 'Updating...',
    submit: 'Update Password'
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    if (!oldPassword || !newPassword || !confirmPassword) {
      setMessage(copy.required);
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage(copy.mismatch);
      return;
    }
    if (newPassword.length < 6) {
      setMessage(copy.minLength);
      return;
    }
    setLoading(true);
    const success = await onChangePassword(oldPassword, newPassword);
    setLoading(false);
    if (success) {
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage(`✓ ${copy.success}`);
    }
  };

  return (
    <div style={{ maxWidth: '450px', margin: '3rem auto' }} dir={isDeliveryman ? 'rtl' : 'ltr'}>
      <div className="card" style={{ padding: '2rem' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '1.5rem', color: 'var(--text-bright)' }}>🔑 {copy.title}</h2>

        {message && (
          <div style={{
            background: message.startsWith('✓') ? 'rgba(80, 255, 80, 0.12)' : 'rgba(255, 80, 80, 0.12)',
            border: message.startsWith('✓') ? '1px solid rgba(80, 255, 80, 0.3)' : '1px solid rgba(255, 80, 80, 0.3)',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            color: message.startsWith('✓') ? '#6bff6b' : '#ff6b6b',
            fontSize: '0.85rem',
            textAlign: 'center'
          }}>
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>{copy.current}</label>
            <input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              placeholder={copy.currentPlaceholder}
              style={{
                width: '100%', padding: '0.75rem', marginTop: '0.35rem',
                borderRadius: '8px', border: '1px solid var(--border-color)',
                background: 'var(--bg-card)', color: 'var(--text-primary)',
                fontSize: '0.95rem', outline: 'none', boxSizing: 'border-box'
              }}
            />
          </div>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>{copy.next}</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={copy.nextPlaceholder}
              style={{
                width: '100%', padding: '0.75rem', marginTop: '0.35rem',
                borderRadius: '8px', border: '1px solid var(--border-color)',
                background: 'var(--bg-card)', color: 'var(--text-primary)',
                fontSize: '0.95rem', outline: 'none', boxSizing: 'border-box'
              }}
            />
          </div>
          <div className="form-group" style={{ marginBottom: '1.5rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>{copy.confirm}</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={copy.confirmPlaceholder}
              style={{
                width: '100%', padding: '0.75rem', marginTop: '0.35rem',
                borderRadius: '8px', border: '1px solid var(--border-color)',
                background: 'var(--bg-card)', color: 'var(--text-primary)',
                fontSize: '0.95rem', outline: 'none', boxSizing: 'border-box'
              }}
            />
          </div>
          <button
            type="submit"
            className="btn"
            disabled={loading}
            style={{
              width: '100%', padding: '0.85rem', fontSize: '1rem', fontWeight: '700',
              background: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-primary) 100%)',
              cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? `⏳ ${copy.updating}` : `✓ ${copy.submit}`}
          </button>
        </form>
      </div>
    </div>
  );
}

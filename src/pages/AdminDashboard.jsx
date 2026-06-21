import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import TablesAndQR from './TablesAndQR';
import MenuManager from './MenuManager';
import Settings from './Settings';
import OrderScanner from './OrderScanner';

const SIDEBAR_ITEMS = [
  { id: 'dashboard', icon: 'monitor_heart', label: 'Live KDS', fill: true },
  { id: 'scanner', icon: 'qr_code_scanner', label: 'Order Scanner' },
  { id: 'menu', icon: 'restaurant_menu', label: 'Menu Manager' },
  { id: 'payments', icon: 'payments', label: 'Payments' },
  { id: 'tables', icon: 'grid_view', label: 'Tables & QR' },
  { id: 'analytics', icon: 'analytics', label: 'Analytics' },
  { id: 'settings', icon: 'settings', label: 'Settings', adminOnly: true },
];

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Real-time Order & KDS states
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [paymentOrders, setPaymentOrders] = useState([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const triggerRefresh = () => setRefreshKey(prev => prev + 1);

  // Setup WebSocket connection for real-time dashboard updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    let wsUrl = `${protocol}://${window.location.host}`;
    if (window.location.port === '3000') {
      wsUrl = `${protocol}://${window.location.hostname}:5000`;
    }
    
    let ws;
    let reconnectTimer;
    
    const connect = () => {
      console.log('ðŸ”Œ Connecting to WebSocket:', wsUrl);
      ws = new WebSocket(wsUrl);
      
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'ORDER_CREATED' || msg.type === 'ORDER_STATUS_CHANGED' || msg.type === 'PAYMENT_UPDATED') {
            triggerRefresh();
          }
        } catch (e) {
          console.error('WebSocket parse error:', e);
        }
      };
      
      ws.onclose = () => {
        console.log('ðŸ”Œ WebSocket connection closed. Reconnecting in 3s...');
        reconnectTimer = setTimeout(connect, 3000);
      };
      
      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        ws.close();
      };
    };
    
    connect();
    
    return () => {
      if (ws) ws.close();
      clearTimeout(reconnectTimer);
    };
  }, []);

  // Fetch KDS active orders
  const fetchActiveOrders = async () => {
    try {
      const res = await fetch('/api/orders?active=true', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setOrders(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setOrdersLoading(false);
    }
  };

  // Fetch Payment orders
  const fetchAllOrders = async () => {
    try {
      const res = await fetch('/api/orders', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setPaymentOrders(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setPaymentsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'dashboard') {
      fetchActiveOrders();
    }
  }, [activeTab, refreshKey]);

  useEffect(() => {
    if (activeTab === 'payments') {
      fetchAllOrders();
    }
  }, [activeTab, refreshKey]);

  const handleMoveStatus = async (orderId, currentStatus) => {
    const nextStatusMap = {
      'NEW': 'PREPARING',
      'PREPARING': 'READY',
      'READY': 'COMPLETED'
    };
    const nextStatus = nextStatusMap[currentStatus];
    if (!nextStatus) return;

    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Failed to update status');
    } catch (e) {
      console.error(e);
      alert('Failed to update KDS status.');
    }
  };

  const handleMarkAsPaid = async (orderId) => {
    try {
      const res = await fetch(`/api/orders/${orderId}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentStatus: 'PAID' }),
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Failed to update payment');
    } catch (e) {
      console.error(e);
      alert('Failed to update payment status.');
    }
  };
  
  // Theme State
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('aurum_admin_theme');
    if (saved) return saved === 'dark';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark;
  });
  const [ripple, setRipple] = useState(null);
  const rippleCount = useRef(0);

  // Authentication Check
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(res => {
        if (!res.ok) throw new Error('Not authenticated');
        return res.json();
      })
      .then(data => {
        setUser(data.user);
        setLoading(false);
      })
      .catch(() => {
        navigate('/admin');
      });
  }, [navigate]);

  // Handle Theme Toggle Ripple
  const handleThemeToggle = (e) => {
    const btn = e.currentTarget.getBoundingClientRect();
    const x = btn.left + btn.width / 2;
    const y = btn.top + btn.height / 2;
    
    // Calculate distance to furthest corner for ripple radius
    const radius = Math.max(
      Math.hypot(x, y),
      Math.hypot(window.innerWidth - x, y),
      Math.hypot(x, window.innerHeight - y),
      Math.hypot(window.innerWidth - x, window.innerHeight - y)
    );

    const nextIsDark = !isDark;
    const color = nextIsDark ? '#121317' : '#F8F6F1';
    const rippleId = ++rippleCount.current;

    setRipple({ x, y, radius, color, id: rippleId });

    // Swap theme halfway through animation
    setTimeout(() => {
      setIsDark(nextIsDark);
      localStorage.setItem('aurum_admin_theme', nextIsDark ? 'dark' : 'light');
      if (nextIsDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }, 250); // 250ms is halfway through 0.5s animation
    
    // Cleanup ripple
    setTimeout(() => {
      setRipple(current => current?.id === rippleId ? null : current);
    }, 600);
  };

  // Setup initial dark class
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  const newOrders = orders.filter(o => o.status === 'NEW');
  const preparingOrders = orders.filter(o => o.status === 'PREPARING');
  const readyOrders = orders.filter(o => o.status === 'READY');

  const renderKDSCard = (order) => {
    const minsAgo = Math.max(0, Math.floor((new Date() - new Date(order.createdAt)) / 60000));
    return (
      <div key={order._id} className="bg-surface-container-low border border-outline-variant/30 hover:border-primary/40 rounded-xl p-4 flex flex-col gap-3 transition-all text-left">
        <div className="flex justify-between items-start gap-2">
          <div>
            <span className="font-headline-sm text-base text-on-surface font-semibold">
              {order.table}
              {order.location && (
                <span className="text-[12px] text-on-surface-variant font-normal ml-1.5">({order.location})</span>
              )}
            </span>
            <span className="text-[11px] text-on-surface-variant/70 block mt-0.5">{minsAgo} mins ago â€¢ by {order.confirmedBy.split('@')[0]}</span>
          </div>
          
          <span className={`px-2 py-0.5 rounded text-[10px] font-label-caps tracking-wider uppercase font-semibold border ${
            order.paymentStatus === 'PAID' 
              ? 'bg-primary/10 text-primary border-primary/20' 
              : 'bg-error/10 text-error border-error/20 animate-pulse'
          }`}>
            {order.paymentStatus}
          </span>
        </div>

        <div className="space-y-1 bg-surface-container-lowest/50 rounded-lg p-2.5 border border-outline-variant/10">
          {order.items.map((item, idx) => (
            <div key={item.id || idx} className="flex justify-between text-xs font-body-sm text-on-surface-variant">
              <span><span className="text-primary font-semibold font-mono">{item.quantity}x</span> {item.name}</span>
            </div>
          ))}
        </div>

        {order.status !== 'COMPLETED' && (
          <button
            onClick={() => handleMoveStatus(order._id, order.status)}
            className="w-full bg-surface-container-high hover:bg-primary/20 hover:text-primary text-on-surface py-2 rounded-lg font-label-caps text-[11px] uppercase tracking-widest border border-outline-variant/50 hover:border-primary/30 transition-all flex items-center justify-center gap-1 cursor-pointer font-semibold"
          >
            {order.status === 'NEW' && (
              <>
                <span className="material-symbols-outlined text-sm">soup_kitchen</span>
                Start Preparing
              </>
            )}
            {order.status === 'PREPARING' && (
              <>
                <span className="material-symbols-outlined text-sm">notifications_active</span>
                Mark as Ready
              </>
            )}
            {order.status === 'READY' && (
              <>
                <span className="material-symbols-outlined text-sm">done_all</span>
                Complete Order
              </>
            )}
          </button>
        )}
      </div>
    );
  };

  const renderPaymentsView = () => {
    return (
      <div className="bg-surface-container rounded-2xl border border-outline-variant/20 shadow-lg overflow-hidden">
        <div className="p-6 md:p-8 border-b border-outline-variant/10 flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-surface-container-low">
          <div>
            <h2 className="font-headline-md text-2xl text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">payments</span>
              Payments Dashboard
            </h2>
            <p className="font-body-md text-on-surface-variant mt-1">
              Verify all verified customer orders and resolve any pending transactions manually.
            </p>
          </div>
        </div>

        <div className="p-6 md:p-8 overflow-x-auto">
          {paymentsLoading ? (
            <div className="flex justify-center py-12">
              <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
            </div>
          ) : paymentOrders.length === 0 ? (
            <div className="text-center py-16 text-on-surface-variant/60 flex flex-col items-center gap-2">
              <span className="material-symbols-outlined text-5xl">receipt</span>
              <p className="font-title-md">No orders found</p>
              <p className="font-body-sm">Scanned waiter orders will show up here.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-outline-variant/20 text-on-surface-variant font-label-caps text-[11px] uppercase tracking-widest bg-surface-container-lowest/50">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Table</th>
                  <th className="py-3 px-4">Items Summary</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Payment Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {paymentOrders.map((order) => {
                  const dateStr = new Date(order.createdAt).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                  });
                  const itemsText = order.items.map(item => `${item.quantity}x ${item.name}`).join(', ');
                  
                  return (
                    <tr key={order._id} className="hover:bg-surface-container-lowest/30 transition-colors">
                      <td className="py-3.5 px-4 font-body-sm text-on-surface-variant whitespace-nowrap">{dateStr}</td>
                      <td className="py-3.5 px-4 font-semibold text-on-surface">
                        {order.table}
                        {order.location && (
                          <span className="text-[11px] text-on-surface-variant font-normal block mt-0.5">({order.location})</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 max-w-xs truncate text-on-surface-variant" title={itemsText}>{itemsText}</td>
                      <td className="py-3.5 px-4 font-price-display text-primary font-semibold">₹{order.total.toFixed(2)}</td>
                      <td className="py-3.5 px-4 font-body-sm text-on-surface-variant">
                        <span className="px-2 py-0.5 rounded bg-surface-container-high border border-outline-variant/30 text-[10px] font-label-caps uppercase tracking-wider font-semibold">
                          {order.paymentType === 'RAZORPAY' || order.paymentType === 'ONLINE' || order.paymentType === 'NOW'
                            ? 'RAZORPAY / ONLINE'
                            : order.paymentType === 'LATER'
                              ? 'PAY LATER'
                              : (order.paymentType || 'UNKNOWN')}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-label-caps tracking-wider uppercase font-semibold border ${
                          order.paymentStatus === 'PAID'
                            ? 'bg-primary/10 text-primary border-primary/20'
                            : 'bg-error/10 text-error border-error/20 animate-pulse'
                        }`}>
                          {order.paymentStatus}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {order.paymentStatus === 'PENDING' && (
                          <button
                            onClick={() => handleMarkAsPaid(order._id)}
                            className="bg-primary/10 hover:bg-primary text-primary hover:text-on-primary border border-primary/30 px-3 py-1.5 rounded-lg font-label-caps text-[10px] uppercase tracking-wider transition-all cursor-pointer font-semibold inline-flex items-center gap-1"
                          >
                            <span className="material-symbols-outlined text-[12px]">check</span>
                            Verify Paid
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-on-background transition-colors duration-300">
        <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex selection:bg-primary selection:text-on-primary font-sans antialiased overflow-hidden bg-background text-on-background transition-colors duration-300">
      
      {/* Ripple Animation Overlay */}
      <AnimatePresence>
        {ripple && (
          <motion.div
            key={ripple.id}
            initial={{ scale: 0, opacity: 1 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
            style={{
              position: 'fixed',
              top: ripple.y - ripple.radius,
              left: ripple.x - ripple.radius,
              width: ripple.radius * 2,
              height: ripple.radius * 2,
              borderRadius: '50%',
              backgroundColor: ripple.color,
              zIndex: 9999, // Above everything during transition
              pointerEvents: 'none'
            }}
          />
        )}
      </AnimatePresence>

      {/* SideNavBar */}
      <nav className="hidden md:flex flex-col h-screen w-[280px] fixed left-0 top-0 bg-surface-container/60 backdrop-blur-[30px] border-r border-outline-variant/20 shadow-[0_0_20px_rgba(212,175,55,0.05)] py-margin-desktop z-50">
        <div className="px-6 mb-12">
          <h1 className="font-display-lg text-display-lg font-bold text-primary tracking-tight">Aurum Table</h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-2">Digital Concierge</p>
        </div>
        <ul className="flex-1 space-y-2">
          {SIDEBAR_ITEMS.map((item) => {
            if (item.adminOnly && user?.role !== 'ADMIN') return null;
            const isActive = activeTab === item.id;
            return (
              <li key={item.id}>
                <a 
                  href="#"
                  onClick={(e) => { e.preventDefault(); setActiveTab(item.id); }}
                  className={isActive 
                    ? "flex items-center gap-4 text-primary border-l-4 border-primary bg-primary/10 py-3 px-6 transition-all duration-300 shadow-[inset_10px_0_15px_-10px_rgba(212,175,55,0.3)] hover:translate-y-[-2px] hover:shadow-[0_4px_12px_rgba(212,175,55,0.2)]" 
                    : "flex items-center gap-4 text-on-surface-variant hover:text-on-surface py-3 px-6 transition-colors duration-200 hover:translate-y-[-2px] hover:shadow-[0_4px_12px_rgba(212,175,55,0.2)] pl-8"}
                >
                  <span className="material-symbols-outlined" style={isActive && item.fill ? { fontVariationSettings: "'FILL' 1" } : {}}>
                    {item.icon}
                  </span>
                  <span className="font-title-md text-title-md">{item.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
        <div className="mt-auto px-6">
          <div className="flex items-center justify-between p-3 bg-[#f4f7f6] dark:bg-surface-container-high/40 border border-[#e3ebe8] dark:border-outline-variant/10 rounded-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#e2edea] dark:bg-teal-950/40 text-[#1b7c83] dark:text-teal-400 flex items-center justify-center font-display-md text-title-md font-bold">
                {user?.name?.charAt(0) || 'N'}
              </div>
              <div className="flex flex-col">
                <span className="font-title-sm text-[#121317] dark:text-on-surface font-semibold text-sm leading-tight">
                  {user?.name || 'NupurStaff'}
                </span>
                <span className="text-[12px] text-[#6d8285] dark:text-on-surface-variant/80 mt-0.5 leading-none">
                  {user?.role === 'ADMIN' ? 'Store Owner' : (user?.role === 'STAFF' ? 'Staff Member' : 'Store Owner')}
                </span>
              </div>
            </div>
            <button 
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
                navigate('/admin');
              }}
              className="text-[#7d9093] dark:text-on-surface-variant hover:text-error dark:hover:text-error hover:bg-error/10 p-2 rounded-xl transition-all duration-200 flex items-center justify-center"
              title="Logout"
            >
              <span className="material-symbols-outlined text-xl">logout</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <div className="flex-1 md:ml-[280px] flex flex-col h-screen overflow-hidden">
        {/* TopAppBar */}
        <header className="w-full h-20 sticky top-0 bg-background/80 backdrop-blur-md flex justify-between items-center px-margin-mobile md:px-margin-desktop z-40 transition-colors">
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsMobileMenuOpen(true)} 
              className="md:hidden text-on-surface-variant hover:text-primary transition-all p-2 -ml-2 rounded-lg flex items-center justify-center cursor-pointer"
            >
              <span className="material-symbols-outlined text-[24px]">menu</span>
            </button>
            <h2 className="font-headline-lg text-headline-lg text-primary tracking-tight">Aurum OS</h2>
          </div>
          <div className="flex items-center gap-2 sm:gap-6">
            <button onClick={handleThemeToggle} className="text-on-surface-variant hover:text-primary transition-all ripple-effect cursor-pointer">
              <span className="material-symbols-outlined">{isDark ? 'light_mode' : 'dark_mode'}</span>
            </button>
            <button className="text-on-surface-variant hover:text-primary transition-all ripple-effect cursor-pointer relative">
              <span className="material-symbols-outlined">notifications</span>
              <span className="absolute top-0 right-0 w-2 h-2 bg-error rounded-full"></span>
            </button>
          </div>
        </header>

        {/* Dynamic Content */}
        <main className="flex-1 p-margin-mobile md:p-margin-desktop overflow-y-auto mt-20 md:mt-0 pb-24 md:pb-8 relative z-10">
          {activeTab === 'dashboard' && (
            <div className="flex flex-col md:flex-row gap-gutter h-auto md:h-full md:min-w-[900px]">
              {/* Column 1: New Orders */}
              <section className="flex-1 min-h-[400px] md:min-h-0 flex flex-col bg-surface/50 rounded-xl border border-outline-variant/20 overflow-hidden stagger-1">
                <div className="p-4 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-low">
                  <h3 className="font-title-md text-title-md text-on-surface flex items-center gap-2">
                    New
                    <span className="bg-error/20 text-error font-mono-data text-mono-data px-2 py-0.5 rounded-full">{newOrders.length}</span>
                  </h3>
                </div>
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                  {ordersLoading ? (
                    <div className="flex justify-center py-8">
                      <span className="material-symbols-outlined text-primary text-2xl animate-spin">progress_activity</span>
                    </div>
                  ) : newOrders.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center opacity-50 py-12">
                      <span className="material-symbols-outlined text-4xl mb-2">receipt_long</span>
                      <p className="font-body-sm text-body-sm">No new orders</p>
                    </div>
                  ) : (
                    newOrders.map(renderKDSCard)
                  )}
                </div>
              </section>
              
              {/* Column 2: Preparing */}
              <section className="flex-1 min-h-[400px] md:min-h-0 flex flex-col bg-surface/50 rounded-xl border border-outline-variant/20 overflow-hidden stagger-2">
                <div className="p-4 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-low">
                  <h3 className="font-title-md text-title-md text-on-surface flex items-center gap-2">
                    Preparing
                    <span className="bg-primary/20 text-primary font-mono-data text-mono-data px-2 py-0.5 rounded-full">{preparingOrders.length}</span>
                  </h3>
                </div>
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                  {ordersLoading ? (
                    <div className="flex justify-center py-8">
                      <span className="material-symbols-outlined text-primary text-2xl animate-spin">progress_activity</span>
                    </div>
                  ) : preparingOrders.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center opacity-50 py-12">
                      <span className="material-symbols-outlined text-4xl mb-2">soup_kitchen</span>
                      <p className="font-body-sm text-body-sm">No orders in preparation</p>
                    </div>
                  ) : (
                    preparingOrders.map(renderKDSCard)
                  )}
                </div>
              </section>

              {/* Column 3: Ready */}
              <section className="flex-1 min-h-[400px] md:min-h-0 flex flex-col bg-surface/50 rounded-xl border border-outline-variant/20 overflow-hidden stagger-3">
                <div className="p-4 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-low">
                  <h3 className="font-title-md text-title-md text-on-surface flex items-center gap-2">
                    Ready
                    <span className="bg-tertiary/20 text-tertiary font-mono-data text-mono-data px-2 py-0.5 rounded-full">{readyOrders.length}</span>
                  </h3>
                </div>
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                  {ordersLoading ? (
                    <div className="flex justify-center py-8">
                      <span className="material-symbols-outlined text-primary text-2xl animate-spin">progress_activity</span>
                    </div>
                  ) : readyOrders.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center opacity-50 py-12">
                      <span className="material-symbols-outlined text-4xl mb-2">done_all</span>
                      <p className="font-body-sm text-body-sm">No items ready for pickup</p>
                    </div>
                  ) : (
                    readyOrders.map(renderKDSCard)
                  )}
                </div>
              </section>
            </div>
          )}

          {activeTab === 'menu' && <MenuManager />}
          {activeTab === 'scanner' && <OrderScanner />}
          {activeTab === 'tables' && <TablesAndQR />}
          {activeTab === 'settings' && <Settings user={user} />}
          {activeTab === 'payments' && renderPaymentsView()}

          {activeTab !== 'dashboard' && activeTab !== 'tables' && activeTab !== 'menu' && activeTab !== 'settings' && activeTab !== 'scanner' && activeTab !== 'payments' && (
             <motion.div
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               className="flex items-center justify-center h-full"
             >
               <p className="text-on-surface-variant font-title-md">This module is under construction.</p>
             </motion.div>
          )}
        </main>
      </div>

      {/* Mobile Drawer Navigation */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 md:hidden"
            />
            {/* Drawer */}
            <motion.nav
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed left-0 top-0 bottom-0 w-[280px] bg-surface-container/95 backdrop-blur-[20px] border-r border-outline-variant/20 shadow-2xl flex flex-col z-50 py-6"
            >
              <div className="px-6 mb-8 flex justify-between items-center">
                <div>
                  <h1 className="font-display-lg text-2xl font-bold text-primary tracking-tight">Aurum Table</h1>
                  <p className="font-body-sm text-[12px] text-on-surface-variant mt-1">Digital Concierge</p>
                </div>
                <button 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="text-on-surface-variant hover:text-primary p-1 rounded-lg flex items-center justify-center cursor-pointer"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <ul className="flex-1 space-y-2">
                {SIDEBAR_ITEMS.map((item) => {
                  if (item.adminOnly && user?.role !== 'ADMIN') return null;
                  const isActive = activeTab === item.id;
                  return (
                    <li key={item.id}>
                      <a 
                        href="#"
                        onClick={(e) => { 
                          e.preventDefault(); 
                          setActiveTab(item.id);
                          setIsMobileMenuOpen(false); 
                        }}
                        className={isActive 
                          ? "flex items-center gap-4 text-primary border-l-4 border-primary bg-primary/10 py-3 px-6 transition-all duration-300 shadow-[inset_10px_0_15px_-10px_rgba(212,175,55,0.3)] pl-5" 
                          : "flex items-center gap-4 text-on-surface-variant hover:text-on-surface py-3 px-6 transition-colors duration-200 pl-6"}
                      >
                        <span className="material-symbols-outlined" style={isActive && item.fill ? { fontVariationSettings: "'FILL' 1" } : {}}>
                          {item.icon}
                        </span>
                        <span className="font-title-md text-title-md">{item.label}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-auto px-6">
                <div className="flex items-center justify-between p-3 bg-[#f4f7f6] dark:bg-surface-container-high/40 border border-[#e3ebe8] dark:border-outline-variant/10 rounded-2xl">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#e2edea] dark:bg-teal-950/40 text-[#1b7c83] dark:text-teal-400 flex items-center justify-center font-display-md text-title-md font-bold">
                      {user?.name?.charAt(0) || 'N'}
                    </div>
                    <div className="flex flex-col">
                      <span className="font-title-sm text-[#121317] dark:text-on-surface font-semibold text-sm leading-tight">
                        {user?.name || 'NupurStaff'}
                      </span>
                      <span className="text-[12px] text-[#6d8285] dark:text-on-surface-variant/80 mt-0.5 leading-none">
                        {user?.role === 'ADMIN' ? 'Store Owner' : (user?.role === 'STAFF' ? 'Staff Member' : 'Store Owner')}
                      </span>
                    </div>
                  </div>
                  <button 
                    onClick={async () => {
                      setIsMobileMenuOpen(false);
                      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
                      navigate('/admin');
                    }}
                    className="text-[#7d9093] dark:text-on-surface-variant hover:text-error dark:hover:text-error hover:bg-error/10 p-2 rounded-xl transition-all duration-200 flex items-center justify-center"
                    title="Logout"
                  >
                    <span className="material-symbols-outlined text-xl">logout</span>
                  </button>
                </div>
              </div>
            </motion.nav>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}


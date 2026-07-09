import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import TablesAndQR from './TablesAndQR';
import MenuManager from './MenuManager';
import Settings from './Settings';
import { API_BASE, getWebSocketUrl } from '../config';
import OrderScanner from './OrderScanner';
import Analytics from './Analytics';

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

  const [paymentsSearch, setPaymentsSearch] = useState('');
  const [paymentsStatusFilter, setPaymentsStatusFilter] = useState('ALL'); // ALL, PAID, PENDING
  const [paymentsTypeFilter, setPaymentsTypeFilter] = useState('ALL'); // ALL, RAZORPAY, LATER, UPI

  const [wsConnected, setWsConnected] = useState(false);

  // ponytail: lightweight tick counter for timer re-renders without refetching
  const [tick, setTick] = useState(0);

  // KDS stage-aware overdue thresholds (minutes in current stage)
  const KDS_STAGE_THRESHOLDS = { NEW: 3, PREPARING: 15, READY: 10 };

  // Sound alert state
  const [kdsSoundEnabled, setKdsSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('aurum_kds_sound_enabled');
    return saved === null ? true : saved === 'true';
  });
  const audioCtxRef = useRef(null);
  const initialLoadRef = useRef(true);
  const [newOrderToast, setNewOrderToast] = useState(null);

  // Kitchen mode state
  const [isKitchenMode, setIsKitchenMode] = useState(false);
  const kdsContainerRef = useRef(null);

  const triggerRefresh = () => setRefreshKey(prev => prev + 1);

  // Setup WebSocket for real-time dashboard updates
  useEffect(() => {
    const wsUrl = getWebSocketUrl();
    
    let ws;
    let reconnectTimer;
    
    const connect = () => {
      try {
        console.log('🔌 Connecting to WebSocket:', wsUrl);
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
          console.log('🔌 WebSocket connected');
          setWsConnected(true);
        };
        
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'ORDER_CREATED' || msg.type === 'ORDER_STATUS_CHANGED' || msg.type === 'PAYMENT_UPDATED') {
              triggerRefresh();
              // ponytail: sound + toast only for genuinely new orders, not status changes or payments
              if (msg.type === 'ORDER_CREATED') {
                playNewOrderSound();
                const tableName = msg.payload?.table;
                setNewOrderToast(tableName ? `New order received — ${tableName}` : 'New order received');
                setTimeout(() => setNewOrderToast(null), 3000);
              }
            }
          } catch (e) {
            console.error('WebSocket parse error:', e);
          }
        };
        
        ws.onclose = () => {
          console.log('🔌 WebSocket connection closed. Reconnecting in 10s...');
          setWsConnected(false);
          // ponytail: retry slowly to avoid spamming Vercel console logs with errors
          reconnectTimer = setTimeout(connect, 10000);
        };
        
        ws.onerror = (err) => {
          ws.close();
        };
      } catch (err) {
        console.error('WebSocket creation error:', err);
      }
    };
    
    connect();
    
    return () => {
      if (ws) ws.close();
      clearTimeout(reconnectTimer);
    };
  }, []);

  // ponytail: fallback polling runs only slowly (30s) if WebSocket is connected, or faster (5s) if disconnected
  useEffect(() => {
    const intervalTime = wsConnected ? 30000 : 5000;
    const pollInterval = setInterval(() => {
      triggerRefresh();
    }, intervalTime);

    return () => clearInterval(pollInterval);
  }, [wsConnected]);

  // ponytail: lightweight 30s tick for timer text re-renders (no data refetch)
  useEffect(() => {
    const timerTick = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(timerTick);
  }, []);

  // Mark initial load complete after first data fetch
  useEffect(() => {
    if (!ordersLoading && initialLoadRef.current) {
      initialLoadRef.current = false;
    }
  }, [ordersLoading]);

  // ponytail: Web Audio API chime — no external file needed
  const playNewOrderSound = useCallback(() => {
    if (!kdsSoundEnabled || initialLoadRef.current) return;
    try {
      const ctx = audioCtxRef.current || new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      // Two-tone chime: C5 then E5
      [523.25, 659.25].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.3, now + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + i * 0.15);
        osc.stop(now + i * 0.15 + 0.25);
      });
    } catch (e) {
      // ponytail: silently handle autoplay restrictions
    }
  }, [kdsSoundEnabled]);

  // Sound preference persistence
  const toggleKdsSound = useCallback(() => {
    setKdsSoundEnabled(prev => {
      const next = !prev;
      localStorage.setItem('aurum_kds_sound_enabled', String(next));
      // Play test chime when enabling so user hears it works
      if (next) {
        setTimeout(() => {
          try {
            const ctx = audioCtxRef.current || new (window.AudioContext || window.webkitAudioContext)();
            audioCtxRef.current = ctx;
            if (ctx.state === 'suspended') ctx.resume();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 523.25;
            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
            osc.connect(gain).connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.2);
          } catch (e) {}
        }, 50);
      }
      return next;
    });
  }, []);

  // Kitchen mode toggle
  const toggleKitchenMode = useCallback(() => {
    if (!isKitchenMode) {
      setIsKitchenMode(true);
      try {
        document.documentElement.requestFullscreen?.();
      } catch (e) {
        // ponytail: fullscreen API unavailable — still activate distraction-free layout
      }
    } else {
      setIsKitchenMode(false);
      try {
        if (document.fullscreenElement) document.exitFullscreen?.();
      } catch (e) {}
    }
  }, [isKitchenMode]);

  // Sync kitchen mode state with browser fullscreen (Escape key handling)
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isKitchenMode) {
        setIsKitchenMode(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isKitchenMode]);

  // Fetch KDS active orders
  const fetchActiveOrders = async () => {
    try {
      const res = await fetch(API_BASE + '/api/orders?active=true', { credentials: 'include' });
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
      const res = await fetch(API_BASE + '/api/orders', { credentials: 'include' });
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

    // ponytail: optimistic UI updates for instant status change feedback on dashboard
    const prevOrders = [...orders];
    setOrders(prev => prev.map(o => o._id === orderId ? { ...o, status: nextStatus } : o));

    try {
      const res = await fetch(`${API_BASE}/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Failed to update status');
      fetchActiveOrders(); // fetch latest server state immediately
    } catch (e) {
      console.error(e);
      setOrders(prevOrders);
      alert('Failed to update KDS status.');
    }
  };

  const handleMarkAsPaid = async (orderId) => {
    // ponytail: optimistic UI updates for instant verification change feedback in payments list
    const prevPaymentOrders = [...paymentOrders];
    setPaymentOrders(prev => prev.map(o => o._id === orderId ? { ...o, paymentStatus: 'PAID' } : o));

    try {
      const res = await fetch(`${API_BASE}/api/orders/${orderId}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentStatus: 'PAID' }),
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Failed to update payment');
      fetchAllOrders(); // fetch latest server state immediately
    } catch (e) {
      console.error(e);
      setPaymentOrders(prevPaymentOrders);
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
    fetch(API_BASE + '/api/auth/me', { credentials: 'include' })
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
    const now = new Date();
    const totalAgeMinutes = Math.max(0, Math.floor((now - new Date(order.createdAt)) / 60000));
    const stageAgeMinutes = Math.max(0, Math.floor((now - new Date(order.statusUpdatedAt ?? order.createdAt)) / 60000));
    const isOverdue = stageAgeMinutes >= (KDS_STAGE_THRESHOLDS[order.status] ?? 10);
    const stageLabel = order.status === 'PREPARING' ? 'Prep' : order.status === 'READY' ? 'Ready' : 'New';
    // ponytail: safe confirmedBy access — prevents crash on null/undefined/non-string
    const confirmedByName = typeof order.confirmedBy === 'string' && order.confirmedBy.trim()
      ? order.confirmedBy.split('@')[0]
      : 'Staff';
    // ponytail: use tick to ensure timers re-render even without data refetch
    void tick;
    
    return (
      <motion.div
        key={order._id}
        layoutId={order._id}
        layout
        initial={{ opacity: 0, y: 15, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9, y: -10 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className={`bg-surface-container-low/90 border rounded-2xl p-4 flex flex-col gap-3 transition-all text-left shadow-lg hover:shadow-primary/5 ${
          isOverdue 
            ? 'border-primary ring-1 ring-primary/40 pulse-glow' 
            : 'border-outline-variant/20 hover:border-primary/40'
        }`}
      >
        {/* Prominent Table Badge */}
        <div className="flex items-center gap-2 bg-surface-container-high border border-outline-variant/30 rounded-xl px-3 py-2">
          <span className="material-symbols-outlined text-primary text-lg">table_restaurant</span>
          <span className="font-headline-sm text-base text-primary font-bold">{order.table}</span>
          {order.location && (
            <span className="text-[11px] text-on-surface-variant font-mono font-medium ml-auto bg-surface-container-lowest/80 px-2 py-0.5 rounded-lg border border-outline-variant/10">📍 {order.location}</span>
          )}
        </div>

        <div className="flex justify-between items-center gap-2">
          <span className={`text-[11px] font-mono flex items-center gap-1 ${isOverdue ? 'text-primary font-bold' : 'text-on-surface-variant/70'}`}>
            <span className="material-symbols-outlined text-[14px]">{isOverdue ? 'alarm' : 'schedule'}</span>
            Total {totalAgeMinutes}m · {stageLabel} {stageAgeMinutes}m · by {confirmedByName}
          </span>
          
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-label-caps tracking-widest uppercase font-semibold border ${
            order.paymentStatus === 'PAID' 
              ? 'bg-green-500/10 text-green-500 border-green-500/20' 
              : 'bg-primary/10 text-primary border-primary/20 animate-pulse'
          }`}>
            {order.paymentStatus}
          </span>
        </div>

        <div className="space-y-1.5 bg-surface-container-lowest/60 rounded-xl p-2.5 border border-outline-variant/10">
          {order.items.map((item, idx) => (
            <div key={item.id || idx} className="flex justify-between text-xs font-body-sm text-on-surface-variant group/item py-0.5">
              <span className="flex items-center gap-1.5 truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-primary/45 group-hover/item:bg-primary transition-colors shrink-0" />
                <span className="text-on-surface font-medium truncate">{item.name}</span>
              </span>
              <span className="text-primary font-bold font-mono bg-primary/15 px-1.5 py-0.5 rounded text-[10px]">x{item.quantity}</span>
            </div>
          ))}
        </div>

        {order.status !== 'COMPLETED' && (
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => handleMoveStatus(order._id, order.status)}
            className="w-full bg-surface-container-highest hover:bg-primary/25 hover:text-primary text-on-surface py-2 rounded-xl font-label-caps text-[11px] uppercase tracking-widest border border-outline-variant/50 hover:border-primary/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer font-bold"
          >
            {order.status === 'NEW' && (
              <>
                <span className="material-symbols-outlined text-base">soup_kitchen</span>
                Start Preparing
              </>
            )}
            {order.status === 'PREPARING' && (
              <>
                <span className="material-symbols-outlined text-base">notifications_active</span>
                Mark as Ready
              </>
            )}
            {order.status === 'READY' && (
              <>
                <span className="material-symbols-outlined text-base">done_all</span>
                Complete Order
              </>
            )}
          </motion.button>
        )}
      </motion.div>
    );
  };

  const renderPaymentsView = () => {
    // ponytail: filter payment orders locally for real-time responsiveness
    const filteredPaymentOrders = paymentOrders.filter(order => {
      // 1. Search Query
      const searchClean = paymentsSearch.toLowerCase().replace(/^#/, '');
      const tableMatches = order.table.toLowerCase().includes(searchClean);
      const orderIdMatches = order._id.toString().toLowerCase().includes(searchClean);
      const itemsText = order.items.map(item => `${item.quantity}x ${item.name}`).join(', ').toLowerCase();
      const itemsMatches = itemsText.includes(searchClean);
      const matchesSearch = !paymentsSearch || tableMatches || orderIdMatches || itemsMatches;

      // 2. Status Filter
      const matchesStatus = paymentsStatusFilter === 'ALL' || order.paymentStatus === paymentsStatusFilter;

      // 3. Payment Type Filter
      const type = order.paymentType || 'UNKNOWN';
      let normalizedType = 'UNKNOWN';
      if (type === 'RAZORPAY' || type === 'ONLINE' || type === 'NOW') {
        normalizedType = 'RAZORPAY';
      } else if (type === 'LATER') {
        normalizedType = 'LATER';
      } else if (type === 'UPI') {
        normalizedType = 'UPI';
      }
      const matchesType = paymentsTypeFilter === 'ALL' || normalizedType === paymentsTypeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });

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

        {/* ponytail: search and filters toolbar */}
        <div className="px-6 md:px-8 py-4 bg-surface-container-low border-b border-outline-variant/10 flex flex-wrap gap-4 items-center">
          {/* Search bar */}
          <div className="relative min-w-[240px] flex-1">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/70 text-sm">search</span>
            <input 
              type="text" 
              placeholder="Search table, items, order ID..." 
              value={paymentsSearch}
              onChange={(e) => setPaymentsSearch(e.target.value)}
              className="w-full bg-surface-container-lowest border border-outline-variant/30 text-on-surface pl-9 pr-4 py-2 rounded-xl focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors font-body-md text-sm placeholder-on-surface-variant/40"
            />
            {paymentsSearch && (
              <button onClick={() => setPaymentsSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant/70 hover:text-on-surface flex items-center">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            )}
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest font-semibold">Status:</span>
            <div className="flex bg-surface-container-highest/40 rounded-xl p-0.5 border border-outline-variant/20">
              {['ALL', 'PAID', 'PENDING'].map(status => (
                <button
                  key={status}
                  onClick={() => setPaymentsStatusFilter(status)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-label-caps uppercase tracking-wider font-semibold transition-all ${
                    paymentsStatusFilter === status
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-on-surface-variant/80 hover:text-on-surface'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          {/* Payment Type Filter */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest font-semibold">Method:</span>
            <div className="flex bg-surface-container-highest/40 rounded-xl p-0.5 border border-outline-variant/20">
              {[
                { value: 'ALL', label: 'All' },
                { value: 'RAZORPAY', label: 'Online' },
                { value: 'LATER', label: 'Pay Later' },
                { value: 'UPI', label: 'UPI' }
              ].map(type => (
                <button
                  key={type.value}
                  onClick={() => setPaymentsTypeFilter(type.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-label-caps uppercase tracking-wider font-semibold transition-all ${
                    paymentsTypeFilter === type.value
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-on-surface-variant/80 hover:text-on-surface'
                  }`}
                >
                  {type.label}
                </button>
              ))}
            </div>
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
          ) : filteredPaymentOrders.length === 0 ? (
            <div className="text-center py-16 text-on-surface-variant/60 flex flex-col items-center gap-2">
              <span className="material-symbols-outlined text-5xl">search_off</span>
              <p className="font-title-md">No matching transactions</p>
              <p className="font-body-sm">Try adjusting your search query or filters.</p>
            </div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant/20 text-on-surface-variant font-label-caps text-[11px] uppercase tracking-widest bg-surface-container-lowest/50">
                      <th className="py-3 px-4">Order ID</th>
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
                    {filteredPaymentOrders.map((order) => {
                      const dateStr = new Date(order.createdAt).toLocaleString(undefined, {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                      });
                      const itemsText = order.items.map(item => `${item.quantity}x ${item.name}`).join(', ');
                      
                      return (
                        <tr key={order._id} className="hover:bg-surface-container-lowest/30 transition-colors">
                          <td className="py-3.5 px-4 font-mono text-primary font-bold text-sm tracking-wide">
                            #{order._id.toString().substring(18)}
                          </td>
                          <td className="py-3.5 px-4 font-body-sm text-on-surface-variant whitespace-nowrap">{dateStr}</td>
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-primary text-sm">table_restaurant</span>
                              <span className="font-semibold text-primary">{order.table}</span>
                            </div>
                            {order.location && (
                              <span className="text-[11px] text-on-surface-variant font-normal block mt-0.5 pl-6">📍 {order.location}</span>
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
              </div>

              {/* Mobile Card List View */}
              <div className="block md:hidden space-y-4">
                {filteredPaymentOrders.map((order) => {
                  const dateStr = new Date(order.createdAt).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                  });
                  const itemsText = order.items.map(item => `${item.quantity}x ${item.name}`).join(', ');
                  
                  return (
                    <div key={order._id} className="bg-surface-container-low border border-outline-variant/20 rounded-2xl p-4 flex flex-col gap-3 shadow-md">
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="material-symbols-outlined text-primary text-base">table_restaurant</span>
                            <span className="font-headline-sm text-base text-primary font-bold">{order.table}</span>
                            <span className="font-mono text-xs text-primary font-bold bg-primary/10 border border-primary/20 rounded px-1.5 py-0.5 ml-1">
                              #{order._id.toString().substring(18)}
                            </span>
                          </div>
                          {order.location && (
                            <span className="text-xs text-on-surface-variant font-normal block mt-0.5">📍 {order.location}</span>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="text-xs text-on-surface-variant/60 block font-mono">{dateStr}</span>
                          <span className="font-price-display text-primary font-bold text-base mt-0.5 block">₹{order.total.toFixed(2)}</span>
                        </div>
                      </div>

                      <div className="bg-surface-container-lowest/60 border border-outline-variant/10 rounded-xl p-2.5 text-xs text-on-surface-variant/80">
                        <strong className="text-on-surface font-semibold block mb-1">Items Summary:</strong>
                        <div className="line-clamp-2 leading-relaxed" title={itemsText}>{itemsText}</div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-outline-variant/10">
                        <div className="flex gap-1.5 items-center">
                          <span className="px-2 py-0.5 rounded bg-surface-container-high border border-outline-variant/30 text-[10px] font-label-caps uppercase tracking-wider font-semibold">
                            {order.paymentType === 'RAZORPAY' || order.paymentType === 'ONLINE' || order.paymentType === 'NOW'
                              ? 'Online'
                              : order.paymentType === 'LATER'
                                ? 'Pay Later'
                                : (order.paymentType || 'Method')}
                          </span>
                          
                          <span className={`px-2 py-0.5 rounded text-[10px] font-label-caps tracking-wider uppercase font-semibold border ${
                            order.paymentStatus === 'PAID'
                              ? 'bg-green-500/10 text-green-500 border-green-500/20'
                              : 'bg-primary/10 text-primary border-primary/20 animate-pulse'
                          }`}>
                            {order.paymentStatus}
                          </span>
                        </div>

                        {order.paymentStatus === 'PENDING' && (
                          <button
                            onClick={() => handleMarkAsPaid(order._id)}
                            className="bg-primary text-on-primary hover:opacity-90 px-3.5 py-2 rounded-xl font-label-caps text-[11px] uppercase tracking-wider font-bold transition-all cursor-pointer inline-flex items-center gap-1 shadow-md hover:shadow-primary/20"
                          >
                            <span className="material-symbols-outlined text-[13px]">check</span>
                            Verify Paid
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
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

      {/* New Order Toast */}
      <AnimatePresence>
        {newOrderToast && (
          <motion.div
            initial={{ opacity: 0, y: -30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] bg-primary text-on-primary px-5 py-2.5 rounded-xl shadow-lg font-title-sm text-sm flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-base">notifications_active</span>
            {newOrderToast}
          </motion.div>
        )}
      </AnimatePresence>
      
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

      {/* SideNavBar — hidden in kitchen mode */}
      {!isKitchenMode && (
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
                await fetch(API_BASE + '/api/auth/logout', { method: 'POST', credentials: 'include' });
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
      )}

      {/* Main Content Area */}
      <div className={`flex-1 ${isKitchenMode ? 'ml-0' : 'md:ml-[280px]'} flex flex-col h-screen overflow-hidden`}>
        {/* TopAppBar — hidden in kitchen mode, replaced by minimal KDS toolbar */}
        {isKitchenMode ? (
          <header className="w-full h-14 sticky top-0 bg-surface-container/90 backdrop-blur-md flex justify-between items-center px-4 md:px-6 z-40 transition-colors border-b border-outline-variant/20">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>monitor_heart</span>
              <h2 className="font-headline-sm text-primary font-bold">Kitchen Display</h2>
              <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-error animate-pulse'}`} title={wsConnected ? 'Live' : 'Disconnected'} />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={toggleKdsSound} className="flex items-center gap-1 text-on-surface-variant hover:text-primary transition-all px-2 py-1.5 rounded-lg hover:bg-primary/10 cursor-pointer" title={kdsSoundEnabled ? 'Sound On' : 'Sound Off'}>
                <span className="material-symbols-outlined text-lg">{kdsSoundEnabled ? 'volume_up' : 'volume_off'}</span>
                <span className="text-[10px] font-label-caps uppercase tracking-wider font-semibold hidden sm:inline">{kdsSoundEnabled ? 'Sound On' : 'Sound Off'}</span>
              </button>
              <button onClick={handleThemeToggle} className="text-on-surface-variant hover:text-primary transition-all cursor-pointer p-1.5 rounded-lg hover:bg-primary/10">
                <span className="material-symbols-outlined text-lg">{isDark ? 'light_mode' : 'dark_mode'}</span>
              </button>
              <button onClick={toggleKitchenMode} className="flex items-center gap-1 bg-primary/10 hover:bg-primary text-primary hover:text-on-primary border border-primary/30 px-3 py-1.5 rounded-xl font-label-caps text-[10px] uppercase tracking-wider font-bold transition-all cursor-pointer">
                <span className="material-symbols-outlined text-sm">fullscreen_exit</span>
                Exit Kitchen Mode
              </button>
            </div>
          </header>
        ) : (
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
        )}

        {/* Dynamic Content */}
        <main className="flex-1 p-margin-mobile md:p-margin-desktop overflow-y-auto pb-24 md:pb-8 relative z-10">
          {activeTab === 'dashboard' && (
            <div ref={kdsContainerRef} className={`flex flex-col md:flex-row gap-gutter ${isKitchenMode ? 'h-full' : 'h-auto md:h-full'} md:min-w-[900px]`}>
              {/* KDS Header Controls — only shown when NOT in kitchen mode (kitchen mode has its own toolbar) */}
              {!isKitchenMode && (
                <div className="w-full flex items-center justify-end gap-2 pb-2 md:hidden-force" style={{ position: 'absolute', top: -4, right: 0, zIndex: 5 }}>
                </div>
              )}
              {/* Column 1: New Orders */}
              <section className="flex-1 min-h-[400px] md:min-h-0 flex flex-col bg-surface/50 rounded-xl border border-outline-variant/20 overflow-hidden stagger-1">
                <div className="p-4 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-low">
                  <h3 className="font-title-md text-title-md text-on-surface flex items-center gap-2">
                    New
                    <span className="bg-error/20 text-error font-mono-data text-mono-data px-2 py-0.5 rounded-full">{newOrders.length}</span>
                  </h3>
                  {/* Kitchen mode + sound buttons in first column header */}
                  {!isKitchenMode && (
                    <div className="flex items-center gap-1">
                      <button onClick={toggleKdsSound} className="flex items-center gap-1 text-on-surface-variant hover:text-primary transition-all px-1.5 py-1 rounded-lg hover:bg-primary/10 cursor-pointer" title={kdsSoundEnabled ? 'Sound On' : 'Sound Off'}>
                        <span className="material-symbols-outlined text-[16px]">{kdsSoundEnabled ? 'volume_up' : 'volume_off'}</span>
                      </button>
                      <button onClick={toggleKitchenMode} className="flex items-center gap-1 text-on-surface-variant hover:text-primary transition-all px-1.5 py-1 rounded-lg hover:bg-primary/10 cursor-pointer" title="Enter Kitchen Mode">
                        <span className="material-symbols-outlined text-[16px]">fullscreen</span>
                      </button>
                    </div>
                  )}
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
                    <AnimatePresence mode="popLayout">
                      {newOrders.map(renderKDSCard)}
                    </AnimatePresence>
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
                    <AnimatePresence mode="popLayout">
                      {preparingOrders.map(renderKDSCard)}
                    </AnimatePresence>
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
                    <AnimatePresence mode="popLayout">
                      {readyOrders.map(renderKDSCard)}
                    </AnimatePresence>
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
          {activeTab === 'analytics' && <Analytics />}

          {activeTab !== 'dashboard' && activeTab !== 'tables' && activeTab !== 'menu' && activeTab !== 'settings' && activeTab !== 'scanner' && activeTab !== 'payments' && activeTab !== 'analytics' && (
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

      {/* Mobile Drawer Navigation — hidden in kitchen mode */}
      <AnimatePresence>
        {isMobileMenuOpen && !isKitchenMode && (
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
                      await fetch(API_BASE + '/api/auth/logout', { method: 'POST', credentials: 'include' });
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


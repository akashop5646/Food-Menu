import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import TablesAndQR from './TablesAndQR';
import MenuManager from './MenuManager';
import Settings from './Settings';
import { API_BASE, getWebSocketUrl } from '../config';
import OrderScanner from './OrderScanner';
import Analytics from './Analytics';
// Money formatting and numeric extraction helpers
const getFoodSubtotal = (order) => {
  const val = parseFloat(order?.total);
  return isFinite(val) ? val : 0;
};

const getConvenienceFee = (order) => {
  const val = parseFloat(order?.convenienceFee);
  return isFinite(val) ? val : 0;
};

const getCustomerPaidAmount = (order) => {
  if (!order) return 0;
  const rawAmount = order.totalPayable ?? order.total;
  const amount = parseFloat(rawAmount);
  return isFinite(amount) ? amount : 0;
};

// Safe date helpers
const getPaymentDate = (order) => {
  if (!order) return null;
  const isPaid = order.paymentStatus === 'PAID';
  const rawDate = (isPaid && order.paidAt) ? order.paidAt : order.createdAt;
  if (!rawDate) return null;
  const d = new Date(rawDate);
  return isNaN(d.getTime()) ? null : d;
};

const getLocalISODateString = (date) => {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - (offset * 60 * 1000));
  return localDate.toISOString().split('T')[0];
};

const getDateRangeBounds = (range, customStart, customEnd) => {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  switch (range) {
    case 'today':
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case 'yesterday':
      start.setDate(now.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(now.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      break;
    case '7d':
      start.setDate(now.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case '30d':
      start.setDate(now.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case 'this_month':
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case 'custom':
      if (customStart) {
        const dStart = new Date(customStart);
        dStart.setHours(0, 0, 0, 0);
        start.setTime(dStart.getTime());
      } else {
        start.setHours(0, 0, 0, 0);
      }
      if (customEnd) {
        const dEnd = new Date(customEnd);
        dEnd.setHours(23, 59, 59, 999);
        end.setTime(dEnd.getTime());
      } else {
        end.setHours(23, 59, 59, 999);
      }
      break;
    default:
      start.setDate(now.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
  }
  return { start, end };
};

const isOrderWithinRange = (order, start, end) => {
  const pDate = getPaymentDate(order);
  if (!pDate) return false;
  return pDate >= start && pDate <= end;
};

const calculateGrowth = (current, previous) => {
  if (previous === 0) {
    return current > 0 ? { label: 'New activity', type: 'new' } : { label: 'No change', type: 'none' };
  }
  const pct = ((current - previous) / previous) * 100;
  return {
    label: `${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct).toFixed(1)}% vs yesterday`,
    type: pct >= 0 ? 'up' : 'down'
  };
};

const renderPaymentMethodBadge = (type) => {
  const t = type || 'UNKNOWN';
  let label = 'Method';
  let style = 'bg-surface-container-high border-outline-variant/30 text-on-surface-variant/80';

  if (t === 'RAZORPAY' || t === 'ONLINE' || t === 'NOW') {
    label = 'Razorpay';
    style = 'bg-primary/10 border-primary/20 text-primary';
  } else if (t === 'LATER') {
    label = 'Pay Later';
    style = 'bg-yellow-500/10 border-yellow-500/20 text-yellow-600 dark:text-yellow-400';
  } else if (t === 'UPI') {
    label = 'UPI';
    style = 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400';
  } else {
    label = t;
  }

  return (
    <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${style}`}>
      {label}
    </span>
  );
};

const renderPaymentStatusBadge = (status) => {
  const isPaid = status === 'PAID';
  const style = isPaid 
    ? 'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400' 
    : 'bg-primary/10 border-primary/20 text-primary animate-pulse';
  return (
    <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${style}`}>
      {status || 'PENDING'}
    </span>
  );
};

const getItemSummary = (items) => {
  if (!items || items.length === 0) return 'No items';
  const firstItems = items.slice(0, 2);
  const formatted = firstItems.map(item => `${item.quantity}× ${item.name || 'Item'}`).join(', ');
  if (items.length > 2) {
    const remaining = items.length - 2;
    return `${formatted} +${remaining} more`;
  }
  return formatted;
};

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
  
  // Custom states and refs for upgraded Payments Dashboard
  const [paymentsTimeRange, setPaymentsTimeRange] = useState('7d'); // today, yesterday, 7d, 30d, this_month, custom
  const [paymentsCustomStartDate, setPaymentsCustomStartDate] = useState(() => getLocalISODateString(new Date()));
  const [paymentsCustomEndDate, setPaymentsCustomEndDate] = useState(() => getLocalISODateString(new Date()));
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [paymentsLastFetchedAt, setPaymentsLastFetchedAt] = useState(new Date());
  const [paymentsError, setPaymentsError] = useState(false);
  const [isPaymentsRefreshing, setIsPaymentsRefreshing] = useState(false);
  const [copyStatus, setCopyStatus] = useState({});

  const paymentsRequestIdRef = useRef(0);
  const paymentsInFlightRef = useRef(false);
  const paymentsAbortControllerRef = useRef(null);

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

  // Fetch Payment orders (concurrency-hardened)
  const fetchAllOrders = useCallback(async (isManual = false) => {
    if (paymentsInFlightRef.current) {
      return; // Skip if already fetching
    }

    paymentsInFlightRef.current = true;
    if (isManual) {
      setIsPaymentsRefreshing(true);
    } else {
      setPaymentsLoading(true);
    }

    paymentsRequestIdRef.current += 1;
    const requestId = paymentsRequestIdRef.current;

    // Abort previous incomplete request if starting a manual refresh
    if (isManual && paymentsAbortControllerRef.current) {
      paymentsAbortControllerRef.current.abort();
    }

    const controller = new AbortController();
    paymentsAbortControllerRef.current = controller;

    try {
      const res = await fetch(API_BASE + '/api/orders', {
        credentials: 'include',
        signal: controller.signal
      });
      if (res.ok) {
        const data = await res.json();
        if (paymentsRequestIdRef.current === requestId) {
          setPaymentOrders(data);
          setPaymentsLastFetchedAt(new Date());
          setPaymentsError(false);
        }
      } else {
        if (paymentsRequestIdRef.current === requestId) {
          setPaymentsError(true);
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error(e);
        if (paymentsRequestIdRef.current === requestId) {
          setPaymentsError(true);
        }
      }
    } finally {
      if (paymentsRequestIdRef.current === requestId) {
        paymentsInFlightRef.current = false;
        setPaymentsLoading(false);
        setIsPaymentsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'dashboard') {
      fetchActiveOrders();
    }
  }, [activeTab, refreshKey]);

  useEffect(() => {
    if (activeTab === 'payments') {
      fetchAllOrders(false);
    }
  }, [activeTab, refreshKey, fetchAllOrders]);

  // Cleanup payment requests on unmount
  useEffect(() => {
    return () => {
      if (paymentsAbortControllerRef.current) {
        paymentsAbortControllerRef.current.abort();
      }
    };
  }, []);

  // Payments freshness display tick (30s)
  const [secondsSincePaymentsUpdate, setSecondsSincePaymentsUpdate] = useState(0);
  useEffect(() => {
    setSecondsSincePaymentsUpdate(0);
    const timer = setInterval(() => {
      setSecondsSincePaymentsUpdate(prev => prev + 30);
    }, 30000);
    return () => clearInterval(timer);
  }, [paymentsLastFetchedAt]);

  // selectedOrder derived from selectedOrderId in real-time
  const selectedOrder = useMemo(() => {
    if (!selectedOrderId) return null;
    return paymentOrders.find(o => o._id === selectedOrderId) || null;
  }, [selectedOrderId, paymentOrders]);

  // Drawer accessibility & scroll lock
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setSelectedOrderId(null);
      }
    };
    if (selectedOrderId) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [selectedOrderId]);

  const handleCopy = useCallback((text, key) => {
    if (!text) return;
    navigator.clipboard.writeText(text)
      .then(() => {
        setCopyStatus(prev => ({ ...prev, [key]: true }));
        setTimeout(() => {
          setCopyStatus(prev => ({ ...prev, [key]: false }));
        }, 2000);
      })
      .catch(err => console.error('Failed to copy text:', err));
  }, []);

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
  
  // Payments pipeline calculations
  const dateBounds = useMemo(() => {
    return getDateRangeBounds(paymentsTimeRange, paymentsCustomStartDate, paymentsCustomEndDate);
  }, [paymentsTimeRange, paymentsCustomStartDate, paymentsCustomEndDate]);

  // Centralized filter pipeline
  const filteredPaymentOrders = useMemo(() => {
    // If custom range is invalid, return empty array to prevent misleading results
    if (paymentsTimeRange === 'custom') {
      const start = new Date(paymentsCustomStartDate);
      const end = new Date(paymentsCustomEndDate);
      if (start > end) {
        return [];
      }
    }

    const { start, end } = dateBounds;

    return paymentOrders.filter(order => {
      // 1. Date Range Filter
      if (!isOrderWithinRange(order, start, end)) {
        return false;
      }

      // 2. Status Filter
      if (paymentsStatusFilter !== 'ALL' && order.paymentStatus !== paymentsStatusFilter) {
        return false;
      }

      // 3. Payment Method Filter
      if (paymentsTypeFilter !== 'ALL') {
        const type = order.paymentType || 'UNKNOWN';
        let normalizedType = 'UNKNOWN';
        if (type === 'RAZORPAY' || type === 'ONLINE' || type === 'NOW') {
          normalizedType = 'RAZORPAY';
        } else if (type === 'LATER') {
          normalizedType = 'LATER';
        } else if (type === 'UPI') {
          normalizedType = 'UPI';
        }
        if (normalizedType !== paymentsTypeFilter) {
          return false;
        }
      }

      // 4. Case-insensitive Search Filter
      if (paymentsSearch) {
        const query = paymentsSearch.toLowerCase().trim();
        const shortId = order._id.toString().substring(18).toLowerCase();
        const fullId = order._id.toString().toLowerCase();
        const rzpPayId = (order.razorpayPaymentId || '').toLowerCase();
        const rzpOrdId = (order.razorpayOrderId || '').toLowerCase();
        const table = (order.table || '').toLowerCase();
        const items = order.items.map(item => `${item.quantity}x ${item.name}`).join(', ').toLowerCase();
        const method = (order.paymentType || '').toLowerCase();
        const status = (order.paymentStatus || '').toLowerCase();

        const matchesQuery = 
          shortId.includes(query) ||
          fullId.includes(query) ||
          rzpPayId.includes(query) ||
          rzpOrdId.includes(query) ||
          table.includes(query) ||
          items.includes(query) ||
          method.includes(query) ||
          status.includes(query);

        if (!matchesQuery) {
          return false;
        }
      }

      return true;
    });
  }, [paymentOrders, dateBounds, paymentsStatusFilter, paymentsTypeFilter, paymentsSearch, paymentsTimeRange, paymentsCustomStartDate, paymentsCustomEndDate]);

  // Pagination states
  const ITEMS_PER_PAGE = 25;
  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredPaymentOrders.length / ITEMS_PER_PAGE));
  }, [filteredPaymentOrders]);

  // Clamp paymentsPage if it exceeds totalPages
  useEffect(() => {
    if (paymentsPage > totalPages) {
      setPaymentsPage(totalPages);
    }
  }, [totalPages, paymentsPage]);

  // Reset pagination to page 1 on filter/search changes
  useEffect(() => {
    setPaymentsPage(1);
  }, [paymentsSearch, paymentsTimeRange, paymentsCustomStartDate, paymentsCustomEndDate, paymentsStatusFilter, paymentsTypeFilter]);

  const paginatedPaymentRows = useMemo(() => {
    const startIndex = (paymentsPage - 1) * ITEMS_PER_PAGE;
    return filteredPaymentOrders.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredPaymentOrders, paymentsPage]);

  // Payments summary card calculations
  const paymentsSummary = useMemo(() => {
    const todayBounds = getDateRangeBounds('today');
    const yesterdayBounds = getDateRangeBounds('yesterday');

    let todaySales = 0;
    let yesterdaySales = 0;
    let paidCount = 0;
    let pendingCount = 0;
    let onlineCount = 0;

    const { start, end } = dateBounds;

    paymentOrders.forEach(order => {
      const isPaid = order.paymentStatus === 'PAID';
      const isPending = order.paymentStatus === 'PENDING';

      // Today's Food Sales (paid and within today)
      if (isPaid && isOrderWithinRange(order, todayBounds.start, todayBounds.end)) {
        todaySales += getFoodSubtotal(order);
      }

      // Yesterday's Food Sales (paid and within yesterday)
      if (isPaid && isOrderWithinRange(order, yesterdayBounds.start, yesterdayBounds.end)) {
        yesterdaySales += getFoodSubtotal(order);
      }

      // Metric counts based on selected date range:
      if (isOrderWithinRange(order, start, end)) {
        if (isPaid) {
          paidCount += 1;

          const type = order.paymentType || '';
          if (type === 'RAZORPAY' || type === 'ONLINE' || type === 'NOW') {
            onlineCount += 1;
          }
        }
        if (isPending) {
          pendingCount += 1;
        }
      }
    });

    const growth = calculateGrowth(todaySales, yesterdaySales);

    return {
      todaySales,
      growth,
      paidCount,
      pendingCount,
      onlineCount
    };
  }, [paymentOrders, dateBounds]);

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
    // Check if initial loading (fetching data and we have no cached data yet)
    const showInitialLoading = paymentsLoading && paymentOrders.length === 0;

    // Helper to render skeleton rows
    const renderSkeletons = () => {
      return Array.from({ length: 8 }).map((_, i) => (
        <tr key={i} className="animate-pulse border-b border-outline-variant/10">
          <td className="py-4 px-4"><div className="h-4 bg-outline-variant/20 rounded w-16" /></td>
          <td className="py-4 px-4"><div className="h-4 bg-outline-variant/20 rounded w-24" /></td>
          <td className="py-4 px-4"><div className="h-4 bg-outline-variant/20 rounded w-20" /></td>
          <td className="py-4 px-4"><div className="h-4 bg-outline-variant/20 rounded w-48" /></td>
          <td className="py-4 px-4"><div className="h-4 bg-outline-variant/20 rounded w-16" /></td>
          <td className="py-4 px-4"><div className="h-4 bg-outline-variant/20 rounded w-20" /></td>
          <td className="py-4 px-4"><div className="h-4 bg-outline-variant/20 rounded w-16" /></td>
          <td className="py-4 px-4 text-right"><div className="h-8 bg-outline-variant/20 rounded w-24 ml-auto" /></td>
        </tr>
      ));
    };

    // Helper to render mobile card skeletons
    const renderMobileSkeletons = () => {
      return Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="animate-pulse bg-surface-container-low border border-outline-variant/20 rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex justify-between">
            <div className="h-5 bg-outline-variant/20 rounded w-32" />
            <div className="h-5 bg-outline-variant/20 rounded w-16" />
          </div>
          <div className="h-10 bg-outline-variant/20 rounded w-full" />
          <div className="flex justify-between mt-2">
            <div className="h-5 bg-outline-variant/20 rounded w-20" />
            <div className="h-8 bg-outline-variant/20 rounded w-24" />
          </div>
        </div>
      ));
    };

    // Helper for display tick Counter text
    const getFreshnessText = () => {
      if (secondsSincePaymentsUpdate < 30) {
        return 'Updated just now';
      }
      if (secondsSincePaymentsUpdate < 60) {
        return 'Updated 30 seconds ago';
      }
      const mins = Math.floor(secondsSincePaymentsUpdate / 60);
      return `Updated ${mins} minute${mins > 1 ? 's' : ''} ago`;
    };

    return (
      <div className="space-y-6">
        <style>{`
          @keyframes slideIn {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }
          .animate-slide-in {
            animation: slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }
        `}</style>

        {/* Header Section */}
        <div className="bg-surface-container rounded-2xl border border-outline-variant/20 shadow-lg overflow-hidden">
          <div className="p-6 md:p-8 border-b border-outline-variant/10 flex flex-col md:flex-row justify-between md:items-center gap-4 bg-surface-container-low">
            <div>
              <h2 className="font-headline-md text-2xl text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">payments</span>
                Payments Dashboard
              </h2>
              <p className="font-body-md text-on-surface-variant mt-1">
                Verify customer transactions and manage payments.
              </p>
            </div>

            {/* Freshness indicator and manual refresh button */}
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs text-on-surface-variant/70 font-semibold flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                {getFreshnessText()}
              </span>
              <button
                onClick={() => fetchAllOrders(true)}
                disabled={isPaymentsRefreshing}
                aria-label="Refresh payments data"
                className="bg-primary/10 hover:bg-primary text-primary hover:text-on-primary border border-primary/30 px-3 py-1.5 rounded-xl font-semibold text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1"
              >
                <span className={`material-symbols-outlined text-sm ${isPaymentsRefreshing ? 'animate-spin' : ''}`}>
                  refresh
                </span>
                {isPaymentsRefreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>

          {/* Retry banner on fail */}
          {paymentsError && (
            <div className="mx-6 md:mx-8 mt-4 bg-error/10 border border-error/20 text-error px-4 py-3 rounded-xl flex items-center justify-between text-xs font-semibold">
              <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-base">error</span>
                Failed to fetch live updates. Displaying cached dashboard data.
              </span>
              <button
                onClick={() => fetchAllOrders(true)}
                className="bg-error/20 hover:bg-error/30 text-error border border-error/30 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          {/* Payment Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 px-6 md:px-8 pt-6 pb-2">
            {/* Card 1: Today's Food Sales */}
            <div className="bg-surface-container-low border border-outline-variant/10 rounded-2xl p-4 flex flex-col justify-between shadow-sm">
              <div>
                <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block font-semibold">Today's Food Sales</span>
                <span className="font-price-display text-primary font-bold text-2xl mt-1 block">
                  ₹{paymentsSummary.todaySales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-1">
                {paymentsSummary.growth.type === 'up' && (
                  <span className="material-symbols-outlined text-green-500 text-sm">trending_up</span>
                )}
                {paymentsSummary.growth.type === 'down' && (
                  <span className="material-symbols-outlined text-error text-sm">trending_down</span>
                )}
                <span className={`text-xs font-semibold ${
                  paymentsSummary.growth.type === 'up' ? 'text-green-500' :
                  paymentsSummary.growth.type === 'down' ? 'text-error' : 'text-on-surface-variant/60'
                }`}>
                  {paymentsSummary.growth.label}
                </span>
              </div>
            </div>

            {/* Card 2: Paid Orders */}
            <div className="bg-surface-container-low border border-outline-variant/10 rounded-2xl p-4 flex flex-col justify-between shadow-sm">
              <div>
                <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block font-semibold">Paid Orders</span>
                <span className="text-on-surface font-bold text-2xl mt-1 block">
                  {paymentsSummary.paidCount}
                </span>
              </div>
              <div className="text-xs text-on-surface-variant/60 mt-2 font-medium">
                In selected range
              </div>
            </div>

            {/* Card 3: Pending Payments */}
            <div className="bg-surface-container-low border border-outline-variant/10 rounded-2xl p-4 flex flex-col justify-between shadow-sm">
              <div>
                <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block font-semibold">Pending Payments</span>
                <span className="text-on-surface font-bold text-2xl mt-1 block">
                  {paymentsSummary.pendingCount}
                </span>
              </div>
              <div className="text-xs text-on-surface-variant/60 mt-2 font-medium">
                In selected range
              </div>
            </div>

            {/* Card 4: Online Payments */}
            <div className="bg-surface-container-low border border-outline-variant/10 rounded-2xl p-4 flex flex-col justify-between shadow-sm">
              <div>
                <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block font-semibold">Online Payments</span>
                <span className="text-on-surface font-bold text-2xl mt-1 block">
                  {paymentsSummary.onlineCount}
                </span>
              </div>
              <div className="text-xs text-on-surface-variant/60 mt-2 font-medium">
                In selected range
              </div>
            </div>
          </div>

          {/* Search and Filters Toolbar */}
          <div className="px-6 md:px-8 py-4 bg-surface-container-low border-b border-t border-outline-variant/10 flex flex-wrap gap-4 items-center mt-4">
            {/* Search bar */}
            <div className="relative min-w-[240px] flex-1">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/70 text-sm">search</span>
              <input 
                type="text" 
                placeholder="Search ID, table, items, payment..." 
                value={paymentsSearch}
                onChange={(e) => setPaymentsSearch(e.target.value)}
                className="w-full bg-surface-container-lowest border border-outline-variant/30 text-on-surface pl-9 pr-4 py-2 rounded-xl focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors font-body-md text-sm placeholder-on-surface-variant/40"
              />
              {paymentsSearch && (
                <button onClick={() => setPaymentsSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant/70 hover:text-on-surface flex items-center cursor-pointer">
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
                    className={`px-3 py-1.5 rounded-lg text-xs font-label-caps uppercase tracking-wider font-semibold transition-all cursor-pointer ${
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
                    className={`px-3 py-1.5 rounded-lg text-xs font-label-caps uppercase tracking-wider font-semibold transition-all cursor-pointer ${
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

            {/* Date Preset Selection */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest font-semibold">Range:</span>
              <div className="flex flex-wrap bg-surface-container-highest/40 rounded-xl p-0.5 border border-outline-variant/20 gap-0.5">
                {[
                  { value: 'today', label: 'Today' },
                  { value: 'yesterday', label: 'Yesterday' },
                  { value: '7d', label: '7D' },
                  { value: '30d', label: '30D' },
                  { value: 'this_month', label: 'Month' },
                  { value: 'custom', label: 'Custom' }
                ].map(preset => (
                  <button
                    key={preset.value}
                    onClick={() => setPaymentsTimeRange(preset.value)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      paymentsTimeRange === preset.value
                        ? 'bg-primary text-on-primary shadow-sm'
                        : 'text-on-surface-variant/80 hover:text-on-surface'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Custom Date Picker Inputs */}
          {paymentsTimeRange === 'custom' && (
            <div className="px-6 md:px-8 py-3 bg-surface-container-low border-b border-outline-variant/10 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label htmlFor="custom-start-date" className="text-xs font-semibold text-on-surface-variant">Start:</label>
                <input
                  id="custom-start-date"
                  type="date"
                  value={paymentsCustomStartDate}
                  onChange={(e) => setPaymentsCustomStartDate(e.target.value)}
                  className="bg-surface-container-lowest border border-outline-variant/30 text-on-surface px-3 py-1 rounded-lg text-xs outline-none focus:border-primary"
                />
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="custom-end-date" className="text-xs font-semibold text-on-surface-variant">End:</label>
                <input
                  id="custom-end-date"
                  type="date"
                  value={paymentsCustomEndDate}
                  onChange={(e) => setPaymentsCustomEndDate(e.target.value)}
                  className="bg-surface-container-lowest border border-outline-variant/30 text-on-surface px-3 py-1 rounded-lg text-xs outline-none focus:border-primary"
                />
              </div>
              {new Date(paymentsCustomStartDate) > new Date(paymentsCustomEndDate) && (
                <span className="text-xs text-error font-medium flex items-center gap-1 animate-pulse">
                  <span className="material-symbols-outlined text-sm">warning</span>
                  Start date cannot be after end date
                </span>
              )}
            </div>
          )}

          {/* Payments List / Table Container */}
          <div className="p-6 md:p-8 overflow-x-auto">
            {showInitialLoading ? (
              // Initial Loading view (Skeletons)
              <div className="hidden md:block">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant/20 text-on-surface-variant font-label-caps text-[11px] uppercase tracking-widest bg-surface-container-lowest/50">
                      <th className="py-3 px-4">Order ID</th>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Table</th>
                      <th className="py-3 px-4">Items Summary</th>
                      <th className="py-3 px-4">Amount</th>
                      <th className="py-3 px-4">Payment Method</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {renderSkeletons()}
                  </tbody>
                </table>
              </div>
            ) : paymentOrders.length === 0 ? (
              // Empty state: No records in DB
              <div className="text-center py-16 text-on-surface-variant/60 flex flex-col items-center gap-2">
                <span className="material-symbols-outlined text-5xl">receipt</span>
                <p className="font-title-md">No payment records yet</p>
                <p className="font-body-sm">Payment records will appear after customer orders are created.</p>
              </div>
            ) : filteredPaymentOrders.length === 0 ? (
              // Empty state: Filter returned nothing
              <div className="text-center py-16 text-on-surface-variant/60 flex flex-col items-center gap-2">
                <span className="material-symbols-outlined text-5xl">search_off</span>
                <p className="font-title-md">No matching payments</p>
                <p className="font-body-sm">Try changing the date range, filters, or search terms.</p>
              </div>
            ) : paymentsStatusFilter === 'PENDING' && filteredPaymentOrders.length === 0 ? (
              // Empty state: No pending orders
              <div className="text-center py-16 text-on-surface-variant/60 flex flex-col items-center gap-2">
                <span className="material-symbols-outlined text-5xl">check_circle</span>
                <p className="font-title-md">No pending payments</p>
                <p className="font-body-sm">All visible payments are currently resolved.</p>
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
                        <th className="py-3 px-4">Customer Paid</th>
                        <th className="py-3 px-4">Payment Method</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/10">
                      {paginatedPaymentRows.map((order) => {
                        const payDate = getPaymentDate(order);
                        const dateStr = payDate ? payDate.toLocaleString(undefined, {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        }) : 'N/A';
                        const itemsSummary = getItemSummary(order.items);
                        const itemsText = order.items.map(item => `${item.quantity}x ${item.name}`).join(', ');

                        const foodTotal = getFoodSubtotal(order);
                        const fee = getConvenienceFee(order);
                        const totalPaid = getCustomerPaidAmount(order);
                        
                        return (
                          <tr 
                            key={order._id} 
                            tabIndex={0}
                            onClick={() => setSelectedOrderId(order._id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelectedOrderId(order._id);
                              }
                            }}
                            className="hover:bg-surface-container-lowest/30 transition-colors cursor-pointer focus:bg-surface-container-lowest/40 focus:outline-none"
                          >
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
                            <td className="py-3.5 px-4 max-w-xs truncate text-on-surface-variant" title={itemsText}>{itemsSummary}</td>
                            <td className="py-3.5 px-4">
                              <div className="flex flex-col">
                                <span className="font-price-display text-primary font-bold">₹{totalPaid.toFixed(2)}</span>
                                {fee > 0 && (
                                  <span className="text-[10px] text-on-surface-variant/70 block mt-0.5">
                                    Food ₹{foodTotal.toFixed(0)} · Fee ₹{fee.toFixed(0)}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
                              {renderPaymentMethodBadge(order.paymentType)}
                            </td>
                            <td className="py-3.5 px-4">
                              {renderPaymentStatusBadge(order.paymentStatus)}
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedOrderId(order._id);
                                  }}
                                  className="text-on-surface-variant hover:text-primary transition-all p-1.5 hover:bg-surface-container-high rounded-lg cursor-pointer"
                                  aria-label="View payment details"
                                >
                                  <span className="material-symbols-outlined text-base">visibility</span>
                                </button>
                                {order.paymentStatus === 'PENDING' && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleMarkAsPaid(order._id);
                                    }}
                                    className="bg-primary/10 hover:bg-primary text-primary hover:text-on-primary border border-primary/30 px-3 py-1.5 rounded-lg font-label-caps text-[10px] uppercase tracking-wider transition-all cursor-pointer font-semibold inline-flex items-center gap-1"
                                  >
                                    <span className="material-symbols-outlined text-[12px]">check</span>
                                    Verify Paid
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card List View */}
                <div className="block md:hidden space-y-4">
                  {showInitialLoading ? renderMobileSkeletons() : paginatedPaymentRows.map((order) => {
                    const payDate = getPaymentDate(order);
                    const dateStr = payDate ? payDate.toLocaleString(undefined, {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                    }) : 'N/A';
                    const itemsSummary = getItemSummary(order.items);
                    const itemsText = order.items.map(item => `${item.quantity}x ${item.name}`).join(', ');

                    const totalPaid = getCustomerPaidAmount(order);
                    const foodTotal = getFoodSubtotal(order);
                    const fee = getConvenienceFee(order);
                    
                    return (
                      <div 
                        key={order._id} 
                        tabIndex={0}
                        onClick={() => setSelectedOrderId(order._id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedOrderId(order._id);
                          }
                        }}
                        className="bg-surface-container-low border border-outline-variant/20 rounded-2xl p-4 flex flex-col gap-3 shadow-md cursor-pointer hover:bg-surface-container-highest/20 transition-all focus:bg-surface-container-highest/20 focus:outline-none"
                      >
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
                            <span className="font-price-display text-primary font-bold text-base mt-0.5 block">₹{totalPaid.toFixed(2)}</span>
                            {fee > 0 && (
                              <span className="text-[9px] text-on-surface-variant/60 block mt-0.5">
                                Food ₹{foodTotal.toFixed(0)} · Fee ₹{fee.toFixed(0)}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="bg-surface-container-lowest/60 border border-outline-variant/10 rounded-xl p-2.5 text-xs text-on-surface-variant/80">
                          <strong className="text-on-surface font-semibold block mb-1">Items Summary:</strong>
                          <div className="line-clamp-2 leading-relaxed" title={itemsText}>{itemsSummary}</div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-outline-variant/10">
                          <div className="flex gap-1.5 items-center">
                            {renderPaymentMethodBadge(order.paymentType)}
                            {renderPaymentStatusBadge(order.paymentStatus)}
                          </div>

                          <div className="flex gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedOrderId(order._id);
                              }}
                              className="text-on-surface-variant hover:text-primary transition-all p-1.5 hover:bg-surface-container-high rounded-lg cursor-pointer flex items-center justify-center border border-outline-variant/20 bg-surface-container-lowest"
                              aria-label="View payment details"
                            >
                              <span className="material-symbols-outlined text-sm">visibility</span>
                            </button>
                            {order.paymentStatus === 'PENDING' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMarkAsPaid(order._id);
                                }}
                                className="bg-primary text-on-primary hover:opacity-90 px-3.5 py-2 rounded-xl font-label-caps text-[11px] uppercase tracking-wider font-bold transition-all cursor-pointer inline-flex items-center gap-1 shadow-md hover:shadow-primary/20"
                              >
                                <span className="material-symbols-outlined text-[13px]">check</span>
                                Verify Paid
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination Controls */}
                <div className="px-6 md:px-8 py-4 border-t border-outline-variant/10 flex items-center justify-between gap-4 bg-surface-container-low mt-4 rounded-b-2xl">
                  <span className="text-xs text-on-surface-variant font-semibold">
                    Page {paymentsPage} of {totalPages} ({filteredPaymentOrders.length} records)
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPaymentsPage(prev => Math.max(1, prev - 1))}
                      disabled={paymentsPage === 1}
                      className="px-3 py-1.5 rounded-xl border border-outline-variant/30 text-xs font-semibold bg-surface-container-lowest text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-0.5"
                    >
                      <span className="material-symbols-outlined text-sm">chevron_left</span>
                      Prev
                    </button>
                    <button
                      onClick={() => setPaymentsPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={paymentsPage === totalPages}
                      className="px-3 py-1.5 rounded-xl border border-outline-variant/30 text-xs font-semibold bg-surface-container-lowest text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-0.5"
                    >
                      Next
                      <span className="material-symbols-outlined text-sm">chevron_right</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right-Side Sliding Payment Details Drawer */}
        <AnimatePresence>
          {selectedOrder && (
            <>
              {/* Backdrop */}
              <div 
                onClick={() => setSelectedOrderId(null)}
                className="fixed inset-0 bg-black/50 z-50 transition-opacity"
              />

              {/* Drawer Dialog Container */}
              <div 
                role="dialog"
                aria-modal="true"
                aria-label="Payment Details"
                className="fixed top-0 right-0 h-full w-full sm:w-[460px] bg-surface-container z-[51] shadow-2xl border-l border-outline-variant/20 flex flex-col animate-slide-in"
              >
                {/* Header */}
                <div className="p-5 md:p-6 border-b border-outline-variant/10 flex items-center justify-between bg-surface-container-low">
                  <h3 className="font-headline-sm text-lg text-on-surface flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">receipt</span>
                    Order Details
                  </h3>
                  <button
                    onClick={() => setSelectedOrderId(null)}
                    aria-label="Close details"
                    className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container-high transition-colors text-on-surface-variant cursor-pointer"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-5 md:p-6 space-y-6">
                  {/* Order Information Section */}
                  <div className="space-y-4">
                    <h4 className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest font-semibold border-b border-outline-variant/10 pb-1">Order Information</h4>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block mb-0.5">Order ID</span>
                        <div className="flex items-center gap-1.5 font-mono text-primary font-bold">
                          <span>#{selectedOrder._id.toString().substring(18)}</span>
                          <button
                            onClick={() => handleCopy(selectedOrder._id.toString(), 'orderId')}
                            className="text-primary hover:opacity-85 flex items-center shrink-0 cursor-pointer"
                            aria-label="Copy Order ID"
                          >
                            <span className="material-symbols-outlined text-sm">
                              {copyStatus['orderId'] ? 'check' : 'content_copy'}
                            </span>
                            {copyStatus['orderId'] && <span className="text-[10px] ml-1 font-semibold normal-case">Copied</span>}
                          </button>
                        </div>
                      </div>

                      <div>
                        <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block mb-0.5">Table</span>
                        <span className="font-semibold text-on-surface">{selectedOrder.table} {selectedOrder.location ? `(${selectedOrder.location})` : ''}</span>
                      </div>

                      <div>
                        <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block mb-0.5">Order Date</span>
                        <span className="text-on-surface-variant">
                          {getPaymentDate(selectedOrder) ? getPaymentDate(selectedOrder).toLocaleString(undefined, {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                          }) : 'N/A'}
                        </span>
                      </div>

                      <div>
                        <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block mb-0.5">Status</span>
                        <div>{renderPaymentStatusBadge(selectedOrder.paymentStatus)}</div>
                      </div>

                      <div>
                        <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block mb-0.5">Payment Method</span>
                        <div>{renderPaymentMethodBadge(selectedOrder.paymentType)}</div>
                      </div>

                      <div>
                        <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block mb-0.5">Confirmed By</span>
                        <span className="text-on-surface font-medium">{selectedOrder.confirmedBy?.trim() || 'Staff'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Items List */}
                  <div className="space-y-3">
                    <h4 className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest font-semibold border-b border-outline-variant/10 pb-1">Items</h4>
                    <div className="space-y-2.5">
                      {selectedOrder.items.map((item, idx) => (
                        <div key={item.id || idx} className="flex justify-between items-center text-sm">
                          <span className="text-on-surface font-medium">
                            {item.quantity} × {item.name || 'Item'}
                          </span>
                          {isFinite(parseFloat(item.price)) && (
                            <span className="font-mono text-on-surface-variant">
                              ₹{(parseFloat(item.price) * item.quantity).toFixed(2)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Bill Breakdown */}
                  <div className="space-y-3 bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/10">
                    <h4 className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest font-semibold border-b border-outline-variant/10 pb-1">Bill Breakdown</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between text-on-surface-variant">
                        <span>Food Subtotal</span>
                        <span>₹{getFoodSubtotal(selectedOrder).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-on-surface-variant">
                        <span>Convenience Fee</span>
                        <span>₹{getConvenienceFee(selectedOrder).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-on-surface font-semibold pt-2 border-t border-outline-variant/15 text-base">
                        <span>Total Customer Paid</span>
                        <span className="text-primary">₹{getCustomerPaidAmount(selectedOrder).toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Razorpay IDs or Manual Info */}
                  <div className="space-y-4 pt-2">
                    {selectedOrder.paymentType === 'RAZORPAY' || selectedOrder.paymentType === 'ONLINE' || selectedOrder.paymentType === 'NOW' ? (
                      <div className="space-y-3">
                        <h4 className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest font-semibold border-b border-outline-variant/10 pb-1">Razorpay Details</h4>
                        <div className="space-y-3 text-sm">
                          <div>
                            <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block mb-0.5">Razorpay Order ID</span>
                            {selectedOrder.razorpayOrderId ? (
                              <div className="flex items-center gap-1.5 font-mono text-on-surface">
                                <span className="break-all">{selectedOrder.razorpayOrderId}</span>
                                <button
                                  onClick={() => handleCopy(selectedOrder.razorpayOrderId, 'razorpayOrderId')}
                                  className="text-primary hover:opacity-85 flex items-center shrink-0 cursor-pointer"
                                  aria-label="Copy Razorpay Order ID"
                                >
                                  <span className="material-symbols-outlined text-sm">
                                    {copyStatus['razorpayOrderId'] ? 'check' : 'content_copy'}
                                  </span>
                                  {copyStatus['razorpayOrderId'] && <span className="text-[10px] ml-1 font-semibold normal-case">Copied</span>}
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-on-surface-variant/50 italic">Not available</span>
                            )}
                          </div>

                          <div>
                            <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block mb-0.5">Razorpay Payment ID</span>
                            {selectedOrder.razorpayPaymentId ? (
                              <div className="flex items-center gap-1.5 font-mono text-on-surface">
                                <span className="break-all">{selectedOrder.razorpayPaymentId}</span>
                                <button
                                  onClick={() => handleCopy(selectedOrder.razorpayPaymentId, 'razorpayPaymentId')}
                                  className="text-primary hover:opacity-85 flex items-center shrink-0 cursor-pointer"
                                  aria-label="Copy Razorpay Payment ID"
                                >
                                  <span className="material-symbols-outlined text-sm">
                                    {copyStatus['razorpayPaymentId'] ? 'check' : 'content_copy'}
                                  </span>
                                  {copyStatus['razorpayPaymentId'] && <span className="text-[10px] ml-1 font-semibold normal-case">Copied</span>}
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-on-surface-variant/50 italic">Not available</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-primary/5 border border-primary/10 rounded-xl text-xs text-primary font-semibold flex items-center gap-2">
                        <span className="material-symbols-outlined text-sm">check_circle</span>
                        Payment verified manually
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </AnimatePresence>
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


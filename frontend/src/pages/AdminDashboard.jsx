import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import TablesAndQR from './TablesAndQR';
import MenuManager from './MenuManager';
import Settings from './Settings';
import { API_BASE, getWebSocketUrl } from '../config';
import OrderScanner from './OrderScanner';
import Analytics from './Analytics';
import LiveKDS from './LiveKDS';
import Payments from './Payments';
import SettlementMonitor from './SettlementMonitor';
import Employees from './Employees';

const SIDEBAR_ITEMS = [
  { id: 'dashboard', icon: 'monitor_heart', label: 'Live KDS', fill: true },
  { id: 'scanner', icon: 'qr_code_scanner', label: 'Order Scanner' },
  { id: 'menu', icon: 'restaurant_menu', label: 'Menu Manager' },
  { id: 'payments', icon: 'payments', label: 'Payments' },
  { id: 'tables', icon: 'grid_view', label: 'Tables & QR' },
  { id: 'analytics', icon: 'analytics', label: 'Analytics' },
  { id: 'settlements', icon: 'account_balance_wallet', label: 'Settlements', masterAdminOnly: true },
  { id: 'employees', icon: 'group', label: 'Employees', adminOnly: true },
  { id: 'settings', icon: 'settings', label: 'Settings', adminOnly: true },
];

const NOTIFICATION_STORAGE_KEY = 'aurum_admin_notifications';
const MAX_NOTIFICATIONS = 20;

function isValidNotification(notification) {
  if (!notification || typeof notification !== 'object') return false;
  if (typeof notification.id !== 'string' || !notification.id) return false;
  if (!['ORDER_CREATED', 'PAYMENT_UPDATED', 'CONNECTION_WARNING'].includes(notification.type)) return false;
  if (typeof notification.title !== 'string') return false;
  if (typeof notification.message !== 'string') return false;
  if (typeof notification.timestamp !== 'string') return false;
  if (isNaN(new Date(notification.timestamp).getTime())) return false;
  if (typeof notification.isRead !== 'boolean') return false;
  if (!['dashboard', 'payments'].includes(notification.targetSection)) return false;
  if (notification.metadata === undefined || notification.metadata === null || typeof notification.metadata !== 'object') return false;
  return true;
}

function formatNotificationTime(dateString) {
  const timestamp = new Date(dateString).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const diff = Math.max(0, Date.now() - timestamp);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

function createNotificationId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);

  const profileImage =
    typeof user?.picture === 'string' && user.picture.trim()
      ? user.picture.trim()
      : null;

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [profileImage]);

  const initials = String(user?.name || user?.email || 'U')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('') || 'U';

  // Notification center
  const [notifications, setNotifications] = useState(() => {
    try {
      const saved = localStorage.getItem(NOTIFICATION_STORAGE_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(isValidNotification)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, MAX_NOTIFICATIONS);
    } catch {
      return [];
    }
  });
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [notificationTimeTick, setNotificationTimeTick] = useState(0);
  const bellRef = useRef(null);
  const notificationPanelRef = useRef(null);
  const wasConnectedRef = useRef(false);
  const disconnectNotifiedRef = useRef(false);
  const isWebSocketCleanupRef = useRef(false);
  const processedEventIdsRef = useRef(new Set());
  const audioContextRef = useRef(null);
  const isMutedRef = useRef(false);

  const [isMuted, setIsMuted] = useState(() => {
    try { return localStorage.getItem('aurum_admin_muted') === 'true'; }
    catch { return false; }
  });

  // Real-time signals
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastOrderCreatedEvent, setLastOrderCreatedEvent] = useState(null);
  const [lastOrderUpdatedEvent, setLastOrderUpdatedEvent] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [isKitchenMode, setIsKitchenMode] = useState(false);

  const triggerRefresh = () => setRefreshKey(prev => prev + 1);

  function playNotificationSound() {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.type = 'sine';
      const now = ctx.currentTime;
      oscillator.frequency.setValueAtTime(523, now);
      oscillator.frequency.setValueAtTime(659, now + 0.1);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      oscillator.start(now);
      oscillator.stop(now + 0.3);
    } catch {
      // Audio context unavailable
    }
  }

  const addNotification = useCallback(({ type, title, message, targetSection, metadata = {} }) => {
    const id = createNotificationId();
    const notification = {
      id,
      type,
      title,
      message,
      timestamp: new Date().toISOString(),
      isRead: false,
      targetSection,
      metadata
    };
    setNotifications(prev => [notification, ...prev].slice(0, MAX_NOTIFICATIONS));
    if (!isMutedRef.current) playNotificationSound();
  }, []);

  const unreadCount = useMemo(() => notifications.filter(n => !n.isRead).length, [notifications]);

  const handleMarkAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => n.isRead ? n : { ...n, isRead: true }));
  }, []);

  const handleNotificationClick = useCallback((notification) => {
    setNotifications(prev => prev.map(n => n.id === notification.id ? { ...n, isRead: true } : n));
    setIsNotificationOpen(false);
    setActiveTab(notification.targetSection);
  }, []);

  // Setup WebSocket for real-time dashboard signals
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
          wasConnectedRef.current = true;
          disconnectNotifiedRef.current = false;
          isWebSocketCleanupRef.current = false;
        };
        
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'ORDER_CREATED' || msg.type === 'ORDER_STATUS_CHANGED' || msg.type === 'PAYMENT_UPDATED' || msg.type === 'ORDER_UPDATED') {
              triggerRefresh();
              
              // Handoff ORDER_CREATED to LiveKDS with seq/stale guards
              if (msg.type === 'ORDER_CREATED') {
                const orderId = msg.payload?._id;
                if (orderId && processedEventIdsRef.current.has(`ORDER_CREATED:${orderId}`)) return;
                if (orderId) {
                  processedEventIdsRef.current.add(`ORDER_CREATED:${orderId}`);
                  setTimeout(() => processedEventIdsRef.current.delete(`ORDER_CREATED:${orderId}`), 5000);
                }
                const tableName = msg.payload?.table || null;
                setLastOrderCreatedEvent({
                  id: orderId || Math.random().toString(),
                  timestamp: Date.now(),
                  table: tableName
                });
                const itemCount = Array.isArray(msg.payload?.items) ? msg.payload.items.length : null;
                let orderMessage;
                if (tableName && itemCount !== null) {
                  orderMessage = `${tableName} · ${itemCount} item${itemCount === 1 ? '' : 's'}`;
                } else if (tableName) {
                  orderMessage = tableName;
                } else {
                  orderMessage = 'A new customer order was received.';
                }
                addNotification({
                  type: 'ORDER_CREATED',
                  title: 'New order received',
                  message: orderMessage,
                  targetSection: 'dashboard',
                  metadata: {
                    orderId: msg.payload?._id || null,
                    table: tableName
                  }
                });
              }
              if (msg.type === 'ORDER_UPDATED') {
                const orderPayload = msg.payload || msg.order || {};
                const orderId = msg.orderId || orderPayload?._id || orderPayload?.order?._id;
                const orderData = orderPayload?.order || orderPayload;
                if (orderId) {
                  setLastOrderUpdatedEvent({
                    id: orderId,
                    timestamp: Date.now(),
                    orderId,
                    version: msg.version || orderPayload?.version || orderData?.version || 1,
                    order: orderData
                  });
                }
              }
              if (msg.type === 'PAYMENT_UPDATED') {
                const paymentOrderId = msg.payload?._id;
                if (paymentOrderId && processedEventIdsRef.current.has(`PAYMENT_UPDATED:${paymentOrderId}`)) return;
                if (paymentOrderId) {
                  processedEventIdsRef.current.add(`PAYMENT_UPDATED:${paymentOrderId}`);
                  setTimeout(() => processedEventIdsRef.current.delete(`PAYMENT_UPDATED:${paymentOrderId}`), 5000);
                }
                const tableName = msg.payload?.table || msg.payload?.order?.table || null;
                const displayStatus = msg.payload?.status === 'PAID' || msg.payload?.paymentStatus === 'PAID' ? 'paid' : 'updated';
                let paymentMessage;
                if (tableName) {
                  paymentMessage = `${tableName} · Payment marked as ${displayStatus}`;
                } else {
                  paymentMessage = 'Payment status was updated.';
                }
                addNotification({
                  type: 'PAYMENT_UPDATED',
                  title: 'Payment updated',
                  message: paymentMessage,
                  targetSection: 'payments',
                  metadata: {
                    orderId: msg.payload?._id || null,
                    table: tableName
                  }
                });
              }
            }
          } catch (e) {
            console.error('WebSocket parse error:', e);
          }
        };
        
        ws.onclose = () => {
          console.log('🔌 WebSocket connection closed. Reconnecting in 10s...');
          setWsConnected(false);
          if (wasConnectedRef.current && !disconnectNotifiedRef.current && !isWebSocketCleanupRef.current) {
            disconnectNotifiedRef.current = true;
            addNotification({
              type: 'CONNECTION_WARNING',
              title: 'Live updates disconnected',
              message: 'Real-time updates are temporarily unavailable. Automatic refresh will continue.',
              targetSection: 'dashboard',
              metadata: {}
            });
          }
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
      isWebSocketCleanupRef.current = true;
      if (ws) ws.close();
      clearTimeout(reconnectTimer);
    };
  }, []);

  // Sync isMuted to ref for stable addNotification callback
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  // Persist mute preference
  useEffect(() => {
    try { localStorage.setItem('aurum_admin_muted', isMuted ? 'true' : 'false'); }
    catch { /* storage unavailable */ }
  }, [isMuted]);

  // Persist notifications to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS)));
    } catch {
      // Storage may be unavailable, restricted, or full
    }
  }, [notifications]);

  // Update relative-time display every 60 seconds
  useEffect(() => {
    const id = window.setInterval(() => {
      setNotificationTimeTick(t => t + 1);
    }, 60000);
    return () => window.clearInterval(id);
  }, []);

  // Close notification panel on click-outside
  useEffect(() => {
    if (!isNotificationOpen) return;
    const handler = (e) => {
      if (
        notificationPanelRef.current && !notificationPanelRef.current.contains(e.target) &&
        bellRef.current && !bellRef.current.contains(e.target)
      ) {
        setIsNotificationOpen(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [isNotificationOpen]);

  // Close notification panel on Escape
  useEffect(() => {
    if (!isNotificationOpen) return;
    const handler = (e) => {
      if (e.key === 'Escape') {
        setIsNotificationOpen(false);
        bellRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isNotificationOpen]);

  // ponytail: AdminDashboard owns the sole central polling/refresh interval loop
  useEffect(() => {
    const intervalTime = wsConnected ? 30000 : 5000;
    const pollInterval = setInterval(() => {
      triggerRefresh();
    }, intervalTime);

    return () => clearInterval(pollInterval);
  }, [wsConnected]);

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

    setTimeout(() => {
      setIsDark(nextIsDark);
      localStorage.setItem('aurum_admin_theme', nextIsDark ? 'dark' : 'light');
      if (nextIsDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }, 250);
    
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
              zIndex: 9999,
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
          <ul className="flex-1 space-y-2 overflow-y-auto hide-scrollbar pr-1">
            {SIDEBAR_ITEMS.map((item) => {
              const isAdminLevel = user?.role === 'ADMIN' || user?.role === 'MASTER_ADMIN';
              if (item.adminOnly && !isAdminLevel) return null;
              if (item.masterAdminOnly && user?.role !== 'MASTER_ADMIN') return null;
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
                {profileImage && !avatarLoadFailed ? (
                  <img
                    src={profileImage}
                    alt={`${user?.name || 'User'} profile`}
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarLoadFailed(true)}
                    className="w-10 h-10 rounded-full object-cover border border-[#e3ebe8]/50 dark:border-outline-variant/10"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[#e2edea] dark:bg-teal-950/40 text-[#1b7c83] dark:text-teal-400 flex items-center justify-center font-display-md text-title-md font-bold">
                    {initials}
                  </div>
                )}
                <div className="flex flex-col">
                  <span className="font-title-sm text-[#121317] dark:text-on-surface font-semibold text-sm leading-tight">
                    {user?.name || 'NupurStaff'}
                  </span>
                  <span className="text-[12px] text-[#6d8285] dark:text-on-surface-variant/80 mt-0.5 leading-none">
                    {user?.role === 'MASTER_ADMIN' ? 'Master Admin' : (user?.role === 'ADMIN' ? 'Store Owner' : (user?.role === 'STAFF' ? 'Staff Member' : 'Store Owner'))}
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
        
        {/* TopAppBar — only visible when NOT in kitchen mode */}
        {!isKitchenMode && (
          <header className="w-full h-20 bg-background/80 backdrop-blur-md flex justify-between items-center px-margin-mobile md:px-margin-desktop z-40 transition-colors shrink-0">
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
              <button
                ref={bellRef}
                onClick={() => setIsNotificationOpen(prev => !prev)}
                className="text-on-surface-variant hover:text-primary transition-all ripple-effect cursor-pointer relative"
                aria-label="Notifications"
              >
                <span className="material-symbols-outlined">notifications</span>
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-error text-[11px] font-bold text-white rounded-full px-1 leading-none shadow-md">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
            </div>
          </header>
        )}

        {/* Notification Dropdown Panel */}
        <AnimatePresence>
          {isNotificationOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 md:z-40"
                onClick={() => setIsNotificationOpen(false)}
              />
              <motion.div
                ref={notificationPanelRef}
                initial={{ opacity: 0, y: -12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -12, scale: 0.96 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="fixed md:absolute top-20 right-4 md:right-8 w-[380px] max-w-[calc(100vw-32px)] max-h-[600px] overflow-hidden z-50 bg-surface-container/95 backdrop-blur-[30px] border border-outline-variant/20 rounded-2xl shadow-2xl flex flex-col"
                style={{
                  boxShadow: '0 0 30px rgba(212,175,55,0.08), 0 10px 40px rgba(0,0,0,0.15)'
                }}
              >
                <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/10 shrink-0">
                  <span className="font-title-lg text-title-lg text-primary tracking-tight">Notifications</span>
                  <div className="flex items-center gap-2">
                    {unreadCount > 0 && (
                      <button
                        onClick={handleMarkAllRead}
                        className="font-label-sm text-label-sm text-primary hover:text-primary/80 transition-colors px-3 py-1 rounded-lg hover:bg-primary/10 cursor-pointer"
                      >
                        Mark all read
                      </button>
                    )}
                    <button
                      onClick={() => setIsMuted(prev => !prev)}
                      className="text-on-surface-variant hover:text-primary p-1 rounded-lg transition-colors cursor-pointer"
                      aria-label={isMuted ? 'Unmute notifications' : 'Mute notifications'}
                    >
                      <span className="material-symbols-outlined text-[20px]">{isMuted ? 'notifications_off' : 'notifications'}</span>
                    </button>
                    <button
                      onClick={() => setIsNotificationOpen(false)}
                      className="text-on-surface-variant hover:text-primary p-1 rounded-lg transition-colors cursor-pointer"
                      aria-label="Close notifications"
                    >
                      <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                  </div>
                </div>

                <div className="overflow-y-auto flex-1">
                  {notifications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 px-5 text-center">
                      <span className="material-symbols-outlined text-[40px] text-outline mb-3">notifications_off</span>
                      <p className="font-body-md text-body-md text-on-surface-variant">No notifications yet</p>
                      <p className="font-body-sm text-body-sm text-on-surface-variant/60 mt-1">New orders and updates will appear here.</p>
                    </div>
                  ) : (
                    notifications.map((notification) => (
                      <motion.button
                        key={notification.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        onClick={() => handleNotificationClick(notification)}
                        className={`w-full text-left px-5 py-4 flex items-start gap-4 transition-colors cursor-pointer border-b border-outline-variant/5 last:border-b-0 ${
                          notification.isRead
                            ? 'bg-transparent hover:bg-surface-container-hover/30'
                            : 'bg-primary/[0.04] hover:bg-primary/[0.08]'
                        }`}
                      >
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                          notification.type === 'ORDER_CREATED'
                            ? 'bg-[#e8f5e9] dark:bg-green-900/30 text-green-700 dark:text-green-400'
                            : notification.type === 'PAYMENT_UPDATED'
                            ? 'bg-[#e3f2fd] dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                            : 'bg-[#fff3e0] dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                        }`}>
                          <span className="material-symbols-outlined text-[20px]">
                            {notification.type === 'ORDER_CREATED'
                              ? 'orders'
                              : notification.type === 'PAYMENT_UPDATED'
                              ? 'payments'
                              : 'wifi_off'}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={`font-title-sm text-title-sm truncate ${
                              notification.isRead ? 'text-on-surface' : 'text-on-surface font-semibold'
                            }`}>
                              {notification.title}
                            </p>
                            {!notification.isRead && (
                              <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
                            )}
                          </div>
                          <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5 line-clamp-2">
                            {notification.message}
                          </p>
                          <p className="font-label-sm text-label-sm text-on-surface-variant/50 mt-1">
                            {formatNotificationTime(notification.timestamp)}
                          </p>
                        </div>
                      </motion.button>
                    ))
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Dynamic Content */}
        <main className="flex-1 p-margin-mobile md:p-margin-desktop overflow-y-auto pb-24 md:pb-8 relative z-10">
          {activeTab === 'dashboard' && (
            <LiveKDS
              user={user}
              refreshKey={refreshKey}
              wsConnected={wsConnected}
              lastOrderCreatedEvent={lastOrderCreatedEvent}
              lastOrderUpdatedEvent={lastOrderUpdatedEvent}
              isDark={isDark}
              handleThemeToggle={handleThemeToggle}
              isKitchenMode={isKitchenMode}
              setIsKitchenMode={setIsKitchenMode}
            />
          )}

          {activeTab === 'menu' && <MenuManager />}
          {activeTab === 'scanner' && <OrderScanner />}
          {activeTab === 'tables' && <TablesAndQR />}
          {activeTab === 'settings' && <Settings user={user} />}
          {activeTab === 'payments' && <Payments refreshKey={refreshKey} user={user} />}
          {activeTab === 'analytics' && <Analytics />}
          {activeTab === 'settlements' && user?.role === 'MASTER_ADMIN' && <SettlementMonitor />}
          {activeTab === 'employees' && (user?.role === 'ADMIN' || user?.role === 'MASTER_ADMIN') && <Employees user={user} />}

          {activeTab !== 'dashboard' && activeTab !== 'tables' && activeTab !== 'menu' && activeTab !== 'settings' && activeTab !== 'scanner' && activeTab !== 'payments' && activeTab !== 'analytics' && activeTab !== 'settlements' && activeTab !== 'employees' && (
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

              <ul className="flex-1 space-y-2 overflow-y-auto hide-scrollbar pr-1">
                {SIDEBAR_ITEMS.map((item) => {
                  const isAdminLevel = user?.role === 'ADMIN' || user?.role === 'MASTER_ADMIN';
                  if (item.adminOnly && !isAdminLevel) return null;
                  if (item.masterAdminOnly && user?.role !== 'MASTER_ADMIN') return null;
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
                    {profileImage && !avatarLoadFailed ? (
                      <img
                        src={profileImage}
                        alt={`${user?.name || 'User'} profile`}
                        referrerPolicy="no-referrer"
                        onError={() => setAvatarLoadFailed(true)}
                        className="w-10 h-10 rounded-full object-cover border border-[#e3ebe8]/50 dark:border-outline-variant/10"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-[#e2edea] dark:bg-teal-950/40 text-[#1b7c83] dark:text-teal-400 flex items-center justify-center font-display-md text-title-md font-bold">
                        {initials}
                      </div>
                    )}
                    <div className="flex flex-col">
                      <span className="font-title-sm text-[#121317] dark:text-on-surface font-semibold text-sm leading-tight">
                        {user?.name || 'NupurStaff'}
                      </span>
                      <span className="text-[12px] text-[#6d8285] dark:text-on-surface-variant/80 mt-0.5 leading-none">
                        {user?.role === 'MASTER_ADMIN' ? 'Master Admin' : (user?.role === 'ADMIN' ? 'Store Owner' : (user?.role === 'STAFF' ? 'Staff Member' : 'Store Owner'))}
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

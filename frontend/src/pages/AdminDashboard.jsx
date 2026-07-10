import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  
  // Real-time signals
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastOrderCreatedEvent, setLastOrderCreatedEvent] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [isKitchenMode, setIsKitchenMode] = useState(false);

  const triggerRefresh = () => setRefreshKey(prev => prev + 1);

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
        };
        
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'ORDER_CREATED' || msg.type === 'ORDER_STATUS_CHANGED' || msg.type === 'PAYMENT_UPDATED') {
              triggerRefresh();
              
              // Handoff ORDER_CREATED to LiveKDS with seq/stale guards
              if (msg.type === 'ORDER_CREATED') {
                const tableName = msg.payload?.table || null;
                setLastOrderCreatedEvent({
                  id: msg.payload?._id || Math.random().toString(),
                  timestamp: Date.now(),
                  table: tableName
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
            <LiveKDS
              refreshKey={refreshKey}
              wsConnected={wsConnected}
              lastOrderCreatedEvent={lastOrderCreatedEvent}
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
          {activeTab === 'payments' && <Payments refreshKey={refreshKey} />}
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

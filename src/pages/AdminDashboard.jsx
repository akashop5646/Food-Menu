import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import TablesAndQR from './TablesAndQR';
const SIDEBAR_ITEMS = [
  { id: 'dashboard', icon: 'monitor_heart', label: 'Live KDS', fill: true },
  { id: 'menu', icon: 'restaurant_menu', label: 'Menu Manager' },
  { id: 'payments', icon: 'payments', label: 'Payments' },
  { id: 'tables', icon: 'grid_view', label: 'Tables & QR' },
  { id: 'analytics', icon: 'analytics', label: 'Analytics' },
];

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  
  // Theme State
  const [isDark, setIsDark] = useState(true);
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
  }, []);

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
        <div className="mt-auto px-6 space-y-2">
          <a className="flex items-center gap-4 text-on-surface-variant hover:text-on-surface py-3 transition-colors duration-200" href="#">
            <span className="material-symbols-outlined">settings</span>
            <span className="font-body-lg text-body-lg">Settings</span>
          </a>
          <a className="flex items-center gap-4 text-on-surface-variant hover:text-on-surface py-3 transition-colors duration-200" href="#">
            <span className="material-symbols-outlined">help_outline</span>
            <span className="font-body-lg text-body-lg">Support</span>
          </a>
          <div className="mt-6 flex items-center gap-3 border-t border-outline-variant/20 pt-6 cursor-pointer group" onClick={async () => {
            await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
            navigate('/admin');
          }}>
            <div className="w-10 h-10 rounded-full bg-surface-container-high border border-outline-variant overflow-hidden group-hover:border-primary transition-colors">
              <div className="w-full h-full bg-gradient-to-tr from-surface-container-highest to-surface flex items-center justify-center text-primary-fixed">
                 {user?.name?.charAt(0) || 'EC'}
              </div>
            </div>
            <div>
              <p className="font-body-sm text-body-sm text-on-surface group-hover:text-primary transition-colors">Executive Chef Profile</p>
              <p className="font-body-sm text-body-sm text-on-surface-variant text-[11px]">Logout</p>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <div className="flex-1 md:ml-[280px] flex flex-col h-screen overflow-hidden">
        {/* TopAppBar */}
        <header className="w-full h-20 sticky top-0 bg-background/80 backdrop-blur-md flex justify-between items-center px-margin-desktop z-40 transition-colors">
          <div className="flex items-center gap-4">
            <h2 className="font-headline-lg text-headline-lg text-primary tracking-tight">Aurum OS</h2>
          </div>
          <div className="flex items-center gap-2 sm:gap-6">
            <div className="relative group">
              <input className="bg-transparent border-0 border-b border-surface-variant focus:border-primary text-on-surface font-body-sm text-body-sm pb-1 w-28 sm:w-48 focus:w-40 sm:focus:w-64 transition-all duration-300 focus:ring-0 placeholder:text-on-surface-variant/50 outline-none" placeholder="Search orders..." type="text"/>
              <span className="material-symbols-outlined absolute right-0 bottom-2 text-on-surface-variant group-focus-within:text-primary transition-colors text-sm">search</span>
            </div>
            <button onClick={handleThemeToggle} className="text-on-surface-variant hover:text-primary transition-all ripple-effect cursor-pointer">
              <span className="material-symbols-outlined">{isDark ? 'light_mode' : 'dark_mode'}</span>
            </button>
            <button className="text-on-surface-variant hover:text-primary transition-all ripple-effect cursor-pointer relative">
              <span className="material-symbols-outlined">notifications</span>
              <span className="absolute top-0 right-0 w-2 h-2 bg-error rounded-full"></span>
            </button>
            <button className="text-on-surface-variant hover:text-primary transition-all ripple-effect cursor-pointer">
              <span className="material-symbols-outlined">account_circle</span>
            </button>
          </div>
        </header>

        {/* Dynamic Content */}
        <main className="flex-1 overflow-x-hidden overflow-y-auto md:overflow-x-auto md:overflow-y-hidden p-container-padding">
          {activeTab === 'dashboard' && (
            <div className="flex flex-col md:flex-row gap-gutter h-auto md:h-full md:min-w-[900px]">
              {/* Column 1: New Orders */}
              <section className="flex-1 min-h-[400px] md:min-h-0 flex flex-col bg-surface/50 rounded-xl border border-outline-variant/20 overflow-hidden stagger-1">
                <div className="p-4 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-low">
                  <h3 className="font-title-md text-title-md text-on-surface flex items-center gap-2">
                    New
                    <span className="bg-error/20 text-error font-mono-data text-mono-data px-2 py-0.5 rounded-full">0</span>
                  </h3>
                </div>
                <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center justify-center text-center opacity-50">
                  <span className="material-symbols-outlined text-4xl mb-2">receipt_long</span>
                  <p className="font-body-sm text-body-sm">No new orders</p>
                </div>
              </section>
              
              {/* Column 2: Preparing */}
              <section className="flex-1 min-h-[400px] md:min-h-0 flex flex-col bg-surface/50 rounded-xl border border-outline-variant/20 overflow-hidden stagger-2">
                <div className="p-4 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-low">
                  <h3 className="font-title-md text-title-md text-on-surface flex items-center gap-2">
                    Preparing
                    <span className="bg-primary/20 text-primary font-mono-data text-mono-data px-2 py-0.5 rounded-full">0</span>
                  </h3>
                </div>
                <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center justify-center text-center opacity-50">
                  <span className="material-symbols-outlined text-4xl mb-2">soup_kitchen</span>
                  <p className="font-body-sm text-body-sm">No orders in preparation</p>
                </div>
              </section>

              {/* Column 3: Ready */}
              <section className="flex-1 min-h-[400px] md:min-h-0 flex flex-col bg-surface/50 rounded-xl border border-outline-variant/20 overflow-hidden stagger-3">
                <div className="p-4 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-low">
                  <h3 className="font-title-md text-title-md text-on-surface flex items-center gap-2">
                    Ready
                    <span className="bg-tertiary/20 text-tertiary font-mono-data text-mono-data px-2 py-0.5 rounded-full">0</span>
                  </h3>
                </div>
                <div className="flex-1 overflow-y-auto p-4 flex items-center justify-center">
                  <div className="text-center opacity-50">
                    <span className="material-symbols-outlined text-4xl mb-2">done_all</span>
                    <p className="font-body-sm text-body-sm">No items ready for pickup</p>
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'tables' && (
            <TablesAndQR />
          )}

          {activeTab !== 'dashboard' && activeTab !== 'tables' && (
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
    </div>
  );
}

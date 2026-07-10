import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { API_BASE } from '../config';

// KDS stage-aware overdue thresholds (minutes in current stage)
const KDS_STAGE_THRESHOLDS = { NEW: 3, PREPARING: 15, READY: 10 };

export default function LiveKDS({
  refreshKey,
  wsConnected,
  lastOrderCreatedEvent,
  isDark,
  handleThemeToggle,
  isKitchenMode,
  setIsKitchenMode
}) {
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [newOrderToast, setNewOrderToast] = useState(null);

  // KDS sound states & refs
  const [kdsSoundEnabled, setKdsSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('aurum_kds_sound_enabled');
    return saved === null ? true : saved === 'true';
  });
  const audioCtxRef = useRef(null);
  
  // Guard references to prevent replaying stale parent events on mount
  const mountTimeRef = useRef(Date.now());
  const processedEventsRef = useRef(new Set());

  // ponytail: lightweight tick counter for timer re-renders without refetching data
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timerTick = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(timerTick);
  }, []);

  const kdsContainerRef = useRef(null);

  // Fetch KDS active orders
  const fetchActiveOrders = useCallback(async () => {
    try {
      // ponytail: add cache-busting timestamp to prevent browser from returning stale cached GET responses
      const res = await fetch(`${API_BASE}/api/orders?active=true&_=${Date.now()}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setOrders(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  // Fetch orders on mount and when refreshKey changes
  useEffect(() => {
    fetchActiveOrders();
  }, [refreshKey, fetchActiveOrders]);

  // ponytail: ensure AudioContext is created and resumed inside a user-gesture callstack.
  // Browsers (Chrome, Brave, Firefox) suspend AudioContext created without a gesture.
  // ctx.resume() is async — oscillators scheduled before it resolves produce silence.
  const ensureAudioUnlocked = useCallback(() => {
    try {
      const ctx = audioCtxRef.current || new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      if (ctx.state === 'suspended') ctx.resume(); // resolves within same gesture frame
    } catch (e) { /* AudioContext unavailable */ }
  }, []);

  // Web Audio API two-tone chime — no external file needed
  const playNewOrderSound = useCallback(() => {
    if (!kdsSoundEnabled) return;
    const ctx = audioCtxRef.current;
    if (!ctx) return; // no unlocked context yet — browser blocked before first gesture
    // ponytail: resume() returns a promise; schedule oscillators only after it resolves
    const play = () => {
      const now = ctx.currentTime;
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
    };
    if (ctx.state === 'suspended') {
      ctx.resume().then(play).catch(() => {});
    } else {
      play();
    }
  }, [kdsSoundEnabled]);

  // Play a single confirmation tone (used for test and toggle-on feedback)
  const playTestTone = useCallback(() => {
    ensureAudioUnlocked();
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const go = () => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 523.25;
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    };
    if (ctx.state === 'suspended') {
      ctx.resume().then(go).catch(() => {});
    } else {
      go();
    }
  }, [ensureAudioUnlocked]);

  // Handle live ORDER_CREATED handoff with sequence & stale protection guards
  useEffect(() => {
    if (!lastOrderCreatedEvent) return;

    // Ignore events that occurred before the component mounted (cached/stale parent state)
    if (lastOrderCreatedEvent.timestamp < mountTimeRef.current) return;

    // Guard: ensure we only process each unique event ID once
    if (processedEventsRef.current.has(lastOrderCreatedEvent.id)) return;
    processedEventsRef.current.add(lastOrderCreatedEvent.id);

    // Play sound and show toast alert
    playNewOrderSound();
    const tableName = lastOrderCreatedEvent.table;
    setNewOrderToast(tableName ? `New order received — ${tableName}` : 'New order received');
    
    // Direct trigger: fetch active orders immediately upon new order creation
    fetchActiveOrders();

    const timer = setTimeout(() => setNewOrderToast(null), 3000);
    return () => clearTimeout(timer);
  }, [lastOrderCreatedEvent, playNewOrderSound, fetchActiveOrders]);

  // Sound preference toggle — unlocks AudioContext on user gesture
  const toggleKdsSound = useCallback(() => {
    ensureAudioUnlocked(); // unlock on every click regardless of direction
    setKdsSoundEnabled(prev => {
      const next = !prev;
      localStorage.setItem('aurum_kds_sound_enabled', String(next));
      if (next) setTimeout(() => playTestTone(), 50); // audible confirmation
      return next;
    });
  }, [ensureAudioUnlocked, playTestTone]);

  // Kitchen mode toggle — also unlocks AudioContext opportunistically
  const toggleKitchenMode = useCallback(() => {
    ensureAudioUnlocked();
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
  }, [isKitchenMode, setIsKitchenMode, ensureAudioUnlocked]);

  // Sync kitchen mode state with browser fullscreen changes (Escape key)
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isKitchenMode) {
        setIsKitchenMode(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isKitchenMode, setIsKitchenMode]);

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

  const newOrders = orders.filter(o => o.status === 'NEW');
  const preparingOrders = orders.filter(o => o.status === 'PREPARING');
  const readyOrders = orders.filter(o => o.status === 'READY');

  return (
    <div ref={kdsContainerRef} className="h-full flex flex-col select-none">
      {/* Minimal Header for Kitchen Mode */}
      {isKitchenMode && (
        <header className="w-full h-14 bg-surface-container/90 backdrop-blur-md flex justify-between items-center px-4 md:px-6 z-40 transition-colors border-b border-outline-variant/20 shrink-0">
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
            {kdsSoundEnabled && (
              <button onClick={playTestTone} className="text-on-surface-variant hover:text-primary transition-all cursor-pointer p-1.5 rounded-lg hover:bg-primary/10" title="Test Sound">
                <span className="material-symbols-outlined text-lg">notifications_active</span>
              </button>
            )}
            <button onClick={handleThemeToggle} className="text-on-surface-variant hover:text-primary transition-all cursor-pointer p-1.5 rounded-lg hover:bg-primary/10">
              <span className="material-symbols-outlined text-lg">{isDark ? 'light_mode' : 'dark_mode'}</span>
            </button>
            <button onClick={toggleKitchenMode} className="flex items-center gap-1 bg-primary/10 hover:bg-primary text-primary hover:text-on-primary border border-primary/30 px-3 py-1.5 rounded-xl font-label-caps text-[10px] uppercase tracking-wider font-bold transition-all cursor-pointer">
              <span className="material-symbols-outlined text-sm">fullscreen_exit</span>
              Exit Kitchen Mode
            </button>
          </div>
        </header>
      )}

      {/* Column lists */}
      <div className={`flex-1 flex flex-col md:flex-row gap-gutter ${isKitchenMode ? 'p-4 md:p-6 overflow-hidden' : 'h-auto md:h-full'} md:min-w-[900px]`}>
        {/* Column 1: New Orders */}
        <section className="flex-1 min-h-[400px] md:min-h-0 flex flex-col bg-surface/50 rounded-xl border border-outline-variant/20 overflow-hidden stagger-1">
          <div className="p-4 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-low">
            <h3 className="font-title-md text-title-md text-on-surface flex items-center gap-2">
              New
              <span className="bg-error/20 text-error font-mono-data text-mono-data px-2 py-0.5 rounded-full">{newOrders.length}</span>
            </h3>
            {/* Kitchen mode + sound buttons in first column header — only when NOT in fullscreen kitchen mode */}
            {!isKitchenMode && (
              <div className="flex items-center gap-1">
                <button onClick={toggleKdsSound} className="flex items-center gap-1 text-on-surface-variant hover:text-primary transition-all px-1.5 py-1 rounded-lg hover:bg-primary/10 cursor-pointer" title={kdsSoundEnabled ? 'Sound On' : 'Sound Off'}>
                  <span className="material-symbols-outlined text-[16px]">{kdsSoundEnabled ? 'volume_up' : 'volume_off'}</span>
                </button>
                {kdsSoundEnabled && (
                  <button onClick={playTestTone} className="text-on-surface-variant hover:text-primary transition-all cursor-pointer p-1 rounded-lg hover:bg-primary/10" title="Test Sound">
                    <span className="material-symbols-outlined text-[16px]">notifications_active</span>
                  </button>
                )}
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

      {/* New Order Toast inside LiveKDS */}
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
    </div>
  );
}

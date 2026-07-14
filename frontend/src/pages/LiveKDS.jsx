
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { API_BASE } from '../config';

// KDS stage-aware overdue thresholds (minutes in current stage)
const KDS_STAGE_THRESHOLDS = { NEW: 3, PREPARING: 15, READY: 10 };

export default function LiveKDS({
  user,
  refreshKey,
  wsConnected,
  lastOrderCreatedEvent,
  lastOrderUpdatedEvent,
  isDark,
  handleThemeToggle,
  isKitchenMode,
  setIsKitchenMode
}) {
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [newOrderToast, setNewOrderToast] = useState(null);
  const [activeMobileStage, setActiveMobileStage] = useState('NEW');

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

  // KDS order editing modal states
  const [editingOrder, setEditingOrder] = useState(null);
  const [editTableId, setEditTableId] = useState('');
  const [editLocationId, setEditLocationId] = useState('');
  const [editItems, setEditItems] = useState({}); // { [itemId]: { item, quantity } }
  const [editReason, setEditReason] = useState('');
  const [editError, setEditError] = useState('');
  const [editSuccessMsg, setEditSuccessMsg] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editTab, setEditTab] = useState('edit'); // 'edit' or 'history'

  // KDS bulk complete states
  const [showCompleteAllConfirm, setShowCompleteAllConfirm] = useState(false);
  const [isCompletingAll, setIsCompletingAll] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimeoutRef = useRef(null);

  const showToast = useCallback((message, type) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 2500);
  }, []);

  const completableOrders = useMemo(() => {
    return orders.filter(order => ['NEW', 'PREPARING', 'READY'].includes(order.status));
  }, [orders]);

  const handleConfirmCompleteAll = async () => {
    if (isCompletingAll || completableOrders.length === 0) return;
    setIsCompletingAll(true);
    try {
      const res = await fetch(`${API_BASE}/api/orders/complete-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      const data = await res.json();
      if (res.ok) {
        const { completedOrderIds, completedCount, matchedCount } = data;

        // Remove only IDs returned by completedOrderIds
        if (completedOrderIds && completedOrderIds.length > 0) {
          setOrders(prev => prev.filter(o => !completedOrderIds.includes(String(o._id))));
        }

        // Run authoritative fetchActiveOrders reconciliation
        await fetchActiveOrders();

        setShowCompleteAllConfirm(false);

        // Result-aware success messages
        if (completedCount > 0 && matchedCount === completedCount) {
          showToast(`${completedCount} orders completed`, 'success');
        } else if (completedCount === 0) {
          showToast('No active orders remained to complete', 'success');
        } else if (matchedCount > completedCount) {
          showToast(`${completedCount} orders completed. KDS refreshed because another terminal updated the remaining order.`, 'success');
        }
      } else {
        showToast(data.error || 'Failed to complete all orders.', 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Failed to complete all orders.', 'error');
    } finally {
      setIsCompletingAll(false);
    }
  };

  // Search & menu items
  const [editMenuSearch, setEditMenuSearch] = useState('');
  const [editSearchResults, setEditSearchResults] = useState([]);
  const [editMenuLoading, setEditMenuLoading] = useState(false);

  // Revision history paginated states
  const [editRevisions, setEditRevisions] = useState([]);
  const [editRevisionsTotal, setEditRevisionsTotal] = useState(0);
  const [editRevisionsPage, setEditRevisionsPage] = useState(1);
  const [editRevisionsLoading, setEditRevisionsLoading] = useState(false);

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

    // Automatically transition to NEW active stage on mobile for a genuine new ORDER_CREATED event
    setActiveMobileStage('NEW');

    const timer = setTimeout(() => setNewOrderToast(null), 3000);
    return () => clearTimeout(timer);
  }, [lastOrderCreatedEvent, playNewOrderSound, fetchActiveOrders]);

  // Handle live ORDER_UPDATED version-aware WebSocket reconciliation
  useEffect(() => {
    if (!lastOrderUpdatedEvent) return;

    // Ignore events that occurred before mount
    if (lastOrderUpdatedEvent.timestamp < mountTimeRef.current) return;

    // Guard: prevent processing same event id twice
    const eventKey = `ORDER_UPDATED:${lastOrderUpdatedEvent.orderId}:${lastOrderUpdatedEvent.version}`;
    if (processedEventsRef.current.has(eventKey)) return;
    processedEventsRef.current.add(eventKey);

    const { orderId, version, order: updatedOrder } = lastOrderUpdatedEvent;
    if (!orderId || !updatedOrder) return;

    setOrders(prevOrders => {
      const existing = prevOrders.find(o => o._id === orderId);
      if (!existing) {
        // If the order isn't currently in KDS active list, don't inject it
        return prevOrders;
      }

      const currentVer = existing.version || 1;
      const eventVer = version || updatedOrder.version || 1;
      if (eventVer <= currentVer) {
        // Stale or duplicate update, ignore
        return prevOrders;
      }

      // If status progressed to non-KDS (COMPLETED), filter it out
      if (!['NEW', 'PREPARING', 'READY'].includes(updatedOrder.status)) {
        return prevOrders.filter(o => o._id !== orderId);
      }

      // Perform in-place update to prevent duplicate cards
      return prevOrders.map(o => o._id === orderId ? { ...o, ...updatedOrder } : o);
    });
  }, [lastOrderUpdatedEvent]);

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

  const handleOpenEditModal = (order) => {
    setEditingOrder(order);
    setEditTableId(order.tableId || '');
    setEditLocationId(order.locationId || '');
    setEditReason('');
    setEditError('');
    setEditSuccessMsg('');
    setEditTab('edit');
    setEditMenuSearch('');
    setEditSearchResults([]);
    setEditRevisions([]);
    setEditRevisionsPage(1);

    const itemsMap = {};
    order.items.forEach(item => {
      itemsMap[String(item.id || item._id)] = {
        item: {
          _id: item.id || item._id,
          name: item.name,
          price: item.price
        },
        quantity: item.quantity
      };
    });
    setEditItems(itemsMap);
    fetchTablesAndLocations();
  };

  const handleCloseEditModal = () => {
    setEditingOrder(null);
  };

  const fetchRevisions = useCallback(async (orderId, page = 1) => {
    setEditRevisionsLoading(true);
    setEditError('');
    try {
      const res = await fetch(`${API_BASE}/api/orders/${orderId}/revisions?page=${page}&limit=5`, {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        setEditRevisions(data.revisions || []);
        setEditRevisionsTotal(data.pagination?.total || 0);
        setEditRevisionsPage(page);
      } else {
        const data = await res.json();
        setEditError(data.error || 'Failed to fetch revision history.');
      }
    } catch (err) {
      console.error(err);
      setEditError('Failed to fetch revision history.');
    } finally {
      setEditRevisionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (editingOrder && editTab === 'history') {
      fetchRevisions(editingOrder._id, 1);
    }
  }, [editingOrder, editTab, fetchRevisions]);

  const [editTables, setEditTables] = useState([]);
  const [editLocations, setEditLocations] = useState([]);

  const fetchTablesAndLocations = async () => {
    try {
      const [resTables, resLocations] = await Promise.all([
        fetch(`${API_BASE}/api/tables`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/locations`, { credentials: 'include' })
      ]);
      if (resTables.ok && resLocations.ok) {
        const tablesData = await resTables.json();
        const locationsData = await resLocations.json();
        setEditTables(tablesData);
        setEditLocations(locationsData);
      }
    } catch (e) {
      console.error('Failed to load tables/locations:', e);
    }
  };

  const handleSearchMenu = async (query) => {
    setEditMenuSearch(query);
    if (!query.trim()) {
      setEditSearchResults([]);
      return;
    }
    setEditMenuLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/menu?search=${encodeURIComponent(query)}`, {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        setEditSearchResults(data.items || data || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setEditMenuLoading(false);
    }
  };

  const handleUpdateItemQty = (itemId, change) => {
    setEditItems(prev => {
      const existing = prev[itemId];
      if (!existing) return prev;
      const newQty = existing.quantity + change;
      if (newQty < 0) return prev;

      const originalItem = editingOrder.items.find(i => String(i.id || i._id) === itemId);
      const isUnavailable = existing.item.available === false || existing.item.deleted === true;
      if (isUnavailable && originalItem && newQty > originalItem.quantity) {
        setEditError(`Cannot increase quantity of unavailable item: ${existing.item.name}`);
        return prev;
      }

      setEditError('');
      const updated = { ...prev };
      if (newQty === 0) {
        delete updated[itemId];
      } else {
        updated[itemId] = { ...existing, quantity: newQty };
      }
      return updated;
    });
  };

  const handleAddItem = (menuItem) => {
    const itemId = String(menuItem._id);
    const originalItem = editingOrder?.items.find(i => String(i.id || i._id) === itemId);
    const isUnavailable = menuItem.available === false || menuItem.deleted === true;

    if (isUnavailable && !originalItem) {
      setEditError(`Cannot add new unavailable item: ${menuItem.name}`);
      return;
    }

    setEditItems(prev => {
      const existing = prev[itemId];
      const newQty = (existing?.quantity || 0) + 1;

      if (isUnavailable && originalItem && newQty > originalItem.quantity) {
        setEditError(`Cannot increase quantity of unavailable item: ${menuItem.name}`);
        return prev;
      }

      setEditError('');
      return {
        ...prev,
        [itemId]: {
          item: menuItem,
          quantity: newQty
        }
      };
    });
  };

  const handleReloadLatestOrder = async () => {
    setEditError('');
    setEditSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/orders`, { credentials: 'include' });
      if (res.ok) {
        const activeOrders = await res.json();
        const latest = activeOrders.find(o => o._id === editingOrder._id);
        if (latest) {
          setEditingOrder(latest);
          setEditTableId(latest.tableId || '');
          setEditLocationId(latest.locationId || '');

          const itemsMap = {};
          latest.items.forEach(item => {
            itemsMap[String(item.id || item._id)] = {
              item: {
                _id: item.id || item._id,
                name: item.name,
                price: item.price
              },
              quantity: item.quantity
            };
          });
          setEditItems(itemsMap);
          setEditError('Order updated with latest server state. Please review and apply changes.');
        } else {
          setEditError('Order is no longer active or could not be found.');
        }
      } else {
        setEditError('Failed to fetch latest orders.');
      }
    } catch (e) {
      console.error(e);
      setEditError('Failed to fetch latest order state.');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleSaveAmendment = async () => {
    setEditError('');
    setEditSuccessMsg('');
    setEditSubmitting(true);

    const trimmedReason = editReason.trim();
    if (!trimmedReason || trimmedReason.length < 5 || trimmedReason.length > 500) {
      setEditError('Amendment reason must be between 5 and 500 characters long.');
      setEditSubmitting(false);
      return;
    }

    const payload = {
      version: editingOrder.version || 1,
      reason: trimmedReason,
      tableId: editTableId || null,
      locationId: editLocationId || null,
      items: Object.values(editItems).map(e => ({
        id: e.item._id || e.item.id,
        quantity: e.quantity
      }))
    };

    try {
      const res = await fetch(`${API_BASE}/api/orders/${editingOrder._id}/amend`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include'
      });

      const data = await res.json();

      if (res.ok) {
        setEditSuccessMsg('Order amended successfully!');
        setOrders(prev => prev.map(o => o._id === editingOrder._id ? { ...o, ...data } : o));
        setTimeout(() => {
          handleCloseEditModal();
        }, 1500);
      } else {
        if (res.status === 409) {
          setEditError('Concurrency conflict: The order was updated by another terminal. Please reload.');
        } else {
          setEditError(data.error || 'Failed to amend order.');
        }
      }
    } catch (err) {
      console.error(err);
      setEditError('Failed to connect to server.');
    } finally {
      setEditSubmitting(false);
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
        <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-container-high border border-outline-variant/30 rounded-xl px-3 py-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="material-symbols-outlined text-primary text-lg">table_restaurant</span>
            <span className="font-headline-sm text-base text-primary font-bold">{order.table}</span>
            {order.version > 1 && (
              <span className="text-[10px] font-bold text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-lg ml-1 shrink-0">
                Updated (v{order.version})
              </span>
            )}
          </div>
          {order.location && (
            <span className="text-[11px] text-on-surface-variant font-mono font-medium bg-surface-container-lowest/80 px-2 py-0.5 rounded-lg border border-outline-variant/10">📍 {order.location}</span>
          )}
        </div>

        <div className="flex justify-between items-center gap-2">
          <span className={`text-[11px] font-mono flex flex-wrap items-center gap-x-1.5 gap-y-0.5 ${isOverdue ? 'text-primary font-bold' : 'text-on-surface-variant/70'}`}>
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
          <div className="flex gap-2">
            {(user?.role === 'ADMIN' || user?.role === 'MASTER_ADMIN') && (
              <button
                type="button"
                onClick={() => handleOpenEditModal(order)}
                aria-label={`Amend order table ${order.table}`}
                className="bg-surface-container-highest hover:bg-amber-500/20 hover:text-amber-500 text-on-surface p-2 w-11 h-11 rounded-xl border border-outline-variant/50 hover:border-amber-500/30 transition-all flex items-center justify-center cursor-pointer shrink-0"
                title="Edit Order Items & Details"
              >
                <span className="material-symbols-outlined text-base">edit</span>
              </button>
            )}
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => handleMoveStatus(order._id, order.status)}
              className="flex-1 bg-surface-container-highest hover:bg-primary/25 hover:text-primary text-on-surface h-11 py-0 rounded-xl font-label-caps text-[11px] uppercase tracking-widest border border-outline-variant/50 hover:border-primary/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer font-bold"
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
          </div>
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
            {completableOrders.length > 0 && (
              <button
                type="button"
                onClick={() => setShowCompleteAllConfirm(true)}
                aria-label="Complete all active orders"
                className="flex items-center justify-center gap-1.5 bg-error/10 hover:bg-error text-error hover:text-on-error border border-error/30 h-10 px-3.5 rounded-xl font-label-caps text-[10px] sm:text-[11px] uppercase tracking-wider font-bold transition-all cursor-pointer min-h-[44px]"
              >
                <span className="material-symbols-outlined text-[16px]">done_all</span>
                <span className="hidden sm:inline">Complete All</span>
              </button>
            )}
            <button
              onClick={toggleKdsSound}
              aria-label={kdsSoundEnabled ? 'Disable KDS sound' : 'Enable KDS sound'}
              className="flex items-center justify-center gap-1 text-on-surface-variant hover:text-primary transition-all w-11 h-11 sm:w-auto sm:px-2 sm:py-1.5 rounded-lg hover:bg-primary/10 cursor-pointer"
              title={kdsSoundEnabled ? 'Sound On' : 'Sound Off'}
            >
              <span className="material-symbols-outlined text-lg">{kdsSoundEnabled ? 'volume_up' : 'volume_off'}</span>
              <span className="text-[10px] font-label-caps uppercase tracking-wider font-semibold hidden sm:inline">{kdsSoundEnabled ? 'Sound On' : 'Sound Off'}</span>
            </button>
            {kdsSoundEnabled && (
              <button
                onClick={playTestTone}
                aria-label="Play test chime"
                className="text-on-surface-variant hover:text-primary transition-all cursor-pointer w-11 h-11 flex items-center justify-center rounded-lg hover:bg-primary/10"
                title="Test Sound"
              >
                <span className="material-symbols-outlined text-lg">notifications_active</span>
              </button>
            )}
            <button
              onClick={handleThemeToggle}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="text-on-surface-variant hover:text-primary transition-all cursor-pointer w-11 h-11 flex items-center justify-center rounded-lg hover:bg-primary/10"
            >
              <span className="material-symbols-outlined text-lg">{isDark ? 'light_mode' : 'dark_mode'}</span>
            </button>
            <button
              onClick={toggleKitchenMode}
              aria-label="Exit kitchen fullscreen mode"
              className="flex items-center justify-center gap-1 bg-primary/10 hover:bg-primary text-primary hover:text-on-primary border border-primary/30 h-11 px-3 rounded-xl font-label-caps text-[10px] uppercase tracking-wider font-bold transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">fullscreen_exit</span>
              <span className="hidden xs:inline">Exit Kitchen Mode</span>
            </button>
          </div>
        </header>
      )}

      {!isKitchenMode && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 md:px-0 md:py-0 md:pb-5 shrink-0 select-none animate-[fadeUp_0.6s_ease-out_forwards]">
          <div className="hidden md:block">
            <h2 className="font-headline-md text-xl md:text-2xl text-primary font-bold">Kitchen Display</h2>
            <p className="text-xs text-on-surface-variant/80 mt-0.5">Manage and track active orders on the kitchen floor.</p>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto sm:ml-auto">
            {completableOrders.length > 0 && (
              <button
                type="button"
                onClick={() => setShowCompleteAllConfirm(true)}
                aria-label="Complete all active orders"
                className="w-full sm:w-auto bg-error/10 hover:bg-error text-error hover:text-on-error border border-error/20 h-11 px-4 rounded-xl font-label-caps text-[11px] uppercase tracking-wider font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 min-h-[44px]"
              >
                <span className="material-symbols-outlined text-[18px]">done_all</span>
                <span>Complete All</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Mobile Stage Switcher */}
      <div className="flex md:hidden bg-surface-container-high border-b border-outline-variant/20 p-2 shrink-0 select-none">
        <div className="flex w-full bg-surface-container-lowest/80 rounded-xl p-1 border border-outline-variant/10">
          <button
            type="button"
            onClick={() => setActiveMobileStage('NEW')}
            aria-pressed={activeMobileStage === 'NEW'}
            className={`h-11 flex-1 py-0 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeMobileStage === 'NEW'
                ? 'bg-error text-white shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-base">receipt_long</span>
            <span>New ({newOrders.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveMobileStage('PREPARING')}
            aria-pressed={activeMobileStage === 'PREPARING'}
            className={`h-11 flex-1 py-0 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeMobileStage === 'PREPARING'
                ? 'bg-primary text-on-primary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-base">soup_kitchen</span>
            <span>Prep ({preparingOrders.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveMobileStage('READY')}
            aria-pressed={activeMobileStage === 'READY'}
            className={`h-11 flex-1 py-0 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeMobileStage === 'READY'
                ? 'bg-tertiary text-on-tertiary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-base">done_all</span>
            <span>Ready ({readyOrders.length})</span>
          </button>
        </div>
      </div>

      {/* Column lists */}
      <div className={`flex-1 flex flex-col md:flex-row gap-gutter ${isKitchenMode ? 'p-4 md:p-6 overflow-hidden' : 'h-auto md:h-full'} min-w-0 md:min-w-[900px]`}>
        {/* Column 1: New Orders */}
        <section className={`${activeMobileStage === 'NEW' ? 'flex' : 'hidden'} md:flex flex-1 min-h-[calc(100dvh-12rem)] md:min-h-0 flex-col bg-surface/50 rounded-xl border border-outline-variant/20 overflow-hidden stagger-1`}>
          <div className="p-4 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-low">
            <h3 className="font-title-md text-title-md text-on-surface flex items-center gap-2">
              New
              <span className="bg-error/20 text-error font-mono-data text-mono-data px-2 py-0.5 rounded-full">{newOrders.length}</span>
            </h3>
            {/* Kitchen mode + sound buttons in first column header — only when NOT in fullscreen kitchen mode */}
            {!isKitchenMode && (
              <div className="flex items-center gap-1">
                <button
                  onClick={toggleKdsSound}
                  aria-label={kdsSoundEnabled ? 'Disable KDS sound' : 'Enable KDS sound'}
                  className="flex items-center justify-center text-on-surface-variant hover:text-primary transition-all w-11 h-11 rounded-lg hover:bg-primary/10 cursor-pointer"
                  title={kdsSoundEnabled ? 'Sound On' : 'Sound Off'}
                >
                  <span className="material-symbols-outlined text-[18px]">{kdsSoundEnabled ? 'volume_up' : 'volume_off'}</span>
                </button>
                {kdsSoundEnabled && (
                  <button
                    onClick={playTestTone}
                    aria-label="Play test chime"
                    className="text-on-surface-variant hover:text-primary transition-all cursor-pointer w-11 h-11 flex items-center justify-center rounded-lg hover:bg-primary/10"
                    title="Test Sound"
                  >
                    <span className="material-symbols-outlined text-[18px]">notifications_active</span>
                  </button>
                )}
                <button
                  onClick={toggleKitchenMode}
                  aria-label="Enter kitchen fullscreen mode"
                  className="flex items-center justify-center text-on-surface-variant hover:text-primary transition-all w-11 h-11 rounded-lg hover:bg-primary/10 cursor-pointer"
                  title="Enter Kitchen Mode"
                >
                  <span className="material-symbols-outlined text-[18px]">fullscreen</span>
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
        <section className={`${activeMobileStage === 'PREPARING' ? 'flex' : 'hidden'} md:flex flex-1 min-h-[calc(100dvh-12rem)] md:min-h-0 flex-col bg-surface/50 rounded-xl border border-outline-variant/20 overflow-hidden stagger-2`}>
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
        <section className={`${activeMobileStage === 'READY' ? 'flex' : 'hidden'} md:flex flex-1 min-h-[calc(100dvh-12rem)] md:min-h-0 flex-col bg-surface/50 rounded-xl border border-outline-variant/20 overflow-hidden stagger-3`}>
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

      {/* Edit Order Modal */}
      <AnimatePresence>
        {editingOrder && (
          <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-0 md:p-4 bg-black/60 backdrop-blur-sm app-overlay-backdrop md:top-0 md:right-0 md:bottom-0 md:left-0">
            <motion.div
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="bg-surface-container-low border-t md:border border-outline-variant/30 rounded-t-2xl md:rounded-2xl w-full max-w-4xl h-[calc(100dvh-80px)] md:h-auto md:max-h-[85vh] flex flex-col shadow-2xl overflow-hidden text-on-surface"
            >
              {/* Header */}
              <div className="px-6 py-4 bg-surface-container-high border-b border-outline-variant/30 flex justify-between items-center app-overlay-header">
                <div className="space-y-1">
                  <h3 className="font-headline-sm text-lg font-bold flex items-center gap-2 text-primary">
                    <span className="material-symbols-outlined">edit_square</span>
                    Amend Order: Table {editingOrder.table} (v{editingOrder.version || 1})
                  </h3>
                  <p className="text-xs text-on-surface-variant font-mono">ID: {editingOrder._id}</p>
                </div>

                {/* Tabs */}
                <div className="flex bg-surface-container-lowest/80 rounded-xl p-1 border border-outline-variant/20 ml-auto mr-4">
                  <button
                    type="button"
                    onClick={() => setEditTab('edit')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-semibold font-label-caps transition-all cursor-pointer ${
                      editTab === 'edit' ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    Edit Details
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditTab('history')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-semibold font-label-caps transition-all cursor-pointer ${
                      editTab === 'history' ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    Revision History
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleCloseEditModal}
                  className="w-8 h-8 rounded-full hover:bg-surface-variant flex items-center justify-center cursor-pointer text-on-surface-variant"
                >
                  <span className="material-symbols-outlined text-xl">close</span>
                </button>
              </div>

              {/* Error and Success Banners */}
              {editError && (
                <div className="bg-primary-container/20 border-b border-primary/20 text-primary px-6 py-3 text-sm flex items-center gap-2 font-medium">
                  <span className="material-symbols-outlined text-base">error</span>
                  <span className="flex-1">{editError}</span>
                  {editError.includes('Concurrency conflict') && (
                    <button
                      type="button"
                      onClick={handleReloadLatestOrder}
                      className="bg-primary text-on-primary text-xs px-3 py-1 rounded-lg font-semibold hover:bg-primary/95 cursor-pointer ml-4 flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-xs">sync</span>
                      Reload Latest
                    </button>
                  )}
                </div>
              )}
              {editSuccessMsg && (
                <div className="bg-green-500/10 border-b border-green-500/20 text-green-500 px-6 py-3 text-sm flex items-center gap-2 font-medium">
                  <span className="material-symbols-outlined text-base">check_circle</span>
                  <span>{editSuccessMsg}</span>
                </div>
              )}

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto p-6 pb-32 md:pb-6 app-overlay-scroll-body">
                {editTab === 'edit' ? (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                    {/* Left Column: Table/Location details & Add Item */}
                    <div className="md:col-span-5 space-y-4">
                      {/* Table / Location Selection */}
                      <div className="bg-surface-container-lowest/40 border border-outline-variant/20 rounded-2xl p-4 space-y-3">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant font-mono">Location & Table</h4>

                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-on-surface-variant">Select Table</label>
                          <select
                            value={editTableId}
                            onChange={(e) => setEditTableId(e.target.value)}
                            className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-3 py-2 text-base md:text-sm focus:outline-none focus:ring-1 focus:ring-primary text-on-surface"
                          >
                            <option value="">Choose Table...</option>
                            {editTables.map(t => (
                              <option key={t._id} value={t._id}>Table {t.number} ({t.location || 'Main'})</option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-on-surface-variant">Select Location (Optional)</label>
                          <select
                            value={editLocationId}
                            onChange={(e) => setEditLocationId(e.target.value)}
                            className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-3 py-2 text-base md:text-sm focus:outline-none focus:ring-1 focus:ring-primary text-on-surface"
                          >
                            <option value="">Choose Location...</option>
                            {editLocations.map(l => (
                              <option key={l._id} value={l._id}>{l.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Add Menu Items */}
                      <div className="bg-surface-container-lowest/40 border border-outline-variant/20 rounded-2xl p-4 space-y-3">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant font-mono">Add Items</h4>
                        <div className="relative">
                          <span className="material-symbols-outlined absolute left-3 top-2.5 text-on-surface-variant/70 text-base">search</span>
                          <input
                            type="text"
                            placeholder="Search menu..."
                            value={editMenuSearch}
                            onChange={(e) => handleSearchMenu(e.target.value)}
                            className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl pl-9 pr-3 py-2 text-base md:text-sm focus:outline-none focus:ring-1 focus:ring-primary text-on-surface"
                          />
                        </div>

                        {editMenuLoading ? (
                          <div className="flex justify-center py-4">
                            <span className="material-symbols-outlined text-primary text-lg animate-spin">progress_activity</span>
                          </div>
                        ) : editSearchResults.length > 0 ? (
                          <div className="max-h-48 overflow-y-auto border border-outline-variant/10 rounded-xl bg-surface-container-lowest divide-y divide-outline-variant/5">
                            {editSearchResults.map(menuItem => {
                              const isUnavailable = menuItem.available === false || menuItem.deleted === true;
                              const originalItem = editingOrder.items.find(i => String(i.id || i._id) === String(menuItem._id));
                              const disableAdd = isUnavailable && !originalItem;

                              return (
                                <div key={menuItem._id} className="flex justify-between items-center p-2.5 text-sm">
                                  <div className="truncate pr-2">
                                    <p className={`font-medium truncate ${isUnavailable ? 'text-on-surface-variant line-through' : ''}`}>
                                      {menuItem.name}
                                    </p>
                                    <p className="text-xs font-mono text-primary font-bold">₹{menuItem.price}</p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleAddItem(menuItem)}
                                    disabled={disableAdd}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer ${
                                      disableAdd
                                        ? 'bg-outline-variant/20 text-on-surface-variant cursor-not-allowed line-through'
                                        : 'bg-primary text-on-primary hover:bg-primary/90'
                                    }`}
                                  >
                                    {isUnavailable ? 'Out of Stock' : '+ Add'}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        ) : editMenuSearch.trim() ? (
                          <p className="text-xs text-on-surface-variant text-center py-2">No menu items found.</p>
                        ) : null}
                      </div>
                    </div>

                    {/* Right Column: Order Items Summary & Reason */}
                    <div className="md:col-span-7 flex flex-col gap-4">
                      <div className="bg-surface-container-lowest/40 border border-outline-variant/20 rounded-2xl p-4 flex-1 flex flex-col">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant font-mono mb-3">Amended Items Checklist</h4>

                        <div className="flex-1 overflow-y-auto max-h-[30vh] space-y-2.5 divide-y divide-outline-variant/5">
                          {Object.keys(editItems).length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-8 text-on-surface-variant">
                              <span className="material-symbols-outlined text-2xl mb-1">shopping_cart_off</span>
                              <p className="text-xs">No items in order. Add items from menu search.</p>
                            </div>
                          ) : (
                            Object.entries(editItems).map(([itemId, entry]) => {
                              const originalItem = editingOrder.items.find(i => String(i.id || i._id) === itemId);
                              const isUnavailable = entry.item.available === false || entry.item.deleted === true;
                              const disableIncrease = isUnavailable && originalItem && entry.quantity >= originalItem.quantity;

                              return (
                                <div key={itemId} className="flex justify-between items-center py-2 text-sm first:pt-0">
                                  <div className="truncate flex-1 pr-4">
                                    <p className={`font-semibold text-on-surface truncate ${isUnavailable ? 'text-on-surface-variant flex items-center gap-1' : ''}`}>
                                      {entry.item.name}
                                      {isUnavailable && (
                                        <span className="text-[9px] px-1 bg-amber-500/10 text-amber-500 rounded border border-amber-500/20 font-bold font-mono">UNAVAILABLE</span>
                                      )}
                                    </p>
                                    <p className="text-xs font-mono text-on-surface-variant">₹{entry.item.price} each</p>
                                  </div>

                                  <div className="flex items-center gap-3 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => handleUpdateItemQty(itemId, -1)}
                                      className="w-10 h-10 md:w-7 md:h-7 rounded-lg bg-surface-container-high border border-outline-variant/30 flex items-center justify-center font-bold text-on-surface-variant hover:bg-surface-variant cursor-pointer text-lg md:text-sm"
                                    >
                                      -
                                    </button>
                                    <span className="font-mono font-bold text-sm w-6 text-center text-primary bg-primary/10 px-1 py-0.5 rounded">
                                      {entry.quantity}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleUpdateItemQty(itemId, 1)}
                                      disabled={disableIncrease}
                                      className={`w-10 h-10 md:w-7 md:h-7 rounded-lg bg-surface-container-high border border-outline-variant/30 flex items-center justify-center font-bold text-on-surface-variant hover:bg-surface-variant cursor-pointer text-lg md:text-sm ${
                                        disableIncrease ? 'opacity-30 cursor-not-allowed' : ''
                                      }`}
                                    >
                                      +
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>

                        {/* Totals Preview */}
                        <div className="border-t border-outline-variant/30 pt-3 mt-3 space-y-1.5 text-right font-mono">
                          <p className="text-xs text-on-surface-variant/80 italic">
                            * Estimated Total: ₹{Object.values(editItems).reduce((sum, e) => sum + e.item.price * e.quantity, 0).toFixed(2)} (subject to final server validation)
                          </p>
                        </div>
                      </div>

                      {/* Reason Input */}
                      <div className="bg-surface-container-lowest/40 border border-outline-variant/20 rounded-2xl p-4 space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant font-mono">Reason for Amendment (Required)</label>
                        <textarea
                          placeholder="Provide the reason for this order amendment (5 to 500 characters)..."
                          value={editReason}
                          onChange={(e) => setEditReason(e.target.value)}
                          className="w-full h-16 bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-3 py-2 text-base md:text-sm focus:outline-none focus:ring-1 focus:ring-primary text-on-surface resize-none"
                          maxLength={500}
                        />
                        <div className="flex justify-between items-center text-[10px] font-mono text-on-surface-variant/60">
                          <span>Must be 5-500 characters</span>
                          <span className={editReason.trim().length < 5 || editReason.trim().length > 500 ? 'text-primary' : 'text-green-500'}>
                            {editReason.trim().length} chars
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Revision History Tab Content */
                  <div className="space-y-4">
                    {editRevisionsLoading ? (
                      <div className="flex flex-col items-center justify-center py-16">
                        <span className="material-symbols-outlined text-primary text-3xl animate-spin mb-2">progress_activity</span>
                        <p className="text-sm text-on-surface-variant font-mono">Loading revision history...</p>
                      </div>
                    ) : editRevisions.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 opacity-50">
                        <span className="material-symbols-outlined text-4xl mb-2">history</span>
                        <p className="text-sm font-semibold">No revision history found for this order</p>
                        <p className="text-xs text-on-surface-variant mt-1">Amendments will create version history records.</p>
                      </div>
                    ) : (
                      <>
                        <div className="space-y-3.5">
                          {editRevisions.map((rev) => (
                            <div key={rev._id} className="border border-outline-variant/20 rounded-2xl p-4 bg-surface-container-lowest/30 space-y-3 text-left">
                              {/* Meta Row */}
                              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/10 pb-2 text-xs">
                                <span className="font-bold text-primary font-mono text-sm bg-primary/10 px-2 py-0.5 rounded-lg">
                                  v{rev.newVersion} (from v{rev.prevVersion})
                                </span>
                                <span className="text-on-surface-variant flex items-center gap-1 font-mono">
                                  <span className="material-symbols-outlined text-sm">schedule</span>
                                  {new Date(rev.timestamp).toLocaleString()}
                                </span>
                                <span className="font-semibold text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded border border-outline-variant/15 flex items-center gap-1">
                                  <span className="material-symbols-outlined text-sm">person</span>
                                  {rev.actor.name} ({rev.actor.role})
                                </span>
                              </div>

                              {/* Reason */}
                              <div className="text-sm font-body-sm text-on-surface bg-surface-container-high/40 p-2.5 rounded-xl border border-outline-variant/10">
                                <strong className="text-xs uppercase text-on-surface-variant font-mono block mb-0.5">Amendment Reason:</strong>
                                "{rev.reason}"
                              </div>

                              {/* Diffs Summary */}
                              {rev.diff && (
                                <div className="space-y-1.5">
                                  <strong className="text-xs uppercase text-on-surface-variant font-mono block">Item Changes:</strong>
                                  <div className="flex flex-col gap-1 text-xs">
                                    {rev.diff.added?.map((item, i) => (
                                      <div key={`add-${i}`} className="flex items-center gap-1.5 text-green-500 font-medium font-mono">
                                        <span className="text-[10px] bg-green-500/10 px-1.5 py-0.5 rounded font-bold border border-green-500/20">ADDED</span>
                                        {item.name} x{item.quantity} (₹{item.price})
                                      </div>
                                    ))}
                                    {rev.diff.modified?.map((item, i) => (
                                      <div key={`mod-${i}`} className="flex items-center gap-1.5 text-amber-500 font-medium font-mono">
                                        <span className="text-[10px] bg-amber-500/10 px-1.5 py-0.5 rounded font-bold border border-amber-500/20">MODIFIED</span>
                                        {item.name} (x{item.prevQuantity} → x{item.newQuantity})
                                      </div>
                                    ))}
                                    {rev.diff.removed?.map((item, i) => (
                                      <div key={`rem-${i}`} className="flex items-center gap-1.5 text-primary font-medium font-mono">
                                        <span className="text-[10px] bg-primary/10 px-1.5 py-0.5 rounded font-bold border border-primary/20">REMOVED</span>
                                        {item.name} x{item.quantity}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* Pagination Controls */}
                        {editRevisionsTotal > 5 && (
                          <div className="flex justify-between items-center pt-2 font-mono text-xs text-on-surface-variant">
                            <button
                              type="button"
                              onClick={() => fetchRevisions(editingOrder._id, editRevisionsPage - 1)}
                              disabled={editRevisionsPage === 1}
                              className="px-3 py-1.5 rounded-lg border border-outline-variant/30 hover:bg-surface-container-high disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer font-bold"
                            >
                              &larr; Prev
                            </button>
                            <span>
                              Page {editRevisionsPage} of {Math.ceil(editRevisionsTotal / 5)} ({editRevisionsTotal} total)
                            </span>
                            <button
                              type="button"
                              onClick={() => fetchRevisions(editingOrder._id, editRevisionsPage + 1)}
                              disabled={editRevisionsPage >= Math.ceil(editRevisionsTotal / 5)}
                              className="px-3 py-1.5 rounded-lg border border-outline-variant/30 hover:bg-surface-container-high disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer font-bold"
                            >
                              Next &rarr;
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-surface-container-high border-t border-outline-variant/30 flex justify-between items-center app-overlay-footer pb-[calc(1rem+env(safe-area-inset-bottom))]">
                <span className="text-xs text-on-surface-variant/80 italic font-mono flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">shield</span>
                  Changes sent immediately to KDS
                </span>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleCloseEditModal}
                    className="px-5 py-2 rounded-xl text-sm font-semibold border border-outline-variant hover:bg-surface-variant cursor-pointer text-on-surface transition-all font-mono"
                  >
                    Close
                  </button>
                  {editTab === 'edit' && (
                    <button
                      type="button"
                      onClick={handleSaveAmendment}
                      disabled={editSubmitting || editReason.trim().length < 5}
                      className="px-5 py-2 rounded-xl text-sm font-semibold bg-primary text-on-primary hover:bg-primary/95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all flex items-center gap-1 font-mono"
                    >
                      {editSubmitting ? (
                        <>
                          <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                          Saving...
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-sm">done</span>
                          Save Changes
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCompleteAllConfirm && (
          <motion.div
            key="complete-all-confirm-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="app-overlay-backdrop bg-black/60 backdrop-blur-sm fixed inset-0 z-[100] flex items-center justify-center p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowCompleteAllConfirm(false);
              }
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="complete-all-dialog-title"
              className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-sm p-6 shadow-2xl app-modal-wrapper"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-error text-[24px]">done_all</span>
                </div>
                <h2
                  id="complete-all-dialog-title"
                  className="font-headline-sm text-on-surface text-[20px]"
                >
                  Complete all {completableOrders.length} active orders?
                </h2>
              </div>
              <p className="font-body-sm text-[14px] text-on-surface-variant/80 mb-6">
                This action will mark all active orders as completed and remove them from the Live KDS view.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCompleteAllConfirm(false)}
                  className="px-5 py-2 min-h-[44px] text-on-surface hover:text-primary font-label-caps text-[12px] uppercase tracking-widest rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCompleteAll}
                  disabled={isCompletingAll}
                  className="bg-error text-on-error px-6 py-2 min-h-[44px] rounded-lg font-label-caps text-[12px] uppercase tracking-widest flex items-center gap-2 disabled:opacity-60 outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
                >
                  {isCompletingAll ? (
                    <>
                      <span className="material-symbols-outlined text-[16px] animate-spin">
                        progress_activity
                      </span>
                      Completing...
                    </>
                  ) : (
                    'Complete All Orders'
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-2 px-4 py-3 rounded-xl border text-[13px] font-bold shadow-lg ${
              toast.type === 'success'
                ? 'bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400'
                : 'bg-error/10 border-error/30 text-error'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">
              {toast.type === 'success' ? 'check_circle' : 'error'}
            </span>
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

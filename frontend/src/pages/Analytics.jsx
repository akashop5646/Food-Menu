import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as THREE from 'three';
import { API_BASE } from '../config';

// Date utility helpers
const getLocalISODate = (date) => {
  if (!date) return '';
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - (offset * 60 * 1000));
  return localDate.toISOString().split('T')[0];
};

const getDateRangeBounds = (range, customStart, customEnd) => {
  const now = new Date();
  let start = new Date();
  let end = new Date();

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
        start = new Date(customStart);
        start.setHours(0, 0, 0, 0);
      } else {
        start.setHours(0, 0, 0, 0);
      }
      if (customEnd) {
        end = new Date(customEnd);
        end.setHours(23, 59, 59, 999);
      } else {
        end.setHours(23, 59, 59, 999);
      }
      if (start > end) {
        end = new Date(start);
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

const getPreviousPeriodBounds = (start, end) => {
  const durationMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { start: prevStart, end: prevEnd };
};

const calculatePercentageChange = (current, previous) => {
  if (previous === 0) {
    if (current > 0) {
      return { type: 'new', percentage: 0, text: 'New activity' };
    }
    return { type: 'neutral', percentage: 0, text: 'No change' };
  }
  const change = ((current - previous) / previous) * 100;
  if (change > 0) {
    return { type: 'increase', percentage: Number(change.toFixed(1)), text: `+${change.toFixed(1)}%` };
  } else if (change < 0) {
    return { type: 'decrease', percentage: Number(Math.abs(change).toFixed(1)), text: `-${Math.abs(change).toFixed(1)}%` };
  }
  return { type: 'neutral', percentage: 0, text: '0.0%' };
};

const getOrderDate = (order) => {
  if (!order) return null;
  const dateStr = order.paymentStatus === 'PAID' && order.paidAt ? order.paidAt : order.createdAt;
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
};

const isOrderWithinRange = (order, start, end) => {
  const orderDate = getOrderDate(order);
  if (!orderDate) return false;
  return orderDate >= start && orderDate <= end;
};

export default function Analytics() {
  const [orders, setOrders] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(new Date());
  const [fetchError, setFetchError] = useState(false);
  const [timeRange, setTimeRange] = useState('7d'); // today, yesterday, 7d, 30d, this_month, custom

  // Custom range selection states
  const [customStartDate, setCustomStartDate] = useState(getLocalISODate(new Date()));
  const [customEndDate, setCustomEndDate] = useState(getLocalISODate(new Date()));

  // Interactive chart hovers
  const [activeCategoryIndex, setActiveCategoryIndex] = useState(null);
  const [activeBarIndex, setActiveBarIndex] = useState(null);

  // Prefers-reduced-motion reactivity
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  const mountRef = useRef(null);
  const isFetchInFlightRef = useRef(false);
  const activeRequestIdRef = useRef(0);
  const ordersAbortControllerRef = useRef(null);
  const menuAbortControllerRef = useRef(null);

  // Listen to prefers-reduced-motion changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const listener = (e) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }, []);

  // Fetch Menu Items (only once on mount)
  useEffect(() => {
    const fetchMenuItems = async () => {
      const controller = new AbortController();
      menuAbortControllerRef.current = controller;

      try {
        const menuRes = await fetch(API_BASE + '/api/menu?all=true', {
          signal: controller.signal
        });
        if (menuRes.ok) {
          const menuData = await menuRes.json();
          setMenuItems(menuData);
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Failed to fetch menu items:', err);
        }
      }
    };

    fetchMenuItems();

    return () => {
      if (menuAbortControllerRef.current) {
        menuAbortControllerRef.current.abort();
      }
    };
  }, []);

  // Fetch Orders function (prevents parallel requests)
  const fetchOrders = useCallback(async (isManual = false) => {
    if (isFetchInFlightRef.current) {
      return; // Skip if already fetching
    }

    isFetchInFlightRef.current = true;
    if (isManual) {
      setRefreshing(true);
    }

    // Increment request ID and capture it locally in closure
    activeRequestIdRef.current += 1;
    const requestId = activeRequestIdRef.current;

    // Cancel any stale order requests
    if (ordersAbortControllerRef.current) {
      ordersAbortControllerRef.current.abort();
    }

    const controller = new AbortController();
    ordersAbortControllerRef.current = controller;

    try {
      const ordersRes = await fetch(API_BASE + '/api/orders', {
        credentials: 'include',
        signal: controller.signal
      });

      if (ordersRes.ok) {
        const ordersData = await ordersRes.json();
        // Guard state updates: only write if this request is still the active/latest one
        if (activeRequestIdRef.current === requestId) {
          setOrders(ordersData);
          setLastUpdatedAt(new Date());
          setFetchError(false);
        }
      } else {
        if (activeRequestIdRef.current === requestId) {
          setFetchError(true);
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Failed to fetch orders:', err);
        if (activeRequestIdRef.current === requestId) {
          setFetchError(true);
        }
      }
    } finally {
      // Guard cleanup updates: only clear indicators if this request is still the active/latest one
      if (activeRequestIdRef.current === requestId) {
        isFetchInFlightRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // Initial fetch on mount
  useEffect(() => {
    fetchOrders(false);
  }, [fetchOrders]);

  // Cleanup in-flight requests on component unmount
  useEffect(() => {
    return () => {
      if (ordersAbortControllerRef.current) {
        ordersAbortControllerRef.current.abort();
      }
    };
  }, []);

  // Page visibility & Polling handler (60s fallback interval)
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) {
        fetchOrders(false);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    const intervalId = setInterval(() => {
      if (!document.hidden) {
        fetchOrders(false);
      }
    }, 60000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(intervalId);
    };
  }, [fetchOrders]);

  // Freshness tick counter (Updates every 30 seconds to prevent unnecessary re-renders)
  const [secondsSinceUpdate, setSecondsSinceUpdate] = useState(0);

  useEffect(() => {
    setSecondsSinceUpdate(0);
    const tick = setInterval(() => {
      setSecondsSinceUpdate(prev => prev + 30);
    }, 30000);
    return () => clearInterval(tick);
  }, [lastUpdatedAt]);

  const freshnessText = useMemo(() => {
    if (secondsSinceUpdate < 30) return 'Updated just now';
    if (secondsSinceUpdate < 60) return 'Updated 30 seconds ago';
    const mins = Math.floor(secondsSinceUpdate / 60);
    return `Updated ${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`;
  }, [secondsSinceUpdate]);

  // Centralized calculations & Memoization
  const dateBounds = useMemo(() => {
    return getDateRangeBounds(timeRange, customStartDate, customEndDate);
  }, [timeRange, customStartDate, customEndDate]);

  const previousPeriodBounds = useMemo(() => {
    return getPreviousPeriodBounds(dateBounds.start, dateBounds.end);
  }, [dateBounds]);

  // Filtered orders for current and previous bounds
  const filteredOrders = useMemo(() => {
    return orders.filter(order => isOrderWithinRange(order, dateBounds.start, dateBounds.end));
  }, [orders, dateBounds]);

  const previousOrders = useMemo(() => {
    return orders.filter(order => isOrderWithinRange(order, previousPeriodBounds.start, previousPeriodBounds.end));
  }, [orders, previousPeriodBounds]);

  // Paid/Completed Orders
  const completedOrders = useMemo(() => {
    return filteredOrders.filter(o => o.paymentStatus === 'PAID');
  }, [filteredOrders]);

  const previousCompletedOrders = useMemo(() => {
    return previousOrders.filter(o => o.paymentStatus === 'PAID');
  }, [previousOrders]);

  // Live operational metrics (remain unfiltered by date bounds)
  const activeOrdersCount = useMemo(() => {
    return orders.filter(o => o.status !== 'COMPLETED' && o.status !== 'CANCELLED').length;
  }, [orders]);

  const activeTablesCount = useMemo(() => {
    return new Set(orders.filter(o => o.status !== 'COMPLETED' && o.status !== 'CANCELLED').map(o => o.table)).size;
  }, [orders]);

  // Revenue (using order.total to preserve existing food subtotal financial definition)
  const totalRevenue = useMemo(() => {
    return completedOrders.reduce((sum, o) => sum + (o.total ?? 0), 0);
  }, [completedOrders]);

  const previousRevenue = useMemo(() => {
    return previousCompletedOrders.reduce((sum, o) => sum + (o.total ?? 0), 0);
  }, [previousCompletedOrders]);

  // Volumes
  const completedOrdersCount = useMemo(() => {
    return completedOrders.length;
  }, [completedOrders]);

  const previousCompletedCount = useMemo(() => {
    return previousCompletedOrders.length;
  }, [previousCompletedOrders]);

  // Average Order Values
  const avgOrderValue = useMemo(() => {
    return completedOrdersCount > 0 ? totalRevenue / completedOrdersCount : 0;
  }, [completedOrdersCount, totalRevenue]);

  const previousAvgOrderValue = useMemo(() => {
    return previousCompletedCount > 0 ? previousRevenue / previousCompletedCount : 0;
  }, [previousCompletedCount, previousRevenue]);

  // growth/comparison percentages
  const revenueChange = useMemo(() => {
    return calculatePercentageChange(totalRevenue, previousRevenue);
  }, [totalRevenue, previousRevenue]);

  const completedOrdersChange = useMemo(() => {
    return calculatePercentageChange(completedOrdersCount, previousCompletedCount);
  }, [completedOrdersCount, previousCompletedCount]);

  const avgOrderValueChange = useMemo(() => {
    return calculatePercentageChange(avgOrderValue, previousAvgOrderValue);
  }, [avgOrderValue, previousAvgOrderValue]);

  // Popular Dishes (aggregates count and revenue per dish)
  const popularDishes = useMemo(() => {
    const stats = {};
    filteredOrders.forEach(order => {
      if (order.status !== 'CANCELLED') {
        order.items.forEach(item => {
          if (!stats[item.name]) {
            stats[item.name] = { count: 0, revenue: 0 };
          }
          const qty = item.quantity || 1;
          const price = item.price || 0;
          stats[item.name].count += qty;
          stats[item.name].revenue += price * qty;
        });
      }
    });

    return Object.entries(stats)
      .map(([name, val]) => ({ name, count: val.count, revenue: val.revenue }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [filteredOrders]);

  const maxDishCount = useMemo(() => {
    return popularDishes.length > 0 ? popularDishes[0].count : 1;
  }, [popularDishes]);

  // Category splits map
  const menuLookup = useMemo(() => {
    const lookup = {};
    menuItems.forEach(item => {
      lookup[item.name] = item.categories || (item.category ? [item.category] : []);
    });
    return lookup;
  }, [menuItems]);

  const categoryColors = {
    'Starters': '#f2ca50',       // Light Gold
    'Afternoon meal': '#d4af37',  // Metallic Gold
    'Evening': '#ffe088',         // Champagne
    'Veg': '#4caf50',             // Green
    'Non Veg': '#ef5350',         // Red
    'Uncategorized': '#8e8e93'    // Muted Gray
  };

  const categoryData = useMemo(() => {
    const split = {};
    completedOrders.forEach(order => {
      order.items.forEach(item => {
        const itemCats = menuLookup[item.name] || [];
        const price = item.price ?? 0;
        const qty = item.quantity ?? 1;
        if (itemCats && itemCats.length > 0) {
          itemCats.forEach(cat => {
            split[cat] = (split[cat] || 0) + ((price * qty) / itemCats.length);
          });
        } else {
          split['Uncategorized'] = (split['Uncategorized'] || 0) + (price * qty);
        }
      });
    });

    return Object.entries(split).map(([name, value]) => ({
      name,
      value,
      color: categoryColors[name] || '#8e8e93'
    }));
  }, [completedOrders, menuLookup]);

  const totalCatRevenue = useMemo(() => {
    return categoryData.reduce((sum, c) => sum + c.value, 0);
  }, [categoryData]);

  // Dynamic Sales trend (splits hourly for <=2 days, daily for longer ranges)
  const trendData = useMemo(() => {
    const { start, end } = dateBounds;
    const durationMs = end.getTime() - start.getTime();
    const durationDays = Math.ceil(durationMs / (24 * 60 * 60 * 1000));

    if (durationDays <= 2) {
      // Hourly trend buckets
      const buckets = Array.from({ length: 24 }, (_, i) => ({
        label: `${i.toString().padStart(2, '0')}:00`,
        value: 0
      }));

      completedOrders.forEach(o => {
        const orderDate = getOrderDate(o);
        if (!orderDate) return;
        const hour = orderDate.getHours();
        if (hour >= 0 && hour < 24) {
          buckets[hour].value += (o.total ?? 0);
        }
      });
      return buckets;
    } else {
      // Daily trend buckets
      const buckets = [];
      const current = new Date(start);
      while (current <= end) {
        const dayStart = new Date(current.getFullYear(), current.getMonth(), current.getDate(), 0, 0, 0, 0);
        const dayEnd = new Date(current.getFullYear(), current.getMonth(), current.getDate(), 23, 59, 59, 999);
        buckets.push({
          label: current.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          shortLabel: current.toLocaleDateString(undefined, { weekday: 'short' }),
          start: dayStart,
          end: dayEnd,
          value: 0
        });
        current.setDate(current.getDate() + 1);
      }

      completedOrders.forEach(o => {
        const orderDate = getOrderDate(o);
        if (!orderDate) return;
        const val = o.total ?? 0;
        for (let i = 0; i < buckets.length; i++) {
          if (orderDate >= buckets[i].start && orderDate <= buckets[i].end) {
            buckets[i].value += val;
            break;
          }
        }
      });

      return buckets.map(b => ({
        day: buckets.length > 8 ? b.label : b.shortLabel,
        value: b.value
      }));
    }
  }, [completedOrders, dateBounds]);

  const maxTrendValue = useMemo(() => {
    return Math.max(...trendData.map(t => t.value), 100);
  }, [trendData]);

  // Peak Hours distribution analysis (24 buckets, local restaurant time)
  const peakHoursData = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, i) => ({
      hour: `${i.toString().padStart(2, '0')}:00`,
      count: 0,
      revenue: 0
    }));

    completedOrders.forEach(o => {
      const orderDate = getOrderDate(o);
      if (!orderDate) return;
      const hour = orderDate.getHours();
      if (hour >= 0 && hour < 24) {
        buckets[hour].count += 1;
        buckets[hour].revenue += (o.total ?? 0);
      }
    });

    return buckets;
  }, [completedOrders]);

  const peakHourStats = useMemo(() => {
    let maxCount = 0;
    let peakHour = null;
    peakHoursData.forEach(b => {
      if (b.count > maxCount) {
        maxCount = b.count;
        peakHour = b.hour;
      }
    });
    return { peakHour, maxCount };
  }, [peakHoursData]);

  // Three.js Canvas initialization and animation loop
  useEffect(() => {
    const currentMount = mountRef.current;
    if (!currentMount || loading) return;

    // Scene Setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, currentMount.clientWidth / currentMount.clientHeight, 0.1, 100);
    camera.position.z = 4.5;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    currentMount.appendChild(renderer.domElement);

    const particlesCount = 200;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particlesCount * 3);
    const colors = new Float32Array(particlesCount * 3);

    const goldShades = [
      new THREE.Color('#d4af37'),
      new THREE.Color('#f2ca50'),
      new THREE.Color('#f3e5ab'),
    ];

    for (let i = 0; i < particlesCount * 3; i += 3) {
      const index = i / 3;
      const phi = Math.acos(1 - 2 * (index + 0.5) / particlesCount);
      const theta = Math.PI * (1 + Math.sqrt(5)) * index;
      const r = 1.8 + Math.random() * 0.4;

      positions[i] = r * Math.sin(phi) * Math.cos(theta);
      positions[i + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i + 2] = r * Math.cos(phi);

      const color = goldShades[Math.floor(Math.random() * goldShades.length)];
      colors[i] = color.r;
      colors[i + 1] = color.g;
      colors[i + 2] = color.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 16, 16);
    const particleTexture = new THREE.CanvasTexture(canvas);

    const material = new THREE.PointsMaterial({
      size: 0.12,
      map: particleTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true
    });

    const particleSystem = new THREE.Points(geometry, material);
    scene.add(particleSystem);

    let mouseX = 0;
    let mouseY = 0;
    let targetX = 0;
    let targetY = 0;

    const onMouseMove = (event) => {
      const rect = currentMount.getBoundingClientRect();
      mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    currentMount.addEventListener('mousemove', onMouseMove);

    const clock = new THREE.Clock();
    let animationId = null;
    let isLoopRunning = false;

    const renderSingleFrame = () => {
      renderer.render(scene, camera);
    };

    const animate = () => {
      if (prefersReducedMotion || document.hidden) {
        isLoopRunning = false;
        return;
      }
      animationId = requestAnimationFrame(animate);
      isLoopRunning = true;

      const elapsed = clock.getElapsedTime();
      particleSystem.rotation.y = elapsed * 0.12;
      particleSystem.rotation.x = elapsed * 0.05;

      targetX += (mouseX - targetX) * 0.08;
      targetY += (mouseY - targetY) * 0.08;

      particleSystem.rotation.y += targetX * 0.6;
      particleSystem.rotation.x -= targetY * 0.6;

      renderer.render(scene, camera);
    };

    const startLoopIfNeeded = () => {
      if (prefersReducedMotion) {
        renderSingleFrame();
      } else if (!document.hidden && !isLoopRunning) {
        animate();
      }
    };

    const stopLoop = () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
      isLoopRunning = false;
    };

    startLoopIfNeeded();

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopLoop();
      } else {
        startLoopIfNeeded();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const handleResize = () => {
      if (!currentMount) return;
      camera.aspect = currentMount.clientWidth / currentMount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
      renderSingleFrame();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      currentMount.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopLoop();
      if (currentMount && currentMount.contains(renderer.domElement)) {
        currentMount.removeChild(renderer.domElement);
      }
      geometry.dispose();
      material.dispose();
      particleTexture.dispose();
      renderer.dispose();
    };
  }, [loading, prefersReducedMotion]);

  // Comparison UI helper
  const renderComparison = (change) => {
    if (change.type === 'increase') {
      return (
        <p className="text-xs text-green-500 flex items-center gap-1 mt-4 font-semibold">
          <span className="material-symbols-outlined text-[13px]">trending_up</span>
          <span>{change.text} vs previous period</span>
        </p>
      );
    }
    if (change.type === 'decrease') {
      return (
        <p className="text-xs text-red-500 flex items-center gap-1 mt-4 font-semibold">
          <span className="material-symbols-outlined text-[13px]">trending_down</span>
          <span>{change.text} vs previous period</span>
        </p>
      );
    }
    if (change.type === 'new') {
      return (
        <p className="text-xs text-primary flex items-center gap-1 mt-4 font-semibold">
          <span className="material-symbols-outlined text-[13px]">fiber_new</span>
          <span>New activity vs previous period</span>
        </p>
      );
    }
    return (
      <p className="text-xs text-on-surface-variant/80 flex items-center gap-1 mt-4 font-semibold">
        <span className="material-symbols-outlined text-[13px]">trending_flat</span>
        <span>No change vs previous period</span>
      </p>
    );
  };

  let accumulatedAngle = 0;

  return (
    <div className="space-y-6">
      {/* Top Header & Freshness Control */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-4">
        <div>
          <h1 className="font-headline-md text-2xl text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">analytics</span>
            Restaurant Analytics
          </h1>
          <p className="font-body-md text-on-surface-variant mt-1">
            Real-time business intelligence and performance metrics.
          </p>
        </div>

        <div className="flex flex-col sm:items-end gap-2.5 self-start sm:self-auto">
          {/* Freshness Indicator & Manual Refresh */}
          <div className="flex items-center gap-3 text-xs text-on-surface-variant/80 font-mono bg-surface-container/20 border border-outline-variant/10 px-3 py-1.5 rounded-xl shadow-sm">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${refreshing ? 'bg-primary animate-ping' : 'bg-green-500'}`} />
              <span>{refreshing ? 'Refreshing...' : freshnessText}</span>
            </div>
            <button
              onClick={() => fetchOrders(true)}
              disabled={refreshing}
              className={`p-1 rounded-lg border border-outline-variant/30 transition-all flex items-center justify-center ${
                refreshing ? 'opacity-50 cursor-not-allowed text-primary' : 'text-on-surface-variant hover:text-primary hover:bg-surface-container-high'
              }`}
              title={refreshing ? 'Refreshing...' : 'Refresh data'}
            >
              <span className={`material-symbols-outlined text-[16px] ${refreshing ? 'animate-spin' : ''}`}>
                refresh
              </span>
            </button>
          </div>

          {/* Preset Selector Dropdown */}
          <div className="relative w-full sm:w-auto">
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="bg-surface-container border border-outline-variant/30 text-on-surface rounded-xl px-4 py-2 text-xs font-label-caps uppercase tracking-wider font-semibold focus:outline-none focus:border-primary cursor-pointer transition-all w-full sm:w-auto shadow-sm"
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="this_month">This Month</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>
        </div>
      </div>

      {/* Error Alert Banner */}
      {fetchError && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 text-xs text-red-500 bg-red-500/10 border border-red-500/20 px-4 py-3 rounded-xl shadow-sm"
        >
          <span className="material-symbols-outlined text-[16px]">error</span>
          <span>Failed to fetch live updates. Displaying cached dashboard data.</span>
        </motion.div>
      )}

      {/* Custom Date Inputs (when Custom Range selected) */}
      {timeRange === 'custom' && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap items-center gap-4 bg-surface-container/40 p-4 rounded-xl border border-outline-variant/10 w-full"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-label-caps uppercase tracking-widest text-on-surface-variant/70 font-bold">Start Date</label>
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              className="bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-1.5 text-xs text-on-surface focus:outline-none focus:border-primary transition-all font-mono"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-label-caps uppercase tracking-widest text-on-surface-variant/70 font-bold">End Date</label>
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              className="bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-1.5 text-xs text-on-surface focus:outline-none focus:border-primary transition-all font-mono"
            />
          </div>
          {new Date(customStartDate) > new Date(customEndDate) && (
            <span className="text-[11px] text-red-500 font-semibold self-end mb-2">
              Start date cannot be after end date.
            </span>
          )}
        </motion.div>
      )}

      {loading ? (
        <div className="flex justify-center items-center py-32">
          <span className="material-symbols-outlined text-primary text-5xl animate-spin">progress_activity</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {/* Bento Box 1: KPI Metrics Panel */}
          <div className="md:col-span-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-6">
            {/* Revenue Metric */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-surface-container rounded-2xl p-4 md:p-6 border border-outline-variant/10 flex flex-col justify-between hover:border-primary/30 transition-all group shadow-sm"
            >
              <div>
                <span className="material-symbols-outlined text-primary text-3xl group-hover:scale-110 transition-transform">monetization_on</span>
                <p className="text-on-surface-variant font-label-caps text-xs font-bold uppercase tracking-wider mt-4">Total Revenue</p>
                <h3 className="font-headline-md text-2xl text-primary font-bold mt-2">₹{totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
              </div>
              {renderComparison(revenueChange)}
            </motion.div>

            {/* Volume Metric */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="bg-surface-container rounded-2xl p-4 md:p-6 border border-outline-variant/10 flex flex-col justify-between hover:border-primary/30 transition-all group shadow-sm"
            >
              <div>
                <span className="material-symbols-outlined text-primary text-3xl group-hover:scale-110 transition-transform">task_alt</span>
                <p className="text-on-surface-variant font-label-caps text-xs font-bold uppercase tracking-wider mt-4">Completed Orders</p>
                <h3 className="font-headline-md text-2xl text-on-surface font-bold mt-2">{completedOrdersCount}</h3>
              </div>
              {renderComparison(completedOrdersChange)}
            </motion.div>

            {/* Avg Order Value */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-surface-container rounded-2xl p-4 md:p-6 border border-outline-variant/10 flex flex-col justify-between hover:border-primary/30 transition-all group shadow-sm"
            >
              <div>
                <span className="material-symbols-outlined text-primary text-3xl group-hover:scale-110 transition-transform">shopping_bag</span>
                <p className="text-on-surface-variant font-label-caps text-xs font-bold uppercase tracking-wider mt-4">Avg Order Value</p>
                <h3 className="font-headline-md text-2xl text-on-surface font-bold mt-2">₹{avgOrderValue.toFixed(2)}</h3>
              </div>
              {renderComparison(avgOrderValueChange)}
            </motion.div>

            {/* Active Orders (Live, Operational) */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="bg-surface-container rounded-2xl p-4 md:p-6 border border-outline-variant/10 flex flex-col justify-between hover:border-primary/30 transition-all group shadow-sm"
            >
              <div>
                <span className="material-symbols-outlined text-primary text-3xl group-hover:scale-110 transition-transform">pending_actions</span>
                <p className="text-on-surface-variant font-label-caps text-xs font-bold uppercase tracking-wider mt-4">Active Orders</p>
                <h3 className="font-headline-md text-2xl text-on-surface font-bold mt-2">{activeOrdersCount}</h3>
              </div>
              <p className="text-xs text-on-surface-variant/80 flex items-center gap-1 mt-4 font-medium">
                <span className="material-symbols-outlined text-[13px]">info</span>
                <span>In preparation or ready</span>
              </p>
            </motion.div>

            {/* Occupied Tables (Live, Operational) */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-surface-container rounded-2xl p-4 md:p-6 border border-outline-variant/10 flex flex-col justify-between hover:border-primary/30 transition-all group shadow-sm"
            >
              <div>
                <span className="material-symbols-outlined text-primary text-3xl group-hover:scale-110 transition-transform">table_bar</span>
                <p className="text-on-surface-variant font-label-caps text-xs font-bold uppercase tracking-wider mt-4">Occupied Tables</p>
                <h3 className="font-headline-md text-2xl text-on-surface font-bold mt-2">{activeTablesCount}</h3>
              </div>
              <p className="text-xs text-primary flex items-center gap-1 mt-4 font-semibold">
                <span className="material-symbols-outlined text-[13px]">qr_code</span>
                <span>Active scanning sessions</span>
              </p>
            </motion.div>
          </div>

          {/* Bento Box 2: 3D Realtime Pulse (Three.js Visualizer) */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="md:col-span-3 lg:col-span-1 bg-surface-container rounded-2xl p-4 md:p-6 border border-outline-variant/10 flex flex-col items-center justify-between relative overflow-hidden shadow-sm"
          >
            <div className="w-full">
              <h4 className="font-title-md text-on-surface text-base flex items-center gap-1.5">
                <span className="material-symbols-outlined text-primary text-lg">animated_images</span>
                3D Activity Sphere
              </h4>
              <p className="text-xs text-on-surface-variant/60 mt-1">Interactive live feed visualizer.</p>
            </div>
            
            <div 
              ref={mountRef} 
              className="w-full h-44 cursor-grab active:cursor-grabbing relative z-10"
              title="Move your mouse over the sphere to interact"
            />
            
            <div className="w-full text-center z-10">
              <p className="text-[10px] font-mono text-primary tracking-widest uppercase animate-pulse">Websocket Channel Connected</p>
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-primary/5 via-transparent to-transparent pointer-events-none" />
          </motion.div>

          {/* Bento Box 3: Revenue Trend Line Chart */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="md:col-span-2 bg-surface-container rounded-2xl p-4 md:p-6 border border-outline-variant/10 flex flex-col justify-between shadow-sm"
          >
            <div>
              <h4 className="font-title-md text-on-surface text-base flex items-center gap-1.5">
                <span className="material-symbols-outlined text-primary text-lg">monitoring</span>
                Sales & Revenue Trend
              </h4>
              <p className="text-xs text-on-surface-variant/60 mt-1">Paid customer collections split by intervals.</p>
            </div>

            {completedOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-on-surface-variant/50">
                <span className="material-symbols-outlined text-4xl">analytics</span>
                <p className="text-xs mt-2 text-center px-4">No completed orders in this period yet. Analytics will appear as orders are completed.</p>
              </div>
            ) : (
              <div className="w-full h-56 mt-6 relative">
                {(() => {
                  const chartWidth = 500;
                  const chartHeight = 200;
                  const paddingX = 55;
                  const paddingY = 25;

                  const divisor = trendData.length > 1 ? trendData.length - 1 : 1;
                  const points = trendData.map((data, index) => {
                    const x = paddingX + (index * (chartWidth - paddingX * 2)) / divisor;
                    const y = chartHeight - paddingY - (data.value / maxTrendValue) * (chartHeight - paddingY * 2);
                    return { x, y, day: data.day, value: data.value };
                  });

                  const getCurvePath = (pts) => {
                    if (pts.length === 0) return '';
                    let d = `M ${pts[0].x} ${pts[0].y}`;
                    for (let i = 0; i < pts.length - 1; i++) {
                      const p0 = pts[i];
                      const p1 = pts[i + 1];
                      const cpX1 = p0.x + (p1.x - p0.x) / 3;
                      const cpY1 = p0.y;
                      const cpX2 = p0.x + 2 * (p1.x - p0.x) / 3;
                      const cpY2 = p1.y;
                      d += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${p1.x} ${p1.y}`;
                    }
                    return d;
                  };

                  const getAreaPath = (pts) => {
                    const curve = getCurvePath(pts);
                    if (!curve) return '';
                    return `${curve} L ${pts[pts.length - 1].x} ${chartHeight - paddingY} L ${pts[0].x} ${chartHeight - paddingY} Z`;
                  };

                  return (
                    <svg className="w-full h-full text-on-surface" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMidYMid meet">
                      <defs>
                        <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#d4af37" stopOpacity="0.25" />
                          <stop offset="100%" stopColor="#d4af37" stopOpacity="0.0" />
                        </linearGradient>
                        <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#ffe088" />
                          <stop offset="50%" stopColor="#d4af37" />
                          <stop offset="100%" stopColor="#f2ca50" />
                        </linearGradient>
                      </defs>

                      {/* Y-Axis Labels */}
                      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                        const yVal = chartHeight - paddingY - ratio * (chartHeight - paddingY * 2);
                        const labelVal = ratio * maxTrendValue;
                        return (
                          <g key={ratio} className="opacity-75">
                            <text
                              x={10}
                              y={yVal + 4}
                              fill="currentColor"
                              className="text-[11px] font-mono font-bold text-on-surface-variant/50"
                            >
                              ₹{labelVal >= 1000 ? `${(labelVal / 1000).toFixed(1)}k` : labelVal.toFixed(0)}
                            </text>
                            <line
                              x1={paddingX}
                              y1={yVal}
                              x2={chartWidth - paddingX}
                              y2={yVal}
                              stroke="currentColor"
                              strokeWidth="0.5"
                              className="text-outline-variant/10"
                            />
                          </g>
                        );
                      })}

                      {/* Gradient Area Fill */}
                      {points.length > 0 && (
                        <path d={getAreaPath(points)} fill="url(#chartGradient)" />
                      )}

                      {/* Stroke Line Path */}
                      {points.length > 0 && (
                        <motion.path
                          d={getCurvePath(points)}
                          fill="none"
                          stroke="url(#lineGradient)"
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          initial={prefersReducedMotion ? { pathLength: 1 } : { pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={prefersReducedMotion ? { duration: 0 } : { duration: 1.2, ease: 'easeOut' }}
                        />
                      )}

                      {/* Vertical Hover Guide Line */}
                      {activeBarIndex !== null && points[activeBarIndex] && (
                        <line
                          x1={points[activeBarIndex].x}
                          y1={paddingY}
                          x2={points[activeBarIndex].x}
                          y2={chartHeight - paddingY}
                          stroke="#d4af37"
                          strokeWidth="1"
                          strokeDasharray="4,4"
                          className="opacity-70"
                        />
                      )}

                      {/* Circular Dots */}
                      {points.map((pt, idx) => (
                        <g key={`${pt.day}-${idx}`}>
                          <circle
                            cx={pt.x}
                            cy={pt.y}
                            r="4"
                            fill="#1c1d22"
                            stroke="#d4af37"
                            strokeWidth="2.5"
                          />
                          {activeBarIndex === idx && (
                            <>
                              <circle cx={pt.x} cy={pt.y} r="8" fill="transparent" stroke="#d4af37" strokeWidth="1.5" className="animate-ping" />
                              <circle cx={pt.x} cy={pt.y} r="5" fill="#ffe088" stroke="#d4af37" strokeWidth="1.5" />
                            </>
                          )}
                        </g>
                      ))}

                      {/* X-Axis Interval Labels */}
                      {points.map((pt, idx) => {
                        const modulo = points.length > 15 ? 4 : points.length > 8 ? 2 : 1;
                        if (idx % modulo !== 0) return null;
                        return (
                          <text
                            key={`${pt.day}-${idx}`}
                            x={pt.x}
                            y={chartHeight - 6}
                            textAnchor="middle"
                            fill="currentColor"
                            className="text-[10px] font-label-caps font-bold text-on-surface-variant/80"
                          >
                            {pt.day}
                          </text>
                        );
                      })}

                      {/* Hover Trigger Blocks */}
                      {points.map((pt, idx) => {
                        const width = chartWidth / points.length;
                        return (
                          <rect
                            key={`hit-${pt.day}-${idx}`}
                            x={pt.x - width / 2}
                            y={0}
                            width={width}
                            height={chartHeight}
                            fill="transparent"
                            className="cursor-pointer"
                            onMouseEnter={() => setActiveBarIndex(idx)}
                            onMouseLeave={() => setActiveBarIndex(null)}
                          />
                        );
                      })}

                      {/* SVG Tooltip */}
                      {activeBarIndex !== null && points[activeBarIndex] && (
                        <foreignObject
                          x={Math.max(10, Math.min(chartWidth - 130, points[activeBarIndex].x - 60))}
                          y={Math.max(5, points[activeBarIndex].y - 55)}
                          width={120}
                          height={50}
                          className="overflow-visible pointer-events-none"
                        >
                          <div className="bg-surface-container-highest/95 border border-primary/30 px-2.5 py-1 rounded-xl shadow-xl text-center backdrop-blur-md w-full">
                            <p className="text-[9px] font-bold text-on-surface-variant/80 uppercase tracking-widest font-label-caps">{points[activeBarIndex].day}</p>
                            <p className="text-xs font-bold text-primary font-mono mt-0.5">₹{points[activeBarIndex].value.toLocaleString()}</p>
                          </div>
                        </foreignObject>
                      )}
                    </svg>
                  );
                })()}
              </div>
            )}
          </motion.div>

          {/* Bento Box 4: Category Share Donut Chart */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="md:col-span-1 bg-surface-container rounded-2xl p-4 md:p-6 border border-outline-variant/10 flex flex-col justify-between shadow-sm"
          >
            <div>
              <h4 className="font-title-md text-on-surface text-base flex items-center gap-1.5">
                <span className="material-symbols-outlined text-primary text-lg">donut_large</span>
                Category Share
              </h4>
              <p className="text-xs text-on-surface-variant/60 mt-1">Revenue split per product class.</p>
            </div>

            {completedOrders.length === 0 || categoryData.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant/50">
                <span className="material-symbols-outlined text-4xl">pie_chart</span>
                <p className="text-xs mt-2 text-center px-4">No completed orders in this period yet. Analytics will appear as orders are completed.</p>
              </div>
            ) : (
              <div className="flex flex-col items-center py-4">
                <div className="relative w-36 h-36">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" fill="transparent" stroke="#252528" strokeWidth="8" />
                    {categoryData.map((slice, index) => {
                      const percentage = slice.value / (totalCatRevenue || 1);
                      const strokeCirc = 2 * Math.PI * 40;
                      const strokeOffset = strokeCirc - (percentage * strokeCirc);
                      const rotation = (accumulatedAngle / (totalCatRevenue || 1)) * 360;
                      accumulatedAngle += slice.value;

                      return (
                        <circle
                          key={slice.name}
                          cx="50"
                          cy="50"
                          r="40"
                          fill="transparent"
                          stroke={slice.color}
                          strokeWidth={activeCategoryIndex === index ? "10" : "8"}
                          strokeDasharray={strokeCirc}
                          strokeDashoffset={strokeOffset}
                          transform={`rotate(${rotation} 50 50)`}
                          className="transition-all duration-300 cursor-pointer"
                          onMouseEnter={() => setActiveCategoryIndex(index)}
                          onMouseLeave={() => setActiveCategoryIndex(null)}
                        />
                      );
                    })}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-[10px] font-label-caps text-on-surface-variant/75 uppercase tracking-widest font-semibold">
                      {activeCategoryIndex !== null ? categoryData[activeCategoryIndex].name : 'Revenue'}
                    </span>
                    <span className="text-sm font-bold text-primary font-mono mt-0.5">
                      {activeCategoryIndex !== null 
                        ? `₹${categoryData[activeCategoryIndex].value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                        : `₹${totalCatRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                      }
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-5 w-full text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                  {categoryData.map((slice, index) => (
                    <div 
                      key={slice.name} 
                      className={`flex items-center gap-2 cursor-pointer transition-opacity ${
                        activeCategoryIndex !== null && activeCategoryIndex !== index ? 'opacity-40' : 'opacity-100'
                      }`}
                      onMouseEnter={() => setActiveCategoryIndex(index)}
                      onMouseLeave={() => setActiveCategoryIndex(null)}
                    >
                      <span className="w-3 h-3 rounded-full shrink-0 border border-black/10" style={{ backgroundColor: slice.color }} />
                      <span className="truncate">{slice.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>

          {/* Bento Box 5: Popular Menu Items list */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="md:col-span-1 bg-surface-container rounded-2xl p-4 md:p-6 border border-outline-variant/10 flex flex-col justify-between shadow-sm"
          >
            <div>
              <h4 className="font-title-md text-on-surface text-base flex items-center gap-1.5">
                <span className="material-symbols-outlined text-primary text-lg">star_rate</span>
                Popular Items
              </h4>
              <p className="text-xs text-on-surface-variant/60 mt-1">Top velocity dishes by quantities ordered.</p>
            </div>

            {popularDishes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant/50">
                <span className="material-symbols-outlined text-4xl">local_cafe</span>
                <p className="text-xs mt-2 text-center px-4">No popular items in this period yet. Analytics will appear as orders are completed.</p>
              </div>
            ) : (
              <div className="space-y-4 mt-6">
                {popularDishes.map((dish) => {
                  const pct = (dish.count / maxDishCount) * 100;
                  return (
                    <div key={dish.name} className="space-y-1.5">
                      <div className="flex justify-between text-xs text-on-surface">
                        <span className="font-medium truncate max-w-[140px]" title={dish.name}>{dish.name}</span>
                        <span className="font-mono text-primary font-semibold shrink-0">
                          {dish.count} ordered (₹{dish.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })})
                        </span>
                      </div>
                      <div className="h-2 w-full bg-surface-container-high rounded-full overflow-hidden border border-outline-variant/10">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.8, ease: 'easeOut' }}
                          className="h-full bg-gradient-to-r from-primary/60 to-primary rounded-full" 
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>

          {/* Bento Box 6: Peak Hours Analysis */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
            className="md:col-span-2 bg-surface-container rounded-2xl p-4 md:p-6 border border-outline-variant/10 flex flex-col justify-between shadow-sm"
          >
            <div>
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-title-md text-on-surface text-base flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-primary text-lg">schedule</span>
                    Peak Hours Analysis
                  </h4>
                  <p className="text-xs text-on-surface-variant/60 mt-1">Hourly distribution of completed orders.</p>
                </div>
                {peakHourStats.peakHour && (
                  <div className="text-right bg-primary/10 border border-primary/20 rounded-xl px-3 py-1.5 shadow-sm shrink-0">
                    <span className="text-[10px] font-label-caps text-primary uppercase tracking-widest block font-bold">Peak Busiest Hour</span>
                    <span className="text-xs font-mono text-on-surface font-bold">
                      {peakHourStats.peakHour} – {parseInt(peakHourStats.peakHour.split(':')[0]) + 1}:00 ({peakHourStats.maxCount} {peakHourStats.maxCount === 1 ? 'order' : 'orders'})
                    </span>
                  </div>
                )}
              </div>
            </div>

            {completedOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-on-surface-variant/50">
                <span className="material-symbols-outlined text-4xl">hourglass_empty</span>
                <p className="text-xs mt-2 text-center px-4">No completed orders in this period yet. Analytics will appear as orders are completed.</p>
              </div>
            ) : (
              <div className="mt-6">
                {/* 24 Bar Visualizer */}
                <div className="flex items-end justify-between gap-1 h-32 w-full pt-4">
                  {(() => {
                    const maxHourlyCount = Math.max(...peakHoursData.map(h => h.count), 1);
                    return peakHoursData.map((bucket, index) => {
                      const heightPct = (bucket.count / maxHourlyCount) * 100;
                      const isPeak = bucket.hour === peakHourStats.peakHour;
                      return (
                        <div key={bucket.hour} className="flex-1 flex flex-col items-center group relative h-full justify-end">
                          {/* Hover Tooltip Details */}
                          <div className="absolute bottom-full mb-2 hidden group-hover:block bg-surface-container-highest/95 border border-primary/30 px-2.5 py-1 rounded-xl shadow-xl text-center backdrop-blur-md z-30 pointer-events-none w-24">
                            <p className="text-[9px] font-bold text-on-surface-variant/80 uppercase tracking-widest font-label-caps">{bucket.hour}</p>
                            <p className="text-[10px] font-bold text-primary font-mono mt-0.5">{bucket.count} {bucket.count === 1 ? 'order' : 'orders'}</p>
                            <p className="text-[9px] text-on-surface font-mono">₹{bucket.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                          </div>
                          {/* Bar Graphic */}
                          <div className="w-full rounded-t-[3px] transition-all duration-300 relative overflow-hidden" style={{ height: `${heightPct}%` }}>
                            <div className={`h-full w-full ${isPeak ? 'bg-gradient-to-t from-primary/80 to-primary' : 'bg-surface-container-high hover:bg-primary/40'}`} />
                          </div>
                          {/* Hourly interval labels (every 4th label to fit screen space) */}
                          <span className="text-[9px] font-mono text-on-surface-variant/60 mt-1.5">
                            {index % 4 === 0 ? index : ''}
                          </span>
                        </div>
                      );
                    });
                  })()}
                </div>
                <div className="flex justify-between items-center text-[10px] text-on-surface-variant/50 mt-2 font-mono border-t border-outline-variant/10 pt-2">
                  <span>00:00 (Midnight)</span>
                  <span>12:00 (Noon)</span>
                  <span>23:00 (11 PM)</span>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}

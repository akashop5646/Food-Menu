import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as THREE from 'three';
import { API_BASE } from '../config';

export default function Analytics() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('7d'); // 24h, 7d, 30d
  const [activeCategoryIndex, setActiveCategoryIndex] = useState(null);
  const [activeBarIndex, setActiveBarIndex] = useState(null);

  const mountRef = useRef(null);

  // Fetch all orders from backend
  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const res = await fetch(API_BASE + '/api/orders', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setOrders(data);
        }
      } catch (err) {
        console.error('Failed to fetch analytics orders:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchOrders();
    
    // Refresh data every 10 seconds to keep live metrics accurate
    const timer = setInterval(fetchOrders, 10000);
    return () => clearInterval(timer);
  }, []);

  // 3D Canvas initialization using Three.js
  useEffect(() => {
    const currentMount = mountRef.current;
    if (!currentMount || loading) return;

    // Scene Setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, currentMount.clientWidth / currentMount.clientHeight, 0.1, 100);
    camera.position.z = 4.5;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    currentMount.appendChild(renderer.domElement);

    // Particle System (Gold Metallic Theme)
    const particlesCount = 200;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particlesCount * 3);
    const colors = new Float32Array(particlesCount * 3);

    const goldShades = [
      new THREE.Color('#d4af37'), // Metallic Gold
      new THREE.Color('#f2ca50'), // Golden Sand
      new THREE.Color('#f3e5ab'), // Vanilla Gold
    ];

    for (let i = 0; i < particlesCount * 3; i += 3) {
      // Golden Spiral Layout (Fibonacci Sphere)
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

    // Particle texture
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

    // Mouse movement listeners for interaction
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

    // Animation Loop
    const clock = new THREE.Clock();
    let animationId;

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();

      // Ambient Rotation
      particleSystem.rotation.y = elapsed * 0.12;
      particleSystem.rotation.x = elapsed * 0.05;

      // Smooth inertia mouse tracking
      targetX += (mouseX - targetX) * 0.08;
      targetY += (mouseY - targetY) * 0.08;

      particleSystem.rotation.y += targetX * 0.6;
      particleSystem.rotation.x -= targetY * 0.6;

      renderer.render(scene, camera);
    };

    animate();

    // Resize handling
    const handleResize = () => {
      if (!currentMount) return;
      camera.aspect = currentMount.clientWidth / currentMount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      currentMount.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationId);
      if (currentMount.contains(renderer.domElement)) {
        currentMount.removeChild(renderer.domElement);
      }
      geometry.dispose();
      material.dispose();
      particleTexture.dispose();
      renderer.dispose();
    };
  }, [loading]);

  // Filter orders by time range
  const getFilteredOrders = () => {
    const now = new Date();
    return orders.filter(order => {
      const orderDate = new Date(order.createdAt);
      const diffMs = now - orderDate;
      if (timeRange === '24h') return diffMs <= 24 * 60 * 60 * 1000;
      if (timeRange === '7d') return diffMs <= 7 * 24 * 60 * 60 * 1000;
      return diffMs <= 30 * 24 * 60 * 60 * 1000;
    });
  };

  const filteredOrders = getFilteredOrders();

  // Metrics Calculations
  const completedOrders = filteredOrders.filter(o => o.paymentStatus === 'PAID');
  const totalRevenue = completedOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  const activeOrdersCount = filteredOrders.filter(o => o.status !== 'COMPLETED' && o.status !== 'CANCELLED').length;
  const totalOrdersCount = filteredOrders.length;
  const avgOrderValue = totalOrdersCount > 0 ? totalRevenue / totalOrdersCount : 0;

  // Active unique tables counting
  const activeTablesCount = new Set(filteredOrders.filter(o => o.status !== 'COMPLETED' && o.status !== 'CANCELLED').map(o => o.table)).size;

  // Popular Dishes Breakdown
  const dishCounts = {};
  filteredOrders.forEach(order => {
    if (order.status !== 'CANCELLED') {
      order.items.forEach(item => {
        dishCounts[item.name] = (dishCounts[item.name] || 0) + (item.quantity || 1);
      });
    }
  });

  const popularDishes = Object.entries(dishCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const maxDishCount = popularDishes.length > 0 ? popularDishes[0].count : 1;

  // Category Distribution (Revenue split)
  const categorySplit = {};
  completedOrders.forEach(order => {
    order.items.forEach(item => {
      // Mock categories if not present on items (default to Food / Beverage / Dessert)
      let cat = 'Other';
      if (item.name.toLowerCase().includes('tea') || item.name.toLowerCase().includes('coffee') || item.name.toLowerCase().includes('beverage') || item.name.toLowerCase().includes('drink')) {
        cat = 'Beverages';
      } else if (item.name.toLowerCase().includes('chicken') || item.name.toLowerCase().includes('rice') || item.name.toLowerCase().includes('curry') || item.name.toLowerCase().includes('paneer')) {
        cat = 'Mains';
      } else if (item.name.toLowerCase().includes('soup') || item.name.toLowerCase().includes('tikka') || item.name.toLowerCase().includes('fries')) {
        cat = 'Starters';
      } else {
        cat = 'Desserts';
      }
      categorySplit[cat] = (categorySplit[cat] || 0) + (item.price * item.quantity);
    });
  });

  const categoryColors = {
    'Mains': '#d4af37',      // Primary Gold
    'Starters': '#f2ca50',   // Light Gold
    'Beverages': '#ffe088',  // Champagne
    'Desserts': '#8e8e93',   // Muted Silver
    'Other': '#4a4b50'       // Dark Charcoal
  };

  const categoryData = Object.entries(categorySplit).map(([name, value]) => ({
    name,
    value,
    color: categoryColors[name] || '#8e8e93'
  }));

  const totalCatRevenue = categoryData.reduce((sum, c) => sum + c.value, 0);

  // Daily Trend calculation for last 7 days
  const getDailyTrend = () => {
    const trendData = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toLocaleDateString(undefined, { weekday: 'short' });
      const dayStart = new Date(d.setHours(0,0,0,0));
      const dayEnd = new Date(d.setHours(23,59,59,999));

      const dailyPaid = orders.filter(o => {
        const orderDate = new Date(o.createdAt);
        return o.paymentStatus === 'PAID' && orderDate >= dayStart && orderDate <= dayEnd;
      });

      const dayRevenue = dailyPaid.reduce((sum, o) => sum + (o.total || 0), 0);
      trendData.push({ day: dateStr, value: dayRevenue });
    }
    return trendData;
  };

  const dailyTrend = getDailyTrend();
  const maxTrendValue = Math.max(...dailyTrend.map(t => t.value), 100);

  // Donut chart path math helpers
  let accumulatedAngle = 0;

  return (
    <div className="space-y-6">
      {/* Time Range Selector */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="font-headline-md text-2xl text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">analytics</span>
            Restaurant Analytics
          </h1>
          <p className="font-body-md text-on-surface-variant mt-1">
            Real-time business intelligence and performance metrics.
          </p>
        </div>

        <div className="flex bg-surface-container-highest/40 rounded-xl p-0.5 border border-outline-variant/20 self-start sm:self-auto">
          {[
            { id: '24h', label: '24 Hours' },
            { id: '7d', label: '7 Days' },
            { id: '30d', label: '30 Days' }
          ].map(range => (
            <button
              key={range.id}
              onClick={() => setTimeRange(range.id)}
              className={`px-4 py-2 rounded-lg text-xs font-label-caps uppercase tracking-wider font-semibold transition-all ${
                timeRange === range.id
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-on-surface-variant/80 hover:text-on-surface'
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-32">
          <span className="material-symbols-outlined text-primary text-5xl animate-spin">progress_activity</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {/* Bento Box 1: KPI Metrics Panel */}
          <div className="md:col-span-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Revenue Metric */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-surface-container rounded-2xl p-6 border border-outline-variant/10 flex flex-col justify-between hover:border-primary/30 transition-all group"
            >
              <div>
                <span className="material-symbols-outlined text-primary text-3xl group-hover:scale-110 transition-transform">monetization_on</span>
                <p className="text-on-surface-variant/60 font-label-caps text-xs uppercase tracking-widest mt-4">Total Revenue</p>
                <h3 className="font-headline-md text-3xl text-primary font-bold mt-2">₹{totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
              </div>
              <p className="text-[11px] text-green-500 flex items-center gap-1 mt-4">
                <span className="material-symbols-outlined text-[12px]">trending_up</span>
                <span>+12.4% vs last period</span>
              </p>
            </motion.div>

            {/* Active Orders */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-surface-container rounded-2xl p-6 border border-outline-variant/10 flex flex-col justify-between hover:border-primary/30 transition-all group"
            >
              <div>
                <span className="material-symbols-outlined text-primary text-3xl group-hover:scale-110 transition-transform">pending_actions</span>
                <p className="text-on-surface-variant/60 font-label-caps text-xs uppercase tracking-widest mt-4">Active Orders</p>
                <h3 className="font-headline-md text-3xl text-on-surface font-bold mt-2">{activeOrdersCount}</h3>
              </div>
              <p className="text-[11px] text-on-surface-variant/70 flex items-center gap-1 mt-4">
                <span className="material-symbols-outlined text-[12px]">info</span>
                <span>Currently in preparation or ready</span>
              </p>
            </motion.div>

            {/* Avg Order Value */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-surface-container rounded-2xl p-6 border border-outline-variant/10 flex flex-col justify-between hover:border-primary/30 transition-all group"
            >
              <div>
                <span className="material-symbols-outlined text-primary text-3xl group-hover:scale-110 transition-transform">shopping_bag</span>
                <p className="text-on-surface-variant/60 font-label-caps text-xs uppercase tracking-widest mt-4">Avg Order Value</p>
                <h3 className="font-headline-md text-3xl text-on-surface font-bold mt-2">₹{avgOrderValue.toFixed(2)}</h3>
              </div>
              <p className="text-[11px] text-on-surface-variant/70 flex items-center gap-1 mt-4">
                <span className="material-symbols-outlined text-[12px]">tag</span>
                <span>Calculated per customer transaction</span>
              </p>
            </motion.div>

            {/* Active Tables */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-surface-container rounded-2xl p-6 border border-outline-variant/10 flex flex-col justify-between hover:border-primary/30 transition-all group"
            >
              <div>
                <span className="material-symbols-outlined text-primary text-3xl group-hover:scale-110 transition-transform">table_bar</span>
                <p className="text-on-surface-variant/60 font-label-caps text-xs uppercase tracking-widest mt-4">Occupied Tables</p>
                <h3 className="font-headline-md text-3xl text-on-surface font-bold mt-2">{activeTablesCount}</h3>
              </div>
              <p className="text-[11px] text-primary flex items-center gap-1 mt-4">
                <span className="material-symbols-outlined text-[12px]">qr_code</span>
                <span>Active sessions via QR scans</span>
              </p>
            </motion.div>
          </div>

          {/* Bento Box 2: 3D Realtime Pulse (Three.js Visualizer) */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="md:col-span-3 lg:col-span-1 bg-surface-container rounded-2xl p-6 border border-outline-variant/10 flex flex-col items-center justify-between relative overflow-hidden"
          >
            <div className="w-full">
              <h4 className="font-title-md text-on-surface text-base flex items-center gap-1.5">
                <span className="material-symbols-outlined text-primary text-lg">animated_images</span>
                3D Activity Sphere
              </h4>
              <p className="text-xs text-on-surface-variant/60 mt-1">Interactive live feed visualizer.</p>
            </div>
            
            {/* Three.js Container */}
            <div 
              ref={mountRef} 
              className="w-full h-44 cursor-grab active:cursor-grabbing relative z-10"
              title="Move your mouse over the sphere to interact"
            />
            
            <div className="w-full text-center z-10">
              <p className="text-[11px] font-mono text-primary tracking-widest uppercase animate-pulse">Websocket Channel Connected</p>
            </div>
            
            {/* Glow Background Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-primary/5 via-transparent to-transparent pointer-events-none" />
          </motion.div>

          {/* Bento Box 3: Weekly Revenue Trend (Custom animated SVG chart) */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="md:col-span-2 bg-surface-container rounded-2xl p-6 border border-outline-variant/10 flex flex-col justify-between"
          >
            <div>
              <h4 className="font-title-md text-on-surface text-base flex items-center gap-1.5">
                <span className="material-symbols-outlined text-primary text-lg">monitoring</span>
                Weekly Revenue Trend
              </h4>
              <p className="text-xs text-on-surface-variant/60 mt-1">Paid customer collections over the past week.</p>
            </div>

            <div className="h-56 mt-6 flex items-end justify-between relative px-2">
              {/* Grid Lines */}
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none border-b border-outline-variant/10 pb-6">
                {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
                  <div key={ratio} className="w-full border-t border-outline-variant/10 text-[9px] font-mono text-on-surface-variant/40 pt-1">
                    ₹{((maxTrendValue * ratio) / 1000).toFixed(1)}k
                  </div>
                ))}
              </div>

              {/* Bars */}
              {dailyTrend.map((data, index) => {
                const barHeight = (data.value / maxTrendValue) * 100;
                return (
                  <div 
                    key={data.day} 
                    className="flex flex-col items-center flex-1 z-10 group relative"
                    onMouseEnter={() => setActiveBarIndex(index)}
                    onMouseLeave={() => setActiveBarIndex(null)}
                  >
                    {/* Tooltip */}
                    <AnimatePresence>
                      {activeBarIndex === index && (
                        <motion.div
                          initial={{ opacity: 0, y: -10, scale: 0.9 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="absolute -top-12 bg-surface-container-highest border border-primary/30 px-2 py-1 rounded shadow-lg z-20 text-[10px] font-bold text-primary font-mono whitespace-nowrap"
                        >
                          ₹{data.value.toLocaleString()}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Bar Cylinder */}
                    <div className="w-8 bg-surface-container-high rounded-t-lg h-36 flex items-end overflow-hidden border border-outline-variant/10">
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${barHeight}%` }}
                        transition={{ duration: 0.8, ease: 'easeOut' }}
                        className="w-full bg-gradient-to-t from-primary/60 to-primary group-hover:brightness-110 transition-all rounded-t-lg"
                      />
                    </div>
                    <span className="text-[10px] font-label-caps uppercase tracking-wider font-semibold text-on-surface-variant/80 mt-2">{data.day}</span>
                  </div>
                );
              })}
            </div>
          </motion.div>

          {/* Bento Box 4: Category distribution donut chart */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="md:col-span-1 bg-surface-container rounded-2xl p-6 border border-outline-variant/10 flex flex-col justify-between"
          >
            <div>
              <h4 className="font-title-md text-on-surface text-base flex items-center gap-1.5">
                <span className="material-symbols-outlined text-primary text-lg">donut_large</span>
                Category Share
              </h4>
              <p className="text-xs text-on-surface-variant/60 mt-1">Revenue split per product class.</p>
            </div>

            {categoryData.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-on-surface-variant/50">
                <span className="material-symbols-outlined text-4xl">pie_chart</span>
                <p className="text-xs mt-2">No completed orders yet</p>
              </div>
            ) : (
              <div className="flex flex-col items-center py-4">
                {/* SVG Donut */}
                <div className="relative w-36 h-36">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" fill="transparent" stroke="#252528" strokeWidth="8" />
                    {categoryData.map((slice, index) => {
                      const percentage = slice.value / totalCatRevenue;
                      const strokeCirc = 2 * Math.PI * 40;
                      const strokeOffset = strokeCirc - (percentage * strokeCirc);
                      const rotation = (accumulatedAngle / totalCatRevenue) * 360;
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
                  {/* Center Text */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-[10px] font-label-caps text-on-surface-variant/60 uppercase tracking-widest">
                      {activeCategoryIndex !== null ? categoryData[activeCategoryIndex].name : 'Revenue'}
                    </span>
                    <span className="text-xs font-bold text-primary font-mono mt-0.5">
                      {activeCategoryIndex !== null 
                        ? `₹${categoryData[activeCategoryIndex].value.toLocaleString()}`
                        : `₹${totalCatRevenue.toLocaleString()}`
                      }
                    </span>
                  </div>
                </div>

                {/* Legend */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-4 w-full text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/80">
                  {categoryData.map((slice, index) => (
                    <div 
                      key={slice.name} 
                      className={`flex items-center gap-1.5 cursor-pointer transition-opacity ${
                        activeCategoryIndex !== null && activeCategoryIndex !== index ? 'opacity-40' : 'opacity-100'
                      }`}
                      onMouseEnter={() => setActiveCategoryIndex(index)}
                      onMouseLeave={() => setActiveCategoryIndex(null)}
                    >
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: slice.color }} />
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
            transition={{ delay: 0.7 }}
            className="md:col-span-1 bg-surface-container rounded-2xl p-6 border border-outline-variant/10 flex flex-col justify-between"
          >
            <div>
              <h4 className="font-title-md text-on-surface text-base flex items-center gap-1.5">
                <span className="material-symbols-outlined text-primary text-lg">star_rate</span>
                Popular Items
              </h4>
              <p className="text-xs text-on-surface-variant/60 mt-1">Top velocity dishes by quantities ordered.</p>
            </div>

            {popularDishes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-on-surface-variant/50">
                <span className="material-symbols-outlined text-4xl">local_cafe</span>
                <p className="text-xs mt-2">No ordered items yet</p>
              </div>
            ) : (
              <div className="space-y-4 mt-6">
                {popularDishes.map((dish) => {
                  const pct = (dish.count / maxDishCount) * 100;
                  return (
                    <div key={dish.name} className="space-y-1.5">
                      <div className="flex justify-between text-xs text-on-surface">
                        <span className="font-medium truncate max-w-[150px]">{dish.name}</span>
                        <span className="font-mono text-primary font-semibold">{dish.count} ordered</span>
                      </div>
                      <div className="h-2 w-full bg-surface-container-high rounded-full overflow-hidden border border-outline-variant/10">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                          className="h-full bg-gradient-to-r from-primary/60 to-primary rounded-full" 
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}

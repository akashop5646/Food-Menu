import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import { API_BASE } from './config';

function MenuPage() {
  const [searchParams] = useSearchParams();
  const tableParam = searchParams.get('table') || 'Walk-in';
  const locationParam = searchParams.get('location') || '';

  const [menuItems, setMenuItems] = useState([]);
  const [categories, setCategories] = useState(['All']);
  const [menuLoading, setMenuLoading] = useState(true);

  // Client-Side Theme Controller
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('aurum_theme');
    if (saved) return saved;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  });

  useEffect(() => {
    localStorage.setItem('aurum_theme', theme);
    const root = document.documentElement;
    root.classList.add('theme-transition');
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    const timer = setTimeout(() => {
      root.classList.remove('theme-transition');
    }, 300);
    return () => clearTimeout(timer);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // Dietary Preference Tag Parser
  const getDietaryTags = (item) => {
    const tags = [];
    const nameLower = (item.name || '').toLowerCase();
    const descLower = (item.description || '').toLowerCase();
    const catsLower = (item.categories || []).map(c => c.toLowerCase());

    if (nameLower.includes('vegan') || descLower.includes('vegan') || catsLower.includes('vegan')) {
      tags.push({ type: 'vegan', label: 'Vegan', icon: 'spa', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' });
    } else if (
      nameLower.includes('vegetarian') || descLower.includes('vegetarian') || catsLower.includes('vegetarian') ||
      nameLower.includes('paneer') || nameLower.includes('dal ') || nameLower.includes('tofu') ||
      nameLower.includes('veg ') || nameLower.includes(' vegetable') || descLower.includes('veg option')
    ) {
      tags.push({ type: 'veg', label: 'Veg', icon: 'fiber_manual_record', color: 'text-green-500 bg-green-500/10 border-green-500/20' });
    }

    // ponytail: automatic non-veg tag generation removed per user request


    if (
      nameLower.includes('spicy') || nameLower.includes('chili') || nameLower.includes('chilly') ||
      nameLower.includes('schezwan') || nameLower.includes('hot') || nameLower.includes('jalapeno') ||
      descLower.includes('spicy') || descLower.includes('chili') || descLower.includes('chilly')
    ) {
      tags.push({ type: 'spicy', label: 'Spicy', icon: 'local_fire_department', color: 'text-amber-500 bg-amber-500/10 border-amber-500/20' });
    }

    if (nameLower.includes('gluten-free') || descLower.includes('gluten-free') || nameLower.includes('gluten free') || descLower.includes('gluten free')) {
      tags.push({ type: 'gf', label: 'Gluten-Free', icon: 'grass', color: 'text-sky-500 bg-sky-500/10 border-sky-500/20' });
    }

    return tags;
  };

  const [cart, setCart] = useState(() => {
    try {
      const saved = localStorage.getItem('aurum_cart');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTable] = useState(tableParam);
  const [selectedLocation] = useState(locationParam);
  const [activeOrder, setActiveOrder] = useState(null);
  const [activeOrders, setActiveOrders] = useState([]);

  useEffect(() => {
    localStorage.setItem('aurum_cart', JSON.stringify(cart));
  }, [cart]);
  
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [notification, setNotification] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [verificationCode, setVerificationCode] = useState('');

  // Razorpay configuration and states
  const [razorpayKeyId, setRazorpayKeyId] = useState('');
  const [restaurantName, setRestaurantName] = useState('Aurum Restaurant');
  const [restaurantAddress, setRestaurantAddress] = useState('');
  const [restaurantPhone, setRestaurantPhone] = useState('');
  const [restaurantFssai, setRestaurantFssai] = useState('');
  const [restaurantEmail, setRestaurantEmail] = useState('support@aurumtable.com');
  const [restaurantHours, setRestaurantHours] = useState('Monday - Sunday, 11:00 AM - 11:00 PM IST');
  const [restaurantMapLink, setRestaurantMapLink] = useState('');
  const [paidOrderDetails, setPaidOrderDetails] = useState(null);
  const [isOrderVerified, setIsOrderVerified] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [customerIp, setCustomerIp] = useState('');
  const [checkoutSessionId, setCheckoutSessionId] = useState('');
  const [activePolicy, setActivePolicy] = useState(null);

  // Pagination and lazy loading states
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const observerRef = React.useRef(null);
  const PAGE_SIZE = 8;

  // Hero Item and Cache
  const [heroItem, setHeroItem] = useState(null);
  const menuCache = useRef({});

  // Fetch initial configs, categories, razorpay, ip, and profile on mount
  useEffect(() => {
    // Generate/get deviceId
    let id = localStorage.getItem('aurum_device_id');
    if (!id) {
      id = 'dev_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('aurum_device_id', id);
    }
    setDeviceId(id);

    const fetchInitialData = async () => {
      try {
        const [catsRes, razorpayRes, ipRes, profileRes] = await Promise.all([
          fetch(API_BASE + '/api/categories'),
          fetch(API_BASE + '/api/settings/razorpay'),
          fetch(API_BASE + '/api/auth/ip').catch(() => null),
          fetch(API_BASE + '/api/settings/restaurant-profile').catch(() => null)
        ]);

        const cats = await catsRes.json();
        let razorpayData = { razorpayKeyId: '' };
        try {
          razorpayData = await razorpayRes.json();
        } catch (e) {
          console.error(e);
        }
        setCategories(['All', ...(Array.isArray(cats) ? cats.map(c => c.name) : [])]);
        setRazorpayKeyId(razorpayData.razorpayKeyId || '');

        if (profileRes && profileRes.ok) {
          const profileData = await profileRes.json();
          setRestaurantName(profileData.restaurantName || 'Aurum Restaurant');
          setRestaurantAddress(profileData.restaurantAddress || '');
          setRestaurantPhone(profileData.restaurantPhone || '');
          setRestaurantFssai(profileData.restaurantFssai || '');
          setRestaurantEmail(profileData.restaurantEmail || 'support@aurumtable.com');
          setRestaurantHours(profileData.restaurantHours || 'Monday - Sunday, 11:00 AM - 11:00 PM IST');
          setRestaurantMapLink(profileData.restaurantMapLink || '');
        }

        if (ipRes && ipRes.ok) {
          const ipData = await ipRes.json();
          setCustomerIp(ipData.ip || '');
        }
      } catch (err) {
        console.error('Failed to fetch initial configs:', err);
      }
    };
    fetchInitialData();
  }, []);

  // Fetch first page of menu items whenever activeCategory or searchQuery changes (using cache if available)
  useEffect(() => {
    const cacheKey = `${activeCategory}_${searchQuery}`;
    if (menuCache.current[cacheKey]) {
      const cached = menuCache.current[cacheKey];
      setMenuItems(cached.items);
      setHasMore(cached.hasMore);
      setOffset(cached.offset);
      setMenuLoading(false);
      return;
    }

    let active = true;
    const fetchFirstPage = async () => {
      setMenuLoading(true);
      setOffset(0);
      setHasMore(true);
      try {
        const res = await fetch(`${API_BASE}/api/menu?limit=${PAGE_SIZE}&offset=0&category=${encodeURIComponent(activeCategory)}&search=${encodeURIComponent(searchQuery)}`);
        if (!res.ok) throw new Error('Failed to fetch menu');
        const data = await res.json();
        if (active) {
          const itemsList = Array.isArray(data) ? data : [];
          const more = itemsList.length === PAGE_SIZE;
          setMenuItems(itemsList);
          setHasMore(more);

          // If hero item is not set yet, set it from the first category fetch (normally "All")
          if (!heroItem && itemsList.length > 0) {
            const foundHero = itemsList.find(item => item.chefPick) || itemsList[0] || null;
            setHeroItem(foundHero);
          }

          // Save to cache
          menuCache.current[cacheKey] = {
            items: itemsList,
            hasMore: more,
            offset: 0
          };
        }
      } catch (err) {
        console.error('Error fetching initial page items:', err);
      } finally {
        if (active) {
          setMenuLoading(false);
        }
      }
    };
    fetchFirstPage();
    return () => {
      active = false;
    };
  }, [activeCategory, searchQuery, heroItem]);

  // Load more menu items when user scrolls to bottom
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || menuLoading) return;
    setLoadingMore(true);
    const newOffset = menuItems.length;
    const cacheKey = `${activeCategory}_${searchQuery}`;
    try {
      const res = await fetch(`${API_BASE}/api/menu?limit=${PAGE_SIZE}&offset=${newOffset}&category=${encodeURIComponent(activeCategory)}&search=${encodeURIComponent(searchQuery)}`);
      if (!res.ok) throw new Error('Failed to load more');
      const data = await res.json();
      if (Array.isArray(data)) {
        const updatedItems = [...menuItems, ...data];
        const more = data.length === PAGE_SIZE;
        setMenuItems(updatedItems);
        setOffset(newOffset);
        setHasMore(more);
        // Update cache
        menuCache.current[cacheKey] = {
          items: updatedItems,
          hasMore: more,
          offset: newOffset
        };
      }
    } catch (err) {
      console.error('Failed to load more menu items:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, menuLoading, menuItems, activeCategory, searchQuery]);

  // IntersectionObserver to trigger loading more items
  useEffect(() => {
    if (!hasMore || menuLoading || loadingMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadMore();
      }
    }, { threshold: 0.1, rootMargin: '150px' });

    const currentTrigger = observerRef.current;
    if (currentTrigger) {
      observer.observe(currentTrigger);
    }

    return () => {
      if (currentTrigger) {
        observer.unobserve(currentTrigger);
      }
    };
  }, [hasMore, menuLoading, loadingMore, loadMore]);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const ordersList = activeOrders.length > 0 ? activeOrders : (activeOrder ? [activeOrder] : []);
  const sessionTotal = ordersList.reduce((sum, o) => sum + o.total, 0);
  const sessionItemsCount = ordersList.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0);
  const unpaidOrders = ordersList.filter(o => o.paymentStatus !== 'PAID');
  const unpaidTotal = unpaidOrders.reduce((sum, o) => sum + o.total, 0);

  const showNotification = useCallback((msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(''), 3000);
  }, []);

  const addToCart = useCallback((dish) => {
    setCart(prev => {
      const existing = prev.find(i => i._id === dish._id);
      if (existing) {
        return prev.map(i => i._id === dish._id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { ...dish, quantity: 1 }];
    });
    showNotification(`${dish.name} added to cart`);
  }, [showNotification]);

  const updateQuantity = useCallback((id, change) => {
    setCart(prev => prev.map(item => {
      if (item._id === id) {
        return { ...item, quantity: Math.max(0, item.quantity + change) };
      }
      return item;
    }).filter(item => item.quantity > 0));
  }, []);

  const handleOrderNow = useCallback((dish) => {
    addToCart(dish);
    setIsCartOpen(true);
  }, [addToCart]);

  const toggleCart = useCallback(() => {
    if (isCheckoutOpen) setIsCheckoutOpen(false);
    setIsCartOpen(prev => !prev);
  }, [isCheckoutOpen]);

  const orderPayload = useMemo(() => {
    if (!cart.length) return null;
    return {
      table: selectedTable,
      location: selectedLocation,
      itemCount: cartCount,
      total: cartTotal,
      items: cart.map(item => ({ id: item._id, name: item.name, price: item.price, quantity: item.quantity })),
      createdAt: new Date().toISOString(),
      deviceId,
      customerIp,
      checkoutSessionId,
    };
  }, [cart, cartCount, cartTotal, selectedTable, selectedLocation, deviceId, customerIp, checkoutSessionId]);

  useEffect(() => {
    if (!isCheckoutOpen || !orderPayload) {
      setVerificationCode('');
      return;
    }
    // Request a 4-digit verification code from the backend
    const fetchCode = async () => {
      try {
        const res = await fetch(API_BASE + '/api/orders/checkout-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderPayload),
        });
        const data = await res.json();
        if (res.ok && data.code) {
          setVerificationCode(data.code);
        } else {
          console.error('Failed to get checkout code:', data.error);
        }
      } catch (err) {
        console.error('Error fetching checkout code:', err);
      }
    };
    fetchCode();
  }, [isCheckoutOpen, orderPayload]);

  // Razorpay handles checkout overlay directly

  // Poll backend to check if the waiter has scanned/confirmed this table's order
  useEffect(() => {
    if (!selectedTable || !deviceId) {
      setIsOrderVerified(false);
      return;
    }

    const checkVerification = async () => {
      const isToday = (dateString) => {
        if (!dateString) return false;
        const d = new Date(dateString);
        const today = new Date();
        return d.getDate() === today.getDate() &&
               d.getMonth() === today.getMonth() &&
               d.getFullYear() === today.getFullYear();
      };

      try {
        let url = `${API_BASE}/api/orders/active?table=${encodeURIComponent(selectedTable)}&deviceId=${encodeURIComponent(deviceId)}`;
        if (cart.length > 0 && checkoutSessionId) {
          url += `&checkoutSessionId=${encodeURIComponent(checkoutSessionId)}`;
        }
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data.verified && data.order && isToday(data.order.createdAt)) {
            setActiveOrder(data.order);
            setIsOrderVerified(true);
            // Clear cart & session ID if the order was just placed/verified
            if (cart.length > 0 && checkoutSessionId && data.order.checkoutSessionId === checkoutSessionId) {
              setCart([]);
              localStorage.removeItem('aurum_cart');
              setCheckoutSessionId('');
            }
          } else {
            setActiveOrder(null);
            setIsOrderVerified(false);
          }
          const todayOrders = (data.orders || []).filter(o => isToday(o.createdAt));
          setActiveOrders(todayOrders);
        }
      } catch (err) {
        console.error('Error checking verification status:', err);
      }
    };

    // Check once immediately
    checkVerification();

    // Poll every 3000ms
    const interval = setInterval(checkVerification, 3000);

    return () => clearInterval(interval);
  }, [selectedTable, deviceId, cart.length, checkoutSessionId]);

  const handlePayNow = async () => {
    if (!isOrderVerified && !activeOrder) {
      showNotification('Awaiting waiter verification. Please show your 4-digit code to the staff first.');
      return;
    }

    if (!razorpayKeyId) {
      showNotification('Online payments are currently disabled. Please choose Pay Later.');
      return;
    }

    try {
      const activeTotal = unpaidTotal > 0 ? unpaidTotal : (activeOrder ? activeOrder.total : cartTotal);
      const targetOrderId = activeOrder ? activeOrder._id : (activeOrders[0] ? activeOrders[0]._id : null);

      const response = await fetch(API_BASE + '/api/orders/razorpay-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: activeTotal,
          orderId: targetOrderId
        })
      });

      const orderData = await response.json();
      if (!response.ok) throw new Error(orderData.error || 'Failed to create payment order');

      const options = {
        key: razorpayKeyId,
        amount: orderData.amount,
        currency: orderData.currency,
        name: "Aurum Table",
        description: `Table ${selectedTable} Order Payment`,
        order_id: orderData.id,
        handler: async function (rzpResponse) {
          try {
            const verifyRes = await fetch(`${API_BASE}/api/orders/${targetOrderId}/verify-payment`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: rzpResponse.razorpay_order_id,
                razorpay_payment_id: rzpResponse.razorpay_payment_id,
                razorpay_signature: rzpResponse.razorpay_signature
              })
            });

            const verifyData = await verifyRes.json();
            if (!verifyRes.ok) throw new Error(verifyData.error || 'Payment verification failed');

            showNotification('Payment successful! Your order is being prepared.');
            setPaidOrderDetails({ orderId: targetOrderId || 'session_order', amount: activeTotal });
            setIsCheckoutOpen(false);
          } catch (err) {
            console.error(err);
            showNotification(err.message || 'Payment verification failed');
          }
        },
        theme: {
          color: "#D4AF37"
        }
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err) {
      console.error(err);
      showNotification(err.message || 'Failed to initiate Razorpay checkout');
    }
  };

  const handlePayLater = () => {
    setIsCheckoutOpen(false);
    if (!activeOrder) {
      setCart([]);
      localStorage.removeItem('aurum_cart');
    }
    showNotification('Thank you! Your order has been placed. You can pay later at the counter.');
  };

  return (
    <div className="bg-background text-on-surface pb-32 min-h-screen">
      {/* TopAppBar */}
      <header className="bg-surface/80 backdrop-blur-lg fixed top-0 w-full z-50 border-b border-outline-variant/15 flex justify-between items-center px-margin-mobile md:px-margin-desktop h-16 transition-all duration-300">
        <div className="flex items-center gap-3">
          {activeOrder && cart.length === 0 && (
            <button 
              onClick={() => setIsCheckoutOpen(true)}
              aria-label="View active order receipt"
              className="text-primary hover:text-primary-fixed-dim transition-colors hover:scale-95 duration-200 focus-ring-gold focus:outline-none rounded-full p-2"
              title="View active receipt"
            >
              <span className="material-symbols-outlined text-[24px]">receipt_long</span>
            </button>
          )}
          
          {/* Theme Toggle Button */}
          <button 
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}
            className="text-on-surface-variant hover:text-primary transition-all duration-300 hover:scale-105 p-2 rounded-full hover:bg-surface-container-high flex items-center justify-center shadow-sm border border-outline-variant/10 focus-ring-gold focus:outline-none"
            title={theme === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            <span className="material-symbols-outlined text-[20px] transition-transform duration-500 rotate-12 hover:rotate-0">
              {theme === 'dark' ? 'light_mode' : 'dark_mode'}
            </span>
          </button>
        </div>
        
        <div className="flex flex-col items-center select-none max-w-[50%] md:max-w-[40%]">
          <div className="font-display-lg text-[16px] sm:text-display-lg-mobile md:text-[22px] text-primary tracking-tighter text-center truncate font-semibold w-full">
            {restaurantName}
          </div>
          <div className="text-[8px] sm:text-[9px] font-label-caps text-on-surface-variant/80 uppercase tracking-widest text-center mt-0.5 truncate w-full">
            Prepared and fulfilled by {restaurantName}
          </div>
        </div>
        
        <button 
          className="text-primary hover:text-primary-fixed-dim transition-colors hover:scale-95 duration-200 relative p-2 rounded-full hover:bg-surface-container-high flex justify-center items-center focus-ring-gold focus:outline-none" 
          onClick={toggleCart}
          aria-label={`Open shopping cart drawer with ${cartCount} items`}
        >
          <span className="material-symbols-outlined text-[24px]">shopping_bag</span>
          {cartCount > 0 && (
            <motion.span 
              key={cartCount}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 15 }}
              className="absolute -top-0.5 -right-0.5 bg-red-600 text-white text-[10px] rounded-full h-5 w-5 flex items-center justify-center font-bold shadow-md font-sans"
            >
              {cartCount}
            </motion.span>
          )}
        </button>
      </header>

      {/* Main Content Area */}
      <main className="pt-16 w-full">
        
        {/* Hero Section */}
        {heroItem ? (
          <section className="relative bg-surface-container-lowest overflow-hidden py-12 md:py-20 border-b border-outline-variant/10">
            {/* Background atmospheric glows */}
            <div className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full bg-primary/5 blur-[120px] pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[300px] h-[300px] rounded-full bg-primary/3 blur-[100px] pointer-events-none" />

            <div className="max-w-[1200px] mx-auto px-margin-mobile md:px-margin-desktop relative z-10">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
                {/* Text Info */}
                <motion.div 
                  initial={{ opacity: 0, x: -30 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className="md:col-span-7 flex flex-col items-start text-left order-2 md:order-1"
                >
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold font-label-caps uppercase tracking-widest bg-primary/10 border border-primary/20 text-primary rounded-full mb-4 shadow-sm">
                    <span className="material-symbols-outlined text-[12px] font-bold">restaurant</span>
                    Signature Tasting
                  </span>
                  <h1 className="font-display-lg text-4xl md:text-5xl lg:text-6xl text-primary mb-4 leading-tight font-semibold">
                    {heroItem.name}
                  </h1>
                  <p className="font-body-lg text-[15px] md:text-body-lg text-on-surface-variant/80 max-w-xl mb-8 leading-relaxed">
                    {heroItem.description && heroItem.description.toLowerCase() !== heroItem.name.toLowerCase() 
                      ? heroItem.description 
                      : "Indulge in our masterfully crafted signature dish, prepared with premium local ingredients, authentic spices, and absolute culinary devotion."
                    }
                  </p>
                  <div className="flex items-center gap-6">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-label-caps text-on-surface-variant/50 uppercase tracking-widest">Price</span>
                      <span className="font-price-display text-3xl text-on-surface font-bold">₹{heroItem.price}</span>
                    </div>
                    <button 
                      onClick={() => handleOrderNow(heroItem)}
                      className="bg-gold-metallic text-on-primary-fixed font-label-caps text-[12px] px-8 py-4 rounded-xl uppercase tracking-widest gold-glow transition-all font-bold flex items-center gap-2"
                    >
                      Order Now <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                    </button>
                  </div>
                </motion.div>

                {/* Image Container */}
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
                  className="md:col-span-5 flex justify-center order-1 md:order-2 w-full"
                >
                  <div className="relative group w-full max-w-[340px] md:max-w-none aspect-square">
                    {/* Decorative background gold glow */}
                    <div className="absolute inset-0 bg-primary/15 rounded-[2.5rem] blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
                    
                    <div className="w-full h-full rounded-[2rem] overflow-hidden border border-primary/20 shadow-2xl bg-surface-container-high relative">
                      {heroItem.image ? (
                        <img 
                          src={heroItem.image} 
                          alt={heroItem.name} 
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-surface-container">
                          <span className="material-symbols-outlined text-8xl opacity-10 text-primary">restaurant</span>
                        </div>
                      )}
                      
                      {/* Subtle inner overlay for luxury feel */}
                      <div className="absolute inset-0 border border-white/10 rounded-[2rem] pointer-events-none" />
                    </div>
                    
                    {/* Floating Badge */}
                    <div className="absolute -bottom-3 -right-3 bg-surface-container border border-primary/30 text-primary px-4 py-2 text-[10px] font-label-caps uppercase tracking-widest rounded-xl flex items-center gap-1 shadow-xl">
                      <span className="material-symbols-outlined text-[14px] font-bold">award_star</span>
                      Chef's Pick
                    </div>
                  </div>
                </motion.div>
              </div>
            </div>
          </section>
        ) : menuLoading ? (
          <section className="h-[500px] flex items-center justify-center">
            <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
          </section>
        ) : (
          <section className="h-[400px] flex items-center justify-center bg-surface-container text-on-surface-variant">
            <div className="text-center">
              <span className="material-symbols-outlined text-6xl mb-4 opacity-50">restaurant_menu</span>
              <h2 className="font-headline-md text-headline-md">Menu Coming Soon</h2>
            </div>
          </section>
        )}

        {/* Sticky Search & Filters */}
        <section className="sticky top-16 z-40 bg-background/95 backdrop-blur-xl border-b border-outline-variant/30 py-4 w-full">
          <div className="max-w-[1200px] mx-auto px-margin-mobile md:px-margin-desktop flex flex-col gap-3 w-full">
            <div className="flex gap-4 items-center justify-between w-full">
              <div className="relative flex-1 max-w-md">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">search</span>
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search menu..." 
                  className="w-full bg-surface-container-high border-outline-variant border text-on-surface pl-10 pr-4 py-2 rounded focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors font-body-md text-body-md placeholder-on-surface-variant/50" 
                />
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setIsFilterOpen(true)}
                  className="bg-surface-container-high border border-outline-variant/50 text-on-surface-variant px-3 py-1 rounded hover:text-primary hover:border-primary/50 transition-colors flex items-center gap-1 font-label-caps text-label-caps uppercase gold-glow"
                >
                  <span className="material-symbols-outlined text-[16px]">tune</span> <span className="hidden sm:inline">Filter</span>
                </button>
              </div>
            </div>
            
            {/* Horizontally Scrollable Categories Bar */}
            <div className="overflow-x-auto hide-scrollbar scroll-smooth-horizontal flex gap-2 w-full py-1">
              {categories.map(cat => {
                const isActive = activeCategory === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={`relative px-5 py-2 text-[10px] md:text-[11px] font-label-caps uppercase tracking-widest transition-all duration-200 whitespace-nowrap rounded-full font-semibold border ${
                      isActive 
                        ? 'bg-gold-metallic text-on-primary-fixed shadow-sm border-transparent' 
                        : 'text-on-surface-variant/85 hover:text-primary bg-surface-container-low border-outline-variant/20'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Menu Grid */}
        <div className="max-w-[1200px] mx-auto w-full">
          <AnimatePresence mode="wait">
            <motion.section 
              key={activeCategory + '_' + searchQuery}
              variants={{
                hidden: { opacity: 0 },
                show: {
                  opacity: 1,
                  transition: {
                    staggerChildren: 0.03,
                    delayChildren: 0.05
                  }
                },
                exit: {
                  opacity: 0,
                  y: -10,
                  transition: {
                    duration: 0.15,
                    ease: "easeIn"
                  }
                }
              }}
              initial="hidden"
              animate="show"
              exit="exit"
              className="p-margin-mobile md:p-margin-desktop grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-gutter mt-8"
            >
              {menuLoading ? (
                Array.from({ length: 8 }).map((_, index) => (
                  <div key={index} className="bg-surface-container/40 border border-primary/15 rounded-2xl p-3 flex flex-col gap-3 animate-pulse">
                    <div className="w-full aspect-[4/3] rounded-xl bg-surface-container-high relative overflow-hidden" />
                    <div className="h-4 bg-surface-container-high rounded w-3/4" />
                    <div className="h-3 bg-surface-container-high rounded w-1/2 mt-1" />
                    <div className="flex justify-between items-center mt-4">
                      <div className="h-5 bg-surface-container-high rounded w-1/4" />
                      <div className="h-8 bg-surface-container-high rounded-full w-20" />
                    </div>
                  </div>
                ))
              ) : menuItems.length > 0 ? (
                menuItems.map((item) => {
                  const cartItem = cart.find(ci => ci._id === item._id);
                  return (
                    <motion.article 
                      variants={{
                        hidden: { opacity: 0, y: 15 },
                        show: { 
                          opacity: 1, 
                          y: 0,
                          transition: { 
                            type: "spring", 
                            stiffness: 260, 
                            damping: 24 
                          } 
                        }
                      }}
                      key={item._id} 
                      onClick={() => setSelectedItem(item)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedItem(item);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      className="bg-surface-container/40 backdrop-blur-md border border-primary/15 rounded-2xl overflow-hidden group hover:border-primary/45 premium-card-shadow focus-ring-gold focus:outline-none flex flex-col cursor-pointer transition-all duration-300"
                    >
                      <div className="relative overflow-hidden aspect-[4/3] w-full border-b border-primary/10">
                        {item.image ? (
                          <img 
                            src={item.image} 
                            alt={item.name} 
                            loading="lazy"
                            className="w-full h-full object-cover grayscale-[20%] group-hover:grayscale-0 group-hover:scale-105 transition-all duration-700" 
                          />
                        ) : (
                          <div className="w-full h-full bg-surface-variant flex items-center justify-center">
                            <span className="material-symbols-outlined text-4xl opacity-20">restaurant</span>
                          </div>
                        )}
                        {/* Subtle gradient overlay on hover for a premium feel */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
                        
                        {/* Dietary Tags Overlay */}
                        <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5 pointer-events-none">
                          {getDietaryTags(item).map(tag => (
                            <div 
                              key={tag.type} 
                              className={`flex items-center gap-1.5 px-2 py-0.5 text-[9px] font-semibold font-label-caps uppercase tracking-wider rounded-md border backdrop-blur-md shadow-sm ${tag.color}`}
                            >
                              {tag.type === 'veg' || tag.type === 'nonveg' ? (
                                <span className={`w-2.5 h-2.5 flex items-center justify-center border ${tag.type === 'veg' ? 'border-green-500' : 'border-red-500'} rounded-sm p-[1px]`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${tag.type === 'veg' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                </span>
                              ) : (
                                <span className="material-symbols-outlined text-[11px]">{tag.icon}</span>
                              )}
                              {tag.label}
                            </div>
                          ))}
                        </div>

                        {item.chefPick && (
                          <div className="absolute z-20 bg-surface-container/85 backdrop-blur-md border border-primary/30 text-primary px-3 py-1 text-[10px] font-label-caps uppercase tracking-widest rounded-full flex items-center gap-1 top-3 right-3 shadow-[0_4px_12px_rgba(0,0,0,0.5)]">
                            <span className="material-symbols-outlined text-[13px] font-bold">star</span> Chef's Pick
                          </div>
                        )}
                      </div>
                      
                      <div className="flex-1 flex flex-col justify-between p-3.5 md:p-5">
                        <div>
                          <h3 className="font-headline-sm text-[16px] md:text-headline-sm text-primary group-hover:text-primary-fixed transition-colors line-clamp-1 mb-1 font-semibold">{item.name}</h3>
                          <p className="font-body-md text-[12px] md:text-body-md text-on-surface-variant/70 line-clamp-2 mb-4 leading-relaxed">
                            {item.description}
                          </p>
                        </div>

                        <div className="flex justify-between items-center mt-auto pt-2 border-t border-outline-variant/10">
                          <span className="font-price-display text-[15px] md:text-price-display text-on-surface font-semibold">₹{item.price}</span>
                          <div onClick={(e) => e.stopPropagation()}>
                            {cartItem ? (
                              <div className="flex items-center gap-2 bg-surface-container-high border border-outline-variant/30 rounded-full px-2 py-0.5 shadow-sm">
                                <button 
                                  onClick={() => updateQuantity(item._id, -1)} 
                                  aria-label={`Decrease quantity of ${item.name}`}
                                  className="text-on-surface-variant hover:text-primary p-0.5 flex items-center justify-center rounded-full hover:bg-surface-container-highest transition-colors focus-ring-gold focus:outline-none"
                                >
                                  <span className="material-symbols-outlined text-[15px] md:text-[18px]">remove</span>
                                </button>
                                <span className="font-body-md text-on-surface w-4 text-center text-[12px] md:text-[13px] font-bold">{cartItem.quantity}</span>
                                <button 
                                  onClick={() => updateQuantity(item._id, 1)} 
                                  aria-label={`Increase quantity of ${item.name}`}
                                  className="text-on-surface-variant hover:text-primary p-0.5 flex items-center justify-center rounded-full hover:bg-surface-container-highest transition-colors focus-ring-gold focus:outline-none"
                                >
                                  <span className="material-symbols-outlined text-[15px] md:text-[18px]">add</span>
                                </button>
                              </div>
                            ) : (
                              <button 
                                onClick={() => addToCart(item)}
                                aria-label={`Add ${item.name} to cart`}
                                className="bg-primary/15 hover:bg-primary border border-primary/20 hover:border-primary text-primary hover:text-on-primary font-label-caps text-[9px] md:text-[10px] px-3.5 py-1.5 rounded-full uppercase tracking-wider transition-all duration-300 flex items-center gap-1 shadow-sm font-bold focus-ring-gold focus:outline-none"
                              >
                                <span className="material-symbols-outlined text-[12px] md:text-[14px]">add</span> Add
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.article>
                  );
                })
              ) : (
                <div className="col-span-full py-16 text-center text-on-surface-variant">
                  <span className="material-symbols-outlined text-5xl opacity-40 mb-3 block">search_off</span>
                  <p className="font-body-lg text-body-lg">No dishes found matching your selection.</p>
                </div>
              )}
            </motion.section>
          </AnimatePresence>

          {/* Infinite Scroll Trigger Element */}
          {hasMore && !menuLoading && (
            <div 
              ref={observerRef} 
              className="py-12 flex justify-center items-center w-full"
            >
              <div className="flex flex-col items-center gap-2">
                <span className="material-symbols-outlined text-primary text-2xl animate-spin">progress_activity</span>
                <span className="font-label-caps text-[9px] text-on-surface-variant/80 tracking-widest uppercase font-bold">Loading more flavors...</span>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* BottomNavBar (Mobile Only) */}
      <nav className="md:hidden bg-surface-container-lowest/95 backdrop-blur-lg border-t border-outline-variant/10 shadow-lg fixed bottom-0 w-full z-50 rounded-t-xl flex justify-around items-center h-20 px-4 pb-safe">
        <button className="flex flex-col items-center justify-center bg-secondary-container/30 text-primary rounded-xl px-3 py-1 hover:text-primary-fixed-dim transition-colors translate-y-[-2px] duration-300">
          <span className="material-symbols-outlined">restaurant_menu</span>
          <span className="font-label-caps text-label-caps mt-1">Menu</span>
        </button>
        <button 
          onClick={toggleCart}
          className="flex flex-col items-center justify-center text-on-surface-variant hover:text-primary-fixed-dim transition-colors"
        >
          <div className="relative">
            <span className="material-symbols-outlined">shopping_bag</span>
            {cartCount > 0 && (
              <span className="absolute -top-1 -right-2.5 bg-red-600 text-white text-[10px] rounded-full h-5 w-5 flex items-center justify-center font-bold font-sans">
                {cartCount}
              </span>
            )}
          </div>
          <span className="font-label-caps text-label-caps mt-1">Cart</span>
        </button>
      </nav>

      {/* Cart Drawer Overlay */}
      <AnimatePresence>
        {isCartOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]" 
            onClick={toggleCart} 
          />
        )}
      </AnimatePresence>

      {/* Cart Drawer */}
      <AnimatePresence>
        {isCartOpen && (
          <motion.div 
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            role="dialog"
            aria-modal="true"
            aria-label="Shopping Cart"
            className="fixed inset-y-0 right-0 w-full md:w-96 bg-surface-container border-l border-primary/20 shadow-2xl z-[70] flex flex-col"
          >
            <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-lowest">
              <h2 className="font-headline-sm text-headline-sm text-primary">Your Table</h2>
              <button 
                onClick={toggleCart} 
                aria-label="Close shopping cart drawer"
                className="text-on-surface-variant hover:text-primary transition-colors focus-ring-gold focus:outline-none rounded-full p-1"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>


            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4 hide-scrollbar">
              {cart.length === 0 ? (
                <div className="text-center text-on-surface-variant py-10 font-body-md">
                  Your culinary journey awaits.<br/>Select dishes to begin.
                </div>
              ) : (
                <AnimatePresence>
                  {cart.map(item => (
                    <motion.div 
                      key={item._id}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="flex justify-between items-center py-3 border-b border-outline-variant/10"
                    >
                      <div className="flex-1 pr-4">
                        <h4 className="font-body-md text-on-surface font-medium">{item.name}</h4>
                        <span className="font-price-display text-[14px] text-primary-fixed-dim">₹{item.price}</span>
                      </div>
                      <div className="flex items-center gap-3 bg-surface-container-high rounded border border-outline-variant/30 px-2 py-1">
                        <button 
                          onClick={() => updateQuantity(item._id, -1)} 
                          aria-label={`Decrease quantity of ${item.name}`}
                          className="text-on-surface-variant hover:text-primary focus-ring-gold focus:outline-none rounded-full"
                        >
                          <span className="material-symbols-outlined text-[18px]">remove</span>
                        </button>
                        <span className="font-body-md text-on-surface w-4 text-center font-semibold">{item.quantity}</span>
                        <button 
                          onClick={() => updateQuantity(item._id, 1)} 
                          aria-label={`Increase quantity of ${item.name}`}
                          className="text-on-surface-variant hover:text-primary focus-ring-gold focus:outline-none rounded-full"
                        >
                          <span className="material-symbols-outlined text-[18px]">add</span>
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>

            <div className="p-6 border-t border-outline-variant/20 bg-surface-container-lowest">
              <div className="text-[11px] text-on-surface-variant/80 font-medium mb-3 text-center border-b border-outline-variant/10 pb-2">
                Sold & fulfilled by <span className="font-bold text-on-surface">{restaurantName}</span>
              </div>
              <div className="flex justify-between items-center mb-4">
                <span className="font-body-lg text-body-lg text-on-surface">Subtotal</span>
                <span className="font-price-display text-price-display text-primary">₹{cartTotal.toFixed(2)}</span>
              </div>
              <button 
                onClick={() => {
                  if (!checkoutSessionId) {
                    const newSessId = 'sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
                    setCheckoutSessionId(newSessId);
                  }
                  setIsCheckoutOpen(true);
                }}
                disabled={cart.length === 0}
                className="w-full bg-gold-metallic text-on-primary-fixed font-label-caps text-label-caps py-4 rounded uppercase tracking-wider gold-glow transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed focus-ring-gold focus:outline-none"
              >
                Proceed to Checkout <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Checkout Drawer (Overlays Cart) */}
      <AnimatePresence>
        {isCheckoutOpen && (isCartOpen || activeOrder) && (
          <motion.div 
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            role="dialog"
            aria-modal="true"
            aria-label={activeOrder ? "Active Order History" : "Checkout Order Confirmation"}
            className="fixed inset-y-0 right-0 w-full md:w-96 bg-surface-container border-l border-primary/20 shadow-2xl z-[80] flex flex-col"
          >
            <div className="p-6 border-b border-outline-variant/20 flex items-center gap-4 bg-surface-container-lowest">
              <button 
                onClick={() => setIsCheckoutOpen(false)} 
                aria-label="Back to shopping cart"
                className="text-on-surface-variant hover:text-primary transition-colors focus-ring-gold focus:outline-none rounded-full p-1"
              >
                <span className="material-symbols-outlined">arrow_back</span>
              </button>
              <h2 className="font-headline-sm text-headline-sm text-primary">{activeOrder ? 'Active Order' : 'Checkout'}</h2>
            </div>
            
            <div className="flex-1 p-8 flex flex-col items-center justify-center text-center overflow-y-auto">
              {/* Order Summary */}
              <div className="grid grid-cols-3 gap-3 w-full mb-8 shrink-0">
                <div className="bg-surface-container-high border border-outline-variant/20 rounded-lg p-3">
                  <span className="font-label-caps text-label-caps text-on-surface-variant block mb-1">Table</span>
                  <strong className="font-price-display text-price-display text-primary">{selectedTable}</strong>
                </div>
                <div className="bg-surface-container-high border border-outline-variant/20 rounded-lg p-3">
                  <span className="font-label-caps text-label-caps text-on-surface-variant block mb-1">Items</span>
                  <strong className="font-price-display text-price-display text-primary">
                    {activeOrder 
                      ? sessionItemsCount
                      : cartCount}
                  </strong>
                </div>
                <div className="bg-surface-container-high border border-outline-variant/20 rounded-lg p-3">
                  <span className="font-label-caps text-label-caps text-on-surface-variant block mb-1">Total</span>
                  <strong className="font-price-display text-price-display text-primary">
                    ₹{(activeOrder ? sessionTotal : cartTotal).toFixed(2)}
                  </strong>
                </div>
              </div>

              {activeOrder ? (
                <>
                  {/* Verification Status Banner */}
                  <div className="w-full bg-primary/10 border border-primary/20 rounded-lg p-3.5 mb-6 text-center shrink-0">
                    <span className="font-label-caps text-[11px] text-primary font-bold flex items-center justify-center gap-1">
                      <span className="material-symbols-outlined text-sm">
                        {unpaidTotal === 0 ? 'verified' : 'check_circle'}
                      </span>
                      {unpaidTotal === 0 ? 'All Orders Paid & Confirmed' : 'Orders Verified by Waiter'}
                    </span>
                    <p className="text-[10px] text-on-surface-variant/80 mt-1 leading-relaxed">
                      Session Orders: {ordersList.length} | Pending Payment: ₹{unpaidTotal.toFixed(2)}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <p className="font-body-md text-body-md text-on-surface-variant mb-6">Show this code to your waiter to confirm your order.</p>
                   
                   {/* 4-Digit Verification Code */}
                   <div className="relative bg-surface-container-high rounded-2xl mb-6 border-2 border-primary/30 gold-glow shrink-0 overflow-hidden px-8 py-6 flex flex-col items-center gap-3">
                     <span className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-widest">Your Order Code</span>
                     {verificationCode ? (
                       <div className="flex items-center gap-3">
                         {verificationCode.split('').map((digit, i) => (
                           <span key={i} className="w-14 h-16 flex items-center justify-center bg-surface-container-lowest border-2 border-primary/40 rounded-xl text-3xl font-bold text-primary font-mono shadow-lg">
                             {digit}
                           </span>
                         ))}
                       </div>
                     ) : (
                       <div className="flex items-center gap-2 py-4 text-on-surface-variant">
                         <span className="material-symbols-outlined animate-spin text-primary">progress_activity</span>
                         <span className="font-label-caps text-[11px]">Generating code...</span>
                       </div>
                     )}
                   </div>

                   {/* Code Details */}
                   <div className="w-full bg-surface-container-high border border-outline-variant/20 rounded-lg p-4 mb-6 text-left shrink-0">
                     <h4 className="font-body-md text-on-surface font-medium mb-1">Code includes</h4>
                     <p className="font-body-md text-body-md text-on-surface-variant/70">Table number, selected items, quantity, item prices, and total.</p>
                   </div>
                   
                   {/* Verification Status Banner */}
                   <div className="w-full bg-error/10 border border-error/20 rounded-lg p-3.5 mb-6 text-center shrink-0">
                     <span className="font-label-caps text-[11px] text-error font-bold flex items-center justify-center gap-1">
                       <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                       Awaiting Waiter Verification
                     </span>
                     <p className="text-[10px] text-on-surface-variant/80 mt-1 leading-relaxed">
                       Show the 4-digit code above to your waiter. Once verified, payment will unlock.
                     </p>
                   </div>
                </>
              )}
              
              {/* Session Order History List (renders if they have any active verified orders) */}
              {ordersList.length > 0 && (
                <div className="w-full flex flex-col gap-3 text-left mt-2 mb-6 flex-1 min-h-0">
                  <h3 className="font-label-caps text-[11px] text-primary border-b border-outline-variant/15 pb-2 uppercase tracking-widest font-bold flex justify-between items-center shrink-0">
                    <span>Order History ({ordersList.length})</span>
                    <span className="font-mono text-on-surface-variant text-[11px] lowercase tracking-normal">Total: ₹{sessionTotal.toFixed(2)}</span>
                  </h3>
                  
                  <div className="space-y-3 w-full overflow-y-auto pr-1 hide-scrollbar flex-1 min-h-[120px]">
                    {ordersList.map((order, idx) => (
                      <div key={order._id || idx} className="bg-surface-container-high border border-outline-variant/15 rounded-xl p-3.5 flex flex-col gap-2 shadow-sm">
                        {/* Header */}
                        <div className="flex justify-between items-center text-[11px] font-semibold border-b border-outline-variant/10 pb-1.5 font-sans">
                          <span className="text-primary font-mono">Order #{order._id.toString().substring(18)}</span>
                          <span className="text-on-surface-variant/80 font-normal">
                            {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        
                        {/* Seller Identity */}
                        <div className="text-[10px] font-label-caps text-on-surface-variant/75 uppercase tracking-widest font-semibold">
                          {restaurantName}
                        </div>
                        
                        {/* Items */}
                        <div className="space-y-1">
                          {order.items.map((item, itemIdx) => (
                            <div key={item.id || itemIdx} className="flex justify-between items-center text-[12px]">
                              <span className="text-on-surface-variant truncate">
                                <span className="text-primary font-semibold font-mono mr-1">{item.quantity}x</span> {item.name}
                              </span>
                              <span className="text-on-surface font-medium">₹{(item.price * item.quantity).toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                        
                        {/* Status Footer */}
                        <div className="flex justify-between items-center text-[11px] font-medium border-t border-outline-variant/10 pt-1.5 mt-1 font-sans">
                          <span className="flex items-center gap-1">
                            {order.paymentStatus === 'PAID' ? (
                              <span className="text-green-500 font-bold flex items-center gap-0.5">
                                <span className="material-symbols-outlined text-[13px]">verified</span> Paid
                              </span>
                            ) : (
                              <span className="text-amber-500 font-bold flex items-center gap-0.5">
                                <span className="material-symbols-outlined text-[13px]">pending</span> Unpaid
                              </span>
                            )}
                            <span className="text-on-surface-variant/50 font-normal">| {order.status}</span>
                          </span>
                          <span className="text-primary font-bold font-price-display">₹{order.total.toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="w-full space-y-4 shrink-0">
                {(!activeOrder || unpaidTotal > 0) ? (
                  <>
                    {/* Seller & Fulfillment Disclosure */}
                    <div className="bg-surface-container-high/60 border border-outline-variant/20 rounded-xl p-3 text-[11px] text-on-surface-variant/90 leading-relaxed text-left">
                      <strong className="text-on-surface font-semibold block mb-1">Seller & Fulfillment</strong>
                      <p>
                        <span className="font-semibold text-on-surface">{restaurantName}</span> prepares and fulfills this order. <span className="font-semibold text-on-surface">{restaurantName}</span> provides the digital ordering technology and facilitates online payment processing. Payments are securely processed through Razorpay.
                      </p>
                    </div>

                    <button 
                      onClick={handlePayNow}
                      className={`w-full py-3 rounded font-label-caps text-label-caps uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all ${
                        (isOrderVerified || unpaidTotal > 0)
                          ? 'bg-gold-metallic text-on-primary-fixed gold-glow' 
                          : 'bg-surface-container-high border border-outline-variant/30 text-on-surface-variant/40 cursor-not-allowed'
                      }`}
                    >
                      <span className="material-symbols-outlined">credit_card</span> Pay Now (₹{unpaidTotal > 0 ? unpaidTotal.toFixed(2) : cartTotal.toFixed(2)})
                    </button>
                    <button 
                      onClick={handlePayLater}
                      className="w-full bg-surface-container-high border border-outline-variant/50 text-on-surface py-3 rounded font-body-md text-body-md hover:border-primary/50 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <span className="material-symbols-outlined">schedule</span> Pay Later
                    </button>

                    <div className="text-[10px] text-on-surface-variant/60 flex items-center justify-center gap-1 mt-1 font-medium">
                      <span className="material-symbols-outlined text-[12px] text-green-500">lock</span>
                      <span>Secure payment powered by Razorpay</span>
                    </div>
                  </>
                ) : (
                  <button 
                    onClick={() => setIsCheckoutOpen(false)}
                    className="w-full bg-primary text-on-primary py-3 rounded font-label-caps text-label-caps uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all"
                  >
                    Close Receipt
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter Drawer Overlay */}
      <AnimatePresence>
        {isFilterOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]" 
            onClick={() => setIsFilterOpen(false)} 
          />
        )}
      </AnimatePresence>

      {/* Filter Bottom Sheet / Drawer */}
      <AnimatePresence>
        {isFilterOpen && (
          <motion.div 
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed inset-x-0 bottom-0 w-full md:w-96 md:inset-y-0 md:right-0 md:left-auto md:translate-y-0 md:translate-x-[100%] bg-surface-container border-t md:border-l md:border-t-0 border-primary/20 shadow-2xl z-[70] flex flex-col rounded-t-2xl md:rounded-none"
          >
            <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-lowest rounded-t-2xl md:rounded-none">
              <h2 className="font-headline-sm text-headline-sm text-primary flex items-center gap-2">
                <span className="material-symbols-outlined">tune</span> Filters
              </h2>
              <button onClick={() => setIsFilterOpen(false)} className="text-on-surface-variant hover:text-primary transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            <div className="p-6 flex flex-col gap-4 overflow-y-auto hide-scrollbar">
              <div>
                <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest block mb-3">Categories</label>
                <div className="flex flex-wrap gap-2">
                  {categories.map(cat => (
                    <button 
                      key={cat}
                      onClick={() => setActiveCategory(cat)}
                      className={`px-5 py-2 rounded font-label-caps text-[11px] uppercase tracking-widest transition-all ${
                        activeCategory === cat 
                          ? 'bg-primary text-on-primary' 
                          : 'bg-surface-container-high border border-outline-variant/50 text-on-surface-variant hover:border-primary/50'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Item Detail Modal */}
      <AnimatePresence>
        {selectedItem && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4 md:p-8"
            onClick={() => setSelectedItem(null)}
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedItem.name} details`}
          >
            <motion.div 
              initial={{ opacity: 0, y: 50, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 50, scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="bg-surface-container w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col max-h-[90vh] shadow-2xl border border-primary/20"
            >
              <div className="relative w-full h-64 md:h-80 shrink-0">
                {selectedItem.image ? (
                  <img src={selectedItem.image} alt={selectedItem.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-surface-variant flex items-center justify-center">
                    <span className="material-symbols-outlined text-6xl opacity-20">restaurant</span>
                  </div>
                )}
                <button 
                  onClick={() => setSelectedItem(null)}
                  aria-label="Close details dialog"
                  className="absolute top-4 right-4 bg-black/50 hover:bg-black/80 text-white p-2 rounded-full backdrop-blur-md transition-colors focus-ring-gold focus:outline-none"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              
              <div className="p-6 md:p-8 flex-1 overflow-y-auto hide-scrollbar">
                <div className="flex justify-between items-start mb-4 gap-4">
                  <h2 className="font-headline-md text-primary text-2xl md:text-3xl">{selectedItem.name}</h2>
                  <span className="font-price-display text-on-surface text-xl md:text-2xl shrink-0">₹{selectedItem.price}</span>
                </div>
                
                <div className="flex flex-wrap gap-2 mb-6">
                  {(selectedItem.categories || (selectedItem.category ? [selectedItem.category] : [])).map(cat => (
                    <span key={cat} className="bg-surface-variant text-on-surface-variant px-3 py-1 rounded-full text-[12px] font-label-caps uppercase tracking-widest">{cat}</span>
                  ))}
                  {selectedItem.chefPick && (
                    <span className="bg-primary/20 text-primary border border-primary/30 px-3 py-1 rounded-full text-[12px] font-label-caps uppercase tracking-widest flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">star</span> Chef's Pick
                    </span>
                  )}
                  {getDietaryTags(selectedItem).map(tag => (
                    <span 
                      key={tag.type} 
                      className={`px-3 py-1 rounded-full text-[12px] font-label-caps uppercase tracking-widest flex items-center gap-1.5 border backdrop-blur-md shadow-sm ${tag.color}`}
                    >
                      {tag.type === 'veg' || tag.type === 'nonveg' ? (
                        <span className={`w-2.5 h-2.5 flex items-center justify-center border ${tag.type === 'veg' ? 'border-green-500' : 'border-red-500'} rounded-sm p-[1px]`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${tag.type === 'veg' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                        </span>
                      ) : (
                        <span className="material-symbols-outlined text-[14px]">{tag.icon}</span>
                      )}
                      {tag.label}
                    </span>
                  ))}
                </div>
                
                <p className="font-body-md text-on-surface-variant/90 leading-relaxed whitespace-pre-wrap">
                  {selectedItem.description}
                </p>
              </div>
              
              <div className="p-6 border-t border-outline-variant/10 bg-surface-container-lowest flex gap-4 items-center justify-between shrink-0">
                {cart.find(i => i._id === selectedItem._id) ? (
                  <div className="flex items-center gap-3 bg-surface-container-high border border-outline-variant/30 rounded-xl px-4 py-2 shadow-sm">
                    <button 
                      onClick={() => updateQuantity(selectedItem._id, -1)} 
                      className="text-on-surface-variant hover:text-primary flex items-center justify-center p-1 rounded-full hover:bg-surface-container-highest transition-colors"
                    >
                      <span className="material-symbols-outlined text-[20px]">remove</span>
                    </button>
                    <span className="font-body-md text-on-surface w-6 text-center text-[15px] font-bold">
                      {cart.find(i => i._id === selectedItem._id).quantity}
                    </span>
                    <button 
                      onClick={() => updateQuantity(selectedItem._id, 1)} 
                      className="text-on-surface-variant hover:text-primary flex items-center justify-center p-1 rounded-full hover:bg-surface-container-highest transition-colors"
                    >
                      <span className="material-symbols-outlined text-[20px]">add</span>
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={() => addToCart(selectedItem)}
                    className="flex-1 bg-surface-container-highest hover:bg-surface-bright text-on-surface border border-outline-variant/30 font-label-caps text-[14px] py-3 md:py-4 rounded-xl uppercase tracking-wider transition-colors"
                  >
                    Add to Cart
                  </button>
                )}
                <button 
                  onClick={() => {
                    if (!cart.find(i => i._id === selectedItem._id)) {
                      addToCart(selectedItem);
                    }
                    setIsCartOpen(true);
                    setSelectedItem(null);
                  }}
                  className="flex-1 bg-gold-metallic text-on-primary-fixed font-label-caps text-[14px] py-3 md:py-4 rounded-xl uppercase tracking-wider gold-glow transition-all flex items-center justify-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[18px]">shopping_bag</span> View Cart
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>


      {/* Footer */}
      <footer className="mt-20 border-t border-outline-variant/15 py-10 bg-surface-container-lowest/80 backdrop-blur-md">
        <div className="max-w-[1200px] mx-auto px-margin-mobile md:px-margin-desktop flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-center md:text-left flex flex-col items-center md:items-start">
            <div className="font-display-lg text-[18px] text-primary font-semibold mb-2">{restaurantName}</div>
            <p className="text-body-sm text-on-surface-variant/70 max-w-xs leading-relaxed text-[12px] md:text-body-sm mb-3">
              Online tableside ordering and secure payment fulfillment for {restaurantName}. Payments are processed securely through Razorpay.
            </p>
            {restaurantMapLink && (
              <a 
                href={restaurantMapLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] font-label-caps uppercase tracking-wider text-primary hover:text-primary/80 transition-colors border border-primary/20 bg-primary/5 px-3.5 py-1.5 rounded-full gold-glow font-bold focus-ring-gold focus:outline-none"
              >
                <span className="material-symbols-outlined text-[16px]">location_on</span>
                View Location
              </a>
            )}
          </div>
          <div className="flex flex-wrap justify-center gap-6 font-label-caps text-[11px] uppercase tracking-widest">
            <button onClick={() => setActivePolicy('restaurant-info')} className="text-on-surface-variant hover:text-primary transition-colors focus-ring-gold rounded px-1.5 py-0.5">About Restaurant</button>
            <button onClick={() => setActivePolicy('privacy')} className="text-on-surface-variant hover:text-primary transition-colors focus-ring-gold rounded px-1.5 py-0.5">Privacy Policy</button>
            <button onClick={() => setActivePolicy('terms')} className="text-on-surface-variant hover:text-primary transition-colors focus-ring-gold rounded px-1.5 py-0.5">Terms & Conditions</button>
            <button onClick={() => setActivePolicy('refund')} className="text-on-surface-variant hover:text-primary transition-colors focus-ring-gold rounded px-1.5 py-0.5">Cancellation & Refund</button>
            <button onClick={() => setActivePolicy('contact')} className="text-on-surface-variant hover:text-primary transition-colors focus-ring-gold rounded px-1.5 py-0.5">Contact Us</button>
          </div>
        </div>
        <div className="max-w-[1200px] mx-auto px-margin-mobile md:px-margin-desktop text-center mt-8 pt-4 border-t border-outline-variant/10 text-[10px] text-on-surface-variant/40">
          © 2026 {restaurantName}. All rights reserved. Powered by Razorpay.
        </div>
      </footer>

      {/* Policy Modal */}
      <AnimatePresence>
        {activePolicy && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-[110] flex items-center justify-center p-4 md:p-8"
            onClick={() => setActivePolicy(null)}
            role="dialog"
            aria-modal="true"
            aria-label={`${activePolicy} Policy`}
          >
            <motion.div 
              initial={{ opacity: 0, y: 50, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 50, scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="bg-surface-container w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col max-h-[85vh] shadow-2xl border border-primary/20"
            >
              <div className="p-6 border-b border-outline-variant/10 flex justify-between items-center bg-surface-container-lowest shrink-0">
                <h2 className="font-headline-sm text-primary text-xl md:text-2xl capitalize">
                  {activePolicy === 'privacy' && 'Privacy Policy'}
                  {activePolicy === 'terms' && 'Terms & Conditions'}
                  {activePolicy === 'refund' && 'Cancellation & Refund Policy'}
                  {activePolicy === 'contact' && 'Contact Us'}
                  {activePolicy === 'restaurant-info' && 'Restaurant Information'}
                </h2>
                <button 
                  onClick={() => setActivePolicy(null)}
                  aria-label="Close policy modal"
                  className="text-on-surface-variant hover:text-primary transition-colors focus-ring-gold focus:outline-none rounded-full p-1"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              
              <div className="p-6 md:p-8 flex-1 overflow-y-auto hide-scrollbar text-on-surface-variant/90 space-y-4 font-body-md text-sm md:text-[15px] leading-relaxed text-left">
                {activePolicy === 'privacy' && (
                  <>
                    <p><strong>Effective Date:</strong> June 15, 2026</p>
                    <p>Welcome to {restaurantName} (accessible via https://food-menu-pb17.vercel.app). We respect your privacy and are committed to protecting your personal data. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website and use our food ordering services.</p>
                    <p>Please read this privacy policy carefully. If you do not agree with the terms of this privacy policy, please do not access the site.</p>
                    
                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">1. Information We Collect</h3>
                    <p>We collect information that you provide directly to us when you place an order, create an account, or interact with our platform. This includes:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li><strong>Personal Identifiable Information (PII):</strong> Name, delivery address, email address, and phone number.</li>
                      <li><strong>Order Details:</strong> Information about the food items you order, special instructions, and transaction history.</li>
                      <li><strong>Device and Usage Data:</strong> IP address, browser type, operating system, and your behavior on our website (collected via cookies).</li>
                    </ul>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">2. Payment Data and Security</h3>
                    <p>To process payments, we use a secure third-party payment gateway: Razorpay.</p>
                    <p>We do not store your credit/debit card numbers, CVV, UPI IDs, or net banking passwords on our servers.</p>
                    <p>All payment processing is handled securely by Razorpay in compliance with the Payment Card Industry Data Security Standard (PCI-DSS). Razorpay's use of your personal information is governed by their respective Privacy Policy.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">3. How We Use Your Information</h3>
                    <p>We use the collected information to:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Process, fulfill, and deliver your food orders.</li>
                      <li>Manage your account and provide customer support.</li>
                      <li>Send transaction receipts, order updates, and administrative messages.</li>
                      <li>Detect, prevent, and mitigate fraudulent or illegal activities.</li>
                    </ul>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">4. Data Sharing and Split Settlements (Third Parties)</h3>
                    <p>Because our platform coordinates food preparation and delivery, we must share certain information with third parties to fulfill your request:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li><strong>Merchants/Restaurants:</strong> We share your order details and name with the respective food vendors so they can prepare your meals.</li>
                      <li><strong>Delivery Partners:</strong> We share your delivery address and phone number with delivery personnel so they can transport your order.</li>
                      <li><strong>Financial Sub-agents (Razorpay Route):</strong> To facilitate automated split settlements between our platform and our registered food vendors, transaction and billing data is processed via Razorpay's routing architecture.</li>
                      <li><strong>Legal Requirements:</strong> We may disclose your information if required to do so by law or in response to valid requests by public authorities.</li>
                    </ul>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">5. Cookies</h3>
                    <p>We use cookies and similar tracking technologies to track activity on our website and hold certain information to improve your browsing experience. You can instruct your browser to refuse all cookies, but doing so may prevent you from using some parts of our platform.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">6. Data Retention and Security</h3>
                    <p>We retain your personal information only for as long as necessary to fulfill the purposes outlined in this policy and to comply with legal/accounting requirements. We implement industry-standard administrative, technical, and physical security measures to protect your data, though no method of transmission over the internet is 100% secure.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">7. Your Rights</h3>
                    <p>Depending on your location, you may have the right to access, correct, or delete the personal information we hold about you. To exercise these rights, please contact us using the information below.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">8. Changes to This Policy</h3>
                    <p>We reserve the right to modify this Privacy Policy at any time. Any changes will be posted on this page with an updated "Effective Date."</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">9. Contact Us</h3>
                    <p>If you have questions or comments about this Privacy Policy, please contact us at:</p>
                    <ul className="list-none space-y-1">
                      <li><strong>Business Name:</strong> {restaurantName}</li>
                      <li><strong>Email:</strong> {restaurantEmail}</li>
                      <li><strong>Phone:</strong> {restaurantPhone}</li>
                      <li><strong>Physical Address:</strong> {restaurantAddress}</li>
                    </ul>
                  </>
                )}
                {activePolicy === 'terms' && (
                  <>
                    <p><strong>Effective Date:</strong> June 15, 2026</p>
                    <p>Welcome to {restaurantName}. By accessing our website (https://food-menu-pb17.vercel.app) and placing food orders, you agree to comply with and be bound by the following Terms & Conditions. Please read them carefully.</p>
                    
                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">1. Services Provided</h3>
                    <p>{restaurantName} operates a digital table ordering platform connecting customers with authorized food merchants. The restaurant is the actual seller and fulfiller of food orders, and is solely responsible for preparing and delivering meals. Payments are processed securely through Razorpay.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">2. User Accounts & Responsibilities</h3>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>You must provide accurate and complete information when placing orders (Table number, contact details, payment information).</li>
                      <li>You agree not to misuse our platform, disrupt servers, or initiate fraudulent transactions.</li>
                    </ul>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">3. Placing Orders & Pricing</h3>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>All orders placed through the platform are subject to availability and merchant confirmation.</li>
                      <li>Prices are shown in INR (₹) and include applicable taxes unless specified otherwise.</li>
                      <li>We reserve the right to refuse service or cancel orders at our sole discretion.</li>
                    </ul>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">4. Payments & Razorpay</h3>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Payments are processed securely via Razorpay. By choosing online payment, you agree to be bound by Razorpay's Terms of Service.</li>
                      <li>Any transaction fees or credit card charges applied by banks are the user's responsibility.</li>
                    </ul>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">5. Limitation of Liability</h3>
                    <p>{restaurantName} is not liable for indirect, incidental, or consequential damages resulting from the use or inability to use our services, food preparation delays, or errors by third-party delivery partners.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">6. Governing Law</h3>
                    <p>These Terms & Conditions are governed by and construed in accordance with the laws of India. Any disputes shall be subject to the exclusive jurisdiction of the courts in Bangalore, India.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">7. Contact Us</h3>
                    <p>If you have questions regarding these Terms & Conditions, contact us at {restaurantEmail}.</p>
                  </>
                )}
                {activePolicy === 'refund' && (
                  <>
                    <p><strong>Effective Date:</strong> June 15, 2026</p>
                    <p>{restaurantName} is a digital ordering technology provider. The restaurant is the actual seller of the food orders and holds sole responsibility for food preparation, fulfillment, order cancellations, and processing refunds. Online payments and refund settlements are processed securely via Razorpay.</p>
                    
                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">1. Order Cancellation</h3>
                    <ul className="list-disc pl-5 space-y-1">
                      <li><strong>Before Preparation:</strong> Customers can request order cancellations before the kitchen begins preparing the food. Please coordinate immediately with your server.</li>
                      <li><strong>After Preparation Begins:</strong> Food orders cannot be cancelled once food preparation has commenced. No refunds will be provided for cancellations requested after this point.</li>
                    </ul>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">2. Refund Eligibility & Process</h3>
                    <ul className="list-disc pl-5 space-y-1">
                      <li><strong>Merchant Refusal:</strong> If a restaurant or merchant is unable to fulfill your order due to item unavailability or other operational challenges, you will receive a full refund.</li>
                      <li><strong>Payment Failure:</strong> In case of double-deduction or transaction failure where money was debited but the order failed verification, the amount will be automatically credited back by Razorpay.</li>
                      <li><strong>Quality Issues:</strong> If you experience issues with food quality or order completeness, please notify staff immediately at the venue. Online refund adjustments will be assessed case-by-case.</li>
                    </ul>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">3. Refund Timelines</h3>
                    <p>Approved online refunds will be processed via Razorpay to the original payment source (Credit/Debit Card, Net Banking, or UPI) within <strong>5 to 7 business days</strong> in compliance with standard bank processing times.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">4. Contact Us</h3>
                    <p>For cancellation or refund assistance, please email {restaurantEmail} or speak directly with the table captain/staff.</p>
                  </>
                )}
                {activePolicy === 'contact' && (
                  <>
                    <p>We would love to hear from you! For reservations, support, feedback, or business inquiries, please reach out to us using the exact details below.</p>
                    
                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">📍 General Inquiries & Customer Support</h3>
                    <ul className="list-none space-y-2">
                      <li><strong>Registered Business/Legal Name:</strong> {restaurantName}</li>
                      <li><strong>Support Email:</strong> {restaurantEmail}</li>
                      <li><strong>Customer Support Phone:</strong> {restaurantPhone}</li>
                      <li>
                        <strong>Physical Address:</strong> {restaurantAddress}
                        {restaurantMapLink && (
                          <a 
                            href={restaurantMapLink} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="ml-2 text-primary hover:text-gold-metallic transition-colors inline-flex items-center gap-0.5 text-xs font-bold"
                          >
                            <span className="material-symbols-outlined text-[14px]">map</span>
                            (Map Link)
                          </a>
                        )}
                      </li>
                      <li><strong>Operational Hours:</strong> {restaurantHours || 'Monday - Sunday, 11:00 AM - 11:00 PM IST'}</li>
                    </ul>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">💬 Help Desk & Table Assistance</h3>
                    <p>If you are currently dining at our restaurant, you can call for waiter verification or bill requests directly through your table QR code interface. For urgent billing issues, please contact the billing desk at our physical counter.</p>
                  </>
                )}
                {activePolicy === 'restaurant-info' && (
                  <>
                    <p className="text-body-md text-on-surface-variant mb-6">
                      Official trade, licensing, and compliance information for {restaurantName}.
                    </p>
                    
                    <div className="bg-surface-container-high/40 border border-outline-variant/10 rounded-2xl p-5 flex flex-col gap-4 text-sm">
                      <div className="flex justify-between items-start pb-3 border-b border-outline-variant/10">
                        <span className="text-on-surface-variant font-medium">Restaurant Name</span>
                        <span className="text-on-surface font-semibold text-right max-w-xs">{restaurantName}</span>
                      </div>
                      <div className="flex justify-between items-start pb-3 border-b border-outline-variant/10">
                        <span className="text-on-surface-variant font-medium">Address</span>
                        <div className="flex flex-col items-end gap-1 max-w-xs">
                          <span className="text-on-surface font-semibold text-right whitespace-pre-line">{restaurantAddress || 'Not Configured'}</span>
                          {restaurantMapLink && (
                            <a 
                              href={restaurantMapLink} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="text-xs text-primary hover:text-gold-metallic transition-colors flex items-center gap-1 mt-1 font-bold"
                            >
                              <span className="material-symbols-outlined text-[14px]">map</span>
                              Open in Google Maps
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between items-start pb-3 border-b border-outline-variant/10">
                        <span className="text-on-surface-variant font-medium">Contact</span>
                        <span className="text-on-surface font-semibold text-right">{restaurantPhone || 'Not Configured'}</span>
                      </div>
                      <div className="flex justify-between items-start">
                        <span className="text-on-surface-variant font-medium">FSSAI Licence No.</span>
                        <span className="text-on-surface font-mono font-bold text-right">{restaurantFssai || 'Not Applicable'}</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
              
              <div className="p-4 border-t border-outline-variant/10 bg-surface-container-lowest flex justify-end shrink-0">
                <button 
                  onClick={() => setActivePolicy(null)}
                  className="bg-primary hover:bg-primary-fixed-dim text-on-primary font-label-caps text-xs px-6 py-2.5 rounded-full uppercase tracking-wider transition-colors focus-ring-gold focus:outline-none"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Payment Success Confirmation Modal */}
      <AnimatePresence>
        {paidOrderDetails && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/85 backdrop-blur-md z-[120] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-surface-container w-full max-w-md rounded-3xl p-6 md:p-8 border border-primary/30 shadow-2xl flex flex-col items-center text-center relative overflow-hidden"
            >
              {/* Background atmospheric glows */}
              <div className="absolute top-0 w-full h-32 bg-gradient-to-b from-primary/10 to-transparent pointer-events-none" />

              <div className="w-16 h-16 rounded-full bg-primary/15 border-2 border-primary text-primary flex items-center justify-center mb-6 relative z-10">
                <span className="material-symbols-outlined text-3xl font-bold animate-[pulse_2s_infinite]">check</span>
              </div>

              <h2 className="font-headline-md text-2xl text-primary font-bold mb-1 relative z-10">Order Confirmed!</h2>
              <p className="text-[11px] font-label-caps text-on-surface-variant/80 uppercase tracking-widest mb-6">Prepared and fulfilled by {restaurantName}</p>

              <div className="w-full bg-surface-container-high/60 border border-outline-variant/15 rounded-2xl p-4 mb-6 flex flex-col gap-3 text-sm text-left">
                <div className="flex justify-between items-center pb-2 border-b border-outline-variant/10 text-xs">
                  <span className="text-on-surface-variant">Merchant Seller</span>
                  <span className="font-semibold text-on-surface">{restaurantName}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-on-surface-variant">Order ID</span>
                  <span className="font-mono text-primary font-bold">#{paidOrderDetails.orderId.toString().substring(18)}</span>
                </div>
                <div className="flex justify-between items-center text-xs pt-1">
                  <span className="text-on-surface-variant">Amount Paid</span>
                  <span className="font-price-display text-primary font-semibold">₹{paidOrderDetails.amount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-xs pt-2 border-t border-outline-variant/10">
                  <span className="text-on-surface-variant">Payment Status</span>
                  <span className="px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-bold font-label-caps uppercase tracking-wider text-[9px]">PAID</span>
                </div>
              </div>

              <p className="text-xs text-on-surface-variant/80 mb-6 leading-relaxed">
                Your payment was processed securely. The kitchen has received your order and is starting preparation.
              </p>

              <button 
                onClick={() => setPaidOrderDetails(null)}
                className="w-full bg-gold-metallic text-on-primary-fixed font-label-caps text-xs py-3.5 rounded-xl uppercase tracking-widest gold-glow font-bold transition-all active:scale-95"
              >
                Start Tracking Order
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Toast Notification */}
      <AnimatePresence>
        {notification && (
          <motion.div 
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className="fixed bottom-24 left-4 right-4 md:left-auto md:right-10 md:bottom-10 bg-surface-container-high border border-primary/30 text-primary px-6 py-3 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.5),0_0_20px_rgba(212,175,55,0.15)] flex items-center gap-3 z-[200]"
          >
            <span className="material-symbols-outlined text-[20px]">check_circle</span>
            <span className="font-body-md font-medium tracking-wide text-sm">{notification}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<MenuPage />} />
      <Route path="/admin" element={<AdminLogin />} />
      <Route path="/admin/dashboard" element={<AdminDashboard />} />
    </Routes>
  );
}

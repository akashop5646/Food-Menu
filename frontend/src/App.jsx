import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import { API_BASE } from './config';
import { buildPaidReceiptData, generateReceiptHtml } from './utils/receiptHelper';

const formatDateForDisplay = (isoString) => {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
};

function MenuPage() {
  const shouldReduceMotion = useReducedMotion();
  const kineticTransition = shouldReduceMotion
    ? { duration: 0 }
    : { type: 'spring', stiffness: 420, damping: 28, mass: 0.7 };
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

  const cartLookup = useMemo(() => {
    const map = {};
    cart.forEach(item => {
      map[item._id] = item;
    });
    return map;
  }, [cart]);

  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [selectedTable] = useState(tableParam);
  const [selectedLocation] = useState(locationParam);
  const [activeOrder, setActiveOrder] = useState(null);
  const [activeOrders, setActiveOrders] = useState([]);

  // Debounce search input changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    localStorage.setItem('aurum_cart', JSON.stringify(cart));
  }, [cart]);

  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [notification, setNotification] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const selectedCartItem = useMemo(() => {
    return selectedItem ? cartLookup[selectedItem._id] : null;
  }, [selectedItem, cartLookup]);
  const [verificationCode, setVerificationCode] = useState('');
  const [pendingOrderId, setPendingOrderId] = useState('');

  // Category scrolling and fade indicators
  const categoryContainerRef = useRef(null);
  const categoryRefs = useRef({});
  const categoryFadeFrameRef = useRef(null);
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);

  const updateCategoryFades = useCallback(() => {
    const el = categoryContainerRef.current;
    if (el) {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      const nextShowLeftFade = scrollLeft > 5;
      const nextShowRightFade = scrollWidth - scrollLeft - clientWidth > 5;
      setShowLeftFade(current => current === nextShowLeftFade ? current : nextShowLeftFade);
      setShowRightFade(current => current === nextShowRightFade ? current : nextShowRightFade);
    }
  }, []);

  const handleCategoryScroll = useCallback(() => {
    if (categoryFadeFrameRef.current) return;
    categoryFadeFrameRef.current = window.requestAnimationFrame(() => {
      categoryFadeFrameRef.current = null;
      updateCategoryFades();
    });
  }, [updateCategoryFades]);

  useEffect(() => {
    updateCategoryFades();
    window.addEventListener('resize', updateCategoryFades);
    return () => {
      window.removeEventListener('resize', updateCategoryFades);
      if (categoryFadeFrameRef.current) {
        window.cancelAnimationFrame(categoryFadeFrameRef.current);
      }
    };
  }, [categories, updateCategoryFades]);

  useEffect(() => {
    const activeChip = categoryRefs.current[activeCategory];
    if (activeChip) {
      activeChip.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center'
      });
    }
    const timer = setTimeout(updateCategoryFades, 300);
    return () => clearTimeout(timer);
  }, [activeCategory, updateCategoryFades]);

  // Floating Mobile Cart Summary Auto-Collapse
  const [isCartExpanded, setIsCartExpanded] = useState(true);
  const cartTimerRef = useRef(null);
  const previousCartRef = useRef([]);

  useEffect(() => {
    if (cart.length === 0) {
      setIsCartExpanded(true);
      if (cartTimerRef.current) {
        clearTimeout(cartTimerRef.current);
        cartTimerRef.current = null;
      }
      previousCartRef.current = [];
      return;
    }

    const hasCartChanged = () => {
      if (previousCartRef.current.length !== cart.length) return true;
      for (let i = 0; i < cart.length; i++) {
        const prevItem = previousCartRef.current.find(item => item._id === cart[i]._id);
        if (!prevItem || prevItem.quantity !== cart[i].quantity) return true;
      }
      return false;
    };

    if (hasCartChanged()) {
      setIsCartExpanded(true);
      if (cartTimerRef.current) {
        clearTimeout(cartTimerRef.current);
      }
      cartTimerRef.current = setTimeout(() => {
        setIsCartExpanded(false);
      }, 3000);
      previousCartRef.current = cart.map(item => ({ _id: item._id, quantity: item.quantity }));
    }
  }, [cart]);

  useEffect(() => {
    return () => {
      if (cartTimerRef.current) {
        clearTimeout(cartTimerRef.current);
      }
    };
  }, []);

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
  const [isGeneratingReceipt, setIsGeneratingReceipt] = useState(false);
  const [isOrderVerified, setIsOrderVerified] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [customerIp, setCustomerIp] = useState('');
  const [checkoutSessionId, setCheckoutSessionId] = useState('');
  const [activePolicy, setActivePolicy] = useState(null);

  // Legal settings states
  const [legalEffectiveDate, setLegalEffectiveDate] = useState('');
  const [legalGrievanceOfficerName, setLegalGrievanceOfficerName] = useState('');
  const [legalGrievanceOfficerEmail, setLegalGrievanceOfficerEmail] = useState('');
  const [legalDataHostingLocation, setLegalDataHostingLocation] = useState('India');
  const [legalGrievanceResponseDays, setLegalGrievanceResponseDays] = useState('');

  // Convenience Fee states
  const [globalConvenienceFeeEnabled, setGlobalConvenienceFeeEnabled] = useState(false);
  const [globalConvenienceFeeType, setGlobalConvenienceFeeType] = useState('PERCENTAGE');
  const [globalConvenienceFeePercentage, setGlobalConvenienceFeePercentage] = useState(0);
  const [globalConvenienceFeeAmount, setGlobalConvenienceFeeAmount] = useState(0);

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
        const [catsRes, razorpayRes, ipRes, profileRes, feeRes, legalRes] = await Promise.all([
          fetch(API_BASE + '/api/categories'),
          fetch(API_BASE + '/api/settings/razorpay'),
          fetch(API_BASE + '/api/auth/ip').catch(() => null),
          fetch(API_BASE + '/api/settings/restaurant-profile').catch(() => null),
          fetch(API_BASE + '/api/settings/convenience-fee').catch(() => null),
          fetch(API_BASE + '/api/settings/legal').catch(() => null)
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

        if (feeRes && feeRes.ok) {
          const feeData = await feeRes.json();
          setGlobalConvenienceFeeEnabled(!!feeData.enabled);
          setGlobalConvenienceFeeType(feeData.type || 'PERCENTAGE');
          setGlobalConvenienceFeePercentage(Number(feeData.percentage) || 0);
          setGlobalConvenienceFeeAmount(Number(feeData.amount) || 0);
        }

        if (legalRes && legalRes.ok) {
          const legalData = await legalRes.json();
          setLegalEffectiveDate(legalData.effectiveDate || '');
          setLegalGrievanceOfficerName(legalData.grievanceOfficerName || '');
          setLegalGrievanceOfficerEmail(legalData.grievanceOfficerEmail || '');
          setLegalDataHostingLocation(legalData.dataHostingLocation || 'India');
          setLegalGrievanceResponseDays(legalData.grievanceResponseDays || '');
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
    const controller = new AbortController();
    const fetchFirstPage = async () => {
      setMenuLoading(true);
      setOffset(0);
      setHasMore(true);
      try {
        const res = await fetch(`${API_BASE}/api/menu?limit=${PAGE_SIZE}&offset=0&category=${encodeURIComponent(activeCategory)}&search=${encodeURIComponent(searchQuery)}`, {
          signal: controller.signal
        });
        if (!res.ok) throw new Error('Failed to fetch menu');
        const data = await res.json();
        if (active) {
          const itemsList = Array.isArray(data) ? data : [];
          const processedItems = itemsList.map(item => ({
            ...item,
            dietaryTags: getDietaryTags(item)
          }));
          const more = processedItems.length === PAGE_SIZE;
          setMenuItems(processedItems);
          setHasMore(more);

          // If hero item is not set yet, set it from the first category fetch (normally "All")
          if (processedItems.length > 0) {
            const foundHero = processedItems.find(item => item.chefPick) || processedItems[0] || null;
            setHeroItem(currentHero => currentHero || foundHero);
          }

          // Save to cache
          menuCache.current[cacheKey] = {
            items: processedItems,
            hasMore: more,
            offset: 0
          };
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
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
      controller.abort();
    };
  }, [activeCategory, searchQuery]);

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
        const processedNew = data.map(item => ({
          ...item,
          dietaryTags: getDietaryTags(item)
        }));
        const updatedItems = [...menuItems, ...processedNew];
        const more = processedNew.length === PAGE_SIZE;
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

  const calculatedConvenienceFee = useMemo(() => {
    if (!globalConvenienceFeeEnabled) return 0;
    if (globalConvenienceFeeType === 'PERCENTAGE') {
      return Number((cartTotal * globalConvenienceFeePercentage / 100).toFixed(2));
    }
    return globalConvenienceFeeAmount;
  }, [globalConvenienceFeeEnabled, globalConvenienceFeeType, globalConvenienceFeePercentage, globalConvenienceFeeAmount, cartTotal]);

  const ordersList = activeOrders.length > 0 ? activeOrders : (activeOrder ? [activeOrder] : []);
  const sessionTotal = ordersList.reduce((sum, o) => sum + o.total, 0);
  const sessionItemsCount = ordersList.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0);
  const unpaidOrders = ordersList.filter(o => o.paymentStatus !== 'PAID');
  const unpaidTotal = unpaidOrders.reduce((sum, o) => sum + o.total, 0);
  const unpaidTotalPayable = unpaidOrders.reduce((sum, o) => sum + (o.totalPayable ?? o.total), 0);
  const unpaidConvenienceFee = unpaidOrders.reduce((sum, o) => sum + (o.convenienceFee ?? 0), 0);

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
      setPendingOrderId('');
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
          if (data.orderId) {
            setPendingOrderId(data.orderId);
          }
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
            setActiveOrder(prevOrder => {
              if (prevOrder && prevOrder.paymentStatus !== 'PAID' && data.order.paymentStatus === 'PAID') {
                showNotification('Payment successful! Your order is being prepared.');
                setPaidOrderDetails({
                  orderId: data.order._id,
                  subtotal: data.order.total,
                  convenienceFee: data.order.convenienceFee ?? 0,
                  amount: data.order.totalPayable ?? data.order.total
                });
                setIsCheckoutOpen(false);
              }
              return data.order;
            });
            setIsOrderVerified(true);
            setPendingOrderId('');
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
            setPaidOrderDetails({
              orderId: targetOrderId || 'session_order',
              subtotal: activeOrder ? activeOrder.total : cartTotal,
              convenienceFee: activeOrder ? (activeOrder.convenienceFee ?? 0) : calculatedConvenienceFee,
              amount: orderData.amount / 100
            });
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

  const handleDownloadReceipt = () => {
    if (isGeneratingReceipt) return;
    setIsGeneratingReceipt(true);

    try {
      const receiptData = buildPaidReceiptData(ordersList);
      if (!receiptData) {
        showNotification('Unable to generate the receipt. Please try again.');
        setIsGeneratingReceipt(false);
        return;
      }

      const htmlContent = generateReceiptHtml(receiptData, restaurantName);
      if (!htmlContent) {
        showNotification('Unable to generate the receipt. Please try again.');
        setIsGeneratingReceipt(false);
        return;
      }

      const reference = (checkoutSessionId || (ordersList[0] ? String(ordersList[0]._id).substring(Math.max(0, String(ordersList[0]._id).length - 6)) : 'session'))
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
      const dateStr = new Date().toISOString().split('T')[0];
      const filename = `aurum-table-receipt-${reference}-${dateStr}.html`;

      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();

      // Clean up
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to generate receipt:', err.message);
      showNotification('Unable to generate the receipt. Please try again.');
    } finally {
      setIsGeneratingReceipt(false);
    }
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
              initial={shouldReduceMotion ? false : { scale: 0.7, y: -2, opacity: 0 }}
              animate={shouldReduceMotion ? { scale: 1, y: 0, opacity: 1 } : { scale: [1.28, 0.94, 1], y: [-2, 1, 0], opacity: 1 }}
              transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.34, times: [0, 0.65, 1], ease: 'easeOut' }}
              className="absolute -top-0.5 -right-0.5 bg-red-600 text-white text-[10px] rounded-full h-5 w-5 flex items-center justify-center font-bold shadow-md font-sans"
            >
              {cartCount}
            </motion.span>
          )}
        </button>
      </header>

      {/* Main Content Area */}
      <main className="pt-16 pb-36 md:pb-0 w-full">

        {/* Hero Section */}
        {heroItem ? (
          <section className="relative overflow-hidden border-b border-outline-variant/15 bg-[radial-gradient(circle_at_82%_18%,rgba(196,154,48,0.16),transparent_29%),linear-gradient(135deg,rgba(255,255,255,0.65),rgba(247,243,232,0.6))] py-10 md:py-14 dark:bg-[radial-gradient(circle_at_82%_18%,rgba(196,154,48,0.14),transparent_25%),linear-gradient(135deg,rgba(32,29,23,0.96),rgba(25,23,19,0.95))]">
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent pointer-events-none" />

            <div className="max-w-[1200px] mx-auto px-margin-mobile md:px-margin-desktop relative z-10">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12 items-center">
                {/* Text Info */}
                <motion.div
                  initial={shouldReduceMotion ? false : { opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.45, ease: "easeOut" }}
                  className="md:col-span-6 flex flex-col items-start text-left order-2 md:order-1"
                >
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold font-label-caps uppercase tracking-widest bg-surface-container-lowest/80 border border-primary/25 text-primary rounded-full mb-3 shadow-sm">
                    <span className="material-symbols-outlined text-[12px] font-bold">award_star</span>
                    Signature Tasting
                  </span>
                  <h1 className="font-display-lg text-4xl md:text-5xl lg:text-[3.5rem] text-primary mb-3 leading-[1.04] font-semibold text-balance">
                    {heroItem.name}
                  </h1>
                  <p className="font-body-lg text-[15px] md:text-body-lg text-on-surface-variant/85 max-w-lg mb-6 leading-relaxed">
                    {heroItem.description && heroItem.description.toLowerCase() !== heroItem.name.toLowerCase()
                      ? heroItem.description
                      : "Indulge in our masterfully crafted signature dish, prepared with premium local ingredients, authentic spices, and absolute culinary devotion."
                    }
                  </p>
                  <div className="flex items-center gap-5 sm:gap-6 flex-wrap">
                    <div className="flex flex-col border-l-2 border-primary/50 pl-3">
                      <span className="text-[10px] font-label-caps text-on-surface-variant/50 uppercase tracking-widest">Price</span>
                      <span className="font-price-display text-3xl text-on-surface font-bold">₹{heroItem.price}</span>
                    </div>
                    <motion.button
                      onClick={() => handleOrderNow(heroItem)}
                      whileTap={shouldReduceMotion ? undefined : { scale: 0.96 }}
                      transition={kineticTransition}
                      className="bg-gold-metallic text-on-primary-fixed font-label-caps text-[12px] min-h-[48px] px-6 py-3 rounded-xl uppercase tracking-widest gold-glow transition-transform duration-200 hover:scale-[1.02] active:scale-[0.98] motion-reduce:transition-none font-bold flex items-center gap-2 focus-ring-gold focus:outline-none"
                    >
                      Order Now <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                    </motion.button>
                  </div>
                </motion.div>

                {/* Image Container */}
                <motion.div
                  initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.98, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: shouldReduceMotion ? 0 : 0.08, ease: "easeOut" }}
                  className="md:col-span-6 flex justify-center md:justify-end order-1 md:order-2 w-full"
                >
                  <div className="relative group w-full max-w-[420px] aspect-[4/3]">
                    <div className="absolute -inset-2 rounded-[2rem] border border-primary/15 pointer-events-none" />
                    <div className="w-full h-full rounded-[1.6rem] overflow-hidden border border-primary/25 shadow-xl bg-surface-container-high relative">
                      {heroItem.image ? (
                        <img
                          src={heroItem.image}
                          alt={heroItem.name}
                          fetchPriority="high"
                          decoding="async"
                          className="w-full h-full object-cover md:group-hover:scale-[1.03] transition-transform duration-500 motion-reduce:transition-none"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-surface-container">
                          <span className="material-symbols-outlined text-8xl opacity-10 text-primary">restaurant</span>
                        </div>
                      )}

                      <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent pointer-events-none" />
                    </div>

                    {/* Floating Badge */}
                    <div className="absolute -bottom-3 right-3 bg-surface-container-lowest border border-primary/30 text-primary px-3.5 py-2 text-[10px] font-label-caps uppercase tracking-widest rounded-xl flex items-center gap-1 shadow-lg">
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
        <section className="sticky top-16 z-40 border-b border-outline-variant/25 bg-background/95 backdrop-blur-md py-3 w-full">
          <div className="max-w-[1200px] mx-auto px-margin-mobile md:px-margin-desktop flex flex-col gap-3 w-full">
            <div className="flex gap-3 items-center justify-between w-full">
              <div className="relative flex-1 max-w-xl">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">search</span>
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search menu..."
                  className="w-full min-h-[44px] bg-surface-container-low border border-outline-variant/60 text-on-surface pl-10 pr-4 py-2 rounded-xl focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors font-body-md text-body-md placeholder-on-surface-variant/50"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setIsFilterOpen(true)}
                  className="min-h-[44px] bg-surface-container-low border border-outline-variant/50 text-on-surface-variant px-3.5 py-2 rounded-xl hover:text-primary hover:border-primary/50 transition-colors flex items-center gap-1 font-label-caps text-label-caps uppercase focus-ring-gold focus:outline-none"
                >
                  <span className="material-symbols-outlined text-[16px]">tune</span> <span className="hidden sm:inline">Filter</span>
                </button>
              </div>
            </div>

            {/* Horizontally Scrollable Categories Bar Wrapper */}
            <div className="relative w-full overflow-hidden">
              {/* Left Scroll Indicator Fade */}
              {showLeftFade && (
                <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-background to-transparent pointer-events-none z-10" />
              )}

              {/* Categories scroll container */}
              <div
                ref={categoryContainerRef}
                onScroll={handleCategoryScroll}
                className="overflow-x-auto hide-scrollbar flex gap-2 w-full py-1.5 scroll-smooth"
              >
                {categories.map(cat => {
                  const isActive = activeCategory === cat;
                  return (
                    <button
                      key={cat}
                      ref={el => { categoryRefs.current[cat] = el; }}
                      onClick={() => setActiveCategory(cat)}
                      className={`relative min-h-[36px] px-4 md:px-5 py-2 text-[10px] md:text-[11px] font-label-caps uppercase tracking-widest transition-colors duration-200 whitespace-nowrap rounded-full font-semibold border focus-ring-gold focus:outline-none ${isActive
                        ? 'text-on-primary-fixed border-transparent'
                        : 'text-on-surface-variant/85 hover:text-primary bg-surface-container-low border-outline-variant/20'
                        }`}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="active-menu-category"
                          transition={kineticTransition}
                          className="absolute inset-0 rounded-full bg-gold-metallic shadow-sm"
                        />
                      )}
                      <span className="relative z-10">{cat}</span>
                    </button>
                  );
                })}
              </div>

              {/* Right Scroll Indicator Fade */}
              {showRightFade && (
                <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none z-10" />
              )}
            </div>
            <p className="text-[10px] font-label-caps uppercase tracking-[0.14em] text-on-surface-variant/70">
              {searchQuery
                ? `Results for “${searchQuery}”`
                : activeCategory === 'All'
                  ? 'Explore today’s menu'
                  : `${activeCategory} selection`}
            </p>
          </div>
        </section>

        {/* Menu Grid */}
        <div className="max-w-[1200px] mx-auto w-full">
          <AnimatePresence mode="wait">
            <motion.section
              key={activeCategory}
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
              initial={shouldReduceMotion ? false : 'hidden'}
              animate={shouldReduceMotion ? false : 'show'}
              exit="exit"
              className="p-margin-mobile md:p-margin-desktop grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-gutter mt-5 md:mt-7"
            >
              {menuLoading ? (
                Array.from({ length: 8 }).map((_, index) => (
                  <div key={index} className="bg-surface-container-low border border-outline-variant/20 rounded-2xl p-3 flex flex-col gap-3 animate-pulse">
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
                  const cartItem = cartLookup[item._id];
                  return (
                    <motion.article
                      variants={{
                        hidden: { opacity: 0, y: 15 },
                        show: {
                          opacity: 1,
                          y: 0,
                          transition: {
                            type: "tween",
                            ease: "easeOut",
                            duration: 0.25
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
                      className="bg-surface-container-lowest border border-outline-variant/25 rounded-2xl overflow-hidden group hover:border-primary/45 hover:-translate-y-0.5 premium-card-shadow focus-ring-gold focus:outline-none flex flex-col cursor-pointer transition-[transform,border-color,box-shadow] duration-200 motion-reduce:transition-none"
                    >
                      <div className="relative overflow-hidden aspect-[4/3] w-full border-b border-primary/10 bg-surface-container-high">
                        {item.image ? (
                          <img
                            src={item.image}
                            alt={item.name}
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-cover md:group-hover:scale-[1.03] transition-transform duration-500 motion-reduce:transition-none"
                          />
                        ) : (
                          <div className="w-full h-full bg-surface-variant flex items-center justify-center">
                            <span className="material-symbols-outlined text-4xl opacity-20">restaurant</span>
                          </div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/25 to-transparent pointer-events-none" />

                        {/* Dietary Tags Overlay */}
                        <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5 pointer-events-none">
                          {(item.dietaryTags || getDietaryTags(item) || []).map(tag => (
                            <div
                              key={tag.type}
                              className={`flex items-center gap-1.5 px-2 py-0.5 text-[9px] font-semibold font-label-caps uppercase tracking-wider rounded-md border bg-surface-container-lowest/90 shadow-sm ${tag.color}`}
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
                          <div className="absolute z-20 bg-surface-container-lowest/95 border border-primary/30 text-primary px-3 py-1 text-[10px] font-label-caps uppercase tracking-widest rounded-full flex items-center gap-1 top-3 right-3 shadow-md">
                            <span className="material-symbols-outlined text-[13px] font-bold">star</span> Chef's Pick
                          </div>
                        )}
                      </div>

                      <div className="flex-1 flex flex-col justify-between p-3.5 md:p-4">
                        <div>
                          <h3 className="font-headline-sm text-[16px] md:text-headline-sm text-primary group-hover:text-primary-fixed transition-colors line-clamp-1 mb-1 font-semibold">{item.name}</h3>
                          <p className="font-body-md text-[12px] md:text-body-md text-on-surface-variant/75 line-clamp-2 mb-3 md:mb-4 leading-relaxed">
                            {item.description}
                          </p>
                        </div>

                        <div className="flex justify-between items-center mt-auto pt-2 border-t border-outline-variant/10">
                          <span className="font-price-display text-[16px] md:text-price-display text-on-surface font-semibold">₹{item.price}</span>
                          <div onClick={(e) => e.stopPropagation()}>
                            {cartItem ? (
                              <div className="flex items-center gap-0.5 sm:gap-1 bg-surface-container-high border border-outline-variant/30 rounded-full p-0.5 shadow-sm shrink-0">
                                <button
                                  onClick={() => updateQuantity(item._id, -1)}
                                  aria-label={`Decrease quantity of ${item.name}`}
                                  className="text-on-surface-variant hover:text-primary w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-full hover:bg-surface-container-highest transition-colors focus-ring-gold focus:outline-none shrink-0"
                                >
                                  <span className="material-symbols-outlined text-[14px] sm:text-[16px] md:text-[18px]">remove</span>
                                </button>
                                <motion.span
                                  key={cartItem.quantity}
                                  initial={shouldReduceMotion ? false : { scale: 0.82, y: 3 }}
                                  animate={{ scale: 1, y: 0 }}
                                  transition={kineticTransition}
                                  className="font-body-md text-on-surface w-5 sm:w-6 text-center text-[11px] sm:text-[12px] md:text-[13px] font-bold shrink-0"
                                >
                                  {cartItem.quantity}
                                </motion.span>
                                <button
                                  onClick={() => updateQuantity(item._id, 1)}
                                  aria-label={`Increase quantity of ${item.name}`}
                                  className="text-on-surface-variant hover:text-primary w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-full hover:bg-surface-container-highest transition-colors focus-ring-gold focus:outline-none shrink-0"
                                >
                                  <span className="material-symbols-outlined text-[14px] sm:text-[16px] md:text-[18px]">add</span>
                                </button>
                              </div>
                            ) : (
                              <motion.button
                                onClick={() => addToCart(item)}
                                aria-label={`Add ${item.name} to cart`}
                                whileTap={shouldReduceMotion ? undefined : { scale: 0.93 }}
                                transition={kineticTransition}
                                className="bg-primary text-on-primary hover:bg-primary-fixed-dim border border-primary font-label-caps text-[9px] md:text-[10px] px-4 min-h-[44px] min-w-[72px] flex items-center justify-center gap-1 rounded-full uppercase tracking-wider transition-transform duration-200 hover:scale-[1.03] active:scale-[0.97] motion-reduce:transition-none shadow-sm font-bold focus-ring-gold focus:outline-none"
                              >
                                <span className="material-symbols-outlined text-[12px] md:text-[14px]">add</span> Add
                              </motion.button>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.article>
                  );
                })
              ) : (
                <div className="col-span-full py-16 text-center text-on-surface-variant bg-surface-container-low rounded-2xl border border-outline-variant/20">
                  <span className="material-symbols-outlined text-5xl opacity-40 mb-3 block">search_off</span>
                  <p className="font-body-lg text-body-lg mb-4">No dishes found matching your selection.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput('');
                      setActiveCategory('All');
                    }}
                    className="text-primary text-[11px] font-label-caps uppercase tracking-widest hover:underline focus-ring-gold focus:outline-none rounded px-2 py-1"
                  >
                    Clear search and filters
                  </button>
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

      <AnimatePresence>
        {cartCount > 0 && !isCartOpen && !isCheckoutOpen && !paidOrderDetails && !selectedItem && !isFilterOpen && (
          <motion.div
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            onClick={() => setIsCartOpen(true)}
            className={`md:hidden fixed bottom-24 left-4 right-4 z-40 bg-gold-metallic text-on-primary-fixed rounded-2xl shadow-xl flex justify-between items-center gold-glow cursor-pointer transition-all duration-300 ${isCartExpanded ? 'px-5 py-4' : 'px-4 py-2.5'
              }`}
          >
            {isCartExpanded ? (
              <>
                <motion.div layout className="flex flex-col text-left">
                  <span className="text-[11px] font-label-caps uppercase tracking-wider opacity-90">{cartCount} {cartCount === 1 ? 'item' : 'items'}</span>
                  <span className="font-price-display font-bold text-base mt-0.5">₹{cartTotal.toFixed(2)}</span>
                </motion.div>
                <motion.button
                  layout
                  className="flex items-center gap-1.5 font-label-caps text-xs uppercase tracking-widest font-bold bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl border border-white/20 transition-all pointer-events-none"
                >
                  View Cart <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </motion.button>
              </>
            ) : (
              <>
                <motion.div layout className="flex items-center gap-2 text-left font-sans text-xs font-semibold">
                  <span className="text-sm">🛍</span>
                  <span>{cartCount} {cartCount === 1 ? 'item' : 'items'}</span>
                  <span className="opacity-60">•</span>
                  <span className="font-price-display font-bold">₹{cartTotal.toFixed(0)}</span>
                </motion.div>
                <motion.div
                  layout
                  className="flex items-center gap-1 font-label-caps text-[11px] uppercase tracking-wider font-bold opacity-90"
                >
                  View <span className="material-symbols-outlined text-xs">arrow_forward</span>
                </motion.div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* BottomNavBar (Mobile Only) */}
      <nav className="md:hidden bg-surface-container-lowest/95 backdrop-blur-lg border-t border-outline-variant/10 shadow-lg fixed bottom-0 w-full z-50 rounded-t-xl flex justify-around items-center h-20 px-4 pb-safe">
        <button
          onClick={() => isCartOpen && toggleCart()}
          className={`flex flex-col items-center justify-center transition-all duration-300 ${!isCartOpen
            ? 'bg-secondary-container/30 text-primary rounded-xl px-3 py-1 translate-y-[-2px]'
            : 'text-on-surface-variant hover:text-primary-fixed-dim px-3 py-1'
            }`}
        >
          <span className="material-symbols-outlined">restaurant_menu</span>
          <span className="font-label-caps text-label-caps mt-1">Menu</span>
        </button>
        <button
          onClick={toggleCart}
          className={`flex flex-col items-center justify-center transition-all duration-300 ${isCartOpen
            ? 'bg-secondary-container/30 text-primary rounded-xl px-3 py-1 translate-y-[-2px]'
            : 'text-on-surface-variant hover:text-primary-fixed-dim px-3 py-1'
            }`}
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
                  Your culinary journey awaits.<br />Select dishes to begin.
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

            <div className="flex-1 p-6 md:p-8 flex flex-col items-stretch text-center overflow-y-auto">
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
                    ₹{(activeOrder
                      ? ordersList.reduce((sum, o) => sum + (o.totalPayable ?? o.total), 0)
                      : (cartTotal + calculatedConvenienceFee)
                    ).toFixed(2)}
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
                  <p className="font-body-md text-body-md text-on-surface-variant mb-6">Show this code to your waiter to confirm your order. This code expires in 10 minutes.</p>

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
                  <div className="w-full bg-surface-container-high border border-outline-variant/20 rounded-lg p-4 mb-4 text-left shrink-0">
                    <h4 className="font-body-md text-on-surface font-medium mb-1">Code includes</h4>
                    <p className="font-body-md text-body-md text-on-surface-variant/70">Table number, selected items, quantity, item prices, and total.</p>
                  </div>

                  {pendingOrderId && (
                    <div className="w-full bg-surface-container-high border border-outline-variant/20 rounded-lg p-4 mb-4 text-left shrink-0">
                      <h4 className="font-body-md text-on-surface font-medium mb-1">Pending Order ID</h4>
                      <p className="font-mono text-base text-primary font-bold tracking-wide">
                        #{pendingOrderId.toString().substring(18)}
                      </p>
                    </div>
                  )}

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
                <div className="w-full flex flex-col gap-3 text-left mt-2 mb-6 shrink-0">
                  <h3 className="font-label-caps text-[11px] text-primary border-b border-outline-variant/15 pb-2 uppercase tracking-widest font-bold flex justify-between items-center shrink-0">
                    <span>Order History ({ordersList.length})</span>
                    <span className="font-mono text-on-surface-variant text-[11px] lowercase tracking-normal">
                      Total: ₹{ordersList.reduce((sum, o) => sum + (o.totalPayable ?? o.total), 0).toFixed(2)}
                    </span>
                  </h3>

                  <div className="space-y-3 w-full">
                    {ordersList.map((order, idx) => (
                      <div key={order._id || idx} className="bg-surface-container-high border border-outline-variant/15 rounded-xl p-3.5 flex flex-col gap-2 shadow-sm">
                        {/* Header */}
                        <div className="flex justify-between items-center text-xs font-semibold border-b border-outline-variant/10 pb-1.5 font-sans">
                          <span className="text-primary font-mono text-[13px] font-bold">Order #{order._id.toString().substring(18)}</span>
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
                        <div className="flex justify-between items-start text-[11px] font-medium border-t border-outline-variant/10 pt-1.5 mt-1 font-sans">
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
                          <div className="text-right flex flex-col items-end">
                            <span className="text-primary font-bold font-price-display text-xs">
                              ₹{(order.totalPayable ?? order.total).toFixed(2)}
                            </span>
                            {Number(order.convenienceFee) > 0 && (
                              <span className="text-[9px] text-on-surface-variant/70 font-normal mt-0.5">
                                (includes ₹{order.convenienceFee} fee)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="w-full space-y-4 shrink-0">
                {(!activeOrder || unpaidTotal > 0) ? (
                  <>
                    {/* Bill Details Breakdown */}
                    <div className="bg-surface-container-high/60 border border-outline-variant/20 rounded-xl p-4 text-xs text-on-surface-variant text-left space-y-2">
                      <strong className="text-on-surface font-semibold block mb-2 border-b border-outline-variant/10 pb-1.5 font-sans uppercase tracking-widest text-[10px]">
                        Bill Details
                      </strong>
                      <div className="flex justify-between">
                        <span>Food Subtotal</span>
                        <span className="font-mono">₹{(unpaidTotal > 0 ? unpaidTotal : cartTotal).toFixed(2)}</span>
                      </div>
                      {(unpaidTotal > 0 ? unpaidConvenienceFee > 0 : calculatedConvenienceFee > 0) && (
                        <div className="flex justify-between">
                          <span>
                            Convenience Fee
                            {unpaidTotal > 0 ? (
                              activeOrder?.convenienceFeePercentage !== undefined && activeOrder.convenienceFeePercentage !== null && ` (${activeOrder.convenienceFeePercentage}%)`
                            ) : (
                              globalConvenienceFeeEnabled && globalConvenienceFeeType === 'PERCENTAGE' && ` (${globalConvenienceFeePercentage}%)`
                            )}
                          </span>
                          <span className="font-mono">
                            ₹{(unpaidTotal > 0 ? unpaidConvenienceFee : calculatedConvenienceFee).toFixed(2)}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between font-semibold text-on-surface border-t border-outline-variant/10 pt-2 text-sm">
                        <span>Total Payable</span>
                        <span className="font-mono text-primary">
                          ₹{(unpaidTotal > 0 ? unpaidTotalPayable : (cartTotal + calculatedConvenienceFee)).toFixed(2)}
                        </span>
                      </div>
                    </div>

                    {/* Seller & Fulfillment Disclosure */}
                    <div className="bg-surface-container-high/60 border border-outline-variant/20 rounded-xl p-3 text-[11px] text-on-surface-variant/90 leading-relaxed text-left">
                      <strong className="text-on-surface font-semibold block mb-1">Seller & Fulfillment</strong>
                      <p>
                        <span className="font-semibold text-on-surface">{restaurantName}</span> prepares and fulfills this order. <span className="font-semibold text-on-surface">{restaurantName}</span> provides the digital ordering technology and facilitates online payment processing. Payments are securely processed through Razorpay.
                      </p>
                    </div>

                    <button
                      onClick={handlePayNow}
                      className={`w-full py-3 rounded font-label-caps text-label-caps uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all ${(isOrderVerified || unpaidTotal > 0)
                        ? 'bg-gold-metallic text-on-primary-fixed gold-glow'
                        : 'bg-surface-container-high border border-outline-variant/30 text-on-surface-variant/40 cursor-not-allowed'
                        }`}
                    >
                      <span className="material-symbols-outlined">credit_card</span> Pay Now (₹{(unpaidTotal > 0 ? unpaidTotalPayable : (cartTotal + calculatedConvenienceFee)).toFixed(2)})
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
                  <div className="flex flex-col gap-3 w-full">
                    <button
                      type="button"
                      onClick={handleDownloadReceipt}
                      disabled={isGeneratingReceipt}
                      aria-label="Download paid order receipt"
                      className="w-full bg-gold-metallic text-on-primary-fixed h-12 py-0 rounded font-label-caps text-label-caps uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50"
                    >
                      {isGeneratingReceipt ? (
                        <>
                          <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                          Downloading...
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-[18px]">download</span>
                          Download Receipt
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setIsCheckoutOpen(false)}
                      className="w-full bg-primary text-on-primary h-12 py-0 rounded font-label-caps text-label-caps uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all"
                    >
                      Close Receipt
                    </button>
                  </div>
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
                      className={`px-5 py-2 rounded font-label-caps text-[11px] uppercase tracking-widest transition-all ${activeCategory === cat
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
                  className="absolute top-4 right-4 bg-black/50 hover:bg-black/80 text-white w-11 h-11 flex items-center justify-center rounded-full backdrop-blur-md transition-colors focus-ring-gold focus:outline-none shadow-md z-30"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>

              <div className="p-6 md:p-8 overflow-y-auto max-h-[40vh] md:max-h-[50vh] hide-scrollbar">
                <div className="flex justify-between items-start mb-4 gap-4">
                  <h2 className="font-headline-md text-primary text-2xl md:text-3xl">{selectedItem.name}</h2>
                  <span className="font-price-display text-on-surface text-xl md:text-2xl shrink-0">₹{selectedItem.price}</span>
                </div>

                <div className="flex flex-wrap gap-2 mb-6">
                  {(selectedItem.categories || (selectedItem.category ? [selectedItem.category] : [])).map(cat => (
                    <span key={cat} className="border border-outline-variant/30 bg-surface-container-high text-on-surface-variant px-3 py-1 rounded-full text-[11px] font-label-caps uppercase tracking-wider font-semibold">{cat}</span>
                  ))}
                  {selectedItem.chefPick && (
                    <span className="bg-primary/20 text-primary border border-primary/30 px-3 py-1 rounded-full text-[11px] font-label-caps uppercase tracking-wider font-semibold flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px] font-bold">star</span> Chef's Pick
                    </span>
                  )}
                  {getDietaryTags(selectedItem).map(tag => (
                    <span
                      key={tag.type}
                      className={`px-3 py-1 rounded-full text-[11px] font-label-caps uppercase tracking-wider font-semibold flex items-center gap-1.5 border backdrop-blur-md shadow-sm ${tag.color}`}
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

              <div className="p-6 border-t border-outline-variant/10 bg-surface-container-lowest shrink-0">
                {selectedCartItem ? (
                  <div className="flex gap-4 items-center justify-between w-full">
                    {/* Quantity Selector */}
                    <div className="flex items-center gap-3 bg-surface-container-high border border-outline-variant/30 rounded-xl p-0.5 shadow-sm shrink-0">
                      <button
                        onClick={() => updateQuantity(selectedItem._id, -1)}
                        aria-label={`Decrease quantity of ${selectedItem.name}`}
                        className="text-on-surface-variant hover:text-primary w-11 h-11 flex items-center justify-center rounded-full hover:bg-surface-container-highest transition-colors focus-ring-gold focus:outline-none"
                      >
                        <span className="material-symbols-outlined text-[20px]">remove</span>
                      </button>
                      <span className="font-body-md text-on-surface w-6 text-center text-[15px] font-bold">
                        {selectedCartItem.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(selectedItem._id, 1)}
                        aria-label={`Increase quantity of ${selectedItem.name}`}
                        className="text-on-surface-variant hover:text-primary w-11 h-11 flex items-center justify-center rounded-full hover:bg-surface-container-highest transition-colors focus-ring-gold focus:outline-none"
                      >
                        <span className="material-symbols-outlined text-[20px]">add</span>
                      </button>
                    </div>

                    {/* View Cart Button */}
                    <button
                      onClick={() => {
                        setIsCartOpen(true);
                        setSelectedItem(null);
                      }}
                      className="flex-1 bg-gold-metallic text-on-primary-fixed font-label-caps text-[14px] min-h-[44px] py-3 rounded-xl uppercase tracking-widest gold-glow font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-[18px]">shopping_bag</span> View Cart
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => addToCart(selectedItem)}
                    className="w-full bg-gold-metallic text-on-primary-fixed font-label-caps text-[14px] min-h-[44px] py-3 rounded-xl uppercase tracking-widest gold-glow font-bold transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[18px]">add_shopping_cart</span> Add to Cart
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>


      {/* Footer */}
      <footer className="mt-8 md:mt-10 border-t border-outline-variant/15 py-6 md:py-7 bg-surface-container-lowest/80 backdrop-blur-md">
        <div className="max-w-[1200px] mx-auto px-margin-mobile md:px-margin-desktop flex flex-col md:flex-row justify-between items-center gap-4 md:gap-8">
          <div className="text-center md:text-left flex flex-col items-center md:items-start">
            <div className="font-display-lg text-[17px] text-primary font-semibold mb-1.5">{restaurantName}</div>
            <p className="text-body-sm text-on-surface-variant/70 max-w-xs leading-relaxed text-[12px] md:text-body-sm mb-2.5">
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
          <div className="flex flex-wrap justify-center gap-x-5 gap-y-2.5 font-label-caps text-[10px] md:text-[11px] uppercase tracking-widest">
            <button onClick={() => setActivePolicy('restaurant-info')} className="text-on-surface-variant hover:text-primary transition-colors focus-ring-gold rounded px-1.5 py-0.5">About Restaurant</button>
            <button onClick={() => setActivePolicy('privacy')} className="text-on-surface-variant hover:text-primary transition-colors focus-ring-gold rounded px-1.5 py-0.5">Privacy Policy</button>
            <button onClick={() => setActivePolicy('terms')} className="text-on-surface-variant hover:text-primary transition-colors focus-ring-gold rounded px-1.5 py-0.5">Terms & Conditions</button>
            <button onClick={() => setActivePolicy('refund')} className="text-on-surface-variant hover:text-primary transition-colors focus-ring-gold rounded px-1.5 py-0.5">Cancellation & Refund</button>
            <button onClick={() => setActivePolicy('contact')} className="text-on-surface-variant hover:text-primary transition-colors focus-ring-gold rounded px-1.5 py-0.5">Contact Us</button>
          </div>
        </div>
        <div className="max-w-[1200px] mx-auto px-margin-mobile md:px-margin-desktop text-center mt-5 pt-3 border-t border-outline-variant/10 text-[10px] text-on-surface-variant/40">
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
                    {legalEffectiveDate && <p><strong>Effective Date:</strong> {formatDateForDisplay(legalEffectiveDate)}</p>}
                    <p>Welcome to {restaurantName || 'the restaurant'}. This Privacy Policy explains how information is collected, used, stored, and protected when you access our digital menu, place a restaurant order, use a table QR code, generate a checkout code, make an online payment, or otherwise interact with our ordering services.</p>
                    <p>By using this service, you acknowledge the practices described in this Privacy Policy. If you do not agree with this policy, please discontinue use of the service.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">1. Information We Collect</h3>
                    <p>Depending on how you use the service, we may collect the following categories of information:</p>
                    <h4 className="font-semibold text-[14px] mt-2">Order and Restaurant-Service Information</h4>
                    <p>We may process:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Selected food and beverage items</li>
                      <li>Item quantities</li>
                      <li>Order amounts</li>
                      <li>Special instructions or customer notes</li>
                      <li>Assigned table information</li>
                      <li>Restaurant location or dining-area information</li>
                      <li>Order status and preparation status</li>
                      <li>Order timestamps</li>
                      <li>Payment and transaction status</li>
                      <li>Receipt and order-reference information</li>
                    </ul>
                    <p className="mt-2">This information is used to prepare, manage, fulfill, verify, and maintain restaurant orders.</p>

                    <h4 className="font-semibold text-[14px] mt-2">Information You Provide</h4>
                    <p>If you voluntarily provide contact or identifying information during an order, payment, support request, or other interaction, we may process information such as:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Name</li>
                      <li>Email address</li>
                      <li>Phone number</li>
                      <li>Billing or contact information</li>
                      <li>Information included in support requests</li>
                    </ul>
                    <p className="mt-2">The information collected may vary depending on the restaurant's configuration and the services you choose to use.</p>

                    <h4 className="font-semibold text-[14px] mt-2">Device, Browser, and Technical Information</h4>
                    <p>To operate, secure, and improve the service, we may process limited technical information, including:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Internet Protocol (IP) address</li>
                      <li>Browser and device information</li>
                      <li>Device or browser identifier</li>
                      <li>Operating-system information</li>
                      <li>Session information</li>
                      <li>Request timestamps</li>
                      <li>Security and diagnostic information</li>
                    </ul>
                    <p className="mt-2">A randomly generated browser identifier may be stored locally on your device to support session continuity, order verification, fraud prevention, and service security.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">2. Browser Storage and Similar Technologies</h3>
                    <p>The service may use browser-based storage technologies, including local storage, to maintain necessary preferences and functionality.</p>
                    <p>Browser storage may be used for purposes such as:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Remembering light or dark theme preferences</li>
                      <li>Preserving cart contents during a browsing session</li>
                      <li>Maintaining a browser or device identifier</li>
                      <li>Supporting ordering and checkout continuity</li>
                    </ul>
                    <p className="mt-2">These technologies are used to provide application functionality and improve reliability. Clearing your browser data may remove saved preferences, cart information, or locally stored identifiers.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">3. Temporary Checkout Codes</h3>
                    <p>When an order is submitted through the manual verification flow, the service may generate a temporary four-digit checkout code.</p>
                    <p>Checkout codes:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Are used to allow authorized restaurant staff to retrieve and verify the pending order</li>
                      <li>Expire approximately 10 minutes after generation</li>
                      <li>Are intended for one-time use</li>
                      <li>Become invalid after successful verification</li>
                      <li>Are automatically removed after expiry through database-cleanup mechanisms</li>
                    </ul>
                    <p className="mt-2">Expired, previously used, or invalid checkout codes cannot be used to retrieve an order.</p>
                    <p>The temporary code record may contain the pending order information required to complete the verification process. Order records created after successful confirmation may be retained separately for restaurant operations, accounting, payment reconciliation, customer support, security, and legal obligations.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">4. Payment Information</h3>
                    <p>Online payments are processed through Razorpay. Payment information entered into Razorpay’s payment interface is processed according to Razorpay’s applicable terms and privacy practices.</p>
                    <p>The application does not directly collect or store complete card numbers, card CVV values, UPI PINs, net-banking passwords, or similar sensitive payment credentials entered through Razorpay’s payment interface.</p>
                    <p>Payment providers may process information such as:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Payment amount</li>
                      <li>Transaction identifier</li>
                      <li>Payment method</li>
                      <li>Payment status</li>
                      <li>Billing or contact information supplied during payment</li>
                      <li>Information required for fraud prevention, payment processing, refunds, and regulatory compliance</li>
                    </ul>
                    <p className="mt-2">The application may retain non-sensitive payment references, transaction status, payment identifiers, order-payment associations, receipt information, refund information, and settlement records where required for restaurant operations, accounting, dispute handling, reconciliation, security, and legal compliance.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">5. How We Use Information</h3>
                    <p>Information may be used to:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Display the restaurant menu</li>
                      <li>Maintain cart and ordering functionality</li>
                      <li>Create, verify, process, and fulfill orders</li>
                      <li>Associate orders with the correct table or restaurant location</li>
                      <li>Send orders to authorized restaurant staff and kitchen systems</li>
                      <li>Display preparation and order status</li>
                      <li>Process and reconcile online payments</li>
                      <li>Generate payment receipts</li>
                      <li>Handle cancellations, refunds, disputes, and customer-support requests</li>
                      <li>Maintain operational, accounting, security, and audit records</li>
                      <li>Detect and prevent misuse, fraud, unauthorized access, and security incidents</li>
                      <li>Diagnose errors and improve service reliability</li>
                      <li>Comply with applicable legal, tax, accounting, and regulatory obligations</li>
                    </ul>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">6. How Information Is Shared</h3>
                    <p>Information is shared only where reasonably necessary to operate the ordering service, fulfill orders, process payments, provide support, or comply with applicable law.</p>
                    <p>Information may be shared with:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li><strong>Restaurant Personnel:</strong> Order information may be made available to authorized restaurant personnel, including administrators, service staff, cashiers, kitchen staff, and other employees who require access to prepare, verify, fulfill, manage, or support orders.</li>
                      <li><strong>Payment Service Providers:</strong> Payment and transaction information may be processed by Razorpay and relevant banking, payment, settlement, or financial-service providers.</li>
                      <li><strong>Infrastructure and Technology Providers:</strong> Information may be processed through service providers used for application hosting, database storage, cloud services, media storage, authentication, monitoring, and technical operations. These providers process information only as required to provide their respective services and are subject to their own terms and privacy practices.</li>
                      <li><strong>Legal and Security Requirements:</strong> Information may be disclosed when reasonably necessary to comply with applicable laws or legal obligations; respond to valid requests from courts, regulators, law-enforcement agencies, or public authorities; investigate fraud, security incidents, abuse, or unlawful activity; or protect the rights, safety, security, and property of customers, restaurant personnel, the restaurant, or others.</li>
                    </ul>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">7. Data Retention</h3>
                    <p>Information is retained only for as long as reasonably necessary for the purposes described in this policy, including restaurant operations, order fulfillment, payment reconciliation, accounting, tax requirements, dispute resolution, fraud prevention, security, audit obligations, and legal compliance.</p>
                    <p>Temporary checkout-code records expire after approximately 10 minutes and are automatically removed after expiry. Successfully verified checkout-code records are consumed and removed as part of the verification process.</p>
                    <p>Confirmed orders, transaction references, receipts, payment records, employee activity records, audit information, and other operational records may be retained for longer periods where reasonably required for business or legal purposes.</p>

                    {legalDataHostingLocation && (
                      <>
                        <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">7.5. Data Hosting and Storage Location</h3>
                        <p>Our database and application servers are hosted and maintained in the following location(s): <strong>{legalDataHostingLocation}</strong>.</p>
                      </>
                    )}

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">8. Data Security</h3>
                    <p>Reasonable administrative, organizational, and technical safeguards are used to protect information against unauthorized access, loss, misuse, alteration, or disclosure.</p>
                    <p>These safeguards may include:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Authentication and authorization controls</li>
                      <li>Restricted administrative access</li>
                      <li>Secure payment-provider integration</li>
                      <li>Expiring and one-time checkout codes</li>
                      <li>Server-side validation</li>
                      <li>Security logging and audit records</li>
                      <li>Database and infrastructure security controls</li>
                    </ul>
                    <p className="mt-2">However, no internet transmission, electronic storage system, or security measure can be guaranteed to be completely secure.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">9. Your Privacy Rights</h3>
                    <p>Subject to applicable law, you may request:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Access to personal information associated with you</li>
                      <li>Correction of inaccurate information</li>
                      <li>Deletion of eligible personal information</li>
                      <li>Information about how your personal data is processed</li>
                      <li>Withdrawal of consent where processing is based on consent</li>
                      <li>Review of a privacy-related concern or complaint</li>
                    </ul>
                    <p className="mt-2">Some information may need to be retained where required for payment reconciliation, accounting, tax, fraud prevention, dispute resolution, security, audit, or legal obligations.</p>
                    <p>To submit a request, contact the restaurant using the information provided below.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">10. Children's Privacy</h3>
                    <p>The service is intended for restaurant customers and is not designed to knowingly collect personal information directly from children without appropriate authorization.</p>
                    <p>If you believe that information relating to a child has been collected improperly, contact the restaurant so the matter can be reviewed.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">11. Third-Party Services</h3>
                    <p>The service may rely on third-party providers for payment processing, hosting, database infrastructure, media storage, authentication, and other technical functions. Those providers may process information under their own privacy policies and terms. This Privacy Policy does not control the independent privacy practices of third-party providers.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">12. Changes to This Privacy Policy</h3>
                    <p>This Privacy Policy may be updated periodically to reflect changes in application functionality, restaurant operations, service providers, legal requirements, or data-processing practices.</p>
                    <p>Material changes will be reflected by updating the effective date displayed in this policy.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">13. Contact Us</h3>
                    <p>For privacy questions, requests, or concerns, contact:</p>
                    <ul className="list-none space-y-1">
                      <li><strong>Business/Restaurant Name:</strong> {restaurantName || 'Please contact the restaurant.'}</li>
                      <li><strong>Email:</strong> {restaurantEmail ? <a href={`mailto:${restaurantEmail}`} className="text-primary hover:underline">{restaurantEmail}</a> : 'Please contact the restaurant.'}</li>
                      <li><strong>Phone:</strong> {restaurantPhone ? <a href={`tel:${restaurantPhone}`} className="text-primary hover:underline">{restaurantPhone}</a> : 'Please contact the restaurant.'}</li>
                      <li><strong>Physical Address:</strong> {restaurantAddress || 'Please contact the restaurant.'}</li>
                    </ul>

                    {legalGrievanceOfficerName && (
                      <div className="mt-4 pt-4 border-t border-outline-variant/10">
                        <h4 className="font-semibold text-[14px] text-on-surface">Grievance Officer:</h4>
                        <ul className="list-none space-y-1 mt-1">
                          <li><strong>Name:</strong> {legalGrievanceOfficerName}</li>
                          {legalGrievanceOfficerEmail && (
                            <li><strong>Email:</strong> <a href={`mailto:${legalGrievanceOfficerEmail}`} className="text-primary hover:underline">{legalGrievanceOfficerEmail}</a></li>
                          )}
                          {legalGrievanceResponseDays && (
                            <li><strong>Response Commitment:</strong> {legalGrievanceResponseDays} days</li>
                          )}
                        </ul>
                      </div>
                    )}
                  </>
                )}
                {activePolicy === 'terms' && (
                  <>
                    {legalEffectiveDate && <p><strong>Effective Date:</strong> {formatDateForDisplay(legalEffectiveDate)}</p>}
                    <p>Welcome to {restaurantName || 'the restaurant'}. These Terms & Conditions govern your access to and use of the restaurant's digital menu, table-ordering features, checkout-code system, online-payment functionality, and related ordering services.</p>
                    <p>By accessing the service, scanning a table QR code, submitting an order, generating a checkout code, or making a payment, you agree to these Terms & Conditions.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">1. Restaurant Ordering Service</h3>
                    <p>The service allows customers to perform functions that may include:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Viewing restaurant menu items</li>
                      <li>Reviewing item descriptions and displayed prices</li>
                      <li>Adding or removing items from a cart</li>
                      <li>Associating an order with a table or restaurant location</li>
                      <li>Submitting an order for staff verification</li>
                      <li>Generating a temporary checkout code</li>
                      <li>Making an online payment where available</li>
                      <li>Receiving or downloading a payment receipt</li>
                      <li>Viewing relevant order information</li>
                    </ul>
                    <p className="mt-2">Available features may vary according to restaurant configuration.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">2. Customer Responsibilities</h3>
                    <p>When using the service, you agree to:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Use the QR code associated with the correct restaurant, table, or location</li>
                      <li>Review selected items, quantities, prices, fees, and order information before submission</li>
                      <li>Provide accurate information when information is requested</li>
                      <li>Inform restaurant staff promptly if the displayed table or location is incorrect</li>
                      <li>Keep temporary checkout codes private except when presenting them to authorized restaurant personnel</li>
                      <li>Avoid submitting fraudulent, unauthorized, abusive, or intentionally misleading orders</li>
                      <li>Avoid attempting to disrupt, reverse engineer, bypass, overload, or gain unauthorized access to the service</li>
                      <li>Avoid interfering with payment, authentication, checkout-code, administrative, or restaurant systems</li>
                    </ul>
                    <p className="mt-2">You are responsible for reviewing your order before confirmation or payment.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">3. Menu Information, Availability, and Pricing</h3>
                    <p>Menu items, descriptions, images, prices, taxes, fees, availability, dietary indicators, and other information are maintained by the restaurant.</p>
                    <p>The restaurant may:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Change menu items or prices</li>
                      <li>Mark products as unavailable</li>
                      <li>Correct display, pricing, or description errors</li>
                      <li>Refuse or cancel an order that cannot be fulfilled</li>
                      <li>Substitute an item only with customer approval where appropriate</li>
                    </ul>
                    <p className="mt-2">Displayed food images may be illustrative. Actual appearance, presentation, ingredients, portion size, or packaging may vary.</p>
                    <p>Prices are displayed in Indian Rupees unless otherwise stated.</p>
                    <p>Applicable taxes, convenience fees, service charges, or other permitted charges should be displayed before final payment or confirmation where applicable.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">4. Allergies and Dietary Information</h3>
                    <p>Menu descriptions, dietary indicators, ingredient information, and category labels are provided for general guidance.</p>
                    <p>Customers with allergies, intolerances, dietary restrictions, or other food-related concerns should speak directly with restaurant staff before ordering.</p>
                    <p>The presence of a vegetarian, vegan, gluten-free, spicy, or similar label does not guarantee the absence of allergens or cross-contact unless explicitly confirmed by the restaurant.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">5. Order Submission and Acceptance</h3>
                    <p>Submitting an order, generating a checkout code, or initiating payment does not necessarily guarantee acceptance or fulfillment.</p>
                    <p>An order may be subject to:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Successful staff verification</li>
                      <li>Menu-item availability</li>
                      <li>Restaurant operating capacity</li>
                      <li>Correct table and location information</li>
                      <li>Successful payment authorization where applicable</li>
                      <li>Restaurant confirmation</li>
                    </ul>
                    <p className="mt-2">The restaurant may reject, modify with customer approval, or cancel an order where reasonably necessary due to item unavailability, incorrect information, technical issues, suspected misuse, payment issues, operational limitations, or other legitimate reasons.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">6. Temporary Checkout Codes</h3>
                    <p>Manual-verification orders may use a temporary four-digit checkout code.</p>
                    <p>Checkout codes:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Expire approximately 10 minutes after generation</li>
                      <li>Are intended for one-time verification</li>
                      <li>Become invalid after successful use</li>
                      <li>May be rejected if expired, previously used, incorrect, or unavailable</li>
                    </ul>
                    <p className="mt-2">Customers should present the checkout code only to authorized restaurant personnel.</p>
                    <p>If a code expires before verification, the customer may need to return to the ordering flow and generate a new code.</p>
                    <p>A generated checkout code does not by itself guarantee order acceptance or preparation.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">7. Online Payments</h3>
                    <p>Online payments are processed through Razorpay. Payment information entered into Razorpay’s payment interface is processed according to Razorpay’s applicable terms and privacy practices.</p>
                    <p>By choosing online payment, you also agree to the applicable payment provider's terms and policies.</p>
                    <p>Payment may be considered successful only after confirmation is received from the payment provider and verified by the application.</p>
                    <p>The restaurant and service may retain non-sensitive transaction references, payment status, receipt information, and order-payment associations for reconciliation, support, refunds, accounting, fraud prevention, and legal compliance.</p>
                    <p>The application does not directly collect or store complete card numbers, card CVV values, UPI PINs, net-banking passwords, or similar sensitive payment credentials entered through Razorpay’s payment interface.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">8. Payment Failures and Duplicate Charges</h3>
                    <p>If payment is interrupted, delayed, unsuccessful, or displayed inconsistently:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Do not repeatedly submit payment without checking the transaction status</li>
                      <li>Contact restaurant staff if the order or payment status is unclear</li>
                      <li>Retain any available payment reference or receipt</li>
                      <li>Allow the payment provider or bank reasonable time to reconcile pending transactions</li>
                    </ul>
                    <p className="mt-2">Duplicate deductions, failed-payment reversals, and payment-provider processing issues may be subject to the timelines and procedures of the relevant bank or payment provider.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">9. Order Preparation and Fulfillment</h3>
                    <p>Preparation estimates are informational and may vary due to:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Order volume</li>
                      <li>Item complexity</li>
                      <li>Ingredient availability</li>
                      <li>Kitchen capacity</li>
                      <li>Operational delays</li>
                      <li>Technical interruptions</li>
                    </ul>
                    <p className="mt-2">The restaurant is responsible for preparing and serving accepted orders.</p>
                    <p>Customers should promptly notify restaurant staff regarding missing items, incorrect items, quality concerns, or other fulfillment issues.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">10. Receipts</h3>
                    <p>Where available, customers may view, print, or download an electronic receipt.</p>
                    <p>Customers are responsible for verifying the information displayed on the receipt and informing restaurant staff promptly if a correction is required.</p>
                    <p>Temporary inability to generate, download, or print a receipt does not invalidate an otherwise successfully verified payment or completed order.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">11. Prohibited Use</h3>
                    <p>You must not:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Submit fraudulent or intentionally false orders</li>
                      <li>Attempt unauthorized access to customer, employee, administrative, payment, or restaurant systems</li>
                      <li>Attempt to reuse, guess, automate, intercept, or misuse checkout codes</li>
                      <li>Manipulate prices, quantities, payment requests, table identifiers, location identifiers, or order data</li>
                      <li>Interfere with service availability or security</li>
                      <li>Introduce malicious software or automated abuse</li>
                      <li>Use the service in violation of applicable law</li>
                    </ul>
                    <p className="mt-2">Access may be restricted where misuse, fraud, security threats, or unlawful activity is reasonably suspected.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">12. Service Availability</h3>
                    <p>The service may occasionally be unavailable or experience delays due to:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Maintenance</li>
                      <li>Internet or network failures</li>
                      <li>Hosting or infrastructure issues</li>
                      <li>Payment-provider interruptions</li>
                      <li>Database or third-party-service interruptions</li>
                      <li>Security incidents</li>
                      <li>Events outside reasonable control</li>
                    </ul>
                    <p className="mt-2">Continuous, uninterrupted, or error-free availability is not guaranteed.</p>
                    <p>Restaurant staff may use alternative ordering or payment procedures when the digital service is unavailable.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">13. Limitation of Liability</h3>
                    <p>To the maximum extent permitted by applicable law, neither the restaurant nor its technology providers will be liable for indirect, incidental, special, or consequential losses arising solely from temporary service unavailability, third-party payment interruptions, unauthorized misuse, or circumstances outside reasonable control.</p>
                    <p>Nothing in these Terms excludes or limits rights or remedies that cannot legally be excluded under applicable consumer-protection law.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">14. Privacy</h3>
                    <p>Use of personal, order, device, technical, and payment-related information is governed by the Privacy Policy available through the application.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">15. Changes to These Terms</h3>
                    <p>These Terms may be updated to reflect changes in restaurant operations, application functionality, payment providers, legal requirements, or available services.</p>
                    <p>The effective date should be updated when material changes are made.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">16. Governing Law and Dispute Resolution</h3>
                    <p>These Terms are governed by the applicable laws of India.</p>
                    <p>Any dispute should first be raised directly with the restaurant using the contact information below. If it cannot be resolved informally, applicable jurisdiction and consumer-protection laws will govern the available remedies.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">17. Contact Information</h3>
                    <p>For questions regarding orders, payments, these Terms, or the service, contact:</p>
                    <ul className="list-none space-y-1">
                      <li><strong>Business/Restaurant Name:</strong> {restaurantName || 'Please contact the restaurant.'}</li>
                      <li><strong>Email:</strong> {restaurantEmail ? <a href={`mailto:${restaurantEmail}`} className="text-primary hover:underline">{restaurantEmail}</a> : 'Please contact the restaurant.'}</li>
                      <li><strong>Phone:</strong> {restaurantPhone ? <a href={`tel:${restaurantPhone}`} className="text-primary hover:underline">{restaurantPhone}</a> : 'Please contact the restaurant.'}</li>
                      <li><strong>Physical Address:</strong> {restaurantAddress || 'Please contact the restaurant.'}</li>
                    </ul>

                    {legalGrievanceOfficerName && (
                      <div className="mt-4 pt-4 border-t border-outline-variant/10">
                        <h4 className="font-semibold text-[14px] text-on-surface">Grievance Officer:</h4>
                        <ul className="list-none space-y-1 mt-1">
                          <li><strong>Name:</strong> {legalGrievanceOfficerName}</li>
                          {legalGrievanceOfficerEmail && (
                            <li><strong>Email:</strong> <a href={`mailto:${legalGrievanceOfficerEmail}`} className="text-primary hover:underline">{legalGrievanceOfficerEmail}</a></li>
                          )}
                          {legalGrievanceResponseDays && (
                            <li><strong>Response Commitment:</strong> {legalGrievanceResponseDays} days</li>
                          )}
                        </ul>
                      </div>
                    )}
                  </>
                )}
                {activePolicy === 'refund' && (
                  <>
                    {legalEffectiveDate && <p><strong>Effective Date:</strong> {formatDateForDisplay(legalEffectiveDate)}</p>}
                    <p>This Cancellation & Refund Policy explains how cancellation requests, payment failures, duplicate charges, refunds, and restaurant-order concerns are handled by {restaurantName || 'the restaurant'}.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">1. Order Cancellation Requests</h3>
                    <p>Customers should review all items, quantities, table information, location information, prices, taxes, and applicable fees before submitting or paying for an order.</p>
                    <p>If you need to cancel or change an order, contact restaurant staff immediately.</p>
                    <p>Cancellation requests may be accepted when:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>The order has not yet been accepted or verified</li>
                      <li>Food preparation has not started</li>
                      <li>Ingredients have not been committed specifically to the order</li>
                      <li>The restaurant determines that cancellation remains operationally possible</li>
                    </ul>
                    <p className="mt-2">A cancellation request is not guaranteed merely because it was submitted.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">2. Orders Already in Preparation</h3>
                    <p>Once preparation has begun, an order may no longer be eligible for cancellation or a full refund because ingredients, staff time, and kitchen resources may already have been committed.</p>
                    <p>The restaurant may review exceptional circumstances individually.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">3. Restaurant-Initiated Cancellation</h3>
                    <p>The restaurant may cancel all or part of an order because of:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Item unavailability</li>
                      <li>Pricing or menu errors</li>
                      <li>Kitchen or operational limitations</li>
                      <li>Incorrect table or location information</li>
                      <li>Technical problems</li>
                      <li>Payment-verification issues</li>
                      <li>Suspected fraud or misuse</li>
                      <li>Other circumstances preventing fulfillment</li>
                    </ul>
                    <p className="mt-2">If payment was successfully collected for an item or order that the restaurant cannot fulfill, the restaurant will review the transaction and initiate an appropriate full or partial refund where applicable.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">4. Failed, Pending, or Interrupted Payments</h3>
                    <p>A payment attempt may appear pending or unsuccessful because of network interruption, bank processing, payment-provider delay, application interruption, or other technical conditions.</p>
                    <p>If money was debited but payment was not confirmed:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Do not immediately repeat the payment without checking its status</li>
                      <li>Keep the payment reference, bank message, or transaction information</li>
                      <li>Inform restaurant staff</li>
                      <li>Allow the bank and payment provider reasonable time to reconcile the transaction</li>
                    </ul>
                    <p className="mt-2">Some unsuccessful payment deductions may be reversed automatically by the bank or payment provider without requiring a manual restaurant refund.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">5. Duplicate Payments</h3>
                    <p>If you believe you were charged more than once for the same order:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Contact the restaurant promptly</li>
                      <li>Provide the relevant payment references</li>
                      <li>Provide the approximate payment time and amount</li>
                      <li>Provide the associated order or receipt information where available</li>
                    </ul>
                    <p className="mt-2">The restaurant will review its order and payment records. A verified duplicate successful payment will be handled through the applicable payment provider and refund process.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">6. Missing, Incorrect, or Unavailable Items</h3>
                    <p>Notify restaurant staff as soon as possible if:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>An item is missing</li>
                      <li>An incorrect item was served</li>
                      <li>An accepted item becomes unavailable</li>
                      <li>The order differs materially from the confirmed order</li>
                    </ul>
                    <p className="mt-2">Depending on the circumstances, the restaurant may provide:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>The correct item</li>
                      <li>A replacement</li>
                      <li>An agreed alternative</li>
                      <li>A partial refund</li>
                      <li>A full refund for the affected item</li>
                    </ul>
                    <p className="mt-2">The appropriate resolution will depend on the order status and the circumstances.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">7. Food Quality and Customer Concerns</h3>
                    <p>Food-quality, preparation, or service concerns should be reported to restaurant staff as soon as reasonably possible, preferably while the customer is still at the restaurant.</p>
                    <p>The restaurant may inspect the issue and determine an appropriate resolution according to the circumstances and applicable consumer law.</p>
                    <p>Refund eligibility is not automatic solely because of a subjective preference regarding taste, spice level, portion expectation, or presentation where the item was prepared substantially as described.</p>
                    <p>This does not limit rights available under applicable consumer-protection law.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">8. Refund Method</h3>
                    <p>Approved online-payment refunds will generally be returned to the original payment method through Razorpay or the applicable payment provider.</p>
                    <p>Cash refunds, credits, replacements, or other resolutions may be handled according to the original payment method, restaurant policy, and applicable law.</p>
                    <p>Customers may be asked to provide an order reference, receipt, payment reference, transaction amount, or other information required to locate and verify the transaction.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">9. Partial Refunds</h3>
                    <p>A partial refund may be issued where only part of an order is affected.</p>
                    <p>Examples may include:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>One unavailable item in a larger order</li>
                      <li>One missing or incorrect item</li>
                      <li>A verified pricing adjustment</li>
                      <li>An approved partial cancellation</li>
                    </ul>
                    <p className="mt-2">Any applicable refund amount will be based on the affected item or approved adjustment.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">10. Refund Processing Time</h3>
                    <p>After a refund is approved and initiated, it may take approximately 5–10 business days to appear, depending on Razorpay, the customer’s bank, card network, UPI provider, or other financial institution. Actual processing time may vary.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">11. Non-Refundable Situations</h3>
                    <p>Subject to applicable consumer law, a refund may be declined when:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>The order was prepared and fulfilled correctly</li>
                      <li>The cancellation request was made after preparation had substantially begun</li>
                      <li>Incorrect table, location, item, or quantity information was submitted by the customer and the order was prepared accordingly</li>
                      <li>The concern is based only on a change of mind after preparation</li>
                      <li>There is insufficient information to identify or verify the transaction</li>
                      <li>Fraudulent, abusive, or misleading activity is reasonably suspected</li>
                    </ul>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">12. Contact for Cancellation or Refund Support</h3>
                    <p>For cancellation, payment, or refund assistance, contact:</p>
                    <ul className="list-none space-y-1">
                      <li><strong>Business/Restaurant Name:</strong> {restaurantName || 'Please contact the restaurant.'}</li>
                      <li><strong>Email:</strong> {restaurantEmail ? <a href={`mailto:${restaurantEmail}`} className="text-primary hover:underline">{restaurantEmail}</a> : 'Please contact the restaurant.'}</li>
                      <li><strong>Phone:</strong> {restaurantPhone ? <a href={`tel:${restaurantPhone}`} className="text-primary hover:underline">{restaurantPhone}</a> : 'Please contact the restaurant.'}</li>
                      <li><strong>Physical Address:</strong> {restaurantAddress || 'Please contact the restaurant.'}</li>
                    </ul>

                    {legalGrievanceOfficerName && (
                      <div className="mt-4 pt-4 border-t border-outline-variant/10">
                        <h4 className="font-semibold text-[14px] text-on-surface">Grievance Officer:</h4>
                        <ul className="list-none space-y-1 mt-1">
                          <li><strong>Name:</strong> {legalGrievanceOfficerName}</li>
                          {legalGrievanceOfficerEmail && (
                            <li><strong>Email:</strong> <a href={`mailto:${legalGrievanceOfficerEmail}`} className="text-primary hover:underline">{legalGrievanceOfficerEmail}</a></li>
                          )}
                        </ul>
                      </div>
                    )}
                  </>
                )}
                {activePolicy === 'contact' && (
                  <>
                    <p>We would love to hear from you! For reservations, support, feedback, or business inquiries, please reach out to us using the exact details below.</p>

                    <h3 className="font-title-sm text-primary font-semibold text-[16px] mt-4">📍 General Inquiries & Customer Support</h3>
                    <ul className="list-none space-y-2">
                      <li><strong>Registered Business/Legal Name:</strong> {restaurantName || 'Please contact the restaurant.'}</li>
                      <li><strong>Support Email:</strong> {restaurantEmail ? <a href={`mailto:${restaurantEmail}`} className="text-primary hover:underline">{restaurantEmail}</a> : 'Please contact the restaurant.'}</li>
                      <li><strong>Customer Support Phone:</strong> {restaurantPhone ? <a href={`tel:${restaurantPhone}`} className="text-primary hover:underline">{restaurantPhone}</a> : 'Please contact the restaurant.'}</li>
                      <li>
                        <strong>Physical Address:</strong> {restaurantAddress || 'Please contact the restaurant.'}
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
                      Official trade, licensing, and compliance information for {restaurantName || 'the restaurant'}.
                    </p>

                    <div className="bg-surface-container-high/40 border border-outline-variant/10 rounded-2xl p-5 flex flex-col gap-4 text-sm">
                      <div className="flex justify-between items-start pb-3 border-b border-outline-variant/10">
                        <span className="text-on-surface-variant font-medium">Restaurant Name</span>
                        <span className="text-on-surface font-semibold text-right max-w-xs">{restaurantName || 'Please contact the restaurant.'}</span>
                      </div>
                      <div className="flex justify-between items-start pb-3 border-b border-outline-variant/10">
                        <span className="text-on-surface-variant font-medium">Address</span>
                        <div className="flex flex-col items-end gap-1 max-w-xs">
                          <span className="text-on-surface font-semibold text-right whitespace-pre-line">{restaurantAddress || 'Please contact the restaurant.'}</span>
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
                        <span className="text-on-surface font-semibold text-right">
                          {restaurantPhone ? <a href={`tel:${restaurantPhone}`} className="text-primary hover:underline">{restaurantPhone}</a> : 'Please contact the restaurant.'}
                        </span>
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
                  <span className="text-on-surface-variant">Food Subtotal</span>
                  <span className="font-mono text-on-surface">₹{(paidOrderDetails.subtotal ?? 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-on-surface-variant">Convenience Fee</span>
                  <span className="font-mono text-on-surface">₹{(paidOrderDetails.convenienceFee ?? 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-xs pt-2 border-t border-outline-variant/10">
                  <span className="text-on-surface-variant font-semibold">Amount Paid</span>
                  <span className="font-price-display text-primary font-bold text-base">₹{paidOrderDetails.amount.toFixed(2)}</span>
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
                Back to menu
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

import React, { useState, useMemo, useEffect } from 'react';
import { Routes, Route, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import QRCode from 'qrcode';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';

function MenuPage() {
  const [searchParams] = useSearchParams();
  const tableParam = searchParams.get('table') || 'Walk-in';
  const locationParam = searchParams.get('location') || '';

  const [menuItems, setMenuItems] = useState([]);
  const [categories, setCategories] = useState(['All']);
  const [menuLoading, setMenuLoading] = useState(true);
  const [cart, setCart] = useState([]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTable] = useState(tableParam);
  const [selectedLocation] = useState(locationParam);
  
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [notification, setNotification] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [qrCode, setQrCode] = useState('');

  // Google Pay / UPI configuration and states
  const [gpayId, setGpayId] = useState('');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentQrCode, setPaymentQrCode] = useState('');
  const [isOrderVerified, setIsOrderVerified] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [customerIp, setCustomerIp] = useState('');

  // Fetch menu items and categories from API
  useEffect(() => {
    // Generate/get deviceId
    let id = localStorage.getItem('aurum_device_id');
    if (!id) {
      id = 'dev_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('aurum_device_id', id);
    }
    setDeviceId(id);

    const fetchMenu = async () => {
      try {
        const [itemsRes, catsRes, gpayRes, ipRes] = await Promise.all([
          fetch('/api/menu'),
          fetch('/api/categories'),
          fetch('/api/settings/gpay'),
          fetch('/api/auth/ip').catch(() => null)
        ]);
        const items = await itemsRes.json();
        const cats = await catsRes.json();
        let gpayData = { gpayId: '' };
        try {
          gpayData = await gpayRes.json();
        } catch (e) {
          console.error(e);
        }
        setMenuItems(Array.isArray(items) ? items : []);
        setCategories(['All', ...(Array.isArray(cats) ? cats.map(c => c.name) : [])]);
        setGpayId(gpayData.gpayId || '');

        if (ipRes && ipRes.ok) {
          const ipData = await ipRes.json();
          setCustomerIp(ipData.ip || '');
        }
      } catch (err) {
        console.error('Failed to fetch initial page data:', err);
      } finally {
        setMenuLoading(false);
      }
    };
    fetchMenu();
  }, []);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const heroItem = useMemo(() => {
    return menuItems.find(item => item.chefPick) || menuItems[0] || null;
  }, [menuItems]);

  const filteredItems = useMemo(() => {
    return menuItems.filter(item => {
      const itemCats = item.categories || (item.category ? [item.category] : []);
      const matchesCategory = activeCategory === 'All' || itemCats.includes(activeCategory);
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           item.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, searchQuery, menuItems]);

  const showNotification = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(''), 3000);
  };

  const addToCart = (dish) => {
    setCart(prev => {
      const existing = prev.find(i => i._id === dish._id);
      if (existing) {
        return prev.map(i => i._id === dish._id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { ...dish, quantity: 1 }];
    });
    showNotification(`${dish.name} added to cart`);
  };

  const updateQuantity = (id, change) => {
    setCart(prev => prev.map(item => {
      if (item._id === id) {
        return { ...item, quantity: Math.max(0, item.quantity + change) };
      }
      return item;
    }).filter(item => item.quantity > 0));
  };

  const handleOrderNow = (dish) => {
    addToCart(dish);
    setIsCartOpen(true);
  };

  const toggleCart = () => {
    if (isCheckoutOpen) setIsCheckoutOpen(false);
    setIsCartOpen(!isCartOpen);
  };

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
    };
  }, [cart, cartCount, cartTotal, selectedTable, selectedLocation, deviceId, customerIp]);

  useEffect(() => {
    if (!isCheckoutOpen || !orderPayload) {
      setQrCode('');
      return;
    }
    QRCode.toDataURL(JSON.stringify(orderPayload), {
      margin: 1,
      width: 280,
      color: { dark: '#10110e', light: '#f7f1e8' },
    }).then(setQrCode);
  }, [isCheckoutOpen, orderPayload]);

  const upiUrl = useMemo(() => {
    if (!gpayId || !cartTotal) return '';
    // Format items as a compact summary: e.g. "2x Golden Risotto, 1x Lobster Tail"
    const itemsSummary = cart.map(item => `${item.quantity}x ${item.name}`).join(', ');
    const prefix = `T${selectedTable} Order: `;
    const maxNoteLength = 80; // Standard UPI note limit
    let note = prefix + itemsSummary;
    if (note.length > maxNoteLength) {
      note = note.substring(0, maxNoteLength - 3) + '...';
    }
    return `upi://pay?pa=${gpayId}&pn=${encodeURIComponent("Aurum Table")}&am=${cartTotal.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
  }, [gpayId, cartTotal, selectedTable, cart]);

  useEffect(() => {
    if (!isCheckoutOpen || !upiUrl) {
      setPaymentQrCode('');
      return;
    }
    QRCode.toDataURL(upiUrl, {
      margin: 1,
      width: 280,
      color: { dark: '#10110e', light: '#f7f1e8' },
    }).then(setPaymentQrCode);
  }, [isCheckoutOpen, upiUrl]);

  // Poll backend to check if the waiter has scanned/confirmed this table's order
  useEffect(() => {
    if (!isCheckoutOpen || !selectedTable || !deviceId) {
      setIsOrderVerified(false);
      return;
    }

    const checkVerification = async () => {
      try {
        const res = await fetch(`/api/orders/active?table=${encodeURIComponent(selectedTable)}&deviceId=${encodeURIComponent(deviceId)}`);
        if (res.ok) {
          const data = await res.json();
          setIsOrderVerified(!!data.verified);
        }
      } catch (err) {
        console.error('Error checking verification status:', err);
      }
    };

    // Check once immediately
    checkVerification();

    // Poll every 2500ms
    const interval = setInterval(checkVerification, 2500);

    return () => clearInterval(interval);
  }, [isCheckoutOpen, selectedTable, deviceId]);

  const handlePayNow = () => {
    if (!isOrderVerified) {
      showNotification('Awaiting waiter verification. Please let staff scan your QR code first.');
      return;
    }

    if (!gpayId) {
      showNotification('Online payments are currently disabled. Please choose Pay Later.');
      return;
    }

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
      window.location.href = upiUrl;
      setTimeout(() => {
        setIsCheckoutOpen(false);
        setCart([]);
        showNotification('Initiating payment... Thank you for your order!');
      }, 1000);
    } else {
      setShowPaymentModal(true);
    }
  };

  const handlePayLater = () => {
    setIsCheckoutOpen(false);
    setCart([]);
    showNotification('Thank you! Your order has been placed. You can pay later at the counter.');
  };

  return (
    <div className="bg-background text-on-surface pb-32 min-h-screen">
      {/* TopAppBar */}
      <header className="bg-surface/90 backdrop-blur-md fixed top-0 w-full z-50 border-b border-outline-variant/20 flex justify-between items-center px-margin-mobile h-16 md:hidden">
        <div className="w-8"></div>
        <div className="font-display-lg-mobile text-display-lg-mobile text-primary tracking-tighter text-center">Aurum Table</div>
        <button className="text-primary hover:text-primary transition-colors hover:scale-95 duration-200 relative w-8 flex justify-end" onClick={toggleCart}>
          <span className="material-symbols-outlined">shopping_bag</span>
          {cartCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-error text-on-error-container text-[10px] rounded-full h-4 w-4 flex items-center justify-center font-bold">
              {cartCount}
            </span>
          )}
        </button>
      </header>

      {/* Main Content Area */}
      <main className="pt-16 md:pt-0 w-full">
        
        {/* Hero Section */}
        {menuLoading ? (
          <section className="h-[530px] md:h-[618px] flex items-center justify-center">
            <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
          </section>
        ) : heroItem ? (
          <section className="relative h-[530px] md:h-[618px] flex flex-col justify-end bg-surface-container overflow-hidden">
            {heroItem.image && (
              <div 
                className="absolute inset-0 bg-center bg-cover bg-no-repeat opacity-40 mix-blend-luminosity" 
                style={{ backgroundImage: `url('${heroItem.image}')` }}
              />
            )}
            <div className="max-w-[1200px] mx-auto w-full p-margin-mobile md:p-margin-desktop relative z-10">
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="w-full md:w-2/3"
              >
              <span className="font-label-caps text-label-caps text-primary tracking-widest uppercase mb-4 block">Signature Tasting</span>
              <h1 className="font-display-lg-mobile text-display-lg-mobile md:font-display-lg md:text-display-lg text-primary mb-2 leading-tight">{heroItem.name}</h1>
              <p className="font-body-lg text-body-lg text-on-surface-variant max-w-lg mb-6 line-clamp-3">
                {heroItem.description}
              </p>
              <div className="flex items-center gap-4">
                <span className="font-price-display text-price-display text-primary-fixed-dim">₹{heroItem.price}</span>
                <button 
                  onClick={() => handleOrderNow(heroItem)}
                  className="bg-gold-metallic text-on-primary font-label-caps text-label-caps px-6 py-3 rounded uppercase tracking-wider gold-glow transition-all"
                >
                  Order Now
                </button>
              </div>
            </motion.div>
            </div>
          </section>
        ) : (
          <section className="h-[530px] md:h-[618px] flex items-center justify-center bg-surface-container text-on-surface-variant">
            <div className="text-center">
              <span className="material-symbols-outlined text-6xl mb-4 opacity-50">restaurant_menu</span>
              <h2 className="font-headline-md text-headline-md">Menu Coming Soon</h2>
            </div>
          </section>
        )}

        {/* Sticky Search & Filters */}
        <section className="sticky top-[64px] md:top-0 z-40 bg-background/95 backdrop-blur-xl border-b border-outline-variant/30 py-4 w-full">
          <div className="max-w-[1200px] mx-auto px-margin-mobile md:px-margin-desktop flex gap-4 items-center justify-between w-full">
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
        </section>

        {/* Menu Grid */}
        <div className="max-w-[1200px] mx-auto w-full">
          <motion.section layout className="p-margin-mobile md:p-margin-desktop grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-gutter mt-8">
            <AnimatePresence mode="popLayout">
            {filteredItems.map((item, i) => (
              <motion.article 
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                key={item._id} 
                onClick={() => setSelectedItem(item)}
                className="bg-surface-container border border-primary/20 rounded-lg overflow-hidden group hover:border-primary/50 transition-colors flex flex-col cursor-pointer"
              >
                <div className="relative overflow-hidden aspect-[4/3] w-full border-b border-primary/10">
                  {item.image ? (
                    <img 
                      src={item.image} 
                      alt={item.name} 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" 
                    />
                  ) : (
                    <div className="w-full h-full bg-surface-variant flex items-center justify-center">
                      <span className="material-symbols-outlined text-4xl opacity-20">restaurant</span>
                    </div>
                  )}
                  {/* Subtle gradient overlay on hover for a premium feel */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
                  
                  {item.chefPick && (
                    <div className="absolute z-20 bg-surface-container/80 backdrop-blur-md border border-primary/30 text-primary px-3 py-1.5 text-[10px] font-label-caps uppercase tracking-widest rounded-full flex items-center gap-1 top-3 right-3 shadow-[0_4px_12px_rgba(0,0,0,0.5)]">
                      <span className="material-symbols-outlined text-[14px] font-bold">star</span> Chef's Pick
                    </div>
                  )}
                </div>
                
                <div className="flex-1 flex flex-col justify-between p-3 md:p-5">
                  <div>
                    <div className="flex flex-col md:flex-row justify-between items-start mb-1 md:mb-2 gap-1">
                      <h3 className="font-headline-sm text-[16px] md:text-headline-sm text-primary group-hover:text-primary-fixed transition-colors line-clamp-1">{item.name}</h3>
                      <span className="font-price-display text-[14px] md:text-price-display text-on-surface">₹{item.price}</span>
                    </div>
                    <p className="font-body-md text-[12px] md:text-body-md text-on-surface-variant/70 line-clamp-2">
                      {item.description}
                    </p>
                  </div>
                </div>
              </motion.article>
            ))}
          </AnimatePresence>
        </motion.section>
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
              <span className="absolute -top-1 -right-2 bg-error text-on-error-container text-[10px] rounded-full h-4 w-4 flex items-center justify-center font-bold">
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
            className="fixed inset-y-0 right-0 w-full md:w-96 bg-surface-container border-l border-primary/20 shadow-2xl z-[70] flex flex-col"
          >
            <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-lowest">
              <h2 className="font-headline-sm text-headline-sm text-primary">Your Table</h2>
              <button onClick={toggleCart} className="text-on-surface-variant hover:text-primary transition-colors">
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
                        <button onClick={() => updateQuantity(item._id, -1)} className="text-on-surface-variant hover:text-primary">
                          <span className="material-symbols-outlined text-[18px]">remove</span>
                        </button>
                        <span className="font-body-md text-on-surface w-4 text-center">{item.quantity}</span>
                        <button onClick={() => updateQuantity(item._id, 1)} className="text-on-surface-variant hover:text-primary">
                          <span className="material-symbols-outlined text-[18px]">add</span>
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>

            <div className="p-6 border-t border-outline-variant/20 bg-surface-container-lowest">
              <div className="flex justify-between items-center mb-4">
                <span className="font-body-lg text-body-lg text-on-surface">Subtotal</span>
                <span className="font-price-display text-price-display text-primary">₹{cartTotal.toFixed(2)}</span>
              </div>
              <button 
                onClick={() => setIsCheckoutOpen(true)}
                disabled={cart.length === 0}
                className="w-full bg-gold-metallic text-on-primary font-label-caps text-label-caps py-4 rounded uppercase tracking-wider gold-glow transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Proceed to Checkout <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Checkout Drawer (Overlays Cart) */}
      <AnimatePresence>
        {isCheckoutOpen && isCartOpen && (
          <motion.div 
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 right-0 w-full md:w-96 bg-surface-container border-l border-primary/20 shadow-2xl z-[80] flex flex-col"
          >
            <div className="p-6 border-b border-outline-variant/20 flex items-center gap-4 bg-surface-container-lowest">
              <button onClick={() => setIsCheckoutOpen(false)} className="text-on-surface-variant hover:text-primary transition-colors">
                <span className="material-symbols-outlined">arrow_back</span>
              </button>
              <h2 className="font-headline-sm text-headline-sm text-primary">Checkout</h2>
            </div>
            
            <div className="flex-1 p-8 flex flex-col items-center justify-center text-center overflow-y-auto">
              {/* Order Summary */}
              <div className="grid grid-cols-3 gap-3 w-full mb-8">
                <div className="bg-surface-container-high border border-outline-variant/20 rounded-lg p-3">
                  <span className="font-label-caps text-label-caps text-on-surface-variant block mb-1">Table</span>
                  <strong className="font-price-display text-price-display text-primary">{selectedTable}</strong>
                </div>
                <div className="bg-surface-container-high border border-outline-variant/20 rounded-lg p-3">
                  <span className="font-label-caps text-label-caps text-on-surface-variant block mb-1">Items</span>
                  <strong className="font-price-display text-price-display text-primary">{cartCount}</strong>
                </div>
                <div className="bg-surface-container-high border border-outline-variant/20 rounded-lg p-3">
                  <span className="font-label-caps text-label-caps text-on-surface-variant block mb-1">Total</span>
                  <strong className="font-price-display text-price-display text-primary">₹{cartTotal.toFixed(2)}</strong>
                </div>
              </div>

              <p className="font-body-md text-body-md text-on-surface-variant mb-6">Scan the QR code to confirm your order.</p>
              
              {/* QR Code */}
              <div className="bg-white p-4 rounded-xl mb-6 border-4 border-primary-container/30 gold-glow">
                {qrCode ? (
                  <img src={qrCode} alt="Order QR Code" className="w-48 h-48 rounded" />
                ) : (
                  <div className="w-48 h-48 flex items-center justify-center text-on-primary font-label-caps">Generating QR...</div>
                )}
              </div>

              {/* QR Details */}
              <div className="w-full bg-surface-container-high border border-outline-variant/20 rounded-lg p-4 mb-6 text-left">
                <h4 className="font-body-md text-on-surface font-medium mb-1">QR includes</h4>
                <p className="font-body-md text-body-md text-on-surface-variant/70">Table number, selected items, quantity, item prices, and total.</p>
              </div>
              
              {/* Verification Status Banner */}
              {isOrderVerified ? (
                <div className="w-full bg-primary/10 border border-primary/20 rounded-lg p-3.5 mb-6 text-center">
                  <span className="font-label-caps text-[11px] text-primary font-bold flex items-center justify-center gap-1">
                    <span className="material-symbols-outlined text-sm">check_circle</span>
                    Order Verified by Staff
                  </span>
                  <p className="text-[10px] text-on-surface-variant/80 mt-1 leading-relaxed">
                    Verification complete. You can now complete your payment.
                  </p>
                </div>
              ) : (
                <div className="w-full bg-error/10 border border-error/20 rounded-lg p-3.5 mb-6 text-center">
                  <span className="font-label-caps text-[11px] text-error font-bold flex items-center justify-center gap-1">
                    <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                    Awaiting Waiter Verification
                  </span>
                  <p className="text-[10px] text-on-surface-variant/80 mt-1 leading-relaxed">
                    Show the order QR code above to your waiter. Once verified, payment will unlock.
                  </p>
                </div>
              )}
              
              <div className="w-full space-y-4">
                <button 
                  onClick={handlePayNow}
                  className={`w-full py-3 rounded font-label-caps text-label-caps uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all ${
                    isOrderVerified 
                      ? 'bg-gold-metallic text-on-primary gold-glow' 
                      : 'bg-surface-container-high border border-outline-variant/30 text-on-surface-variant/40 cursor-not-allowed'
                  }`}
                >
                  <span className="material-symbols-outlined">credit_card</span> Pay Now
                </button>
                <button 
                  onClick={handlePayLater}
                  className="w-full bg-surface-container-high border border-outline-variant/50 text-on-surface py-3 rounded font-body-md text-body-md hover:border-primary/50 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined">schedule</span> Pay Later
                </button>
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
            
            <div className="p-6 border-t border-outline-variant/20 mt-auto bg-surface-container-lowest">
              <button 
                onClick={() => setIsFilterOpen(false)}
                className="w-full bg-gold-metallic text-on-primary font-label-caps text-label-caps py-4 rounded uppercase tracking-wider gold-glow transition-all flex items-center justify-center gap-2"
              >
                Apply Filters
              </button>
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
                  className="absolute top-4 right-4 bg-black/50 hover:bg-black/80 text-white p-2 rounded-full backdrop-blur-md transition-colors"
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
                </div>
                
                <p className="font-body-md text-on-surface-variant/90 leading-relaxed whitespace-pre-wrap">
                  {selectedItem.description}
                </p>
              </div>
              
              <div className="p-6 border-t border-outline-variant/10 bg-surface-container-lowest flex gap-4 shrink-0">
                <button 
                  onClick={() => { addToCart(selectedItem); setSelectedItem(null); }}
                  className="flex-1 bg-surface-container-highest hover:bg-surface-bright text-on-surface border border-outline-variant/30 font-label-caps text-[14px] py-3 md:py-4 rounded uppercase tracking-wider transition-colors"
                >
                  Add to Cart
                </button>
                <button 
                  onClick={() => { handleOrderNow(selectedItem); setSelectedItem(null); }}
                  className="flex-1 bg-primary text-on-primary font-label-caps text-[14px] py-3 md:py-4 rounded uppercase tracking-wider gold-glow transition-all"
                >
                  Order Now
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Payment QR Code Modal (Desktop fallback) */}
      <AnimatePresence>
        {showPaymentModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-surface-container rounded-2xl border border-primary/20 shadow-2xl w-full max-w-md overflow-hidden text-center"
            >
              <div className="p-6 border-b border-outline-variant/10 flex justify-between items-center bg-surface-container-lowest">
                <h3 className="font-headline-sm text-primary flex items-center gap-2">
                  <span className="material-symbols-outlined">qr_code_scanner</span>
                  Pay with Google Pay / UPI
                </h3>
                <button onClick={() => setShowPaymentModal(false)} className="text-on-surface-variant hover:text-primary transition-colors">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="p-8 flex flex-col items-center justify-center">
                {/* Order Summary */}
                <div className="mb-6">
                  <span className="font-label-caps text-label-caps text-on-surface-variant block mb-1">Amount to Pay</span>
                  <strong className="font-price-display text-4xl text-primary font-bold">₹{cartTotal.toFixed(2)}</strong>
                </div>

                {/* Detailed Receipt Slip */}
                <div className="w-full bg-surface-container-lowest border border-outline-variant/10 rounded-xl p-4 mb-6 text-left max-h-40 overflow-y-auto hide-scrollbar">
                  <h4 className="font-label-caps text-[11px] text-primary border-b border-outline-variant/10 pb-2 mb-2 uppercase tracking-wider flex justify-between items-center">
                    <span>Receipt Slip</span>
                    <span className="text-on-surface-variant/70">Table {selectedTable}</span>
                  </h4>
                  <div className="space-y-1.5 text-sm font-body-md text-on-surface-variant/90">
                    {cart.map((item) => (
                      <div key={item._id || item.id} className="flex justify-between items-center gap-4 text-[13px]">
                        <span className="truncate flex-1">
                          <span className="text-primary font-semibold font-mono">{item.quantity}x</span> {item.name}
                        </span>
                        <span className="font-semibold shrink-0">₹{(item.price * item.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* QR Code */}
                <div className="bg-white p-4 rounded-xl mb-6 border-4 border-primary-container/30 gold-glow">
                  {paymentQrCode ? (
                    <img src={paymentQrCode} alt="UPI Payment QR Code" className="w-56 h-56 rounded" />
                  ) : (
                    <div className="w-56 h-56 flex items-center justify-center text-on-primary font-label-caps">Generating QR...</div>
                  )}
                </div>

                <div className="w-full bg-surface-container-lowest/50 border border-outline-variant/15 rounded-xl p-4 mb-6 text-left">
                  <div className="flex gap-2.5 items-start">
                    <span className="material-symbols-outlined text-primary text-xl shrink-0 mt-0.5">info</span>
                    <div>
                      <h4 className="font-title-sm text-[13px] text-on-surface font-semibold">Instructions</h4>
                      <p className="font-body-sm text-[12px] text-on-surface-variant/80 mt-1 leading-relaxed">
                        Scan this QR code using Google Pay, PhonePe, Paytm, or any UPI-enabled banking app to transfer the exact amount directly to our restaurant account.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="w-full flex gap-3">
                  <button 
                    onClick={() => setShowPaymentModal(false)}
                    className="flex-1 bg-surface-container-high border border-outline-variant/50 text-on-surface py-3 rounded font-body-md text-sm hover:border-primary/50 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => {
                      setShowPaymentModal(false);
                      setIsCheckoutOpen(false);
                      setCart([]);
                      showNotification('Thank you! Your order has been placed and payment is initiated.');
                    }}
                    className="flex-1 bg-gold-metallic text-on-primary py-3 rounded font-label-caps text-[12px] uppercase tracking-widest gold-glow cursor-pointer"
                  >
                    I Have Paid
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Global Toast Notification */}
      <AnimatePresence>
        {notification && (
          <motion.div 
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className="fixed bottom-24 md:bottom-10 left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 md:right-10 bg-surface-container-high border border-primary/30 text-primary px-6 py-3 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.5),0_0_20px_rgba(212,175,55,0.15)] flex items-center gap-3 z-[200] whitespace-nowrap"
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

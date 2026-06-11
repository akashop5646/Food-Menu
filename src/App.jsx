import React, { useState, useMemo, useEffect } from 'react';
import { Routes, Route, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import QRCode from 'qrcode';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';

const MOCK_ITEMS = [
  {
    id: '1',
    category: 'Signature',
    name: 'Wagyu Tartare',
    price: 32,
    description: 'Hand-cut A5 Wagyu, cured egg yolk, caper dust, and house-made brioche toast points.',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBx0Ol3RYYWpF18-XaCwRHQ4ShEX7Vr9RWv5Qwe6idMfuQA5KG9LLNzl4QnQMsk6niw09RFqBQtgK9Eaf4AGbE7VAX93POtMMTjrNrYXGY19emxfui6TFlg_Cax_1eAU_ZrA-qupPebLJPa2cci6OZ5p5xn1H3Pj2XfFfq9HnJb0DfNe7rdmjG2YJzmGd6y2X7giwcpUnotQgr39gW0_mTPmi4D8HQSdOHg3cmbStsehCiXGbb4EfAxKtvr_hKxqGhD6bfHmMmcEnQ',
    chefPick: true,
  },
  {
    id: '2',
    category: 'Mains',
    name: 'Truffle Risotto',
    price: 42,
    description: 'Aquerello rice, 24-month Parmigiano-Reggiano, finished with fresh seasonal black truffle shavings.',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAZ09dG-17uv6JgzqLuBDDnjAF5XZh-0rcEswei7nkmAJeWyvQCNi0Stb-ve6kIw3sMoyI_U-889NYiMUI31DF6i6jW3f6bnGOFZsHJddWKA4t2oj9TBrRjU6HflajtUdIbUYBQh2Cqj1HCfeYw_8mqhW69MGeRlQ8jgPWfPwPFPB4dzCeOKTmJ4nA1KuULsa4uEhDcPscSCrgTvAdiBnK0BhlIIlrS3o06nfLlkDBw74wNe1AeOP8qFK_C6nHkQdCTmLaFnwCCjN0',
    chefPick: false,
  },
  {
    id: '3',
    category: 'Signature',
    name: 'Black Garlic Chicken',
    price: 48,
    description: 'Charcoal-roasted heritage breed chicken, infused with aged black garlic, served with wild mushrooms and a rich truffle jus.',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCwrfpdpMeBRwq46s09MloGBE5BZuhdZfHkwOMD8U5erkHTJUgGc87L5m29O3wcoItAA6BIoGqtZtvADpP1nfyzxSzI1JpV2L5SG4nF-mfilkwQVKFiFGfNrge5N5Wyihebjt5TeQUUEHyf2xYMDNUxNSkO_vrkHcj6LN9bSBN3czHnFqy1507jUTsP3j9hWrdg0pvvuomdbpY2llJz87g4NpSIGMOdvZQ0NGBl2rjCON6clcmnG1X6JXsTciuHa2eTXXQv1bqSeNo',
    chefPick: true,
  }
];

const CATEGORIES = ['All', 'Signature', 'Small Plates', 'Mains', 'Desserts', 'Beverages'];

function MenuPage() {
  const [searchParams] = useSearchParams();
  const tableParam = searchParams.get('table') || 'Walk-in';

  const [cart, setCart] = useState([]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTable] = useState(tableParam);
  
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [qrCode, setQrCode] = useState('');

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const filteredItems = useMemo(() => {
    return MOCK_ITEMS.filter(item => {
      const matchCat = activeCategory === 'All' || item.category === activeCategory;
      const matchSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          item.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [activeCategory, searchQuery]);

  const addToCart = (dish) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === dish.id);
      if (existing) {
        return prev.map(i => i.id === dish.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { ...dish, quantity: 1 }];
    });
  };

  const updateQuantity = (id, change) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
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
      itemCount: cartCount,
      total: cartTotal,
      items: cart.map(item => ({ id: item.id, name: item.name, price: item.price, quantity: item.quantity })),
      createdAt: new Date().toISOString(),
    };
  }, [cart, cartCount, cartTotal, selectedTable]);

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

  return (
    <div className="bg-background text-on-surface pb-32 min-h-screen">
      {/* TopAppBar */}
      <header className="bg-surface/90 backdrop-blur-md fixed top-0 w-full z-50 border-b border-outline-variant/20 flex justify-between items-center px-margin-mobile h-16 md:hidden">
        <button className="text-primary hover:text-primary transition-colors hover:scale-95 duration-200">
          <span className="material-symbols-outlined">menu</span>
        </button>
        <div className="font-display-lg-mobile text-display-lg-mobile text-primary tracking-tighter text-center w-full">Aurum Table</div>
        <button className="text-primary hover:text-primary transition-colors hover:scale-95 duration-200 relative" onClick={toggleCart}>
          <span className="material-symbols-outlined">shopping_bag</span>
          {cartCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-error text-on-error-container text-[10px] rounded-full h-4 w-4 flex items-center justify-center font-bold">
              {cartCount}
            </span>
          )}
        </button>
      </header>

      {/* Main Content Area */}
      <main className="pt-16 max-w-[1200px] mx-auto">
        
        {/* Hero Section */}
        <section className="relative h-[530px] md:h-[618px] flex flex-col justify-end p-margin-mobile md:p-margin-desktop bg-surface-container overflow-hidden">
          <div 
            className="absolute inset-0 bg-center bg-cover bg-no-repeat opacity-40 mix-blend-luminosity" 
            style={{ backgroundImage: `url('https://lh3.googleusercontent.com/aida-public/AB6AXuCwrfpdpMeBRwq46s09MloGBE5BZuhdZfHkwOMD8U5erkHTJUgGc87L5m29O3wcoItAA6BIoGqtZtvADpP1nfyzxSzI1JpV2L5SG4nF-mfilkwQVKFiFGfNrge5N5Wyihebjt5TeQUUEHyf2xYMDNUxNSkO_vrkHcj6LN9bSBN3czHnFqy1507jUTsP3j9hWrdg0pvvuomdbpY2llJz87g4NpSIGMOdvZQ0NGBl2rjCON6clcmnG1X6JXsTciuHa2eTXXQv1bqSeNo')` }}
          />
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="relative z-10 w-full md:w-2/3"
          >
            <span className="font-label-caps text-label-caps text-primary tracking-widest uppercase mb-4 block">Signature Tasting</span>
            <h1 className="font-display-lg-mobile text-display-lg-mobile md:font-display-lg md:text-display-lg text-primary mb-2 leading-tight">Black Garlic Chicken</h1>
            <p className="font-body-lg text-body-lg text-on-surface-variant max-w-lg mb-6 line-clamp-3">
              Charcoal-roasted heritage breed chicken, infused with aged black garlic, served with wild mushrooms and a rich truffle jus.
            </p>
            <div className="flex items-center gap-4">
              <span className="font-price-display text-price-display text-primary-fixed-dim">$48</span>
              <button 
                onClick={() => handleOrderNow(MOCK_ITEMS[2])}
                className="bg-gold-metallic text-on-primary font-label-caps text-label-caps px-6 py-3 rounded uppercase tracking-wider gold-glow transition-all"
              >
                Order Now
              </button>
            </div>
          </motion.div>
        </section>

        {/* Sticky Search & Filters */}
        <section className="sticky top-[64px] md:top-0 z-40 bg-background/95 backdrop-blur-xl border-b border-outline-variant/30 py-4 px-margin-mobile md:px-margin-desktop flex flex-col gap-4">
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
        </section>

        {/* Menu Grid */}
        <motion.section layout className="p-margin-mobile md:p-margin-desktop grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter mt-8">
          <AnimatePresence mode="popLayout">
            {filteredItems.map((item, i) => (
              <motion.article 
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                key={item.id} 
                className="bg-surface-container border border-primary/20 rounded-lg overflow-hidden group hover:border-primary/50 transition-colors flex flex-col"
              >
                <div className="relative overflow-hidden p-4 h-36 md:h-48">
                  <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors z-10"></div>
                  <img 
                    src={item.image} 
                    alt={item.name} 
                    className="w-full h-full object-cover rounded-md group-hover:scale-105 transition-transform duration-700" 
                  />
                  {item.chefPick && (
                    <div className="absolute z-20 bg-primary/90 backdrop-blur text-on-primary px-2 py-1 text-[10px] font-label-caps uppercase tracking-widest rounded-sm flex items-center gap-1 top-4 left-4">
                      <span className="material-symbols-outlined text-[12px]">star</span> Chef Pick
                    </div>
                  )}
                </div>
                
                <div className="flex-1 flex flex-col justify-between p-4">
                  <div>
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-headline-sm text-headline-sm text-primary group-hover:text-primary-fixed transition-colors mb-1">{item.name}</h3>
                      <span className="font-price-display text-price-display text-on-surface">${item.price}</span>
                    </div>
                    <p className="font-body-md text-body-md text-on-surface-variant/70 line-clamp-3 mb-3">
                      {item.description}
                    </p>
                  </div>
                  
                  <div className="flex gap-3 mt-auto border-t border-outline-variant/10 pt-3">
                    <button 
                      onClick={() => addToCart(item)}
                      className="flex-1 bg-surface-container-highest hover:bg-surface-bright text-on-surface border border-outline-variant/30 font-label-caps text-label-caps py-2 rounded uppercase tracking-wider transition-colors"
                    >
                      Add to Cart
                    </button>
                    <button 
                      onClick={() => handleOrderNow(item)}
                      className="flex-1 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 font-label-caps text-label-caps py-2 rounded uppercase tracking-wider transition-colors"
                    >
                      Order Now
                    </button>
                  </div>
                </div>
              </motion.article>
            ))}
          </AnimatePresence>
        </motion.section>

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
                      key={item.id}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="flex justify-between items-center py-3 border-b border-outline-variant/10"
                    >
                      <div className="flex-1 pr-4">
                        <h4 className="font-body-md text-on-surface font-medium">{item.name}</h4>
                        <span className="font-price-display text-[14px] text-primary-fixed-dim">${item.price}</span>
                      </div>
                      <div className="flex items-center gap-3 bg-surface-container-high rounded border border-outline-variant/30 px-2 py-1">
                        <button onClick={() => updateQuantity(item.id, -1)} className="text-on-surface-variant hover:text-primary">
                          <span className="material-symbols-outlined text-[18px]">remove</span>
                        </button>
                        <span className="font-body-md text-on-surface w-4 text-center">{item.quantity}</span>
                        <button onClick={() => updateQuantity(item.id, 1)} className="text-on-surface-variant hover:text-primary">
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
                <span className="font-price-display text-price-display text-primary">${cartTotal.toFixed(2)}</span>
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
                  <strong className="font-price-display text-price-display text-primary">${cartTotal.toFixed(2)}</strong>
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
              
              <div className="w-full space-y-4">
                <button className="w-full bg-gold-metallic text-on-primary py-3 rounded font-label-caps text-label-caps uppercase tracking-wider gold-glow transition-all flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined">credit_card</span> Pay Now
                </button>
                <button className="w-full bg-surface-container-high border border-outline-variant/50 text-on-surface py-3 rounded font-body-md text-body-md hover:border-primary/50 transition-colors flex items-center justify-center gap-2">
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
                  {CATEGORIES.map(cat => (
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

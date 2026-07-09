import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { API_BASE } from '../config';

const PAYMENT_METHODS = [
  { value: 'ONLINE', label: 'Razorpay / Online' },
  { value: 'CASH', label: 'Cash Payment' },
  { value: 'CARD', label: 'Credit / Debit Card' },
];

const PAYMENT_STATUSES = [
  { value: 'PENDING', label: 'Pending (Pay Later)' },
  { value: 'PAID', label: 'Paid (Manually Verified)' },
];

function formatMoney(value) {
  const amount = Number(value || 0);
  return `\u20B9${amount.toFixed(2)}`;
}

export default function OrderScanner() {
  const [mode, setMode] = useState('scan');
  const [codeInput, setCodeInput] = useState('');
  const [parsedOrder, setParsedOrder] = useState(null);
  const [error, setError] = useState('');
  const [paymentType, setPaymentType] = useState('ONLINE');
  const [paymentStatus, setPaymentStatus] = useState('PENDING');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  const [menuItems, setMenuItems] = useState([]);
  const [tables, setTables] = useState([]);
  const [locations, setLocations] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [manualSearch, setManualSearch] = useState('');
  const [selectedTableId, setSelectedTableId] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [manualOrderItems, setManualOrderItems] = useState({});

  const selectedTable = useMemo(
    () => tables.find(table => String(table._id) === String(selectedTableId)) || null,
    [tables, selectedTableId]
  );

  const selectedLocation = useMemo(() => {
    if (selectedLocationId) {
      return locations.find(location => String(location._id) === String(selectedLocationId)) || null;
    }
    if (selectedTable?.locationId) {
      return locations.find(location => String(location._id) === String(selectedTable.locationId)) || null;
    }
    if (selectedTable?.location) {
      return locations.find(location => location.name === selectedTable.location) || null;
    }
    return null;
  }, [locations, selectedLocationId, selectedTable]);

  const visibleMenuItems = menuItems;

  const manualLineItems = useMemo(() => {
    return Object.values(manualOrderItems)
      .map(sel => ({ ...sel.item, quantity: sel.quantity }))
      .filter(item => item.quantity > 0);
  }, [manualOrderItems]);

  const manualItemCount = useMemo(
    () => manualLineItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    [manualLineItems]
  );

  const manualTotal = useMemo(
    () => manualLineItems.reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity)), 0),
    [manualLineItems]
  );

  const selectTable = useCallback((tableId) => {
    setSelectedTableId(tableId);
    const table = tables.find(item => String(item._id) === String(tableId));
    if (!table) return;
    const matchedLocation = table.locationId
      ? locations.find(location => String(location._id) === String(table.locationId))
      : locations.find(location => location.name === table.location) || null;
    setSelectedLocationId(matchedLocation ? String(matchedLocation._id) : '');
  }, [locations, tables]);

  const setItemQuantity = useCallback((item, delta) => {
    setManualOrderItems(prev => {
      const current = prev[item._id] ? Number(prev[item._id].quantity || 0) : 0;
      const next = Math.max(0, current + delta);
      if (next === 0) {
        const clone = { ...prev };
        delete clone[item._id];
        return clone;
      }
      return {
        ...prev,
        [item._id]: { item, quantity: next }
      };
    });
  }, []);

  const clearManualOrder = useCallback(() => {
    setManualOrderItems({});
    setManualSearch('');
  }, []);

  const handleCodeVerify = async (e) => {
    e.preventDefault();
    if (codeInput.length !== 4) {
      setError('Please enter a valid 4-digit code.');
      return;
    }

    setIsVerifying(true);
    setError('');
    setSuccessMsg('');

    try {
      const res = await fetch(API_BASE + '/api/orders/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeInput }),
        credentials: 'include'
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to verify code.');
        return;
      }

      // Set parsedOrder from the verified payload
      setParsedOrder(data.orderPayload);
      setError('');
    } catch (err) {
      console.error('Code verification error:', err);
      setError('Failed to verify code. Please try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  const [debouncedManualSearch, setDebouncedManualSearch] = useState('');

  // Debounce the manual search text
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedManualSearch(manualSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [manualSearch]);

  // Load menu items when manual search changes (limited to 6 items)
  useEffect(() => {
    const fetchFilteredMenu = async () => {
      try {
        setCatalogLoading(true);
        const res = await fetch(`${API_BASE}/api/menu?limit=6&search=${encodeURIComponent(debouncedManualSearch)}`);
        const data = await res.json();
        setMenuItems(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Failed to load menu items:', err);
      } finally {
        setCatalogLoading(false);
      }
    };

    fetchFilteredMenu();
  }, [debouncedManualSearch]);

  useEffect(() => {
    const loadCatalog = async () => {
      try {
        const [tablesRes, locationsRes] = await Promise.all([
          fetch(API_BASE + '/api/tables'),
          fetch(API_BASE + '/api/locations')
        ]);

        const [tablesData, locationsData] = await Promise.all([
          tablesRes.json(),
          locationsRes.json()
        ]);

        const normalizedTables = Array.isArray(tablesData) ? tablesData : (tablesData.tables || []);
        const normalizedLocations = Array.isArray(locationsData) ? locationsData : [];

        setTables(normalizedTables);
        setLocations(normalizedLocations);

        if (normalizedTables.length > 0) {
          const firstTable = normalizedTables[0];
          const firstTableId = String(firstTable._id);
          setSelectedTableId(prev => prev || firstTableId);

          const firstLocation = firstTable.locationId
            ? normalizedLocations.find(location => String(location._id) === String(firstTable.locationId))
            : normalizedLocations.find(location => location.name === firstTable.location) || null;
          if (firstLocation) {
            setSelectedLocationId(prev => prev || String(firstLocation._id));
          }
        }
      } catch (err) {
        console.error('Failed to load tables catalog:', err);
        setCatalogError('Could not load table data.');
      }
    };

    loadCatalog();
  }, []);

  useEffect(() => {
    if (selectedTable && !selectedLocationId) {
      const matchedLocation = selectedTable.locationId
        ? locations.find(location => String(location._id) === String(selectedTable.locationId))
        : locations.find(location => location.name === selectedTable.location) || null;
      if (matchedLocation) {
        setSelectedLocationId(String(matchedLocation._id));
      }
    }
  }, [locations, selectedLocationId, selectedTable]);





  const submitOrder = async ({ tableName, locationName, items, total }) => {
    const res = await fetch(API_BASE + '/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: tableName,
        location: locationName || null,
        tableId: selectedTable?._id || null,
        locationId: selectedLocation?._id || null,
        items,
        total,
        paymentType,
        paymentStatus,
        source: mode === 'manual' ? 'MANUAL' : 'CODE',
        deviceId: mode === 'manual' ? null : parsedOrder?.deviceId || null,
        customerIp: mode === 'manual' ? null : parsedOrder?.customerIp || null,
        checkoutSessionId: mode === 'manual' ? null : parsedOrder?.checkoutSessionId || null,
      }),
      credentials: 'include'
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to submit order.');
    }

    return data;
  };

  const handleScanSubmit = async (e) => {
    e.preventDefault();
    if (!parsedOrder) return;

    setIsSubmitting(true);
    setError('');

    try {
      await submitOrder({
        tableName: parsedOrder.table,
        locationName: parsedOrder.location || null,
        items: parsedOrder.items,
        total: parsedOrder.total,
      });

      setSuccessMsg(`Order for ${parsedOrder.table} verified and sent to Live KDS!`);
      setCodeInput('');
      setParsedOrder(null);
      setPaymentStatus('PENDING');
      setPaymentType('ONLINE');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    setSuccessMsg('');

    if (!selectedTable) {
      setError('Please select a table first.');
      setIsSubmitting(false);
      return;
    }

    if (manualLineItems.length === 0) {
      setError('Please add at least one menu item.');
      setIsSubmitting(false);
      return;
    }

    try {
      const payload = manualLineItems.map(item => ({
        id: item.id || item._id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
      }));

      await submitOrder({
        tableName: selectedTable.name || `Table ${selectedTable.number}`,
        locationName: selectedLocation?.name || selectedTable.location || null,
        items: payload,
        total: manualTotal,
      });

      setSuccessMsg(`Manual order created for ${selectedTable.name || `Table ${selectedTable.number}`}.`);
      clearManualOrder();
      setPaymentStatus('PENDING');
      setPaymentType('ONLINE');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelScan = () => {
    setCodeInput('');
    setParsedOrder(null);
    setPaymentStatus('PENDING');
    setPaymentType('ONLINE');
    setError('');
  };

  return (
    <div className="max-w-6xl mx-auto py-8 px-0 flex flex-col gap-6">
      <div className="bg-surface-container rounded-2xl border border-outline-variant/20 shadow-lg overflow-hidden">
        <div className="p-4 md:p-8 border-b border-outline-variant/10 bg-surface-container-low">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/20 bg-primary/10 text-primary text-[11px] font-label-caps uppercase tracking-widest mb-4">
                <span className="material-symbols-outlined text-[14px]">restaurant</span>
                Order Desk
              </div>
              <h2 className="font-headline-md text-2xl md:text-3xl text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">pin</span>
                Verify or Create Orders
              </h2>
              <p className="font-body-md text-on-surface-variant mt-2 max-w-2xl">
                Enter a customer's 4-digit order code to verify and confirm, or switch to manual mode to build a ticket from the live menu.
              </p>
            </div>

            <div className="flex items-center gap-2 bg-surface-container-high rounded-2xl p-1 border border-outline-variant/20">
              <button
                type="button"
                onClick={() => setMode('scan')}
                className={`px-4 py-2 rounded-xl font-label-caps text-[11px] uppercase tracking-widest transition-colors ${
                  mode === 'scan'
                    ? 'bg-primary text-on-primary shadow-lg'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Code Verification
              </button>
              <button
                type="button"
                onClick={() => setMode('manual')}
                className={`px-4 py-2 rounded-xl font-label-caps text-[11px] uppercase tracking-widest transition-colors ${
                  mode === 'manual'
                    ? 'bg-primary text-on-primary shadow-lg'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Manual Order
              </button>
            </div>
          </div>
        </div>

        <div className="p-4 md:p-8 flex flex-col gap-6">
          {successMsg && (
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-primary/10 text-primary px-4 py-4 rounded-xl border border-primary/20 text-sm font-medium flex items-center gap-3"
            >
              <span className="material-symbols-outlined text-xl">check_circle</span>
              <div>
                <strong className="block text-primary">Success</strong>
                <span className="text-[12px] opacity-90">{successMsg}</span>
              </div>
            </motion.div>
          )}

          {(error || catalogError) && (
            <div className="bg-error/10 text-error px-4 py-3 rounded-xl border border-error/20 text-sm font-medium">
              {error || catalogError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-surface-container-lowest border border-outline-variant/15 rounded-2xl p-4">
              <span className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-widest">Tables</span>
              <div className="mt-2 text-2xl font-headline-sm text-on-surface">{catalogLoading ? '...' : tables.length}</div>
            </div>
            <div className="bg-surface-container-lowest border border-outline-variant/15 rounded-2xl p-4">
              <span className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-widest">Locations</span>
              <div className="mt-2 text-2xl font-headline-sm text-on-surface">{catalogLoading ? '...' : locations.length}</div>
            </div>
            <div className="bg-surface-container-lowest border border-outline-variant/15 rounded-2xl p-4">
              <span className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-widest">Menu Items</span>
              <div className="mt-2 text-2xl font-headline-sm text-on-surface">{catalogLoading ? '...' : menuItems.length}</div>
            </div>
          </div>

          {mode === 'scan' ? (
            <>
              {!parsedOrder && (
                <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-6">
                  <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-4 md:p-6">
                    <form onSubmit={handleCodeVerify} className="flex flex-col gap-5">
                      <div>
                        <h3 className="font-headline-sm text-xl text-on-surface flex items-center gap-2">
                          <span className="material-symbols-outlined text-primary">pin</span>
                          Enter Order Code
                        </h3>
                        <p className="text-sm text-on-surface-variant mt-2">
                          Ask the customer for their 4-digit order code and enter it below.
                        </p>
                      </div>

                      <div className="flex items-center justify-center gap-2 sm:gap-3 py-3">
                        {[0, 1, 2, 3].map((idx) => (
                          <input
                            key={idx}
                            type="text"
                            inputMode="numeric"
                            maxLength={1}
                            value={codeInput[idx] || ''}
                            onChange={(e) => {
                              const val = e.target.value.replace(/[^0-9]/g, '');
                              const newCode = codeInput.split('');
                              newCode[idx] = val;
                              // Fill gaps with empty string
                              for (let i = 0; i < 4; i++) {
                                if (!newCode[i]) newCode[i] = '';
                              }
                              setCodeInput(newCode.join(''));
                              // Auto-focus next input
                              if (val && idx < 3) {
                                const next = e.target.parentElement.children[idx + 1];
                                if (next) next.focus();
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Backspace' && !codeInput[idx] && idx > 0) {
                                const prev = e.target.parentElement.children[idx - 1];
                                if (prev) prev.focus();
                              }
                            }}
                            onPaste={(e) => {
                              e.preventDefault();
                              const pasted = e.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, 4);
                              setCodeInput(pasted);
                              // Focus last filled input or the next empty one
                              const nextIdx = Math.min(pasted.length, 3);
                              const target = e.target.parentElement.children[nextIdx];
                              if (target) target.focus();
                            }}
                            className="w-12 h-16 sm:w-16 sm:h-20 text-center text-2xl sm:text-3xl font-bold font-mono bg-surface-container-highest border-2 border-outline-variant/50 rounded-xl text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition-all"
                            autoFocus={idx === 0}
                          />
                        ))}
                      </div>

                      <button
                        type="submit"
                        disabled={codeInput.length !== 4 || isVerifying}
                        className="bg-primary text-on-primary px-6 py-4 rounded-xl font-label-caps text-[12px] uppercase tracking-widest gold-glow flex items-center justify-center gap-2 cursor-pointer transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isVerifying ? (
                          <>
                            <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                            Verifying...
                          </>
                        ) : (
                          <>
                            <span className="material-symbols-outlined">verified</span>
                            Verify Code
                          </>
                        )}
                      </button>
                    </form>
                  </div>

                  <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-4 md:p-6 flex flex-col gap-4 justify-between">
                    <div>
                      <h3 className="font-headline-sm text-xl text-on-surface">Verification flow</h3>
                      <p className="text-sm text-on-surface-variant mt-2">
                        Enter the 4-digit code from the customer's device to pull up their order and confirm it.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      <div className="rounded-xl border border-outline-variant/15 bg-surface-container-high p-4">
                        <div className="text-[10px] uppercase tracking-widest text-on-surface-variant">Step 1</div>
                        <div className="text-sm text-on-surface mt-1">Ask the customer for their 4-digit order code.</div>
                      </div>
                      <div className="rounded-xl border border-outline-variant/15 bg-surface-container-high p-4">
                        <div className="text-[10px] uppercase tracking-widest text-on-surface-variant">Step 2</div>
                        <div className="text-sm text-on-surface mt-1">Verify items, payment method, and table details.</div>
                      </div>
                      <div className="rounded-xl border border-outline-variant/15 bg-surface-container-high p-4">
                        <div className="text-[10px] uppercase tracking-widest text-on-surface-variant">Step 3</div>
                        <div className="text-sm text-on-surface mt-1">Confirm and send the order to Live KDS.</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <AnimatePresence>
                {parsedOrder && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="border border-outline-variant/30 rounded-xl bg-surface-container-lowest overflow-hidden">
                      <div className="p-5 border-b border-outline-variant/20 bg-surface-container-low flex flex-col gap-3">
                        <div className="flex justify-between items-center gap-4">
                          <span className="font-label-caps text-[10px] text-primary uppercase tracking-widest">Verified Order</span>
                          <div className="text-right">
                            <span className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-widest block">Total Price</span>
                            <strong className="font-price-display text-lg text-primary">{formatMoney(parsedOrder.total)}</strong>
                          </div>
                        </div>
                        {/* Prominent Table Badge */}
                        <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-lg px-3 py-2.5">
                          <span className="material-symbols-outlined text-primary text-xl">table_restaurant</span>
                          <strong className="font-headline-sm text-lg text-primary">{parsedOrder.table}</strong>
                          {parsedOrder.location && (
                            <span className="text-xs text-on-surface-variant font-medium ml-auto">📍 {parsedOrder.location}</span>
                          )}
                        </div>
                      </div>

                      <div className="px-5 py-3 border-b border-outline-variant/15 bg-surface-container-lowest flex flex-col sm:flex-row justify-between text-xs text-on-surface-variant/70 gap-2 font-mono">
                        <div>
                          <span className="font-semibold text-primary font-sans">Customer IP:</span> {parsedOrder.customerIp || 'N/A'}
                        </div>
                        <div>
                          <span className="font-semibold text-primary font-sans">Device ID:</span> {parsedOrder.deviceId ? `${parsedOrder.deviceId.substring(0, 16)}...` : 'N/A'}
                        </div>
                      </div>

                      <div className="p-5 flex flex-col gap-4">
                        <div className="space-y-3">
                          <label className="block font-label-caps text-[11px] text-on-surface-variant uppercase tracking-widest">Ordered Items</label>
                          <div className="divide-y divide-outline-variant/10">
                            {parsedOrder.items.map((item, idx) => (
                              <div key={item.id || idx} className="py-2.5 flex justify-between items-center text-sm">
                                <span className="text-on-surface">
                                  <span className="text-primary font-bold mr-1">{item.quantity}x</span> {item.name}
                                </span>
                                <span className="text-on-surface-variant font-medium">{formatMoney(Number(item.price) * Number(item.quantity))}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <form onSubmit={handleScanSubmit} className="border-t border-outline-variant/10 pt-4 mt-2 flex flex-col gap-4">
                          <h4 className="font-label-caps text-[11px] text-on-surface-variant uppercase tracking-widest">Verification Details</h4>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block font-label-caps text-[11px] text-on-surface-variant mb-1.5 uppercase tracking-wider">Payment Method</label>
                              <select
                                value={paymentType}
                                onChange={(e) => setPaymentType(e.target.value)}
                                className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-3 py-2.5 focus:border-primary outline-none text-sm"
                              >
                                {PAYMENT_METHODS.map(option => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="block font-label-caps text-[11px] text-on-surface-variant mb-1.5 uppercase tracking-wider">Payment Status</label>
                              <select
                                value={paymentStatus}
                                onChange={(e) => setPaymentStatus(e.target.value)}
                                className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-3 py-2.5 focus:border-primary outline-none text-sm"
                              >
                                {PAYMENT_STATUSES.map(option => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row gap-3 pt-3">
                            <button
                              type="button"
                              onClick={handleCancelScan}
                              className="flex-1 bg-surface-container-high border border-outline-variant/50 text-on-surface hover:text-error hover:border-error/50 py-3.5 rounded-xl font-label-caps text-[13px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2 cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-[18px]">close</span>
                              Cancel / Reset
                            </button>
                            <button
                              type="submit"
                              disabled={isSubmitting}
                              className="flex-[2] bg-gold-metallic text-on-primary-fixed py-3.5 rounded-xl font-label-caps text-[13px] uppercase tracking-widest gold-glow flex items-center justify-center gap-2 cursor-pointer transition-transform active:scale-95 disabled:opacity-50"
                            >
                              {isSubmitting ? (
                                <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                              ) : (
                                <span className="material-symbols-outlined text-[18px]">done_all</span>
                              )}
                              Confirm Order & Send to KDS
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          ) : (
            <div className="flex flex-col-reverse xl:grid xl:grid-cols-[1.1fr_0.9fr] gap-6">
              <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-4 md:p-6 flex flex-col gap-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-headline-sm text-xl text-on-surface">Manual order composer</h3>
                    <p className="text-sm text-on-surface-variant mt-1">
                      Start with a table, confirm the location, then build the ticket from the items already in your menu.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={clearManualOrder}
                    className="bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-error px-3 py-2 rounded-lg text-[11px] uppercase tracking-widest font-label-caps"
                  >
                    Clear Items
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-label-caps text-[11px] text-on-surface-variant mb-1.5 uppercase tracking-wider">Select Table</label>
                    <select
                      value={selectedTableId}
                      onChange={(e) => selectTable(e.target.value)}
                      className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-xl px-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none text-sm"
                    >
                      <option value="" disabled>Select a table</option>
                      {tables.map(table => (
                        <option key={table._id} value={table._id}>
                          {table.name || `Table ${table.number}`} {table.locationName || table.location ? `- ${table.locationName || table.location}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-label-caps text-[11px] text-on-surface-variant mb-1.5 uppercase tracking-wider">Location</label>
                    <select
                      value={selectedLocationId}
                      onChange={(e) => setSelectedLocationId(e.target.value)}
                      className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-xl px-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none text-sm"
                    >
                      <option value="">Use table location</option>
                      {locations.map(location => (
                        <option key={location._id} value={location._id}>{location.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-xl border border-outline-variant/15 bg-surface-container-high p-4">
                    <span className="block text-[10px] uppercase tracking-widest text-on-surface-variant">Table</span>
                    <div className="mt-1 text-sm text-on-surface font-semibold">
                      {selectedTable ? (selectedTable.name || `Table ${selectedTable.number}`) : 'No table selected'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-outline-variant/15 bg-surface-container-high p-4">
                    <span className="block text-[10px] uppercase tracking-widest text-on-surface-variant">Location</span>
                    <div className="mt-1 text-sm text-on-surface font-semibold">
                      {selectedLocation ? selectedLocation.name : (selectedTable?.location || 'Not assigned')}
                    </div>
                  </div>
                  <div className="rounded-xl border border-outline-variant/15 bg-surface-container-high p-4">
                    <span className="block text-[10px] uppercase tracking-widest text-on-surface-variant">Items</span>
                    <div className="mt-1 text-sm text-on-surface font-semibold">
                      {manualItemCount} selected
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                    <div>
                      <h4 className="font-label-caps text-[11px] text-on-surface-variant uppercase tracking-widest">Menu Items</h4>
                      <p className="text-sm text-on-surface-variant/70 mt-1">Search and add directly from the current catalog.</p>
                    </div>
                    <div className="relative w-full sm:w-72">
                      <span className="material-symbols-outlined absolute left-3 top-3 text-on-surface-variant text-[18px]">search</span>
                      <input
                        type="text"
                        value={manualSearch}
                        onChange={(e) => setManualSearch(e.target.value)}
                        placeholder="Search menu items..."
                        className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-xl pl-10 pr-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none text-sm"
                      />
                    </div>
                  </div>

                  {catalogLoading ? (
                    <div className="flex items-center justify-center py-16">
                      <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
                    </div>
                  ) : visibleMenuItems.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-outline-variant/20 bg-surface-container-high/40 py-16 text-center text-on-surface-variant/60">
                      <span className="material-symbols-outlined text-5xl">restaurant_menu</span>
                      <p className="mt-3 text-sm">No menu items match your search.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-h-[560px] overflow-y-auto pr-1">
                      {visibleMenuItems.map(item => {
                        const qty = manualOrderItems[item._id] ? manualOrderItems[item._id].quantity : 0;
                        return (
                          <div key={item._id} className="rounded-2xl border border-outline-variant/20 bg-surface-container-high overflow-hidden shadow-sm">
                            <div className="p-4 flex gap-4 items-start">
                              <div className="w-16 h-16 rounded-xl bg-surface-container-low overflow-hidden border border-outline-variant/10 shrink-0 flex items-center justify-center">
                                {item.image ? (
                                  <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                                ) : (
                                  <span className="material-symbols-outlined text-primary/40">restaurant</span>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                                  <div className="min-w-0">
                                    <h5 className="font-semibold text-on-surface truncate">{item.name}</h5>
                                    <p className="text-xs text-on-surface-variant mt-1 line-clamp-2">{item.description || 'No description available.'}</p>
                                  </div>
                                  <div className="text-left sm:text-right shrink-0">
                                    <div className="font-price-display text-primary font-semibold">{formatMoney(item.price)}</div>
                                  </div>
                                </div>

                                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="text-[10px] uppercase tracking-widest text-on-surface-variant min-w-0">
                                    {item.categories && item.categories.length > 0 ? item.categories.join(' · ') : 'Menu Item'}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                                    <button
                                      type="button"
                                      onClick={() => setItemQuantity(item, -1)}
                                      className="w-8 h-8 rounded-full border border-outline-variant/30 text-on-surface-variant hover:text-error hover:border-error/40 flex items-center justify-center"
                                      aria-label={`Remove one ${item.name}`}
                                    >
                                      <span className="material-symbols-outlined text-[18px]">remove</span>
                                    </button>
                                    <div className="min-w-8 text-center font-semibold text-on-surface px-1">{qty}</div>
                                    <button
                                      type="button"
                                      onClick={() => setItemQuantity(item, 1)}
                                      className="w-8 h-8 rounded-full bg-primary text-on-primary hover:opacity-90 flex items-center justify-center"
                                      aria-label={`Add one ${item.name}`}
                                    >
                                      <span className="material-symbols-outlined text-[18px]">add</span>
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-4 md:p-6 flex flex-col gap-5">
                <div>
                  <h3 className="font-headline-sm text-xl text-on-surface">Order summary</h3>
                  <p className="text-sm text-on-surface-variant mt-1">Review the ticket before sending it to Live KDS.</p>
                </div>

                <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-high p-4 space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-on-surface-variant">Table</span>
                    <span className="font-semibold text-on-surface">{selectedTable ? (selectedTable.name || `Table ${selectedTable.number}`) : 'None selected'}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-on-surface-variant">Location</span>
                    <span className="font-semibold text-on-surface">{selectedLocation ? selectedLocation.name : (selectedTable?.location || 'Not assigned')}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-on-surface-variant">Items</span>
                    <span className="font-semibold text-on-surface">{manualItemCount}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm pt-2 border-t border-outline-variant/10">
                    <span className="text-on-surface-variant">Total</span>
                    <span className="font-price-display text-primary font-semibold">{formatMoney(manualTotal)}</span>
                  </div>
                </div>

                <form onSubmit={handleManualSubmit} className="flex flex-col gap-4">
                  <div>
                    <label className="block font-label-caps text-[11px] text-on-surface-variant mb-1.5 uppercase tracking-wider">Payment Method</label>
                    <select
                      value={paymentType}
                      onChange={(e) => setPaymentType(e.target.value)}
                      className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-xl px-4 py-3 focus:border-primary outline-none text-sm"
                    >
                      {PAYMENT_METHODS.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-label-caps text-[11px] text-on-surface-variant mb-1.5 uppercase tracking-wider">Payment Status</label>
                    <select
                      value={paymentStatus}
                      onChange={(e) => setPaymentStatus(e.target.value)}
                      className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-xl px-4 py-3 focus:border-primary outline-none text-sm"
                    >
                      {PAYMENT_STATUSES.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting || !selectedTable || manualLineItems.length === 0}
                    className="w-full bg-gold-metallic text-on-primary-fixed py-4 rounded-xl font-label-caps text-[13px] uppercase tracking-widest gold-glow flex items-center justify-center gap-2 cursor-pointer transition-transform active:scale-95 disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                    ) : (
                      <span className="material-symbols-outlined text-[18px]">local_fire_department</span>
                    )}
                    Send Manual Order to KDS
                  </button>
                </form>

                {manualLineItems.length > 0 && (
                  <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-high p-4">
                    <h4 className="font-label-caps text-[11px] text-on-surface-variant uppercase tracking-widest mb-3">Selected Items</h4>
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {manualLineItems.map(item => (
                        <div key={item._id} className="flex justify-between items-center text-sm">
                          <div className="min-w-0">
                            <span className="font-semibold text-on-surface">{item.quantity}x {item.name}</span>
                          </div>
                          <div className="text-on-surface-variant font-medium">{formatMoney(Number(item.price) * Number(item.quantity))}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

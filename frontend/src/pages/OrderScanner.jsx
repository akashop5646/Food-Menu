import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ScanOrderPanel from './order-scanner/ScanOrderPanel';
import ManualOrderBuilder from './order-scanner/ManualOrderBuilder';
import MenuItemPicker from './order-scanner/MenuItemPicker';
import ManualOrderSummary from './order-scanner/ManualOrderSummary';
import OrderReview from './order-scanner/OrderReview';
import OrderStatusMessage from './order-scanner/OrderStatusMessage';
import {
  verifyCode,
  loadCatalog,
  fetchFilteredMenu,
  submitOrder
} from './order-scanner/orderScannerApi';

const getTableLocationId = (table) =>
  table.locationId?._id ??
  table.locationId ??
  table.location?._id ??
  null;

const getTableDisplayLabel = (table) => {
  if (!table) return '';
  return table.name || (table.number ? `Table ${table.number}` : 'Table');
};

const getTableSortKey = (table) => {
  const candidate =
    table.tableNumber ??
    table.number ??
    table.displayOrder ??
    null;

  const numeric = Number(candidate);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const label = String(getTableDisplayLabel(table) || '');
  const match = label.match(/(\d+)/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
};

export default function OrderScanner() {
  const [mode, setMode] = useState('scan'); // 'scan' or 'manual'
  const [codeInput, setCodeInput] = useState('');
  const [parsedOrder, setParsedOrder] = useState(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Payment settings (for review/confirmation)
  const [paymentType, setPaymentType] = useState('ONLINE');
  const [paymentStatus, setPaymentStatus] = useState('PENDING');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  // Catalog and search states
  const [menuItems, setMenuItems] = useState([]);
  const [tables, setTables] = useState([]);
  const [locations, setLocations] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [manualSearch, setManualSearch] = useState('');
  const [selectedTableId, setSelectedTableId] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [manualOrderItems, setManualOrderItems] = useState({});

  // Review stage states
  const [isReviewing, setIsReviewing] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [focusTrigger, setFocusTrigger] = useState(0);

  // Abort Controllers Refs
  const searchAbortControllerRef = useRef(null);
  const catalogAbortControllerRef = useRef(null);
  const verifyAbortControllerRef = useRef(null);

  // Selected table/location derivations
  const selectedTable = useMemo(
    () => tables.find(table => String(table._id) === String(selectedTableId)) || null,
    [tables, selectedTableId]
  );

  const filteredTables = useMemo(() => {
    const matchingTables = selectedLocationId
      ? tables.filter(
          table => String(getTableLocationId(table)) === String(selectedLocationId)
        )
      : [...tables];

    return [...matchingTables].sort((a, b) => {
      const aKey = getTableSortKey(a);
      const bKey = getTableSortKey(b);

      if (aKey !== bKey) {
        return aKey - bKey;
      }

      return getTableDisplayLabel(a).localeCompare(
        getTableDisplayLabel(b),
        undefined,
        { numeric: true, sensitivity: 'base' }
      );
    });
  }, [tables, selectedLocationId]);

  // Clear selected table if it is no longer valid in the newly selected location
  useEffect(() => {
    if (!selectedLocationId || !selectedTableId) {
      return;
    }
    const isTableValid = filteredTables.some(
      table => String(table._id) === String(selectedTableId)
    );
    if (!isTableValid) {
      setSelectedTableId('');
    }
  }, [selectedLocationId, selectedTableId, filteredTables]);

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

  // Invalidate Reviewed state & Idempotency Key when cart or table modifications happen
  useEffect(() => {
    setIdempotencyKey('');
    setIsReviewing(false);
  }, [manualOrderItems, selectedTableId, selectedLocationId]);

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

  // 4-digit code verification request
  const handleCodeVerify = async (codeToVerify) => {
    if (isVerifying) return;
    setIsVerifying(true);
    setError('');
    setSuccessMsg('');

    if (verifyAbortControllerRef.current) {
      verifyAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    verifyAbortControllerRef.current = controller;

    try {
      const data = await verifyCode(codeToVerify, controller.signal);
      setParsedOrder(data.orderPayload);
      setError('');
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
      }
    } finally {
      if (verifyAbortControllerRef.current === controller) {
        setIsVerifying(false);
      }
    }
  };

  const [debouncedManualSearch, setDebouncedManualSearch] = useState('');

  // Debounce the search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedManualSearch(manualSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [manualSearch]);

  // Load menu items on search query update
  useEffect(() => {
    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    searchAbortControllerRef.current = controller;

    const fetchMenu = async () => {
      setCatalogLoading(true);
      try {
        const data = await fetchFilteredMenu(debouncedManualSearch, controller.signal);
        setMenuItems(data);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Menu items loading failed:', err);
        }
      } finally {
        if (searchAbortControllerRef.current === controller) {
          setCatalogLoading(false);
        }
      }
    };

    fetchMenu();

    return () => {
      controller.abort();
    };
  }, [debouncedManualSearch]);

  // Load catalog (Tables & Locations)
  const loadCatalogData = useCallback(async () => {
    if (catalogAbortControllerRef.current) {
      catalogAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    catalogAbortControllerRef.current = controller;

    setCatalogLoading(true);
    setCatalogError('');

    try {
      const { tables: fetchedTables, locations: fetchedLocations } = await loadCatalog(controller.signal);
      setTables(fetchedTables);
      setLocations(fetchedLocations);

      if (fetchedTables.length > 0) {
        const firstTable = fetchedTables[0];
        const firstTableId = String(firstTable._id);
        setSelectedTableId(prev => prev || firstTableId);

        const firstLocation = firstTable.locationId
          ? fetchedLocations.find(loc => String(loc._id) === String(firstTable.locationId))
          : fetchedLocations.find(loc => loc.name === firstTable.location) || null;
        if (firstLocation) {
          setSelectedLocationId(prev => prev || String(firstLocation._id));
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Tables catalog loading failed:', err);
        setCatalogError(err.message);
      }
    } finally {
      if (catalogAbortControllerRef.current === controller) {
        setCatalogLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadCatalogData();
    return () => {
      if (catalogAbortControllerRef.current) {
        catalogAbortControllerRef.current.abort();
      }
    };
  }, [loadCatalogData]);

  // Synchronize location based on table selection
  useEffect(() => {
    if (selectedTable && !selectedLocationId) {
      const matchedLocation = selectedTable.locationId
        ? locations.find(loc => String(loc._id) === String(selectedTable.locationId))
        : locations.find(loc => loc.name === selectedTable.location) || null;
      if (matchedLocation) {
        setSelectedLocationId(String(matchedLocation._id));
      }
    }
  }, [locations, selectedLocationId, selectedTable]);

  // Cancel/Reset Scan Flow
  const handleCancelScan = () => {
    if (verifyAbortControllerRef.current) {
      verifyAbortControllerRef.current.abort();
    }
    setCodeInput('');
    setParsedOrder(null);
    setIsReviewing(false);
    setIdempotencyKey('');
    setPaymentStatus('PENDING');
    setPaymentType('ONLINE');
    setError('');
    setSuccessMsg('');
    setFocusTrigger(prev => prev + 1);
  };

  // Move to review stage
  const enterReviewStage = () => {
    if (mode === 'manual') {
      if (!selectedTable) {
        setError('Please select a table first.');
        return;
      }
      if (manualLineItems.length === 0) {
        setError('Please add at least one menu item.');
        return;
      }
    } else {
      if (!parsedOrder) return;
    }

    setError('');
    setSuccessMsg('');

    // Generate idempotency key for retries
    if (!idempotencyKey) {
      const key = crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).substring(2) + Date.now().toString(36);
      setIdempotencyKey(key);
    }
    setIsReviewing(true);
  };

  // Submit Order from Review Screen
  const handleOrderConfirm = async () => {
    setIsSubmitting(true);
    setError('');
    setSuccessMsg('');

    try {
      if (mode === 'scan') {
        if (!parsedOrder) return;
        await submitOrder({
          tableName: parsedOrder.table,
          locationName: parsedOrder.location || null,
          tableId: parsedOrder.tableId || null,
          locationId: parsedOrder.locationId || null,
          items: parsedOrder.items,
          total: parsedOrder.total,
          paymentType,
          paymentStatus,
          source: 'CODE',
          id: parsedOrder._id,
          deviceId: parsedOrder.deviceId,
          customerIp: parsedOrder.customerIp,
          checkoutSessionId: parsedOrder.checkoutSessionId
        });

        setSuccessMsg(`Order for ${parsedOrder.table} verified and sent to Live KDS!`);
        setCodeInput('');
        setParsedOrder(null);
        setIsReviewing(false);
        setPaymentStatus('PENDING');
        setPaymentType('ONLINE');
        setFocusTrigger(prev => prev + 1);
      } else {
        if (!selectedTable) return;
        const payloadItems = manualLineItems.map(item => ({
          id: item.id || item._id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
        }));

        await submitOrder({
          tableName: selectedTable.name || `Table ${selectedTable.number}`,
          locationName: selectedLocation?.name || selectedTable.location || null,
          tableId: selectedTable._id,
          locationId: selectedLocation?._id || null,
          items: payloadItems,
          total: manualTotal,
          paymentType,
          paymentStatus,
          source: 'MANUAL',
          idempotencyKey
        });

        setSuccessMsg(`Manual order created for ${selectedTable.name || `Table ${selectedTable.number}`} and sent to Live KDS!`);
        clearManualOrder();
        setIsReviewing(false);
        setIdempotencyKey('');
        setPaymentStatus('PENDING');
        setPaymentType('ONLINE');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto py-4 md:py-8 px-2 md:px-0 flex flex-col gap-4 md:gap-6">
      <div className="bg-surface-container rounded-2xl border border-outline-variant/20 shadow-lg overflow-hidden">
        <div className="p-3.5 md:p-8 border-b border-outline-variant/10 bg-surface-container-low">
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

            <div className="w-full lg:w-auto h-11 flex items-center bg-surface-container-high rounded-xl p-1 border border-outline-variant/20">
              <button
                type="button"
                onClick={() => {
                  setMode('scan');
                  setIsReviewing(false);
                  setError('');
                  setSuccessMsg('');
                }}
                disabled={isSubmitting}
                className={`h-full flex-1 lg:flex-initial px-4 flex items-center justify-center rounded-lg font-label-caps text-[10px] md:text-[11px] uppercase tracking-widest transition-colors cursor-pointer ${
                  mode === 'scan'
                    ? 'bg-primary text-on-primary shadow-lg font-semibold'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Code Verification
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('manual');
                  setIsReviewing(false);
                  setError('');
                  setSuccessMsg('');
                }}
                disabled={isSubmitting || (catalogError && tables.length === 0)}
                className={`h-full flex-1 lg:flex-initial px-4 flex items-center justify-center rounded-lg font-label-caps text-[10px] md:text-[11px] uppercase tracking-widest transition-colors cursor-pointer ${
                  mode === 'manual'
                    ? 'bg-primary text-on-primary shadow-lg font-semibold'
                    : 'text-on-surface-variant hover:text-on-surface'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                Manual Order
              </button>
            </div>
          </div>
        </div>

        <div className="p-3.5 md:p-8 flex flex-col gap-4 md:gap-6">
          <OrderStatusMessage successMsg={successMsg} errorMsg={error || catalogError} />

          {/* Simple Statistics Header */}
          <div className="grid grid-cols-3 gap-3 md:gap-4">
            <div className="bg-surface-container-lowest border border-outline-variant/15 rounded-xl md:rounded-2xl p-3 md:p-4">
              <span className="font-label-caps text-[9px] md:text-[10px] text-on-surface-variant uppercase tracking-widest block truncate">Tables</span>
              <div className="mt-1 md:mt-2 text-xl md:text-2xl font-headline-sm text-on-surface">{catalogLoading ? '...' : tables.length}</div>
            </div>
            <div className="bg-surface-container-lowest border border-outline-variant/15 rounded-xl md:rounded-2xl p-3 md:p-4">
              <span className="font-label-caps text-[9px] md:text-[10px] text-on-surface-variant uppercase tracking-widest block truncate">Locations</span>
              <div className="mt-1 md:mt-2 text-xl md:text-2xl font-headline-sm text-on-surface">{catalogLoading ? '...' : locations.length}</div>
            </div>
            <div className="bg-surface-container-lowest border border-outline-variant/15 rounded-xl md:rounded-2xl p-3 md:p-4">
              <span className="font-label-caps text-[9px] md:text-[10px] text-on-surface-variant uppercase tracking-widest block truncate">Items</span>
              <div className="mt-1 md:mt-2 text-xl md:text-2xl font-headline-sm text-on-surface">{catalogLoading ? '...' : menuItems.length}</div>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {isReviewing ? (
              <OrderReview
                key="review"
                table={mode === 'scan' ? parsedOrder?.table : (selectedTable?.name || `Table ${selectedTable?.number}`)}
                location={mode === 'scan' ? parsedOrder?.location : (selectedLocation?.name || selectedTable?.location)}
                items={mode === 'scan' ? parsedOrder?.items : manualLineItems}
                total={mode === 'scan' ? parsedOrder?.total : manualTotal}
                paymentType={paymentType}
                setPaymentType={setPaymentType}
                paymentStatus={paymentStatus}
                setPaymentStatus={setPaymentStatus}
                source={mode === 'scan' ? 'CODE' : 'MANUAL'}
                isSubmitting={isSubmitting}
                onBack={() => setIsReviewing(false)}
                onConfirm={handleOrderConfirm}
              />
            ) : mode === 'scan' ? (
              <ScanOrderPanel
                key="scan"
                codeInput={codeInput}
                setCodeInput={setCodeInput}
                parsedOrder={parsedOrder}
                isVerifying={isVerifying}
                isSubmitting={isSubmitting}
                onVerify={handleCodeVerify}
                onCancel={handleCancelScan}
                onReview={enterReviewStage}
                paymentType={paymentType}
                setPaymentType={setPaymentType}
                paymentStatus={paymentStatus}
                setPaymentStatus={setPaymentStatus}
                focusTrigger={focusTrigger}
              />
            ) : (
              <div key="manual" className="flex flex-col-reverse xl:grid xl:grid-cols-[1.1fr_0.9fr] gap-6">
                <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-3.5 md:p-6 flex flex-col gap-3.5 md:gap-5">
                  <ManualOrderBuilder
                    tables={filteredTables}
                    locations={locations}
                    selectedTableId={selectedTableId}
                    selectedLocationId={selectedLocationId}
                    selectedTable={selectedTable}
                    selectedLocation={selectedLocation}
                    manualItemCount={manualItemCount}
                    selectTable={selectTable}
                    setSelectedLocationId={setSelectedLocationId}
                    clearManualOrder={clearManualOrder}
                    getTableDisplayLabel={getTableDisplayLabel}
                    getTableSortKey={getTableSortKey}
                  />

                  <div className="border-t border-outline-variant/15 pt-5">
                    <MenuItemPicker
                      menuItems={menuItems}
                      manualSearch={manualSearch}
                      setManualSearch={setManualSearch}
                      manualOrderItems={manualOrderItems}
                      setItemQuantity={setItemQuantity}
                      catalogLoading={catalogLoading}
                      catalogError={catalogError}
                      onRetryCatalog={loadCatalogData}
                    />
                  </div>
                </div>

                <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-3.5 md:p-6">
                  <ManualOrderSummary
                    selectedTable={selectedTable}
                    selectedLocation={selectedLocation}
                    manualItemCount={manualItemCount}
                    manualTotal={manualTotal}
                    manualLineItems={manualLineItems}
                    onReview={enterReviewStage}
                    isSubmitting={isSubmitting}
                  />
                </div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

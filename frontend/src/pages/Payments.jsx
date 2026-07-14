import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { API_BASE } from '../config';
import { useScrollLock } from '../hooks/useScrollLock';
import {
  buildSinglePaymentReceiptData,
  generateSinglePaymentReceiptHtml,
  buildFilteredPaymentReportData,
  generatePaymentReportHtml,
  openPrintableDocument
} from '../utils/paymentDocumentHelper';

// Money formatting and numeric extraction helpers
const getFoodSubtotal = (order) => {
  const val = parseFloat(order?.total);
  return isFinite(val) ? val : 0;
};

const getConvenienceFee = (order) => {
  const val = parseFloat(order?.convenienceFee);
  return isFinite(val) ? val : 0;
};

const getCustomerPaidAmount = (order) => {
  if (!order) return 0;
  const rawAmount = order.totalPayable ?? order.total;
  const amount = parseFloat(rawAmount);
  return isFinite(amount) ? amount : 0;
};

// Safe date helpers
const getPaymentDate = (order) => {
  if (!order) return null;
  const isPaid = order.paymentStatus === 'PAID';
  const rawDate = (isPaid && order.paidAt) ? order.paidAt : order.createdAt;
  if (!rawDate) return null;
  const d = new Date(rawDate);
  return isNaN(d.getTime()) ? null : d;
};

const getLocalISODateString = (date) => {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - (offset * 60 * 1000));
  return localDate.toISOString().split('T')[0];
};

const getDateRangeBounds = (range, customStart, customEnd) => {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

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
        const dStart = new Date(customStart);
        dStart.setHours(0, 0, 0, 0);
        start.setTime(dStart.getTime());
      } else {
        start.setHours(0, 0, 0, 0);
      }
      if (customEnd) {
        const dEnd = new Date(customEnd);
        dEnd.setHours(23, 59, 59, 999);
        end.setTime(dEnd.getTime());
      } else {
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

const isOrderWithinRange = (order, start, end) => {
  const pDate = getPaymentDate(order);
  if (!pDate) return false;
  return pDate >= start && pDate <= end;
};

const calculateGrowth = (current, previous) => {
  if (previous === 0) {
    return current > 0 ? { label: 'New activity', type: 'new' } : { label: 'No change', type: 'none' };
  }
  const pct = ((current - previous) / previous) * 100;
  return {
    label: `${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct).toFixed(1)}% vs yesterday`,
    type: pct >= 0 ? 'up' : 'down'
  };
};

const renderPaymentMethodBadge = (type) => {
  const t = type || 'UNKNOWN';
  let label = 'Method';
  let style = 'bg-surface-container-high border-outline-variant/30 text-on-surface-variant/80';

  if (t === 'RAZORPAY' || t === 'ONLINE' || t === 'NOW') {
    label = 'Razorpay';
    style = 'bg-primary/10 border-primary/20 text-primary';
  } else if (t === 'LATER') {
    label = 'Pay Later';
    style = 'bg-yellow-500/10 border-yellow-500/20 text-yellow-600 dark:text-yellow-400';
  } else if (t === 'UPI') {
    label = 'UPI';
    style = 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400';
  } else {
    label = t;
  }

  return (
    <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${style}`}>
      {label}
    </span>
  );
};

const renderPaymentStatusBadge = (status) => {
  const isPaid = status === 'PAID';
  const style = isPaid 
    ? 'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400' 
    : 'bg-primary/10 border-primary/20 text-primary animate-pulse';
  return (
    <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${style}`}>
      {status || 'PENDING'}
    </span>
  );
};

const getItemSummary = (items) => {
  if (!items || items.length === 0) return 'No items';
  const firstItems = items.slice(0, 2);
  const formatted = firstItems.map(item => `${item.quantity}× ${item.name || 'Item'}`).join(', ');
  if (items.length > 2) {
    const remaining = items.length - 2;
    return `${formatted} +${remaining} more`;
  }
  return formatted;
};

export default function Payments({ refreshKey }) {
  const [paymentOrders, setPaymentOrders] = useState([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [paymentsSearch, setPaymentsSearch] = useState('');
  const [paymentsStatusFilter, setPaymentsStatusFilter] = useState('ALL'); // ALL, PAID, PENDING
  const [paymentsTypeFilter, setPaymentsTypeFilter] = useState('ALL'); // ALL, ONLINE, CASH
  
  // Date Presets and Custom Ranges
  const [paymentsTimeRange, setPaymentsTimeRange] = useState('7d'); // today, yesterday, 7d, 30d, this_month, custom
  const [paymentsCustomStartDate, setPaymentsCustomStartDate] = useState(() => getLocalISODateString(new Date()));
  const [paymentsCustomEndDate, setPaymentsCustomEndDate] = useState(() => getLocalISODateString(new Date()));
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [paymentsLastFetchedAt, setPaymentsLastFetchedAt] = useState(new Date());
  const [paymentsError, setPaymentsError] = useState(false);
  const [isPaymentsRefreshing, setIsPaymentsRefreshing] = useState(false);
  const [copyStatus, setCopyStatus] = useState({});
  const [isGeneratingReceipt, setIsGeneratingReceipt] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [restaurantName, setRestaurantName] = useState(''); // ponytail: fetched once from settings

  const paymentsRequestIdRef = useRef(0);
  const paymentsInFlightRef = useRef(false);
  const paymentsAbortControllerRef = useRef(null);

  // Fetch Payment orders (concurrency-hardened)
  const fetchAllOrders = useCallback(async (isManual = false) => {
    if (paymentsInFlightRef.current) {
      return; // Skip if already fetching
    }

    paymentsInFlightRef.current = true;
    if (isManual) {
      setIsPaymentsRefreshing(true);
    } else {
      setPaymentsLoading(true);
    }

    paymentsRequestIdRef.current += 1;
    const requestId = paymentsRequestIdRef.current;

    // Abort previous incomplete request if starting a manual refresh
    if (isManual && paymentsAbortControllerRef.current) {
      paymentsAbortControllerRef.current.abort();
    }

    const controller = new AbortController();
    paymentsAbortControllerRef.current = controller;

    try {
      // ponytail: add cache-busting timestamp to prevent browser from returning stale cached GET responses
      const res = await fetch(`${API_BASE}/api/orders?_=${Date.now()}`, {
        credentials: 'include',
        signal: controller.signal
      });
      if (res.ok) {
        const data = await res.json();
        if (paymentsRequestIdRef.current === requestId) {
          setPaymentOrders(data);
          setPaymentsLastFetchedAt(new Date());
          setPaymentsError(false);
        }
      } else {
        if (paymentsRequestIdRef.current === requestId) {
          setPaymentsError(true);
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error(e);
        if (paymentsRequestIdRef.current === requestId) {
          setPaymentsError(true);
        }
      }
    } finally {
      if (paymentsRequestIdRef.current === requestId) {
        paymentsInFlightRef.current = false;
        setPaymentsLoading(false);
        setIsPaymentsRefreshing(false);
      }
    }
  }, []);

  // Initial and reactive fetches (triggered on refreshKey or timeRange updates)
  useEffect(() => {
    fetchAllOrders(false);
  }, [refreshKey, fetchAllOrders]);

  // ponytail: fetch restaurant name once for print headers
  useEffect(() => {
    fetch(API_BASE + '/api/settings/restaurant-profile')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.restaurantName) setRestaurantName(d.restaurantName); })
      .catch(() => {});
  }, []);

  // Cleanup payment requests on unmount
  useEffect(() => {
    return () => {
      // ponytail: do not abort on unmount to avoid strict-mode abort issues in development
    };
  }, []);

  // Payments freshness display tick (30s)
  const [secondsSincePaymentsUpdate, setSecondsSincePaymentsUpdate] = useState(0);
  useEffect(() => {
    setSecondsSincePaymentsUpdate(0);
    const timer = setInterval(() => {
      setSecondsSincePaymentsUpdate(prev => prev + 30);
    }, 30000);
    return () => clearInterval(timer);
  }, [paymentsLastFetchedAt]);

  // selectedOrder derived from selectedOrderId in real-time
  const selectedOrder = useMemo(() => {
    if (!selectedOrderId) return null;
    return paymentOrders.find(o => o._id === selectedOrderId) || null;
  }, [selectedOrderId, paymentOrders]);

  // Drawer accessibility & scroll lock
  useScrollLock(!!selectedOrderId);
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setSelectedOrderId(null);
      }
    };
    if (selectedOrderId) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedOrderId]);

  const handleCopy = useCallback((text, key) => {
    if (!text) return;
    navigator.clipboard.writeText(text)
      .then(() => {
        setCopyStatus(prev => ({ ...prev, [key]: true }));
        setTimeout(() => {
          setCopyStatus(prev => ({ ...prev, [key]: false }));
        }, 2000);
      })
      .catch(err => console.error('Failed to copy text:', err));
  }, []);

  const handlePrintReceipt = useCallback((order) => {
    if (isGeneratingReceipt) return;
    // ponytail: open window synchronously before any data work to avoid popup blocking
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('The print preview was blocked. Allow pop-ups for Aurum OS and try again.');
      return;
    }
    setIsGeneratingReceipt(true);
    try {
      const receiptData = buildSinglePaymentReceiptData(order);
      if (!receiptData) {
        printWindow.close();
        alert('Unable to generate receipt. Only paid orders can produce receipts.');
        return;
      }
      const html = generateSinglePaymentReceiptHtml(receiptData);
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.document.title = 'Payment Receipt';
      if (printWindow.document.readyState === 'complete') {
        printWindow.print();
      } else {
        printWindow.addEventListener('load', () => printWindow.print());
      }
      // ponytail: intentionally NOT closing — user closes after print/save
    } catch (err) {
      console.error('Receipt generation failed:', err.message);
      alert('Failed to generate the receipt. Please try again.');
    } finally {
      setIsGeneratingReceipt(false);
    }
  }, [isGeneratingReceipt]);

  const handleMarkAsPaid = async (orderId) => {
    // ponytail: optimistic UI updates for instant verification change feedback in payments list
    const prevPaymentOrders = [...paymentOrders];
    setPaymentOrders(prev => prev.map(o => o._id === orderId ? { ...o, paymentStatus: 'PAID' } : o));

    try {
      const res = await fetch(`${API_BASE}/api/orders/${orderId}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentStatus: 'PAID' }),
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Failed to update payment');
      fetchAllOrders(); // fetch latest server state immediately
    } catch (e) {
      console.error(e);
      setPaymentOrders(prevPaymentOrders);
      alert('Failed to update payment status.');
    }
  };

  // Payments pipeline calculations
  const dateBounds = useMemo(() => {
    return getDateRangeBounds(paymentsTimeRange, paymentsCustomStartDate, paymentsCustomEndDate);
  }, [paymentsTimeRange, paymentsCustomStartDate, paymentsCustomEndDate]);

  // Centralized filter pipeline
  const filteredPaymentOrders = useMemo(() => {
    if (paymentsTimeRange === 'custom') {
      const start = new Date(paymentsCustomStartDate);
      const end = new Date(paymentsCustomEndDate);
      if (start > end) {
        return [];
      }
    }

    const { start, end } = dateBounds;

    return paymentOrders.filter(order => {
      // 1. Date Range Filter
      if (!isOrderWithinRange(order, start, end)) {
        return false;
      }

      // 2. Status Filter
      if (paymentsStatusFilter !== 'ALL' && order.paymentStatus !== paymentsStatusFilter) {
        return false;
      }

      // 3. Payment Method Filter
      if (paymentsTypeFilter !== 'ALL') {
        const type = String(order.paymentType || '').toUpperCase();

        if (paymentsTypeFilter === 'ONLINE') {
          const onlineTypes = ['RAZORPAY', 'ONLINE', 'NOW', 'UPI'];
          if (!onlineTypes.includes(type)) {
            return false;
          }
        }

        if (paymentsTypeFilter === 'CASH') {
          const cashTypes = ['CASH', 'LATER'];

          if (!cashTypes.includes(type)) {
            return false;
          }
        }
      }

      // 4. Case-insensitive Search Filter
      if (paymentsSearch) {
        const query = paymentsSearch.toLowerCase().trim();
        const shortId = order._id.toString().substring(18).toLowerCase();
        const fullId = order._id.toString().toLowerCase();
        const rzpPayId = (order.razorpayPaymentId || '').toLowerCase();
        const rzpOrdId = (order.razorpayOrderId || '').toLowerCase();
        const table = (order.table || '').toLowerCase();
        const items = order.items.map(item => `${item.quantity}x ${item.name}`).join(', ').toLowerCase();
        const method = (order.paymentType || '').toLowerCase();
        const status = (order.paymentStatus || '').toLowerCase();

        const matchesQuery = 
          shortId.includes(query) ||
          fullId.includes(query) ||
          rzpPayId.includes(query) ||
          rzpOrdId.includes(query) ||
          table.includes(query) ||
          items.includes(query) ||
          method.includes(query) ||
          status.includes(query);

        if (!matchesQuery) {
          return false;
        }
      }

      return true;
    });
  }, [paymentOrders, dateBounds, paymentsStatusFilter, paymentsTypeFilter, paymentsSearch, paymentsTimeRange, paymentsCustomStartDate, paymentsCustomEndDate]);

  const handlePrintReport = useCallback(() => {
    if (isGeneratingReport) return;
    // ponytail: open window synchronously before data work
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('The print preview was blocked. Allow pop-ups for Aurum OS and try again.');
      return;
    }
    setIsGeneratingReport(true);
    try {
      const activeFilters = {
        timeRange: paymentsTimeRange,
        customStartDate: paymentsCustomStartDate,
        customEndDate: paymentsCustomEndDate,
        statusFilter: paymentsStatusFilter,
        typeFilter: paymentsTypeFilter,
        search: paymentsSearch
      };
      const reportData = buildFilteredPaymentReportData(filteredPaymentOrders, activeFilters);
      if (!reportData) {
        printWindow.close();
        alert('Unable to generate the report. Please try again.');
        return;
      }
      const html = generatePaymentReportHtml(reportData, restaurantName || undefined);
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.document.title = 'Payment History Report';
      if (printWindow.document.readyState === 'complete') {
        printWindow.print();
      } else {
        printWindow.addEventListener('load', () => printWindow.print());
      }
    } catch (err) {
      console.error('Report generation failed:', err.message);
      alert('Failed to generate the report. Please try again.');
    } finally {
      setIsGeneratingReport(false);
    }
  }, [isGeneratingReport, filteredPaymentOrders, paymentsTimeRange, paymentsCustomStartDate, paymentsCustomEndDate, paymentsStatusFilter, paymentsTypeFilter, paymentsSearch, restaurantName]);

  // Pagination states
  const ITEMS_PER_PAGE = 25;
  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredPaymentOrders.length / ITEMS_PER_PAGE));
  }, [filteredPaymentOrders]);

  // Clamp paymentsPage if it exceeds totalPages
  useEffect(() => {
    if (paymentsPage > totalPages) {
      setPaymentsPage(totalPages);
    }
  }, [totalPages, paymentsPage]);

  // Reset pagination to page 1 on filter/search changes
  useEffect(() => {
    setPaymentsPage(1);
  }, [paymentsSearch, paymentsTimeRange, paymentsCustomStartDate, paymentsCustomEndDate, paymentsStatusFilter, paymentsTypeFilter]);

  const paginatedPaymentRows = useMemo(() => {
    const startIndex = (paymentsPage - 1) * ITEMS_PER_PAGE;
    return filteredPaymentOrders.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredPaymentOrders, paymentsPage]);

  // Payments summary card calculations
  const paymentsSummary = useMemo(() => {
    const todayBounds = getDateRangeBounds('today');
    const yesterdayBounds = getDateRangeBounds('yesterday');

    let todaySales = 0;
    let yesterdaySales = 0;
    let paidCount = 0;
    let pendingCount = 0;
    let onlineCount = 0;

    const { start, end } = dateBounds;

    paymentOrders.forEach(order => {
      const isPaid = order.paymentStatus === 'PAID';
      const isPending = order.paymentStatus === 'PENDING';

      if (isPaid && isOrderWithinRange(order, todayBounds.start, todayBounds.end)) {
        todaySales += getFoodSubtotal(order);
      }

      if (isPaid && isOrderWithinRange(order, yesterdayBounds.start, yesterdayBounds.end)) {
        yesterdaySales += getFoodSubtotal(order);
      }

      if (isOrderWithinRange(order, start, end)) {
        if (isPaid) {
          paidCount += 1;

          const type = order.paymentType || '';
          if (type === 'RAZORPAY' || type === 'ONLINE' || type === 'NOW') {
            onlineCount += 1;
          }
        }
        if (isPending) {
          pendingCount += 1;
        }
      }
    });

    const growth = calculateGrowth(todaySales, yesterdaySales);

    return {
      todaySales,
      growth,
      paidCount,
      pendingCount,
      onlineCount
    };
  }, [paymentOrders, dateBounds]);

  const showInitialLoading = paymentsLoading && paymentOrders.length === 0;

  const renderSkeletons = () => {
    return Array.from({ length: 8 }).map((_, i) => (
      <tr key={i} className="animate-pulse border-b border-outline-variant/10">
        <td className="py-4 px-4"><div className="h-4 bg-outline-variant/20 rounded w-16" /></td>
        <td className="py-4 px-4"><div className="h-4 bg-outline-variant/20 rounded w-24" /></td>
        <td className="py-4 px-4"><div className="h-4 bg-outline-variant/20 rounded w-20" /></td>
        <td className="py-4 px-4"><div className="h-4 bg-outline-variant/20 rounded w-48" /></td>
        <td className="py-4 px-4"><div className="h-4 bg-outline-variant/20 rounded w-16" /></td>
        <td className="py-4 px-4"><div className="h-4 bg-outline-variant/20 rounded w-20" /></td>
        <td className="py-4 px-4"><div className="h-4 bg-outline-variant/20 rounded w-16" /></td>
        <td className="py-4 px-4 text-right"><div className="h-8 bg-outline-variant/20 rounded w-24 ml-auto" /></td>
      </tr>
    ));
  };

  const renderMobileSkeletons = () => {
    return Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="animate-pulse bg-surface-container-low border border-outline-variant/20 rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex justify-between">
          <div className="h-5 bg-outline-variant/20 rounded w-32" />
          <div className="h-5 bg-outline-variant/20 rounded w-16" />
        </div>
        <div className="h-10 bg-outline-variant/20 rounded w-full" />
        <div className="flex justify-between mt-2">
          <div className="h-5 bg-outline-variant/20 rounded w-20" />
          <div className="h-8 bg-outline-variant/20 rounded w-24" />
        </div>
      </div>
    ));
  };

  const getFreshnessText = () => {
    if (secondsSincePaymentsUpdate < 30) {
      return 'Updated just now';
    }
    if (secondsSincePaymentsUpdate < 60) {
      return 'Updated 30 seconds ago';
    }
    const mins = Math.floor(secondsSincePaymentsUpdate / 60);
    return `Updated ${mins} minute${mins > 1 ? 's' : ''} ago`;
  };

  return (
    <div className="space-y-6">
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in {
          animation: slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>

      {/* Header Section */}
      <div className="bg-surface-container rounded-2xl border border-outline-variant/20 shadow-lg overflow-hidden select-none text-left">
        <div className="p-6 md:p-8 border-b border-outline-variant/10 flex flex-col md:flex-row justify-between md:items-center gap-4 bg-surface-container-low">
          <div>
            <h2 className="font-headline-md text-2xl text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">payments</span>
              Payments Dashboard
            </h2>
            <p className="font-body-md text-on-surface-variant mt-1">
              Verify customer transactions and manage payments.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-on-surface-variant/70 font-semibold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              {getFreshnessText()}
            </span>
            <button
              onClick={() => fetchAllOrders(true)}
              disabled={isPaymentsRefreshing}
              aria-label="Refresh payments data"
              className="bg-primary/10 hover:bg-primary text-primary hover:text-on-primary border border-primary/30 px-3 py-1.5 rounded-xl font-semibold text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1"
            >
              <span className={`material-symbols-outlined text-sm ${isPaymentsRefreshing ? 'animate-spin' : ''}`}>
                refresh
              </span>
              {isPaymentsRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Retry banner on fail */}
        {paymentsError && (
          <div className="mx-6 md:mx-8 mt-4 bg-error/10 border border-error/20 text-error px-4 py-3 rounded-xl flex items-center justify-between text-xs font-semibold">
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base">error</span>
              Failed to fetch live updates. Displaying cached dashboard data.
            </span>
            <button
              onClick={() => fetchAllOrders(true)}
              className="bg-error/20 hover:bg-error/30 text-error border border-error/30 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Payment Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 px-6 md:px-8 pt-6 pb-2">
          {/* Card 1: Today's Food Sales */}
          <div className="bg-surface-container-low border border-outline-variant/10 rounded-2xl p-4 flex flex-col justify-between shadow-sm">
            <div>
              <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block font-semibold">Today's Food Sales</span>
              <span className="font-price-display text-primary font-bold text-2xl mt-1 block">
                ₹{paymentsSummary.todaySales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1">
              {paymentsSummary.growth.type === 'up' && (
                <span className="material-symbols-outlined text-green-500 text-sm">trending_up</span>
              )}
              {paymentsSummary.growth.type === 'down' && (
                <span className="material-symbols-outlined text-error text-sm">trending_down</span>
              )}
              <span className={`text-xs font-semibold ${
                paymentsSummary.growth.type === 'up' ? 'text-green-500' :
                paymentsSummary.growth.type === 'down' ? 'text-error' : 'text-on-surface-variant/60'
              }`}>
                {paymentsSummary.growth.label}
              </span>
            </div>
          </div>

          {/* Card 2: Paid Orders */}
          <div className="bg-surface-container-low border border-outline-variant/10 rounded-2xl p-4 flex flex-col justify-between shadow-sm">
            <div>
              <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block font-semibold">Paid Orders</span>
              <span className="text-on-surface font-bold text-2xl mt-1 block">
                {paymentsSummary.paidCount}
              </span>
            </div>
            <div className="text-xs text-on-surface-variant/60 mt-2 font-medium">
              In selected range
            </div>
          </div>

          {/* Card 3: Pending Payments */}
          <div className="bg-surface-container-low border border-outline-variant/10 rounded-2xl p-4 flex flex-col justify-between shadow-sm">
            <div>
              <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block font-semibold">Pending Payments</span>
              <span className="text-on-surface font-bold text-2xl mt-1 block">
                {paymentsSummary.pendingCount}
              </span>
            </div>
            <div className="text-xs text-on-surface-variant/60 mt-2 font-medium">
              In selected range
            </div>
          </div>

          {/* Card 4: Online Payments */}
          <div className="bg-surface-container-low border border-outline-variant/10 rounded-2xl p-4 flex flex-col justify-between shadow-sm">
            <div>
              <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block font-semibold">Online Payments</span>
              <span className="text-on-surface font-bold text-2xl mt-1 block">
                {paymentsSummary.onlineCount}
              </span>
            </div>
            <div className="text-xs text-on-surface-variant/60 mt-2 font-medium">
              In selected range
            </div>
          </div>
        </div>

        {/* Search and Filters Toolbar */}
        <div className="px-6 md:px-8 py-4 bg-surface-container-low border-b border-t border-outline-variant/10 flex flex-wrap gap-4 items-center mt-4">
          <div className="relative min-w-[240px] flex-1">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/70 text-sm">search</span>
            <input 
              type="text" 
              placeholder="Search ID, table, items, payment..." 
              value={paymentsSearch}
              onChange={(e) => setPaymentsSearch(e.target.value)}
              className="w-full bg-surface-container-lowest border border-outline-variant/30 text-on-surface pl-9 pr-4 py-2 rounded-xl focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors font-body-md text-sm placeholder-on-surface-variant/40"
            />
            {paymentsSearch && (
              <button onClick={() => setPaymentsSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant/70 hover:text-on-surface flex items-center cursor-pointer">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest font-semibold">Status:</span>
            <div className="flex bg-surface-container-highest/40 rounded-xl p-0.5 border border-outline-variant/20">
              {['ALL', 'PAID', 'PENDING'].map(status => (
                <button
                  key={status}
                  onClick={() => setPaymentsStatusFilter(status)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-label-caps uppercase tracking-wider font-semibold transition-all cursor-pointer ${
                    paymentsStatusFilter === status
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-on-surface-variant/80 hover:text-on-surface'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest font-semibold">Method:</span>
            <div className="flex bg-surface-container-highest/40 rounded-xl p-0.5 border border-outline-variant/20">
              {[
                { value: 'ALL', label: 'All' },
                { value: 'ONLINE', label: 'Online' },
                { value: 'CASH', label: 'Cash' }
              ].map(type => (
                <button
                  key={type.value}
                  onClick={() => setPaymentsTypeFilter(type.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-label-caps uppercase tracking-wider font-semibold transition-all cursor-pointer ${
                    paymentsTypeFilter === type.value
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-on-surface-variant/80 hover:text-on-surface'
                  }`}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest font-semibold">Range:</span>
            <div className="flex flex-wrap bg-surface-container-highest/40 rounded-xl p-0.5 border border-outline-variant/20 gap-0.5">
              {[
                { value: 'today', label: 'Today' },
                { value: 'yesterday', label: 'Yesterday' },
                { value: '7d', label: '7D' },
                { value: '30d', label: '30D' },
                { value: 'this_month', label: 'Month' },
                { value: 'custom', label: 'Custom' }
              ].map(preset => (
                <button
                  key={preset.value}
                  onClick={() => setPaymentsTimeRange(preset.value)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    paymentsTimeRange === preset.value
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-on-surface-variant/80 hover:text-on-surface'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={handlePrintReport}
            disabled={isGeneratingReport || filteredPaymentOrders.length === 0}
            aria-label="Print or save payment history report"
            className="bg-primary/10 hover:bg-primary text-primary hover:text-on-primary border border-primary/30 px-3 py-1.5 rounded-xl font-semibold text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1 whitespace-nowrap"
          >
            <span className={`material-symbols-outlined text-sm ${isGeneratingReport ? 'animate-spin' : ''}`}>
              {isGeneratingReport ? 'progress_activity' : 'print'}
            </span>
            {isGeneratingReport ? 'Generating...' : 'Print / Save Report'}
          </button>
        </div>

        {/* Custom Date Pickers */}
        {paymentsTimeRange === 'custom' && (
          <div className="px-6 md:px-8 py-3 bg-surface-container-low border-b border-outline-variant/10 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label htmlFor="custom-start-date" className="text-xs font-semibold text-on-surface-variant">Start:</label>
              <input
                id="custom-start-date"
                type="date"
                value={paymentsCustomStartDate}
                onChange={(e) => setPaymentsCustomStartDate(e.target.value)}
                className="bg-surface-container-lowest border border-outline-variant/30 text-on-surface px-3 py-1 rounded-lg text-xs outline-none focus:border-primary"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="custom-end-date" className="text-xs font-semibold text-on-surface-variant">End:</label>
              <input
                id="custom-end-date"
                type="date"
                value={paymentsCustomEndDate}
                onChange={(e) => setPaymentsCustomEndDate(e.target.value)}
                className="bg-surface-container-lowest border border-outline-variant/30 text-on-surface px-3 py-1 rounded-lg text-xs outline-none focus:border-primary"
              />
            </div>
            {new Date(paymentsCustomStartDate) > new Date(paymentsCustomEndDate) && (
              <span className="text-xs text-error font-medium flex items-center gap-1 animate-pulse">
                <span className="material-symbols-outlined text-sm">warning</span>
                Start date cannot be after end date
              </span>
            )}
          </div>
        )}

        {/* Table & Content Area */}
        <div className="p-6 md:p-8 overflow-x-auto">
          {showInitialLoading ? (
            <div className="hidden md:block">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-outline-variant/20 text-on-surface-variant font-label-caps text-[11px] uppercase tracking-widest bg-surface-container-lowest/50">
                    <th className="py-3 px-4">Order ID</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Table</th>
                    <th className="py-3 px-4">Items Summary</th>
                    <th className="py-3 px-4">Amount</th>
                    <th className="py-3 px-4">Payment Method</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {renderSkeletons()}
                </tbody>
              </table>
            </div>
          ) : paymentOrders.length === 0 ? (
            <div className="text-center py-16 text-on-surface-variant/60 flex flex-col items-center gap-2">
              <span className="material-symbols-outlined text-5xl">receipt</span>
              <p className="font-title-md">No payment records yet</p>
              <p className="font-body-sm">Payment records will appear after customer orders are created.</p>
            </div>
          ) : filteredPaymentOrders.length === 0 ? (
            <div className="text-center py-16 text-on-surface-variant/60 flex flex-col items-center gap-2">
              <span className="material-symbols-outlined text-5xl">search_off</span>
              <p className="font-title-md">No matching payments</p>
              <p className="font-body-sm">Try changing the date range, filters, or search terms.</p>
            </div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant/20 text-on-surface-variant font-label-caps text-[11px] uppercase tracking-widest bg-surface-container-lowest/50">
                      <th className="py-3 px-4">Order ID</th>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Table</th>
                      <th className="py-3 px-4">Items Summary</th>
                      <th className="py-3 px-4">Customer Paid</th>
                      <th className="py-3 px-4">Payment Method</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10">
                    {paginatedPaymentRows.map((order) => {
                      const payDate = getPaymentDate(order);
                      const dateStr = payDate ? payDate.toLocaleString(undefined, {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                      }) : 'N/A';
                      const itemsSummary = getItemSummary(order.items);
                      const itemsText = order.items.map(item => `${item.quantity}x ${item.name}`).join(', ');

                      const foodTotal = getFoodSubtotal(order);
                      const fee = getConvenienceFee(order);
                      const totalPaid = getCustomerPaidAmount(order);
                      
                      return (
                        <tr 
                          key={order._id} 
                          tabIndex={0}
                          onClick={() => setSelectedOrderId(order._id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedOrderId(order._id);
                            }
                          }}
                          className="hover:bg-surface-container-lowest/30 transition-colors cursor-pointer focus:bg-surface-container-lowest/40 focus:outline-none"
                        >
                          <td className="py-3.5 px-4 font-mono text-primary font-bold text-sm tracking-wide">
                            #{order._id.toString().substring(18)}
                          </td>
                          <td className="py-3.5 px-4 font-body-sm text-on-surface-variant whitespace-nowrap">{dateStr}</td>
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-primary text-sm">table_restaurant</span>
                              <span className="font-semibold text-primary">{order.table}</span>
                            </div>
                            {order.location && (
                              <span className="text-[11px] text-on-surface-variant font-normal block mt-0.5 pl-6">📍 {order.location}</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 max-w-xs truncate text-on-surface-variant" title={itemsText}>{itemsSummary}</td>
                          <td className="py-3.5 px-4">
                            <div className="flex flex-col">
                              <span className="font-price-display text-primary font-bold">₹{totalPaid.toFixed(2)}</span>
                              {fee > 0 && (
                                <span className="text-[10px] text-on-surface-variant/70 block mt-0.5">
                                  Food ₹{foodTotal.toFixed(0)} · Fee ₹{fee.toFixed(0)}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3.5 px-4">
                            {renderPaymentMethodBadge(order.paymentType)}
                          </td>
                          <td className="py-3.5 px-4">
                            {renderPaymentStatusBadge(order.paymentStatus)}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedOrderId(order._id);
                                }}
                                className="text-on-surface-variant hover:text-primary transition-all p-1.5 hover:bg-surface-container-high rounded-lg cursor-pointer"
                                aria-label="View payment details"
                              >
                                <span className="material-symbols-outlined text-base">visibility</span>
                              </button>
                              {order.paymentStatus === 'PENDING' && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMarkAsPaid(order._id);
                                  }}
                                  className="bg-primary/10 hover:bg-primary text-primary hover:text-on-primary border border-primary/30 px-3 py-1.5 rounded-lg font-label-caps text-[10px] uppercase tracking-wider transition-all cursor-pointer font-semibold inline-flex items-center gap-1"
                                >
                                  <span className="material-symbols-outlined text-[12px]">check</span>
                                  Verify Paid
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card List View */}
              <div className="block md:hidden space-y-4">
                {showInitialLoading ? renderMobileSkeletons() : paginatedPaymentRows.map((order) => {
                  const payDate = getPaymentDate(order);
                  const dateStr = payDate ? payDate.toLocaleString(undefined, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                  }) : 'N/A';
                  const itemsSummary = getItemSummary(order.items);
                  const itemsText = order.items.map(item => `${item.quantity}x ${item.name}`).join(', ');

                  const totalPaid = getCustomerPaidAmount(order);
                  const foodTotal = getFoodSubtotal(order);
                  const fee = getConvenienceFee(order);
                  
                  return (
                    <div 
                      key={order._id} 
                      tabIndex={0}
                      onClick={() => setSelectedOrderId(order._id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedOrderId(order._id);
                        }
                      }}
                      className="bg-surface-container-low border border-outline-variant/20 rounded-2xl p-4 flex flex-col gap-3 shadow-md cursor-pointer hover:bg-surface-container-highest/20 transition-all focus:bg-surface-container-highest/20 focus:outline-none"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="material-symbols-outlined text-primary text-base">table_restaurant</span>
                            <span className="font-headline-sm text-base text-primary font-bold">{order.table}</span>
                            <span className="font-mono text-xs text-primary font-bold bg-primary/10 border border-primary/20 rounded px-1.5 py-0.5 ml-1">
                              #{order._id.toString().substring(18)}
                            </span>
                          </div>
                          {order.location && (
                            <span className="text-xs text-on-surface-variant font-normal block mt-0.5">📍 {order.location}</span>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="text-xs text-on-surface-variant/60 block font-mono">{dateStr}</span>
                          <span className="font-price-display text-primary font-bold text-base mt-0.5 block">₹{totalPaid.toFixed(2)}</span>
                          {fee > 0 && (
                            <span className="text-[9px] text-on-surface-variant/60 block mt-0.5">
                              Food ₹{foodTotal.toFixed(0)} · Fee ₹{fee.toFixed(0)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="bg-surface-container-lowest/60 border border-outline-variant/10 rounded-xl p-2.5 text-xs text-on-surface-variant/80">
                        <strong className="text-on-surface font-semibold block mb-1">Items Summary:</strong>
                        <div className="line-clamp-2 leading-relaxed" title={itemsText}>{itemsSummary}</div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-outline-variant/10">
                        <div className="flex gap-1.5 items-center">
                          {renderPaymentMethodBadge(order.paymentType)}
                          {renderPaymentStatusBadge(order.paymentStatus)}
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedOrderId(order._id);
                            }}
                            className="text-on-surface-variant hover:text-primary transition-all p-1.5 hover:bg-surface-container-high rounded-lg cursor-pointer flex items-center justify-center border border-outline-variant/20 bg-surface-container-lowest"
                            aria-label="View payment details"
                          >
                            <span className="material-symbols-outlined text-sm">visibility</span>
                          </button>
                          {order.paymentStatus === 'PENDING' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMarkAsPaid(order._id);
                              }}
                              className="bg-primary text-on-primary hover:opacity-90 px-3.5 py-2 rounded-xl font-label-caps text-[11px] uppercase tracking-wider font-bold transition-all cursor-pointer inline-flex items-center gap-1 shadow-md hover:shadow-primary/20"
                            >
                              <span className="material-symbols-outlined text-[13px]">check</span>
                              Verify Paid
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination Controls */}
              <div className="px-6 md:px-8 py-4 border-t border-outline-variant/10 flex items-center justify-between gap-4 bg-surface-container-low mt-4 rounded-b-2xl">
                <span className="text-xs text-on-surface-variant font-semibold">
                  Page {paymentsPage} of {totalPages} ({filteredPaymentOrders.length} records)
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPaymentsPage(prev => Math.max(1, prev - 1))}
                    disabled={paymentsPage === 1}
                    className="px-3 py-1.5 rounded-xl border border-outline-variant/30 text-xs font-semibold bg-surface-container-lowest text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-0.5"
                  >
                    <span className="material-symbols-outlined text-sm">chevron_left</span>
                    Prev
                  </button>
                  <button
                    onClick={() => setPaymentsPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={paymentsPage === totalPages}
                    className="px-3 py-1.5 rounded-xl border border-outline-variant/30 text-xs font-semibold bg-surface-container-lowest text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-0.5"
                  >
                    Next
                    <span className="material-symbols-outlined text-sm">chevron_right</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right-Side Sliding Payment Details Drawer */}
      <AnimatePresence>
        {selectedOrder && (
          <div 
            onClick={() => setSelectedOrderId(null)}
            className="app-overlay-backdrop bg-black/50 transition-opacity fixed inset-0 z-50 md:left-[280px]"
          >
            {/* Drawer Dialog Container */}
            <aside 
              role="dialog"
              aria-modal="true"
              aria-label="Payment Details"
              onClick={(e) => e.stopPropagation()}
              className="app-drawer-panel w-full sm:w-[460px] h-full bg-surface-container shadow-2xl border-l border-outline-variant/20 flex flex-col animate-slide-in text-left ml-auto overflow-hidden"
            >
              {/* Header */}
              <header className="app-overlay-header p-5 md:p-6 border-b border-outline-variant/10 flex items-center justify-between bg-surface-container-low shrink-0">
                <h3 className="font-headline-sm text-lg text-on-surface flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">receipt</span>
                  Order Details
                </h3>
                <button
                  type="button"
                  onClick={() => setSelectedOrderId(null)}
                  aria-label="Close details"
                  className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container-high transition-colors text-on-surface-variant cursor-pointer focus-visible:ring-2 focus-visible:ring-primary outline-none"
                >
                  <span className="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              </header>

              {/* Content */}
              <div className="app-overlay-scroll-body p-5 md:p-6 space-y-6 flex-1 overflow-y-auto">
                {/* Order Information Section */}
                <div className="space-y-4">
                  <h4 className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest font-semibold border-b border-outline-variant/10 pb-1">Order Information</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block mb-0.5">Order ID</span>
                      <div className="flex items-center gap-1.5 font-mono text-primary font-bold">
                        <span>#{selectedOrder._id.toString().substring(18)}</span>
                        <button
                          onClick={() => handleCopy(selectedOrder._id.toString(), 'orderId')}
                          className="text-primary hover:opacity-85 flex items-center shrink-0 cursor-pointer"
                          aria-label="Copy Order ID"
                        >
                          <span className="material-symbols-outlined text-sm">
                            {copyStatus['orderId'] ? 'check' : 'content_copy'}
                          </span>
                          {copyStatus['orderId'] && <span className="text-[10px] ml-1 font-semibold normal-case">Copied</span>}
                        </button>
                      </div>
                    </div>

                    <div>
                      <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block mb-0.5">Table</span>
                      <span className="font-semibold text-on-surface">{selectedOrder.table} {selectedOrder.location ? `(${selectedOrder.location})` : ''}</span>
                    </div>

                    <div>
                      <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block mb-0.5">Order Date</span>
                      <span className="text-on-surface-variant">
                        {getPaymentDate(selectedOrder) ? getPaymentDate(selectedOrder).toLocaleString(undefined, {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        }) : 'N/A'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block mb-0.5">Status</span>
                      <div>{renderPaymentStatusBadge(selectedOrder.paymentStatus)}</div>
                    </div>

                    <div>
                      <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block mb-0.5">Payment Method</span>
                      <div>{renderPaymentMethodBadge(selectedOrder.paymentType)}</div>
                    </div>

                    <div>
                      <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block mb-0.5">Confirmed By</span>
                      <span className="text-on-surface font-medium">{selectedOrder.confirmedBy?.trim() || 'Staff'}</span>
                    </div>
                  </div>
                </div>

                {/* Items List */}
                <div className="space-y-3">
                  <h4 className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest font-semibold border-b border-outline-variant/10 pb-1">Items</h4>
                  <div className="space-y-2.5">
                    {selectedOrder.items.map((item, idx) => (
                      <div key={item.id || idx} className="flex justify-between items-center text-sm">
                        <span className="text-on-surface font-medium">
                          {item.quantity} × {item.name || 'Item'}
                        </span>
                        {isFinite(parseFloat(item.price)) && (
                          <span className="font-mono text-on-surface-variant">
                            ₹{(parseFloat(item.price) * item.quantity).toFixed(2)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bill Breakdown */}
                <div className="space-y-3 bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/10">
                  <h4 className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest font-semibold border-b border-outline-variant/10 pb-1">Bill Breakdown</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between text-on-surface-variant">
                      <span>Food Subtotal</span>
                      <span>₹{getFoodSubtotal(selectedOrder).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-on-surface-variant">
                      <span>Convenience Fee</span>
                      <span>₹{getConvenienceFee(selectedOrder).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-on-surface font-semibold pt-2 border-t border-outline-variant/15 text-base">
                      <span>Total Customer Paid</span>
                      <span className="text-primary">₹{getCustomerPaidAmount(selectedOrder).toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* Razorpay Details */}
                <div className="space-y-4 pt-2">
                  {selectedOrder.paymentType === 'RAZORPAY' || selectedOrder.paymentType === 'ONLINE' || selectedOrder.paymentType === 'NOW' ? (
                    <div className="space-y-3">
                      <h4 className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest font-semibold border-b border-outline-variant/10 pb-1">Razorpay Details</h4>
                      <div className="space-y-3 text-sm">
                        <div>
                          <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block mb-0.5">Razorpay Order ID</span>
                          {selectedOrder.razorpayOrderId ? (
                            <div className="flex items-center gap-1.5 font-mono text-on-surface">
                              <span className="break-all">{selectedOrder.razorpayOrderId}</span>
                              <button
                                onClick={() => handleCopy(selectedOrder.razorpayOrderId, 'razorpayOrderId')}
                                className="text-primary hover:opacity-85 flex items-center shrink-0 cursor-pointer"
                                aria-label="Copy Razorpay Order ID"
                              >
                                <span className="material-symbols-outlined text-sm">
                                  {copyStatus['razorpayOrderId'] ? 'check' : 'content_copy'}
                                </span>
                                {copyStatus['razorpayOrderId'] && <span className="text-[10px] ml-1 font-semibold normal-case">Copied</span>}
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-on-surface-variant/50 italic">Not available</span>
                          )}
                        </div>

                        <div>
                          <span className="text-[11px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest block mb-0.5">Razorpay Payment ID</span>
                          {selectedOrder.razorpayPaymentId ? (
                            <div className="flex items-center gap-1.5 font-mono text-on-surface">
                              <span className="break-all">{selectedOrder.razorpayPaymentId}</span>
                              <button
                                onClick={() => handleCopy(selectedOrder.razorpayPaymentId, 'razorpayPaymentId')}
                                className="text-primary hover:opacity-85 flex items-center shrink-0 cursor-pointer"
                                aria-label="Copy Razorpay Payment ID"
                              >
                                <span className="material-symbols-outlined text-sm">
                                  {copyStatus['razorpayPaymentId'] ? 'check' : 'content_copy'}
                                </span>
                                {copyStatus['razorpayPaymentId'] && <span className="text-[10px] ml-1 font-semibold normal-case">Copied</span>}
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-on-surface-variant/50 italic">Not available</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 bg-primary/5 border border-primary/10 rounded-xl text-xs text-primary font-semibold flex items-center gap-2">
                      <span className="material-symbols-outlined text-sm">check_circle</span>
                      Payment verified manually
                    </div>
                  )}
                </div>

                {/* Print/Save Receipt action for PAID orders */}
                {selectedOrder.paymentStatus === 'PAID' && (
                  <div className="pt-4 border-t border-outline-variant/10">
                    <button
                      type="button"
                      onClick={() => handlePrintReceipt(selectedOrder)}
                      disabled={isGeneratingReceipt}
                      aria-label="Print or save receipt for this paid order"
                      className="w-full bg-gold-metallic text-on-primary-fixed h-12 rounded-xl font-label-caps text-label-caps uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50"
                    >
                      {isGeneratingReceipt ? (
                        <>
                          <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                          Generating...
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-[18px]">receipt_long</span>
                          Print / Save Receipt
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </aside>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

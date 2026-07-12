import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { API_BASE } from '../config';

const STATUS_LABELS = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  RETRY_PENDING: 'Retry Pending',
  RECONCILIATION_REQUIRED: 'Needs Reconciliation',
  PROCESSED: 'Processed',
  PARTIALLY_PROCESSED: 'Partially Mapped',
  FAILED: 'Failed',
  SKIPPED: 'Skipped'
};

const renderStatusBadge = (status) => {
  let style = 'bg-surface-container-high border-outline-variant/30 text-on-surface-variant/80';
  if (status === 'PROCESSED') {
    style = 'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400';
  } else if (status === 'PROCESSING') {
    style = 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400 animate-pulse';
  } else if (status === 'PENDING') {
    style = 'bg-surface-container-highest border-outline-variant/50 text-on-surface-variant';
  } else if (status === 'SKIPPED') {
    style = 'bg-surface-container-highest/60 border-outline-variant/20 text-on-surface-variant/60';
  } else if (['FAILED', 'RECONCILIATION_REQUIRED', 'RETRY_PENDING', 'PARTIALLY_PROCESSED'].includes(status)) {
    style = 'bg-error/10 border-error/20 text-error font-semibold';
  }

  return (
    <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${style}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
};

export default function SettlementMonitor() {
  const [summary, setSummary] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [error, setError] = useState(null);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [search, setSearch] = useState('');
  const [searchVal, setSearchVal] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Details Drawer
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [details, setDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState(null);

  // Fetch summary
  const fetchSummary = useCallback(async () => {
    try {
      setSummaryLoading(true);
      const res = await fetch(`${API_BASE}/api/settings/split-settlement/monitoring/summary`, {
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Failed to load metrics.');
      const data = await res.json();
      setSummary(data.summary);
    } catch (err) {
      console.error(err);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  // Fetch history
  const fetchHistory = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const params = new URLSearchParams();
      params.append('page', page);
      params.append('limit', 20);
      if (searchVal) params.append('search', searchVal);
      if (statusFilter) params.append('status', statusFilter);
      if (from) params.append('from', from);
      if (to) params.append('to', to);

      const res = await fetch(`${API_BASE}/api/settings/split-settlement/monitoring/history?${params.toString()}`, {
        credentials: 'include'
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to load settlement history.');
      }
      const data = await res.json();
      setOrders(data.orders || []);
      setTotalPages(data.pagination?.pages || 1);
      setTotalCount(data.pagination?.total || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, searchVal, statusFilter, from, to]);

  // Fetch details
  useEffect(() => {
    if (!selectedOrderId) {
      setDetails(null);
      setDetailsError(null);
      return;
    }

    const fetchDetails = async () => {
      try {
        setDetailsLoading(true);
        setDetailsError(null);
        const res = await fetch(`${API_BASE}/api/settings/split-settlement/monitoring/orders/${selectedOrderId}`, {
          credentials: 'include'
        });
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to load details.');
        }
        const data = await res.json();
        setDetails(data);
      } catch (err) {
        setDetailsError(err.message);
      } finally {
        setDetailsLoading(false);
      }
    };

    fetchDetails();
  }, [selectedOrderId]);

  // Initial load
  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  // Filter load
  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    setSearchVal(search.trim());
  };

  const handleClearFilters = () => {
    setSearch('');
    setSearchVal('');
    setStatusFilter('');
    setFrom('');
    setTo('');
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto pb-12">
      
      {/* Header */}
      <div>
        <h1 className="font-headline-md text-2xl font-bold text-on-surface">Settlement Monitor</h1>
        <p className="font-body-md text-on-surface-variant mt-1">Audit and track real-time split settlements for tableside transactions.</p>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface-container rounded-2xl border border-outline-variant/15 p-5 shadow-sm">
          <span className="text-xs text-on-surface-variant font-medium tracking-wide uppercase">All settlements</span>
          <p className="font-headline-lg text-3xl font-bold text-on-surface mt-2">
            {summaryLoading ? '...' : (summary?.total ?? 0)}
          </p>
        </div>
        <div className="bg-surface-container rounded-2xl border border-outline-variant/15 p-5 shadow-sm">
          <span className="text-xs text-on-surface-variant font-medium tracking-wide uppercase">Processed</span>
          <p className="font-headline-lg text-3xl font-bold text-green-600 dark:text-green-400 mt-2">
            {summaryLoading ? '...' : (summary?.processed ?? 0)}
          </p>
        </div>
        <div className="bg-surface-container rounded-2xl border border-outline-variant/15 p-5 shadow-sm">
          <span className="text-xs text-on-surface-variant font-medium tracking-wide uppercase">Processing</span>
          <p className="font-headline-lg text-3xl font-bold text-blue-600 dark:text-blue-400 mt-2">
            {summaryLoading ? '...' : (summary?.processing ?? 0)}
          </p>
        </div>
        <div className={`bg-surface-container rounded-2xl p-5 shadow-sm border transition-all ${
          !summaryLoading && summary?.needsAttention > 0 
            ? 'border-error/40 bg-error/[0.02]' 
            : 'border-outline-variant/15'
        }`}>
          <span className="text-xs text-on-surface-variant font-medium tracking-wide uppercase">Needs Attention</span>
          <p className={`font-headline-lg text-3xl font-bold mt-2 ${
            !summaryLoading && summary?.needsAttention > 0 ? 'text-error' : 'text-on-surface'
          }`}>
            {summaryLoading ? '...' : (summary?.needsAttention ?? 0)}
          </p>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-surface-container rounded-2xl border border-outline-variant/20 shadow-sm p-4 md:p-6">
        <form onSubmit={handleSearchSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-2 relative">
            <span className="material-symbols-outlined absolute left-3.5 top-3.5 text-on-surface-variant text-base">search</span>
            <input 
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search table, location or order ID..."
              className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg pl-10 pr-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors text-sm"
            />
          </div>

          <div>
            <select
              value={statusFilter}
              onChange={e => { setPage(1); setStatusFilter(e.target.value); }}
              className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors text-sm cursor-pointer"
            >
              <option value="">All Statuses</option>
              <option value="NEEDS_ATTENTION">Needs Attention</option>
              <option value="PROCESSED">Processed</option>
              <option value="PROCESSING">Processing</option>
              <option value="PENDING">Pending</option>
              <option value="FAILED">Failed</option>
              <option value="PARTIALLY_PROCESSED">Partially Processed</option>
              <option value="RETRY_PENDING">Retry Pending</option>
              <option value="SKIPPED">Skipped</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 bg-primary text-on-primary rounded-lg text-xs font-semibold uppercase tracking-wider hover:opacity-90 transition-opacity cursor-pointer inline-flex items-center justify-center gap-1"
            >
              Apply Filter
            </button>
            <button
              type="button"
              onClick={handleClearFilters}
              className="px-3 bg-surface-container-high border border-outline-variant/30 text-on-surface hover:bg-surface-container-highest rounded-lg transition-colors cursor-pointer"
              title="Clear all filters"
            >
              <span className="material-symbols-outlined text-sm leading-none flex items-center justify-center">refresh</span>
            </button>
          </div>
        </form>

        <div className="grid grid-cols-2 gap-4 mt-4 max-w-md">
          <div>
            <label className="block text-[10px] text-on-surface-variant font-bold uppercase tracking-wider mb-1">From Date</label>
            <input 
              type="date"
              value={from}
              onChange={e => { setPage(1); setFrom(e.target.value); }}
              className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-3 py-2 outline-none text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] text-on-surface-variant font-bold uppercase tracking-wider mb-1">To Date</label>
            <input 
              type="date"
              value={to}
              onChange={e => { setPage(1); setTo(e.target.value); }}
              className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-3 py-2 outline-none text-xs"
            />
          </div>
        </div>
      </div>

      {/* Main List */}
      <div className="bg-surface-container rounded-2xl border border-outline-variant/20 shadow-lg overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
            <span className="text-sm text-on-surface-variant mt-3">Loading history records...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <span className="material-symbols-outlined text-error text-5xl">error</span>
            <p className="font-headline-sm text-lg font-bold text-on-surface mt-4">Failed to fetch settlements</p>
            <p className="text-sm text-on-surface-variant mt-2 max-w-md">{error}</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <span className="material-symbols-outlined text-outline text-5xl">receipt_long</span>
            <p className="font-headline-sm text-lg font-bold text-on-surface mt-4">No settlements found</p>
            <p className="text-sm text-on-surface-variant mt-2">No matching paid orders have split settlements mapped.</p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-surface-container-high border-b border-outline-variant/15 text-on-surface-variant font-semibold text-xs tracking-wider uppercase">
                    <th className="py-3.5 px-6">Order ID</th>
                    <th className="py-3.5 px-4">Date</th>
                    <th className="py-3.5 px-4">Table</th>
                    <th className="py-3.5 px-4">Food Total</th>
                    <th className="py-3.5 px-4">Transfers (Paise)</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/15">
                  {orders.map((order) => {
                    const dateStr = order.createdAt 
                      ? new Date(order.createdAt).toLocaleString(undefined, {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        })
                      : 'N/A';
                    
                    return (
                      <tr 
                        key={order.orderId}
                        onClick={() => setSelectedOrderId(order.orderId)}
                        className="hover:bg-surface-container-low transition-colors cursor-pointer border-b border-outline-variant/10"
                      >
                        <td className="py-4 px-6 font-mono text-primary font-bold text-sm">
                          #{order.displayOrderId}
                        </td>
                        <td className="py-4 px-4 font-mono text-xs text-on-surface-variant whitespace-nowrap">
                          {dateStr}
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-1.5 font-semibold text-on-surface">
                            <span className="material-symbols-outlined text-primary text-sm">table_restaurant</span>
                            {order.table}
                          </div>
                          {order.location && (
                            <span className="text-[11px] text-on-surface-variant block mt-0.5 pl-6">📍 {order.location}</span>
                          )}
                        </td>
                        <td className="py-4 px-4 font-mono font-semibold text-on-surface">
                          ₹{(order.foodSubtotalPaise / 100).toFixed(2)}
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex flex-col font-mono text-xs text-on-surface-variant">
                            <span>Ext: ₹{(order.externalTransferAmountPaise / 100).toFixed(2)}</span>
                            <span className="opacity-70">Ret: ₹{(order.platformRetainedAmountPaise / 100).toFixed(2)}</span>
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          {renderStatusBadge(order.status)}
                        </td>
                        <td className="py-4 px-6 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedOrderId(order.orderId);
                            }}
                            className="text-on-surface-variant hover:text-primary transition-all p-1.5 hover:bg-surface-container-high rounded-lg cursor-pointer"
                            title="View audit details"
                          >
                            <span className="material-symbols-outlined text-base">visibility</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Stacked Card List */}
            <div className="block md:hidden p-4 space-y-4">
              {orders.map((order) => {
                const dateStr = order.createdAt 
                  ? new Date(order.createdAt).toLocaleString(undefined, {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                    })
                  : 'N/A';
                
                return (
                  <div 
                    key={order.orderId}
                    onClick={() => setSelectedOrderId(order.orderId)}
                    className="bg-surface-container-low border border-outline-variant/15 rounded-2xl p-4 flex flex-col gap-3 shadow-sm cursor-pointer hover:bg-surface-container-highest/20 transition-all"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="material-symbols-outlined text-primary text-sm">table_restaurant</span>
                          <span className="font-semibold text-primary">{order.table}</span>
                          <span className="font-mono text-xs text-primary font-bold bg-primary/10 border border-primary/20 rounded px-1.5 py-0.5 ml-1">
                            #{order.displayOrderId}
                          </span>
                        </div>
                        {order.location && (
                          <span className="text-[11px] text-on-surface-variant block mt-0.5">📍 {order.location}</span>
                        )}
                      </div>
                      <span className="text-xs text-on-surface-variant/70 font-mono">{dateStr}</span>
                    </div>

                    <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-xl p-3 flex justify-between items-center text-xs font-mono">
                      <div>
                        <span className="text-on-surface-variant">Food Subtotal:</span>
                        <span className="font-bold text-on-surface ml-1.5">₹{(order.foodSubtotalPaise / 100).toFixed(2)}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-on-surface-variant">Ext: ₹{(order.externalTransferAmountPaise / 100).toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="flex justify-between items-center mt-1">
                      {renderStatusBadge(order.status)}
                      <span className="text-xs text-primary font-medium flex items-center gap-1">
                        View details <span className="material-symbols-outlined text-sm">chevron_right</span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="p-4 border-t border-outline-variant/15 flex items-center justify-between">
                <span className="text-xs text-on-surface-variant font-medium">
                  Showing {(page - 1) * 20 + 1} – {Math.min(page * 20, totalCount)} of {totalCount} records
                </span>
                <div className="flex items-center gap-2">
                  <button
                    disabled={page === 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    className="p-2 border border-outline-variant/40 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    title="Previous page"
                  >
                    <span className="material-symbols-outlined text-sm leading-none flex items-center justify-center">chevron_left</span>
                  </button>
                  <span className="text-xs text-on-surface font-semibold font-mono">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    disabled={page === totalPages}
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    className="p-2 border border-outline-variant/40 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    title="Next page"
                  >
                    <span className="material-symbols-outlined text-sm leading-none flex items-center justify-center">chevron_right</span>
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Details Slide-out Drawer */}
      <AnimatePresence>
        {selectedOrderId && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedOrderId(null)}
              className="fixed inset-0 bg-black/60 z-[100]"
            />
            {/* Drawer */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="fixed right-0 top-0 bottom-0 w-full md:w-[480px] bg-surface-container z-[101] shadow-2xl flex flex-col border-l border-outline-variant/20"
            >
              {/* Header */}
              <div className="p-6 border-b border-outline-variant/15 flex justify-between items-center bg-surface-container-high">
                <div>
                  <h2 className="font-headline-sm text-lg font-bold text-on-surface">Audit Details</h2>
                  <p className="text-xs text-on-surface-variant/80 mt-1 font-mono">Order ID: #{selectedOrderId.substring(18)}</p>
                </div>
                <button 
                  onClick={() => setSelectedOrderId(null)}
                  className="text-on-surface-variant hover:text-primary p-1.5 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              {/* Scrollable Container */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {detailsLoading ? (
                  <div className="flex flex-col items-center justify-center py-24">
                    <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
                    <span className="text-xs text-on-surface-variant mt-2.5">Fetching settlement parameters...</span>
                  </div>
                ) : detailsError ? (
                  <div className="flex flex-col items-center justify-center text-center py-16 gap-3">
                    <span className="material-symbols-outlined text-error text-4xl">error</span>
                    <p className="font-semibold text-on-surface">Failed to load details</p>
                    <p className="text-xs text-on-surface-variant max-w-sm">{detailsError}</p>
                  </div>
                ) : details ? (
                  <>
                    {/* Order Metrics Card */}
                    <div className="bg-surface-container-low border border-outline-variant/15 rounded-2xl p-4 flex flex-col gap-3.5">
                      <span className="text-[10px] text-primary uppercase font-bold tracking-wider block border-b border-outline-variant/10 pb-1.5">Order Parameters</span>
                      <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                        <div>
                          <span className="text-on-surface-variant block">Table</span>
                          <span className="font-bold text-on-surface mt-0.5 block">{details.order.table}</span>
                        </div>
                        <div>
                          <span className="text-on-surface-variant block">Location</span>
                          <span className="font-bold text-on-surface mt-0.5 block">{details.order.location || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-on-surface-variant block">Food Subtotal</span>
                          <span className="font-bold text-on-surface mt-0.5 block">₹{(details.order.foodSubtotalPaise / 100).toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-on-surface-variant block">Payment Status</span>
                          <span className="font-bold text-green-600 dark:text-green-400 mt-0.5 block">{details.order.paymentStatus}</span>
                        </div>
                      </div>
                    </div>

                    {/* Settlement Metrics Card */}
                    <div className="bg-surface-container-low border border-outline-variant/15 rounded-2xl p-4 flex flex-col gap-3.5">
                      <span className="text-[10px] text-primary uppercase font-bold tracking-wider block border-b border-outline-variant/10 pb-1.5">Settlement Parameters</span>
                      
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-on-surface font-medium">Overall Status:</span>
                        {renderStatusBadge(details.settlement.status)}
                      </div>

                      <div className="grid grid-cols-2 gap-4 text-xs font-mono border-t border-outline-variant/10 pt-3">
                        <div>
                          <span className="text-on-surface-variant block">Provider</span>
                          <span className="font-semibold text-on-surface mt-0.5 block">{details.settlement.provider}</span>
                        </div>
                        <div>
                          <span className="text-on-surface-variant block">Config Version</span>
                          <span className="font-semibold text-on-surface mt-0.5 block">v{details.settlement.configurationVersion}</span>
                        </div>
                        <div>
                          <span className="text-on-surface-variant block">External Allocation</span>
                          <span className="font-semibold text-on-surface mt-0.5 block">{(details.settlement.externalAllocationBasisPoints / 100).toFixed(1)}%</span>
                        </div>
                        <div>
                          <span className="text-on-surface-variant block">Platform Retained</span>
                          <span className="font-semibold text-on-surface mt-0.5 block">{(details.settlement.platformRetainedBasisPoints / 100).toFixed(1)}%</span>
                        </div>
                        <div>
                          <span className="text-on-surface-variant block">Ext Transfer Amount</span>
                          <span className="font-semibold text-on-surface mt-0.5 block">₹{(details.settlement.externalTransferAmountPaise / 100).toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-on-surface-variant block">Retained Amount</span>
                          <span className="font-semibold text-on-surface mt-0.5 block">₹{(details.settlement.platformRetainedAmountPaise / 100).toFixed(2)}</span>
                        </div>
                      </div>

                      {details.settlement.razorpayPaymentId && (
                        <div className="border-t border-outline-variant/10 pt-3 flex justify-between items-center text-xs font-mono">
                          <span className="text-on-surface-variant">Razorpay Payment ID:</span>
                          <span className="text-on-surface font-semibold">{details.settlement.razorpayPaymentId}</span>
                        </div>
                      )}
                    </div>

                    {/* Recipients Breakdown */}
                    <div className="space-y-3">
                      <span className="text-[10px] text-primary uppercase font-bold tracking-wider block border-b border-outline-variant/10 pb-1.5">Recipient Transfers</span>
                      {details.settlement.recipients.length === 0 ? (
                        <p className="text-xs text-on-surface-variant/80 italic">No recipients registered.</p>
                      ) : (
                        details.settlement.recipients.map((rec, idx) => (
                          <div key={idx} className="bg-surface-container-low border border-outline-variant/10 rounded-xl p-3 flex flex-col gap-2">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-bold text-on-surface">{rec.label}</span>
                              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                                rec.status === 'PROCESSED'
                                  ? 'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400'
                                  : rec.status === 'PROCESSING'
                                  ? 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400 animate-pulse'
                                  : rec.status.startsWith('SKIPPED')
                                  ? 'bg-surface-container-highest/60 border-outline-variant/20 text-on-surface-variant/60'
                                  : 'bg-error/10 border-error/20 text-error'
                              }`}>
                                {rec.status}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono border-t border-outline-variant/5 pt-2 text-on-surface-variant">
                              <div>Allocation: {(rec.allocationBasisPoints / 100).toFixed(1)}%</div>
                              <div className="text-right">Amount: ₹{(rec.amountPaise / 100).toFixed(2)}</div>
                              <div>Attempts: {rec.attemptCount}</div>
                              <div className="text-right">Linked A/C: {rec.linkedAccountId || 'N/A'}</div>
                            </div>

                            {rec.transferId && (
                              <div className="flex justify-between items-center text-[10px] font-mono border-t border-outline-variant/5 pt-2 text-on-surface-variant">
                                <span>Transfer ID:</span>
                                <span className="font-semibold text-on-surface">{rec.transferId}</span>
                              </div>
                            )}

                            {rec.failureDescription && (
                              <div className="bg-error/5 border border-error/10 rounded-lg p-2 mt-1 text-[11px] text-error">
                                <span className="font-bold uppercase tracking-wider block text-[9px] mb-0.5">Transfer Failure</span>
                                {rec.failureDescription} {rec.failureCode ? `(${rec.failureCode})` : ''}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { API_BASE } from '../config';

export default function TablesAndQR() {
  const [tables, setTables] = useState([]);
  const [locations, setLocations] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);

  const [formData, setFormData] = useState({ name: '', locationId: '', seats: 4 });
  const [newLocationName, setNewLocationName] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [editingTable, setEditingTable] = useState(null);
  const [editFormData, setEditFormData] = useState({ name: '', locationId: '', seats: 4 });

  const [deleteTargetId, setDeleteTargetId] = useState(null);

  const [isCreatingTable, setIsCreatingTable] = useState(false);
  const [isSavingTable, setIsSavingTable] = useState(false);
  const [isCreatingLocation, setIsCreatingLocation] = useState(false);
  const [isDeletingTable, setIsDeletingTable] = useState(false);

  const [toast, setToast] = useState(null);

  const fetchInFlightRef = useRef(false);
  const hasLoadedOnceRef = useRef(false);
  const toastTimeoutRef = useRef(null);
  const originalOverflowRef = useRef('');
  const lastFocusedRef = useRef(null);

  const showToast = (message, type) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 2000);
  };

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  const getLocationLabel = (table) => table.locationName || table.location || 'Main Dining Room';
  const getLocationIdForTable = (table) => String(table.locationId || locations.find(loc => loc.name === table.location)?._id || '');

  const getTableLabel = (table) => table.name || (table.number ? `Table ${table.number}` : 'Table');

  const currentDeleteTarget = useMemo(
    () => (deleteTargetId ? tables.find((t) => t._id === deleteTargetId) || null : null),
    [deleteTargetId, tables]
  );

  const filteredTables = useMemo(
    () =>
      tables.filter((t) => {
        const matchesLocation =
          selectedFilter === 'All' ||
          String(t.locationId || getLocationIdForTable(t)) === selectedFilter;
        const matchesSearch =
          (t.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          `table ${t.number}`.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesLocation && matchesSearch;
      }),
    [tables, selectedFilter, searchQuery, locations]
  );

  const hasOpenOverlay = isModalOpen || isLocationModalOpen || !!editingTable || !!deleteTargetId;

  useEffect(() => {
    if (hasOpenOverlay) {
      originalOverflowRef.current = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = originalOverflowRef.current || '';
    }
    return () => {
      document.body.style.overflow = originalOverflowRef.current || '';
    };
  }, [hasOpenOverlay]);

  useEffect(() => {
    if (!hasOpenOverlay && !openDropdownId) return;

    const handleEscape = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (deleteTargetId) {
        setDeleteTargetId(null);
      } else if (editingTable) {
        setEditingTable(null);
      } else if (isModalOpen) {
        setIsModalOpen(false);
      } else if (isLocationModalOpen) {
        setIsLocationModalOpen(false);
      } else if (openDropdownId) {
        setOpenDropdownId(null);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [deleteTargetId, editingTable, isModalOpen, isLocationModalOpen, openDropdownId, hasOpenOverlay]);

  useEffect(() => {
    if (!openDropdownId) return;

    const handleClickOutside = (e) => {
      const region = e.target.closest('[data-table-actions-id]');
      if (!region) {
        setOpenDropdownId(null);
        return;
      }
      const mid = region.getAttribute('data-table-actions-id');
      if (mid !== openDropdownId) {
        setOpenDropdownId(mid);
      }
    };

    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [openDropdownId]);

  const restoreFocus = () => {
    const el = lastFocusedRef.current;
    setTimeout(() => {
      if (el && document.contains(el)) {
        el.focus({ preventScroll: true });
      }
    }, 0);
  };

  const fetchData = async () => {
    if (fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;

    if (hasLoadedOnceRef.current) {
      setIsRefreshing(true);
    }

    try {
      const [tablesRes, locsRes] = await Promise.all([
        fetch(API_BASE + '/api/tables'),
        fetch(API_BASE + '/api/locations'),
      ]);

      if (!tablesRes.ok || !locsRes.ok) throw new Error('Fetch failed');

      const tablesData = await tablesRes.json();
      const locsData = await locsRes.json();

      setTables(Array.isArray(tablesData) ? tablesData : tablesData.tables || []);
      setLocations(Array.isArray(locsData) ? locsData : []);
      setFetchError(null);

      if (!hasLoadedOnceRef.current) {
        hasLoadedOnceRef.current = true;
      }
    } catch (err) {
      if (!hasLoadedOnceRef.current) {
        setFetchError('Something went wrong loading tables');
      } else {
        showToast('Something went wrong. Please try again.', 'error');
      }
    } finally {
      setInitialLoading(false);
      setIsRefreshing(false);
      setIsRetrying(false);
      fetchInFlightRef.current = false;
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (locations.length > 0 && !formData.locationId) {
      setFormData((prev) => ({ ...prev, locationId: String(locations[0]._id) }));
    }
  }, [locations, formData.locationId]);

  const submitGenerateQR = async (e) => {
    e.preventDefault();
    if (isCreatingTable) return;
    setIsCreatingTable(true);
    try {
      const res = await fetch(API_BASE + '/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, baseUrl: window.location.origin }),
        credentials: 'include',
      });
      if (res.ok) {
        const newTable = await res.json();
        setTables((prev) => [...prev, newTable]);
        setIsModalOpen(false);
        setFormData({
          name: '',
          locationId: locations.length > 0 ? String(locations[0]._id) : '',
          seats: 4,
        });
        showToast('Table created', 'success');
      } else {
        showToast('Something went wrong. Please try again.', 'error');
      }
    } catch (err) {
      showToast('Something went wrong. Please try again.', 'error');
    } finally {
      setIsCreatingTable(false);
    }
  };

  const submitCreateLocation = async (e) => {
    e.preventDefault();
    if (isCreatingLocation) return;
    if (!newLocationName.trim()) return;
    setIsCreatingLocation(true);
    try {
      const res = await fetch(API_BASE + '/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newLocationName }),
        credentials: 'include',
      });
      if (res.ok) {
        const newLoc = await res.json();
        setLocations((prev) => [...prev, newLoc]);
        setIsLocationModalOpen(false);
        setNewLocationName('');
        if (!formData.locationId) {
          setFormData((prev) => ({ ...prev, locationId: String(newLoc._id) }));
        }
        showToast('Location created', 'success');
      } else {
        showToast('Something went wrong. Please try again.', 'error');
      }
    } catch (err) {
      showToast('Something went wrong. Please try again.', 'error');
    } finally {
      setIsCreatingLocation(false);
    }
  };

  const handleStartEdit = (table) => {
    if (!table._id) return;
    lastFocusedRef.current = document.activeElement;
    setEditingTable(table);
    setEditFormData({
      name: table.name,
      locationId: getLocationIdForTable(table),
      seats: table.seats,
    });
    setOpenDropdownId(null);
  };

  const submitEditTable = async (e) => {
    e.preventDefault();
    if (!editingTable || isSavingTable) return;
    setIsSavingTable(true);
    try {
      const res = await fetch(`${API_BASE}/api/tables/${editingTable._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editFormData, baseUrl: window.location.origin }),
        credentials: 'include',
      });
      if (res.ok) {
        const updatedTable = await res.json();
        setTables((prev) => prev.map((t) => (t._id === editingTable._id ? updatedTable : t)));
        setEditingTable(null);
        showToast('Table updated', 'success');
      } else {
        showToast('Something went wrong. Please try again.', 'error');
      }
    } catch (err) {
      showToast('Something went wrong. Please try again.', 'error');
    } finally {
      setIsSavingTable(false);
    }
  };

  const confirmDeleteTable = async () => {
    if (!deleteTargetId || isDeletingTable) return;
    setIsDeletingTable(true);
    try {
      const res = await fetch(`${API_BASE}/api/tables/${deleteTargetId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setTables((prev) => prev.filter((t) => t._id !== deleteTargetId));
        setDeleteTargetId(null);
        setOpenDropdownId(null);
        showToast('Table deleted', 'success');
      } else {
        showToast('Something went wrong. Please try again.', 'error');
      }
    } catch (err) {
      showToast('Something went wrong. Please try again.', 'error');
    } finally {
      setIsDeletingTable(false);
    }
  };

  const handleRetry = () => {
    setIsRetrying(true);
    setFetchError(null);
    fetchData();
  };

  const handleDeleteClick = (tableId) => {
    lastFocusedRef.current = document.activeElement;
    setOpenDropdownId(null);
    setDeleteTargetId(tableId);
  };

  const safeTableLabel = (table) => getTableLabel(table).replace(/\s+/g, '_');

  const renderSkeletons = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-gutter pb-8">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="bg-surface-container/40 rounded-2xl p-5 border border-primary/15 animate-pulse"
        >
          <div className="flex justify-between items-start mb-6">
            <div className="space-y-2 flex-1">
              <div className="h-5 bg-surface-container-high rounded w-2/3" />
              <div className="h-3 bg-surface-container-high rounded w-1/3" />
            </div>
          </div>
          <div className="flex justify-center py-6">
            <div className="w-32 h-32 bg-surface-container-high rounded-xl" />
          </div>
          <div className="mt-4 pt-4 border-t border-outline-variant/15 flex justify-between">
            <div className="h-4 bg-surface-container-high rounded w-16" />
            <div className="h-6 w-6 bg-surface-container-high rounded" />
          </div>
          <span className="sr-only">Loading tables and QR codes</span>
        </div>
      ))}
    </div>
  );

  const renderErrorState = () => (
    <div className="flex flex-col items-center justify-center py-20">
      <span className="material-symbols-outlined text-6xl mb-4 text-on-surface-variant">
        cloud_off
      </span>
      <p className="font-body-lg text-[16px] text-on-surface-variant mb-2">
        Something went wrong loading tables
      </p>
      <p className="font-body-sm text-[13px] text-on-surface-variant/60 mb-6">Please try again</p>
      <button
        onClick={handleRetry}
        disabled={isRetrying}
        className="bg-primary text-on-primary font-title-md text-[14px] font-semibold px-6 py-2.5 rounded-xl gold-glow flex items-center gap-2 disabled:opacity-60"
      >
        {isRetrying ? (
          <>
            <span className="material-symbols-outlined text-[18px] animate-spin">
              progress_activity
            </span>
            Retrying…
          </>
        ) : (
          <>
            <span className="material-symbols-outlined text-[18px]">refresh</span>
            Retry
          </>
        )}
      </button>
    </div>
  );

  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center py-20">
      <span className="material-symbols-outlined text-6xl mb-4 text-on-surface-variant">
        grid_off
      </span>
      <p className="font-body-lg text-[16px] text-on-surface-variant mb-2">No tables yet</p>
      <p className="font-body-sm text-[13px] text-on-surface-variant/60 mb-6">
        Create your first table and generate its QR code
      </p>
      <button
        onClick={() => {
          if (locations.length > 0 && !formData.locationId) {
            setFormData((prev) => ({ ...prev, locationId: String(locations[0]._id) }));
          }
          setIsModalOpen(true);
        }}
        className="bg-primary text-on-primary font-title-md text-[14px] font-semibold px-6 py-2.5 rounded-xl gold-glow flex items-center gap-2"
      >
        <span className="material-symbols-outlined text-[18px]">qr_code</span>
        Generate QR
      </button>
    </div>
  );

  const renderFilterEmptyState = () => (
    <div className="flex flex-col items-center justify-center py-20">
      <span className="material-symbols-outlined text-6xl mb-4 text-on-surface-variant">
        search_off
      </span>
      <p className="font-body-lg text-[16px] text-on-surface-variant mb-2">No matching tables</p>
      <p className="font-body-sm text-[13px] text-on-surface-variant/60 mb-6">
        Try another location or clear your search
      </p>
      <button
        onClick={() => {
          setSearchQuery('');
          setSelectedFilter('All');
        }}
        className="bg-surface-container-high border border-outline-variant/50 text-on-surface font-title-md text-[14px] font-semibold px-6 py-2.5 rounded-xl hover:border-primary/50 transition-colors flex items-center gap-2"
      >
        <span className="material-symbols-outlined text-[18px]">filter_alt_off</span>
        Clear filters
      </button>
    </div>
  );

  return (
    <div className="flex flex-col min-h-full w-full pb-10">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-8 animate-[fadeUp_0.6s_ease-out_forwards]">
        <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center w-full sm:w-auto">
          <div className="relative">
            <select
              value={selectedFilter}
              onChange={(e) => setSelectedFilter(e.target.value)}
              aria-label="Filter by location"
              className="bg-none bg-surface-container-high hover:bg-surface-container-highest border border-outline-variant text-on-surface pl-4 pr-10 py-2.5 rounded-xl font-label-caps text-[12px] font-bold tracking-[0.1em] transition-colors appearance-none outline-none focus:border-primary cursor-pointer shadow-sm w-full sm:w-auto"
            >
              <option value="All">All Locations</option>
              {locations.map((loc) => (
                <option key={loc._id || loc.name} value={loc._id}>
                  {loc.name}
                </option>
              ))}
            </select>
            <span className="material-symbols-outlined absolute right-3 top-3.5 text-on-surface-variant text-[18px] pointer-events-none">
              expand_more
            </span>
          </div>

          <div className="relative group w-full sm:w-64">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search tables"
              className="bg-transparent border-b border-surface-variant text-on-surface focus:outline-none focus:border-primary focus:shadow-[0_4px_12px_rgba(212,175,55,0.1)] transition-all duration-300 py-2.5 pl-8 pr-4 w-full placeholder-on-surface-variant font-body-sm text-[14px]"
              placeholder="Search tables..."
              type="text"
            />
            <span className="material-symbols-outlined absolute left-0 top-3 text-on-surface-variant text-[18px]">
              search
            </span>
          </div>
        </div>

        <div className="flex gap-3 sm:flex-shrink-0">
          <button
            onClick={() => {
              lastFocusedRef.current = document.activeElement;
              setIsLocationModalOpen(true);
            }}
            className="bg-surface-container-high border border-outline-variant/50 text-on-surface font-title-md text-[14px] sm:text-[16px] font-semibold px-4 py-2.5 rounded-xl hover:border-primary/50 transition-colors flex items-center gap-2 shadow-sm"
            aria-label="Create new location"
          >
            <span className="material-symbols-outlined text-[18px] hidden sm:block">
              add_location
            </span>
            <span className="hidden sm:block">Create Location</span>
            <span className="sm:hidden">Location +</span>
          </button>
          <button
            onClick={() => {
              if (locations.length > 0 && !formData.locationId) {
                setFormData((prev) => ({ ...prev, locationId: String(locations[0]._id) }));
              }
              lastFocusedRef.current = document.activeElement;
              setIsModalOpen(true);
            }}
            className="bg-primary text-on-primary font-title-md text-[14px] sm:text-[16px] font-semibold px-4 sm:px-6 py-2.5 rounded-xl ripple shadow-[0_0_15px_rgba(212,175,55,0.3)] hover:shadow-[0_0_25px_rgba(212,175,55,0.5)] transition-shadow duration-300 flex items-center gap-2"
            aria-label="Generate new table QR code"
          >
            <span className="material-symbols-outlined hidden sm:block">qr_code</span>
            <span className="hidden sm:block">Generate QR</span>
            <span className="sm:hidden">QR +</span>
          </button>
        </div>
      </div>

      {initialLoading ? (
        renderSkeletons()
      ) : fetchError ? (
        renderErrorState()
      ) : tables.length === 0 ? (
        renderEmptyState()
      ) : filteredTables.length === 0 ? (
        renderFilterEmptyState()
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-gutter pb-8">
          {filteredTables.map((table, index) => (
            <motion.div
              key={table._id || index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="bg-surface-container/40 backdrop-blur-md rounded-2xl p-5 border border-primary/15 relative group hover:border-primary/45 transition-all duration-300 flex flex-col premium-card-shadow overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-surface-container-highest/30 to-background/10 opacity-50 z-0" />
              <div className="relative z-10 flex flex-col h-full">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className="font-title-md text-[18px] md:text-[20px] font-semibold text-on-surface leading-snug">
                      {getTableLabel(table)}
                    </h3>
                    <p className="font-body-sm text-[13px] text-on-surface-variant/75 mt-1">
                      {getLocationLabel(table)}
                    </p>
                  </div>
                </div>

                <div className="flex-1 flex justify-center items-center py-6 relative">
                  <div className="w-32 h-32 bg-white rounded-xl relative overflow-hidden group-hover:scale-105 transition-transform duration-500 flex items-center justify-center p-1.5 border border-primary/20 shadow-md">
                    {table.qrUrl ? (
                      <img
                        src={table.qrUrl}
                        alt={`QR for ${getTableLabel(table)}`}
                        className="w-full h-full object-contain rounded-lg"
                      />
                    ) : (
                      <span className="material-symbols-outlined text-black/20 text-[64px]">
                        qr_code_2
                      </span>
                    )}
                  </div>

                  {table.qrUrl && (
                    <div className="absolute bottom-0 left-0 w-full flex justify-center translate-y-10 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300">
                      <a
                        href={table.qrUrl}
                        download={`QR_${safeTableLabel(table)}.png`}
                        className="bg-gold-metallic text-on-primary-fixed font-label-caps text-[11px] rounded-full px-4 py-2 flex items-center gap-1.5 shadow-lg gold-glow transition-all"
                      >
                        <span className="material-symbols-outlined text-[16px]">download</span>{' '}
                        Download
                      </a>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-4 border-t border-outline-variant/15 flex justify-between items-center relative">
                  <div className="font-mono-data text-[13px] font-medium tracking-[0.02em] text-on-surface-variant/80">
                    Seats: {table.seats || 4}
                  </div>

                  <div data-table-actions-id={table._id}>
                    <button
                      onClick={() => {
                        lastFocusedRef.current = document.activeElement;
                        setOpenDropdownId(
                          openDropdownId === table._id ? null : table._id
                        );
                      }}
                      className="text-on-surface-variant hover:text-primary transition-colors rounded p-2 min-w-[44px] min-h-[44px] flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      aria-label={`Actions for ${getTableLabel(table)}`}
                      aria-haspopup="menu"
                      aria-expanded={openDropdownId === table._id}
                      aria-controls={`table-actions-${table._id}`}
                    >
                      <span className="material-symbols-outlined text-[20px]">more_vert</span>
                    </button>

                    <AnimatePresence>
                      {openDropdownId === table._id && (
                        <motion.div
                          id={`table-actions-${table._id}`}
                          initial={{ opacity: 0, scale: 0.95, y: -10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: -10 }}
                          role="menu"
                          className="absolute right-0 bottom-full mb-2 w-36 bg-surface-container-high border border-outline-variant/30 rounded-xl shadow-xl z-20 overflow-hidden"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => handleStartEdit(table)}
                            className="w-full text-left px-4 py-3 min-h-[44px] font-body-sm text-[13px] text-on-surface hover:bg-surface-bright transition-colors flex items-center gap-2 border-b border-outline-variant/10 outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            aria-label={`Edit ${getTableLabel(table)}`}
                          >
                            <span className="material-symbols-outlined text-[16px]">edit</span>{' '}
                            Edit Table
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => handleDeleteClick(table._id)}
                            className="w-full text-left px-4 py-3 min-h-[44px] font-body-sm text-[13px] text-error hover:bg-surface-bright transition-colors flex items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            aria-label={`Delete ${getTableLabel(table)}`}
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>{' '}
                            Delete Table
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            role="status"
            aria-live="polite"
            className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] px-5 py-3 rounded-xl shadow-2xl font-body-sm text-[14px] font-medium flex items-center gap-2 ${
              toast.type === 'success'
                ? 'bg-green-600 text-white'
                : 'bg-error text-on-error'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">
              {toast.type === 'success' ? 'check_circle' : 'error'}
            </span>
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteTargetId && currentDeleteTarget && (
          <motion.div
            key="delete-dialog"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) return;
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-dialog-title"
              className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-sm p-6 shadow-2xl"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-error text-[24px]">delete</span>
                </div>
                <h2
                  id="delete-dialog-title"
                  className="font-headline-sm text-on-surface text-[20px]"
                >
                  Delete {getTableLabel(currentDeleteTarget)}?
                </h2>
              </div>
              <p className="font-body-sm text-[14px] text-on-surface-variant/80 mb-2">
                This action cannot be undone. The table and its QR record will be removed.
              </p>
              <p className="font-body-sm text-[13px] text-on-surface-variant/60 mb-6">
                {getLocationLabel(currentDeleteTarget)}
              </p>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setDeleteTargetId(null);
                    restoreFocus();
                  }}
                  className="px-5 py-2 min-h-[44px] text-on-surface hover:text-primary font-label-caps text-[12px] uppercase tracking-widest rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteTable}
                  disabled={isDeletingTable}
                  className="bg-error text-on-error px-6 py-2 min-h-[44px] rounded-lg font-label-caps text-[12px] uppercase tracking-widest flex items-center gap-2 disabled:opacity-60 outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {isDeletingTable ? (
                    <>
                      <span className="material-symbols-outlined text-[16px] animate-spin">
                        progress_activity
                      </span>
                      Deleting…
                    </>
                  ) : (
                    'Delete Table'
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isLocationModalOpen && (
          <motion.div
            key="location-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setIsLocationModalOpen(false);
                restoreFocus();
              }
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="location-dialog-title"
              className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-sm p-6 shadow-2xl overflow-y-auto max-h-[90vh]"
            >
              <div className="flex justify-between items-center mb-6">
                <h2
                  id="location-dialog-title"
                  className="font-headline-sm text-primary text-[24px]"
                >
                  New Location
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setIsLocationModalOpen(false);
                    restoreFocus();
                  }}
                  aria-label="Close"
                  className="text-on-surface-variant hover:text-primary transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <form onSubmit={submitCreateLocation} className="space-y-4">
                <div>
                  <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1 uppercase tracking-widest">
                    Location Name
                  </label>
                  <input
                    required
                    type="text"
                    value={newLocationName}
                    onChange={(e) => setNewLocationName(e.target.value)}
                    placeholder="e.g. Patio, VIP Lounge"
                    className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded px-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  />
                </div>
                <div className="pt-4 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setIsLocationModalOpen(false);
                      restoreFocus();
                    }}
                    className="px-5 py-2 min-h-[44px] text-on-surface hover:text-primary font-label-caps text-[12px] uppercase tracking-widest rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreatingLocation}
                    className="bg-primary text-on-primary px-6 py-2 min-h-[44px] rounded font-label-caps text-[12px] uppercase tracking-widest gold-glow flex items-center gap-2 disabled:opacity-60"
                  >
                    {isCreatingLocation ? (
                      <>
                        <span className="material-symbols-outlined text-[16px] animate-spin">
                          progress_activity
                        </span>
                        Creating…
                      </>
                    ) : (
                      'Save Location'
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            key="create-table-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setIsModalOpen(false);
                restoreFocus();
              }
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-table-dialog-title"
              className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-md p-6 shadow-2xl overflow-y-auto max-h-[90vh]"
            >
              <div className="flex justify-between items-center mb-6">
                <h2
                  id="create-table-dialog-title"
                  className="font-headline-sm text-primary text-[24px]"
                >
                  New Table QR
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    restoreFocus();
                  }}
                  aria-label="Close"
                  className="text-on-surface-variant hover:text-primary transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <form onSubmit={submitGenerateQR} className="space-y-4">
                <div>
                  <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1 uppercase tracking-widest">
                    Table Name / Number
                  </label>
                  <input
                    required
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. VIP Table 1"
                    className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded px-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1 uppercase tracking-widest">
                    Location / Section
                  </label>
                  <select
                    value={formData.locationId}
                    onChange={(e) => setFormData({ ...formData, locationId: e.target.value })}
                    className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded px-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none appearance-none cursor-pointer"
                    required
                  >
                    <option value="" disabled>
                      Select a location
                    </option>
                    {locations.map((loc) => (
                      <option key={loc._id || loc.name} value={loc._id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                  {locations.length === 0 && (
                    <p className="text-[12px] text-error mt-1">Please create a location first.</p>
                  )}
                </div>
                <div>
                  <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1 uppercase tracking-widest">
                    Seats
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.seats}
                    onChange={(e) =>
                      setFormData({ ...formData, seats: parseInt(e.target.value) })
                    }
                    className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded px-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  />
                </div>
                <div className="pt-4 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setIsModalOpen(false);
                      restoreFocus();
                    }}
                    className="px-5 py-2 min-h-[44px] text-on-surface hover:text-primary font-label-caps text-[12px] uppercase tracking-widest rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={locations.length === 0 || isCreatingTable}
                    className="bg-primary text-on-primary px-6 py-2 min-h-[44px] rounded font-label-caps text-[12px] uppercase tracking-widest gold-glow flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isCreatingTable ? (
                      <>
                        <span className="material-symbols-outlined text-[16px] animate-spin">
                          progress_activity
                        </span>
                        Generating…
                      </>
                    ) : (
                      'Generate & Save'
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingTable && (
          <motion.div
            key="edit-table-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setEditingTable(null);
                restoreFocus();
              }
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-table-dialog-title"
              className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-md p-6 shadow-2xl overflow-y-auto max-h-[90vh]"
            >
              <div className="flex justify-between items-center mb-6">
                <h2
                  id="edit-table-dialog-title"
                  className="font-headline-sm text-primary text-[24px]"
                >
                  Edit Table
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setEditingTable(null);
                    restoreFocus();
                  }}
                  aria-label="Close"
                  className="text-on-surface-variant hover:text-primary transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <form onSubmit={submitEditTable} className="space-y-4">
                <div>
                  <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1 uppercase tracking-widest">
                    Table Name / Number
                  </label>
                  <input
                    required
                    type="text"
                    value={editFormData.name}
                    onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                    placeholder="e.g. VIP Table 1"
                    className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded px-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1 uppercase tracking-widest">
                    Location / Section
                  </label>
                  <select
                    value={editFormData.locationId}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, locationId: e.target.value })
                    }
                    className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded px-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none appearance-none cursor-pointer"
                    required
                  >
                    <option value="" disabled>
                      Select a location
                    </option>
                    {locations.map((loc) => (
                      <option key={loc._id || loc.name} value={loc._id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1 uppercase tracking-widest">
                    Seats
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={editFormData.seats}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, seats: parseInt(e.target.value) })
                    }
                    className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded px-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  />
                </div>
                <div className="pt-4 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingTable(null);
                      restoreFocus();
                    }}
                    className="px-5 py-2 min-h-[44px] text-on-surface hover:text-primary font-label-caps text-[12px] uppercase tracking-widest rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingTable}
                    className="bg-primary text-on-primary px-6 py-2 min-h-[44px] rounded font-label-caps text-[12px] uppercase tracking-widest gold-glow flex items-center gap-2 disabled:opacity-60"
                  >
                    {isSavingTable ? (
                      <>
                        <span className="material-symbols-outlined text-[16px] animate-spin">
                          progress_activity
                        </span>
                        Saving…
                      </>
                    ) : (
                      'Save Changes'
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

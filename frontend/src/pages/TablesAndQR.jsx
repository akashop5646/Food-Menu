import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { API_BASE } from '../config';
import { useScrollLock } from '../hooks/useScrollLock';

export default function TablesAndQR() {
  const [tables, setTables] = useState([]);
  const [locations, setLocations] = useState([]);
  const [restaurantName, setRestaurantName] = useState('Mater Dhaba');
  const [initialLoading, setInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [fetchError, setFetchError] = useState(false);

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
  const [selectedTableId, setSelectedTableId] = useState(null);

  const [isCreatingTable, setIsCreatingTable] = useState(false);
  const [isSavingTable, setIsSavingTable] = useState(false);
  const [isCreatingLocation, setIsCreatingLocation] = useState(false);
  const [isDeletingTable, setIsDeletingTable] = useState(false);

  const [toast, setToast] = useState(null);

  const fetchInFlightRef = useRef(false);
  const hasLoadedOnceRef = useRef(false);
  const toastTimeoutRef = useRef(null);
  const lastFocusedRef = useRef(null);

  const createInputRef = useRef(null);
  const editInputRef = useRef(null);
  const locationInputRef = useRef(null);
  const deleteCancelButtonRef = useRef(null);
  const drawerCloseButtonRef = useRef(null);

  // Focus management on open
  useEffect(() => {
    if (isModalOpen) {
      setTimeout(() => createInputRef.current?.focus(), 50);
    }
  }, [isModalOpen]);

  useEffect(() => {
    if (isLocationModalOpen) {
      setTimeout(() => locationInputRef.current?.focus(), 50);
    }
  }, [isLocationModalOpen]);

  useEffect(() => {
    if (editingTable) {
      setTimeout(() => editInputRef.current?.focus(), 50);
    }
  }, [editingTable]);

  useEffect(() => {
    if (deleteTargetId) {
      setTimeout(() => deleteCancelButtonRef.current?.focus(), 50);
    }
  }, [deleteTargetId]);

  useEffect(() => {
    if (selectedTableId) {
      setTimeout(() => drawerCloseButtonRef.current?.focus(), 50);
    }
  }, [selectedTableId]);

  const showToast = useCallback((message, type) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  const getLocationLabel = useCallback((table) => {
    if (!table) return 'Main Dining Room';
    return table.locationName || table.location || 'Main Dining Room';
  }, []);

  const getLocationIdForTable = useCallback((table) => {
    if (!table) return '';
    return String(table.locationId || locations.find(loc => loc.name === table.location)?._id || '');
  }, [locations]);

  const getTableLabel = useCallback((table) => {
    if (!table) return 'Table';
    return table.name || (table.number ? `Table ${table.number}` : 'Table');
  }, []);

  const deleteTarget = useMemo(
    () => (deleteTargetId ? tables.find((t) => String(t._id) === String(deleteTargetId)) || null : null),
    [deleteTargetId, tables]
  );

  const selectedTable = useMemo(
    () => (selectedTableId ? tables.find((t) => String(t._id) === String(selectedTableId)) || null : null),
    [selectedTableId, tables]
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
    [tables, selectedFilter, searchQuery, getLocationIdForTable]
  );

  const hasOpenOverlay = isModalOpen || isLocationModalOpen || !!editingTable || !!deleteTargetId || !!selectedTableId;

  useScrollLock(hasOpenOverlay);

  // Escape key handler: Escape closes the topmost active dialog, or dropdown
  useEffect(() => {
    if (!hasOpenOverlay && !openDropdownId) return;

    const handleEscape = (e) => {
      if (e.key !== 'Escape') return;
      
      // Do not close multiple overlays at once, prioritize topmost
      if (deleteTargetId) {
        setDeleteTargetId(null);
        restoreFocus();
      } else if (editingTable) {
        setEditingTable(null);
        restoreFocus();
      } else if (isLocationModalOpen) {
        setIsLocationModalOpen(false);
        restoreFocus();
      } else if (isModalOpen) {
        setIsModalOpen(false);
        restoreFocus();
      } else if (selectedTableId) {
        setSelectedTableId(null);
        restoreFocus();
      } else if (openDropdownId) {
        setOpenDropdownId(null);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [deleteTargetId, editingTable, isModalOpen, isLocationModalOpen, selectedTableId, openDropdownId, hasOpenOverlay]);

  // Click outside to close three-dot menu dropdown
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

    setFetchError(false); // Clear previous fetch error before new request

    if (hasLoadedOnceRef.current) {
      setIsRefreshing(true);
    }

    try {
      const [tablesRes, locsRes, profileRes] = await Promise.all([
        fetch(API_BASE + '/api/tables'),
        fetch(API_BASE + '/api/locations'),
        fetch(API_BASE + '/api/settings/restaurant-profile').catch(() => null),
      ]);

      if (!tablesRes.ok || !locsRes.ok) throw new Error('Fetch failed');

      const tablesData = await tablesRes.json();
      const locsData = await locsRes.json();

      setTables(Array.isArray(tablesData) ? tablesData : tablesData.tables || []);
      setLocations(Array.isArray(locsData) ? locsData : []);
      
      if (profileRes && profileRes.ok) {
        const profileData = await profileRes.json();
        if (profileData && profileData.restaurantName) {
          setRestaurantName(profileData.restaurantName);
        }
      }

      setFetchError(false);

      if (!hasLoadedOnceRef.current) {
        hasLoadedOnceRef.current = true;
      }
    } catch (err) {
      console.error(err);
      if (!hasLoadedOnceRef.current) {
        setFetchError(true);
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

  const handleConfirmDelete = async () => {
    if (!deleteTargetId || isDeletingTable) return;
    setIsDeletingTable(true);
    try {
      const res = await fetch(`${API_BASE}/api/tables/${deleteTargetId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        if (String(selectedTableId) === String(deleteTargetId)) {
          setSelectedTableId(null);
        }
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
    if (isRetrying) return;
    setIsRetrying(true);
    setFetchError(false);
    fetchData();
  };

  const handleDeleteClick = (tableId) => {
    setOpenDropdownId(null);
    setDeleteTargetId(tableId);
  };

  const safeTableLabel = (table) => {
    const label = table.name?.trim() || `Table ${table.number ?? ''}`.trim() || 'Table';
    return label.replace(/\s+/g, '_');
  };

  const handleDownloadQR = useCallback(
    (table) => {
      if (!table?.qrUrl) {
        showToast('QR code is not available.', 'error');
        return;
      }

      const link = document.createElement('a');
      link.href = table.qrUrl;
      link.download = `QR_${safeTableLabel(table)}.png`;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      showToast('QR code download started', 'success');
    },
    [showToast]
  );

  const handleCopyMenuLink = useCallback(
    async (table) => {
      if (!table?.orderUrl) {
        showToast('Menu link is not available.', 'error');
        return;
      }

      try {
        await navigator.clipboard.writeText(table.orderUrl);
        showToast('Menu link copied', 'success');
      } catch (error) {
        console.error('Failed to copy menu link:', error);
        showToast('Unable to copy the menu link.', 'error');
      }
    },
    [showToast]
  );

  const escapeHtml = (value = '') =>
    String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');

  const handlePrintQR = useCallback(
    (table) => {
      if (!table?.qrUrl) {
        showToast('QR code is not available.', 'error');
        return;
      }

      const printWindow = window.open('', '_blank', 'width=720,height=900');
      if (!printWindow) {
        showToast('Print window was blocked. Please allow pop-ups and try again.', 'error');
        return;
      }

      const safeName = escapeHtml(getTableLabel(table));
      const safeLocation = escapeHtml(getLocationLabel(table));
      const safeRestaurantName = escapeHtml(restaurantName || 'Aurum Restaurant');

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Print Menu Card — ${safeName}</title>
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
          <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&family=Playfair+Display:ital,wght@0,600;0,700;1,600&display=swap" rel="stylesheet">
          <style>
            @page {
              size: A4;
              margin: 15mm;
            }
            body {
              margin: 0;
              padding: 0;
              font-family: 'Outfit', -apple-system, BlinkMacSystemFont, Arial, sans-serif;
              background-color: #ffffff;
              color: #121212;
              display: flex;
              justify-content: center;
              align-items: flex-start;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .print-card {
              width: 100%;
              max-width: 440px;
              padding: 44px 36px;
              border: 1px solid #d4af37;
              border-radius: 24px;
              text-align: center;
              box-sizing: border-box;
              background-color: #ffffff;
              box-shadow: 0 4px 30px rgba(0, 0, 0, 0.02);
              margin-top: 10px;
            }
            .gold-accent {
              width: 50px;
              height: 3px;
              background: linear-gradient(90deg, #c5a880, #e5c07b, #c5a880);
              margin: 0 auto 20px auto;
              border-radius: 2px;
            }
            .restaurant-name {
              font-family: 'Playfair Display', serif;
              font-size: 26px;
              font-style: italic;
              font-weight: 700;
              color: #1a1a1a;
              margin: 0;
              line-height: 1.2;
            }
            .digital-concierge {
              font-size: 11px;
              font-weight: 700;
              letter-spacing: 0.25em;
              color: #8c7e6c;
              text-transform: uppercase;
              margin: 6px 0 16px 0;
            }
            .diamond {
              color: #e5c07b;
              font-size: 10px;
              margin: 0 auto 16px auto;
              display: block;
            }
            .main-heading {
              font-size: 20px;
              font-weight: 800;
              letter-spacing: 0.06em;
              color: #111111;
              text-transform: uppercase;
              margin: 0 0 6px 0;
            }
            .sub-heading {
              font-size: 13px;
              color: #666666;
              margin: 0 0 24px 0;
              font-weight: 400;
            }
            .qr-container-card {
              display: inline-block;
              border: 1px solid rgba(229, 192, 123, 0.4);
              border-radius: 20px;
              padding: 20px;
              background-color: #ffffff;
              box-shadow: 0 8px 24px rgba(229, 192, 123, 0.08);
              margin-bottom: 24px;
            }
            .qr-quiet-zone {
              background-color: #ffffff;
              padding: 16px;
              border-radius: 12px;
              display: flex;
              justify-content: center;
              align-items: center;
            }
            .qr-image {
              width: 210px;
              height: 210px;
              display: block;
              object-fit: contain;
            }
            .table-name {
              font-size: 28px;
              font-weight: 800;
              letter-spacing: 0.04em;
              color: #1a1a1a;
              text-transform: uppercase;
              margin: 0;
            }
            .table-location {
              font-size: 12px;
              font-weight: 600;
              color: #8c7e6c;
              text-transform: uppercase;
              letter-spacing: 0.08em;
              margin: 4px 0 24px 0;
            }
            .steps-row {
              display: flex;
              justify-content: center;
              align-items: center;
              gap: 10px;
              margin-bottom: 24px;
            }
            .step-text {
              font-size: 11px;
              font-weight: 700;
              letter-spacing: 0.12em;
              text-transform: uppercase;
              color: #1a1a1a;
            }
            .step-sep {
              color: #e5c07b;
              font-size: 8px;
            }
            .help-fallback {
              font-size: 10px;
              color: #888888;
              border-top: 1px dashed rgba(0, 0, 0, 0.08);
              padding-top: 16px;
              margin-bottom: 20px;
              max-width: 280px;
              margin-left: auto;
              margin-right: auto;
              line-height: 1.4;
            }
            .footer-brand {
              font-size: 9px;
              font-weight: 700;
              letter-spacing: 0.18em;
              color: #b0a494;
              text-transform: uppercase;
            }
            @media print {
              body {
                background-color: #ffffff;
              }
              .print-card {
                box-shadow: none;
                margin-top: 0;
              }
            }
          </style>
        </head>
        <body>
          <div class="print-card">
            <div class="gold-accent"></div>
            <h1 class="restaurant-name">${safeRestaurantName}</h1>
            <div class="digital-concierge">Digital Concierge</div>
            <div class="diamond">◆</div>
            
            <h2 class="main-heading">SCAN TO VIEW OUR MENU</h2>
            <p class="sub-heading">Browse, order and enjoy from your table</p>
            
            <div class="qr-container-card">
              <div class="qr-quiet-zone">
                <img id="print-qr" class="qr-image" src="${table.qrUrl}" alt="QR Code for ${safeName}" />
              </div>
            </div>
            
            <h3 class="table-name">${safeName}</h3>
            <div class="table-location">${safeLocation}</div>
            
            <div class="steps-row">
              <span class="step-text">Scan</span>
              <span class="step-sep">•</span>
              <span class="step-text">Browse</span>
              <span class="step-sep">•</span>
              <span class="step-text">Order</span>
            </div>
            
            <div class="help-fallback">
              Having trouble scanning? Ask our staff for assistance.
            </div>
            
            <div class="footer-brand">
              Powered by Aurum Table
            </div>
          </div>
          
          <script>
            const qrImage = document.getElementById('print-qr');
            const printPage = () => {
              window.focus();
              window.print();
            };
            if (qrImage.complete) {
              printPage();
            } else {
              qrImage.onload = printPage;
              qrImage.onerror = printPage;
            }
            window.onafterprint = () => {
              window.close();
            };
          </script>
        </body>
        </html>
      `);
      printWindow.document.close();
    },
    [getLocationLabel, getTableLabel, showToast, restaurantName]
  );

  const handleShareTable = useCallback(
    async (table) => {
      if (!table?.orderUrl) {
        showToast('Menu link is not available.', 'error');
        return;
      }

      try {
        await navigator.share({
          title: getTableLabel(table),
          text: `View the menu for ${getTableLabel(table)}`,
          url: table.orderUrl
        });
      } catch (error) {
        if (error?.name !== 'AbortError') {
          console.error('Unable to share table menu:', error);
          showToast('Unable to share the menu link.', 'error');
        }
      }
    },
    [showToast, getTableLabel]
  );



  const renderSkeletons = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-gutter pb-8">
      <div className="sr-only" role="status">
        Loading tables and QR codes
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="bg-surface-container/40 rounded-2xl p-5 border border-primary/15 animate-pulse"
          aria-hidden="true"
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
        className="bg-primary text-on-primary font-title-md text-[14px] font-semibold px-6 py-2.5 rounded-xl gold-glow flex items-center gap-2 disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-primary outline-none cursor-pointer"
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
        className="bg-primary text-on-primary font-title-md text-[14px] font-semibold px-6 py-2.5 rounded-xl gold-glow flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-primary outline-none cursor-pointer"
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
          setOpenDropdownId(null);
        }}
        className="bg-surface-container-high border border-outline-variant/50 text-on-surface font-title-md text-[14px] font-semibold px-6 py-2.5 rounded-xl hover:border-primary/50 transition-colors flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-primary outline-none cursor-pointer"
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
              onChange={(e) => {
                setSelectedFilter(e.target.value);
                setOpenDropdownId(null);
              }}
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

          <div className="relative group flex-1 min-w-[160px] sm:flex-none sm:w-64">
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

        <div className="flex flex-wrap gap-3 sm:flex-shrink-0">
          <button
            onClick={() => {
              setOpenDropdownId(null);
              lastFocusedRef.current = document.activeElement;
              setIsLocationModalOpen(true);
            }}
            className="bg-surface-container-high border border-outline-variant/50 text-on-surface font-title-md text-[14px] sm:text-[16px] font-semibold px-4 py-2.5 rounded-xl hover:border-primary/50 transition-colors flex items-center gap-2 shadow-sm focus-visible:ring-2 focus-visible:ring-primary outline-none cursor-pointer"
            aria-label="Create new location"
          >
            <span className="material-symbols-outlined text-[18px] hidden sm:block">
              add_location
            </span>
            <span className="hidden sm:block">Create Location</span>
            <span className="sm:hidden">Location +</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (locations.length > 0 && !formData.locationId) {
                setFormData((prev) => ({ ...prev, locationId: String(locations[0]._id) }));
              }
              setOpenDropdownId(null);
              lastFocusedRef.current = document.activeElement;
              setIsModalOpen(true);
            }}
            className="bg-primary text-on-primary font-title-md text-[14px] sm:text-[16px] font-semibold px-4 sm:px-6 py-2.5 rounded-xl ripple shadow-[0_0_15px_rgba(212,175,55,0.3)] hover:shadow-[0_0_25px_rgba(212,175,55,0.5)] transition-shadow duration-300 flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-primary outline-none cursor-pointer"
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

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        lastFocusedRef.current = event.currentTarget;
                        setOpenDropdownId(null);
                        setSelectedTableId(table._id);
                      }}
                      className="text-primary hover:text-primary-hover font-label-caps text-[11px] font-bold tracking-wider flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-primary/10 transition-colors focus-visible:ring-2 focus-visible:ring-primary outline-none cursor-pointer"
                      aria-label={`View details for ${getTableLabel(table)}`}
                    >
                      <span className="material-symbols-outlined text-[16px]">visibility</span>
                      View Details
                    </button>

                    <div data-table-actions-id={table._id} className="relative">
                      <button
                        onClick={() => {
                          lastFocusedRef.current = document.activeElement;
                          setOpenDropdownId(
                            openDropdownId === table._id ? null : table._id
                          );
                        }}
                        className="text-on-surface-variant hover:text-primary transition-colors rounded p-2 min-w-[44px] min-h-[44px] flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        aria-label={`Actions for ${table.name || `Table ${table.number || ''}`}`}
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
                              aria-label={`Edit ${table.name || `Table ${table.number || ''}`}`}
                            >
                              <span className="material-symbols-outlined text-[16px]">edit</span>{' '}
                              Edit Table
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => handleDeleteClick(table._id)}
                              className="w-full text-left px-4 py-3 min-h-[44px] font-body-sm text-[13px] text-error hover:bg-surface-bright transition-colors flex items-colors gap-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              aria-label={`Delete ${table.name || `Table ${table.number || ''}`}`}
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
        {deleteTargetId && deleteTarget && (
          <motion.div
            key="delete-dialog"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="app-overlay-backdrop bg-black/60 backdrop-blur-sm fixed inset-0 z-[100] flex items-center justify-center p-4"
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
              className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-sm p-6 shadow-2xl app-modal-wrapper"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-error text-[24px]">delete</span>
                </div>
                <h2
                  id="delete-dialog-title"
                  className="font-headline-sm text-on-surface text-[20px]"
                >
                  Delete {getTableLabel(deleteTarget)}?
                </h2>
              </div>
              <p className="font-body-sm text-[14px] text-on-surface-variant/80 mb-2">
                This action cannot be undone. The table and its QR record will be removed.
              </p>
              <p className="font-body-sm text-[13px] text-on-surface-variant/60 mb-6">
                {getLocationLabel(deleteTarget)}
              </p>
              <div className="flex justify-end gap-3">
                <button
                  ref={deleteCancelButtonRef}
                  type="button"
                  onClick={() => {
                    setDeleteTargetId(null);
                    restoreFocus();
                  }}
                  className="px-5 py-2 min-h-[44px] text-on-surface hover:text-primary font-label-caps text-[12px] uppercase tracking-widest rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={isDeletingTable}
                  className="bg-error text-on-error px-6 py-2 min-h-[44px] rounded-lg font-label-caps text-[12px] uppercase tracking-widest flex items-center gap-2 disabled:opacity-60 outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
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
            className="app-overlay-backdrop bg-black/60 backdrop-blur-sm fixed inset-0 z-[100] flex items-center justify-center p-4"
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
              className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-sm p-6 shadow-2xl app-modal-wrapper flex flex-col"
            >
              <header className="app-overlay-header flex justify-between items-center mb-6 shrink-0">
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
                  aria-label="Close dialog"
                  className="text-on-surface-variant hover:text-primary transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-primary outline-none cursor-pointer"
                >
                  <span className="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              </header>
              <form onSubmit={submitCreateLocation} className="flex-1 min-h-0 flex flex-col">
                <div className="app-overlay-scroll-body space-y-4 mb-4 pr-1">
                <div>
                  <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1 uppercase tracking-widest">
                    Location Name
                  </label>
                  <input
                    ref={locationInputRef}
                    required
                    type="text"
                    value={newLocationName}
                    onChange={(e) => setNewLocationName(e.target.value)}
                    placeholder="e.g. Patio, VIP Lounge"
                    className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded px-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  />
                </div>
                </div>
                <footer className="app-overlay-footer pt-4 flex justify-end gap-3 border-t border-outline-variant/10 shrink-0">
                  <button
                     type="button"
                     onClick={() => {
                       setIsLocationModalOpen(false);
                       restoreFocus();
                     }}
                     className="px-5 py-2 min-h-[44px] text-on-surface hover:text-primary font-label-caps text-[12px] uppercase tracking-widest rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreatingLocation}
                    className="bg-primary text-on-primary px-6 py-2 min-h-[44px] rounded font-label-caps text-[12px] uppercase tracking-widest gold-glow flex items-center gap-2 disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-primary outline-none cursor-pointer"
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
                </footer>
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
            className="app-overlay-backdrop bg-black/60 backdrop-blur-sm fixed inset-0 z-[100] flex items-center justify-center p-4"
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
              className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-md p-6 shadow-2xl app-modal-wrapper flex flex-col"
            >
              <header className="app-overlay-header flex justify-between items-center mb-6 shrink-0">
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
                  aria-label="Close dialog"
                  className="text-on-surface-variant hover:text-primary transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-primary outline-none cursor-pointer"
                >
                  <span className="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              </header>
              <form onSubmit={submitGenerateQR} className="flex-1 min-h-0 flex flex-col">
                <div className="app-overlay-scroll-body space-y-4 mb-4 pr-1">
                <div>
                  <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1 uppercase tracking-widest">
                    Table Name / Number
                  </label>
                  <input
                    ref={createInputRef}
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
                </div>
                <footer className="app-overlay-footer pt-4 flex justify-end gap-3 border-t border-outline-variant/10 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setIsModalOpen(false);
                      restoreFocus();
                    }}
                    className="px-5 py-2 min-h-[44px] text-on-surface hover:text-primary font-label-caps text-[12px] uppercase tracking-widest rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={locations.length === 0 || isCreatingTable}
                    className="bg-primary text-on-primary px-6 py-2 min-h-[44px] rounded font-label-caps text-[12px] uppercase tracking-widest gold-glow flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-primary outline-none cursor-pointer"
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
                </footer>
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
            className="app-overlay-backdrop bg-black/60 backdrop-blur-sm fixed inset-0 z-[100] flex items-center justify-center p-4"
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
              className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-md p-6 shadow-2xl app-modal-wrapper flex flex-col"
            >
              <header className="app-overlay-header flex justify-between items-center mb-6 shrink-0">
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
                  aria-label="Close dialog"
                  className="text-on-surface-variant hover:text-primary transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-primary outline-none cursor-pointer"
                >
                  <span className="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              </header>
              <form onSubmit={submitEditTable} className="flex-1 min-h-0 flex flex-col">
                <div className="app-overlay-scroll-body space-y-4 mb-4 pr-1">
                <div>
                  <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1 uppercase tracking-widest">
                    Table Name / Number
                  </label>
                  <input
                    ref={editInputRef}
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
                </div>
                <footer className="app-overlay-footer pt-4 flex justify-end gap-3 border-t border-outline-variant/10 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingTable(null);
                      restoreFocus();
                    }}
                    className="px-5 py-2 min-h-[44px] text-on-surface hover:text-primary font-label-caps text-[12px] uppercase tracking-widest rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingTable}
                    className="bg-primary text-on-primary px-6 py-2 min-h-[44px] rounded font-label-caps text-[12px] uppercase tracking-widest gold-glow flex items-center gap-2 disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-primary outline-none cursor-pointer"
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
                </footer>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedTableId && selectedTable && (
          <motion.div
            key="details-drawer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="app-overlay-backdrop bg-black/60 backdrop-blur-sm fixed inset-0 z-[90] flex justify-end md:left-[280px]"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setSelectedTableId(null);
                restoreFocus();
              }
            }}
          >
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.25 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="table-details-drawer-title"
              tabIndex={-1}
              className="app-drawer-panel bg-surface-container-low border-l border-outline-variant/30 w-full max-w-md h-full flex flex-col shadow-2xl relative overflow-hidden ml-auto"
            >
              {/* Header */}
              <header className="app-overlay-header p-6 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-low shrink-0">
                <div>
                  <span className="block font-label-caps text-[10px] tracking-widest text-primary font-bold uppercase mb-1">
                    Table Details
                  </span>
                  <h2
                    id="table-details-drawer-title"
                    className="font-headline-sm text-on-surface text-[20px] font-semibold"
                  >
                    {getTableLabel(selectedTable)}
                  </h2>
                  <p className="font-body-sm text-[13px] text-on-surface-variant/70 mt-0.5">
                    {getLocationLabel(selectedTable)}
                  </p>
                </div>
                <button
                  ref={drawerCloseButtonRef}
                  type="button"
                  onClick={() => {
                    setSelectedTableId(null);
                    restoreFocus();
                  }}
                  aria-label="Close table details"
                  className="text-on-surface-variant hover:text-primary transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-primary outline-none cursor-pointer"
                >
                  <span className="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              </header>

              {/* Scrollable Content */}
              <div className="app-overlay-scroll-body flex-1 overflow-y-auto overscroll-contain p-6 space-y-8 pb-24">
                {/* QR Preview Section */}
                <div className="flex flex-col items-center">
                  <div className="w-full max-w-[280px] aspect-square bg-white rounded-2xl flex items-center justify-center p-4 border border-primary/10 shadow-md">
                    {selectedTable.qrUrl ? (
                      <img
                        src={selectedTable.qrUrl}
                        alt={`QR code for ${getTableLabel(selectedTable)}`}
                        className="w-full h-full object-contain rounded-lg"
                      />
                    ) : (
                      <div className="flex flex-col items-center text-black/30">
                        <span className="material-symbols-outlined text-[64px]" aria-hidden="true">
                          qr_code_2
                        </span>
                        <span className="text-[12px] font-medium mt-2">QR code is not available</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions Grid */}
                <div className="grid grid-cols-2 gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleDownloadQR(selectedTable)}
                    disabled={!selectedTable.qrUrl}
                    className="flex items-center justify-center gap-2 bg-surface-container-high border border-outline-variant/40 text-on-surface hover:text-primary disabled:opacity-40 disabled:hover:text-on-surface hover:border-primary/40 px-4 py-3 min-h-[44px] rounded-xl font-title-md text-[13px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-primary outline-none cursor-pointer disabled:cursor-not-allowed"
                    aria-label={`Download QR code for ${getTableLabel(selectedTable)}`}
                  >
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">download</span>
                    Download
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopyMenuLink(selectedTable)}
                    disabled={!selectedTable.orderUrl}
                    className="flex items-center justify-center gap-2 bg-surface-container-high border border-outline-variant/40 text-on-surface hover:text-primary disabled:opacity-40 disabled:hover:text-on-surface hover:border-primary/40 px-4 py-3 min-h-[44px] rounded-xl font-title-md text-[13px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-primary outline-none cursor-pointer disabled:cursor-not-allowed"
                    aria-label={`Copy menu link for ${getTableLabel(selectedTable)}`}
                  >
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">content_copy</span>
                    Copy Link
                  </button>

                  <button
                    type="button"
                    onClick={() => handlePrintQR(selectedTable)}
                    disabled={!selectedTable.qrUrl}
                    className="flex items-center justify-center gap-2 bg-surface-container-high border border-outline-variant/40 text-on-surface hover:text-primary disabled:opacity-40 disabled:hover:text-on-surface hover:border-primary/40 px-4 py-3 min-h-[44px] rounded-xl font-title-md text-[13px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-primary outline-none cursor-pointer disabled:cursor-not-allowed"
                    aria-label={`Print QR code for ${getTableLabel(selectedTable)}`}
                  >
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">print</span>
                    Print QR
                  </button>

                  {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                    <button
                      type="button"
                      onClick={() => handleShareTable(selectedTable)}
                      className="flex items-center justify-center gap-2 bg-surface-container-high border border-outline-variant/40 text-on-surface hover:text-primary px-4 py-3 min-h-[44px] rounded-xl font-title-md text-[13px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-primary outline-none cursor-pointer"
                      aria-label={`Share menu link for ${getTableLabel(selectedTable)}`}
                    >
                      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">share</span>
                      Share
                    </button>
                  )}
                </div>

                {/* Table Info Fields */}
                <div className="space-y-4 pt-2 border-t border-outline-variant/15">
                  <div>
                    <span className="block font-label-caps text-[10px] tracking-wider text-on-surface-variant/60 font-semibold uppercase">
                      Table Name / Number
                    </span>
                    <span className="text-[15px] font-medium text-on-surface block mt-0.5">
                      {getTableLabel(selectedTable)}
                    </span>
                  </div>

                  <div>
                    <span className="block font-label-caps text-[10px] tracking-wider text-on-surface-variant/60 font-semibold uppercase">
                      Location / Section
                    </span>
                    <span className="text-[15px] font-medium text-on-surface block mt-0.5">
                      {getLocationLabel(selectedTable)}
                    </span>
                  </div>

                  <div>
                    <span className="block font-label-caps text-[10px] tracking-wider text-on-surface-variant/60 font-semibold uppercase">
                      Seats
                    </span>
                    <span className="text-[15px] font-mono-data font-medium text-on-surface block mt-0.5">
                      {selectedTable.seats || 4}
                    </span>
                  </div>

                  <div>
                    <span className="block font-label-caps text-[10px] tracking-wider text-on-surface-variant/60 font-semibold uppercase">
                      Menu Link
                    </span>
                    {selectedTable.orderUrl ? (
                      <span className="text-[13px] font-medium text-primary hover:underline break-all block mt-0.5 select-all">
                        {selectedTable.orderUrl}
                      </span>
                    ) : (
                      <span className="text-[13px] font-medium text-on-surface-variant/50 block mt-0.5 italic">
                        Menu link is not available
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Drawer Footer Actions */}
              <div className="absolute bottom-0 left-0 w-full p-6 bg-surface-container-low border-t border-outline-variant/20 flex gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => handleStartEdit(selectedTable)}
                  className="flex-1 bg-surface-container-high border border-outline-variant/40 text-on-surface hover:text-primary px-4 py-2.5 min-h-[44px] rounded-xl font-label-caps text-[12px] font-bold tracking-widest uppercase transition-all hover:border-primary/45 focus-visible:ring-2 focus-visible:ring-primary outline-none cursor-pointer"
                >
                  Edit Table
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTargetId(selectedTable._id)}
                  className="flex-1 bg-error/10 hover:bg-error text-error hover:text-on-error border border-error/20 px-4 py-2.5 min-h-[44px] rounded-xl font-label-caps text-[12px] font-bold tracking-widest uppercase transition-all focus-visible:ring-2 focus-visible:ring-primary outline-none cursor-pointer"
                >
                  Delete Table
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

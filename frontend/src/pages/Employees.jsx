import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { API_BASE } from '../config';

const getInitials = (name, email) => {
  const base = name || email || 'U';
  return base
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('') || 'U';
};

const formatDate = (dateString) => {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

const formatDateTime = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const ACTION_OPTIONS = [
  { value: 'EMPLOYEE_LOGIN', label: 'Employee Login' },
  { value: 'ORDER_CREATED', label: 'Order Created' },
  { value: 'ORDER_STATUS_CHANGED', label: 'Order Status Changed' },
  { value: 'ORDER_PAYMENT_VERIFIED', label: 'Order Payment Verified' },
  { value: 'MENU_ITEM_CREATED', label: 'Menu Item Created' },
  { value: 'MENU_ITEM_UPDATED', label: 'Menu Item Updated' },
  { value: 'MENU_ITEM_AVAILABILITY_CHANGED', label: 'Menu Item Availability Changed' },
  { value: 'MENU_BULK_AVAILABILITY_CHANGED', label: 'Menu Bulk Availability Changed' },
  { value: 'STAFF_ACCOUNT_CREATED', label: 'Staff Account Created' },
  { value: 'STAFF_ROLE_CHANGED', label: 'Staff Role Changed' },
  { value: 'STAFF_ACCOUNT_DELETED', label: 'Staff Account Deleted' },
  { value: 'SETTLEMENT_CONFIGURATION_UPDATED', label: 'Settlement Configuration Updated' },
  { value: 'CONVENIENCE_FEE_UPDATED', label: 'Convenience Fee Updated' }
];

const ENTITY_TYPE_OPTIONS = [
  { value: 'AUTHENTICATION', label: 'Authentication' },
  { value: 'ORDER', label: 'Orders' },
  { value: 'MENU_ITEM', label: 'Menu Items' },
  { value: 'STAFF', label: 'Staff Management' },
  { value: 'SETTLEMENT_CONFIG', label: 'Settlement Settings' },
  { value: 'CONFIGURATION', label: 'System Configuration' }
];

const renderContextDetails = (event) => {
  const { action, context } = event;
  if (!context || Object.keys(context).length === 0) return <span className="text-on-surface-variant/60">—</span>;

  switch (action) {
    case 'MENU_ITEM_CREATED':
      return (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {context.price !== undefined && <span className="bg-surface-container-high px-2 py-0.5 rounded text-on-surface font-mono">₹{context.price}</span>}
          {context.categories && context.categories.length > 0 && (
            <span className="bg-primary/10 text-primary px-2 py-0.5 rounded">
              Categories: {context.categories.join(', ')}
            </span>
          )}
        </div>
      );
    case 'MENU_ITEM_UPDATED':
      return (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {context.updatedFields && context.updatedFields.length > 0 && (
            <span className="bg-secondary/15 text-secondary px-2 py-0.5 rounded">
              Fields: {context.updatedFields.join(', ')}
            </span>
          )}
          {context.availableTransition !== undefined && context.availableTransition !== null && (
            <span className="bg-surface-container-high px-2 py-0.5 rounded text-on-surface">
              Availability: {context.availableTransition ? 'ON' : 'OFF'}
            </span>
          )}
        </div>
      );
    case 'MENU_ITEM_AVAILABILITY_CHANGED':
      return (
        <span className="text-xs bg-surface-container-high px-2 py-0.5 rounded text-on-surface">
          Availability: {context.available ? 'ON' : 'OFF'}
        </span>
      );
    case 'MENU_BULK_AVAILABILITY_CHANGED':
      return (
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="bg-surface-container-high px-2 py-0.5 rounded text-on-surface">
            Count: {context.count || 0}
          </span>
          <span className={`px-2 py-0.5 rounded font-semibold ${context.available ? 'bg-success/10 text-success' : 'bg-error/10 text-error'}`}>
            {context.available ? 'Enabled' : 'Disabled'}
          </span>
        </div>
      );
    case 'STAFF_ROLE_CHANGED':
      return (
        <span className="text-xs bg-surface-container-high px-2 py-0.5 rounded text-on-surface">
          Role: {context.fromRole} → {context.toRole}
        </span>
      );
    case 'STAFF_ACCOUNT_CREATED':
      return (
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="bg-surface-container-high px-2 py-0.5 rounded text-on-surface font-mono">Name: {context.name}</span>
          <span className="bg-surface-container-high px-2 py-0.5 rounded text-on-surface">Auth: {context.provider}</span>
        </div>
      );
    case 'SETTLEMENT_CONFIGURATION_UPDATED':
      return (
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="bg-surface-container-high px-2 py-0.5 rounded text-on-surface font-mono">Action: {context.action}</span>
          {context.version !== undefined && <span className="bg-surface-container-high px-2 py-0.5 rounded text-on-surface">v{context.version}</span>}
          {context.totalBasisPoints !== undefined && <span className="bg-surface-container-high px-2 py-0.5 rounded text-on-surface">{(context.totalBasisPoints / 100).toFixed(2)}%</span>}
        </div>
      );
    case 'CONVENIENCE_FEE_UPDATED':
      return (
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className={`px-2 py-0.5 rounded font-semibold ${context.enabled ? 'bg-success/10 text-success' : 'bg-error/10 text-error'}`}>
            {context.enabled ? 'Enabled' : 'Disabled'}
          </span>
          {context.amount !== undefined && <span className="bg-surface-container-high px-2 py-0.5 rounded text-on-surface font-mono">₹{context.amount}</span>}
        </div>
      );
    case 'ORDER_STATUS_CHANGED':
      return (
        <span className="text-xs bg-surface-container-high px-2 py-0.5 rounded text-on-surface">
          Status: {context.fromStatus || '—'} → {context.toStatus}
        </span>
      );
    case 'ORDER_CREATED':
      return (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {context.total !== undefined && <span className="bg-surface-container-high px-2 py-0.5 rounded text-on-surface font-mono">₹{context.total}</span>}
          {context.itemsCount !== undefined && <span className="bg-surface-container-high px-2 py-0.5 rounded text-on-surface">{context.itemsCount} Items</span>}
        </div>
      );
    case 'ORDER_PAYMENT_VERIFIED':
      return (
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="bg-surface-container-high px-2 py-0.5 rounded text-on-surface">Method: {context.paymentMethod}</span>
          {context.amount !== undefined && <span className="bg-surface-container-high px-2 py-0.5 rounded text-on-surface font-mono">₹{context.amount}</span>}
        </div>
      );
    default:
      return (
        <div className="flex flex-wrap gap-1.5 text-xs text-on-surface-variant font-mono">
          {Object.entries(context).map(([key, val]) => (
            <span key={key} className="bg-surface-container-high px-1.5 py-0.5 rounded">
              {key}: {Array.isArray(val) ? val.join(', ') : String(val)}
            </span>
          ))}
        </div>
      );
  }
};

export default function Employees() {
  // Tabs State
  const [activeTab, setActiveTab] = useState('directory'); // 'directory' or 'activity'

  // Directory State
  const [employees, setEmployees] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Directory Filtering & Pagination
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedRole, setSelectedRole] = useState('All');
  const [selectedSort, setSelectedSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  // Activity Log State
  const [activities, setActivities] = useState([]);
  const [activitySummary, setActivitySummary] = useState(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState('');

  // Activity Filtering & Pagination
  const [activityPage, setActivityPage] = useState(1);
  const [activityTotalPages, setActivityTotalPages] = useState(1);
  const [activityTotalItems, setActivityTotalItems] = useState(0);
  const [filterEmployeeId, setFilterEmployeeId] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterEntityType, setFilterEntityType] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  
  // Dropdown options
  const [dropdownEmployees, setDropdownEmployees] = useState([]);

  // Drawer State
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState('');
  const [drawerActivities, setDrawerActivities] = useState([]);
  const [drawerActivitiesLoading, setDrawerActivitiesLoading] = useState(false);

  // Refs for tracking unmount and request concurrency
  const activeFetchRef = useRef(null);
  const activeActivityFetchRef = useRef(null);
  const activeDrawerFetchRef = useRef(null);
  const isMountedRef = useRef(true);

  // 1. Debounce Search Input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);

    return () => clearTimeout(handler);
  }, [search]);

  // Reset pages when filters change
  useEffect(() => {
    setPage(1);
  }, [selectedRole, selectedSort]);

  useEffect(() => {
    setActivityPage(1);
  }, [filterEmployeeId, filterAction, filterEntityType, filterFrom, filterTo]);

  // Fetch employees list and summary
  const fetchEmployeesData = async () => {
    if (activeFetchRef.current) {
      activeFetchRef.current.abort();
    }
    const controller = new AbortController();
    activeFetchRef.current = controller;

    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      params.append('page', page);
      params.append('limit', 10);
      if (debouncedSearch.trim()) {
        params.append('search', debouncedSearch.trim());
      }
      if (selectedRole !== 'All') {
        params.append('role', selectedRole);
      }
      if (selectedSort) {
        params.append('sort', selectedSort);
      }

      const [listRes, summaryRes] = await Promise.all([
        fetch(`${API_BASE}/api/employees?${params.toString()}`, {
          signal: controller.signal,
          credentials: 'include'
        }),
        fetch(`${API_BASE}/api/employees/summary`, {
          signal: controller.signal,
          credentials: 'include'
        })
      ]);

      if (controller.signal.aborted) return;

      if (!listRes.ok) {
        const errData = await listRes.json();
        throw new Error(errData.error || 'Failed to load employees list.');
      }
      if (!summaryRes.ok) {
        const errData = await summaryRes.json();
        throw new Error(errData.error || 'Failed to load employee summary.');
      }

      const listData = await listRes.json();
      const summaryData = await summaryRes.json();

      if (isMountedRef.current) {
        setEmployees(listData.employees || []);
        setTotalPages(listData.pagination?.pages || 1);
        setTotalItems(listData.pagination?.total || 0);
        setSummary(summaryData.summary || null);
        setLoading(false);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Fetch employees error:', err);
      if (isMountedRef.current) {
        setError(err.message || 'An error occurred while fetching data.');
        setLoading(false);
      }
    }
  };

  // Fetch Dropdown employees
  const fetchDropdownEmployees = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/employees?limit=100`, {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        if (isMountedRef.current) {
          setDropdownEmployees(data.employees || []);
        }
      }
    } catch (err) {
      console.error('Dropdown employees fetch error:', err);
    }
  };

  // Fetch Activity Log list and activity summary
  const fetchActivityData = async () => {
    if (activeActivityFetchRef.current) {
      activeActivityFetchRef.current.abort();
    }
    const controller = new AbortController();
    activeActivityFetchRef.current = controller;

    setActivityLoading(true);
    setActivityError('');

    try {
      const params = new URLSearchParams();
      params.append('page', activityPage);
      params.append('limit', 20);
      if (filterEmployeeId) params.append('employeeId', filterEmployeeId);
      if (filterAction) params.append('action', filterAction);
      if (filterEntityType) params.append('entityType', filterEntityType);
      if (filterFrom) params.append('from', filterFrom);
      if (filterTo) params.append('to', filterTo);

      const [listRes, summaryRes] = await Promise.all([
        fetch(`${API_BASE}/api/employees/activity?${params.toString()}`, {
          signal: controller.signal,
          credentials: 'include'
        }),
        fetch(`${API_BASE}/api/employees/activity/summary`, {
          signal: controller.signal,
          credentials: 'include'
        })
      ]);

      if (controller.signal.aborted) return;

      if (!listRes.ok) {
        const errData = await listRes.json();
        throw new Error(errData.error || 'Failed to load activity list.');
      }
      if (!summaryRes.ok) {
        const errData = await summaryRes.json();
        throw new Error(errData.error || 'Failed to load activity summary.');
      }

      const listData = await listRes.json();
      const summaryData = await summaryRes.json();

      if (isMountedRef.current) {
        setActivities(listData.events || []);
        setActivityTotalPages(listData.pagination?.pages || 1);
        setActivityTotalItems(listData.pagination?.total || 0);
        setActivitySummary(summaryData.summary || null);
        setActivityLoading(false);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Fetch activity error:', err);
      if (isMountedRef.current) {
        setActivityError(err.message || 'An error occurred while fetching activity.');
        setActivityLoading(false);
      }
    }
  };

  // Trigger fetch directory data
  useEffect(() => {
    isMountedRef.current = true;
    fetchEmployeesData();
    fetchDropdownEmployees();

    return () => {
      isMountedRef.current = false;
      if (activeFetchRef.current) activeFetchRef.current.abort();
    };
  }, [page, debouncedSearch, selectedRole, selectedSort]);

  // Trigger fetch activity data
  useEffect(() => {
    if (activeTab === 'activity') {
      fetchActivityData();
    }
    return () => {
      if (activeActivityFetchRef.current) activeActivityFetchRef.current.abort();
    };
  }, [activeTab, activityPage, filterEmployeeId, filterAction, filterEntityType, filterFrom, filterTo]);

  // Open details drawer and fetch details + employee-specific activity
  const handleOpenDrawer = async (employeeId) => {
    if (activeDrawerFetchRef.current) {
      activeDrawerFetchRef.current.abort();
    }
    const controller = new AbortController();
    activeDrawerFetchRef.current = controller;

    setSelectedEmployee(null);
    setDrawerActivities([]);
    setIsDrawerOpen(true);
    setDrawerLoading(true);
    setDrawerError('');

    try {
      const res = await fetch(`${API_BASE}/api/employees/${employeeId}`, {
        signal: controller.signal,
        credentials: 'include'
      });

      if (controller.signal.aborted) return;

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to fetch employee details.');
      }

      const data = await res.json();
      if (isMountedRef.current) {
        setSelectedEmployee(data.employee);
        setDrawerLoading(false);
        // Start drawer activity fetch
        fetchDrawerActivity(employeeId);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Fetch employee details error:', err);
      if (isMountedRef.current) {
        setDrawerError(err.message || 'Failed to load details.');
        setDrawerLoading(false);
      }
    }
  };

  const fetchDrawerActivity = async (employeeId) => {
    setDrawerActivitiesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/employees/${employeeId}/activity?limit=10`, {
        credentials: 'include'
      });
      if (!res.ok) {
        throw new Error('Failed to load employee activity.');
      }
      const data = await res.json();
      if (isMountedRef.current) {
        setDrawerActivities(data.events || []);
      }
    } catch (err) {
      console.error('Drawer activity error:', err);
    } finally {
      if (isMountedRef.current) {
        setDrawerActivitiesLoading(false);
      }
    }
  };

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
    setSelectedEmployee(null);
    setDrawerActivities([]);
    setDrawerError('');
    if (activeDrawerFetchRef.current) {
      activeDrawerFetchRef.current.abort();
    }
  };

  const showMasterAdminCard = summary && Object.prototype.hasOwnProperty.call(summary, 'masterAdmins');

  return (
    <div className="p-6 md:p-8 flex flex-col gap-8 max-w-7xl mx-auto animate-[fadeIn_0.5s_ease-out_forwards]">
      
      {/* Title */}
      <div>
        <h1 className="font-display-lg text-3xl font-bold text-primary tracking-tight">Employees</h1>
        <p className="font-body-md text-on-surface-variant mt-1.5">View employee access roles and operational audit trail</p>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-outline-variant/20 gap-6">
        <button
          onClick={() => setActiveTab('directory')}
          className={`pb-3 text-sm font-semibold tracking-wide transition-all border-b-2 flex items-center gap-2 ${
            activeTab === 'directory'
              ? 'border-primary text-primary'
              : 'border-transparent text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">group</span>
          <span>Employee Directory</span>
        </button>
        <button
          onClick={() => setActiveTab('activity')}
          className={`pb-3 text-sm font-semibold tracking-wide transition-all border-b-2 flex items-center gap-2 ${
            activeTab === 'activity'
              ? 'border-primary text-primary'
              : 'border-transparent text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">history_toggle_off</span>
          <span>Activity Audit Log</span>
        </button>
      </div>

      {/* Directory Tab View */}
      {activeTab === 'directory' && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {loading && !summary ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-surface-container/40 border border-outline-variant/10 rounded-2xl p-5 animate-pulse flex flex-col gap-3">
                  <div className="h-4 w-24 bg-surface-container-highest rounded" />
                  <div className="h-8 w-16 bg-surface-container-highest rounded" />
                </div>
              ))
            ) : (
              <>
                <div className="bg-surface-container-low border border-outline-variant/20 rounded-2xl p-5 shadow-sm">
                  <span className="font-label-caps text-xs text-on-surface-variant tracking-wider uppercase">Total Employees</span>
                  <p className="font-display-md text-3xl font-semibold text-on-surface mt-2">{summary?.total || 0}</p>
                </div>

                {showMasterAdminCard && (
                  <div className="bg-surface-container-low border border-outline-variant/20 rounded-2xl p-5 shadow-sm">
                    <span className="font-label-caps text-xs text-on-surface-variant tracking-wider uppercase">Master Admins</span>
                    <p className="font-display-md text-3xl font-semibold text-primary mt-2">{summary.masterAdmins}</p>
                  </div>
                )}

                <div className="bg-surface-container-low border border-outline-variant/20 rounded-2xl p-5 shadow-sm">
                  <span className="font-label-caps text-xs text-on-surface-variant tracking-wider uppercase">Store Owners / Admins</span>
                  <p className="font-display-md text-3xl font-semibold text-on-surface mt-2">{summary?.admins || 0}</p>
                </div>

                <div className="bg-surface-container-low border border-outline-variant/20 rounded-2xl p-5 shadow-sm">
                  <span className="font-label-caps text-xs text-on-surface-variant tracking-wider uppercase">Staff Members</span>
                  <p className="font-display-md text-3xl font-semibold text-on-surface mt-2">{summary?.staff || 0}</p>
                </div>
              </>
            )}
          </div>

          {/* Directory Error View */}
          {error && (
            <div className="bg-error/10 border border-error/20 text-error p-6 rounded-2xl flex flex-col items-center justify-center gap-4 text-center mt-4">
              <span className="material-symbols-outlined text-4xl">warning</span>
              <div>
                <h3 className="font-title-md font-bold">Failed to load Employees</h3>
                <p className="text-sm mt-1">{error}</p>
              </div>
              <button
                onClick={fetchEmployeesData}
                className="bg-error text-on-error hover:bg-error/90 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">refresh</span>
                <span>Retry Connection</span>
              </button>
            </div>
          )}

          {/* Directory Grid/Table */}
          {!error && (
            <div className="bg-surface-container-low border border-outline-variant/20 rounded-3xl overflow-hidden shadow-sm flex flex-col">
              {/* Controls Bar */}
              <div className="p-5 border-b border-outline-variant/10 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-surface-container-lowest/50">
                <div className="relative flex-1 max-w-md">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant opacity-60">search</span>
                  <input
                    type="text"
                    placeholder="Search by name or email..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-11 pr-4 py-2.5 bg-surface-container border border-outline-variant/30 rounded-xl font-body-md text-on-surface focus:border-primary/50 focus:outline-none transition-all placeholder:text-on-surface-variant placeholder:opacity-55"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-primary transition-colors"
                    >
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-label-caps text-on-surface-variant tracking-wider uppercase">Role:</span>
                    <select
                      value={selectedRole}
                      onChange={(e) => setSelectedRole(e.target.value)}
                      className="px-3 py-2 bg-surface-container border border-outline-variant/30 rounded-xl text-sm font-medium focus:outline-none focus:border-primary/50 text-on-surface transition-all cursor-pointer"
                    >
                      <option value="All">All Roles</option>
                      {showMasterAdminCard && <option value="MASTER_ADMIN">Master Admin</option>}
                      <option value="ADMIN">Admin</option>
                      <option value="STAFF">Staff</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-label-caps text-on-surface-variant tracking-wider uppercase">Sort:</span>
                    <select
                      value={selectedSort}
                      onChange={(e) => setSelectedSort(e.target.value)}
                      className="px-3 py-2 bg-surface-container border border-outline-variant/30 rounded-xl text-sm font-medium focus:outline-none focus:border-primary/50 text-on-surface transition-all cursor-pointer"
                    >
                      <option value="newest">Newest First</option>
                      <option value="oldest">Oldest First</option>
                      <option value="name_asc">Name A-Z</option>
                      <option value="name_desc">Name Z-A</option>
                    </select>
                  </div>

                  {(search || selectedRole !== 'All' || selectedSort !== 'newest') && (
                    <button
                      onClick={() => {
                        setSearch('');
                        setSelectedRole('All');
                        setSelectedSort('newest');
                      }}
                      className="text-xs font-semibold text-primary hover:text-primary-dark transition-colors px-2 py-2 flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[16px]">filter_alt_off</span>
                      <span>Clear Filters</span>
                    </button>
                  )}
                </div>
              </div>

              {loading && employees.length === 0 ? (
                <div className="p-6 flex flex-col gap-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-16 bg-surface-container rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : employees.length === 0 ? (
                <div className="py-20 px-6 flex flex-col items-center justify-center text-center gap-4 animate-[fadeUp_0.4s_ease-out_forwards]">
                  <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-3xl">group</span>
                  </div>
                  <div>
                    <h3 className="font-title-md font-bold text-on-surface">No employees found</h3>
                    <p className="text-sm text-on-surface-variant mt-1.5 max-w-sm">
                      {search || selectedRole !== 'All'
                        ? 'No matching employee records match your active filters.'
                        : 'No staff accounts exist in the database settings.'}
                    </p>
                  </div>
                  {(search || selectedRole !== 'All') && (
                    <button
                      onClick={() => {
                        setSearch('');
                        setSelectedRole('All');
                      }}
                      className="bg-surface-container text-on-surface border border-outline-variant/30 hover:border-primary/50 text-xs font-semibold px-4 py-2 rounded-xl transition-all"
                    >
                      Reset Filtering
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-outline-variant/10 text-on-surface-variant font-label-caps text-xs tracking-wider bg-surface-container-lowest/30">
                          <th className="px-6 py-4">Employee</th>
                          <th className="px-6 py-4">Role</th>
                          <th className="px-6 py-4">Joined</th>
                          <th className="px-6 py-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {employees.map((member) => (
                          <tr
                            key={member.id}
                            className="border-b border-outline-variant/10 hover:bg-surface-container-lowest/40 transition-colors"
                          >
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                {member.picture ? (
                                  <img
                                    src={member.picture}
                                    alt={`${member.name} profile`}
                                    referrerPolicy="no-referrer"
                                    className="w-10 h-10 rounded-full object-cover border border-outline-variant/30"
                                    onError={(e) => {
                                      e.target.onerror = null;
                                      e.target.parentNode.innerHTML = `
                                        <div class="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">
                                          ${getInitials(member.name, member.email)}
                                        </div>
                                      `;
                                    }}
                                  />
                                ) : (
                                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">
                                    {getInitials(member.name, member.email)}
                                  </div>
                                )}
                                <div className="flex flex-col">
                                  <span className="font-title-sm font-semibold text-on-surface">{member.name}</span>
                                  <span className="text-xs text-on-surface-variant opacity-80">{member.email}</span>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-label-caps tracking-wider uppercase font-semibold ${
                                member.role === 'MASTER_ADMIN'
                                  ? 'bg-primary/20 text-primary border border-primary/30'
                                  : member.role === 'ADMIN'
                                    ? 'bg-secondary/20 text-secondary border border-secondary/30'
                                    : 'bg-surface-variant text-on-surface-variant'
                              }`}>
                                {member.role === 'MASTER_ADMIN' ? 'Master Admin' : member.role}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-on-surface-variant">
                              {formatDate(member.createdAt) || '—'}
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button
                                onClick={() => handleOpenDrawer(member.id)}
                                className="bg-surface-container border border-outline-variant/30 hover:border-primary/50 text-on-surface hover:text-primary transition-all text-xs font-semibold px-4 py-2 rounded-xl"
                              >
                                View Details
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid grid-cols-1 gap-4 p-5 md:hidden">
                    {employees.map((member) => (
                      <div
                        key={member.id}
                        onClick={() => handleOpenDrawer(member.id)}
                        className="p-4 rounded-xl border border-outline-variant/30 bg-surface-container-lowest/50 hover:bg-surface-container-low transition-all cursor-pointer flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          {member.picture ? (
                            <img
                              src={member.picture}
                              alt={`${member.name} profile`}
                              referrerPolicy="no-referrer"
                              className="w-11 h-11 rounded-full object-cover border border-outline-variant/30"
                              onError={(e) => {
                                e.target.onerror = null;
                                e.target.parentNode.innerHTML = `
                                  <div class="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">
                                    ${getInitials(member.name, member.email)}
                                  </div>
                                `;
                              }}
                            />
                          ) : (
                            <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">
                              {getInitials(member.name, member.email)}
                            </div>
                          )}
                          <div className="flex flex-col">
                            <span className="font-title-sm font-semibold text-on-surface">{member.name}</span>
                            <span className="text-xs text-on-surface-variant opacity-70 mb-1">{member.email}</span>
                            <div className="flex items-center gap-1.5">
                              <span className={`px-1.5 py-0.2 rounded text-[8px] font-label-caps tracking-wider uppercase font-semibold ${
                                member.role === 'MASTER_ADMIN'
                                  ? 'bg-primary/20 text-primary border border-primary/30'
                                  : member.role === 'ADMIN'
                                    ? 'bg-secondary/20 text-secondary border border-secondary/30'
                                    : 'bg-surface-variant text-on-surface-variant'
                              }`}>
                                {member.role === 'MASTER_ADMIN' ? 'Master Admin' : member.role}
                              </span>
                              <span className="text-[10px] text-on-surface-variant">
                                • Joined {formatDate(member.createdAt) || '—'}
                              </span>
                            </div>
                          </div>
                        </div>
                        <span className="material-symbols-outlined text-on-surface-variant opacity-60">chevron_right</span>
                      </div>
                    ))}
                  </div>

                  <div className="p-5 border-t border-outline-variant/10 flex items-center justify-between gap-4 bg-surface-container-lowest/20">
                    <span className="text-xs text-on-surface-variant font-medium">
                      Showing {employees.length} of {totalItems} matches
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        disabled={page === 1}
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        className="p-2 bg-surface-container border border-outline-variant/30 hover:border-primary/50 text-on-surface disabled:opacity-40 disabled:hover:border-outline-variant/30 rounded-xl transition-all cursor-pointer flex items-center justify-center"
                      >
                        <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                      </button>
                      <span className="text-xs font-semibold text-on-surface px-2">
                        Page {page} of {totalPages}
                      </span>
                      <button
                        disabled={page === totalPages}
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        className="p-2 bg-surface-container border border-outline-variant/30 hover:border-primary/50 text-on-surface disabled:opacity-40 disabled:hover:border-outline-variant/30 rounded-xl transition-all cursor-pointer flex items-center justify-center"
                      >
                        <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* Activity Audit Log Tab View */}
      {activeTab === 'activity' && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-[fadeIn_0.35s_ease-out_forwards]">
            {activityLoading && !activitySummary ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-surface-container/40 border border-outline-variant/10 rounded-2xl p-5 animate-pulse flex flex-col gap-3">
                  <div className="h-4 w-24 bg-surface-container-highest rounded" />
                  <div className="h-8 w-16 bg-surface-container-highest rounded" />
                </div>
              ))
            ) : (
              <>
                <div className="bg-surface-container-low border border-outline-variant/20 rounded-2xl p-5 shadow-sm">
                  <span className="font-label-caps text-xs text-on-surface-variant tracking-wider uppercase">Total Logged Events</span>
                  <p className="font-display-md text-3xl font-semibold text-on-surface mt-2">{activitySummary?.totalEvents || 0}</p>
                </div>

                <div className="bg-surface-container-low border border-outline-variant/20 rounded-2xl p-5 shadow-sm">
                  <span className="font-label-caps text-xs text-on-surface-variant tracking-wider uppercase">Logged Today</span>
                  <p className="font-display-md text-3xl font-semibold text-primary mt-2">{activitySummary?.today || 0}</p>
                </div>

                <div className="bg-surface-container-low border border-outline-variant/20 rounded-2xl p-5 shadow-sm">
                  <span className="font-label-caps text-xs text-on-surface-variant tracking-wider uppercase">Order Operations</span>
                  <p className="font-display-md text-3xl font-semibold text-on-surface mt-2">{activitySummary?.orders || 0}</p>
                </div>

                <div className="bg-surface-container-low border border-outline-variant/20 rounded-2xl p-5 shadow-sm">
                  <span className="font-label-caps text-xs text-on-surface-variant tracking-wider uppercase">Menu Updates</span>
                  <p className="font-display-md text-3xl font-semibold text-on-surface mt-2">{activitySummary?.menu || 0}</p>
                </div>
              </>
            )}
          </div>

          {/* Activity Error View */}
          {activityError && (
            <div className="bg-error/10 border border-error/20 text-error p-6 rounded-2xl flex flex-col items-center justify-center gap-4 text-center mt-4">
              <span className="material-symbols-outlined text-4xl">warning</span>
              <div>
                <h3 className="font-title-md font-bold">Failed to load Activity Log</h3>
                <p className="text-sm mt-1">{activityError}</p>
              </div>
              <button
                onClick={fetchActivityData}
                className="bg-error text-on-error hover:bg-error/90 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">refresh</span>
                <span>Retry Connection</span>
              </button>
            </div>
          )}

          {/* Activity Logs Table */}
          {!activityError && (
            <div className="bg-surface-container-low border border-outline-variant/20 rounded-3xl overflow-hidden shadow-sm flex flex-col animate-[fadeIn_0.35s_ease-out_forwards]">
              
              {/* Structured Filter Controls */}
              <div className="p-5 border-b border-outline-variant/10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 bg-surface-container-lowest/50">
                
                {/* Employee Selector */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-label-caps text-on-surface-variant font-semibold tracking-wider uppercase">Employee</label>
                  <select
                    value={filterEmployeeId}
                    onChange={(e) => setFilterEmployeeId(e.target.value)}
                    className="w-full px-3 py-2 bg-surface-container border border-outline-variant/30 rounded-xl text-sm font-medium focus:outline-none focus:border-primary/50 text-on-surface transition-all cursor-pointer"
                  >
                    <option value="">All Employees</option>
                    {dropdownEmployees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                  </select>
                </div>

                {/* Action Selector */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-label-caps text-on-surface-variant font-semibold tracking-wider uppercase">Action</label>
                  <select
                    value={filterAction}
                    onChange={(e) => setFilterAction(e.target.value)}
                    className="w-full px-3 py-2 bg-surface-container border border-outline-variant/30 rounded-xl text-sm font-medium focus:outline-none focus:border-primary/50 text-on-surface transition-all cursor-pointer"
                  >
                    <option value="">All Actions</option>
                    {ACTION_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* Entity Category Selector */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-label-caps text-on-surface-variant font-semibold tracking-wider uppercase">Category</label>
                  <select
                    value={filterEntityType}
                    onChange={(e) => setFilterEntityType(e.target.value)}
                    className="w-full px-3 py-2 bg-surface-container border border-outline-variant/30 rounded-xl text-sm font-medium focus:outline-none focus:border-primary/50 text-on-surface transition-all cursor-pointer"
                  >
                    <option value="">All Categories</option>
                    {ENTITY_TYPE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* Start Date */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-label-caps text-on-surface-variant font-semibold tracking-wider uppercase">From Date</label>
                  <input
                    type="date"
                    value={filterFrom}
                    onChange={(e) => setFilterFrom(e.target.value)}
                    className="w-full px-3 py-1.5 bg-surface-container border border-outline-variant/30 rounded-xl text-sm font-medium focus:outline-none focus:border-primary/50 text-on-surface transition-all cursor-pointer"
                  />
                </div>

                {/* End Date */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-label-caps text-on-surface-variant font-semibold tracking-wider uppercase">To Date</label>
                  <input
                    type="date"
                    value={filterTo}
                    onChange={(e) => setFilterTo(e.target.value)}
                    className="w-full px-3 py-1.5 bg-surface-container border border-outline-variant/30 rounded-xl text-sm font-medium focus:outline-none focus:border-primary/50 text-on-surface transition-all cursor-pointer"
                  />
                </div>
              </div>

              {/* Reset Filters Bar */}
              {(filterEmployeeId || filterAction || filterEntityType || filterFrom || filterTo) && (
                <div className="px-5 py-2.5 bg-surface-container-lowest/30 border-b border-outline-variant/10 flex items-center justify-between">
                  <span className="text-xs text-on-surface-variant">Active search parameters filtered.</span>
                  <button
                    onClick={() => {
                      setFilterEmployeeId('');
                      setFilterAction('');
                      setFilterEntityType('');
                      setFilterFrom('');
                      setFilterTo('');
                    }}
                    className="text-xs font-semibold text-primary hover:text-primary-dark flex items-center gap-1 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">filter_alt_off</span>
                    <span>Reset All Filters</span>
                  </button>
                </div>
              )}

              {activityLoading && activities.length === 0 ? (
                <div className="p-6 flex flex-col gap-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-16 bg-surface-container rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : activities.length === 0 ? (
                <div className="py-20 px-6 flex flex-col items-center justify-center text-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-3xl">history</span>
                  </div>
                  <div>
                    <h3 className="font-title-md font-bold text-on-surface">No activity events logged</h3>
                    <p className="text-sm text-on-surface-variant mt-1.5 max-w-sm">
                      No matching audit records exist for your filter parameters.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-outline-variant/10 text-on-surface-variant font-label-caps text-xs tracking-wider bg-surface-container-lowest/30">
                          <th className="px-6 py-4">Timestamp</th>
                          <th className="px-6 py-4">Employee</th>
                          <th className="px-6 py-4">Action</th>
                          <th className="px-6 py-4">Operation Target</th>
                          <th className="px-6 py-4">Change Context</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activities.map((event) => (
                          <tr
                            key={event._id}
                            className="border-b border-outline-variant/10 hover:bg-surface-container-lowest/40 transition-colors"
                          >
                            <td className="px-6 py-4 text-sm text-on-surface-variant shrink-0 font-medium">
                              {formatDateTime(event.createdAt)}
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <span className="font-title-sm font-semibold text-on-surface">{event.actor?.name || 'Unknown'}</span>
                                <span className="text-[10px] opacity-75 font-semibold font-label-caps uppercase bg-surface-variant px-1.5 py-0.2 rounded text-on-surface-variant">
                                  {event.actor?.role}
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className="font-mono text-xs font-semibold text-on-surface bg-surface-container-highest/50 px-2 py-0.5 rounded leading-none">
                                {event.action}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex flex-col gap-0.5">
                                <span className="font-semibold text-xs text-on-surface">
                                  {event.entity?.displayLabel || '—'}
                                </span>
                                <span className="text-[9px] text-on-surface-variant tracking-wider uppercase font-bold opacity-75">
                                  {event.entity?.type}
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-4 max-w-xs">
                              {renderContextDetails(event)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid grid-cols-1 gap-4 p-5 md:hidden">
                    {activities.map((event) => (
                      <div key={event._id} className="p-4 rounded-xl border border-outline-variant/30 bg-surface-container-lowest/50 flex flex-col gap-3">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-on-surface-variant font-medium">
                            {formatDateTime(event.createdAt)}
                          </span>
                          <span className="text-[9px] font-label-caps font-bold bg-surface-variant px-1.5 py-0.2 rounded text-on-surface-variant">
                            {event.actor?.role}
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-on-surface">{event.actor?.name}</span>
                          <span className="font-mono text-[10px] text-on-surface-variant">{event.action}</span>
                        </div>
                        <div className="bg-surface-container border border-outline-variant/20 p-3 rounded-lg flex flex-col gap-2">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[8px] font-bold text-on-surface-variant uppercase tracking-wider">{event.entity?.type}</span>
                            <span className="text-xs font-semibold text-on-surface">{event.entity?.displayLabel}</span>
                          </div>
                          <div>
                            {renderContextDetails(event)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="p-5 border-t border-outline-variant/10 flex items-center justify-between gap-4 bg-surface-container-lowest/20">
                    <span className="text-xs text-on-surface-variant font-medium">
                      Showing {activities.length} of {activityTotalItems} matches
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        disabled={activityPage === 1}
                        onClick={() => setActivityPage(p => Math.max(1, p - 1))}
                        className="p-2 bg-surface-container border border-outline-variant/30 hover:border-primary/50 text-on-surface disabled:opacity-40 disabled:hover:border-outline-variant/30 rounded-xl transition-all cursor-pointer flex items-center justify-center"
                      >
                        <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                      </button>
                      <span className="text-xs font-semibold text-on-surface px-2">
                        Page {activityPage} of {activityTotalPages}
                      </span>
                      <button
                        disabled={activityPage === activityTotalPages}
                        onClick={() => setActivityPage(p => Math.min(activityTotalPages, p + 1))}
                        className="p-2 bg-surface-container border border-outline-variant/30 hover:border-primary/50 text-on-surface disabled:opacity-40 disabled:hover:border-outline-variant/30 rounded-xl transition-all cursor-pointer flex items-center justify-center"
                      >
                        <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* Details Slide-out Right Drawer */}
      <AnimatePresence>
        {isDrawerOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={handleCloseDrawer}
              className="fixed inset-0 bg-black z-[100]"
            />

            {/* Right Drawer Panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.35, ease: 'easeOut' }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-surface-container z-[101] shadow-2xl border-l border-outline-variant/10 flex flex-col"
            >
              {/* Drawer Header */}
              <div className="p-6 border-b border-outline-variant/10 flex items-center justify-between bg-surface-container-lowest">
                <h2 className="font-headline-sm text-lg font-bold text-primary flex items-center gap-2">
                  <span className="material-symbols-outlined">badge</span>
                  Employee Profile
                </h2>
                <button
                  onClick={handleCloseDrawer}
                  className="p-2 text-on-surface-variant hover:text-primary hover:bg-surface-container-high rounded-full transition-colors"
                >
                  <span className="material-symbols-outlined text-[22px]">close</span>
                </button>
              </div>

              {/* Drawer Content */}
              <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 hide-scrollbar">
                {drawerLoading ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
                    <p className="text-xs text-on-surface-variant">Loading profile details...</p>
                  </div>
                ) : drawerError ? (
                  <div className="p-5 bg-error/10 border border-error/20 text-error rounded-xl flex flex-col items-center text-center gap-3">
                    <span className="material-symbols-outlined text-3xl">error</span>
                    <p className="text-sm font-semibold">{drawerError}</p>
                    <button
                      onClick={() => handleOpenDrawer(selectedEmployee?.id || '')}
                      className="bg-error text-on-error px-4 py-2 rounded-xl text-xs font-semibold"
                    >
                      Retry
                    </button>
                  </div>
                ) : selectedEmployee ? (
                  <>
                    {/* Profile Section */}
                    <div className="flex flex-col items-center text-center gap-4 pb-6 border-b border-outline-variant/10">
                      {selectedEmployee.picture ? (
                        <img
                          src={selectedEmployee.picture}
                          alt={`${selectedEmployee.name} avatar`}
                          referrerPolicy="no-referrer"
                          className="w-20 h-20 rounded-full object-cover border-2 border-primary shadow-md"
                          onError={(e) => {
                            e.target.onerror = null;
                            e.target.parentNode.innerHTML = `
                              <div class="w-20 h-20 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-2xl border-2 border-primary">
                                ${getInitials(selectedEmployee.name, selectedEmployee.email)}
                              </div>
                            `;
                          }}
                        />
                      ) : (
                        <div className="w-20 h-20 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-2xl border-2 border-primary">
                          {getInitials(selectedEmployee.name, selectedEmployee.email)}
                        </div>
                      )}
                      
                      <div>
                        <h3 className="font-headline-sm text-lg font-bold text-on-surface">{selectedEmployee.name}</h3>
                        <p className="text-xs text-on-surface-variant mt-0.5">{selectedEmployee.email}</p>
                      </div>

                      <span className={`px-3 py-1 rounded-full text-[10px] font-label-caps tracking-wider uppercase font-semibold ${
                        selectedEmployee.role === 'MASTER_ADMIN'
                          ? 'bg-primary/20 text-primary border border-primary/30'
                          : selectedEmployee.role === 'ADMIN'
                            ? 'bg-secondary/20 text-secondary border border-secondary/30'
                            : 'bg-surface-variant text-on-surface-variant'
                      }`}>
                        {selectedEmployee.role === 'MASTER_ADMIN' ? 'Master Admin' : selectedEmployee.role}
                      </span>
                    </div>

                    {/* Account Section */}
                    <div className="flex flex-col gap-4 pb-6 border-b border-outline-variant/10">
                      <h4 className="font-title-sm font-bold text-on-surface text-sm uppercase tracking-widest text-primary/80">Account Details</h4>
                      
                      <div className="flex flex-col gap-3 text-sm">
                        <div className="flex items-center justify-between py-1 border-b border-outline-variant/5">
                          <span className="text-on-surface-variant">Auth Provider</span>
                          <span className="font-semibold text-on-surface bg-surface-variant px-2 py-0.5 rounded text-xs">{selectedEmployee.provider}</span>
                        </div>
                        <div className="flex items-center justify-between py-1 border-b border-outline-variant/5">
                          <span className="text-on-surface-variant">Joined Date</span>
                          <span className="font-semibold text-on-surface">{formatDate(selectedEmployee.createdAt) || '—'}</span>
                        </div>
                        <div className="flex items-center justify-between py-1 border-b border-outline-variant/5">
                          <span className="text-on-surface-variant">Last recorded login</span>
                          <span className="font-semibold text-on-surface">
                            {selectedEmployee.lastLogin ? formatDate(selectedEmployee.lastLogin) : 'No login activity recorded'}
                          </span>
                        </div>
                      </div>
                      
                      <p className="text-xs text-on-surface-variant italic mt-1 bg-surface-container-high/40 p-3 rounded-xl border border-outline-variant/10">
                        Login history may be incomplete for accounts that previously used email and password authentication.
                      </p>
                    </div>

                    {/* Operational Activity Section */}
                    <div className="flex flex-col gap-4 pb-6">
                      <h4 className="font-title-sm font-bold text-on-surface text-sm uppercase tracking-widest text-primary/80">Recent Activity Logs</h4>
                      
                      {drawerActivitiesLoading ? (
                        <div className="flex justify-center py-4">
                          <span className="material-symbols-outlined text-primary text-2xl animate-spin">progress_activity</span>
                        </div>
                      ) : drawerActivities.length === 0 ? (
                        <div className="bg-surface-container-high/45 p-4 rounded-xl border border-outline-variant/10 text-center">
                          <p className="text-xs text-on-surface-variant">No activity logs recorded for this employee.</p>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-[2px] before:bg-outline-variant/15">
                          {drawerActivities.map((event) => (
                            <div key={event._id} className="flex gap-4 relative pl-7">
                              <div className="absolute left-[9px] top-1.5 w-2 h-2 rounded-full bg-primary" />
                              
                              <div className="flex flex-col flex-1 bg-surface-container-low border border-outline-variant/10 p-3 rounded-xl">
                                <div className="flex justify-between items-start gap-2">
                                  <span className="font-semibold text-xs text-on-surface leading-tight animate-[fadeIn_0.2s_ease-out]">
                                    {event.entity?.displayLabel || event.action}
                                  </span>
                                  <span className="text-[10px] text-on-surface-variant shrink-0 font-medium">
                                    {formatDateTime(event.createdAt)}
                                  </span>
                                </div>
                                <div className="text-[10px] text-on-surface-variant font-mono mt-1">
                                  {event.action}
                                </div>
                                <div className="mt-2">
                                  {renderContextDetails(event)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
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

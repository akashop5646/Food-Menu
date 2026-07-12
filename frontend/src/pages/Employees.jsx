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

export default function Employees() {
  // State variables
  const [employees, setEmployees] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Filtering & Pagination State
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedRole, setSelectedRole] = useState('All');
  const [selectedSort, setSelectedSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  // Drawer State
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState('');

  // Refs for tracking unmount and request concurrency
  const activeFetchRef = useRef(null);
  const activeDrawerFetchRef = useRef(null);
  const isMountedRef = useRef(true);

  // 1. Debounce Search Input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // Reset page on new search
    }, 400);

    return () => clearTimeout(handler);
  }, [search]);

  // Reset page when role or sort changes
  useEffect(() => {
    setPage(1);
  }, [selectedRole, selectedSort]);

  // Fetch employees list and summary
  const fetchEmployeesData = async () => {
    // Abort previous active request
    if (activeFetchRef.current) {
      activeFetchRef.current.abort();
    }
    const controller = new AbortController();
    activeFetchRef.current = controller;

    setLoading(true);
    setError('');

    try {
      // Build query string
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

      // Fetch summary and list concurrently
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

  // Trigger fetch when dependency states change
  useEffect(() => {
    isMountedRef.current = true;
    fetchEmployeesData();

    return () => {
      isMountedRef.current = false;
      if (activeFetchRef.current) activeFetchRef.current.abort();
    };
  }, [page, debouncedSearch, selectedRole, selectedSort]);

  // Open details drawer and fetch details
  const handleOpenDrawer = async (employeeId) => {
    if (activeDrawerFetchRef.current) {
      activeDrawerFetchRef.current.abort();
    }
    const controller = new AbortController();
    activeDrawerFetchRef.current = controller;

    setSelectedEmployee(null);
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

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
    setSelectedEmployee(null);
    setDrawerError('');
    if (activeDrawerFetchRef.current) {
      activeDrawerFetchRef.current.abort();
    }
  };

  // Helper to check for Master Admin summary card rendering
  const showMasterAdminCard = summary && Object.prototype.hasOwnProperty.call(summary, 'masterAdmins');

  return (
    <div className="p-6 md:p-8 flex flex-col gap-8 max-w-7xl mx-auto animate-[fadeIn_0.5s_ease-out_forwards]">
      
      {/* Title */}
      <div>
        <h1 className="font-display-lg text-3xl font-bold text-primary tracking-tight">Employees</h1>
        <p className="font-body-md text-on-surface-variant mt-1.5">View and manage employee access roles and details</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading && !summary ? (
          // Skeletons
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-surface-container/40 border border-outline-variant/10 rounded-2xl p-5 animate-pulse flex flex-col gap-3">
              <div className="h-4 w-24 bg-surface-container-highest rounded" />
              <div className="h-8 w-16 bg-surface-container-highest rounded" />
            </div>
          ))
        ) : (
          <>
            {/* Total Card */}
            <div className="bg-surface-container-low border border-outline-variant/20 rounded-2xl p-5 shadow-sm">
              <span className="font-label-caps text-xs text-on-surface-variant tracking-wider uppercase">Total Employees</span>
              <p className="font-display-md text-3xl font-semibold text-on-surface mt-2">{summary?.total || 0}</p>
            </div>

            {/* Master Admins Card (Conditional) */}
            {showMasterAdminCard && (
              <div className="bg-surface-container-low border border-outline-variant/20 rounded-2xl p-5 shadow-sm">
                <span className="font-label-caps text-xs text-on-surface-variant tracking-wider uppercase">Master Admins</span>
                <p className="font-display-md text-3xl font-semibold text-primary mt-2">{summary.masterAdmins}</p>
              </div>
            )}

            {/* Admins Card */}
            <div className="bg-surface-container-low border border-outline-variant/20 rounded-2xl p-5 shadow-sm">
              <span className="font-label-caps text-xs text-on-surface-variant tracking-wider uppercase">Store Owners / Admins</span>
              <p className="font-display-md text-3xl font-semibold text-on-surface mt-2">{summary?.admins || 0}</p>
            </div>

            {/* Staff Card */}
            <div className="bg-surface-container-low border border-outline-variant/20 rounded-2xl p-5 shadow-sm">
              <span className="font-label-caps text-xs text-on-surface-variant tracking-wider uppercase">Staff Members</span>
              <p className="font-display-md text-3xl font-semibold text-on-surface mt-2">{summary?.staff || 0}</p>
            </div>
          </>
        )}
      </div>

      {/* Main Error View */}
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

      {/* Table & Controls Section */}
      {!error && (
        <div className="bg-surface-container-low border border-outline-variant/20 rounded-3xl overflow-hidden shadow-sm flex flex-col">
          
          {/* Controls Bar */}
          <div className="p-5 border-b border-outline-variant/10 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-surface-container-lowest/50">
            {/* Search Input */}
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

            {/* Filter and Sort Group */}
            <div className="flex items-center gap-3 flex-wrap">
              {/* Role Filter */}
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

              {/* Sort Filter */}
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

              {/* Clear Filters (Visible only when modified) */}
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

          {/* List Loader / Skeleton */}
          {loading && employees.length === 0 ? (
            <div className="p-6 flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 bg-surface-container rounded-xl animate-pulse" />
              ))}
            </div>
          ) : employees.length === 0 ? (
            /* Empty State Screen */
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
              {/* Desktop Table View */}
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
                            {/* Profile Image with validation and referrers */}
                            {member.picture ? (
                              <img
                                src={member.picture}
                                alt={`${member.name} profile`}
                                referrerPolicy="no-referrer"
                                className="w-10 h-10 rounded-full object-cover border border-outline-variant/30"
                                onError={(e) => {
                                  // Fallback to initials if load fails
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

              {/* Mobile Card Grid View */}
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

              {/* Pagination Controls */}
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
                  /* Loading State */
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
                    <p className="text-xs text-on-surface-variant">Loading profile details...</p>
                  </div>
                ) : drawerError ? (
                  /* Error State */
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
                      
                      {/* Disclaimer text */}
                      <p className="text-xs text-on-surface-variant italic mt-1 bg-surface-container-high/40 p-3 rounded-xl border border-outline-variant/10">
                        Login history may be incomplete for accounts that previously used email and password authentication.
                      </p>
                    </div>

                    {/* Operational Activity Section */}
                    <div className="flex flex-col gap-4">
                      <h4 className="font-title-sm font-bold text-on-surface text-sm uppercase tracking-widest text-primary/80">Activity Logs</h4>
                      
                      {/* Neutral activity notice */}
                      <div className="bg-surface-container-high/40 p-4 rounded-xl border border-outline-variant/10 flex flex-col gap-2">
                        <p className="text-xs text-on-surface-variant font-medium text-center">
                          Detailed operational activity tracking is not available yet. Current menu and order records do not consistently store immutable employee IDs.
                        </p>
                      </div>
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

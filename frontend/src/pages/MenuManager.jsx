import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { API_BASE } from '../config';
import { useScrollLock } from '../hooks/useScrollLock';

// Sub-components
import MenuItemImage from './menu/MenuItemImage';
import AvailabilityToggle from './menu/AvailabilityToggle';
import BulkActionBar from './menu/BulkActionBar';
import MenuEmptyState from './menu/MenuEmptyState';
import MenuItemRow from './menu/MenuItemRow';
import MenuItemCard from './menu/MenuItemCard';

export default function MenuManager() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [categories, setCategories] = useState([]);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [notification, setNotification] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [isImageDragActive, setIsImageDragActive] = useState(false);
  useScrollLock(isModalOpen || isCategoryModalOpen);
  const fileInputRef = useRef(null);
  
  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [selectedSort, setSelectedSort] = useState('newest'); // Strict sorting requested by admin
  
  // Selection State
  const [selectedItems, setSelectedItems] = useState(() => new Set());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  // Mutation Race Prevention State
  const [updatingItems, setUpdatingItems] = useState(() => new Set());

  // Pagination & Count States
  const [totalItems, setTotalItems] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorState, setErrorState] = useState(null);

  const observerTarget = useRef(null);
  const isMountedRef = useRef(true);

  // Request concurrency control refs
  const latestResetControllerRef = useRef(null);
  const activeFiltersRef = useRef({ search: '', category: 'All', status: 'All', sort: 'newest' });
  const isFetchingRef = useRef(false);

  // Set mounted flag
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (latestResetControllerRef.current) {
        latestResetControllerRef.current.abort();
      }
    };
  }, []);

  // Debounce search query changes to prevent rapid API requests
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const [formData, setFormData] = useState({
    name: '',
    categories: [],
    price: '',
    description: '',
    image: '',
    chefPick: false
  });

  const resetImageSelection = (fallbackImage = '') => {
    setImageFile(null);
    setImagePreview(fallbackImage);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingItem(null);
    setIsImageDragActive(false);
    resetImageSelection('');
  };

  const handleSelectedImage = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showNotification('Please choose an image file.');
      return;
    }

    setImageFile(file);
    setImagePreview((prev) => {
      if (prev && prev.startsWith('blob:')) {
        URL.revokeObjectURL(prev);
      }
      return URL.createObjectURL(file);
    });
  };

  useEffect(() => {
    return () => {
      if (imagePreview && imagePreview.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreview);
      }
    };
  }, [imagePreview]);

  const fetchCategories = async () => {
    try {
      const res = await fetch(API_BASE + '/api/categories');
      const data = await res.json();
      if (isMountedRef.current) {
        setCategories(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    }
  };

  const showNotification = (msg) => {
    setNotification(msg);
    setTimeout(() => {
      if (isMountedRef.current) setNotification('');
    }, 3000);
  };

  const fetchMenu = async (reset = false) => {
    if (reset) {
      // Abort previous active reset request
      if (latestResetControllerRef.current) {
        latestResetControllerRef.current.abort();
      }
      const controller = new AbortController();
      latestResetControllerRef.current = controller;

      // Capture active filters snapshot
      activeFiltersRef.current = {
        search: debouncedSearch,
        category: selectedCategory,
        status: selectedStatus,
        sort: selectedSort
      };

      setLoading(true);
      setErrorState(null);
      setHasMore(true);
    } else {
      // Prevent fetching more if currently busy or completed
      if (isFetchingRef.current || loading || loadingMore || !hasMore) return;
      setLoadingMore(true);
      setErrorState(null);
    }

    isFetchingRef.current = true;

    try {
      const currentOffset = reset ? 0 : items.length;
      const filters = activeFiltersRef.current;

      const params = new URLSearchParams({
        all: 'true',
        limit: '10',
        offset: String(currentOffset),
        search: filters.search,
        category: filters.category,
        status: filters.status,
        sort: filters.sort,
        adminMetadata: 'true' // Request admin metadata shape
      });

      const fetchOptions = {
        credentials: 'include'
      };
      if (reset && latestResetControllerRef.current) {
        fetchOptions.signal = latestResetControllerRef.current.signal;
      }

      const res = await fetch(`${API_BASE}/api/menu?${params.toString()}`, fetchOptions);
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error('Forbidden: Admin access required.');
        }
        throw new Error('Failed to fetch menu items.');
      }

      const data = await res.json();
      
      if (isMountedRef.current) {
        const newItems = data.items || [];
        const totalCount = data.totalCount || 0;
        const serverHasMore = data.hasMore ?? false;

        setItems(prev => {
          if (reset) {
            return newItems;
          } else {
            // Deduplicate items to avoid double rendering
            const existingIds = new Set(prev.map(i => i._id));
            const filteredNew = newItems.filter(i => !existingIds.has(i._id));
            return [...prev, ...filteredNew];
          }
        });
        setTotalItems(totalCount);
        setHasMore(serverHasMore);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        // Silently discard aborted request errors
        return;
      }
      console.error('Failed to fetch menu:', err);
      if (isMountedRef.current) {
        setErrorState(err.message || 'Failed to load menu items.');
      }
    } finally {
      if (isMountedRef.current) {
        isFetchingRef.current = false;
        if (reset) {
          setLoading(false);
        } else {
          setLoadingMore(false);
        }
      }
    }
  };

  // Fetch categories on mount
  useEffect(() => {
    fetchCategories();
  }, []);

  // Trigger page load or reset when search/filter parameters change
  useEffect(() => {
    fetchMenu(true);
  }, [debouncedSearch, selectedCategory, selectedStatus, selectedSort]);

  // Setup intersection observer for infinite scrolling
  useEffect(() => {
    if (!hasMore || loading || loadingMore || errorState) return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && !loadingMore && !isFetchingRef.current) {
          fetchMenu(false);
        }
      },
      { threshold: 0.1 }
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [hasMore, loading, loadingMore, items.length, errorState]);

  // Selection Cleanup logic: Remove IDs that disappear after a reset/refetch establishes new list
  useEffect(() => {
    setSelectedItems(prev => {
      const visibleIds = new Set(items.map(i => i._id));
      const next = new Set();
      for (const id of prev) {
        if (visibleIds.has(id)) {
          next.add(id);
        }
      }
      if (next.size !== prev.size) {
        return next;
      }
      return prev;
    });
  }, [items]);

  // Clear selections on query changes
  useEffect(() => {
    setSelectedItems(new Set());
  }, [debouncedSearch, selectedCategory, selectedStatus, selectedSort]);

  const handleOpenModal = (item = null) => {
    if (item) {
      setEditingItem(item);
      setFormData({
        name: item.name,
        categories: item.categories || (item.category ? [item.category] : []),
        price: item.price,
        description: item.description || '',
        image: item.image || '',
        chefPick: !!item.chefPick
      });
      resetImageSelection(item.image || '');
    } else {
      setEditingItem(null);
      setFormData({
        name: '',
        categories: categories.length > 0 ? [categories[0].name] : [],
        price: '',
        description: '',
        image: '',
        chefPick: false
      });
      resetImageSelection('');
    }
    setIsModalOpen(true);
  };

  const handleDuplicateItem = (item) => {
    setEditingItem(null); // Force creation mode
    setFormData({
      name: `${item.name} Copy`,
      categories: item.categories || (item.category ? [item.category] : []),
      price: item.price,
      description: item.description || '',
      image: '', // CRITICAL: Reset image to preserve Cloudinary ownership safety
      chefPick: !!item.chefPick
    });
    resetImageSelection('');
    setIsModalOpen(true);
    showNotification('Item text fields duplicated. Please select a new image.');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const method = editingItem ? 'PUT' : 'POST';
      const url = editingItem ? `${API_BASE}/api/menu/${editingItem._id}` : `${API_BASE}/api/menu`;

      const payload = new FormData();
      payload.append('name', formData.name);
      payload.append('categories', JSON.stringify(formData.categories));
      payload.append('price', String(Number(formData.price)));
      payload.append('description', formData.description);
      payload.append('image', formData.image || '');
      payload.append('chefPick', String(formData.chefPick));
      if (imageFile) {
        payload.append('imageFile', imageFile);
      }

      const res = await fetch(url, {
        method,
        body: payload,
        credentials: 'include'
      });

      if (res.ok) {
        handleCloseModal();
        setEditingItem(null);
        showNotification(editingItem ? 'Item updated successfully!' : 'Item added successfully!');
        fetchMenu(true);
      } else {
        const data = await res.json().catch(() => ({}));
        showNotification(data.error || 'Failed to save item.');
      }
    } catch (err) {
      console.error('Error saving item:', err);
      showNotification('Failed to save item.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this item?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/menu/${id}`, { 
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        if (isMountedRef.current) {
          setItems(prev => prev.filter(i => i._id !== id));
          setSelectedItems(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          showNotification('Item deleted successfully!');
        }
      } else {
        const data = await res.json().catch(() => ({}));
        showNotification(data.error || 'Failed to delete item.');
      }
    } catch (err) {
      console.error('Error deleting item:', err);
      showNotification('Failed to delete item.');
    }
  };

  const toggleStatus = async (item) => {
    // Mutation Race Prevention
    if (isBulkProcessing || updatingItems.has(item._id)) return;

    setUpdatingItems(prev => {
      const next = new Set(prev);
      next.add(item._id);
      return next;
    });

    try {
      const newStatus = item.available === false ? true : false;
      const res = await fetch(`${API_BASE}/api/menu/${item._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ available: newStatus }),
        credentials: 'include'
      });

      if (res.ok) {
        if (isMountedRef.current) {
          setItems(prev => prev.map(i => i._id === item._id ? { ...i, available: newStatus } : i));
          showNotification(`Availability updated for ${item.name}.`);
        }
      } else {
        const data = await res.json().catch(() => ({}));
        showNotification(data.error || 'Failed to update availability.');
      }
    } catch (err) {
      console.error('Error updating status:', err);
      showNotification('Failed to update availability.');
    } finally {
      if (isMountedRef.current) {
        setUpdatingItems(prev => {
          const next = new Set(prev);
          next.delete(item._id);
          return next;
        });
      }
    }
  };

  const handleBulkAvailability = async (available) => {
    if (selectedItems.size === 0 || isBulkProcessing) return;

    // Check if any selected item is currently pending individual update
    const selectedArray = Array.from(selectedItems);
    const hasPendingToggle = selectedArray.some(id => updatingItems.has(id));
    if (hasPendingToggle) {
      showNotification('Cannot perform bulk action while selected items are toggling.');
      return;
    }

    setIsBulkProcessing(true);

    try {
      const res = await fetch(`${API_BASE}/api/menu/bulk-availability`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: selectedArray,
          available
        }),
        credentials: 'include'
      });

      if (res.ok) {
        const result = await res.json();
        if (isMountedRef.current) {
          // Update confirmed changes locally
          setItems(prev =>
            prev.map(item =>
              selectedItems.has(item._id) ? { ...item, available } : item
            )
          );
          setSelectedItems(new Set());
          showNotification(
            `Bulk update completed: ${result.modified} items updated, ${result.missing} items missing.`
          );
        }
      } else {
        const data = await res.json().catch(() => ({}));
        showNotification(data.error || 'Failed to perform bulk update.');
      }
    } catch (err) {
      console.error('Error in bulk availability:', err);
      showNotification('Failed to perform bulk update.');
    } finally {
      if (isMountedRef.current) {
        setIsBulkProcessing(false);
      }
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    handleSelectedImage(file);
  };

  const handleImageDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsImageDragActive(false);
    const file = e.dataTransfer.files?.[0];
    handleSelectedImage(file);
  };

  const handleAddCategory = async (e) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    try {
      const res = await fetch(API_BASE + '/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCategoryName }),
        credentials: 'include'
      });
      if (res.ok) {
        setNewCategoryName('');
        showNotification('Category added successfully!');
        fetchCategories();
      } else {
        const data = await res.json();
        showNotification(data.error || 'Failed to add category.');
      }
    } catch (err) {
      console.error('Failed to add category:', err);
    }
  };

  const handleDeleteCategory = async (id) => {
    if (!window.confirm('Delete this category? Items in this category will not be deleted, but may not display properly.')) return;
    try {
      const res = await fetch(`${API_BASE}/api/categories/${id}`, { 
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        fetchCategories();
      }
    } catch (err) {
      console.error('Failed to delete category:', err);
    }
  };

  const handleSelectToggle = (id) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const isAllSelected = items.length > 0 && items.every(item => selectedItems.has(item._id));
  const isSomeSelected = items.length > 0 && items.some(item => selectedItems.has(item._id)) && !isAllSelected;

  const handleSelectAllToggle = () => {
    if (isAllSelected) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(items.map(item => item._id)));
    }
  };

  // Determine current active empty state screen type
  const hasActiveFilters = searchQuery !== '' || selectedCategory !== 'All' || selectedStatus !== 'All';
  const emptyStateType = errorState
    ? 'error'
    : (totalItems === 0 && !loading)
      ? (hasActiveFilters ? 'no-results' : 'empty')
      : null;

  return (
    <div className="flex flex-col min-h-full w-full pb-10">
      <div className="flex justify-between items-center mb-8 animate-[fadeUp_0.6s_ease-out_forwards]">
        <div>
          <h2 className="font-headline-md text-primary text-[28px] mb-1">Menu Management</h2>
          <p className="font-body-sm text-on-surface-variant">Organize and configure food items easily.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsCategoryModalOpen(true)}
            className="bg-surface-container text-on-surface hover:text-primary font-title-md text-[14px] sm:text-[16px] font-semibold px-4 py-2.5 rounded-xl border border-outline-variant/30 hover:border-primary/50 transition-all flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[20px]">category</span> 
            <span className="hidden sm:inline">Categories</span>
          </button>
          <button 
            onClick={() => handleOpenModal()}
            className="bg-primary text-on-primary font-title-md text-[14px] sm:text-[16px] font-semibold px-4 sm:px-6 py-2.5 rounded-xl ripple shadow-[0_0_15px_rgba(212,175,55,0.3)] hover:shadow-[0_0_25px_rgba(212,175,55,0.5)] transition-shadow duration-300 flex items-center gap-2"
          >
            <span className="material-symbols-outlined">add</span> 
            <span className="hidden sm:inline">Add New Item</span>
          </button>
        </div>
      </div>

      {/* Search & Filter Controls */}
      <div className="flex flex-col md:flex-row gap-4 mb-6 animate-[fadeUp_0.7s_ease-out_forwards]">
        {/* Search Bar */}
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/60 text-[20px]">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search items by name or description..."
            className="w-full bg-surface-container border border-outline-variant/20 text-on-surface pl-10 pr-10 py-2.5 rounded-xl focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-on-surface-variant/40 font-body-md text-sm"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant/60 hover:text-primary transition-colors flex items-center justify-center"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          )}
        </div>

        {/* Category Filter */}
        <div className="relative min-w-[160px]">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full bg-surface-container border border-outline-variant/20 text-on-surface px-4 py-2.5 pr-10 rounded-xl focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all cursor-pointer font-body-md text-sm appearance-none"
          >
            <option value="All">All Categories</option>
            {categories.map((cat) => (
              <option key={cat._id} value={cat.name}>
                {cat.name}
              </option>
            ))}
          </select>
          <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-on-surface-variant/60 text-[20px]">
            unfold_more
          </span>
        </div>

        {/* Status Filter */}
        <div className="relative min-w-[150px]">
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="w-full bg-surface-container border border-outline-variant/20 text-on-surface px-4 py-2.5 pr-10 rounded-xl focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all cursor-pointer font-body-md text-sm appearance-none"
          >
            <option value="All">All Statuses</option>
            <option value="In Stock">In Stock</option>
            <option value="Out of Stock">Out of Stock</option>
          </select>
          <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-on-surface-variant/60 text-[20px]">
            unfold_more
          </span>
        </div>

        {/* Sort Selector */}
        <div className="relative min-w-[170px]">
          <select
            value={selectedSort}
            onChange={(e) => setSelectedSort(e.target.value)}
            className="w-full bg-surface-container border border-outline-variant/20 text-on-surface px-4 py-2.5 pr-10 rounded-xl focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all cursor-pointer font-body-md text-sm appearance-none"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name_asc">Name A–Z</option>
            <option value="name_desc">Name Z–A</option>
            <option value="price_asc">Price: Low to High</option>
            <option value="price_desc">Price: High to Low</option>
          </select>
          <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-on-surface-variant/60 text-[20px]">
            sort
          </span>
        </div>
      </div>

      {/* Result Information */}
      {!loading && !errorState && totalItems > 0 && (
        <div className="mb-4 text-sm text-on-surface-variant font-medium animate-[fadeUp_0.75s_ease-out_forwards]">
          {hasActiveFilters ? (
            <span>{totalItems} matching item{totalItems === 1 ? '' : 's'}</span>
          ) : (
            <span>{totalItems} menu item{totalItems === 1 ? '' : 's'}</span>
          )}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="flex justify-center items-center py-20">
          <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
        </div>
      ) : emptyStateType ? (
        <MenuEmptyState
          type={emptyStateType}
          errorMessage={errorState}
          onAction={() => {
            if (emptyStateType === 'error') {
              fetchMenu(true);
            } else if (emptyStateType === 'no-results') {
              setSearchQuery('');
              setSelectedCategory('All');
              setSelectedStatus('All');
            } else {
              handleOpenModal();
            }
          }}
        />
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden md:block bg-surface-container-low rounded-xl border border-outline-variant/20 overflow-hidden shadow-lg animate-[fadeUp_0.8s_ease-out_forwards]">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-high border-b border-outline-variant/30">
                    <th className="px-6 py-4 w-12 text-center">
                      <label className="flex items-center justify-center cursor-pointer min-h-[40px] min-w-[40px]">
                        <input
                          type="checkbox"
                          checked={isAllSelected}
                          ref={el => {
                            if (el) el.indeterminate = isSomeSelected;
                          }}
                          onChange={handleSelectAllToggle}
                          className="w-4 h-4 rounded border-outline-variant/50 text-primary focus:ring-primary focus:ring-offset-0 focus:ring-1 outline-none bg-surface-container cursor-pointer"
                          aria-label="Select all visible items"
                        />
                      </label>
                    </th>
                    <th className="px-6 py-4 font-label-caps text-on-surface-variant uppercase tracking-widest text-[12px]">Image</th>
                    <th className="px-6 py-4 font-label-caps text-on-surface-variant uppercase tracking-widest text-[12px]">Name</th>
                    <th className="px-6 py-4 font-label-caps text-on-surface-variant uppercase tracking-widest text-[12px]">Category</th>
                    <th className="px-6 py-4 font-label-caps text-on-surface-variant uppercase tracking-widest text-[12px]">Price</th>
                    <th className="px-6 py-4 font-label-caps text-on-surface-variant uppercase tracking-widest text-[12px]">Status</th>
                    <th className="px-6 py-4 font-label-caps text-on-surface-variant uppercase tracking-widest text-[12px] text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <MenuItemRow
                      key={item._id}
                      item={item}
                      isSelected={selectedItems.has(item._id)}
                      onSelectToggle={() => handleSelectToggle(item._id)}
                      onToggleStatus={() => toggleStatus(item)}
                      isStatusPending={updatingItems.has(item._id)}
                      isStatusDisabled={isBulkProcessing}
                      onEdit={() => handleOpenModal(item)}
                      onDuplicate={() => handleDuplicateItem(item)}
                      onDelete={() => handleDelete(item._id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card List View */}
          <div className="grid grid-cols-1 gap-4 md:hidden animate-[fadeUp_0.8s_ease-out_forwards]">
            {items.map((item) => (
              <MenuItemCard
                key={item._id}
                item={item}
                isSelected={selectedItems.has(item._id)}
                onSelectToggle={() => handleSelectToggle(item._id)}
                onToggleStatus={() => toggleStatus(item)}
                isStatusPending={updatingItems.has(item._id)}
                isStatusDisabled={isBulkProcessing}
                onEdit={() => handleOpenModal(item)}
                onDuplicate={() => handleDuplicateItem(item)}
                onDelete={() => handleDelete(item._id)}
              />
            ))}
          </div>

          {/* Infinite Scroll Loader Target & Load-More Error controls */}
          {hasMore && !errorState && (
            <div ref={observerTarget} className="flex justify-center items-center py-8">
              {loadingMore ? (
                <span className="material-symbols-outlined text-primary text-3xl animate-spin">progress_activity</span>
              ) : (
                <span className="text-[11px] text-on-surface-variant/40 font-mono tracking-widest uppercase animate-pulse">Scroll down to load more</span>
              )}
            </div>
          )}

          {errorState && items.length > 0 && (
            <div className="flex flex-col items-center justify-center py-6 border-t border-outline-variant/10 mt-6 animate-[fadeUp_0.4s_ease-out_forwards]">
              <p className="text-xs text-error font-medium mb-2">{errorState}</p>
              <button
                onClick={() => fetchMenu(false)}
                className="bg-surface-container text-on-surface hover:text-primary border border-outline-variant/30 text-xs font-semibold px-4 py-2 rounded-xl transition-all flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                <span>Retry Loading More</span>
              </button>
            </div>
          )}

          {!hasMore && items.length > 0 && !errorState && (
            <div className="text-center py-8 text-[11px] text-on-surface-variant/40 font-mono tracking-widest uppercase border-t border-outline-variant/10 mt-6">
              All menu items loaded ({totalItems} total)
            </div>
          )}
        </>
      )}

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="app-overlay-backdrop bg-black/60 backdrop-blur-sm fixed inset-0 z-[100] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="app-modal-wrapper bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] flex flex-col"
            >
              <header className="app-overlay-header flex justify-between items-center mb-6">
                <h2 className="font-headline-sm text-primary text-[24px]">
                  {editingItem ? 'Edit Menu Item' : 'Add New Item'}
                </h2>
                <button 
                  type="button"
                  onClick={handleCloseModal} 
                  aria-label="Close dialog"
                  className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container-high/40 transition-colors text-on-surface-variant cursor-pointer focus-visible:ring-2 focus-visible:ring-primary outline-none"
                >
                  <span className="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              </header>

              <form onSubmit={handleSave} className="flex-1 min-h-0 flex flex-col">
                <div className="app-overlay-scroll-body pr-2 space-y-4 mb-6 overflow-y-auto">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 sm:col-span-1">
                      <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1 uppercase tracking-widest">Name</label>
                      <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded px-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none" />
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1 uppercase tracking-widest">Price (₹)</label>
                      <input required type="number" step="0.01" min="0" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded px-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none" />
                    </div>
                    <div className="col-span-2">
                      <label className="block font-label-caps text-[12px] uppercase tracking-widest text-on-surface-variant mb-2">Categories</label>
                      <div className="flex flex-wrap gap-2 max-h-[100px] overflow-y-auto p-2 bg-surface-container-highest border border-outline-variant/50 rounded">
                        {categories.map(cat => {
                          const isSelected = formData.categories.includes(cat.name);
                          return (
                            <label key={cat._id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full cursor-pointer transition-colors text-sm ${isSelected ? 'bg-primary/20 text-primary border border-primary/50' : 'bg-surface-container text-on-surface border border-outline-variant/30 hover:border-outline-variant'}`}>
                              <input 
                                type="checkbox"
                                className="hidden"
                                checked={isSelected}
                                onChange={(e) => {
                                  setFormData(prev => ({
                                    ...prev,
                                    categories: e.target.checked 
                                      ? [...prev.categories, cat.name]
                                      : prev.categories.filter(c => c !== cat.name)
                                  }));
                                }}
                              />
                              {cat.name}
                            </label>
                          );
                        })}
                        {categories.length === 0 && <span className="text-sm text-on-surface-variant opacity-70 italic">No categories available</span>}
                      </div>
                    </div>
                    <div className="col-span-2">
                      <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1 uppercase tracking-widest">Description</label>
                      <textarea rows="3" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded px-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-none"></textarea>
                    </div>
                    <div className="col-span-2">
                      <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1 uppercase tracking-widest">Image Upload</label>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => fileInputRef.current?.click()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            fileInputRef.current?.click();
                          }
                        }}
                        onDragEnter={(e) => {
                          e.preventDefault();
                          setIsImageDragActive(true);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setIsImageDragActive(true);
                        }}
                        onDragLeave={() => setIsImageDragActive(false)}
                        onDrop={handleImageDrop}
                        className={`rounded-2xl border border-dashed p-4 transition-all cursor-pointer bg-surface-container-highest/70 ${
                          isImageDragActive
                            ? 'border-primary bg-primary/10 shadow-[0_0_0_1px_rgba(212,175,55,0.25)]'
                            : 'border-outline-variant/50 hover:border-primary/60 hover:bg-surface-container-highest'
                        }`}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleImageUpload}
                          className="hidden"
                        />
                        <div className="flex items-center gap-4">
                          <div className="w-20 h-20 shrink-0 rounded-xl overflow-hidden bg-surface-container flex items-center justify-center border border-outline-variant/30">
                            {imagePreview ? (
                              <img src={imagePreview} alt="Selected preview" className="w-full h-full object-cover" />
                            ) : (
                              <span className="material-symbols-outlined text-[28px] text-on-surface-variant/50">image</span>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="font-title-md text-on-surface text-[15px]">
                              {imageFile ? imageFile.name : formData.image ? 'Current image selected' : 'Drop an image here'}
                            </p>
                            <p className="text-sm text-on-surface-variant mt-1">
                              Drag and drop or click to browse. The file stays local until you click {editingItem ? 'Save Changes' : 'Create Item'}.
                            </p>
                            {imageFile && (
                              <p className="text-xs text-on-surface-variant mt-2">
                                {(imageFile.size / 1024 / 1024).toFixed(2)} MB before compression
                              </p>
                            )}
                          </div>

                          <div className="flex flex-col gap-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                fileInputRef.current?.click();
                              }}
                              className="px-4 py-2 rounded-lg bg-primary/10 text-primary font-label-caps text-[11px] uppercase tracking-widest hover:bg-primary/20 transition-colors"
                            >
                              Choose File
                            </button>
                            {(imageFile || formData.image) && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  resetImageSelection(editingItem?.image || '');
                                }}
                                className="px-4 py-2 rounded-lg bg-surface-container text-on-surface-variant font-label-caps text-[11px] uppercase tracking-widest hover:text-error transition-colors"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                      {!formData.image && !imageFile && (
                        <p className="mt-2 text-xs text-[#d4af37] font-medium flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">warning</span>
                          <span>Select a new image. Duplicated items must have a new image to maintain asset ownership safety.</span>
                        </p>
                      )}
                      <p className="mt-2 text-xs text-on-surface-variant">
                        Uploaded on save only. The server recompresses the image before sending it to Cloudinary.
                      </p>
                    </div>
                    <div className="col-span-2 flex items-center gap-3 mt-4">
                      <label className="inline-flex items-center cursor-pointer group">
                        <input type="checkbox" checked={formData.chefPick} onChange={e => setFormData({...formData, chefPick: e.target.checked})} className="sr-only peer" />
                        <div className="relative w-11 h-6 bg-surface-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary shrink-0 transition-colors"></div>
                        <div className="ml-3 flex flex-col group-hover:opacity-80 transition-opacity">
                          <span className="font-body-sm text-on-surface">Highlight as Main Hero Item</span>
                          <span className="font-body-sm text-[10px] text-on-surface-variant opacity-80 leading-tight mt-0.5">Shows this item in the large black & white section at the top of the menu</span>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>

                <footer className="app-overlay-footer pt-6 flex justify-end gap-3 border-t border-outline-variant/20">
                  <button type="button" onClick={handleCloseModal} className="px-5 py-2 text-on-surface hover:text-primary font-label-caps text-[12px] uppercase tracking-widest rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer min-h-[44px]">Cancel</button>
                  <button type="submit" disabled={isSaving} className="bg-primary text-on-primary px-6 py-2 rounded font-label-caps text-[12px] uppercase tracking-widest gold-glow disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer min-h-[44px]">
                    {editingItem ? 'Save Changes' : 'Create Item'}
                  </button>
                </footer>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Categories Manager Modal */}
      <AnimatePresence>
        {isCategoryModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="app-overlay-backdrop bg-black/60 backdrop-blur-sm fixed inset-0 z-[100] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-md p-6 shadow-2xl app-modal-wrapper flex flex-col"
            >
              <header className="app-overlay-header flex justify-between items-center mb-6">
                <h2 className="font-headline-sm text-primary text-[24px]">Manage Categories</h2>
                <button 
                  type="button"
                  onClick={() => setIsCategoryModalOpen(false)} 
                  aria-label="Close dialog"
                  className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container-high/40 transition-colors text-on-surface-variant cursor-pointer focus-visible:ring-2 focus-visible:ring-primary outline-none"
                >
                  <span className="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              </header>

              <div className="app-overlay-scroll-body space-y-6 overflow-y-auto">
                <form onSubmit={handleAddCategory} className="flex gap-2 mb-2">
                  <input 
                    type="text" 
                    value={newCategoryName} 
                    onChange={e => setNewCategoryName(e.target.value)} 
                    placeholder="New Category Name..." 
                    className="flex-1 bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded px-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none" 
                    required
                  />
                  <button type="submit" className="bg-primary text-on-primary px-4 py-2 rounded font-label-caps text-[12px] uppercase tracking-widest gold-glow flex items-center gap-1 cursor-pointer">
                    <span className="material-symbols-outlined text-[18px]">add</span> Add
                  </button>
                </form>

                <div className="space-y-2 pr-2">
                  {categories.length === 0 ? (
                    <p className="text-on-surface-variant text-center py-4 font-body-sm opacity-50">No categories found. Create one above.</p>
                  ) : (
                    categories.map(cat => (
                      <div key={cat._id} className="flex justify-between items-center bg-surface-container-high px-4 py-3 rounded border border-outline-variant/20 hover:border-outline-variant/50 transition-colors">
                        <span className="font-body-md text-on-surface">{cat.name}</span>
                        <button 
                          type="button"
                          onClick={() => handleDeleteCategory(cat._id)} 
                          className="text-on-surface-variant hover:text-error transition-colors p-1 cursor-pointer min-h-[32px] min-w-[32px] flex items-center justify-center rounded focus-visible:ring-2 focus-visible:ring-primary outline-none"
                          title="Delete Category"
                          aria-label={`Delete category ${cat.name}`}
                        >
                          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">delete</span>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk Action Toolbar */}
      <AnimatePresence>
        <BulkActionBar
          selectedCount={selectedItems.size}
          onMarkAvailable={() => handleBulkAvailability(true)}
          onMarkUnavailable={() => handleBulkAvailability(false)}
          onClear={() => setSelectedItems(new Set())}
          disabled={isBulkProcessing}
        />
      </AnimatePresence>

      {/* Global Notification Toast */}
      <AnimatePresence>
        {notification && (
          <motion.div 
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className="fixed bottom-6 right-6 bg-surface-container-high border border-primary/30 text-primary px-6 py-4 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.5),0_0_20px_rgba(212,175,55,0.15)] flex items-center gap-3 z-[200]"
          >
            <span className="material-symbols-outlined text-[24px]">check_circle</span>
            <span className="font-body-md font-medium tracking-wide">{notification}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

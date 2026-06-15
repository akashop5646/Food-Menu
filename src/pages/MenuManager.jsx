import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function MenuManager() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [categories, setCategories] = useState([]);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [notification, setNotification] = useState('');
  
  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedStatus, setSelectedStatus] = useState('All');

  const filteredItems = items.filter(item => {
    const matchesSearch = 
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase()));

    const itemCats = item.categories || (item.category ? [item.category] : []);
    const matchesCategory = selectedCategory === 'All' || itemCats.includes(selectedCategory);

    const matchesStatus = 
      selectedStatus === 'All' ||
      (selectedStatus === 'In Stock' && item.available !== false) ||
      (selectedStatus === 'Out of Stock' && item.available === false);

    return matchesSearch && matchesCategory && matchesStatus;
  });

  const [formData, setFormData] = useState({
    name: '',
    categories: [],
    price: '',
    description: '',
    image: '',
    chefPick: false
  });

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/categories');
      const data = await res.json();
      setCategories(Array.isArray(data) ? data : []);
      
      // Update form default category if categories exist and form is empty
      if (data.length > 0 && formData.categories.length === 0) {
        setFormData(prev => ({ ...prev, categories: [data[0].name] }));
      }
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    }
  };

  const showNotification = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(''), 3000);
  };

  const fetchMenu = async () => {
    try {
      // Fetch all items, including unavailable ones
      // Since our public endpoint filters out unavailable, let's just fetch directly from db
      // Wait, the GET /api/menu route filters `available: { $ne: false }`.
      // Let's create an admin endpoint or modify the query if a specific param is passed?
      // Actually we can add an admin route or pass `?all=true`. Let's assume we update the backend shortly to support `?all=true`.
      const res = await fetch('/api/menu?all=true');
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch menu:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
    fetchMenu();
  }, []);

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
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      const method = editingItem ? 'PUT' : 'POST';
      const url = editingItem ? `/api/menu/${editingItem._id}` : '/api/menu';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          price: Number(formData.price)
        }),
        credentials: 'include'
      });

      if (res.ok) {
        setIsModalOpen(false);
        showNotification(editingItem ? 'Item updated successfully!' : 'Item added successfully!');
        fetchMenu();
      }
    } catch (err) {
      console.error('Error saving item:', err);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this item?')) return;
    try {
      const res = await fetch(`/api/menu/${id}`, { 
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        setItems(items.filter(i => i._id !== id));
      }
    } catch (err) {
      console.error('Error deleting item:', err);
    }
  };

  const toggleStatus = async (item) => {
    try {
      const newStatus = item.available === false ? true : false;
      const res = await fetch(`/api/menu/${item._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ available: newStatus }),
        credentials: 'include'
      });

      if (res.ok) {
        setItems(items.map(i => i._id === item._id ? { ...i, available: newStatus } : i));
      }
    } catch (err) {
      console.error('Error updating status:', err);
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const form = new FormData();
      form.append('image', file);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: form,
        credentials: 'include'
      });

      const data = await res.json();
      if (res.ok) {
        setFormData(prev => ({ ...prev, image: data.url }));
      } else {
        alert(data.error || 'Failed to upload image');
      }
    } catch (err) {
      console.error('Upload error:', err);
      alert('Error uploading image');
    } finally {
      setIsUploading(false);
    }
  };

  const handleAddCategory = async (e) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    try {
      const res = await fetch('/api/categories', {
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
        alert(data.error || 'Failed to add category');
      }
    } catch (err) {
      console.error('Failed to add category:', err);
    }
  };

  const handleDeleteCategory = async (id) => {
    if (!window.confirm('Delete this category? Items in this category will not be deleted, but may not display properly.')) return;
    try {
      const res = await fetch(`/api/categories/${id}`, { 
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
      {!loading && items.length > 0 && (
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
        </div>
      )}

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 opacity-50 bg-surface-container-low rounded-xl border border-outline-variant/20">
          <span className="material-symbols-outlined text-6xl mb-4">restaurant_menu</span>
          <p className="font-body-lg text-[16px]">No menu items found. Add one to get started.</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 opacity-50 bg-surface-container-low rounded-xl border border-outline-variant/20">
          <span className="material-symbols-outlined text-5xl mb-3">search_off</span>
          <p className="font-body-lg text-[16px] font-medium">No items match your search filters.</p>
          <button 
            onClick={() => { setSearchQuery(''); setSelectedCategory('All'); setSelectedStatus('All'); }} 
            className="mt-3 text-primary text-xs font-label-caps uppercase tracking-wider hover:underline"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden md:block bg-surface-container-low rounded-xl border border-outline-variant/20 overflow-hidden shadow-lg animate-[fadeUp_0.8s_ease-out_forwards]">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-high border-b border-outline-variant/30">
                    <th className="px-6 py-4 font-label-caps text-on-surface-variant uppercase tracking-widest text-[12px]">Image</th>
                    <th className="px-6 py-4 font-label-caps text-on-surface-variant uppercase tracking-widest text-[12px]">Name</th>
                    <th className="px-6 py-4 font-label-caps text-on-surface-variant uppercase tracking-widest text-[12px]">Category</th>
                    <th className="px-6 py-4 font-label-caps text-on-surface-variant uppercase tracking-widest text-[12px]">Price</th>
                    <th className="px-6 py-4 font-label-caps text-on-surface-variant uppercase tracking-widest text-[12px]">Status</th>
                    <th className="px-6 py-4 font-label-caps text-on-surface-variant uppercase tracking-widest text-[12px] text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item, idx) => (
                    <tr key={item._id} className="border-b border-outline-variant/10 hover:bg-surface-container-highest/50 transition-colors">
                      <td className="px-6 py-3">
                        {item.image ? (
                          <div className="w-12 h-12 rounded overflow-hidden border border-outline-variant/30">
                            <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                          </div>
                        ) : (
                          <div className="w-12 h-12 rounded bg-surface-variant flex items-center justify-center border border-outline-variant/30">
                            <span className="material-symbols-outlined text-on-surface-variant opacity-50 text-[20px]">image</span>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <div className="font-title-md text-on-surface">{item.name}</div>
                        {item.chefPick && <div className="text-[10px] font-label-caps text-primary uppercase tracking-widest mt-1">Chef Pick</div>}
                      </td>
                      <td className="p-4 align-middle">
                        <div className="flex flex-wrap gap-1">
                          {(item.categories || (item.category ? [item.category] : [])).map(cat => (
                            <span key={cat} className="bg-surface-variant text-on-surface-variant px-2 py-0.5 rounded-full text-[12px] font-label-caps uppercase tracking-widest">{cat}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-3 font-price-display text-on-surface">₹{item.price}</td>
                      <td className="px-6 py-3">
                        <button 
                          onClick={() => toggleStatus(item)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-full font-label-caps text-[11px] uppercase tracking-widest transition-all ${
                            item.available !== false 
                              ? 'bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20' 
                              : 'bg-error/10 text-error border border-error/30 hover:bg-error/20'
                          }`}
                        >
                          <div className={`w-2 h-2 rounded-full ${item.available !== false ? 'bg-primary' : 'bg-error'}`}></div>
                          {item.available !== false ? 'In Stock' : '86 (Out)'}
                        </button>
                      </td>
                      <td className="px-6 py-3 text-right space-x-2">
                        <button onClick={() => handleOpenModal(item)} className="p-2 text-on-surface-variant hover:text-primary transition-colors bg-surface-container rounded hover:bg-surface-bright">
                          <span className="material-symbols-outlined text-[18px]">edit</span>
                        </button>
                        <button onClick={() => handleDelete(item._id)} className="p-2 text-on-surface-variant hover:text-error transition-colors bg-surface-container rounded hover:bg-error/10">
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card List View */}
          <div className="grid grid-cols-1 gap-4 md:hidden animate-[fadeUp_0.8s_ease-out_forwards]">
            {filteredItems.map((item) => (
              <div key={item._id} className="bg-surface-container-low border border-outline-variant/20 rounded-xl p-4 flex flex-col gap-4 shadow-sm">
                <div className="flex gap-4">
                  {/* Image */}
                  {item.image ? (
                    <div className="w-16 h-16 rounded-lg overflow-hidden border border-outline-variant/20 shrink-0">
                      <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-surface-variant flex items-center justify-center border border-outline-variant/20 shrink-0">
                      <span className="material-symbols-outlined text-on-surface-variant opacity-50 text-[24px]">image</span>
                    </div>
                  )}
                  
                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-2">
                      <h4 className="font-title-md text-on-surface text-base truncate">{item.name}</h4>
                      <span className="font-price-display text-on-surface text-sm shrink-0">₹{item.price}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {(item.categories || (item.category ? [item.category] : [])).map(cat => (
                        <span key={cat} className="bg-surface-variant text-on-surface-variant px-2 py-0.5 rounded-full text-[10px] font-label-caps uppercase tracking-widest">{cat}</span>
                      ))}
                    </div>
                    {item.chefPick && <div className="text-[9px] font-label-caps text-primary uppercase tracking-widest mt-1">Chef Pick</div>}
                  </div>
                </div>

                {/* Status and Action Buttons */}
                <div className="flex items-center justify-between border-t border-outline-variant/10 pt-3">
                  {/* Status Toggle */}
                  <button 
                    onClick={() => toggleStatus(item)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full font-label-caps text-[10px] uppercase tracking-widest transition-all ${
                      item.available !== false 
                        ? 'bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20' 
                        : 'bg-error/10 text-error border border-error/30 hover:bg-error/20'
                    }`}
                  >
                    <div className={`w-1.5 h-1.5 rounded-full ${item.available !== false ? 'bg-primary' : 'bg-error'}`}></div>
                    {item.available !== false ? 'In Stock' : '86 (Out)'}
                  </button>

                  {/* Edit & Delete Actions */}
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleOpenModal(item)} className="p-2 text-on-surface-variant hover:text-primary transition-colors bg-surface-container rounded-lg hover:bg-surface-bright flex items-center justify-center">
                      <span className="material-symbols-outlined text-[18px]">edit</span>
                    </button>
                    <button onClick={() => handleDelete(item._id)} className="p-2 text-on-surface-variant hover:text-error transition-colors bg-surface-container rounded-lg hover:bg-error/10 flex items-center justify-center">
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="font-headline-sm text-primary text-[24px]">
                  {editingItem ? 'Edit Menu Item' : 'Add New Item'}
                </h2>
                <button onClick={() => setIsModalOpen(false)} className="text-on-surface-variant hover:text-primary transition-colors">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <form onSubmit={handleSave} className="space-y-4">
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
                    <div className="flex items-center gap-4">
                      {formData.image && (
                        <div className="relative group">
                          <img src={formData.image} alt="Preview" className="w-16 h-16 object-cover rounded border border-outline-variant/50" />
                          <button 
                            type="button" 
                            onClick={() => setFormData({...formData, image: ''})} 
                            className="absolute -top-2 -right-2 bg-error text-white rounded-full p-0.5 shadow hover:scale-110 transition-transform"
                          >
                            <span className="material-symbols-outlined text-[14px] block">close</span>
                          </button>
                        </div>
                      )}
                      <input 
                        type="file" 
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="block w-full text-sm text-on-surface-variant file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
                      />
                      {isUploading && <span className="material-symbols-outlined animate-spin text-primary">progress_activity</span>}
                    </div>
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

                <div className="pt-6 flex justify-end gap-3 border-t border-outline-variant/20 mt-6">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2 text-on-surface hover:text-primary font-label-caps text-[12px] uppercase tracking-widest">Cancel</button>
                  <button type="submit" disabled={isUploading} className="bg-primary text-on-primary px-6 py-2 rounded font-label-caps text-[12px] uppercase tracking-widest gold-glow disabled:opacity-50">
                    {editingItem ? 'Save Changes' : 'Create Item'}
                  </button>
                </div>
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
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-md p-6 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="font-headline-sm text-primary text-[24px]">Manage Categories</h2>
                <button onClick={() => setIsCategoryModalOpen(false)} className="text-on-surface-variant hover:text-primary transition-colors">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <form onSubmit={handleAddCategory} className="flex gap-2 mb-6">
                <input 
                  type="text" 
                  value={newCategoryName} 
                  onChange={e => setNewCategoryName(e.target.value)} 
                  placeholder="New Category Name..." 
                  className="flex-1 bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded px-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none" 
                  required
                />
                <button type="submit" className="bg-primary text-on-primary px-4 py-2 rounded font-label-caps text-[12px] uppercase tracking-widest gold-glow flex items-center gap-1">
                  <span className="material-symbols-outlined text-[18px]">add</span> Add
                </button>
              </form>

              <div className="max-h-[300px] overflow-y-auto space-y-2 pr-2">
                {categories.length === 0 ? (
                  <p className="text-on-surface-variant text-center py-4 font-body-sm opacity-50">No categories found. Create one above.</p>
                ) : (
                  categories.map(cat => (
                    <div key={cat._id} className="flex justify-between items-center bg-surface-container-high px-4 py-3 rounded border border-outline-variant/20 hover:border-outline-variant/50 transition-colors">
                      <span className="font-body-md text-on-surface">{cat.name}</span>
                      <button 
                        onClick={() => handleDeleteCategory(cat._id)} 
                        className="text-on-surface-variant hover:text-error transition-colors p-1"
                        title="Delete Category"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
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

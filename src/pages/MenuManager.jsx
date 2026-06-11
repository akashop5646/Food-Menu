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
  
  const [formData, setFormData] = useState({
    name: '',
    category: 'Starter',
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
      if (data.length > 0 && formData.category === 'Starter') {
        setFormData(prev => ({ ...prev, category: data[0].name }));
      }
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    }
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
        category: item.category,
        price: item.price,
        description: item.description || '',
        image: item.image || '',
        chefPick: !!item.chefPick
      });
    } else {
      setEditingItem(null);
      setFormData({
        name: '',
        category: categories.length > 0 ? categories[0].name : '',
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
        })
      });

      if (res.ok) {
        setIsModalOpen(false);
        fetchMenu();
      }
    } catch (err) {
      console.error('Error saving item:', err);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this item?')) return;
    try {
      const res = await fetch(`/api/menu/${id}`, { method: 'DELETE' });
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
        body: JSON.stringify({ available: newStatus })
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
        body: form
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
        body: JSON.stringify({ name: newCategoryName })
      });
      if (res.ok) {
        setNewCategoryName('');
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
      const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchCategories();
      }
    } catch (err) {
      console.error('Failed to delete category:', err);
    }
  };

  return (
    <div className="flex flex-col h-full w-full pb-10">
      <div className="flex justify-between items-center mb-8 animate-[fadeUp_0.6s_ease-out_forwards]">
        <div>
          <h2 className="font-headline-md text-primary text-[28px] mb-1">Menu Management</h2>
          <p className="font-body-sm text-on-surface-variant">Organize and configure food items easily.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsCategoryModalOpen(true)}
            className="bg-surface-container text-on-surface hover:text-primary font-title-md text-[14px] sm:text-[16px] font-semibold px-4 py-2 rounded-DEFAULT border border-outline-variant/30 hover:border-primary/50 transition-all flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[20px]">category</span> 
            <span className="hidden sm:inline">Categories</span>
          </button>
          <button 
            onClick={() => handleOpenModal()}
            className="bg-primary text-on-primary font-title-md text-[14px] sm:text-[16px] font-semibold px-4 sm:px-6 py-2 rounded-DEFAULT ripple shadow-[0_0_15px_rgba(212,175,55,0.3)] hover:shadow-[0_0_25px_rgba(212,175,55,0.5)] transition-shadow duration-300 flex items-center gap-2"
          >
            <span className="material-symbols-outlined">add</span> 
            <span className="hidden sm:inline">Add New Item</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 opacity-50 bg-surface-container-low rounded-xl border border-outline-variant/20">
          <span className="material-symbols-outlined text-6xl mb-4">restaurant_menu</span>
          <p className="font-body-lg text-[16px]">No menu items found. Add one to get started.</p>
        </div>
      ) : (
        <div className="bg-surface-container-low rounded-xl border border-outline-variant/20 overflow-hidden shadow-lg animate-[fadeUp_0.8s_ease-out_forwards]">
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
                {items.map((item, idx) => (
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
                    <td className="px-6 py-3">
                      <span className="bg-surface-variant text-on-surface-variant px-2 py-1 rounded text-[12px] font-mono-data tracking-wider">
                        {item.category}
                      </span>
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
                    <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1 uppercase tracking-widest">Category</label>
                    <select 
                      value={formData.category} 
                      onChange={e => setFormData({...formData, category: e.target.value})}
                      className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded px-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none cursor-pointer"
                    >
                      {categories.map(cat => (
                        <option key={cat._id} value={cat.name}>{cat.name}</option>
                      ))}
                      {categories.length === 0 && <option value="" disabled>No categories available</option>}
                    </select>
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
                  <div className="col-span-2 flex items-center gap-3 mt-2">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={formData.chefPick} onChange={e => setFormData({...formData, chefPick: e.target.checked})} className="sr-only peer" />
                      <div className="w-11 h-6 bg-surface-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                      <span className="ml-3 font-body-sm text-on-surface">Chef's Pick Feature</span>
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
    </div>
  );
}

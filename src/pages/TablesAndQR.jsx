import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function TablesAndQR() {
  const [tables, setTables] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  
  const [formData, setFormData] = useState({ name: '', location: '', seats: 4 });
  const [newLocationName, setNewLocationName] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('All');
  
  const [openDropdownId, setOpenDropdownId] = useState(null);

  const fetchData = async () => {
    try {
      const [tablesRes, locsRes] = await Promise.all([
        fetch('/api/tables'),
        fetch('/api/locations')
      ]);
      const tablesData = await tablesRes.json();
      const locsData = await locsRes.json();
      
      setTables(Array.isArray(tablesData) ? tablesData : (tablesData.tables || []));
      setLocations(Array.isArray(locsData) ? locsData : []);
    } catch (err) {
      console.error('Failed to fetch data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const submitGenerateQR = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, baseUrl: window.location.origin })
      });
      if (res.ok) {
        const newTable = await res.json();
        setTables(prev => [...prev, newTable]);
        setIsModalOpen(false);
        setFormData({ name: '', location: locations.length > 0 ? locations[0].name : '', seats: 4 });
      }
    } catch (err) {
      console.error('Failed to generate QR', err);
    }
  };

  const submitCreateLocation = async (e) => {
    e.preventDefault();
    if (!newLocationName.trim()) return;
    try {
      const res = await fetch('/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newLocationName })
      });
      if (res.ok) {
        const newLoc = await res.json();
        setLocations(prev => [...prev, newLoc]);
        setIsLocationModalOpen(false);
        setNewLocationName('');
        if (!formData.location) {
          setFormData(prev => ({ ...prev, location: newLoc.name }));
        }
      }
    } catch (err) {
      console.error('Failed to create location', err);
    }
  };

  const handleDeleteTable = async (id) => {
    if (!window.confirm('Are you sure you want to delete this table?')) return;
    try {
      const res = await fetch(`/api/tables/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setTables(prev => prev.filter(t => t._id !== id));
      }
    } catch (err) {
      console.error('Failed to delete table', err);
    }
  };

  const filteredTables = selectedFilter === 'All' 
    ? tables 
    : tables.filter(t => t.location === selectedFilter);

  return (
    <div className="flex flex-col h-full w-full pb-10">
      {/* Top Actions */}
      <div className="flex justify-between items-center mb-8 animate-[fadeUp_0.6s_ease-out_forwards]">
        <div className="flex gap-4 items-center">
          <div className="relative">
            <select 
              value={selectedFilter}
              onChange={(e) => setSelectedFilter(e.target.value)}
              className="bg-surface-container-high hover:bg-surface-container-highest border border-outline-variant text-on-surface pl-4 pr-10 py-2 rounded-DEFAULT font-label-caps text-[12px] font-bold tracking-[0.1em] transition-colors appearance-none outline-none focus:border-primary cursor-pointer"
            >
              <option value="All">All Locations</option>
              {locations.map(loc => (
                <option key={loc._id || loc.name} value={loc.name}>{loc.name}</option>
              ))}
            </select>
            <span className="material-symbols-outlined absolute right-3 top-2 text-on-surface-variant text-[18px] pointer-events-none">expand_more</span>
          </div>

          <div className="relative group hidden sm:block">
            <input 
              className="bg-transparent border-b border-surface-variant text-on-surface focus:outline-none focus:border-primary focus:shadow-[0_4px_12px_rgba(212,175,55,0.1)] transition-all duration-300 py-2 pl-8 pr-4 w-64 placeholder-on-surface-variant font-body-sm text-[14px]" 
              placeholder="Search tables..." 
              type="text"
            />
            <span className="material-symbols-outlined absolute left-0 top-2.5 text-on-surface-variant text-[18px]">search</span>
          </div>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setIsLocationModalOpen(true)}
            className="bg-surface-container-high border border-outline-variant/50 text-on-surface font-title-md text-[14px] sm:text-[16px] font-semibold px-4 py-2 rounded-DEFAULT hover:border-primary/50 transition-colors flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px] hidden sm:block">add_location</span> 
            <span className="hidden sm:block">Create Location</span>
            <span className="sm:hidden">Location +</span>
          </button>
          <button 
            onClick={() => {
              if (locations.length > 0 && !formData.location) {
                setFormData(prev => ({ ...prev, location: locations[0].name }));
              }
              setIsModalOpen(true);
            }}
            className="bg-primary text-on-primary font-title-md text-[14px] sm:text-[16px] font-semibold px-4 sm:px-6 py-2 rounded-DEFAULT ripple shadow-[0_0_15px_rgba(212,175,55,0.3)] hover:shadow-[0_0_25px_rgba(212,175,55,0.5)] transition-shadow duration-300 flex items-center gap-2"
          >
            <span className="material-symbols-outlined hidden sm:block">qr_code</span> 
            <span className="hidden sm:block">Generate QR</span>
            <span className="sm:hidden">QR +</span>
          </button>
        </div>
      </div>

      {/* Table Grid */}
      {loading ? (
        <div className="flex justify-center items-center py-20">
          <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
        </div>
      ) : filteredTables.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 opacity-50">
          <span className="material-symbols-outlined text-6xl mb-4">grid_off</span>
          <p className="font-body-lg text-[16px]">No tables found for this location.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-gutter overflow-y-auto pb-8">
          {filteredTables.map((table, index) => (
            <motion.div 
              key={table._id || index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="bg-surface-container-low rounded-lg p-container-padding border border-white/5 relative group hover:-translate-y-2 transition-transform duration-300 hover:border-primary/50 overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-surface-container-highest to-background opacity-50 z-0"></div>
              <div className="relative z-10 flex flex-col h-full">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className="font-title-md text-[20px] font-semibold text-on-surface">{table.name || `Table ${table.number}`}</h3>
                    <p className="font-body-sm text-[14px] text-on-surface-variant mt-1">{table.location || 'Main Dining Room'}</p>
                  </div>
                  <div className={`px-2 py-1 rounded-sm font-label-caps text-[12px] font-bold tracking-[0.1em] ${
                    table.status === 'Active' ? 'bg-primary/20 text-primary' : 'bg-surface-container-highest text-on-surface-variant'
                  }`}>
                    {table.status || 'Idle'}
                  </div>
                </div>
                
                <div className="flex-1 flex justify-center items-center py-6 relative">
                  <div className="w-32 h-32 bg-white/10 rounded-DEFAULT relative overflow-hidden group-hover:scale-110 transition-transform duration-500 flex items-center justify-center border border-white/20">
                    <div className="w-full h-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-white/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 absolute inset-0 transition-opacity duration-500"></div>
                    {table.qrUrl ? (
                      <img src={table.qrUrl} alt={`QR for ${table.name}`} className="w-full h-full object-cover mix-blend-screen" />
                    ) : (
                      <span className="material-symbols-outlined text-white/50 text-[64px]">qr_code_2</span>
                    )}
                  </div>
                  
                  <div className="absolute bottom-0 left-0 w-full flex justify-center translate-y-10 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300">
                    <a 
                      href={table.qrUrl} 
                      download={`QR_${table.name.replace(/\s+/g, '_')}.png`}
                      className="bg-surface-bright border border-outline text-on-surface rounded-full px-4 py-2 flex items-center gap-2 shadow-lg hover:text-primary hover:border-primary"
                    >
                      <span className="material-symbols-outlined text-[18px]">download</span> Download
                    </a>
                  </div>
                </div>
                
                <div className="mt-4 pt-4 border-t border-surface-variant flex justify-between items-center relative">
                  <div className="font-mono-data text-[14px] font-medium tracking-[0.02em] text-on-surface-variant">Seats: {table.seats || 4}</div>
                  <button 
                    onClick={() => setOpenDropdownId(openDropdownId === table._id ? null : table._id)} 
                    className="text-on-surface-variant hover:text-primary transition-colors"
                  >
                    <span className="material-symbols-outlined text-[20px]">more_vert</span>
                  </button>
                  
                  <AnimatePresence>
                    {openDropdownId === table._id && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95, y: -10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -10 }}
                        className="absolute right-0 bottom-full mb-2 w-36 bg-surface-container-high border border-outline-variant/30 rounded shadow-xl z-20 overflow-hidden"
                      >
                        <button 
                          onClick={() => { handleDeleteTable(table._id); setOpenDropdownId(null); }}
                          className="w-full text-left px-4 py-3 font-body-sm text-[13px] text-error hover:bg-surface-bright transition-colors flex items-center gap-2"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span> Delete Table
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Location Create Modal */}
      <AnimatePresence>
        {isLocationModalOpen && (
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
              className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-sm p-6 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="font-headline-sm text-primary text-[24px]">New Location</h2>
                <button onClick={() => setIsLocationModalOpen(false)} className="text-on-surface-variant hover:text-primary transition-colors">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <form onSubmit={submitCreateLocation} className="space-y-4">
                <div>
                  <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1 uppercase tracking-widest">Location Name</label>
                  <input required type="text" value={newLocationName} onChange={e => setNewLocationName(e.target.value)} placeholder="e.g. Patio, VIP Lounge" className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded px-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none" />
                </div>
                <div className="pt-4 flex justify-end gap-3">
                  <button type="button" onClick={() => setIsLocationModalOpen(false)} className="px-5 py-2 text-on-surface hover:text-primary font-label-caps text-[12px] uppercase tracking-widest">Cancel</button>
                  <button type="submit" className="bg-primary text-on-primary px-6 py-2 rounded font-label-caps text-[12px] uppercase tracking-widest gold-glow">Save Location</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Generate QR Modal Overlay */}
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
              className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-md p-6 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="font-headline-sm text-primary text-[24px]">New Table QR</h2>
                <button onClick={() => setIsModalOpen(false)} className="text-on-surface-variant hover:text-primary transition-colors">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <form onSubmit={submitGenerateQR} className="space-y-4">
                <div>
                  <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1 uppercase tracking-widest">Table Name / Number</label>
                  <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g. VIP Table 1" className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded px-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none" />
                </div>
                <div>
                  <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1 uppercase tracking-widest">Location / Section</label>
                  <select 
                    value={formData.location} 
                    onChange={e => setFormData({...formData, location: e.target.value})} 
                    className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded px-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none appearance-none cursor-pointer"
                    required
                  >
                    <option value="" disabled>Select a location</option>
                    {locations.map(loc => (
                      <option key={loc._id || loc.name} value={loc.name}>{loc.name}</option>
                    ))}
                  </select>
                  {locations.length === 0 && (
                    <p className="text-[12px] text-error mt-1">Please create a location first.</p>
                  )}
                </div>
                <div>
                  <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1 uppercase tracking-widest">Seats</label>
                  <input type="number" min="1" value={formData.seats} onChange={e => setFormData({...formData, seats: parseInt(e.target.value)})} className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded px-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none" />
                </div>
                <div className="pt-4 flex justify-end gap-3">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2 text-on-surface hover:text-primary font-label-caps text-[12px] uppercase tracking-widest">Cancel</button>
                  <button type="submit" disabled={locations.length === 0} className="bg-primary text-on-primary px-6 py-2 rounded font-label-caps text-[12px] uppercase tracking-widest gold-glow disabled:opacity-50 disabled:cursor-not-allowed">Generate & Save</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

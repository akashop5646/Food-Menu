import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function Settings({ user }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fetchStaff = async () => {
    try {
      const res = await fetch('/api/settings/staff', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setStaff(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStaff();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/settings/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
        credentials: 'include'
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add staff');

      setStaff([...staff, data]);
      setIsModalOpen(false);
      setFormData({ name: '', email: '', password: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (dateString) => {
    const d = new Date(dateString);
    if (isNaN(d)) return '';
    return `Added ${d.getDate()} ${d.toLocaleString('default', { month: 'short' })} ${d.getFullYear()}`;
  };

  const getInitials = (name, email) => {
    if (name) return name.charAt(0).toUpperCase();
    if (email) return email.charAt(0).toUpperCase();
    return '?';
  };

  return (
    <div className="max-w-4xl mx-auto py-8">
      <div className="bg-surface-container rounded-2xl border border-outline-variant/20 shadow-lg overflow-hidden">
        
        {/* Header */}
        <div className="p-6 md:p-8 flex flex-col md:flex-row justify-between md:items-center gap-4 border-b border-outline-variant/10">
          <div>
            <h2 className="font-headline-md text-2xl text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">group</span>
              Staff Members
            </h2>
            <p className="font-body-md text-on-surface-variant mt-1">Click on a member to view profile & manage password</p>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-primary text-on-primary px-5 py-2.5 rounded-lg font-label-caps uppercase tracking-wider flex items-center justify-center gap-2 gold-glow shrink-0 transition-transform hover:scale-105"
          >
            <span className="material-symbols-outlined text-[20px]">person_add</span>
            Add Staff
          </button>
        </div>

        {/* List */}
        <div className="p-6 md:p-8 flex flex-col gap-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
            </div>
          ) : (
            staff.map((member) => (
              <div 
                key={member._id}
                className="group flex flex-col md:flex-row md:items-center justify-between p-4 md:p-5 rounded-xl border border-outline-variant/30 hover:border-primary/40 bg-surface-container-lowest hover:bg-surface-container-low transition-all cursor-pointer"
              >
                <div className="flex items-center gap-4">
                  {/* Avatar */}
                  <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-display-sm text-xl shrink-0">
                    {getInitials(member.name, member.email)}
                  </div>
                  
                  {/* Info */}
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-title-md text-on-surface text-lg">
                        {member.name || member.email.split('@')[0]}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-label-caps tracking-wider uppercase ${member.role === 'ADMIN' ? 'bg-primary/20 text-primary border border-primary/30' : 'bg-surface-variant text-on-surface-variant'}`}>
                        {member.role || 'ADMIN'}
                      </span>
                      {user?.id === member._id && (
                        <span className="px-2 py-0.5 rounded bg-tertiary/20 text-tertiary border border-tertiary/30 text-[10px] font-label-caps tracking-wider uppercase">
                          Current Session
                        </span>
                      )}
                    </div>
                    <p className="font-body-sm text-on-surface-variant mt-0.5">
                      {member.email}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 mt-4 md:mt-0 md:ml-4 text-on-surface-variant">
                  <span className="font-body-sm text-[13px] opacity-70">
                    {formatDate(member.createdAt)}
                  </span>
                  <span className="material-symbols-outlined opacity-50 group-hover:opacity-100 group-hover:text-primary transition-colors">
                    chevron_right
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Add Staff Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-surface-container rounded-2xl border border-primary/20 shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-outline-variant/10 flex justify-between items-center bg-surface-container-lowest">
                <h3 className="font-headline-sm text-primary">Add New Staff</h3>
                <button onClick={() => setIsModalOpen(false)} className="text-on-surface-variant hover:text-primary transition-colors">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
                {error && (
                  <div className="bg-error/10 text-error px-4 py-3 rounded-lg border border-error/20 text-sm font-medium">
                    {error}
                  </div>
                )}
                
                <div>
                  <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1.5 uppercase tracking-widest">Email Address *</label>
                  <input 
                    required 
                    type="email" 
                    value={formData.email} 
                    onChange={e => setFormData({...formData, email: e.target.value})} 
                    className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
                    placeholder="staff@restaurant.com"
                  />
                </div>

                <div>
                  <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1.5 uppercase tracking-widest">Full Name</label>
                  <input 
                    type="text" 
                    value={formData.name} 
                    onChange={e => setFormData({...formData, name: e.target.value})} 
                    className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
                    placeholder="Optional"
                  />
                </div>

                <div>
                  <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1.5 uppercase tracking-widest">Password</label>
                  <input 
                    type="password" 
                    value={formData.password} 
                    onChange={e => setFormData({...formData, password: e.target.value})} 
                    className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
                    placeholder="Leave blank for Google Sign-in only"
                  />
                  <p className="font-body-sm text-[11px] text-on-surface-variant opacity-70 mt-2 leading-relaxed">
                    If you don't set a password, they will only be able to log in using the "Sign in with Google" button with this exact email address.
                  </p>
                </div>

                <div className="pt-4 flex justify-end gap-3 border-t border-outline-variant/10 mt-2">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2 text-on-surface hover:text-primary font-label-caps text-[12px] uppercase tracking-widest transition-colors">
                    Cancel
                  </button>
                  <button type="submit" disabled={isSubmitting} className="bg-primary text-on-primary px-6 py-2 rounded-lg font-label-caps text-[12px] uppercase tracking-widest gold-glow disabled:opacity-50 flex items-center gap-2">
                    {isSubmitting ? <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span> : null}
                    Add Member
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

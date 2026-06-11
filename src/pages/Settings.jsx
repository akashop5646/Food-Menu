import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function Settings({ user }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  
  // View & Edit Member states
  const [selectedMember, setSelectedMember] = useState(null);
  const [isUpdatingRole, setIsUpdatingRole] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState('');

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

  const handleUpdateRole = async (memberId, newRole) => {
    setIsUpdatingRole(true);
    setActionError('');
    try {
      const res = await fetch(`/api/settings/staff/${memberId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
        credentials: 'include'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update role');

      const updatedStaff = staff.map(m => m._id === memberId ? { ...m, role: newRole } : m);
      setStaff(updatedStaff);
      setSelectedMember({ ...selectedMember, role: newRole });
    } catch (err) {
      setActionError(err.message);
    } finally {
      setIsUpdatingRole(false);
    }
  };

  const handleDeleteMember = async (memberId) => {
    if (!window.confirm('Are you sure you want to remove this staff member? This action cannot be undone.')) {
      return;
    }
    setIsDeleting(true);
    setActionError('');
    try {
      const res = await fetch(`/api/settings/staff/${memberId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete staff member');

      setStaff(staff.filter(m => m._id !== memberId));
      setSelectedMember(null);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setIsDeleting(false);
    }
  };

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
    <div className="max-w-4xl mx-auto py-8 px-margin-mobile md:px-0">
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
                onClick={() => setSelectedMember(member)}
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

      {/* View & Edit Staff Modal */}
      <AnimatePresence>
        {selectedMember && (
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
                <h3 className="font-headline-sm text-primary">Staff Profile Details</h3>
                <button onClick={() => { setSelectedMember(null); setActionError(''); }} className="text-on-surface-variant hover:text-primary transition-colors">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="p-6 flex flex-col gap-6">
                {actionError && (
                  <div className="bg-error/10 text-error px-4 py-3 rounded-lg border border-error/20 text-sm font-medium">
                    {actionError}
                  </div>
                )}

                {/* Profile Header */}
                <div className="flex flex-col items-center">
                  <div className="w-20 h-20 rounded-full bg-primary/10 text-primary flex items-center justify-center font-display-lg text-4xl font-bold mb-3">
                    {getInitials(selectedMember.name, selectedMember.email)}
                  </div>
                  <h4 className="font-headline-sm text-xl text-on-surface text-center">
                    {selectedMember.name || selectedMember.email.split('@')[0]}
                  </h4>
                  <p className="font-body-md text-on-surface-variant mt-1 text-center">
                    {selectedMember.email}
                  </p>
                  <p className="font-body-sm text-[12px] text-on-surface-variant/70 mt-2">
                    {formatDate(selectedMember.createdAt)}
                  </p>
                </div>

                <div className="border-t border-outline-variant/10 pt-4">
                  <label className="block font-label-caps text-[12px] text-on-surface-variant mb-2 uppercase tracking-widest">
                    Role Management
                  </label>
                  
                  {selectedMember.role === 'ADMIN' ? (
                    <div className="bg-surface-container-high/40 border border-outline-variant/10 rounded-xl p-4 mt-2">
                      <div className="flex items-center gap-2 text-primary">
                        <span className="material-symbols-outlined text-lg">shield</span>
                        <span className="font-title-sm text-sm font-semibold">System Administrator</span>
                      </div>
                      <p className="font-body-sm text-[11px] text-on-surface-variant/80 mt-2 leading-relaxed">
                        This account has full Admin access. For system security, other Admins cannot modify or remove Admin roles.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="font-body-sm text-[11px] text-on-surface-variant/80 leading-relaxed mb-3">
                        Choose a role for this staff member. Promoting to Admin grants full configuration and management privileges.
                      </p>
                      <div className="flex gap-2">
                        <button 
                          type="button"
                          disabled={isUpdatingRole}
                          onClick={() => handleUpdateRole(selectedMember._id, 'STAFF')}
                          className={`flex-1 py-2.5 rounded-lg border text-xs font-label-caps uppercase tracking-widest transition-all ${
                            selectedMember.role === 'STAFF' 
                              ? 'bg-primary/10 border-primary text-primary shadow-[inset_0_0_10px_rgba(212,175,55,0.1)]' 
                              : 'bg-surface-container-highest border-outline-variant/30 text-on-surface-variant hover:text-on-surface'
                          }`}
                        >
                          Staff Member
                        </button>
                        <button 
                          type="button"
                          disabled={isUpdatingRole}
                          onClick={() => handleUpdateRole(selectedMember._id, 'ADMIN')}
                          className={`flex-1 py-2.5 rounded-lg border text-xs font-label-caps uppercase tracking-widest transition-all ${
                            selectedMember.role === 'ADMIN' 
                              ? 'bg-primary/10 border-primary text-primary shadow-[inset_0_0_10px_rgba(212,175,55,0.1)]' 
                              : 'bg-surface-container-highest border-outline-variant/30 text-on-surface-variant hover:text-on-surface'
                          }`}
                        >
                          Admin
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Remove Member option if not an Admin */}
                {selectedMember.role !== 'ADMIN' && (
                  <div className="border-t border-outline-variant/10 pt-4 mt-2">
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => handleDeleteMember(selectedMember._id)}
                      className="w-full border border-error/30 hover:bg-error/10 text-error py-3 rounded-lg font-label-caps text-[12px] uppercase tracking-widest transition-all duration-200 flex items-center justify-center gap-2"
                    >
                      {isDeleting ? (
                        <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                      ) : (
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      )}
                      Remove Staff Member
                    </button>
                  </div>
                )}

                <div className="pt-4 flex justify-end border-t border-outline-variant/10 mt-2">
                  <button 
                    type="button" 
                    onClick={() => { setSelectedMember(null); setActionError(''); }} 
                    className="px-6 py-2.5 bg-surface-container-highest hover:bg-surface-container-highest/80 text-on-surface rounded-lg font-label-caps text-[12px] uppercase tracking-widest transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

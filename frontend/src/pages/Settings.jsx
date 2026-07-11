import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { API_BASE } from '../config';

const MAX_SETTLEMENT_RECIPIENTS = 10;
const TOTAL_SETTLEMENT_BASIS_POINTS = 10000;

const formatSettlementPercentage = (basisPoints) => (Number(basisPoints || 0) / 100).toFixed(2);

const percentageToBasisPoints = (value) => {
  const input = String(value).trim();
  if (!/^\d{0,3}(?:\.\d{0,2})?$/.test(input)) return null;
  const [whole = '0', decimal = ''] = input.split('.');
  return (Number(whole || 0) * 100) + Number((decimal + '00').slice(0, 2));
};

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

  // General Config states
  const [restaurantNameInput, setRestaurantNameInput] = useState('');
  const [restaurantAddressInput, setRestaurantAddressInput] = useState('');
  const [restaurantPhoneInput, setRestaurantPhoneInput] = useState('');
  const [restaurantFssaiInput, setRestaurantFssaiInput] = useState('');
  const [restaurantEmailInput, setRestaurantEmailInput] = useState('');
  const [restaurantHoursInput, setRestaurantHoursInput] = useState('');
  const [restaurantMapLinkInput, setRestaurantMapLinkInput] = useState('');
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configSuccess, setConfigSuccess] = useState(false);
  const [configError, setConfigError] = useState('');

  // Convenience Fee states
  const [convenienceFeeEnabled, setConvenienceFeeEnabled] = useState(false);
  const [convenienceFeeAmount, setConvenienceFeeAmount] = useState(0);
  const [isSavingFee, setIsSavingFee] = useState(false);
  const [feeSuccess, setFeeSuccess] = useState(false);
  const [feeError, setFeeError] = useState('');

  // Split settlement state is fetched only for MASTER_ADMIN users. Linked account IDs never enter public settings state.
  const [settlementConfig, setSettlementConfig] = useState(null);
  const [settlementRecipients, setSettlementRecipients] = useState([]);
  const [isSettlementLoading, setIsSettlementLoading] = useState(false);
  const [isSavingSettlement, setIsSavingSettlement] = useState(false);
  const [isActivatingSettlement, setIsActivatingSettlement] = useState(false);
  const [isDisablingSettlement, setIsDisablingSettlement] = useState(false);
  const [settlementDirty, setSettlementDirty] = useState(false);
  const [settlementSuccess, setSettlementSuccess] = useState('');
  const [settlementError, setSettlementError] = useState('');

  const fetchStaff = async () => {
    try {
      const res = await fetch(API_BASE + '/api/settings/staff', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setStaff(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchConfigs = async () => {
    try {
      const [profileRes, feeRes] = await Promise.all([
        fetch(API_BASE + '/api/settings/restaurant-profile', { credentials: 'include' }),
        fetch(API_BASE + '/api/settings/convenience-fee', { credentials: 'include' })
      ]);

      if (profileRes.ok) {
        const profileData = await profileRes.json();
        setRestaurantNameInput(profileData.restaurantName || 'Aurum Restaurant');
        setRestaurantAddressInput(profileData.restaurantAddress || '');
        setRestaurantPhoneInput(profileData.restaurantPhone || '');
        setRestaurantFssaiInput(profileData.restaurantFssai || '');
        setRestaurantEmailInput(profileData.restaurantEmail || '');
        setRestaurantHoursInput(profileData.restaurantHours || 'Monday - Sunday, 11:00 AM - 11:00 PM IST');
        setRestaurantMapLinkInput(profileData.restaurantMapLink || '');
      }

      if (feeRes.ok) {
        const feeData = await feeRes.json();
        setConvenienceFeeEnabled(!!feeData.enabled);
        setConvenienceFeeAmount(Number(feeData.amount) || 0);
      }
    } catch (err) {
      console.error('Failed to load settings configs:', err);
    }
  };

  const applySettlementConfig = (config) => {
    setSettlementConfig(config);
    setSettlementRecipients(config.draft?.recipients || []);
    setSettlementDirty(false);
  };

  const fetchSettlementConfig = async () => {
    if (user?.role !== 'MASTER_ADMIN') return;

    setIsSettlementLoading(true);
    setSettlementError('');
    try {
      const res = await fetch(API_BASE + '/api/settings/split-settlement', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load split settlement configuration');
      applySettlementConfig(data);
    } catch (err) {
      setSettlementError(err.message);
    } finally {
      setIsSettlementLoading(false);
    }
  };

  useEffect(() => {
    fetchStaff();
    fetchConfigs();
    fetchSettlementConfig();
  }, [user?.role]);

  const handleUpdateRole = async (memberId, newRole) => {
    setIsUpdatingRole(true);
    setActionError('');
    try {
      const res = await fetch(`${API_BASE}/api/settings/staff/${memberId}/role`, {
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
      const res = await fetch(`${API_BASE}/api/settings/staff/${memberId}`, {
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
      const res = await fetch(API_BASE + '/api/settings/staff', {
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

  const handleConfigSubmit = async (e) => {
    e.preventDefault();
    setIsSavingConfig(true);
    setConfigError('');
    setConfigSuccess(false);

    try {
      const profileRes = await fetch(API_BASE + '/api/settings/restaurant-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantName: restaurantNameInput,
          restaurantAddress: restaurantAddressInput,
          restaurantPhone: restaurantPhoneInput,
          restaurantFssai: restaurantFssaiInput,
          restaurantEmail: restaurantEmailInput,
          restaurantHours: restaurantHoursInput,
          restaurantMapLink: restaurantMapLinkInput
        }),
        credentials: 'include'
      });

      const profileData = await profileRes.json();

      if (!profileRes.ok) throw new Error(profileData.error || 'Failed to save restaurant profile');

      setConfigSuccess(true);
      setTimeout(() => setConfigSuccess(false), 3000);
    } catch (err) {
      setConfigError(err.message);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleFeeSubmit = async (e) => {
    e.preventDefault();
    setIsSavingFee(true);
    setFeeError('');
    setFeeSuccess(false);

    try {
      const res = await fetch(API_BASE + '/api/settings/convenience-fee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: convenienceFeeEnabled,
          amount: Number(convenienceFeeAmount)
        }),
        credentials: 'include'
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save convenience fee settings');

      setFeeSuccess(true);
      setTimeout(() => setFeeSuccess(false), 3000);
    } catch (err) {
      setFeeError(err.message);
    } finally {
      setIsSavingFee(false);
    }
  };

  const updateSettlementRecipient = (index, changes) => {
    setSettlementRecipients((current) => current.map((recipient, recipientIndex) => (
      recipientIndex === index ? { ...recipient, ...changes } : recipient
    )));
    setSettlementDirty(true);
    setSettlementSuccess('');
    setSettlementError('');
  };

  const addSettlementRecipient = () => {
    if (settlementRecipients.length >= MAX_SETTLEMENT_RECIPIENTS) return;
    setSettlementRecipients((current) => [...current, {
      label: '',
      linkedAccountId: '',
      allocationBasisPoints: 0,
      enabled: true,
    }]);
    setSettlementDirty(true);
    setSettlementSuccess('');
  };

  const removeSettlementRecipient = (index) => {
    setSettlementRecipients((current) => current.filter((_, recipientIndex) => recipientIndex !== index));
    setSettlementDirty(true);
    setSettlementSuccess('');
  };

  const handleSaveSettlementDraft = async () => {
    const totalBasisPoints = settlementRecipients.reduce(
      (total, recipient) => total + (recipient.enabled ? Number(recipient.allocationBasisPoints || 0) : 0),
      0
    );
    if (settlementRecipients.length > MAX_SETTLEMENT_RECIPIENTS) {
      setSettlementError(`A maximum of ${MAX_SETTLEMENT_RECIPIENTS} recipients is allowed.`);
      return;
    }
    if (totalBasisPoints > TOTAL_SETTLEMENT_BASIS_POINTS) {
      setSettlementError('Enabled allocation cannot exceed 100%.');
      return;
    }

    setIsSavingSettlement(true);
    setSettlementError('');
    setSettlementSuccess('');
    try {
      const res = await fetch(API_BASE + '/api/settings/split-settlement/draft', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          revision: settlementConfig?.revision,
          recipients: settlementRecipients,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save settlement draft');
      applySettlementConfig(data);
      setSettlementSuccess('Settlement draft saved.');
    } catch (err) {
      setSettlementError(err.message);
    } finally {
      setIsSavingSettlement(false);
    }
  };

  const handleActivateSettlement = async () => {
    if (settlementDirty) {
      setSettlementError('Save the current draft before activating it.');
      return;
    }
    if (!window.confirm('Activate Split Settlement? This configuration will apply to future eligible payments. Settlement percentages apply to the food subtotal only; convenience fees are excluded.')) {
      return;
    }

    setIsActivatingSettlement(true);
    setSettlementError('');
    setSettlementSuccess('');
    try {
      const res = await fetch(API_BASE + '/api/settings/split-settlement/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ revision: settlementConfig?.revision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to activate split settlement configuration');
      applySettlementConfig(data);
      setSettlementSuccess('Split settlement configuration activated.');
    } catch (err) {
      setSettlementError(err.message);
    } finally {
      setIsActivatingSettlement(false);
    }
  };

  const handleDisableSettlement = async () => {
    if (!window.confirm('Disable Split Settlement? Future eligible payments will not use this configuration. The active snapshot and draft will be preserved.')) {
      return;
    }

    setIsDisablingSettlement(true);
    setSettlementError('');
    setSettlementSuccess('');
    try {
      const res = await fetch(API_BASE + '/api/settings/split-settlement/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ revision: settlementConfig?.revision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to disable split settlement configuration');
      applySettlementConfig(data);
      setSettlementSuccess('Split settlement disabled. The saved configuration was preserved.');
    } catch (err) {
      setSettlementError(err.message);
    } finally {
      setIsDisablingSettlement(false);
    }
  };

  const settlementTotalBasisPoints = settlementRecipients.reduce(
    (total, recipient) => total + (recipient.enabled ? Number(recipient.allocationBasisPoints || 0) : 0),
    0
  );
  const settlementRemainingBasisPoints = TOTAL_SETTLEMENT_BASIS_POINTS - settlementTotalBasisPoints;
  const savedDraftIsActivatable = Boolean(settlementConfig?.draft?.isValidForActivation);



  return (
    <div className="max-w-4xl mx-auto py-8 px-margin-mobile md:px-0 flex flex-col gap-8">
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
                      <span className={`px-2 py-0.5 rounded text-[10px] font-label-caps tracking-wider uppercase ${member.role === 'ADMIN' || member.role === 'MASTER_ADMIN' ? 'bg-primary/20 text-primary border border-primary/30' : 'bg-surface-variant text-on-surface-variant'}`}>
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
                  
                  {selectedMember.role === 'MASTER_ADMIN' || (selectedMember.role === 'ADMIN' && user?.role !== 'MASTER_ADMIN') ? (
                    <div className="bg-surface-container-high/40 border border-outline-variant/10 rounded-xl p-4 mt-2">
                      <div className="flex items-center gap-2 text-primary">
                        <span className="material-symbols-outlined text-lg">shield</span>
                        <span className="font-title-sm text-sm font-semibold">
                          {selectedMember.role === 'MASTER_ADMIN' ? 'Master Administrator' : 'System Administrator'}
                        </span>
                      </div>
                      <p className="font-body-sm text-[11px] text-on-surface-variant/80 mt-2 leading-relaxed">
                        {selectedMember.role === 'MASTER_ADMIN' 
                          ? 'This account is a Master Administrator. For system security, Master Admin accounts cannot be modified or removed.' 
                          : 'This account has full Admin access. For system security, other Admins cannot modify or remove Admin roles.'}
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

                {!(selectedMember.role === 'MASTER_ADMIN' || (selectedMember.role === 'ADMIN' && user?.role !== 'MASTER_ADMIN')) && (
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

      {/* General Configurations Card */}
      <div className="bg-surface-container rounded-2xl border border-outline-variant/20 shadow-lg overflow-hidden">
        {/* Header */}
        <div className="p-6 md:p-8 border-b border-outline-variant/10">
          <h2 className="font-headline-md text-2xl text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">settings</span>
            General Configurations
          </h2>
          <p className="font-body-md text-on-surface-variant mt-1">Configure restaurant profile name and settlement parameters</p>
        </div>

        {/* Content */}
        <form onSubmit={handleConfigSubmit} className="p-6 md:p-8 flex flex-col gap-6">
          {configSuccess && (
            <div className="bg-primary/10 text-primary px-4 py-3 rounded-lg border border-primary/20 text-sm font-medium">
              Configurations saved successfully!
            </div>
          )}
          {configError && (
            <div className="bg-error/10 text-error px-4 py-3 rounded-lg border border-error/20 text-sm font-medium">
              {configError}
            </div>
          )}

          <div>
            <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1.5 uppercase tracking-widest">Restaurant Real/Trade Name *</label>
            <input 
              required 
              type="text" 
              value={restaurantNameInput} 
              onChange={e => setRestaurantNameInput(e.target.value)} 
              className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
              placeholder="e.g. Aurum Restaurant & Cafe"
            />
            <p className="font-body-sm text-[11px] text-on-surface-variant opacity-70 mt-2 leading-relaxed">
              This name will be displayed prominently across all customer touchpoints (menu header, cart summary, success confirmation, and invoices) as required by Razorpay payee guidelines.
            </p>
          </div>

          <div>
            <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1.5 uppercase tracking-widest">Restaurant Address *</label>
            <textarea 
              required
              rows={2}
              value={restaurantAddressInput} 
              onChange={e => setRestaurantAddressInput(e.target.value)} 
              className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors resize-none font-sans" 
              placeholder="e.g. 12, Aurum Culinary Street, Bangalore, India - 560001"
            />
            <p className="font-body-sm text-[11px] text-on-surface-variant opacity-70 mt-1 leading-relaxed">
              The physical location of your restaurant, printed on invoices and compliant policy disclosures.
            </p>
          </div>

          <div>
            <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1.5 uppercase tracking-widest">Restaurant Contact Number *</label>
            <input 
              required
              type="tel" 
              value={restaurantPhoneInput} 
              onChange={e => setRestaurantPhoneInput(e.target.value)} 
              className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
              placeholder="e.g. +91 98765 43210"
            />
            <p className="font-body-sm text-[11px] text-on-surface-variant opacity-70 mt-2 leading-relaxed">
              The restaurant customer support phone number.
            </p>
          </div>

          <div>
            <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1.5 uppercase tracking-widest">Restaurant Contact Email *</label>
            <input 
              required
              type="email" 
              value={restaurantEmailInput} 
              onChange={e => setRestaurantEmailInput(e.target.value)} 
              className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
              placeholder="e.g. support@yourrestaurant.com"
            />
            <p className="font-body-sm text-[11px] text-on-surface-variant opacity-70 mt-2 leading-relaxed">
              The restaurant customer support email address.
            </p>
          </div>

          <div>
            <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1.5 uppercase tracking-widest">Operational Hours *</label>
            <input 
              required
              type="text" 
              value={restaurantHoursInput} 
              onChange={e => setRestaurantHoursInput(e.target.value)} 
              className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
              placeholder="e.g. Monday - Sunday, 11:00 AM - 11:00 PM IST"
            />
            <p className="font-body-sm text-[11px] text-on-surface-variant opacity-70 mt-2 leading-relaxed">
              Your restaurant daily working hours displayed on the contact info page.
            </p>
          </div>

          <div>
            <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1.5 uppercase tracking-widest">Google Maps Link (Optional)</label>
            <input 
              type="url" 
              value={restaurantMapLinkInput} 
              onChange={e => setRestaurantMapLinkInput(e.target.value)} 
              className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
              placeholder="e.g. https://maps.app.goo.gl/xxxxxxxx"
            />
            <p className="font-body-sm text-[11px] text-on-surface-variant opacity-70 mt-2 leading-relaxed">
              Google Maps URL of your physical location, used to display a location button in the menu footer.
            </p>
          </div>

          <div>
            <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1.5 uppercase tracking-widest">FSSAI Licence Number (Optional)</label>
            <input 
              type="text" 
              value={restaurantFssaiInput} 
              onChange={e => setRestaurantFssaiInput(e.target.value)} 
              className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
              placeholder="e.g. 12345678901234"
            />
            <p className="font-body-sm text-[11px] text-on-surface-variant opacity-70 mt-2 leading-relaxed">
              Food Safety and Standards Authority of India registration number.
            </p>
          </div>



          <div className="flex justify-end pt-4 border-t border-outline-variant/10">
            <button 
              type="submit" 
              disabled={isSavingConfig}
              className="bg-primary text-on-primary px-6 py-2.5 rounded-lg font-label-caps text-[12px] uppercase tracking-widest gold-glow disabled:opacity-50 flex items-center gap-2"
            >
              {isSavingConfig ? <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span> : null}
              Save Configurations
            </button>
          </div>
        </form>
      </div>

      {/* Payment & Fees Card */}
      <div className="bg-surface-container rounded-2xl border border-outline-variant/20 shadow-lg overflow-hidden">
        {/* Header */}
        <div className="p-6 md:p-8 border-b border-outline-variant/10">
          <h2 className="font-headline-md text-2xl text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">payments</span>
            Payment & Fees
          </h2>
          <p className="font-body-md text-on-surface-variant mt-1">Configure customer convenience fees and online gateway surcharges</p>
        </div>

        {/* Content */}
        <form onSubmit={handleFeeSubmit} className="p-6 md:p-8 flex flex-col gap-6">
          {feeSuccess && (
            <div className="bg-primary/10 text-primary px-4 py-3 rounded-lg border border-primary/20 text-sm font-medium">
              Payment settings saved successfully!
            </div>
          )}
          {feeError && (
            <div className="bg-error/10 text-error px-4 py-3 rounded-lg border border-error/20 text-sm font-medium">
              {feeError}
            </div>
          )}

          {/* Toggle */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-surface-container-highest/40 border border-outline-variant/20">
            <div>
              <span className="block font-semibold text-on-surface text-sm">Enable Customer Convenience Fee</span>
              <p className="text-xs text-on-surface-variant opacity-80 mt-1">Charge a fixed fee for Tableside ordering and payment facilities</p>
            </div>
            <button
              type="button"
              onClick={() => setConvenienceFeeEnabled(prev => !prev)}
              className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors duration-300 outline-none ${
                convenienceFeeEnabled ? 'bg-primary' : 'bg-outline-variant/50'
              }`}
            >
              <div
                className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-300 ${
                  convenienceFeeEnabled ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Input field */}
          <div>
            <label className="block font-label-caps text-[12px] text-on-surface-variant mb-1.5 uppercase tracking-widest">
              Convenience Fee Amount (₹0 – ₹20) *
            </label>
            <input 
              type="number"
              min={0}
              max={20}
              step={1}
              disabled={!convenienceFeeEnabled}
              value={convenienceFeeAmount}
              onChange={e => setConvenienceFeeAmount(e.target.value === '' ? '' : Math.max(0, Math.min(20, parseInt(e.target.value) || 0)))}
              className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed" 
              placeholder="e.g. 10"
              required={convenienceFeeEnabled}
            />
            <p className="font-body-sm text-[11px] text-on-surface-variant opacity-70 mt-2 leading-relaxed">
              This fee is charged to customers as a separate line item during checkout. Allowed range: ₹0 – ₹20.
            </p>
          </div>

          {/* Preview Panel */}
          <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/15 flex flex-col gap-2.5">
            <span className="font-label-caps text-[10px] text-primary uppercase tracking-widest block border-b border-outline-variant/10 pb-1.5 mb-1">
              Checkout Fee Preview
            </span>
            <div className="flex justify-between text-sm text-on-surface-variant">
              <span>Food subtotal:</span>
              <span className="font-mono">₹500.00</span>
            </div>
            <div className="flex justify-between text-sm text-on-surface-variant">
              <span>Convenience fee:</span>
              <span className="font-mono">₹{(convenienceFeeEnabled ? Number(convenienceFeeAmount || 0) : 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm font-semibold text-on-surface border-t border-outline-variant/10 pt-2">
              <span>Customer pays:</span>
              <span className="font-mono text-primary">
                ₹{(500 + (convenienceFeeEnabled ? Number(convenienceFeeAmount || 0) : 0)).toFixed(2)}
              </span>
            </div>
          </div>

          {/* Action button */}
          <div className="flex justify-end pt-4 border-t border-outline-variant/10">
            <button 
              type="submit" 
              disabled={isSavingFee}
              className="bg-primary text-on-primary px-6 py-2.5 rounded-lg font-label-caps text-[12px] uppercase tracking-widest gold-glow disabled:opacity-50 flex items-center gap-2"
            >
              {isSavingFee ? <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span> : null}
              Save Payment Settings
            </button>
          </div>
        </form>
      </div>

      {user?.role === 'MASTER_ADMIN' && (
        <div className="bg-surface-container rounded-2xl border border-outline-variant/20 shadow-lg overflow-hidden">
          <div className="p-6 md:p-8 border-b border-outline-variant/10 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <h2 className="font-headline-md text-2xl text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">account_tree</span>
                Split Settlement
              </h2>
              <p className="font-body-md text-on-surface-variant mt-1">Configure how the food subtotal will be distributed through Razorpay Route.</p>
            </div>
            <span className="self-start px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary font-label-caps text-[10px] uppercase tracking-widest">Master Admin only</span>
          </div>

          <div className="p-6 md:p-8 flex flex-col gap-6">
            {settlementSuccess && (
              <div className="bg-primary/10 text-primary px-4 py-3 rounded-lg border border-primary/20 text-sm font-medium">
                {settlementSuccess}
              </div>
            )}
            {settlementError && (
              <div className="bg-error/10 text-error px-4 py-3 rounded-lg border border-error/20 text-sm font-medium">
                {settlementError}
              </div>
            )}

            {isSettlementLoading ? (
              <div className="py-10 text-center text-on-surface-variant flex items-center justify-center gap-2">
                <span className="material-symbols-outlined animate-spin text-primary">progress_activity</span>
                Loading split settlement configuration…
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="p-4 rounded-xl bg-surface-container-highest/40 border border-outline-variant/20">
                    <span className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-widest">Status</span>
                    <p className="mt-1 font-semibold text-on-surface">{settlementConfig?.status?.replace('_', ' ') || 'Not configured'}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-surface-container-highest/40 border border-outline-variant/20">
                    <span className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-widest">Active version</span>
                    <p className="mt-1 font-semibold text-on-surface">{settlementConfig?.active?.version ? `v${settlementConfig.active.version}` : '—'}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-surface-container-highest/40 border border-outline-variant/20">
                    <span className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-widest">Last updated</span>
                    <p className="mt-1 font-semibold text-on-surface text-sm">{settlementConfig?.draft?.updatedAt ? new Date(settlementConfig.draft.updatedAt).toLocaleString() : 'Not saved'}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-surface-container-highest/40 border border-outline-variant/20">
                    <span className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-widest">Last activated</span>
                    <p className="mt-1 font-semibold text-on-surface text-sm">{settlementConfig?.active?.activatedAt ? new Date(settlementConfig.active.activatedAt).toLocaleString() : 'Not activated'}</p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/15 text-sm text-on-surface-variant leading-relaxed">
                  Settlement percentages apply to the food subtotal only. Convenience fees are excluded from this split. Changes affect future eligible payments only.
                </div>

                {settlementConfig?.active && (
                  <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/15">
                    <div className="flex items-center justify-between gap-4 mb-3">
                      <span className="font-label-caps text-[11px] text-primary uppercase tracking-widest">Current active snapshot</span>
                      <span className="text-xs text-on-surface-variant">v{settlementConfig.active.version} · {settlementConfig.status === 'DISABLED' ? 'Disabled' : 'Active'}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {settlementConfig.active.recipients.map((recipient) => (
                        <div key={recipient.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-sm text-on-surface-variant">
                          <span>{recipient.label}{!recipient.enabled ? ' (disabled)' : ''}</span>
                          <span className="font-mono text-xs">{formatSettlementPercentage(recipient.allocationBasisPoints)}% · {recipient.linkedAccountId || 'No linked account ID'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-4">
                  {settlementRecipients.map((recipient, index) => (
                    <div key={recipient.id || `new-recipient-${index}`} className="p-4 md:p-5 rounded-xl bg-surface-container-highest/40 border border-outline-variant/20 flex flex-col gap-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block font-label-caps text-[11px] text-on-surface-variant mb-1.5 uppercase tracking-widest">Recipient name</label>
                          <input
                            type="text"
                            maxLength={80}
                            value={recipient.label}
                            onChange={(e) => updateSettlementRecipient(index, { label: e.target.value })}
                            className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                            placeholder="e.g. Restaurant Owner"
                          />
                        </div>
                        <div>
                          <label className="block font-label-caps text-[11px] text-on-surface-variant mb-1.5 uppercase tracking-widest">Razorpay Route account ID</label>
                          <input
                            type="text"
                            value={recipient.linkedAccountId}
                            onChange={(e) => updateSettlementRecipient(index, { linkedAccountId: e.target.value })}
                            className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                            placeholder="acc_xxxxxxxxx"
                            autoComplete="off"
                          />
                        </div>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-end gap-4">
                        <div className="w-full sm:w-52">
                          <label className="block font-label-caps text-[11px] text-on-surface-variant mb-1.5 uppercase tracking-widest">Settlement share (%)</label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={formatSettlementPercentage(recipient.allocationBasisPoints)}
                            onChange={(e) => {
                              const allocationBasisPoints = percentageToBasisPoints(e.target.value);
                              if (allocationBasisPoints !== null) updateSettlementRecipient(index, { allocationBasisPoints });
                            }}
                            className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                          />
                        </div>
                        <div className="w-full sm:w-auto flex items-center gap-2">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={recipient.enabled}
                            aria-label={`Enable or disable ${recipient.label || 'recipient'}`}
                            onClick={() => updateSettlementRecipient(index, { enabled: !recipient.enabled })}
                            className="h-11 w-11 shrink-0 rounded-full flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-highest"
                          >
                            <span className={`relative flex h-6 w-10 items-center rounded-full p-0.5 transition-colors duration-200 ${recipient.enabled ? 'bg-primary' : 'bg-outline-variant/60'}`}>
                              <span className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${recipient.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                            </span>
                          </button>
                          <span className={`font-label-caps text-[11px] uppercase tracking-widest ${recipient.enabled ? 'text-primary' : 'text-on-surface-variant'}`}>
                            {recipient.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeSettlementRecipient(index)}
                          className="w-full sm:w-auto px-4 py-3 rounded-lg border border-error/30 text-error font-label-caps text-[11px] uppercase tracking-widest hover:bg-error/10 transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={addSettlementRecipient}
                  disabled={settlementRecipients.length >= MAX_SETTLEMENT_RECIPIENTS}
                  className="self-start px-4 py-2.5 rounded-lg border border-primary/40 text-primary font-label-caps text-[11px] uppercase tracking-widest hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  + Add recipient
                </button>
                {settlementRecipients.length >= MAX_SETTLEMENT_RECIPIENTS && (
                  <p className="text-xs text-on-surface-variant">A maximum of {MAX_SETTLEMENT_RECIPIENTS} recipients is allowed.</p>
                )}

                <div className={`p-4 rounded-xl border ${settlementTotalBasisPoints === TOTAL_SETTLEMENT_BASIS_POINTS ? 'bg-primary/10 border-primary/30' : settlementTotalBasisPoints > TOTAL_SETTLEMENT_BASIS_POINTS ? 'bg-error/10 border-error/30' : 'bg-surface-container-low border-outline-variant/15'}`}>
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-label-caps text-[11px] uppercase tracking-widest text-on-surface-variant">Total allocation</span>
                    <span className="font-mono font-semibold text-on-surface">{formatSettlementPercentage(settlementTotalBasisPoints)}%</span>
                  </div>
                  <p className={`mt-2 text-sm ${settlementTotalBasisPoints === TOTAL_SETTLEMENT_BASIS_POINTS ? 'text-primary' : settlementTotalBasisPoints > TOTAL_SETTLEMENT_BASIS_POINTS ? 'text-error' : 'text-on-surface-variant'}`}>
                    {settlementTotalBasisPoints === TOTAL_SETTLEMENT_BASIS_POINTS
                      ? '100% allocated — ready to activate after saving.'
                      : settlementTotalBasisPoints > TOTAL_SETTLEMENT_BASIS_POINTS
                        ? `${formatSettlementPercentage(Math.abs(settlementRemainingBasisPoints))}% over the allowed allocation.`
                        : `${formatSettlementPercentage(settlementRemainingBasisPoints)}% remaining. Drafts may be saved below 100%.`}
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row sm:justify-end gap-3 pt-4 border-t border-outline-variant/10">
                  {settlementConfig?.active && settlementConfig?.status === 'ACTIVE' && (
                    <button
                      type="button"
                      disabled={isDisablingSettlement}
                      onClick={handleDisableSettlement}
                      className="px-5 py-2.5 rounded-lg border border-error/30 text-error font-label-caps text-[11px] uppercase tracking-widest hover:bg-error/10 transition-colors disabled:opacity-50"
                    >
                      {isDisablingSettlement ? 'Disabling…' : 'Disable split settlement'}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isSavingSettlement}
                    onClick={handleSaveSettlementDraft}
                    className="px-5 py-2.5 rounded-lg border border-primary/40 text-primary font-label-caps text-[11px] uppercase tracking-widest hover:bg-primary/10 transition-colors disabled:opacity-50"
                  >
                    {isSavingSettlement ? 'Saving…' : 'Save draft'}
                  </button>
                  <button
                    type="button"
                    disabled={!savedDraftIsActivatable || settlementDirty || isActivatingSettlement}
                    onClick={handleActivateSettlement}
                    className="px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-caps text-[11px] uppercase tracking-widest gold-glow disabled:opacity-50 disabled:cursor-not-allowed"
                    title={settlementDirty ? 'Save the current draft before activating it.' : !savedDraftIsActivatable ? 'A saved draft with exactly 100% enabled allocation is required.' : ''}
                  >
                    {isActivatingSettlement ? 'Activating…' : 'Activate configuration'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

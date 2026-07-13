import React from 'react';
import { motion } from 'framer-motion';

function formatMoney(value) {
  const amount = Number(value || 0);
  return `\u20B9${amount.toFixed(2)}`;
}

export default function OrderReview({
  table,
  location,
  items,
  total,
  paymentType,
  setPaymentType,
  paymentStatus,
  setPaymentStatus,
  source, // 'MANUAL' or 'CODE'
  isSubmitting,
  onBack,
  onConfirm
}) {
  const sourceLabel = source === 'MANUAL' ? 'Manual Order' : 'Code Order';

  const paymentMethods = [
    { value: 'ONLINE', label: 'Razorpay / Online' },
    { value: 'CASH', label: 'Cash Payment' },
    { value: 'CARD', label: 'Credit / Debit Card' },
  ];

  const paymentStatuses = [
    { value: 'PENDING', label: 'Pending (Pay Later)' },
    { value: 'PAID', label: 'Paid (Manually Verified)' },
  ];

  return (
    <motion.div
      initial={{ scale: 0.98, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="bg-surface-container border border-outline-variant/30 rounded-2xl p-5 md:p-6 shadow-xl max-w-2xl mx-auto flex flex-col gap-6"
    >
      <div className="flex items-center gap-2 pb-3 border-b border-outline-variant/10">
        <span className="material-symbols-outlined text-primary text-2xl">rate_review</span>
        <div>
          <h3 className="font-headline-sm text-xl text-on-surface">Order Final Review</h3>
          <p className="text-xs text-on-surface-variant mt-0.5">Please review the details before sending to Live KDS.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-surface-container-low p-4 rounded-xl border border-outline-variant/10">
        <div>
          <span className="block text-[10px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest">Table / Location</span>
          <strong className="text-base text-on-surface flex items-center gap-1.5 mt-0.5">
            <span className="material-symbols-outlined text-primary text-sm">table_restaurant</span>
            {table} {location ? `(${location})` : ''}
          </strong>
        </div>
        <div>
          <span className="block text-[10px] font-label-caps text-on-surface-variant/70 uppercase tracking-widest">Order Source</span>
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-primary/20 bg-primary/10 text-primary text-xs font-semibold mt-1">
            <span className="material-symbols-outlined text-[12px]">{source === 'MANUAL' ? 'edit_note' : 'qr_code_scanner'}</span>
            {sourceLabel}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        <span className="block text-[10px] font-label-caps text-on-surface-variant uppercase tracking-widest">Items Breakdown</span>
        <div className="divide-y divide-outline-variant/10 max-h-48 overflow-y-auto pr-1">
          {items.map((item, idx) => (
            <div key={item.id || item._id || idx} className="py-2.5 flex justify-between items-center text-sm">
              <span className="text-on-surface font-medium">
                <span className="text-primary font-bold mr-1.5">{item.quantity}x</span>
                {item.name}
              </span>
              <span className="font-mono text-on-surface-variant font-semibold">
                {formatMoney(Number(item.price) * Number(item.quantity))}
              </span>
            </div>
          ))}
        </div>
        <div className="pt-3 border-t border-outline-variant/15 flex justify-between items-center">
          <span className="text-sm font-semibold text-on-surface-variant">Subtotal Preview</span>
          <strong className="font-price-display text-lg text-primary">{formatMoney(total)}</strong>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-outline-variant/10 pt-4">
        <div>
          <label className="block font-label-caps text-[11px] text-on-surface-variant mb-1.5 uppercase tracking-wider">Payment Method</label>
          <select
            value={paymentType}
            onChange={(e) => setPaymentType(e.target.value)}
            disabled={isSubmitting}
            className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-xl px-3 py-2.5 focus:border-primary outline-none text-sm disabled:opacity-50"
          >
            {paymentMethods.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block font-label-caps text-[11px] text-on-surface-variant mb-1.5 uppercase tracking-wider">Payment Status</label>
          <select
            value={paymentStatus}
            onChange={(e) => setPaymentStatus(e.target.value)}
            disabled={isSubmitting}
            className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-xl px-3 py-2.5 focus:border-primary outline-none text-sm disabled:opacity-50"
          >
            {paymentStatuses.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 pt-3 border-t border-outline-variant/10">
        <button
          type="button"
          onClick={onBack}
          disabled={isSubmitting}
          className="flex-1 bg-surface-container-high border border-outline-variant/50 text-on-surface hover:text-error hover:border-error/50 py-3.5 rounded-xl font-label-caps text-[13px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Back to Edit
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSubmitting}
          className="flex-[2] bg-gold-metallic text-on-primary-fixed py-3.5 rounded-xl font-label-caps text-[13px] uppercase tracking-widest gold-glow flex items-center justify-center gap-2 cursor-pointer transition-transform active:scale-95 disabled:opacity-50"
        >
          {isSubmitting ? (
            <>
              <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
              Sending to Live KDS...
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-[18px]">done_all</span>
              Confirm & Send to KDS
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
}

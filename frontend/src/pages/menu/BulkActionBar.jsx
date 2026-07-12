import React from 'react';
import { motion } from 'framer-motion';

export default function BulkActionBar({ selectedCount, onMarkAvailable, onMarkUnavailable, onClear, disabled }) {
  if (selectedCount === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 100 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 100 }}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-surface-container-high/90 backdrop-blur-md border border-outline-variant/30 px-6 py-4 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.4),0_0_30px_rgba(212,175,55,0.05)] flex flex-wrap items-center justify-between gap-4 z-[90] w-[90%] max-w-2xl"
    >
      <div className="flex items-center gap-3">
        <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center font-display-sm text-[12px] font-bold">
          {selectedCount}
        </div>
        <span className="font-body-md font-medium text-on-surface">items selected</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={onMarkAvailable}
          className="bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30 px-4 py-2 rounded-xl font-label-caps text-[11px] uppercase tracking-widest transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[16px]">check_circle</span>
          <span>In Stock</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onMarkUnavailable}
          className="bg-error/10 text-error hover:bg-error/20 border border-error/30 px-4 py-2 rounded-xl font-label-caps text-[11px] uppercase tracking-widest transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[16px]">remove_circle</span>
          <span>Out of Stock</span>
        </button>
        <div className="w-px h-6 bg-outline-variant/30 mx-1"></div>
        <button
          type="button"
          disabled={disabled}
          onClick={onClear}
          className="text-on-surface-variant hover:text-primary px-3 py-2 rounded-xl font-label-caps text-[11px] uppercase tracking-widest transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Clear
        </button>
      </div>
    </motion.div>
  );
}

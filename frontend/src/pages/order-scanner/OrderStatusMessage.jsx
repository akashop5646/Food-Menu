import React from 'react';
import { motion } from 'framer-motion';

export default function OrderStatusMessage({ successMsg, errorMsg }) {
  if (!successMsg && !errorMsg) return null;

  if (successMsg) {
    return (
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        role="status"
        aria-live="polite"
        className="bg-primary/10 text-primary px-4 py-4 rounded-xl border border-primary/20 text-sm font-medium flex items-center gap-3"
      >
        <span className="material-symbols-outlined text-xl">check_circle</span>
        <div>
          <strong className="block text-primary">Success</strong>
          <span className="text-[12px] opacity-90">{successMsg}</span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      role="alert"
      className="bg-error/10 text-error px-4 py-3 rounded-xl border border-error/20 text-sm font-medium flex items-center gap-3"
    >
      <span className="material-symbols-outlined text-xl text-error">error</span>
      <div>
        <strong className="block text-error font-semibold">Error</strong>
        <span className="text-[12px] opacity-95">{errorMsg}</span>
      </div>
    </motion.div>
  );
}
